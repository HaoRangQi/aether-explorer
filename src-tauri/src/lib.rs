use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::io::{ErrorKind, Read, Seek, SeekFrom, Write};
use std::hash::{Hash, Hasher};
use std::os::unix::fs as unix_fs;
use std::os::unix::fs::{MetadataExt, PermissionsExt};
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{Emitter, Manager, TitleBarStyle, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_liquid_glass::{GlassMaterialVariant, LiquidGlassConfig, LiquidGlassExt};
use tauri_plugin_log::{Target, TargetKind};

#[cfg(target_os = "macos")]
use tauri::menu::{Menu, MenuEvent, MenuItem, PredefinedMenuItem, Submenu};
#[cfg(target_os = "macos")]
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
#[cfg(target_os = "macos")]
use tauri_plugin_dialog::DialogExt;
#[cfg(target_os = "macos")]
use tauri_plugin_updater::UpdaterExt;

#[derive(Debug, Serialize, Clone)]
struct FileEntry {
    name: String,
    path: String,
    is_dir: bool,
    size: String,
    modified: String,
    created: String,
    added: String,
    #[serde(rename = "lastOpened")]
    last_opened: String,
    #[serde(rename = "type")]
    file_type: String,
    #[serde(rename = "iconPath", skip_serializing_if = "Option::is_none")]
    icon_path: Option<String>,
    #[serde(rename = "childCount", skip_serializing_if = "Option::is_none")]
    child_count: Option<u64>,
}

#[derive(Debug, Serialize, Clone)]
struct DiskInfo {
    filesystem: String,
    size: String,
    used: String,
    available: String,
    capacity: String,
    capacity_value: u8,
    mount: String,
}

#[derive(Debug, Serialize, Clone)]
struct VolumeInfo {
    name: String,
    path: String,
    filesystem: String,
    size: String,
    used: String,
    available: String,
    capacity: String,
    capacity_value: u8,
    is_root: bool,
    is_external: bool,
    is_ejectable: bool,
}

#[derive(Debug, Serialize, Clone, PartialEq, Eq)]
struct DirectorySignature {
    fingerprint: String,
    entry_count: u64,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct LiquidGlassStatus {
    requested: bool,
    supported: bool,
    applied: bool,
    reason: Option<String>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct PermissionPreflightResult {
    path: String,
    ok: bool,
    error: Option<String>,
}

#[derive(Clone, Default)]
struct DirectoryLoadState(Arc<Mutex<HashMap<String, u64>>>);

#[derive(Clone)]
struct DirectoryLoadToken {
    scope: String,
    request_id: u64,
    latest_requests: Arc<Mutex<HashMap<String, u64>>>,
}

impl DirectoryLoadState {
    fn mark_latest(&self, scope: String, request_id: u64) -> Result<(), AppError> {
        let mut latest = self.0.lock().map_err(|_| AppError::unavailable("目录加载状态不可用"))?;
        let should_update = match latest.get(&scope).copied() {
            Some(current) => request_id >= current,
            None => true,
        };
        if should_update {
            latest.insert(scope, request_id);
        }
        Ok(())
    }

    fn begin(&self, scope: Option<String>, request_id: Option<u64>) -> Result<Option<DirectoryLoadToken>, AppError> {
        let (Some(scope), Some(request_id)) = (scope, request_id) else {
            return Ok(None);
        };

        self.mark_latest(scope.clone(), request_id)?;
        Ok(Some(DirectoryLoadToken {
            scope,
            request_id,
            latest_requests: self.0.clone(),
        }))
    }
}

impl DirectoryLoadToken {
    fn is_cancelled(&self) -> bool {
        match self.latest_requests.lock() {
            Ok(latest) => latest.get(&self.scope).copied() != Some(self.request_id),
            Err(_) => true,
        }
    }

}

#[derive(Debug, Serialize, Clone, PartialEq, Eq)]
enum AppErrorKind {
    PermissionDenied,
    NotFound,
    DiskFull,
    Busy,
    InvalidPath,
    Conflict,
    Cancelled,
    TrashUnsupported,
    Internal,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct AppError {
    kind: AppErrorKind,
    message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    path: Option<String>,
}

impl AppError {
    fn new(kind: AppErrorKind, message: impl Into<String>, path: Option<String>) -> Self {
        Self {
            kind,
            message: message.into(),
            path,
        }
    }

    fn internal(message: impl Into<String>) -> Self {
        Self::new(AppErrorKind::Internal, message, None)
    }

    fn internal_at(message: impl Into<String>, path: Option<String>) -> Self {
        Self::new(AppErrorKind::Internal, message, path)
    }

    fn invalid_path(message: impl Into<String>, path: Option<String>) -> Self {
        Self::new(AppErrorKind::InvalidPath, message, path)
    }

    fn conflict(message: impl Into<String>, path: Option<String>) -> Self {
        Self::new(AppErrorKind::Conflict, message, path)
    }

    fn cancelled(message: impl Into<String>, path: Option<String>) -> Self {
        Self::new(AppErrorKind::Cancelled, message, path)
    }

    fn trash_unsupported(message: impl Into<String>, path: Option<String>) -> Self {
        Self::new(AppErrorKind::TrashUnsupported, message, path)
    }

    fn unavailable(message: impl Into<String>) -> Self {
        Self::new(AppErrorKind::Internal, message, None)
    }

    fn from_io(err: &std::io::Error, path: Option<&str>, fallback: impl Into<String>) -> Self {
        let path_string = path.map(|p| p.to_string());
        match err.kind() {
            ErrorKind::PermissionDenied => Self::new(AppErrorKind::PermissionDenied, "权限不足，无法访问该路径", path_string),
            ErrorKind::NotFound => Self::new(AppErrorKind::NotFound, "路径不存在", path_string),
            ErrorKind::StorageFull => Self::new(AppErrorKind::DiskFull, "磁盘空间不足", path_string),
            _ => {
                let msg = err.to_string();
                if msg.contains("permission") || msg.contains("denied") || msg.contains("not allowed") {
                    Self::new(AppErrorKind::PermissionDenied, "权限不足，无法访问该路径", path_string)
                } else if msg.contains("busy") {
                    Self::new(AppErrorKind::Busy, "文件正在被占用", path_string)
                } else {
                    Self::new(AppErrorKind::Internal, fallback, path_string)
                }
            }
        }
    }
}

fn aether_log_dir(home_dir: &Path) -> PathBuf {
    home_dir.join("Library").join("Logs").join("Aether Explorer")
}

fn panic_log_path(log_dir: &Path) -> PathBuf {
    log_dir.join("panic.log")
}

#[cfg(test)]
fn settings_store_path(config_dir: &Path) -> PathBuf {
    config_dir.join("settings.json")
}

fn format_panic_report(message: &str, location: Option<&std::panic::Location<'_>>) -> String {
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs().to_string())
        .unwrap_or_else(|_| "unknown".to_string());
    let location = location
        .map(|loc| format!("{}:{}:{}", loc.file(), loc.line(), loc.column()))
        .unwrap_or_else(|| "unknown".to_string());

    format!(
        "[{}] RUST PANIC\nlocation: {}\nmessage: {}\n\n",
        timestamp, location, message
    )
}

fn write_panic_report(log_dir: &Path, report: &str) -> std::io::Result<()> {
    fs::create_dir_all(log_dir)?;
    let mut file = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(panic_log_path(log_dir))?;
    file.write_all(report.as_bytes())
}

fn read_last_panic_log_from_dir(log_dir: &Path, max_bytes: u64) -> std::io::Result<Option<String>> {
    let path = panic_log_path(log_dir);
    let metadata = match fs::metadata(&path) {
        Ok(metadata) => metadata,
        Err(err) if err.kind() == ErrorKind::NotFound => return Ok(None),
        Err(err) => return Err(err),
    };
    if metadata.len() == 0 {
        return Ok(Some(String::new()));
    }

    let read_len = metadata.len().min(max_bytes.max(1));
    let mut file = fs::File::open(path)?;
    file.seek(SeekFrom::Start(metadata.len() - read_len))?;
    let mut buffer = Vec::with_capacity(read_len as usize);
    file.take(read_len).read_to_end(&mut buffer)?;
    Ok(Some(String::from_utf8_lossy(&buffer).into_owned()))
}

fn install_panic_hook(log_dir: PathBuf) {
    std::panic::set_hook(Box::new(move |info| {
        let message = info
            .payload()
            .downcast_ref::<&str>()
            .map(|value| (*value).to_string())
            .or_else(|| info.payload().downcast_ref::<String>().cloned())
            .unwrap_or_else(|| "unknown panic payload".to_string());
        let report = format_panic_report(&message, info.location());

        log::error!("{}", report.trim_end());
        let _ = write_panic_report(&log_dir, &report);
    }));
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct FileTransferPayload {
    paths: Vec<String>,
    cut: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    source_window: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    transfer_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    preview_name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    count: Option<u32>,
}

struct FileClipboardState(Mutex<Option<FileTransferPayload>>);
struct FileDragState(Mutex<Option<FileTransferPayload>>);

#[derive(Clone, Default)]
struct TransferTaskState(Arc<Mutex<HashMap<String, TransferTask>>>);

#[derive(Clone)]
struct TransferTask {
    snapshot: TransferTaskSnapshot,
    cancel_requested: Arc<AtomicBool>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct TransferTaskSnapshot {
    id: String,
    kind: String,
    status: String,
    total_items: u64,
    completed_items: u64,
    total_bytes: u64,
    completed_bytes: u64,
    current_name: Option<String>,
    error: Option<String>,
    started_at: u64,
    finished_at: Option<u64>,
    copied: u64,
    moved: u64,
    copied_cross_device: u64,
    failed: u64,
    conflicts: u64,
    skipped: u64,
    skipped_same_dir: u64,
    skipped_conflicts: u64,
}

#[derive(Clone)]
struct TransferProgress {
    task_id: String,
    state: TransferTaskState,
    cancel_requested: Arc<AtomicBool>,
}

#[derive(Default)]
struct TransferEstimate {
    items: u64,
    bytes: u64,
}

impl TransferTaskState {
    fn insert(&self, snapshot: TransferTaskSnapshot, cancel_requested: Arc<AtomicBool>) -> Result<(), AppError> {
        let mut tasks = self.0.lock().map_err(|_| AppError::unavailable("传输任务状态不可用"))?;
        tasks.insert(snapshot.id.clone(), TransferTask { snapshot, cancel_requested });
        Ok(())
    }

    fn update<F>(&self, task_id: &str, update: F)
    where
        F: FnOnce(&mut TransferTaskSnapshot),
    {
        match self.0.lock() {
            Ok(mut tasks) => {
                if let Some(task) = tasks.get_mut(task_id) {
                    update(&mut task.snapshot);
                }
            }
            Err(_) => log::error!("传输任务状态锁不可用，无法更新任务 {}", task_id),
        }
    }

    fn list(&self) -> Result<Vec<TransferTaskSnapshot>, AppError> {
        let tasks = self.0.lock().map_err(|_| AppError::unavailable("传输任务状态不可用"))?;
        let mut snapshots: Vec<TransferTaskSnapshot> = tasks.values().map(|task| task.snapshot.clone()).collect();
        snapshots.sort_by_key(|snapshot| snapshot.started_at);
        Ok(snapshots)
    }
}

impl TransferProgress {
    fn check_cancelled(&self) -> Result<(), String> {
        if self.cancel_requested.load(Ordering::SeqCst) {
            Err("操作已取消".into())
        } else {
            Ok(())
        }
    }

    fn set_current(&self, path: &Path) {
        let current_name = path
            .file_name()
            .and_then(|name| name.to_str())
            .map(|name| name.to_string())
            .unwrap_or_else(|| path.to_string_lossy().into_owned());
        self.state.update(&self.task_id, |snapshot| {
            snapshot.current_name = Some(current_name);
        });
    }

    fn complete(&self, items: u64, bytes: u64) {
        self.state.update(&self.task_id, |snapshot| {
            snapshot.completed_items = snapshot.completed_items.saturating_add(items).min(snapshot.total_items);
            snapshot.completed_bytes = snapshot.completed_bytes.saturating_add(bytes).min(snapshot.total_bytes);
        });
    }

    fn complete_one(&self, bytes: u64) {
        self.complete(1, bytes);
    }

    fn complete_path_estimate(&self, path: &Path) {
        let estimate = estimate_transfer_path(path);
        self.complete(estimate.items.max(1), estimate.bytes);
    }
}

fn is_terminal_transfer_status(status: &str) -> bool {
    matches!(status, "completed" | "failed" | "cancelled")
}

const FINISHED_TRANSFER_TASK_RETENTION_SECONDS: u64 = 30;

fn now_unix_seconds() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or(0)
}

fn next_transfer_task_id(kind: &str) -> String {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or(0);
    format!("{}-{}-{}", kind, std::process::id(), nanos)
}

fn estimate_transfer_path(path: &Path) -> TransferEstimate {
    let mut estimate = TransferEstimate::default();
    estimate_transfer_path_into(path, &mut estimate);
    estimate
}

fn estimate_transfer_path_into(path: &Path, estimate: &mut TransferEstimate) {
    estimate.items = estimate.items.saturating_add(1);
    let Ok(metadata) = fs::symlink_metadata(path) else {
        return;
    };

    if metadata.file_type().is_symlink() {
        return;
    }
    if metadata.is_dir() {
        if let Ok(entries) = fs::read_dir(path) {
            for entry in entries.flatten() {
                estimate_transfer_path_into(&entry.path(), estimate);
            }
        }
    } else {
        estimate.bytes = estimate.bytes.saturating_add(metadata.len());
    }
}

fn estimate_transfer_paths(paths: &[String]) -> TransferEstimate {
    paths.iter().fold(TransferEstimate::default(), |mut estimate, path| {
        estimate_transfer_path_into(Path::new(path), &mut estimate);
        estimate
    })
}

fn summarize_transfer_error(failed: &[MoveFailure], conflicts: &[MoveConflict]) -> Option<String> {
    if !conflicts.is_empty() {
        return Some(format!("存在 {} 个文件冲突", conflicts.len()));
    }
    if !failed.is_empty() {
        return Some(format!("{} 个项目失败：{}", failed.len(), failed[0].error));
    }
    None
}

fn format_size(bytes: u64) -> String {
    const KB: f64 = 1024.0;
    const MB: f64 = KB * 1024.0;
    const GB: f64 = MB * 1024.0;

    let b = bytes as f64;
    if b >= GB {
        format!("{:.1} GB", b / GB)
    } else if b >= MB {
        format!("{:.1} MB", b / MB)
    } else if b >= KB {
        format!("{:.1} KB", b / KB)
    } else {
        format!("{} B", bytes)
    }
}

fn format_kib(kib: &str) -> String {
    kib.parse::<u64>()
        .map(|value| format_size(value.saturating_mul(1024)))
        .unwrap_or_else(|_| kib.into())
}

fn format_storage_size(bytes: u64) -> String {
    const KB: f64 = 1000.0;
    const MB: f64 = KB * 1000.0;
    const GB: f64 = MB * 1000.0;

    let b = bytes as f64;
    if b >= GB {
        format!("{:.1} GB", b / GB)
    } else if b >= MB {
        format!("{:.1} MB", b / MB)
    } else if b >= KB {
        format!("{:.1} KB", b / KB)
    } else {
        format!("{} B", bytes)
    }
}

fn storage_capacity_value(used: u64, size: u64) -> u8 {
    if size == 0 {
        return 0;
    }

    (((used as f64 / size as f64) * 100.0).round() as u8).min(100)
}

fn parse_plist_integer(text: &str, key: &str) -> Option<u64> {
    let key_tag = format!("<key>{}</key>", key);
    let after_key = text.split_once(&key_tag)?.1;
    let after_open = after_key.split_once("<integer>")?.1;
    let value = after_open.split_once("</integer>")?.0.trim();
    value.parse::<u64>().ok()
}

fn decode_plist_string(value: &str) -> String {
    value
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&apos;", "'")
}

fn parse_plist_string(text: &str, key: &str) -> Option<String> {
    let key_tag = format!("<key>{}</key>", key);
    let after_key = text.split_once(&key_tag)?.1;
    let after_open = after_key.split_once("<string>")?.1;
    let value = after_open.split_once("</string>")?.0.trim();
    Some(decode_plist_string(value))
}

fn build_primary_apfs_disk_info(data_plist: &str, system_plist: Option<&str>) -> Option<DiskInfo> {
    let size = parse_plist_integer(data_plist, "APFSContainerSize")
        .or_else(|| parse_plist_integer(data_plist, "TotalSize"))
        .or_else(|| parse_plist_integer(data_plist, "Size"))?;
    let data_used = parse_plist_integer(data_plist, "CapacityInUse")?;
    let system_used = system_plist
        .and_then(|plist| parse_plist_integer(plist, "CapacityInUse"))
        .unwrap_or(0);
    let used = data_used.saturating_add(system_used).min(size);
    let available = size.saturating_sub(used);
    let capacity_value = storage_capacity_value(used, size);
    let filesystem = parse_plist_string(data_plist, "FilesystemUserVisibleName")
        .or_else(|| parse_plist_string(data_plist, "FilesystemName"))
        .unwrap_or_else(|| "APFS".to_string());

    Some(DiskInfo {
        filesystem,
        size: format_storage_size(size),
        used: format_storage_size(used),
        available: format_storage_size(available),
        capacity: format!("{}%", capacity_value),
        capacity_value,
        mount: "/".to_string(),
    })
}

#[cfg(target_os = "macos")]
fn diskutil_info_plist(path: &str) -> Option<String> {
    let output = std::process::Command::new("diskutil")
        .args(["info", "-plist", path])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    String::from_utf8(output.stdout).ok()
}

#[cfg(target_os = "macos")]
fn get_primary_apfs_disk_info(path: &str) -> Option<DiskInfo> {
    if path != "/" {
        return None;
    }

    let data_plist = diskutil_info_plist("/System/Volumes/Data")?;
    let system_plist = diskutil_info_plist("/");
    build_primary_apfs_disk_info(&data_plist, system_plist.as_deref())
}

fn parse_df_line(line: &str) -> Result<(&str, &str, &str, &str, &str, String), String> {
    let cols: Vec<&str> = line.split_whitespace().collect();
    if cols.len() < 6 {
        return Err(format!("磁盘信息格式异常: {}", line));
    }
    Ok((cols[0], cols[1], cols[2], cols[3], cols[4], cols[5..].join(" ")))
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct DfRow {
    filesystem: String,
    size: String,
    used: String,
    available: String,
    capacity: String,
    mount: String,
}

fn parse_df_row(line: &str) -> Result<DfRow, String> {
    let (filesystem, size, used, available, capacity, mount) = parse_df_line(line)?;
    Ok(DfRow {
        filesystem: filesystem.into(),
        size: size.into(),
        used: used.into(),
        available: available.into(),
        capacity: capacity.into(),
        mount,
    })
}

fn parse_df_rows(text: &str) -> Vec<DfRow> {
    text.lines()
        .skip(1)
        .filter_map(|line| parse_df_row(line).ok())
        .collect()
}

fn root_storage_row(rows: &[DfRow]) -> Option<&DfRow> {
    rows.iter()
        .find(|row| row.mount == "/System/Volumes/Data")
        .or_else(|| rows.iter().find(|row| row.mount == "/"))
}

fn disk_info_from_df_row(row: &DfRow, mount: Option<&str>) -> DiskInfo {
    DiskInfo {
        filesystem: row.filesystem.clone(),
        size: format_kib(&row.size),
        used: format_kib(&row.used),
        available: format_kib(&row.available),
        capacity: row.capacity.clone(),
        capacity_value: parse_capacity(&row.capacity),
        mount: mount.unwrap_or(&row.mount).to_string(),
    }
}

fn volume_info_from_df_row(row: &DfRow, is_root: bool) -> VolumeInfo {
    let path = if is_root { "/".to_string() } else { row.mount.clone() };
    let name = if is_root {
        "Macintosh HD".to_string()
    } else {
        Path::new(&row.mount)
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or(&row.mount)
            .to_string()
    };

    VolumeInfo {
        name,
        path: path.clone(),
        filesystem: row.filesystem.clone(),
        size: format_kib(&row.size),
        used: format_kib(&row.used),
        available: format_kib(&row.available),
        capacity: row.capacity.clone(),
        capacity_value: parse_capacity(&row.capacity),
        is_root,
        is_external: path.starts_with("/Volumes/"),
        is_ejectable: path.starts_with("/Volumes/"),
    }
}

fn volume_infos_from_df_rows(rows: &[DfRow]) -> Vec<VolumeInfo> {
    let root_mount = root_storage_row(rows).map(|row| row.mount.as_str());
    let mut seen_mounts = std::collections::HashSet::new();
    let mut volumes = Vec::new();

    for row in rows {
        let is_root = root_mount == Some(row.mount.as_str());
        if !is_root && !row.mount.starts_with("/Volumes") {
            continue;
        }

        let volume = volume_info_from_df_row(row, is_root);
        if !seen_mounts.insert(volume.path.clone()) {
            continue;
        }
        volumes.push(volume);
    }

    volumes.sort_by(|a, b| b.is_root.cmp(&a.is_root).then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase())));
    volumes
}

fn detect_mime(name: &str, is_dir: bool) -> String {
    if is_dir {
        if name.to_lowercase().ends_with(".app") {
            return "application".into();
        }
        return "folder".into();
    }

    let ext = Path::new(name)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();

    match ext.as_str() {
        "png" | "jpg" | "jpeg" | "gif" | "svg" | "webp" | "bmp" | "ico" | "tiff" | "tif" | "heic" | "heif" | "avif" => "image",
        "mp4" | "mov" | "mkv" | "avi" | "webm" | "m4v" | "flv" | "wmv" | "mpeg" | "mpg" => "video",
        "mp3" | "wav" | "aac" | "flac" | "ogg" | "m4a" | "aiff" | "aif" => "audio",
        "pdf" => "pdf",
        "zip" | "tar" | "gz" | "7z" | "rar" | "bz2" | "xz" | "tgz" | "dmg" | "pkg" | "iso" => "archive",
        "ts" | "tsx" | "js" | "jsx" | "mjs" | "cjs" | "py" | "rs" | "go" | "java" | "c" | "cc" | "cpp" | "h" | "hpp" | "swift" | "kt" | "rb" | "php" | "sh" | "bash" | "zsh" | "fish" | "sql" | "css" | "scss" | "html" | "vue" | "svelte" => "code",
        "txt" | "md" | "markdown" | "csv" | "tsv" | "json" | "yaml" | "yml" | "xml" | "toml" | "ini" | "cfg" | "conf" | "log" | "lock" | "rst" | "txt~" => "text",
        _ => "file",
    }
    .into()
}

fn find_app_icon_path(app_path: &Path) -> Option<String> {
    let resources_dir = app_path.join("Contents").join("Resources");
    if !resources_dir.is_dir() {
        return None;
    }

    let info_plist = app_path.join("Contents").join("Info.plist");
    if info_plist.exists() {
        if let Ok(output) = std::process::Command::new("plutil")
            .args(["-extract", "CFBundleIconFile", "raw", "-o", "-"])
            .arg(&info_plist)
            .output()
        {
            if output.status.success() {
                let icon_name = String::from_utf8_lossy(&output.stdout).trim().to_string();
                if !icon_name.is_empty() {
                    let candidates = if Path::new(&icon_name).extension().is_some() {
                        vec![resources_dir.join(&icon_name)]
                    } else {
                        vec![
                            resources_dir.join(format!("{}.icns", icon_name)),
                            resources_dir.join(&icon_name),
                        ]
                    };

                    for candidate in candidates {
                        if candidate.exists() {
                            return Some(candidate.to_string_lossy().to_string());
                        }
                    }
                }
            }
        }
    }

    fs::read_dir(resources_dir)
        .ok()?
        .flatten()
        .map(|entry| entry.path())
        .find(|path| {
            path.extension()
                .and_then(|ext| ext.to_str())
                .map(|ext| ext.eq_ignore_ascii_case("icns"))
                .unwrap_or(false)
        })
        .map(|path| path.to_string_lossy().to_string())
}

fn app_icon_cache_dir() -> PathBuf {
    let base = std::env::var("HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|_| std::env::temp_dir());
    base.join("Library")
        .join("Caches")
        .join("Aether Explorer")
        .join("AppIcons")
}

fn app_icon_cache_path(app_path: &Path, source_icon: Option<&Path>) -> PathBuf {
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    app_path.to_string_lossy().hash(&mut hasher);
    app_path
        .metadata()
        .ok()
        .and_then(|metadata| metadata.modified().ok())
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_secs())
        .unwrap_or(0)
        .hash(&mut hasher);
    source_icon
        .and_then(|path| fs::metadata(path).ok())
        .and_then(|metadata| metadata.modified().ok())
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_secs())
        .unwrap_or(0)
        .hash(&mut hasher);
    app_icon_cache_dir().join(format!("{:x}.png", hasher.finish()))
}

#[cfg(target_os = "macos")]
fn export_workspace_app_icon(app_path: &Path, output_path: &Path) -> Result<(), String> {
    let script = r#"
ObjC.import('AppKit');
ObjC.import('Foundation');
const appPath = $.NSProcessInfo.processInfo.environment.objectForKey('AETHER_ICON_APP_PATH').js;
const outputPath = $.NSProcessInfo.processInfo.environment.objectForKey('AETHER_ICON_OUTPUT_PATH').js;
const icon = $.NSWorkspace.sharedWorkspace.iconForFile(appPath);
if (!icon) throw new Error('NSWorkspace returned no icon');
const data = icon.TIFFRepresentation;
if (!data) throw new Error('icon has no TIFFRepresentation');
const rep = $.NSBitmapImageRep.imageRepWithData(data);
if (!rep) throw new Error('cannot create bitmap representation');
const png = rep.representationUsingTypeProperties($.NSBitmapImageFileTypePNG, $({}));
if (!png) throw new Error('cannot encode png');
if (!png.writeToFileAtomically(outputPath, true)) throw new Error('cannot write png');
"#;

    let output = std::process::Command::new("osascript")
        .args(["-l", "JavaScript", "-e", script])
        .env("AETHER_ICON_APP_PATH", app_path)
        .env("AETHER_ICON_OUTPUT_PATH", output_path)
        .output()
        .map_err(|e| format!("无法导出系统应用图标: {}", e))?;

    if output.status.success() && output_path.exists() {
        Ok(())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).trim().to_string())
    }
}

#[cfg(not(target_os = "macos"))]
fn export_workspace_app_icon(_app_path: &Path, _output_path: &Path) -> Result<(), String> {
    Err("unsupported platform".into())
}

fn convert_icns_to_png(icon_path: &Path, output_path: &Path) -> Result<(), String> {
    let output = std::process::Command::new("sips")
        .args(["-Z", "256", "-s", "format", "png"])
        .arg(icon_path)
        .arg("--out")
        .arg(output_path)
        .output()
        .map_err(|e| format!("无法转换应用图标: {}", e))?;

    if output.status.success() && output_path.exists() {
        Ok(())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).trim().to_string())
    }
}

fn resolve_app_icon_png(app_path: &Path) -> Option<String> {
    if !app_path.is_dir() || !app_path.to_string_lossy().to_lowercase().ends_with(".app") {
        return None;
    }

    let source_icon = find_app_icon_path(app_path).map(PathBuf::from);
    let cache_path = app_icon_cache_path(app_path, source_icon.as_deref());
    if cache_path.exists() {
        return Some(cache_path.to_string_lossy().to_string());
    }

    fs::create_dir_all(app_icon_cache_dir()).ok()?;

    let exported = source_icon
        .as_deref()
        .ok_or_else(|| "missing source icon".to_string())
        .and_then(|icon| convert_icns_to_png(icon, &cache_path))
        .or_else(|_| export_workspace_app_icon(app_path, &cache_path))
        .is_ok();

    if exported && cache_path.exists() {
        Some(cache_path.to_string_lossy().to_string())
    } else {
        None
    }
}

#[tauri::command]
fn get_app_icon(path: String) -> Result<Option<String>, AppError> {
    Ok(resolve_app_icon_png(Path::new(&path)))
}

fn format_modified(metadata: &fs::Metadata) -> String {
    metadata
        .modified()
        .ok()
        .map(|t| {
            let dt: chrono::DateTime<chrono::Local> = t.into();
            dt.format("%Y-%m-%d %H:%M:%S").to_string()
        })
        .unwrap_or_else(|| "未知".into())
}

fn format_system_time(time: Option<SystemTime>) -> String {
    time.map(|t| {
        let dt: chrono::DateTime<chrono::Local> = t.into();
        dt.format("%Y-%m-%d %H:%M").to_string()
    })
    .unwrap_or_default()
}

#[cfg(target_os = "macos")]
fn read_mdls_date(path: &Path, attr: &str) -> String {
    std::process::Command::new("mdls")
        .args(["-raw", "-name", attr])
        .arg(path)
        .output()
        .ok()
        .filter(|output| output.status.success())
        .and_then(|output| String::from_utf8(output.stdout).ok())
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty() && value != "(null)" && value != "null")
        .map(|value| value.split(" +").next().unwrap_or(&value).to_string())
        .unwrap_or_default()
}

#[cfg(not(target_os = "macos"))]
fn read_mdls_date(_path: &Path, _attr: &str) -> String {
    String::new()
}

fn classify_directory_read_error(err: &std::io::Error, dir_path: &str) -> AppError {
    AppError::from_io(
        err,
        Some(dir_path),
        format!("无法读取目录: {}", err),
    )
}

fn list_directory_entries(
    dir_path: &str,
    show_hidden: bool,
    cancel_token: Option<DirectoryLoadToken>,
) -> Result<Vec<FileEntry>, AppError> {
    let entries = fs::read_dir(dir_path).map_err(|e| classify_directory_read_error(&e, dir_path))?;

    let mut files: Vec<FileEntry> = Vec::new();
    let mut dirs: Vec<FileEntry> = Vec::new();

    for entry in entries {
        if cancel_token.as_ref().is_some_and(DirectoryLoadToken::is_cancelled) {
            return Err(AppError::cancelled("目录加载已被新的请求取代", Some(dir_path.to_string())));
        }

        let entry = entry.map_err(|e| AppError::from_io(&e, Some(dir_path), format!("读取条目失败: {}", e)))?;
        let name = entry.file_name().to_string_lossy().to_string();

        if !show_hidden && name.starts_with('.') {
            continue;
        }

        let path = entry.path().to_string_lossy().to_string();
        let metadata = entry.metadata().map_err(|e| AppError::from_io(&e, Some(&path), format!("读取元数据失败: {}", e)))?;
        let is_dir = metadata.is_dir();
        let size = if is_dir {
            "--".into()
        } else {
            format_size(metadata.len())
        };
        let modified = format_modified(&metadata);
        let created = format_system_time(metadata.created().ok());
        // 性能保护：目录列表不做逐项 mdls 查询，避免大目录刷新卡顿。
        // 详细时间字段仍可通过 get_file_info 按需获取。
        let added = String::new();
        let last_opened = String::new();
        let file_type = detect_mime(&name, is_dir);
        // 性能保护：目录列表阶段不解析 app bundle 图标，防止大量 plutil 调用造成卡顿。
        let icon_path = None;

        // 性能保护：不再为每个子目录跑 read_dir 算子项数（N+1 系统调用）。
        // 子项数改为按需通过 get_child_count 命令懒查，由前端缓存。
        let child_count = None;

        let fe = FileEntry {
            name,
            path,
            is_dir,
            size,
            modified,
            created,
            added,
            last_opened,
            file_type,
            icon_path,
            child_count,
        };

        if is_dir {
            dirs.push(fe);
        } else {
            files.push(fe);
        }
    }

    // Sort: directories first, then files, both alphabetically
    dirs.sort_by_key(|a| a.name.to_lowercase());
    files.sort_by_key(|a| a.name.to_lowercase());
    dirs.append(&mut files);

    Ok(dirs)
}

#[tauri::command]
async fn list_directory(
    state: tauri::State<'_, DirectoryLoadState>,
    dir_path: String,
    show_hidden: bool,
    request_scope: Option<String>,
    request_id: Option<u64>,
) -> Result<Vec<FileEntry>, AppError> {
    let cancel_token = state.begin(request_scope, request_id)?;
    tauri::async_runtime::spawn_blocking(move || {
        list_directory_entries(&dir_path, show_hidden, cancel_token)
    })
        .await
        .map_err(|e| AppError::internal(format!("目录加载任务失败: {}", e)))?
}

#[tauri::command]
fn cancel_directory_loads(
    state: tauri::State<DirectoryLoadState>,
    request_scope: String,
    request_id: u64,
) -> Result<(), AppError> {
    state.mark_latest(request_scope, request_id)
}

#[tauri::command]
fn get_home_dir() -> String {
    dirs_fun()
}

fn dirs_fun() -> String {
    std::env::var("HOME").unwrap_or_else(|_| "/".into())
}

#[tauri::command]
fn preflight_file_permissions() -> Vec<PermissionPreflightResult> {
    let home = dirs_fun();
    let paths = [
        format!("{}/Desktop", home),
        format!("{}/Documents", home),
        format!("{}/Downloads", home),
        format!("{}/Library/Mobile Documents", home),
        format!("{}/.Trash", home),
        "/Applications".to_string(),
    ];

    paths
        .iter()
        .map(|path| match fs::read_dir(path) {
            Ok(mut entries) => {
                let _ = entries.next();
                PermissionPreflightResult {
                    path: path.clone(),
                    ok: true,
                    error: None,
                }
            }
            Err(error) => PermissionPreflightResult {
                path: path.clone(),
                ok: false,
                error: Some(error.to_string()),
            },
        })
        .collect()
}

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! Welcome to Aether Explorer.", name)
}

/// 敏感文件名 / 后缀黑名单 — 默认不允许 read_text_preview 读出来在预览面板展示。
///
/// 防的是：用户右键、空格预览不小心把 .env / id_rsa 暴露在屏幕上 / 被旁边人扫到。
/// 用户仍可通过"打开方式"显式打开（go 经过他们认知层面），但不会被 8KB 自动预览。
const SENSITIVE_PREVIEW_NAMES: &[&str] = &[
    ".env", ".envrc", ".npmrc", ".pypirc", ".netrc",
    "id_rsa", "id_dsa", "id_ed25519", "id_ecdsa",
    ".aws/credentials", "kubeconfig", ".gnupg",
];

fn is_sensitive_for_preview(path: &Path) -> bool {
    let name = path.file_name().and_then(|n| n.to_str()).unwrap_or_default().to_lowercase();
    let full = path.to_string_lossy().to_lowercase();
    for s in SENSITIVE_PREVIEW_NAMES {
        let s = s.to_lowercase();
        if name == s || name.ends_with(&format!(".{}", s)) || full.ends_with(&s) {
            return true;
        }
    }
    false
}

#[tauri::command]
fn read_text_preview(path: String) -> Result<String, AppError> {
    use std::io::Read;
    let p = Path::new(&path);
    if is_sensitive_for_preview(p) {
        return Err(AppError::new(
            AppErrorKind::PermissionDenied,
            "此文件类型默认不在预览面板展示（含敏感信息）— 可使用『打开方式』显式打开",
            Some(path),
        ));
    }
    let mut file = fs::File::open(&path)
        .map_err(|e| AppError::from_io(&e, Some(&path), format!("无法打开文件: {}", e)))?;
    let mut buf = vec![0u8; 8192]; // First 8KB
    let n = file.read(&mut buf)
        .map_err(|e| AppError::from_io(&e, Some(&path), format!("读取失败: {}", e)))?;
    buf.truncate(n);
    String::from_utf8(buf)
        .map_err(|e| AppError::invalid_path(format!("不是有效的文本文件: {}", e), Some(path)))
}

#[tauri::command]
fn open_system_settings() -> Result<(), AppError> {
    std::process::Command::new("open")
        .args(["x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles"])
        .spawn()
        .map_err(|e| AppError::internal(format!("无法打开系统设置: {}", e)))?;
    Ok(())
}

#[tauri::command]
fn get_logs_dir(app: tauri::AppHandle) -> Result<String, AppError> {
    let home_dir = app
        .path()
        .home_dir()
        .map_err(|e| AppError::internal(format!("无法读取用户目录: {}", e)))?;
    Ok(aether_log_dir(&home_dir).to_string_lossy().into_owned())
}

#[tauri::command]
fn get_config_dir(app: tauri::AppHandle) -> Result<String, AppError> {
    let config_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| AppError::internal(format!("无法读取配置目录: {}", e)))?;
    Ok(config_dir.to_string_lossy().into_owned())
}

#[tauri::command]
fn open_logs_dir(app: tauri::AppHandle) -> Result<(), AppError> {
    let home_dir = app
        .path()
        .home_dir()
        .map_err(|e| AppError::internal(format!("无法读取用户目录: {}", e)))?;
    let log_dir = aether_log_dir(&home_dir);
    fs::create_dir_all(&log_dir)
        .map_err(|e| AppError::from_io(&e, log_dir.to_str(), format!("无法创建日志目录: {}", e)))?;
    std::process::Command::new("open")
        .arg(&log_dir)
        .spawn()
        .map_err(|e| AppError::internal(format!("无法打开日志目录: {}", e)))?;
    Ok(())
}

#[tauri::command]
fn open_config_dir(app: tauri::AppHandle) -> Result<(), AppError> {
    let config_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| AppError::internal(format!("无法读取配置目录: {}", e)))?;
    fs::create_dir_all(&config_dir)
        .map_err(|e| AppError::from_io(&e, config_dir.to_str(), format!("无法创建配置目录: {}", e)))?;
    std::process::Command::new("open")
        .arg(&config_dir)
        .spawn()
        .map_err(|e| AppError::internal(format!("无法打开配置目录: {}", e)))?;
    Ok(())
}

#[tauri::command]
fn read_last_panic_log(app: tauri::AppHandle) -> Result<Option<String>, AppError> {
    let home_dir = app
        .path()
        .home_dir()
        .map_err(|e| AppError::internal(format!("无法读取用户目录: {}", e)))?;
    let log_dir = aether_log_dir(&home_dir);
    read_last_panic_log_from_dir(&log_dir, 64 * 1024)
        .map_err(|e| AppError::from_io(&e, panic_log_path(&log_dir).to_str(), format!("无法读取崩溃日志: {}", e)))
}

#[tauri::command]
fn start_window_drag(window: tauri::WebviewWindow) -> Result<(), AppError> {
    window
        .start_dragging()
        .map_err(|e| AppError::internal(format!("启动窗口拖拽失败: {}", e)))
}

/// 拖拽期间被源窗口频繁调用：把屏幕坐标下的非源窗口置顶。
/// 用于多窗口拖拽时让"底层窗口"自动浮到前面，看清放置提示。
///
/// - `screen_x` / `screen_y`：CSS 逻辑像素（DragEvent.screenX/screenY）
/// - `except_window`：源窗口 label，不会被 raise
///
/// 返回被 raise 的窗口 label（如有），便于前端 debug 与去重。
#[tauri::command]
fn raise_window_at(
    app: tauri::AppHandle,
    screen_x: f64,
    screen_y: f64,
    except_window: String,
) -> Result<Option<String>, AppError> {
    let windows = app.webview_windows();
    for (label, win) in windows.iter() {
        if label == &except_window { continue; }
        if label == "drag-preview" { continue; }
        let factor = win
            .scale_factor()
            .map_err(|e| AppError::internal(format!("读取窗口缩放失败: {}", e)))?;
        let pos = win
            .outer_position()
            .map_err(|e| AppError::internal(format!("读取窗口位置失败: {}", e)))?;
        let size = win
            .outer_size()
            .map_err(|e| AppError::internal(format!("读取窗口尺寸失败: {}", e)))?;
        let x0 = pos.x as f64 / factor;
        let y0 = pos.y as f64 / factor;
        let x1 = x0 + size.width as f64 / factor;
        let y1 = y0 + size.height as f64 / factor;
        if screen_x >= x0 && screen_x <= x1 && screen_y >= y0 && screen_y <= y1 {
            let already_focused = win.is_focused().unwrap_or(false);
            if !already_focused {
                let _ = win.set_focus();
            }
            return Ok(Some(label.clone()));
        }
    }
    Ok(None)
}

#[tauri::command]
fn debug_log(message: String) {
    println!("[DEBUG-dnd] {}", message);
}

#[tauri::command]
fn get_native_liquid_glass_status(app: tauri::AppHandle) -> LiquidGlassStatus {
    let supported = app.liquid_glass().is_supported();
    LiquidGlassStatus {
        requested: false,
        supported,
        applied: false,
        reason: if supported {
            None
        } else {
            Some("当前系统不支持原生 Liquid Glass，需要 macOS 26 或更新版本。".to_string())
        },
    }
}

#[tauri::command]
fn set_native_liquid_glass_enabled(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    enabled: bool,
    appearance: Option<String>,
) -> Result<LiquidGlassStatus, AppError> {
    let supported = app.liquid_glass().is_supported();

    if !enabled {
        app.liquid_glass()
            .set_effect(
                &window,
                LiquidGlassConfig {
                    enabled: false,
                    ..Default::default()
                },
            )
            .map_err(|e| AppError::internal(format!("关闭原生 Liquid Glass 失败: {}", e)))?;

        return Ok(LiquidGlassStatus {
            requested: false,
            supported,
            applied: false,
            reason: None,
        });
    }

    if !supported {
        return Ok(LiquidGlassStatus {
            requested: true,
            supported: false,
            applied: false,
            reason: Some("当前系统不支持原生 Liquid Glass，需要 macOS 26 或更新版本。".to_string()),
        });
    }

    let tint_color = match appearance.as_deref() {
        Some("dark") => "#080B1080",
        _ => "#ffffff10",
    };

    app.liquid_glass()
        .set_effect(
            &window,
            LiquidGlassConfig {
                enabled: true,
                corner_radius: 24.0,
                tint_color: Some(tint_color.to_string()),
                variant: GlassMaterialVariant::ControlCenter,
            },
        )
        .map_err(|e| AppError::internal(format!("启用原生 Liquid Glass 失败: {}", e)))?;

    Ok(LiquidGlassStatus {
        requested: true,
        supported: true,
        applied: true,
        reason: None,
    })
}

fn encode_query_component(value: &str) -> String {
    let mut encoded = String::new();
    for byte in value.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                encoded.push(byte as char)
            }
            _ => encoded.push_str(&format!("%{:02X}", byte)),
        }
    }
    encoded
}

#[tauri::command]
async fn create_app_window(
    app: tauri::AppHandle,
    initial_path: Option<String>,
    tab_label: Option<String>,
) -> Result<String, AppError> {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| AppError::internal(format!("生成窗口标识失败: {}", e)))?
        .as_millis();
    let label = format!("window-{}", now);

    let mut route = String::from("index.html");
    let mut params = Vec::new();
    if let Some(path) = initial_path.as_ref().filter(|path| !path.trim().is_empty()) {
        params.push(format!("path={}", encode_query_component(path)));
    }
    if let Some(label) = tab_label.as_ref().filter(|label| !label.trim().is_empty()) {
        params.push(format!("label={}", encode_query_component(label)));
    }
    if !params.is_empty() {
        route.push('?');
        route.push_str(&params.join("&"));
    }

    let window = WebviewWindowBuilder::new(&app, &label, WebviewUrl::App(route.into()))
        .title("Aether Explorer")
        .inner_size(1200.0, 800.0)
        .min_inner_size(900.0, 600.0)
        .resizable(true)
        .decorations(false)
        .transparent(true)
        .title_bar_style(TitleBarStyle::Overlay)
        .hidden_title(true)
        .build()
        .map_err(|e| AppError::internal(format!("创建窗口失败: {}", e)))?;

    let _ = window.show();
    let _ = window.set_focus();
    Ok(label)
}

#[tauri::command]
fn list_fonts() -> Result<Vec<String>, AppError> {
    let mut fonts = Vec::new();
    let font_dirs = [
        "/System/Library/Fonts",
        "/Library/Fonts",
    ];
    // User fonts
    if let Ok(home) = std::env::var("HOME") {
        let user_fonts = format!("{}/Library/Fonts", home);
        if Path::new(&user_fonts).exists() {
            for dir in &[user_fonts.as_str()] {
                if let Ok(entries) = fs::read_dir(dir) {
                    for entry in entries.flatten() {
                        let name = entry.file_name().to_string_lossy().to_string();
                        if name.ends_with(".ttf") || name.ends_with(".otf") || name.ends_with(".ttc") {
                            // Extract font family name from filename
                            let family = name
                                .rsplitn(2, '.')
                                .last()
                                .unwrap_or(&name)
                                .to_string();
                            if !fonts.contains(&family) {
                                fonts.push(family);
                            }
                        }
                    }
                }
            }
        }
    }
    for dir in &font_dirs {
        if let Ok(entries) = fs::read_dir(dir) {
            for entry in entries.flatten() {
                let name = entry.file_name().to_string_lossy().to_string();
                if name.ends_with(".ttf") || name.ends_with(".otf") || name.ends_with(".ttc") {
                    let family = name
                        .rsplitn(2, '.')
                        .last()
                        .unwrap_or(&name)
                        .to_string();
                    if !fonts.contains(&family) {
                        fonts.push(family);
                    }
                }
            }
        }
    }
    fonts.sort_by_key(|a| a.to_lowercase());
    Ok(fonts)
}

// ── File Operations ──

// 路径规范化 — 对用户输入的目标目录做 canonicalize。
// 防 `..` 跳逃 + 符号链接绕过 scope。失败说明路径不存在或无权限，直接返 Err。
fn safe_canonicalize(path: &Path) -> Result<std::path::PathBuf, AppError> {
    path.canonicalize()
        .map_err(|e| AppError::from_io(&e, Some(&path.to_string_lossy()), format!("路径解析失败: {}", e)))
}

fn unique_destination(path: &Path) -> std::path::PathBuf {
    if !path_exists_no_follow(path) {
        return path.to_path_buf();
    }

    let parent = path.parent().unwrap_or(Path::new("/"));
    let stem = path.file_stem().and_then(|s| s.to_str()).unwrap_or("copy");
    let ext = path.extension().and_then(|e| e.to_str());

    for i in 1..1000 {
        let suffix = if i == 1 { " copy".to_string() } else { format!(" copy {}", i) };
        let file_name = match ext {
            Some(ext) if !ext.is_empty() => format!("{}{}.{}", stem, suffix, ext),
            _ => format!("{}{}", stem, suffix),
        };
        let candidate = parent.join(file_name);
        if !path_exists_no_follow(&candidate) {
            return candidate;
        }
    }

    path.to_path_buf()
}

fn alias_duplicate_destination(path: &Path, is_dir: bool) -> Result<PathBuf, AppError> {
    let parent = path
        .parent()
        .ok_or_else(|| AppError::invalid_path("无法确定替身目标目录", Some(path.to_string_lossy().into_owned())))?;
    let name = path
        .file_name()
        .and_then(|s| s.to_str())
        .ok_or_else(|| AppError::invalid_path("无法确定替身名称", Some(path.to_string_lossy().into_owned())))?;

    let (stem, ext) = if is_dir {
        (name, None)
    } else {
        (
            path.file_stem().and_then(|s| s.to_str()).unwrap_or(name),
            path.extension().and_then(|s| s.to_str()),
        )
    };

    for index in 1..1000 {
        let suffix = if index == 1 {
            "-替身".to_string()
        } else {
            format!("-替身 {}", index)
        };
        let file_name = match ext {
            Some(ext) if !ext.is_empty() => format!("{}{}.{}", stem, suffix, ext),
            _ => format!("{}{}", stem, suffix),
        };
        let candidate = parent.join(file_name);
        if !path_exists_no_follow(&candidate) {
            return Ok(candidate);
        }
    }

    Err(AppError::internal_at("无法生成可用的替身名称", Some(path.to_string_lossy().into_owned())))
}

fn validate_child_name(name: &str) -> Result<String, AppError> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err(AppError::invalid_path("文件名不能为空", None));
    }
    if trimmed == "." || trimmed == ".." {
        return Err(AppError::invalid_path("文件名不能是 . 或 ..", Some(trimmed.to_string())));
    }
    if trimmed.contains('/') || trimmed.contains('\\') || trimmed.contains('\0') {
        return Err(AppError::invalid_path("文件名不能包含路径分隔符", Some(trimmed.to_string())));
    }
    if trimmed.chars().any(|c| c.is_control() || matches!(c, ':' | '*' | '?' | '"' | '<' | '>' | '|')) {
        return Err(AppError::invalid_path("文件名包含非法字符", Some(trimmed.to_string())));
    }

    let mut components = Path::new(trimmed).components();
    match (components.next(), components.next()) {
        (Some(Component::Normal(_)), None) => Ok(trimmed.to_string()),
        _ => Err(AppError::invalid_path("文件名必须是单个名称，不能是路径", Some(trimmed.to_string()))),
    }
}

fn replace_backup_path(path: &Path) -> PathBuf {
    let parent = path.parent().unwrap_or(Path::new("/"));
    let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("target");
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    parent.join(format!(".{}.aether-replace-backup-{}-{}", name, std::process::id(), now))
}

fn transfer_temp_path(path: &Path, label: &str) -> PathBuf {
    let parent = path.parent().unwrap_or(Path::new("/"));
    let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("target");
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    parent.join(format!(".{}.aether-{}-{}-{}", name, label, std::process::id(), now))
}

fn remove_path(path: &Path) -> std::io::Result<()> {
    let metadata = fs::symlink_metadata(path)?;
    if metadata.is_dir() && !metadata.file_type().is_symlink() {
        fs::remove_dir_all(path)
    } else {
        fs::remove_file(path)
    }
}

fn path_exists_no_follow(path: &Path) -> bool {
    fs::symlink_metadata(path).is_ok()
}

fn is_same_directory_no_follow(src: &Path, dst: &Path) -> bool {
    src.parent()
        .and_then(|parent| parent.canonicalize().ok())
        .is_some_and(|parent| parent == dst)
}

fn canonical_source_dir_for_recursion_check(src: &Path) -> Option<PathBuf> {
    let metadata = fs::symlink_metadata(src).ok()?;
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return None;
    }
    src.canonicalize().ok()
}

fn copy_symlink_with_progress(src: &Path, dst: &Path, progress: Option<&TransferProgress>) -> Result<(), String> {
    if let Some(progress) = progress {
        progress.check_cancelled()?;
    }
    let target = fs::read_link(src).map_err(|e| format!("读取符号链接失败: {}", e))?;
    unix_fs::symlink(&target, dst).map_err(|e| format!("创建符号链接失败: {}", e))?;
    if let Some(progress) = progress {
        progress.complete(1, 0);
    }
    Ok(())
}

fn copy_file_contents_with_progress(src: &Path, dst: &Path, progress: Option<&TransferProgress>) -> Result<(), String> {
    if let Some(progress) = progress {
        progress.check_cancelled()?;
    }
    let mut reader = fs::File::open(src).map_err(|e| format!("打开源文件失败: {}", e))?;
    let mut writer = fs::File::create(dst).map_err(|e| format!("创建目标文件失败: {}", e))?;
    let mut buffer = vec![0_u8; 1024 * 1024];

    loop {
        if let Some(progress) = progress {
            progress.check_cancelled()?;
        }
        let read = reader.read(&mut buffer).map_err(|e| format!("读取文件失败: {}", e))?;
        if read == 0 {
            break;
        }
        writer
            .write_all(&buffer[..read])
            .map_err(|e| format!("写入文件失败: {}", e))?;
        if let Some(progress) = progress {
            progress.complete(0, read as u64);
        }
    }

    if let Some(progress) = progress {
        progress.check_cancelled()?;
    }
    writer.flush().map_err(|e| format!("写入文件失败: {}", e))?;
    if let Some(progress) = progress {
        progress.complete(1, 0);
    }
    Ok(())
}

fn commit_staged_path(staged: &Path, dst: &Path, progress: Option<&TransferProgress>) -> Result<(), String> {
    if let Some(progress) = progress {
        if let Err(error) = progress.check_cancelled() {
            let _ = remove_path(staged);
            return Err(error);
        }
    }
    if path_exists_no_follow(dst) {
        let _ = remove_path(staged);
        return Err("目标已存在".into());
    }
    if let Err(error) = fs::rename(staged, dst) {
        let _ = remove_path(staged);
        return Err(format!("提交临时目标失败: {}", error));
    }
    Ok(())
}

fn copy_file_with_progress(src: &Path, dst: &Path, progress: Option<&TransferProgress>) -> Result<(), String> {
    let temp = transfer_temp_path(dst, "copy-temp");
    let copy_result = match fs::symlink_metadata(src) {
        Ok(metadata) if metadata.file_type().is_symlink() => copy_symlink_with_progress(src, &temp, progress),
        Ok(_) => copy_file_contents_with_progress(src, &temp, progress),
        Err(error) => Err(format!("读取源元数据失败: {}", error)),
    };

    if let Err(error) = copy_result {
        let _ = remove_path(&temp);
        return Err(error);
    }

    commit_staged_path(&temp, dst, progress)
}

fn copy_path_with_progress(src: &Path, dst: &Path, progress: Option<&TransferProgress>) -> Result<(), String> {
    if let Some(progress) = progress {
        progress.check_cancelled()?;
        progress.set_current(src);
    }

    let metadata = fs::symlink_metadata(src).map_err(|e| format!("读取源元数据失败: {}", e))?;
    if metadata.file_type().is_symlink() {
        copy_file_with_progress(src, dst, progress)
    } else if metadata.is_dir() {
        copy_dir_recursive_with_progress(src, dst, progress)
    } else {
        copy_file_with_progress(src, dst, progress)?;
        Ok(())
    }
}

fn restore_backup(backup: &Path, dst: &Path) -> Result<(), String> {
    if path_exists_no_follow(dst) {
        remove_path(dst).map_err(|e| format!("清理半成品目标失败: {}", e))?;
    }
    fs::rename(backup, dst).map_err(|e| format!("恢复原目标失败: {}", e))
}

#[cfg(test)]
fn replace_existing_for_copy(src: &Path, dst: &Path) -> Result<(), String> {
    replace_existing_for_copy_with_progress(src, dst, None)
}

fn replace_existing_for_copy_with_progress(src: &Path, dst: &Path, progress: Option<&TransferProgress>) -> Result<(), String> {
    if !path_exists_no_follow(dst) {
        return copy_path_with_progress(src, dst, progress);
    }

    let backup = replace_backup_path(dst);
    fs::rename(dst, &backup).map_err(|e| format!("备份原目标失败: {}", e))?;

    match copy_path_with_progress(src, dst, progress) {
        Ok(_) => {
            if let Err(e) = remove_path(&backup) {
                return Err(format!("清理原目标备份失败: {}", e));
            }
            Ok(())
        }
        Err(copy_err) => match restore_backup(&backup, dst) {
            Ok(_) => Err(copy_err),
            Err(restore_err) => Err(format!("{}；{}", copy_err, restore_err)),
        },
    }
}

enum MovePathOutcome {
    Moved,
    CopiedCrossDevice,
}

fn is_cross_device_rename_error(err: &std::io::Error) -> bool {
    matches!(err.raw_os_error(), Some(18))
}

fn rename_or_copy_cross_device(src: &Path, dst: &Path) -> Result<MovePathOutcome, String> {
    rename_or_copy_cross_device_with_progress(src, dst, None)
}

fn rename_or_copy_cross_device_with_progress(src: &Path, dst: &Path, progress: Option<&TransferProgress>) -> Result<MovePathOutcome, String> {
    if let Some(progress) = progress {
        progress.check_cancelled()?;
        progress.set_current(src);
    }

    match fs::rename(src, dst) {
        Ok(_) => {
            if let Some(progress) = progress {
                progress.complete_path_estimate(dst);
            }
            Ok(MovePathOutcome::Moved)
        }
        Err(e) if is_cross_device_rename_error(&e) => {
            copy_path_with_progress(src, dst, progress).map(|_| MovePathOutcome::CopiedCrossDevice)
        }
        Err(e) => Err(format!("{}", e)),
    }
}

#[cfg(test)]
fn replace_existing_for_move(src: &Path, dst: &Path) -> Result<MovePathOutcome, String> {
    replace_existing_for_move_with_progress(src, dst, None)
}

fn replace_existing_for_move_with_progress(src: &Path, dst: &Path, progress: Option<&TransferProgress>) -> Result<MovePathOutcome, String> {
    let backup = if path_exists_no_follow(dst) {
        let backup = replace_backup_path(dst);
        fs::rename(dst, &backup).map_err(|e| format!("备份原目标失败: {}", e))?;
        Some(backup)
    } else {
        None
    };

    let move_outcome = rename_or_copy_cross_device_with_progress(src, dst, progress);

    match move_outcome {
        Ok(outcome) => {
            if let Some(backup) = backup {
                if let Err(e) = remove_path(&backup) {
                    return Err(format!("清理原目标备份失败: {}", e));
                }
            }
            Ok(outcome)
        }
        Err(move_err) => {
            if let Some(backup) = backup {
                match restore_backup(&backup, dst) {
                    Ok(_) => Err(move_err),
                    Err(restore_err) => Err(format!("{}；{}", move_err, restore_err)),
                }
            } else {
                Err(move_err)
            }
        }
    }
}

#[cfg(test)]
fn copy_dir_recursive(src: &Path, dst: &Path) -> Result<(), String> {
    copy_dir_recursive_with_progress(src, dst, None)
}

fn copy_dir_recursive_with_progress(src: &Path, dst: &Path, progress: Option<&TransferProgress>) -> Result<(), String> {
    let temp = transfer_temp_path(dst, "copy-dir-temp");
    let copy_result = copy_dir_recursive_contents_with_progress(src, &temp, progress);
    if let Err(error) = copy_result {
        let _ = remove_path(&temp);
        return Err(error);
    }
    commit_staged_path(&temp, dst, progress)
}

fn copy_dir_recursive_contents_with_progress(src: &Path, dst: &Path, progress: Option<&TransferProgress>) -> Result<(), String> {
    if let Some(progress) = progress {
        progress.check_cancelled()?;
        progress.set_current(src);
    }

    fs::create_dir_all(dst).map_err(|e| format!("创建目标目录失败: {}", e))?;
    if let Some(progress) = progress {
        progress.complete_one(0);
    }

    for entry in fs::read_dir(src).map_err(|e| format!("读取目录失败: {}", e))? {
        let entry = entry.map_err(|e| format!("读取条目失败: {}", e))?;
        let src_path = entry.path();
        let dst_path = dst.join(entry.file_name());
        let metadata = fs::symlink_metadata(&src_path).map_err(|e| format!("读取源元数据失败: {}", e))?;
        if metadata.file_type().is_symlink() {
            copy_symlink_with_progress(&src_path, &dst_path, progress)
                .map_err(|e| format!("复制符号链接失败: {}", e))?;
        } else if metadata.is_dir() {
            copy_dir_recursive_contents_with_progress(&src_path, &dst_path, progress)?;
        } else {
            if let Some(progress) = progress {
                progress.check_cancelled()?;
                progress.set_current(&src_path);
            }
            copy_file_contents_with_progress(&src_path, &dst_path, progress)
                .map_err(|e| format!("复制文件失败: {}", e))?;
        }
    }
    Ok(())
}

#[tauri::command]
fn copy_file(src: String, dst: String) -> Result<String, AppError> {
    let src_path = Path::new(&src);
    let name = src_path.file_name().unwrap_or_default().to_string_lossy();
    let dst_path = unique_destination(&Path::new(&dst).join(name.as_ref()));
    copy_path_with_progress(src_path, &dst_path, None)
        .map_err(|e| AppError::internal_at(e, Some(src.clone())))?;
    Ok(dst_path.to_string_lossy().into())
}

#[tauri::command]
fn move_file(src: String, dst_dir: String) -> Result<String, AppError> {
    let src_path = Path::new(&src);
    let name = src_path.file_name().unwrap_or_default().to_string_lossy();
    let dst_path = unique_destination(&Path::new(&dst_dir).join(name.as_ref()));
    rename_or_copy_cross_device(src_path, &dst_path)
        .map_err(|e| AppError::internal_at(format!("移动失败: {}", e), Some(src.clone())))?;
    Ok(dst_path.to_string_lossy().into())
}

#[tauri::command]
fn set_file_clipboard(
    state: tauri::State<FileClipboardState>,
    paths: Vec<String>,
    cut: bool,
) -> Result<(), AppError> {
    let mut clipboard = state.0.lock().map_err(|_| AppError::unavailable("文件剪贴板不可用"))?;
    *clipboard = if paths.is_empty() {
        None
    } else {
        Some(FileTransferPayload {
            paths,
            cut,
            source_window: None,
            transfer_id: None,
            preview_name: None,
            count: None,
        })
    };
    Ok(())
}

#[tauri::command]
fn get_file_clipboard(
    state: tauri::State<FileClipboardState>,
) -> Result<Option<FileTransferPayload>, AppError> {
    let clipboard = state.0.lock().map_err(|_| AppError::unavailable("文件剪贴板不可用"))?;
    Ok(clipboard.clone())
}

#[tauri::command]
fn clear_file_clipboard(state: tauri::State<FileClipboardState>) -> Result<(), AppError> {
    let mut clipboard = state.0.lock().map_err(|_| AppError::unavailable("文件剪贴板不可用"))?;
    *clipboard = None;
    Ok(())
}

#[tauri::command]
fn set_file_drag_payload(
    state: tauri::State<FileDragState>,
    paths: Vec<String>,
    cut: bool,
    source_window: Option<String>,
    transfer_id: Option<String>,
    preview_name: Option<String>,
    count: Option<u32>,
) -> Result<(), AppError> {
    let mut drag_payload = state.0.lock().map_err(|_| AppError::unavailable("文件拖拽状态不可用"))?;
    *drag_payload = if paths.is_empty() {
        None
    } else {
        Some(FileTransferPayload {
            paths,
            cut,
            source_window,
            transfer_id,
            preview_name,
            count,
        })
    };
    Ok(())
}

#[tauri::command]
fn get_file_drag_payload(
    state: tauri::State<FileDragState>,
) -> Result<Option<FileTransferPayload>, AppError> {
    let drag_payload = state.0.lock().map_err(|_| AppError::unavailable("文件拖拽状态不可用"))?;
    Ok(drag_payload.clone())
}

#[tauri::command]
fn clear_file_drag_payload(state: tauri::State<FileDragState>) -> Result<(), AppError> {
    let mut drag_payload = state.0.lock().map_err(|_| AppError::unavailable("文件拖拽状态不可用"))?;
    *drag_payload = None;
    Ok(())
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct MoveFailure {
    src: String,
    error: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct MoveConflict {
    src: String,
    dst: String,
    name: String,
}

#[derive(Debug, Deserialize, Clone, Copy)]
#[serde(rename_all = "camelCase")]
enum MoveConflictStrategy {
    Abort,
    Replace,
    KeepBoth,
    Skip,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct MoveResult {
    moved: Vec<String>,
    copied_cross_device: Vec<String>,
    failed: Vec<MoveFailure>,
    conflicts: Vec<MoveConflict>,
    skipped_same_dir: u32,
    skipped_conflicts: u32,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct CopyResult {
    copied: Vec<String>,
    failed: Vec<MoveFailure>,
    conflicts: Vec<MoveConflict>,
    skipped_conflicts: u32,
}

fn find_copy_conflicts(srcs: &[String], dst: &Path) -> Vec<MoveConflict> {
    let mut conflicts = Vec::new();
    for src in srcs {
        let src_path = Path::new(src);
        if !path_exists_no_follow(src_path) {
            continue;
        }

        let name = src_path.file_name().unwrap_or_default().to_string_lossy();
        let dst_path = dst.join(name.as_ref());
        if path_exists_no_follow(&dst_path) {
            conflicts.push(MoveConflict {
                src: src.clone(),
                dst: dst_path.to_string_lossy().into(),
                name: name.into(),
            });
        }
    }
    conflicts
}

fn find_move_conflicts(srcs: &[String], dst: &Path) -> Vec<MoveConflict> {
    let mut conflicts = Vec::new();
    for src in srcs {
        let src_path = Path::new(src);
        if !path_exists_no_follow(src_path) {
            continue;
        }

        if is_same_directory_no_follow(src_path, dst) {
            continue;
        }

        let name = src_path.file_name().unwrap_or_default().to_string_lossy();
        let dst_path = dst.join(name.as_ref());
        if path_exists_no_follow(&dst_path) {
            conflicts.push(MoveConflict {
                src: src.clone(),
                dst: dst_path.to_string_lossy().into(),
                name: name.into(),
            });
        }
    }
    conflicts
}

fn copy_files_impl(
    srcs: Vec<String>,
    dst_dir: String,
    conflict_strategy: Option<MoveConflictStrategy>,
    progress: Option<&TransferProgress>,
) -> Result<CopyResult, AppError> {
    let dst_buf = safe_canonicalize(Path::new(&dst_dir))?;
    let dst = dst_buf.as_path();
    if !dst.is_dir() {
        return Err(AppError::invalid_path("目标不是目录", Some(dst_dir)));
    }

    let conflict_strategy = conflict_strategy.unwrap_or(MoveConflictStrategy::Abort);
    let mut copied: Vec<String> = Vec::new();
    let mut failed: Vec<MoveFailure> = Vec::new();
    let mut conflicts: Vec<MoveConflict> = Vec::new();
    let mut skipped_conflicts: u32 = 0;

    if matches!(conflict_strategy, MoveConflictStrategy::Abort) {
        conflicts = find_copy_conflicts(&srcs, dst);
        if !conflicts.is_empty() {
            return Ok(CopyResult { copied, failed, conflicts, skipped_conflicts });
        }
    }

    for src in srcs {
        if let Some(progress) = progress {
            if let Err(error) = progress.check_cancelled() {
                failed.push(MoveFailure { src: src.clone(), error });
                break;
            }
        }

        let src_path = Path::new(&src);

        if !path_exists_no_follow(src_path) {
            failed.push(MoveFailure { src: src.clone(), error: "源不存在".into() });
            continue;
        }

        if let Some(src_canonical) = canonical_source_dir_for_recursion_check(src_path) {
            if dst == src_canonical || dst.starts_with(&src_canonical) {
                failed.push(MoveFailure {
                    src: src.clone(),
                    error: "目标在源目录内".into(),
                });
                continue;
            }
        }

        let name = src_path.file_name().unwrap_or_default().to_string_lossy();
        let base_dst_path = dst.join(name.as_ref());
        if matches!(conflict_strategy, MoveConflictStrategy::Skip) && path_exists_no_follow(&base_dst_path) {
            skipped_conflicts += 1;
            continue;
        }
        let dst_path = match conflict_strategy {
            MoveConflictStrategy::Abort => base_dst_path,
            MoveConflictStrategy::KeepBoth => unique_destination(&base_dst_path),
            MoveConflictStrategy::Replace => base_dst_path,
            MoveConflictStrategy::Skip => base_dst_path,
        };

        let copy_outcome = if matches!(conflict_strategy, MoveConflictStrategy::Replace) {
            if dst_path == src_path {
                Err("不能替换自身".into())
            } else {
                replace_existing_for_copy_with_progress(src_path, &dst_path, progress)
            }
        } else {
            copy_path_with_progress(src_path, &dst_path, progress)
        };

        match copy_outcome {
            Ok(_) => copied.push(dst_path.to_string_lossy().into()),
            Err(e) => failed.push(MoveFailure { src: src.clone(), error: e }),
        }
    }

    Ok(CopyResult { copied, failed, conflicts, skipped_conflicts })
}

#[tauri::command]
fn copy_files(
    srcs: Vec<String>,
    dst_dir: String,
    conflict_strategy: Option<MoveConflictStrategy>,
) -> Result<CopyResult, AppError> {
    copy_files_impl(srcs, dst_dir, conflict_strategy, None)
}

#[tauri::command]
fn preview_copy_file_conflicts(srcs: Vec<String>, dst_dir: String) -> Result<Vec<MoveConflict>, AppError> {
    let dst_buf = safe_canonicalize(Path::new(&dst_dir))?;
    let dst = dst_buf.as_path();
    if !dst.is_dir() {
        return Err(AppError::invalid_path("目标不是目录", Some(dst_dir)));
    }
    Ok(find_copy_conflicts(&srcs, dst))
}

fn move_files_impl(
    srcs: Vec<String>,
    dst_dir: String,
    conflict_strategy: Option<MoveConflictStrategy>,
    progress: Option<&TransferProgress>,
) -> Result<MoveResult, AppError> {
    let dst_buf = safe_canonicalize(Path::new(&dst_dir))?;
    let dst = dst_buf.as_path();
    if !dst.is_dir() {
        return Err(AppError::invalid_path("目标不是目录", Some(dst_dir)));
    }

    let conflict_strategy = conflict_strategy.unwrap_or(MoveConflictStrategy::Abort);
    let mut moved: Vec<String> = Vec::new();
    let mut copied_cross_device: Vec<String> = Vec::new();
    let mut failed: Vec<MoveFailure> = Vec::new();
    let mut conflicts: Vec<MoveConflict> = Vec::new();
    let mut skipped_same_dir: u32 = 0;
    let mut skipped_conflicts: u32 = 0;

    if matches!(conflict_strategy, MoveConflictStrategy::Abort) {
        conflicts = find_move_conflicts(&srcs, dst);
        if !conflicts.is_empty() {
            return Ok(MoveResult { moved, copied_cross_device, failed, conflicts, skipped_same_dir, skipped_conflicts });
        }
    }

    for src in srcs {
        if let Some(progress) = progress {
            if let Err(error) = progress.check_cancelled() {
                failed.push(MoveFailure { src: src.clone(), error });
                break;
            }
        }

        let src_path = Path::new(&src);

        if !path_exists_no_follow(src_path) {
            failed.push(MoveFailure { src: src.clone(), error: "源不存在".into() });
            continue;
        }

        if is_same_directory_no_follow(src_path, dst) {
            skipped_same_dir += 1;
            continue;
        }

        if let Some(src_canonical) = canonical_source_dir_for_recursion_check(src_path) {
            if dst == src_canonical || dst.starts_with(&src_canonical) {
                failed.push(MoveFailure {
                    src: src.clone(),
                    error: "目标在源目录内".into(),
                });
                continue;
            }
        }

        let name = src_path.file_name().unwrap_or_default().to_string_lossy();
        let base_dst_path = dst.join(name.as_ref());
        if matches!(conflict_strategy, MoveConflictStrategy::Skip) && path_exists_no_follow(&base_dst_path) {
            skipped_conflicts += 1;
            continue;
        }
        let dst_path = match conflict_strategy {
            MoveConflictStrategy::Abort => base_dst_path,
            MoveConflictStrategy::KeepBoth => unique_destination(&base_dst_path),
            MoveConflictStrategy::Replace => base_dst_path,
            MoveConflictStrategy::Skip => base_dst_path,
        };

        let move_outcome = if matches!(conflict_strategy, MoveConflictStrategy::Replace) {
            replace_existing_for_move_with_progress(src_path, &dst_path, progress)
        } else {
            rename_or_copy_cross_device_with_progress(src_path, &dst_path, progress)
        };

        match move_outcome {
            Ok(MovePathOutcome::Moved) => moved.push(dst_path.to_string_lossy().into()),
            Ok(MovePathOutcome::CopiedCrossDevice) => copied_cross_device.push(dst_path.to_string_lossy().into()),
            Err(e) => failed.push(MoveFailure { src: src.clone(), error: e }),
        }
    }

    Ok(MoveResult { moved, copied_cross_device, failed, conflicts, skipped_same_dir, skipped_conflicts })
}

#[tauri::command]
fn move_files(
    srcs: Vec<String>,
    dst_dir: String,
    conflict_strategy: Option<MoveConflictStrategy>,
) -> Result<MoveResult, AppError> {
    move_files_impl(srcs, dst_dir, conflict_strategy, None)
}

#[tauri::command]
fn preview_move_file_conflicts(srcs: Vec<String>, dst_dir: String) -> Result<Vec<MoveConflict>, AppError> {
    let dst_buf = safe_canonicalize(Path::new(&dst_dir))?;
    let dst = dst_buf.as_path();
    if !dst.is_dir() {
        return Err(AppError::invalid_path("目标不是目录", Some(dst_dir)));
    }
    Ok(find_move_conflicts(&srcs, dst))
}

fn create_transfer_task(
    state: &TransferTaskState,
    kind: &str,
    srcs: &[String],
) -> Result<(String, Arc<AtomicBool>), AppError> {
    let estimate = estimate_transfer_paths(srcs);
    let id = next_transfer_task_id(kind);
    let cancel_requested = Arc::new(AtomicBool::new(false));
    state.insert(
        TransferTaskSnapshot {
            id: id.clone(),
            kind: kind.to_string(),
            status: "queued".into(),
            total_items: estimate.items,
            completed_items: 0,
            total_bytes: estimate.bytes,
            completed_bytes: 0,
            current_name: None,
            error: None,
            started_at: now_unix_seconds(),
            finished_at: None,
            copied: 0,
            moved: 0,
            copied_cross_device: 0,
            failed: 0,
            conflicts: 0,
            skipped: 0,
            skipped_same_dir: 0,
            skipped_conflicts: 0,
        },
        cancel_requested.clone(),
    )?;
    Ok((id, cancel_requested))
}

fn finish_copy_transfer_task(state: &TransferTaskState, task_id: &str, result: Result<CopyResult, AppError>) {
    match result {
        Ok(result) => {
            let error = summarize_transfer_error(&result.failed, &result.conflicts);
            let was_cancelled = result.failed.iter().any(|failure| failure.error.contains("取消"));
            let status = if error.is_some() {
                if was_cancelled {
                    "cancelled"
                } else {
                    "failed"
                }
            } else {
                "completed"
            };
            state.update(task_id, |snapshot| {
                snapshot.copied = result.copied.len() as u64;
                snapshot.failed = result.failed.len() as u64;
                snapshot.conflicts = result.conflicts.len() as u64;
                snapshot.skipped = result.skipped_conflicts as u64;
                snapshot.skipped_same_dir = 0;
                snapshot.skipped_conflicts = result.skipped_conflicts as u64;
                if snapshot.status == "cancelling" && was_cancelled {
                    snapshot.status = "cancelled".into();
                    snapshot.error = Some("操作已取消".into());
                    snapshot.finished_at = Some(now_unix_seconds());
                    return;
                }
                snapshot.status = status.into();
                snapshot.error = error;
                snapshot.finished_at = Some(now_unix_seconds());
                if snapshot.status == "completed" {
                    snapshot.completed_items = snapshot.total_items;
                    snapshot.completed_bytes = snapshot.total_bytes;
                }
            });
        }
        Err(error) => {
            state.update(task_id, |snapshot| {
                if snapshot.status == "cancelling" {
                    snapshot.status = "cancelled".into();
                    snapshot.error = Some("操作已取消".into());
                    snapshot.finished_at = Some(now_unix_seconds());
                    return;
                }
                snapshot.status = "failed".into();
                snapshot.error = Some(error.message);
                snapshot.finished_at = Some(now_unix_seconds());
            });
        }
    }
}

fn finish_move_transfer_task(state: &TransferTaskState, task_id: &str, result: Result<MoveResult, AppError>) {
    match result {
        Ok(result) => {
            let error = summarize_transfer_error(&result.failed, &result.conflicts);
            let was_cancelled = result.failed.iter().any(|failure| failure.error.contains("取消"));
            let status = if error.is_some() {
                if was_cancelled {
                    "cancelled"
                } else {
                    "failed"
                }
            } else {
                "completed"
            };
            state.update(task_id, |snapshot| {
                snapshot.moved = result.moved.len() as u64;
                snapshot.copied_cross_device = result.copied_cross_device.len() as u64;
                snapshot.failed = result.failed.len() as u64;
                snapshot.conflicts = result.conflicts.len() as u64;
                snapshot.skipped = result.skipped_same_dir.saturating_add(result.skipped_conflicts) as u64;
                snapshot.skipped_same_dir = result.skipped_same_dir as u64;
                snapshot.skipped_conflicts = result.skipped_conflicts as u64;
                if snapshot.status == "cancelling" && was_cancelled {
                    snapshot.status = "cancelled".into();
                    snapshot.error = Some("操作已取消".into());
                    snapshot.finished_at = Some(now_unix_seconds());
                    return;
                }
                snapshot.status = status.into();
                snapshot.error = error;
                snapshot.finished_at = Some(now_unix_seconds());
                if snapshot.status == "completed" {
                    snapshot.completed_items = snapshot.total_items;
                    snapshot.completed_bytes = snapshot.total_bytes;
                }
            });
        }
        Err(error) => {
            state.update(task_id, |snapshot| {
                if snapshot.status == "cancelling" {
                    snapshot.status = "cancelled".into();
                    snapshot.error = Some("操作已取消".into());
                    snapshot.finished_at = Some(now_unix_seconds());
                    return;
                }
                snapshot.status = "failed".into();
                snapshot.error = Some(error.message);
                snapshot.finished_at = Some(now_unix_seconds());
            });
        }
    }
}

#[tauri::command]
fn start_copy_files_task(
    state: tauri::State<TransferTaskState>,
    srcs: Vec<String>,
    dst_dir: String,
    conflict_strategy: Option<MoveConflictStrategy>,
) -> Result<String, AppError> {
    let state = state.inner().clone();
    let (task_id, cancel_requested) = create_transfer_task(&state, "copy", &srcs)?;
    let progress = TransferProgress {
        task_id: task_id.clone(),
        state: state.clone(),
        cancel_requested,
    };
    let task_id_for_worker = task_id.clone();

    tauri::async_runtime::spawn_blocking(move || {
        state.update(&task_id_for_worker, |snapshot| {
            if snapshot.status == "queued" {
                snapshot.status = "running".into();
            }
        });
        let result = copy_files_impl(srcs, dst_dir, conflict_strategy, Some(&progress));
        finish_copy_transfer_task(&state, &task_id_for_worker, result);
    });

    Ok(task_id)
}

#[tauri::command]
fn start_move_files_task(
    state: tauri::State<TransferTaskState>,
    srcs: Vec<String>,
    dst_dir: String,
    conflict_strategy: Option<MoveConflictStrategy>,
) -> Result<String, AppError> {
    let state = state.inner().clone();
    let (task_id, cancel_requested) = create_transfer_task(&state, "move", &srcs)?;
    let progress = TransferProgress {
        task_id: task_id.clone(),
        state: state.clone(),
        cancel_requested,
    };
    let task_id_for_worker = task_id.clone();

    tauri::async_runtime::spawn_blocking(move || {
        state.update(&task_id_for_worker, |snapshot| {
            if snapshot.status == "queued" {
                snapshot.status = "running".into();
            }
        });
        let result = move_files_impl(srcs, dst_dir, conflict_strategy, Some(&progress));
        finish_move_transfer_task(&state, &task_id_for_worker, result);
    });

    Ok(task_id)
}

#[tauri::command]
fn list_transfer_tasks(state: tauri::State<TransferTaskState>) -> Result<Vec<TransferTaskSnapshot>, AppError> {
    state.list()
}

#[tauri::command]
fn cancel_transfer_task(state: tauri::State<TransferTaskState>, task_id: String) -> Result<(), AppError> {
    let mut tasks = state.0.lock().map_err(|_| AppError::unavailable("传输任务状态不可用"))?;
    let task = tasks
        .get_mut(&task_id)
        .ok_or_else(|| AppError::invalid_path("传输任务不存在", Some(task_id.clone())))?;

    task.cancel_requested.store(true, Ordering::SeqCst);
    if matches!(task.snapshot.status.as_str(), "queued" | "running") {
        task.snapshot.status = "cancelling".into();
        task.snapshot.error = Some("正在取消".into());
    }
    Ok(())
}

#[tauri::command]
fn clear_finished_transfer_tasks(state: tauri::State<TransferTaskState>) -> Result<(), AppError> {
    let mut tasks = state.0.lock().map_err(|_| AppError::unavailable("传输任务状态不可用"))?;
    let now = now_unix_seconds();
    tasks.retain(|_, task| should_retain_transfer_task_after_clear(&task.snapshot, now));
    Ok(())
}

fn should_retain_transfer_task_after_clear(snapshot: &TransferTaskSnapshot, now: u64) -> bool {
    if !is_terminal_transfer_status(&snapshot.status) {
        return true;
    }
    let Some(finished_at) = snapshot.finished_at else {
        return false;
    };
    now.saturating_sub(finished_at) < FINISHED_TRANSFER_TASK_RETENTION_SECONDS
}

#[tauri::command]
fn rename_file(path: String, new_name: String) -> Result<String, AppError> {
    let new_name = validate_child_name(&new_name)?;
    let parent = Path::new(&path).parent().unwrap_or(Path::new("/"));
    let new_path = parent.join(&new_name);
    fs::rename(&path, &new_path)
        .map_err(|e| AppError::from_io(&e, Some(&path), format!("重命名失败: {}", e)))?;
    Ok(new_path.to_string_lossy().into())
}

#[tauri::command]
fn delete_to_trash(path: String) -> Result<(), AppError> {
    trash::delete(&path)
        .map_err(|e| trash_delete_error(&path, e.to_string()))
}

fn trash_delete_error(path: &str, error: impl Into<String>) -> AppError {
    let detail = error.into();
    if path.starts_with("/Volumes/") {
        return AppError::trash_unsupported(
            format!(
                "该外置卷无法移至废纸篓，操作已取消；Aether 不会改用永久删除。原始错误: {}",
                detail
            ),
            Some(path.to_string()),
        );
    }

    AppError::internal_at(format!("移至废纸篓失败: {}", detail), Some(path.to_string()))
}

#[tauri::command]
fn create_file(parent_dir: String, name: String) -> Result<String, AppError> {
    let name = validate_child_name(&name)?;
    let file_path = unique_destination(&Path::new(&parent_dir).join(&name));
    fs::write(&file_path, "")
        .map_err(|e| AppError::from_io(&e, Some(&file_path.to_string_lossy()), format!("创建文件失败: {}", e)))?;
    Ok(file_path.to_string_lossy().into())
}

#[tauri::command]
fn create_folder(parent_dir: String, name: String) -> Result<String, AppError> {
    let name = validate_child_name(&name)?;
    let dir_path = unique_destination(&Path::new(&parent_dir).join(&name));
    fs::create_dir(&dir_path)
        .map_err(|e| AppError::from_io(&e, Some(&dir_path.to_string_lossy()), format!("创建文件夹失败: {}", e)))?;
    Ok(dir_path.to_string_lossy().into())
}

#[tauri::command]
fn duplicate_as_alias(path: String) -> Result<String, AppError> {
    let src_path = Path::new(&path);
    let metadata = fs::symlink_metadata(src_path)
        .map_err(|e| AppError::from_io(&e, Some(&path), format!("读取源元数据失败: {}", e)))?;
    let dst_path = alias_duplicate_destination(src_path, metadata.is_dir() && !metadata.file_type().is_symlink())?;

    copy_path_with_progress(src_path, &dst_path, None)
        .map_err(|e| AppError::internal_at(format!("创建替身失败: {}", e), Some(path.clone())))?;

    Ok(dst_path.to_string_lossy().into())
}

#[tauri::command]
fn compress_files(paths: Vec<String>, output: String) -> Result<String, AppError> {
    let file = fs::File::create(&output)
        .map_err(|e| AppError::from_io(&e, Some(&output), format!("创建压缩文件失败: {}", e)))?;
    let mut zip_writer = zip::ZipWriter::new(file);
    let options = zip::write::SimpleFileOptions::default();

    for path_str in &paths {
        let p = Path::new(path_str);
        if p.is_dir() {
            add_dir_to_zip(&mut zip_writer, p, p, options)?;
        } else if p.is_file() {
            let name = p.file_name().unwrap_or_default().to_string_lossy();
            zip_writer
                .start_file(name.as_ref(), options)
                .map_err(|e| AppError::internal_at(format!("压缩失败: {}", e), Some(path_str.clone())))?;
            let mut input = fs::File::open(p)
                .map_err(|e| AppError::from_io(&e, Some(path_str), format!("读取文件失败: {}", e)))?;
            std::io::copy(&mut input, &mut zip_writer)
                .map_err(|e| AppError::from_io(&e, Some(path_str), format!("写入压缩失败: {}", e)))?;
        }
    }

    zip_writer.finish()
        .map_err(|e| AppError::internal_at(format!("完成压缩失败: {}", e), Some(output.clone())))?;
    Ok(output)
}

#[tauri::command]
fn decompress_file(path: String, output_dir: String) -> Result<String, AppError> {
    let file = fs::File::open(&path)
        .map_err(|e| AppError::from_io(&e, Some(&path), format!("打开压缩文件失败: {}", e)))?;
    let mut archive = zip::ZipArchive::new(file)
        .map_err(|e| AppError::internal(format!("读取压缩文件失败: {}", e)))?;
    let output_root = Path::new(&output_dir);
    let mut planned_files = std::collections::HashSet::new();

    for i in 0..archive.len() {
        let entry = archive.by_index(i)
            .map_err(|e| AppError::internal(format!("读取条目失败: {}", e)))?;
        let enclosed = entry
            .enclosed_name()
            .ok_or_else(|| AppError::invalid_path(
                format!("压缩包包含不安全路径: {}", entry.name()),
                Some(entry.name().to_string()),
            ))?;
        if entry.is_dir() {
            continue;
        }

        let out_path = output_root.join(enclosed);
        if !planned_files.insert(out_path.clone()) {
            return Err(AppError::conflict(
                "压缩包包含重复条目",
                Some(out_path.to_string_lossy().to_string()),
            ));
        }
        if out_path.exists() {
            return Err(AppError::conflict(
                "解压目标已存在，已停止以避免覆盖",
                Some(out_path.to_string_lossy().to_string()),
            ));
        }
    }

    for i in 0..archive.len() {
        let mut entry = archive.by_index(i)
            .map_err(|e| AppError::internal(format!("读取条目失败: {}", e)))?;
        let enclosed = entry
            .enclosed_name()
            .ok_or_else(|| AppError::invalid_path(
                format!("压缩包包含不安全路径: {}", entry.name()),
                Some(entry.name().to_string()),
            ))?;
        let out_path = output_root.join(enclosed);

        if entry.is_dir() {
            fs::create_dir_all(&out_path).ok();
        } else {
            if let Some(parent) = out_path.parent() {
                fs::create_dir_all(parent).ok();
            }
            let mut out_file = fs::File::create(&out_path)
                .map_err(|e| AppError::from_io(&e, Some(&out_path.to_string_lossy()), format!("创建解压文件失败: {}", e)))?;
            std::io::copy(&mut entry, &mut out_file)
                .map_err(|e| AppError::from_io(&e, Some(&out_path.to_string_lossy()), format!("解压写入失败: {}", e)))?;
        }
    }

    Ok(output_dir)
}

#[derive(Debug, Default, Clone, PartialEq, Eq)]
struct DirectorySizeSummary {
    bytes: u64,
    allocated_bytes: u64,
    file_count: u64,
    skipped_count: u64,
}

fn dir_size_recursive(dir: &Path) -> DirectorySizeSummary {
    let mut summary = DirectorySizeSummary::default();
    let mut stack: Vec<std::path::PathBuf> = vec![dir.to_path_buf()];

    while let Some(current) = stack.pop() {
        let entries = match fs::read_dir(&current) {
            Ok(entries) => entries,
            Err(_) => {
                summary.skipped_count = summary.skipped_count.saturating_add(1);
                continue;
            }
        };
        for entry in entries {
            let entry = match entry {
                Ok(e) => e,
                Err(_) => {
                    summary.skipped_count = summary.skipped_count.saturating_add(1);
                    continue;
                }
            };
            let path = entry.path();
            match fs::symlink_metadata(&path) {
                Ok(meta) => {
                    let file_type = meta.file_type();
                    if file_type.is_symlink() {
                        summary.skipped_count = summary.skipped_count.saturating_add(1);
                    } else if file_type.is_dir() {
                        stack.push(path);
                    } else {
                        summary.bytes = summary.bytes.saturating_add(meta.len());
                        summary.allocated_bytes = summary
                            .allocated_bytes
                            .saturating_add(meta.blocks().saturating_mul(512));
                        summary.file_count = summary.file_count.saturating_add(1);
                    }
                }
                Err(_) => {
                    summary.skipped_count = summary.skipped_count.saturating_add(1);
                }
            }
        }
    }
    summary
}

#[tauri::command]
fn get_dir_size(path: String) -> Result<serde_json::Value, AppError> {
    let dir = Path::new(&path);
    if !dir.is_dir() {
        return Err(AppError::invalid_path("不是一个目录", Some(path)));
    }
    let summary = dir_size_recursive(dir);
    Ok(serde_json::json!({
        "path": path,
        "bytes": summary.bytes,
        "formatted": format_size(summary.bytes),
        "allocated_bytes": summary.allocated_bytes,
        "formatted_allocated": format_size(summary.allocated_bytes),
        "file_count": summary.file_count,
        "skipped_count": summary.skipped_count
    }))
}

/// 按需查目录的直接子项数（PERF_PLAN L2-B 配套）。
/// 前端建议加 TTL 缓存避免重复调用。
#[tauri::command]
fn get_child_count(path: String, show_hidden: bool) -> Result<u64, AppError> {
    let p = Path::new(&path);
    if !p.is_dir() {
        return Ok(0);
    }
    let count = fs::read_dir(p)
        .map_err(|e| AppError::from_io(&e, Some(&path), format!("读取目录失败: {}", e)))?
        .flatten()
            .filter(|e| {
                if show_hidden { true }
                else { e.file_name().to_str().map(|n| !n.starts_with('.')).unwrap_or(true) }
            })
            .count() as u64;
    Ok(count)
}

fn directory_signature_for_path(path: &str, show_hidden: bool) -> Result<DirectorySignature, AppError> {
    let dir = Path::new(path);
    if !dir.is_dir() {
        return Err(AppError::invalid_path("不是一个目录", Some(path.to_string())));
    }

    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    let mut entry_count = 0_u64;
    let mut entries = fs::read_dir(dir)
        .map_err(|e| AppError::from_io(&e, Some(path), format!("读取目录失败: {}", e)))?
        .flatten()
        .filter(|entry| {
            if show_hidden {
                true
            } else {
                entry
                    .file_name()
                    .to_str()
                    .map(|name| !name.starts_with('.'))
                    .unwrap_or(true)
            }
        })
        .map(|entry| {
            let name = entry.file_name().to_string_lossy().to_string();
            let metadata = entry.metadata().ok();
            let is_dir = metadata.as_ref().map(|m| m.is_dir()).unwrap_or(false);
            let len = metadata.as_ref().map(|m| m.len()).unwrap_or(0);
            let modified = metadata
                .and_then(|m| m.modified().ok())
                .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
                .map(|duration| duration.as_nanos())
                .unwrap_or(0);
            (name, is_dir, len, modified)
        })
        .collect::<Vec<_>>();

    entries.sort_by_key(|a| a.0.to_lowercase());
    for entry in entries {
        entry_count += 1;
        entry.hash(&mut hasher);
    }

    Ok(DirectorySignature {
        fingerprint: format!("{:016x}", hasher.finish()),
        entry_count,
    })
}

#[tauri::command]
fn get_directory_signature(path: String, show_hidden: bool) -> Result<DirectorySignature, AppError> {
    directory_signature_for_path(&path, show_hidden)
}

#[tauri::command]
fn get_file_info(path: String) -> Result<FileEntry, AppError> {
    let p = Path::new(&path);
    let name = p.file_name().unwrap_or_default().to_string_lossy().to_string();
    let metadata = fs::metadata(&path)
        .map_err(|e| AppError::from_io(&e, Some(&path), format!("读取元数据失败: {}", e)))?;
    let is_dir = metadata.is_dir();
    let size = if is_dir { "--".into() } else { format_size(metadata.len()) };
    let modified = format_modified(&metadata);
    let created = format_system_time(metadata.created().ok());
    let added = read_mdls_date(p, "kMDItemDateAdded");
    let last_opened = read_mdls_date(p, "kMDItemLastUsedDate");
    let file_type = detect_mime(&name, is_dir);
    let icon_path = if file_type == "application" {
        resolve_app_icon_png(p)
    } else {
        None
    };
    let child_count = if is_dir {
        fs::read_dir(p)
            .ok()
            .map(|children| children.flatten().count() as u64)
            .or(Some(0))
    } else {
        None
    };

    Ok(FileEntry { name, path, is_dir, size, modified, created, added, last_opened, file_type, icon_path, child_count })
}

#[tauri::command]
fn open_with(path: String, app_name: String) -> Result<(), AppError> {
    std::process::Command::new("open")
        .args(["-a", &app_name])
        .arg(&path)
        .spawn()
        .map_err(|e| AppError::internal_at(format!("无法使用 {} 打开: {}", app_name, e), Some(path)))?;
    Ok(())
}

fn add_dir_to_zip(
    writer: &mut zip::ZipWriter<fs::File>,
    base: &Path,
    dir: &Path,
    options: zip::write::SimpleFileOptions,
) -> Result<(), AppError> {
    for entry in fs::read_dir(dir)
        .map_err(|e| AppError::from_io(&e, Some(&dir.to_string_lossy()), format!("读取目录失败: {}", e)))? {
        let entry = entry
            .map_err(|e| AppError::from_io(&e, Some(&dir.to_string_lossy()), format!("读取条目失败: {}", e)))?;
        let path = entry.path();
        let relative = path.strip_prefix(base).unwrap_or(&path);
        let name = relative.to_string_lossy();

        if path.is_dir() {
            writer
                .add_directory(name.as_ref(), options)
                .map_err(|e| AppError::internal_at(format!("添加目录失败: {}", e), Some(path.to_string_lossy().to_string())))?;
            add_dir_to_zip(writer, base, &path, options)?;
        } else {
            writer
                .start_file(name.as_ref(), options)
                .map_err(|e| AppError::internal_at(format!("添加文件失败: {}", e), Some(path.to_string_lossy().to_string())))?;
            let mut input = fs::File::open(&path)
                .map_err(|e| AppError::from_io(&e, Some(&path.to_string_lossy()), format!("读取文件失败: {}", e)))?;
            std::io::copy(&mut input, &mut *writer)
                .map_err(|e| AppError::from_io(&e, Some(&path.to_string_lossy()), format!("写入失败: {}", e)))?;
        }
    }
    Ok(())
}

#[tauri::command]
fn open_devtools(window: tauri::WebviewWindow) -> Result<(), AppError> {
    window.open_devtools();
    Ok(())
}

#[tauri::command]
fn quick_look(path: String) -> Result<(), AppError> {
    std::process::Command::new("qlmanage")
        .args(["-p", &path])
        .spawn()
        .map_err(|e| AppError::internal_at(format!("无法打开 Quick Look: {}", e), Some(path)))?;
    Ok(())
}

#[tauri::command]
fn reveal_in_finder(path: String) -> Result<(), AppError> {
    std::process::Command::new("open")
        .args(["-R", &path])
        .spawn()
        .map_err(|e| AppError::internal_at(format!("无法在 Finder 中显示: {}", e), Some(path)))?;
    Ok(())
}

#[tauri::command]
fn open_path(path: String) -> Result<(), AppError> {
    std::process::Command::new("open")
        .arg(&path)
        .spawn()
        .map_err(|e| AppError::internal_at(format!("无法打开文件: {}", e), Some(path)))?;
    Ok(())
}

#[tauri::command]
fn get_disk_info(path: String) -> Result<DiskInfo, AppError> {
    #[cfg(target_os = "macos")]
    if let Some(info) = get_primary_apfs_disk_info(&path) {
        return Ok(info);
    }

    let mut command = std::process::Command::new("df");
    command.args(["-k", "-P"]);
    if path != "/" {
        command.arg(&path);
    }

    let output = command
        .output()
        .map_err(|e| AppError::internal_at(format!("获取磁盘信息失败: {}", e), Some(path.clone())))?;
    let text = String::from_utf8(output.stdout)
        .map_err(|e| AppError::internal_at(format!("解析磁盘信息失败: {}", e), Some(path.clone())))?;

    let rows = parse_df_rows(&text);
    let row = if path == "/" {
        root_storage_row(&rows)
    } else {
        rows.first()
    }
        .ok_or_else(|| AppError::internal_at("磁盘信息为空", Some(path.clone())))?;

    Ok(disk_info_from_df_row(row, if path == "/" { Some("/") } else { None }))
}

fn parse_capacity(value: &str) -> u8 {
    value
        .trim_end_matches('%')
        .parse::<u8>()
        .unwrap_or(0)
        .min(100)
}

#[tauri::command]
fn list_volumes() -> Result<Vec<VolumeInfo>, AppError> {
    let output = std::process::Command::new("df")
        .args(["-k", "-P"])
        .output()
        .map_err(|e| AppError::internal(format!("获取卷信息失败: {}", e)))?;

    let text = String::from_utf8(output.stdout)
        .map_err(|e| AppError::internal(format!("解析卷信息失败: {}", e)))?;
    Ok(volume_infos_from_df_rows(&parse_df_rows(&text)))
}

#[tauri::command]
fn eject_volume(path: String) -> Result<(), AppError> {
    if !path.starts_with("/Volumes/") {
        return Err(AppError::invalid_path(
            "只能弹出 /Volumes 下的外置磁盘",
            Some(path),
        ));
    }

    let status = std::process::Command::new("diskutil")
        .args(["eject", &path])
        .status()
        .map_err(|e| AppError::internal_at(format!("弹出磁盘失败: {}", e), Some(path.clone())))?;

    if status.success() {
        Ok(())
    } else {
        Err(AppError::new(
            AppErrorKind::Busy,
            "弹出磁盘失败：磁盘可能正在被占用",
            Some(path),
        ))
    }
}

#[tauri::command]
fn list_terminal_apps() -> Result<Vec<String>, AppError> {
    let mut terminals = vec!["Terminal".to_string(), "iTerm".to_string()];
    let candidates = [
        "/Applications",
        "/System/Applications",
        "/Applications/Utilities",
    ];
    let terminal_keywords = ["terminal", "iterm", "warp", "kitty", "wezterm", "alacritty", "ghostty", "tabby", "hyper"];

    if let Ok(output) = std::process::Command::new("mdfind")
        .args(["kMDItemContentType == 'com.apple.application-bundle'"])
        .output()
    {
        if let Ok(text) = String::from_utf8(output.stdout) {
            for path in text.lines() {
                let name = Path::new(path)
                    .file_name()
                    .and_then(|n| n.to_str())
                    .unwrap_or_default();
                let lower = name.to_lowercase();
                if name.ends_with(".app") && terminal_keywords.iter().any(|kw| lower.contains(kw)) {
                    let app_name = name.trim_end_matches(".app").to_string();
                    if !terminals.iter().any(|t| t == &app_name) {
                        terminals.push(app_name);
                    }
                }
            }
        }
    }

    for dir in candidates {
        if let Ok(entries) = fs::read_dir(dir) {
            for entry in entries.flatten() {
                let name = entry.file_name().to_string_lossy().to_string();
                let lower = name.to_lowercase();
                if name.ends_with(".app") && terminal_keywords.iter().any(|kw| lower.contains(kw)) {
                    let app_name = name.trim_end_matches(".app").to_string();
                    if !terminals.iter().any(|t| t == &app_name) {
                        terminals.push(app_name);
                    }
                }
            }
        }
    }

    terminals.sort_by_key(|a| a.to_lowercase());
    terminals.dedup();
    Ok(terminals)
}

/// 拒绝包含未被 shell 单引号保护的 shell 元字符的用户命令片段。
///
/// 这一层防御针对自动化路径：菜单扩展的 terminalArgs / shell command 字段在没有
/// 用户二次确认时（confirmExecution=false）执行，必须保证 user_cmd 不会
/// "逃出" 我们包装的引号 / `cd` 前缀。
///
/// 前端会先对模板占位符执行 shell_quote；这里保留后端兜底，允许危险字符
/// 出现在已引用参数内。用户在设置面板手敲"高级命令"应走
/// confirmExecution=true 流程，前端可以选择跳过此校验。
fn find_forbidden_shell_token_outside_quotes(s: &str) -> Result<Option<&'static str>, String> {
    let bytes = s.as_bytes();
    let mut i = 0;
    let mut in_single_quote = false;

    while i < bytes.len() {
        let ch = bytes[i] as char;
        if ch == '\n' || ch == '\r' {
            return Ok(Some(if ch == '\n' { "\n" } else { "\r" }));
        }

        if in_single_quote
            && ch == '\''
            && i + 3 < bytes.len()
            && bytes[i + 1] as char == '\\'
            && bytes[i + 2] as char == '\''
            && bytes[i + 3] as char == '\''
        {
            i += 4;
            continue;
        }

        if ch == '\'' {
            in_single_quote = !in_single_quote;
            i += 1;
            continue;
        }

        if in_single_quote {
            i += 1;
            continue;
        }

        if ch == '\\' {
            i = (i + 2).min(bytes.len());
            continue;
        }

        if i + 1 < bytes.len() {
            match (bytes[i], bytes[i + 1]) {
                (b'$', b'(') => return Ok(Some("$(")),
                (b'&', b'&') => return Ok(Some("&&")),
                (b'|', b'|') => return Ok(Some("||")),
                _ => {}
            }
        }

        match ch {
            '`' => return Ok(Some("`")),
            ';' => return Ok(Some(";")),
            '|' => return Ok(Some("|")),
            '>' => return Ok(Some(">")),
            '<' => return Ok(Some("<")),
            _ => {}
        }
        i += 1;
    }

    if in_single_quote {
        return Err("命令含未闭合的单引号".into());
    }
    Ok(None)
}

fn validate_shell_fragment(s: &str) -> Result<String, String> {
    let trimmed = s.trim();
    if trimmed.is_empty() {
        return Err("命令为空".into());
    }
    if let Some(tok) = find_forbidden_shell_token_outside_quotes(trimmed)? {
        return Err(format!(
            "命令含受限字符 {} — 请改用『扩展菜单』的高级命令模式（启用执行前确认）",
            tok
        ));
    }
    Ok(trimmed.to_string())
}

/// 终端应用白名单 — 拒绝任意名字以防 app_name 含 AppleScript 注入字符。
const ALLOWED_TERMINAL_APPS: &[&str] = &[
    "Terminal", "iTerm", "iTerm2", "Warp", "kitty", "WezTerm",
    "Alacritty", "Ghostty", "Tabby", "Hyper",
];

fn is_allowed_terminal(name: &str) -> bool {
    ALLOWED_TERMINAL_APPS.iter().any(|a| a.eq_ignore_ascii_case(name))
}

#[tauri::command]
fn open_terminal_at(path: String, terminal_app: Option<String>, args: Option<String>, scripts: Option<Vec<String>>, custom_command: Option<String>) -> Result<(), AppError> {
    let target_path = Path::new(&path);
    let dir = if target_path.is_dir() {
        target_path.to_path_buf()
    } else {
        target_path.parent().unwrap_or(Path::new("/")).to_path_buf()
    };
    let dir_str = dir.to_string_lossy().to_string();

    let app_name = terminal_app.unwrap_or_else(|| "Terminal".into());
    if !is_allowed_terminal(&app_name) {
        return Err(AppError::invalid_path(format!("不允许的终端应用: {}", app_name), None));
    }
    let arg_text = args.unwrap_or_default();

    // scripts 数组逐条验证后拼接
    let scripts_tail: Option<String> = scripts
        .map(|ss| ss.into_iter().filter(|s| !s.trim().is_empty()).collect::<Vec<_>>())
        .filter(|ss| !ss.is_empty())
        .map(|ss| {
            ss.into_iter()
                .map(|s| validate_shell_fragment(&s).map_err(|err| AppError::invalid_path(err, None)))
                .collect::<Result<Vec<_>, AppError>>()
        })
        .transpose()?
        .map(|validated| validated.join(" && "));

    let lower = app_name.to_lowercase();
    let args_tail = {
        let trimmed_args = arg_text.trim();
        if trimmed_args.is_empty() {
            None
        } else {
            Some(validate_shell_fragment(trimmed_args).map_err(|err| AppError::invalid_path(err, None))?)
        }
    };
    let raw_tail = custom_command
        .as_deref()
        .map(str::trim)
        .filter(|c| !c.is_empty())
        .map(|c| validate_shell_fragment(c).map_err(|err| AppError::invalid_path(err, None)))
        .transpose()?
        .or_else(|| scripts_tail.clone())
        .or(args_tail);
    let command = match raw_tail.as_deref() {
        Some(tail) => format!("cd {} && {}", shell_quote(&dir_str), tail),
        None => format!("cd {}", shell_quote(&dir_str)),
    };

    if lower.contains("terminal") || lower.contains("iterm") {
        // command 已经只含白名单字符 + 我们自己拼接的 cd 包装 — 用 apple_quote 包字符串进 AppleScript。
        // app_name 已通过白名单，进 apple_quote 是双重保险。
        let script = if lower.contains("iterm") {
            format!(
                "tell application {}\nactivate\ncreate window with default profile\ntell current session of current window to write text {}\nend tell",
                apple_quote(&app_name),
                apple_quote(&command),
            )
        } else {
            // Terminal.app: 始终在新 tab 执行，确保用户能看到命令输出
            format!(
                "tell application {}\nactivate\ndo script {}\nend tell",
                apple_quote(&app_name),
                apple_quote(&command),
            )
        };
        let output = std::process::Command::new("osascript")
            .args(["-e", &script])
            .output()
            .map_err(|e| AppError::internal_at(format!("打开终端失败: {}", e), Some(path.clone())))?;
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(AppError::internal_at(format!("AppleScript 错误: {}", stderr), Some(path)));
        }
    } else {
        // 非 Terminal/iTerm 终端：通过临时脚本传递命令
        if let Some(tail) = raw_tail.as_deref() {
            let tmp_script = std::env::temp_dir().join(format!("aether-launch-{}.sh", std::process::id()));
            let script_content = format!("#!/bin/sh\ncd {}\n{}\nexec $SHELL", shell_quote(&dir_str), tail);
            std::fs::write(&tmp_script, &script_content)
                .map_err(|e| AppError::internal_at(format!("写入临时脚本失败: {}", e), Some(tmp_script.to_string_lossy().to_string())))?;
            std::fs::set_permissions(&tmp_script, std::fs::Permissions::from_mode(0o755))
                .map_err(|e| AppError::internal_at(format!("设置脚本权限失败: {}", e), Some(tmp_script.to_string_lossy().to_string())))?;
            std::process::Command::new("open")
                .args(["-a", &app_name, tmp_script.to_string_lossy().as_ref()])
                .spawn()
                .map_err(|e| AppError::internal_at(format!("打开终端应用失败: {}", e), Some(path)))?;
        } else {
            std::process::Command::new("open")
                .args(["-a", &app_name, &dir_str])
                .spawn()
                .map_err(|e| AppError::internal_at(format!("打开终端应用失败: {}", e), Some(path)))?;
        }
    }
    Ok(())
}

fn apple_quote(value: &str) -> String {
    format!("\"{}\"", value.replace('\\', "\\\\").replace('"', "\\\""))
}

fn shell_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}

#[cfg(target_os = "macos")]
fn reveal_any_window(app: &tauri::AppHandle) {
    let windows = app.webview_windows();
    if let Some((_, window)) = windows.iter().next() {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
        return;
    }

    let handle = app.clone();
    tauri::async_runtime::spawn(async move {
        let _ = create_app_window(handle, None, None).await;
    });
}

#[cfg(target_os = "macos")]
fn check_updates_message(app: tauri::AppHandle) {
    tauri::async_runtime::spawn(async move {
        let message = match app.updater() {
            Ok(updater) => match updater.check().await {
                Ok(Some(update)) => format!(
                    "发现新版本 {}。请在应用内“设置 → 关于”里下载安装。",
                    update.version
                ),
                Ok(None) => "当前已经是最新版本。".to_string(),
                Err(err) => format!("检查更新失败：{}", err),
            },
            Err(err) => format!("初始化更新器失败：{}", err),
        };
        app.dialog()
            .message(message)
            .title("Aether Explorer 更新")
            .show(|_| {});
    });
}

#[cfg(target_os = "macos")]
fn show_help_message(app: &tauri::AppHandle) {
    app.dialog()
        .message("Aether Explorer 是本地优先的 macOS 文件工作台。\n\n常用快捷键：\n⌘N 新建窗口\n⌘R 刷新\n⌘I 显示简介\n⌘C / ⌘X / ⌘V 复制、剪切、粘贴\n空格 Quick Look")
        .title("Aether Explorer 帮助")
        .show(|_| {});
}

#[cfg(target_os = "macos")]
fn emit_native_menu_command(app: &tauri::AppHandle, command: &str) {
    let _ = app.emit("aether-native-menu-command", command);
}

#[cfg(target_os = "macos")]
fn build_native_app_menu(app: &tauri::AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
    let app_name = app.package_info().name.clone();
    let new_window = MenuItem::with_id(app, "new-window", "新建窗口", true, Some("CmdOrCtrl+N"))?;
    let refresh_view = MenuItem::with_id(app, "refresh-view", "刷新", true, Some("CmdOrCtrl+R"))?;
    let refresh_view_in_view_menu = MenuItem::with_id(app, "refresh-view-in-view-menu", "刷新", true, None::<&str>)?;
    let open_settings = MenuItem::with_id(app, "open-settings", "设置…", true, Some("CmdOrCtrl+,"))?;
    let check_updates = MenuItem::with_id(app, "check-updates", "检查更新…", true, None::<&str>)?;
    let show_help = MenuItem::with_id(app, "show-help", "Aether Explorer 帮助", true, None::<&str>)?;
    let show_all_windows = MenuItem::with_id(app, "show-all-windows", "显示主窗口", true, None::<&str>)?;
    let force_quit = MenuItem::with_id(app, "force-quit-app", "退出 Aether Explorer", true, Some("CmdOrCtrl+Q"))?;
    let view_list = MenuItem::with_id(app, "view-list", "列表视图", true, Some("CmdOrCtrl+1"))?;
    let view_grid = MenuItem::with_id(app, "view-grid", "网格视图", true, Some("CmdOrCtrl+2"))?;
    let view_column = MenuItem::with_id(app, "view-column", "分栏视图", true, Some("CmdOrCtrl+3"))?;
    let toggle_hidden = MenuItem::with_id(app, "toggle-hidden-files", "显示/隐藏隐藏文件", true, Some("CmdOrCtrl+Shift+."))?;
    let toggle_inspector = MenuItem::with_id(app, "toggle-inspector", "显示/隐藏简介", true, Some("CmdOrCtrl+I"))?;

    let app_menu = Submenu::with_items(
        app,
        app_name,
        true,
        &[
            &PredefinedMenuItem::about(app, None, None)?,
            &PredefinedMenuItem::separator(app)?,
            &open_settings,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::services(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::hide(app, None)?,
            &PredefinedMenuItem::hide_others(app, None)?,
            &show_all_windows,
            &PredefinedMenuItem::separator(app)?,
            &force_quit,
        ],
    )?;

    let file_menu = Submenu::with_items(
        app,
        "文件",
        true,
        &[
            &new_window,
            &refresh_view,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::close_window(app, Some("关闭窗口"))?,
        ],
    )?;

    let edit_menu = Submenu::with_items(
        app,
        "编辑",
        true,
        &[
            &PredefinedMenuItem::undo(app, None)?,
            &PredefinedMenuItem::redo(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::cut(app, None)?,
            &PredefinedMenuItem::copy(app, None)?,
            &PredefinedMenuItem::paste(app, None)?,
            &PredefinedMenuItem::select_all(app, None)?,
        ],
    )?;

    let view_menu = Submenu::with_items(
        app,
        "显示",
        true,
        &[
            &view_list,
            &view_grid,
            &view_column,
            &PredefinedMenuItem::separator(app)?,
            &toggle_hidden,
            &toggle_inspector,
            &PredefinedMenuItem::separator(app)?,
            &refresh_view_in_view_menu,
        ],
    )?;

    let window_menu = Submenu::with_items(
        app,
        "窗口",
        true,
        &[
            &show_all_windows,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::minimize(app, None)?,
            &PredefinedMenuItem::fullscreen(app, None)?,
            &PredefinedMenuItem::bring_all_to_front(app, None)?,
        ],
    )?;

    let help_menu = Submenu::with_items(
        app,
        "帮助",
        true,
        &[
            &show_help,
            &check_updates,
        ],
    )?;

    Menu::with_items(app, &[&app_menu, &file_menu, &edit_menu, &view_menu, &window_menu, &help_menu])
}

#[cfg(target_os = "macos")]
fn install_tray(app: &tauri::AppHandle) -> tauri::Result<()> {
    let show_window = MenuItem::with_id(app, "tray-show-window", "显示主窗口", true, None::<&str>)?;
    let new_window = MenuItem::with_id(app, "tray-new-window", "新建窗口", true, Some("CmdOrCtrl+N"))?;
    let reload_window = MenuItem::with_id(app, "tray-reload-window", "重新加载窗口", true, Some("CmdOrCtrl+R"))?;
    let check_updates = MenuItem::with_id(app, "tray-check-updates", "检查更新…", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "tray-quit", "退出 Aether Explorer", true, Some("CmdOrCtrl+Q"))?;
    let tray_menu = Menu::with_items(
        app,
        &[
            &show_window,
            &new_window,
            &reload_window,
            &PredefinedMenuItem::separator(app)?,
            &check_updates,
            &PredefinedMenuItem::separator(app)?,
            &quit,
        ],
    )?;

    let mut builder = TrayIconBuilder::with_id("aether-status")
        .menu(&tray_menu)
        .tooltip("Aether Explorer")
        .show_menu_on_left_click(false)
        .icon_as_template(true)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "tray-show-window" => reveal_any_window(app),
            "tray-new-window" => {
                let handle = app.clone();
                tauri::async_runtime::spawn(async move {
                    let _ = create_app_window(handle, None, None).await;
                });
            }
            "tray-reload-window" => {
                if let Some((_, window)) = app.webview_windows().iter().next() {
                    let _ = window.reload();
                    let _ = window.show();
                    let _ = window.unminimize();
                    let _ = window.set_focus();
                }
            }
            "tray-check-updates" => check_updates_message(app.clone()),
            "tray-quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                reveal_any_window(tray.app_handle());
            }
        });

    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }

    builder.build(app)?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .manage(FileClipboardState(Mutex::new(None)))
        .manage(FileDragState(Mutex::new(None)))
        .manage(DirectoryLoadState::default())
        .manage(TransferTaskState::default())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_updater::Builder::default().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_liquid_glass::init())
        .setup(|app| {
            let log_dir = aether_log_dir(&app.path().home_dir()?);
            install_panic_hook(log_dir.clone());
            app.handle().plugin(
                tauri_plugin_log::Builder::default()
                    .clear_targets()
                    .level(log::LevelFilter::Info)
                    .target(Target::new(TargetKind::Folder {
                        path: log_dir,
                        file_name: Some("aether".into()),
                    }))
                    .build(),
            )?;

            // 设置 macOS 原生应用菜单与状态栏菜单
            #[cfg(target_os = "macos")]
            {
                let app_handle = app.handle().clone();
                let app_menu = build_native_app_menu(&app_handle)?;
                app.set_menu(app_menu)?;
                install_tray(&app_handle)?;

                app.on_menu_event(move |_app, event: MenuEvent| {
                    match event.id().as_ref() {
                        "new-window" => {
                            let handle = app_handle.clone();
                            tauri::async_runtime::spawn(async move {
                                let _ = create_app_window(handle, None, None).await;
                            });
                        }
                        "show-all-windows" => reveal_any_window(&app_handle),
                        "open-settings" => emit_native_menu_command(&app_handle, "open-settings"),
                        "refresh-view" | "refresh-view-in-view-menu" => emit_native_menu_command(&app_handle, "refresh"),
                        "view-list" => emit_native_menu_command(&app_handle, "display-mode:list"),
                        "view-grid" => emit_native_menu_command(&app_handle, "display-mode:grid"),
                        "view-column" => emit_native_menu_command(&app_handle, "display-mode:column"),
                        "toggle-hidden-files" => emit_native_menu_command(&app_handle, "toggle-hidden-files"),
                        "toggle-inspector" => emit_native_menu_command(&app_handle, "toggle-inspector"),
                        "show-help" => show_help_message(&app_handle),
                        "check-updates" => check_updates_message(app_handle.clone()),
                        "force-quit-app" => app_handle.exit(0),
                        _ => {}
                    }
                });
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            greet,
            list_directory,
            cancel_directory_loads,
            get_home_dir,
            preflight_file_permissions,
            open_system_settings,
            get_logs_dir,
            get_config_dir,
            open_logs_dir,
            open_config_dir,
            read_last_panic_log,
            start_window_drag,
            raise_window_at,
            debug_log,
            get_native_liquid_glass_status,
            set_native_liquid_glass_enabled,
            list_fonts,
            list_terminal_apps,
            open_terminal_at,
            create_app_window,
            read_text_preview,
            get_disk_info,
            list_volumes,
            eject_volume,
            copy_file,
            copy_files,
            preview_copy_file_conflicts,
            preview_move_file_conflicts,
            start_copy_files_task,
            start_move_files_task,
            list_transfer_tasks,
            cancel_transfer_task,
            clear_finished_transfer_tasks,
            move_file,
            set_file_clipboard,
            get_file_clipboard,
            clear_file_clipboard,
            set_file_drag_payload,
            get_file_drag_payload,
            clear_file_drag_payload,
            move_files,
            rename_file,
            delete_to_trash,
            create_file,
            create_folder,
            duplicate_as_alias,
            compress_files,
            decompress_file,
            get_file_info,
            get_app_icon,
            get_dir_size,
            get_child_count,
            get_directory_signature,
            open_devtools,
            quick_look,
            reveal_in_finder,
            open_path,
            open_with
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|app, event| {
        #[cfg(target_os = "macos")]
        if let tauri::RunEvent::Reopen { .. } = event {
            // 尝试激活任何已存在的窗口
            let windows = app.webview_windows();
            if let Some((_, window)) = windows.iter().next() {
                let _ = window.show();
                let _ = window.unminimize();
                let _ = window.set_focus();
            } else {
                // 如果没有窗口，创建一个新窗口
                let app_handle = app.app_handle().clone();
                tauri::async_runtime::spawn(async move {
                    let _ = create_app_window(app_handle, None, None).await;
                });
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    // ── diagnostics logging ──
    #[test]
    fn aether_log_dir_uses_macos_user_logs_folder() {
        let dir = aether_log_dir(Path::new("/Users/jane"));

        assert_eq!(dir, PathBuf::from("/Users/jane/Library/Logs/Aether Explorer"));
    }

    #[test]
    fn panic_log_path_uses_stable_file_name() {
        let path = panic_log_path(Path::new("/tmp/aether-logs"));

        assert_eq!(path, PathBuf::from("/tmp/aether-logs/panic.log"));
    }

    #[test]
    fn settings_store_path_uses_stable_file_name() {
        let path = settings_store_path(Path::new("/tmp/aether-config"));

        assert_eq!(path, PathBuf::from("/tmp/aether-config/settings.json"));
    }

    #[test]
    fn format_panic_report_includes_message_and_location() {
        let location = std::panic::Location::caller();
        let report = format_panic_report("boom", Some(location));

        assert!(report.contains("RUST PANIC"));
        assert!(report.contains("message: boom"));
        assert!(report.contains("location: "));
        assert!(report.ends_with("\n\n"));
    }

    #[test]
    fn write_panic_report_appends_to_panic_log() {
        let temp = std::env::temp_dir().join(format!("aether-panic-log-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&temp);

        write_panic_report(&temp, "first\n").unwrap();
        write_panic_report(&temp, "second\n").unwrap();

        assert_eq!(std::fs::read_to_string(panic_log_path(&temp)).unwrap(), "first\nsecond\n");

        let _ = std::fs::remove_dir_all(&temp);
    }

    #[test]
    fn read_last_panic_log_returns_none_when_missing() {
        let temp = std::env::temp_dir().join(format!("aether-missing-panic-log-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&temp);

        assert_eq!(read_last_panic_log_from_dir(&temp, 1024).unwrap(), None);
    }

    #[test]
    fn read_last_panic_log_limits_large_files() {
        let temp = std::env::temp_dir().join(format!("aether-large-panic-log-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&temp);

        write_panic_report(&temp, "0123456789").unwrap();

        assert_eq!(read_last_panic_log_from_dir(&temp, 4).unwrap(), Some("6789".to_string()));

        let _ = std::fs::remove_dir_all(&temp);
    }

    // ── format_size ──
    #[test]
    fn format_size_bytes_under_1k() {
        assert_eq!(format_size(0), "0 B");
        assert_eq!(format_size(1), "1 B");
        assert_eq!(format_size(1023), "1023 B");
    }

    #[test]
    fn format_size_kib_to_gib() {
        assert_eq!(format_size(1024), "1.0 KB");
        assert_eq!(format_size(1024 * 1024), "1.0 MB");
        assert_eq!(format_size(1024_u64.pow(3)), "1.0 GB");
    }

    #[test]
    fn format_size_decimal_precision() {
        assert_eq!(format_size(1536), "1.5 KB");
        assert_eq!(format_size(1024 * 1024 * 3 / 2), "1.5 MB");
    }

    // ── format_kib ──
    #[test]
    fn format_kib_parses_numeric_string() {
        // 输入 KiB 数字，输出人类可读
        assert_eq!(format_kib("1"), "1.0 KB");
        assert_eq!(format_kib("1024"), "1.0 MB");
        assert_eq!(format_kib("0"), "0 B");
    }

    #[test]
    fn format_kib_returns_input_on_parse_failure() {
        assert_eq!(format_kib("not-a-number"), "not-a-number");
        assert_eq!(format_kib(""), "");
    }

    #[test]
    fn format_storage_size_uses_decimal_units_for_system_storage() {
        assert_eq!(format_storage_size(494_384_795_648), "494.4 GB");
        assert_eq!(format_storage_size(12_546_826_240), "12.5 GB");
    }

    #[test]
    fn parse_plist_values_from_diskutil_output() {
        let plist = r#"
<plist version="1.0">
<dict>
    <key>APFSContainerSize</key>
    <integer>494384795648</integer>
    <key>FilesystemUserVisibleName</key>
    <string>APFS &amp; Local</string>
</dict>
</plist>
"#;

        assert_eq!(parse_plist_integer(plist, "APFSContainerSize"), Some(494_384_795_648));
        assert_eq!(parse_plist_string(plist, "FilesystemUserVisibleName").as_deref(), Some("APFS & Local"));
        assert_eq!(parse_plist_integer(plist, "Missing"), None);
    }

    #[test]
    fn build_primary_apfs_disk_info_combines_data_and_system_usage() {
        let data_plist = r#"
<plist version="1.0">
<dict>
    <key>APFSContainerFree</key>
    <integer>101154271232</integer>
    <key>APFSContainerSize</key>
    <integer>494384795648</integer>
    <key>CapacityInUse</key>
    <integer>348680560640</integer>
    <key>FilesystemUserVisibleName</key>
    <string>APFS</string>
</dict>
</plist>
"#;
        let system_plist = r#"
<plist version="1.0">
<dict>
    <key>CapacityInUse</key>
    <integer>12546826240</integer>
</dict>
</plist>
"#;

        let info = build_primary_apfs_disk_info(data_plist, Some(system_plist)).unwrap();

        assert_eq!(info.filesystem, "APFS");
        assert_eq!(info.size, "494.4 GB");
        assert_eq!(info.used, "361.2 GB");
        assert_eq!(info.available, "133.2 GB");
        assert_eq!(info.capacity, "73%");
        assert_eq!(info.capacity_value, 73);
        assert_eq!(info.mount, "/");
    }

    // ── parse_df_line ──
    #[test]
    fn parse_df_line_simple_mount() {
        let line = "/dev/disk1s1 488245288 244091128 244154160 50% /";
        let (fs, size, used, avail, cap, mount) = parse_df_line(line).unwrap();
        assert_eq!(fs, "/dev/disk1s1");
        assert_eq!(size, "488245288");
        assert_eq!(used, "244091128");
        assert_eq!(avail, "244154160");
        assert_eq!(cap, "50%");
        assert_eq!(mount, "/");
    }

    #[test]
    fn parse_df_line_mount_with_spaces() {
        let line = "/dev/disk2s1 1000 500 500 50% /Volumes/My Drive";
        let (_, _, _, _, _, mount) = parse_df_line(line).unwrap();
        assert_eq!(mount, "/Volumes/My Drive");
    }

    #[test]
    fn root_storage_row_prefers_macos_data_volume() {
        let text = "\
Filesystem   1024-blocks      Used Available Capacity  Mounted on
/dev/disk3s3s1   482797652  12252760  98786224    12%    /
/dev/disk3s1     482797652 340505604  98786224    78%    /System/Volumes/Data
";
        let rows = parse_df_rows(text);
        let row = root_storage_row(&rows).unwrap();

        assert_eq!(row.mount, "/System/Volumes/Data");
        assert_eq!(row.used, "340505604");
        assert_eq!(row.capacity, "78%");
    }

    #[test]
    fn volume_infos_use_macos_data_volume_for_root_storage() {
        let text = "\
Filesystem   1024-blocks      Used Available Capacity  Mounted on
/dev/disk3s3s1   482797652  12252760  98786224    12%    /
/dev/disk3s1     482797652 340505604  98786224    78%    /System/Volumes/Data
/dev/disk5s1         38780     25924     12224    68%    /Volumes/Codex++
";
        let volumes = volume_infos_from_df_rows(&parse_df_rows(text));
        let root = volumes.iter().find(|volume| volume.is_root).unwrap();

        assert_eq!(root.name, "Macintosh HD");
        assert_eq!(root.path, "/");
        assert_eq!(root.used, "324.7 GB");
        assert_eq!(root.capacity, "78%");
        assert_eq!(root.capacity_value, 78);
        assert_eq!(volumes.iter().filter(|volume| volume.is_root).count(), 1);
        assert!(volumes.iter().any(|volume| volume.path == "/Volumes/Codex++"));
    }

    #[test]
    fn parse_df_line_rejects_short_input() {
        assert!(parse_df_line("only three cols").is_err());
        assert!(parse_df_line("").is_err());
    }

    // ── parse_capacity ──
    #[test]
    fn parse_capacity_strips_percent() {
        assert_eq!(parse_capacity("85%"), 85);
        assert_eq!(parse_capacity("0%"), 0);
        assert_eq!(parse_capacity("100%"), 100);
    }

    #[test]
    fn parse_capacity_caps_at_100() {
        // value 超出 100 截断到 100（u8::min 操作）
        assert_eq!(parse_capacity("200%"), 100);
    }

    #[test]
    fn parse_capacity_invalid_returns_0() {
        assert_eq!(parse_capacity(""), 0);
        assert_eq!(parse_capacity("abc"), 0);
        assert_eq!(parse_capacity("xx%"), 0);
    }

    // ── detect_mime ──
    #[test]
    fn detect_mime_images() {
        assert_eq!(detect_mime("photo.png", false), "image");
        assert_eq!(detect_mime("photo.JPG", false), "image");
        assert_eq!(detect_mime("anim.gif", false), "image");
        assert_eq!(detect_mime("logo.SVG", false), "image");
    }

    #[test]
    fn detect_mime_video_audio() {
        assert_eq!(detect_mime("clip.mp4", false), "video");
        assert_eq!(detect_mime("song.mp3", false), "audio");
        assert_eq!(detect_mime("voice.m4a", false), "audio");
    }

    #[test]
    fn detect_mime_code_text_archive() {
        assert_eq!(detect_mime("main.rs", false), "code");
        assert_eq!(detect_mime("App.tsx", false), "code");
        assert_eq!(detect_mime("notes.md", false), "text");
        assert_eq!(detect_mime("data.json", false), "text");
        assert_eq!(detect_mime("backup.zip", false), "archive");
    }

    #[test]
    fn detect_mime_dir_vs_app_bundle() {
        assert_eq!(detect_mime("Documents", true), "folder");
        assert_eq!(detect_mime("Safari.app", true), "application");
        assert_eq!(detect_mime("foo.APP", true), "application");
    }

    #[test]
    fn detect_mime_unknown_extension() {
        assert_eq!(detect_mime("data.xyzunknown", false), "file");
        assert_eq!(detect_mime("Makefile", false), "file");
        assert_eq!(detect_mime("no_extension", false), "file");
    }

    // ── unique_destination ──
    #[test]
    fn unique_destination_nonexistent_returns_original() {
        let temp = std::env::temp_dir().join(format!("aether-uniq-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&temp);
        std::fs::create_dir_all(&temp).unwrap();

        let target = temp.join("brand-new.txt");
        let result = unique_destination(&target);
        assert_eq!(result, target);

        let _ = std::fs::remove_dir_all(&temp);
    }

    #[test]
    fn unique_destination_appends_copy_suffix() {
        let temp = std::env::temp_dir().join(format!("aether-uniq2-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&temp);
        std::fs::create_dir_all(&temp).unwrap();

        let a = temp.join("a.txt");
        std::fs::write(&a, b"").unwrap();
        let next = unique_destination(&a);
        assert_eq!(next.file_name().unwrap().to_str().unwrap(), "a copy.txt");

        std::fs::write(temp.join("a copy.txt"), b"").unwrap();
        let next2 = unique_destination(&a);
        assert_eq!(next2.file_name().unwrap().to_str().unwrap(), "a copy 2.txt");

        let _ = std::fs::remove_dir_all(&temp);
    }

    #[test]
    fn unique_destination_handles_no_extension() {
        let temp = std::env::temp_dir().join(format!("aether-uniq3-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&temp);
        std::fs::create_dir_all(&temp).unwrap();

        let f = temp.join("Makefile");
        std::fs::write(&f, b"").unwrap();
        let next = unique_destination(&f);
        assert_eq!(next.file_name().unwrap().to_str().unwrap(), "Makefile copy");

        let _ = std::fs::remove_dir_all(&temp);
    }

    #[test]
    fn duplicate_as_alias_copies_file_with_alias_suffix() {
        let temp = std::env::temp_dir().join(format!("aether-alias-file-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&temp);
        std::fs::create_dir_all(&temp).unwrap();

        let src = temp.join("note.txt");
        std::fs::write(&src, "hello").unwrap();

        let duplicated = duplicate_as_alias(src.to_string_lossy().into()).unwrap();
        let duplicated_path = Path::new(&duplicated);

        assert_eq!(duplicated_path.file_name().unwrap().to_str().unwrap(), "note-替身.txt");
        assert_eq!(std::fs::read_to_string(duplicated_path).unwrap(), "hello");
        assert!(!std::fs::symlink_metadata(duplicated_path).unwrap().file_type().is_symlink());

        let _ = std::fs::remove_dir_all(&temp);
    }

    #[test]
    fn duplicate_as_alias_copies_folder_as_real_folder() {
        let temp = std::env::temp_dir().join(format!("aether-alias-dir-{}", std::process::id()));
        let src = temp.join("Project");
        let nested = src.join("nested");
        let _ = std::fs::remove_dir_all(&temp);
        std::fs::create_dir_all(&nested).unwrap();
        std::fs::write(nested.join("readme.md"), "folder copy").unwrap();

        let duplicated = duplicate_as_alias(src.to_string_lossy().into()).unwrap();
        let duplicated_path = Path::new(&duplicated);
        let metadata = std::fs::symlink_metadata(duplicated_path).unwrap();

        assert_eq!(duplicated_path.file_name().unwrap().to_str().unwrap(), "Project-替身");
        assert!(metadata.is_dir());
        assert!(!metadata.file_type().is_symlink());
        assert_eq!(std::fs::read_to_string(duplicated_path.join("nested/readme.md")).unwrap(), "folder copy");

        let _ = std::fs::remove_dir_all(&temp);
    }

    #[test]
    fn copy_files_skip_conflicts_preserves_existing_and_continues() {
        let temp = std::env::temp_dir().join(format!("aether-copy-skip-{}", std::process::id()));
        let src_dir = temp.join("src");
        let dst_dir = temp.join("dst");
        let _ = std::fs::remove_dir_all(&temp);
        std::fs::create_dir_all(&src_dir).unwrap();
        std::fs::create_dir_all(&dst_dir).unwrap();

        std::fs::write(src_dir.join("same.txt"), b"new").unwrap();
        std::fs::write(src_dir.join("fresh.txt"), b"fresh").unwrap();
        std::fs::write(dst_dir.join("same.txt"), b"existing").unwrap();

        let result = copy_files(
            vec![
                src_dir.join("same.txt").to_string_lossy().into(),
                src_dir.join("fresh.txt").to_string_lossy().into(),
            ],
            dst_dir.to_string_lossy().into(),
            Some(MoveConflictStrategy::Skip),
        ).unwrap();

        assert_eq!(result.skipped_conflicts, 1);
        assert_eq!(result.copied.len(), 1);
        assert_eq!(std::fs::read_to_string(dst_dir.join("same.txt")).unwrap(), "existing");
        assert_eq!(std::fs::read_to_string(dst_dir.join("fresh.txt")).unwrap(), "fresh");

        let _ = std::fs::remove_dir_all(&temp);
    }

    #[test]
    fn move_files_skip_conflicts_preserves_existing_and_moves_non_conflicts() {
        let temp = std::env::temp_dir().join(format!("aether-move-skip-{}", std::process::id()));
        let src_dir = temp.join("src");
        let dst_dir = temp.join("dst");
        let _ = std::fs::remove_dir_all(&temp);
        std::fs::create_dir_all(&src_dir).unwrap();
        std::fs::create_dir_all(&dst_dir).unwrap();

        let conflicting_src = src_dir.join("same.txt");
        let fresh_src = src_dir.join("fresh.txt");
        std::fs::write(&conflicting_src, b"new").unwrap();
        std::fs::write(&fresh_src, b"fresh").unwrap();
        std::fs::write(dst_dir.join("same.txt"), b"existing").unwrap();

        let result = move_files(
            vec![
                conflicting_src.to_string_lossy().into(),
                fresh_src.to_string_lossy().into(),
            ],
            dst_dir.to_string_lossy().into(),
            Some(MoveConflictStrategy::Skip),
        ).unwrap();

        assert_eq!(result.skipped_conflicts, 1);
        assert_eq!(result.moved.len(), 1);
        assert!(conflicting_src.exists());
        assert!(!fresh_src.exists());
        assert_eq!(std::fs::read_to_string(dst_dir.join("same.txt")).unwrap(), "existing");
        assert_eq!(std::fs::read_to_string(dst_dir.join("fresh.txt")).unwrap(), "fresh");

        let _ = std::fs::remove_dir_all(&temp);
    }

    #[test]
    fn clear_finished_transfer_tasks_retains_recent_finished_tasks() {
        let now = now_unix_seconds();
        let mut snapshot = TransferTaskSnapshot {
            id: "recent-finished".into(),
            kind: "copy".into(),
            status: "completed".into(),
            total_items: 1,
            completed_items: 1,
            total_bytes: 1,
            completed_bytes: 1,
            current_name: None,
            error: None,
            started_at: now,
            finished_at: Some(now),
            copied: 1,
            moved: 0,
            copied_cross_device: 0,
            failed: 0,
            conflicts: 0,
            skipped: 0,
            skipped_same_dir: 0,
            skipped_conflicts: 0,
        };

        assert!(should_retain_transfer_task_after_clear(&snapshot, now));

        snapshot.finished_at = Some(now.saturating_sub(FINISHED_TRANSFER_TASK_RETENTION_SECONDS + 1));
        assert!(!should_retain_transfer_task_after_clear(&snapshot, now));

        snapshot.status = "running".into();
        assert!(should_retain_transfer_task_after_clear(&snapshot, now));
    }

    #[test]
    fn finish_move_transfer_task_preserves_skipped_categories() {
        let state = TransferTaskState::default();
        let cancel_requested = Arc::new(AtomicBool::new(false));
        state
            .insert(
                TransferTaskSnapshot {
                    id: "move-skip-categories".into(),
                    kind: "move".into(),
                    status: "running".into(),
                    total_items: 3,
                    completed_items: 0,
                    total_bytes: 0,
                    completed_bytes: 0,
                    current_name: None,
                    error: None,
                    started_at: now_unix_seconds(),
                    finished_at: None,
                    copied: 0,
                    moved: 0,
                    copied_cross_device: 0,
                    failed: 0,
                    conflicts: 0,
                    skipped: 0,
                    skipped_same_dir: 0,
                    skipped_conflicts: 0,
                },
                cancel_requested,
            )
            .unwrap();

        finish_move_transfer_task(
            &state,
            "move-skip-categories",
            Ok(MoveResult {
                moved: vec![],
                copied_cross_device: vec![],
                failed: vec![],
                conflicts: vec![],
                skipped_same_dir: 1,
                skipped_conflicts: 2,
            }),
        );

        let snapshot = state.list().unwrap().into_iter().next().unwrap();
        assert_eq!(snapshot.skipped, 3);
        assert_eq!(snapshot.skipped_same_dir, 1);
        assert_eq!(snapshot.skipped_conflicts, 2);
    }

    #[test]
    fn move_conflict_preview_treats_noncanonical_same_dir_as_same_dir() {
        let temp = std::env::temp_dir().join(format!("aether-move-canonical-same-dir-{}", std::process::id()));
        let src_dir = temp.join("src");
        let dst_dir = temp.join("dst");
        let _ = std::fs::remove_dir_all(&temp);
        std::fs::create_dir_all(&src_dir).unwrap();
        std::fs::create_dir_all(&dst_dir).unwrap();

        let file = dst_dir.join("same.txt");
        std::fs::write(&file, b"same").unwrap();
        let noncanonical_src = src_dir.join("..").join("dst").join("same.txt");

        let conflicts = preview_move_file_conflicts(
            vec![noncanonical_src.to_string_lossy().into()],
            dst_dir.to_string_lossy().into(),
        )
        .unwrap();
        let result = move_files(
            vec![noncanonical_src.to_string_lossy().into()],
            dst_dir.to_string_lossy().into(),
            Some(MoveConflictStrategy::Abort),
        )
        .unwrap();

        assert!(conflicts.is_empty());
        assert_eq!(result.skipped_same_dir, 1);
        assert_eq!(result.conflicts.len(), 0);
        assert_eq!(result.moved.len(), 0);
        assert!(file.exists());

        let _ = std::fs::remove_dir_all(&temp);
    }

    #[test]
    fn copy_files_rejects_noncanonical_copy_into_self() {
        let temp = std::env::temp_dir().join(format!("aether-copy-canonical-self-{}", std::process::id()));
        let src_dir = temp.join("src");
        let dst_dir = src_dir.join("child");
        let _ = std::fs::remove_dir_all(&temp);
        std::fs::create_dir_all(&dst_dir).unwrap();
        std::fs::write(src_dir.join("file.txt"), b"content").unwrap();

        let noncanonical_src = temp.join(".").join("src");
        let result = copy_files(
            vec![noncanonical_src.to_string_lossy().into()],
            dst_dir.to_string_lossy().into(),
            Some(MoveConflictStrategy::Abort),
        )
        .unwrap();

        assert_eq!(result.copied.len(), 0);
        assert_eq!(result.failed.len(), 1);
        assert_eq!(result.failed[0].error, "目标在源目录内");

        let _ = std::fs::remove_dir_all(&temp);
    }

    #[test]
    fn copy_file_with_progress_updates_bytes_and_items() {
        let temp = std::env::temp_dir().join(format!("aether-copy-progress-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&temp);
        std::fs::create_dir_all(&temp).unwrap();

        let src = temp.join("large.bin");
        let dst = temp.join("large-copy.bin");
        let content = vec![42_u8; 1024 * 1024 + 128];
        std::fs::write(&src, &content).unwrap();

        let state = TransferTaskState::default();
        let cancel_requested = Arc::new(AtomicBool::new(false));
        state
            .insert(
                TransferTaskSnapshot {
                    id: "copy-test".into(),
                    kind: "copy".into(),
                    status: "running".into(),
                    total_items: 1,
                    completed_items: 0,
                    total_bytes: content.len() as u64,
                    completed_bytes: 0,
                    current_name: None,
                    error: None,
                    started_at: now_unix_seconds(),
                    finished_at: None,
                    copied: 0,
                    moved: 0,
                    copied_cross_device: 0,
                    failed: 0,
                    conflicts: 0,
                    skipped: 0,
                    skipped_same_dir: 0,
                    skipped_conflicts: 0,
                },
                cancel_requested.clone(),
            )
            .unwrap();
        let progress = TransferProgress {
            task_id: "copy-test".into(),
            state: state.clone(),
            cancel_requested,
        };

        copy_file_with_progress(&src, &dst, Some(&progress)).unwrap();

        let snapshot = state.list().unwrap().into_iter().next().unwrap();
        assert_eq!(snapshot.completed_items, 1);
        assert_eq!(snapshot.completed_bytes, content.len() as u64);
        assert_eq!(std::fs::read(&dst).unwrap(), content);

        let _ = std::fs::remove_dir_all(&temp);
    }

    #[test]
    fn copy_file_with_progress_removes_staged_target_on_cancel() {
        let temp = std::env::temp_dir().join(format!("aether-copy-file-cancel-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&temp);
        std::fs::create_dir_all(&temp).unwrap();

        let src = temp.join("source.bin");
        let dst = temp.join("target.bin");
        std::fs::write(&src, vec![7_u8; 1024]).unwrap();

        let state = TransferTaskState::default();
        let cancel_requested = Arc::new(AtomicBool::new(true));
        let progress = TransferProgress {
            task_id: "copy-cancel".into(),
            state,
            cancel_requested,
        };

        let result = copy_file_with_progress(&src, &dst, Some(&progress));

        assert!(result.is_err());
        assert!(!dst.exists());
        assert!(std::fs::read_dir(&temp)
            .unwrap()
            .all(|entry| !entry.unwrap().file_name().to_string_lossy().contains("aether-copy-temp")));

        let _ = std::fs::remove_dir_all(&temp);
    }

    #[test]
    fn copy_dir_recursive_with_progress_removes_staged_tree_on_cancel() {
        let temp = std::env::temp_dir().join(format!("aether-copy-dir-cancel-{}", std::process::id()));
        let src = temp.join("src");
        let dst = temp.join("dst");
        let _ = std::fs::remove_dir_all(&temp);
        std::fs::create_dir_all(src.join("nested")).unwrap();
        std::fs::write(src.join("nested").join("file.txt"), b"content").unwrap();

        let state = TransferTaskState::default();
        let cancel_requested = Arc::new(AtomicBool::new(true));
        let progress = TransferProgress {
            task_id: "copy-dir-cancel".into(),
            state,
            cancel_requested,
        };

        let result = copy_dir_recursive_with_progress(&src, &dst, Some(&progress));

        assert!(result.is_err());
        assert!(!dst.exists());
        assert!(std::fs::read_dir(&temp)
            .unwrap()
            .all(|entry| !entry.unwrap().file_name().to_string_lossy().contains("aether-copy-dir-temp")));

        let _ = std::fs::remove_dir_all(&temp);
    }

    #[test]
    fn copy_dir_recursive_copies_symlink_without_following_target() {
        let temp = std::env::temp_dir().join(format!("aether-copy-symlink-dir-{}", std::process::id()));
        let src = temp.join("src");
        let outside = temp.join("outside");
        let dst = temp.join("dst");
        let _ = std::fs::remove_dir_all(&temp);
        std::fs::create_dir_all(&src).unwrap();
        std::fs::create_dir_all(&outside).unwrap();
        std::fs::write(outside.join("secret.txt"), b"secret").unwrap();
        unix_fs::symlink(&outside, src.join("outside-link")).unwrap();

        copy_dir_recursive(&src, &dst).unwrap();

        let copied_link = dst.join("outside-link");
        assert!(std::fs::symlink_metadata(&copied_link).unwrap().file_type().is_symlink());
        assert_eq!(std::fs::read_link(&copied_link).unwrap(), outside);
        assert!(!dst.join("outside").exists());

        let _ = std::fs::remove_dir_all(&temp);
    }

    #[test]
    fn copy_dir_recursive_copies_self_symlink_without_recursing() {
        let temp = std::env::temp_dir().join(format!("aether-copy-self-symlink-{}", std::process::id()));
        let src = temp.join("src");
        let dst = temp.join("dst");
        let _ = std::fs::remove_dir_all(&temp);
        std::fs::create_dir_all(&src).unwrap();
        std::fs::write(src.join("file.txt"), b"content").unwrap();
        unix_fs::symlink(&src, src.join("self-link")).unwrap();

        copy_dir_recursive(&src, &dst).unwrap();

        let copied_link = dst.join("self-link");
        assert!(std::fs::symlink_metadata(&copied_link).unwrap().file_type().is_symlink());
        assert_eq!(std::fs::read_link(&copied_link).unwrap(), src);
        assert_eq!(std::fs::read_to_string(dst.join("file.txt")).unwrap(), "content");

        let _ = std::fs::remove_dir_all(&temp);
    }

    #[test]
    fn copy_files_preserves_dangling_symlink() {
        let temp = std::env::temp_dir().join(format!("aether-copy-dangling-symlink-{}", std::process::id()));
        let src_dir = temp.join("src");
        let dst_dir = temp.join("dst");
        let _ = std::fs::remove_dir_all(&temp);
        std::fs::create_dir_all(&src_dir).unwrap();
        std::fs::create_dir_all(&dst_dir).unwrap();
        let missing_target = temp.join("missing-target");
        let link = src_dir.join("dangling-link");
        unix_fs::symlink(&missing_target, &link).unwrap();

        let result = copy_files(
            vec![link.to_string_lossy().into()],
            dst_dir.to_string_lossy().into(),
            Some(MoveConflictStrategy::Abort),
        )
        .unwrap();

        let copied_link = dst_dir.join("dangling-link");
        assert_eq!(result.copied.len(), 1);
        assert!(std::fs::symlink_metadata(&copied_link).unwrap().file_type().is_symlink());
        assert_eq!(std::fs::read_link(&copied_link).unwrap(), missing_target);
        assert!(!copied_link.exists());

        let _ = std::fs::remove_dir_all(&temp);
    }

    #[test]
    fn copy_file_command_preserves_symlink() {
        let temp = std::env::temp_dir().join(format!("aether-copy-command-symlink-{}", std::process::id()));
        let src_dir = temp.join("src");
        let dst_dir = temp.join("dst");
        let _ = std::fs::remove_dir_all(&temp);
        std::fs::create_dir_all(&src_dir).unwrap();
        std::fs::create_dir_all(&dst_dir).unwrap();
        let real_file = src_dir.join("real.txt");
        let link = src_dir.join("real-link.txt");
        std::fs::write(&real_file, b"real").unwrap();
        unix_fs::symlink(&real_file, &link).unwrap();

        let copied = copy_file(link.to_string_lossy().into(), dst_dir.to_string_lossy().into()).unwrap();
        let copied_link = PathBuf::from(copied);

        assert!(std::fs::symlink_metadata(&copied_link).unwrap().file_type().is_symlink());
        assert_eq!(std::fs::read_link(&copied_link).unwrap(), real_file);

        let _ = std::fs::remove_dir_all(&temp);
    }

    #[test]
    fn commit_staged_path_removes_staged_target_when_cancelled() {
        let temp = std::env::temp_dir().join(format!("aether-commit-cancel-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&temp);
        std::fs::create_dir_all(&temp).unwrap();

        let staged = temp.join(".target.aether-copy-temp-test");
        let dst = temp.join("target.txt");
        std::fs::write(&staged, b"partial").unwrap();

        let state = TransferTaskState::default();
        let cancel_requested = Arc::new(AtomicBool::new(true));
        let progress = TransferProgress {
            task_id: "commit-cancel".into(),
            state,
            cancel_requested,
        };

        let result = commit_staged_path(&staged, &dst, Some(&progress));

        assert!(result.is_err());
        assert!(!staged.exists());
        assert!(!dst.exists());

        let _ = std::fs::remove_dir_all(&temp);
    }

    #[test]
    fn replace_existing_for_copy_restores_target_when_cancelled() {
        let temp = std::env::temp_dir().join(format!("aether-replace-copy-cancel-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&temp);
        std::fs::create_dir_all(&temp).unwrap();

        let src = temp.join("source.txt");
        let dst = temp.join("target.txt");
        std::fs::write(&src, b"new").unwrap();
        std::fs::write(&dst, b"old").unwrap();

        let state = TransferTaskState::default();
        let cancel_requested = Arc::new(AtomicBool::new(true));
        let progress = TransferProgress {
            task_id: "replace-copy-cancel".into(),
            state,
            cancel_requested,
        };

        let result = replace_existing_for_copy_with_progress(&src, &dst, Some(&progress));

        assert!(result.is_err());
        assert_eq!(std::fs::read_to_string(&dst).unwrap(), "old");
        assert!(std::fs::read_dir(&temp)
            .unwrap()
            .all(|entry| !entry.unwrap().file_name().to_string_lossy().contains("aether-replace-backup")));

        let _ = std::fs::remove_dir_all(&temp);
    }

    // ── shell_quote ──
    #[test]
    fn shell_quote_wraps_simple() {
        assert_eq!(shell_quote("hello"), "'hello'");
        assert_eq!(shell_quote(""), "''");
    }

    #[test]
    fn shell_quote_escapes_single_quote() {
        // POSIX 标准转义：'it' + \\' + 's' → 'it'\''s'
        assert_eq!(shell_quote("it's"), "'it'\\''s'");
    }

    #[test]
    fn shell_quote_keeps_shell_meta_safe() {
        // 这些字符在引号内都不会被 shell 解释
        assert_eq!(shell_quote("$(rm -rf /)"), "'$(rm -rf /)'");
        assert_eq!(shell_quote("`whoami`"), "'`whoami`'");
        assert_eq!(shell_quote("foo;bar"), "'foo;bar'");
        assert_eq!(shell_quote("foo|bar"), "'foo|bar'");
        assert_eq!(shell_quote("foo && bar"), "'foo && bar'");
    }

    #[test]
    fn shell_quote_paths_with_spaces() {
        assert_eq!(shell_quote("/Users/jane/My Documents"), "'/Users/jane/My Documents'");
    }

    // ── encode_query_component ──
    #[test]
    fn encode_query_component_keeps_safe_chars() {
        assert_eq!(encode_query_component("abc123"), "abc123");
        assert_eq!(encode_query_component("a-b_c.d~e"), "a-b_c.d~e");
    }

    #[test]
    fn encode_query_component_percent_encodes_unsafe() {
        assert_eq!(encode_query_component(" "), "%20");
        assert_eq!(encode_query_component("a/b"), "a%2Fb");
        assert_eq!(encode_query_component("a&b"), "a%26b");
        assert_eq!(encode_query_component("a=b"), "a%3Db");
    }

    #[test]
    fn encode_query_component_handles_multibyte() {
        // 中文按 UTF-8 三字节编码
        assert_eq!(encode_query_component("中"), "%E4%B8%AD");
    }

    // ── validate_shell_fragment ──
    #[test]
    fn validate_shell_fragment_accepts_safe_input() {
        assert_eq!(validate_shell_fragment("npm run dev").unwrap(), "npm run dev");
        assert_eq!(validate_shell_fragment("  ls -la  ").unwrap(), "ls -la");
    }

    #[test]
    fn validate_shell_fragment_allows_quoted_file_placeholders() {
        assert_eq!(
            validate_shell_fragment("code '/Users/jane/My Files/it'\\''s $(secret);.txt'").unwrap(),
            "code '/Users/jane/My Files/it'\\''s $(secret);.txt'",
        );
        assert_eq!(
            validate_shell_fragment("open '/tmp/name|with>meta<chars'").unwrap(),
            "open '/tmp/name|with>meta<chars'",
        );
    }

    #[test]
    fn validate_shell_fragment_rejects_injection() {
        assert!(validate_shell_fragment("rm -rf /; echo ok").is_err());
        assert!(validate_shell_fragment("cat x | grep y").is_err());
        assert!(validate_shell_fragment("a && b").is_err());
        assert!(validate_shell_fragment("a || b").is_err());
        assert!(validate_shell_fragment("$(whoami)").is_err());
        assert!(validate_shell_fragment("`whoami`").is_err());
        assert!(validate_shell_fragment("x > /etc/passwd").is_err());
        assert!(validate_shell_fragment("x < secrets").is_err());
        assert!(validate_shell_fragment("a\nb").is_err());
    }

    #[test]
    fn validate_shell_fragment_rejects_unclosed_quote() {
        assert!(validate_shell_fragment("code '/tmp/unfinished").is_err());
    }

    #[test]
    fn validate_shell_fragment_rejects_empty() {
        assert!(validate_shell_fragment("").is_err());
        assert!(validate_shell_fragment("   ").is_err());
    }

    // ── is_allowed_terminal ──
    #[test]
    fn is_allowed_terminal_accepts_known() {
        assert!(is_allowed_terminal("Terminal"));
        assert!(is_allowed_terminal("iTerm"));
        assert!(is_allowed_terminal("ITERM2"));   // 大小写不敏感
        assert!(is_allowed_terminal("warp"));
        assert!(is_allowed_terminal("WezTerm"));
    }

    #[test]
    fn is_allowed_terminal_rejects_injection() {
        // 攻击者控制 app_name 不应能注入 AppleScript
        assert!(!is_allowed_terminal("Foo\"; do shell script \"evil"));
        assert!(!is_allowed_terminal(""));
        assert!(!is_allowed_terminal("SomeRandomApp"));
        assert!(!is_allowed_terminal("Terminal.app")); // 必须是不带后缀
    }

    #[test]
    fn open_terminal_at_rejects_disallowed_terminal_with_structured_error() {
        let err = open_terminal_at(
            "/tmp".to_string(),
            Some("Bad\"Terminal".to_string()),
            None,
            None,
            None,
        )
        .unwrap_err();

        assert_eq!(err.kind, AppErrorKind::InvalidPath);
        assert!(err.message.contains("不允许的终端应用"));
    }

    // ── apple_quote ──
    #[test]
    fn apple_quote_wraps_simple() {
        assert_eq!(apple_quote("Terminal"), "\"Terminal\"");
    }

    #[test]
    fn apple_quote_escapes_quotes_and_backslash() {
        assert_eq!(apple_quote(r#"it"s"#), "\"it\\\"s\"");
        assert_eq!(apple_quote(r"a\b"), "\"a\\\\b\"");
    }

    // ── is_sensitive_for_preview ──
    #[test]
    fn is_sensitive_for_preview_blocks_env_and_keys() {
        assert!(is_sensitive_for_preview(Path::new("/Users/x/.env")));
        assert!(is_sensitive_for_preview(Path::new("/Users/x/.ENV")));
        assert!(is_sensitive_for_preview(Path::new("/Users/x/.envrc")));
        assert!(is_sensitive_for_preview(Path::new("/Users/x/.ssh/id_rsa")));
        assert!(is_sensitive_for_preview(Path::new("/Users/x/.ssh/id_ed25519")));
        assert!(is_sensitive_for_preview(Path::new("/Users/x/.aws/credentials")));
        assert!(is_sensitive_for_preview(Path::new("/Users/x/.netrc")));
    }

    #[test]
    fn is_sensitive_for_preview_allows_normal_files() {
        assert!(!is_sensitive_for_preview(Path::new("/Users/x/notes.md")));
        assert!(!is_sensitive_for_preview(Path::new("/Users/x/.gitignore")));
        assert!(!is_sensitive_for_preview(Path::new("/Users/x/script.sh")));
    }

    #[test]
    fn read_text_preview_rejects_sensitive_files_with_permission_error() {
        let err = read_text_preview("/tmp/.env".to_string()).unwrap_err();

        assert_eq!(err.kind, AppErrorKind::PermissionDenied);
        assert_eq!(err.path.as_deref(), Some("/tmp/.env"));
    }

    #[test]
    fn read_text_preview_rejects_invalid_utf8_with_invalid_path_error() {
        let temp = std::env::temp_dir().join(format!("aether-preview-invalid-{}", std::process::id()));
        let _ = std::fs::remove_file(&temp);
        std::fs::write(&temp, [0xff, 0xfe, 0xfd]).unwrap();

        let err = read_text_preview(temp.to_string_lossy().to_string()).unwrap_err();
        assert_eq!(err.kind, AppErrorKind::InvalidPath);
        assert_eq!(err.path.as_deref(), Some(temp.to_string_lossy().as_ref()));

        let _ = std::fs::remove_file(&temp);
    }

    #[test]
    fn list_directory_entries_sorts_dirs_first_and_hides_dotfiles() {
        let temp = std::env::temp_dir().join(format!("aether-list-dir-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&temp);
        std::fs::create_dir_all(temp.join("z-folder")).unwrap();
        std::fs::create_dir_all(temp.join("a-folder")).unwrap();
        std::fs::write(temp.join("b-file.txt"), b"b").unwrap();
        std::fs::write(temp.join("a-file.txt"), b"a").unwrap();
        std::fs::write(temp.join(".hidden"), b"x").unwrap();

        let entries = list_directory_entries(temp.to_string_lossy().as_ref(), false, None).unwrap();
        let names: Vec<String> = entries.into_iter().map(|entry| entry.name).collect();
        assert_eq!(names, vec!["a-folder", "z-folder", "a-file.txt", "b-file.txt"]);

        let _ = std::fs::remove_dir_all(&temp);
    }

    #[test]
    fn list_directory_entries_can_include_hidden_files() {
        let temp = std::env::temp_dir().join(format!("aether-list-hidden-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&temp);
        std::fs::create_dir_all(&temp).unwrap();
        std::fs::write(temp.join(".hidden"), b"x").unwrap();

        let entries = list_directory_entries(temp.to_string_lossy().as_ref(), true, None).unwrap();
        assert!(entries.iter().any(|entry| entry.name == ".hidden"));

        let _ = std::fs::remove_dir_all(&temp);
    }

    #[test]
    fn list_directory_entries_stops_when_load_token_is_cancelled() {
        let temp = std::env::temp_dir().join(format!("aether-list-cancel-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&temp);
        std::fs::create_dir_all(&temp).unwrap();
        for index in 0..8 {
            std::fs::write(temp.join(format!("file-{}.txt", index)), b"x").unwrap();
        }

        let state = DirectoryLoadState::default();
        let token = state.begin(Some("main".to_string()), Some(1)).unwrap().unwrap();
        state.mark_latest("main".to_string(), 2).unwrap();

        let err = list_directory_entries(temp.to_string_lossy().as_ref(), true, Some(token)).unwrap_err();
        assert_eq!(err.kind, AppErrorKind::Cancelled);

        let _ = std::fs::remove_dir_all(&temp);
    }

    #[test]
    fn directory_signature_changes_when_visible_entries_change() {
        let temp = std::env::temp_dir().join(format!("aether-dir-signature-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&temp);
        std::fs::create_dir_all(&temp).unwrap();
        std::fs::write(temp.join("a.txt"), b"a").unwrap();

        let before = directory_signature_for_path(temp.to_string_lossy().as_ref(), false).unwrap();
        std::fs::write(temp.join("b.txt"), b"b").unwrap();
        let after = directory_signature_for_path(temp.to_string_lossy().as_ref(), false).unwrap();

        assert_ne!(before.fingerprint, after.fingerprint);
        assert_eq!(before.entry_count, 1);
        assert_eq!(after.entry_count, 2);

        let _ = std::fs::remove_dir_all(&temp);
    }

    #[test]
    fn directory_signature_respects_hidden_file_filter() {
        let temp = std::env::temp_dir().join(format!("aether-dir-signature-hidden-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&temp);
        std::fs::create_dir_all(&temp).unwrap();

        let hidden_before = directory_signature_for_path(temp.to_string_lossy().as_ref(), false).unwrap();
        std::fs::write(temp.join(".hidden"), b"x").unwrap();
        let hidden_after = directory_signature_for_path(temp.to_string_lossy().as_ref(), false).unwrap();
        let visible_hidden = directory_signature_for_path(temp.to_string_lossy().as_ref(), true).unwrap();

        assert_eq!(hidden_before.fingerprint, hidden_after.fingerprint);
        assert_eq!(hidden_after.entry_count, 0);
        assert_eq!(visible_hidden.entry_count, 1);
        assert_ne!(hidden_after.fingerprint, visible_hidden.fingerprint);

        let _ = std::fs::remove_dir_all(&temp);
    }

    // ── AppError ──
    #[test]
    fn app_error_from_io_classifies_common_kinds() {
        let permission = std::io::Error::new(ErrorKind::PermissionDenied, "no");
        let not_found = std::io::Error::new(ErrorKind::NotFound, "missing");
        let busy = std::io::Error::other("resource busy");

        let permission_error = AppError::from_io(&permission, Some("/secret"), "fallback");
        let not_found_error = AppError::from_io(&not_found, Some("/missing"), "fallback");
        let busy_error = AppError::from_io(&busy, Some("/tmp/file"), "fallback");

        assert_eq!(permission_error.kind, AppErrorKind::PermissionDenied);
        assert_eq!(permission_error.path.as_deref(), Some("/secret"));
        assert_eq!(not_found_error.kind, AppErrorKind::NotFound);
        assert_eq!(busy_error.kind, AppErrorKind::Busy);
    }

    #[test]
    fn app_error_unavailable_is_structured_internal_error() {
        let err = AppError::unavailable("文件剪贴板不可用");

        assert_eq!(err.kind, AppErrorKind::Internal);
        assert_eq!(err.message, "文件剪贴板不可用");
        assert_eq!(err.path, None);
    }

    #[test]
    fn app_error_internal_at_preserves_path_context() {
        let err = AppError::internal_at("打开失败", Some("/tmp/demo.txt".to_string()));

        assert_eq!(err.kind, AppErrorKind::Internal);
        assert_eq!(err.message, "打开失败");
        assert_eq!(err.path.as_deref(), Some("/tmp/demo.txt"));
    }

    #[test]
    fn trash_delete_error_external_volume_is_explicitly_unsupported() {
        let err = trash_delete_error("/Volumes/USB/a.txt", "unsupported");

        assert_eq!(err.kind, AppErrorKind::TrashUnsupported);
        assert_eq!(err.path.as_deref(), Some("/Volumes/USB/a.txt"));
        assert!(err.message.contains("操作已取消"));
        assert!(err.message.contains("不会改用永久删除"));
    }

    #[test]
    fn trash_delete_error_regular_path_stays_internal_failure() {
        let err = trash_delete_error("/Users/jane/a.txt", "boom");

        assert_eq!(err.kind, AppErrorKind::Internal);
        assert_eq!(err.path.as_deref(), Some("/Users/jane/a.txt"));
        assert!(err.message.contains("移至废纸篓失败"));
    }

    #[test]
    fn get_dir_size_rejects_non_directory_with_invalid_path_error() {
        let temp = std::env::temp_dir().join(format!("aether-dir-size-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&temp);
        std::fs::create_dir_all(&temp).unwrap();
        let file = temp.join("file.txt");
        std::fs::write(&file, b"x").unwrap();

        let err = get_dir_size(file.to_string_lossy().to_string()).unwrap_err();
        assert_eq!(err.kind, AppErrorKind::InvalidPath);
        assert_eq!(err.path.as_deref(), Some(file.to_string_lossy().as_ref()));

        let _ = std::fs::remove_dir_all(&temp);
    }

    #[test]
    fn get_dir_size_includes_nested_files_and_disk_size_fields() {
        let temp = std::env::temp_dir().join(format!("aether-dir-size-nested-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&temp);
        let nested = temp.join("nested");
        std::fs::create_dir_all(&nested).unwrap();
        std::fs::write(temp.join("a.txt"), b"abc").unwrap();
        std::fs::write(nested.join("b.txt"), b"12345").unwrap();

        let result = get_dir_size(temp.to_string_lossy().to_string()).unwrap();
        assert_eq!(result["path"].as_str(), Some(temp.to_string_lossy().as_ref()));
        assert_eq!(result["bytes"].as_u64(), Some(8));
        assert_eq!(result["formatted"].as_str(), Some("8 B"));
        assert_eq!(result["file_count"].as_u64(), Some(2));
        assert_eq!(result["skipped_count"].as_u64(), Some(0));
        assert!(result["allocated_bytes"].as_u64().is_some());
        assert!(result["formatted_allocated"].as_str().is_some());

        let _ = std::fs::remove_dir_all(&temp);
    }

    #[test]
    fn dir_size_recursive_skips_symlinks_without_following_them() {
        let temp = std::env::temp_dir().join(format!("aether-dir-size-symlink-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&temp);
        std::fs::create_dir_all(&temp).unwrap();
        let real_file = temp.join("real.txt");
        std::fs::write(&real_file, b"real").unwrap();
        unix_fs::symlink(&real_file, temp.join("real-link")).unwrap();

        let summary = dir_size_recursive(&temp);
        assert_eq!(summary.bytes, 4);
        assert_eq!(summary.file_count, 1);
        assert_eq!(summary.skipped_count, 1);

        let _ = std::fs::remove_dir_all(&temp);
    }

    // ── file operation safety ──
    #[test]
    fn validate_child_name_accepts_single_safe_name() {
        assert_eq!(validate_child_name(" report.txt ").unwrap(), "report.txt");
        assert_eq!(validate_child_name("新建文件夹").unwrap(), "新建文件夹");
    }

    #[test]
    fn validate_child_name_rejects_paths_and_illegal_chars() {
        assert!(validate_child_name("").is_err());
        assert!(validate_child_name(".").is_err());
        assert!(validate_child_name("..").is_err());
        assert!(validate_child_name("../secret").is_err());
        assert!(validate_child_name("/tmp/secret").is_err());
        assert!(validate_child_name("a/b").is_err());
        assert!(validate_child_name("a\\b").is_err());
        assert!(validate_child_name("bad:name").is_err());
        assert!(validate_child_name("bad\nname").is_err());
    }

    #[test]
    fn validate_child_name_returns_invalid_path_error() {
        let err = validate_child_name("../secret").unwrap_err();
        assert_eq!(err.kind, AppErrorKind::InvalidPath);
        assert_eq!(err.path.as_deref(), Some("../secret"));
    }

    #[test]
    fn eject_volume_rejects_non_volume_paths_with_invalid_path_error() {
        let err = eject_volume("/".to_string()).unwrap_err();

        assert_eq!(err.kind, AppErrorKind::InvalidPath);
        assert_eq!(err.message, "只能弹出 /Volumes 下的外置磁盘");
        assert_eq!(err.path.as_deref(), Some("/"));
    }

    #[test]
    fn replace_existing_for_copy_restores_target_on_failure() {
        let temp = std::env::temp_dir().join(format!("aether-replace-copy-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&temp);
        std::fs::create_dir_all(&temp).unwrap();

        let src = temp.join("missing.txt");
        let dst = temp.join("target.txt");
        std::fs::write(&dst, b"original").unwrap();

        assert!(replace_existing_for_copy(&src, &dst).is_err());
        assert_eq!(std::fs::read_to_string(&dst).unwrap(), "original");

        let _ = std::fs::remove_dir_all(&temp);
    }

    #[test]
    fn replace_existing_for_move_restores_target_on_failure() {
        let temp = std::env::temp_dir().join(format!("aether-replace-move-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&temp);
        std::fs::create_dir_all(&temp).unwrap();

        let src = temp.join("missing.txt");
        let dst = temp.join("target.txt");
        std::fs::write(&dst, b"original").unwrap();

        assert!(replace_existing_for_move(&src, &dst).is_err());
        assert_eq!(std::fs::read_to_string(&dst).unwrap(), "original");

        let _ = std::fs::remove_dir_all(&temp);
    }

    #[test]
    fn cross_device_rename_error_detects_exdev() {
        let err = std::io::Error::from_raw_os_error(18);
        assert!(is_cross_device_rename_error(&err));
    }

    #[test]
    fn decompress_file_rejects_existing_output_file() {
        let temp = std::env::temp_dir().join(format!("aether-decompress-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&temp);
        std::fs::create_dir_all(&temp).unwrap();

        let zip_path = temp.join("archive.zip");
        let output_dir = temp.join("out");
        std::fs::create_dir_all(&output_dir).unwrap();
        std::fs::write(output_dir.join("same.txt"), b"original").unwrap();

        {
            let file = std::fs::File::create(&zip_path).unwrap();
            let mut writer = zip::ZipWriter::new(file);
            writer
                .start_file("same.txt", zip::write::SimpleFileOptions::default())
                .unwrap();
            std::io::Write::write_all(&mut writer, b"new").unwrap();
            writer.finish().unwrap();
        }

        let result = decompress_file(
            zip_path.to_string_lossy().to_string(),
            output_dir.to_string_lossy().to_string(),
        );

        let err = result.unwrap_err();
        assert_eq!(err.kind, AppErrorKind::Conflict);
        assert_eq!(err.path.as_deref(), Some(output_dir.join("same.txt").to_string_lossy().as_ref()));
        assert_eq!(std::fs::read_to_string(output_dir.join("same.txt")).unwrap(), "original");

        let _ = std::fs::remove_dir_all(&temp);
    }
}
