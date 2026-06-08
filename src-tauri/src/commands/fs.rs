use std::collections::{HashMap, HashSet};
use std::fs;
use std::hash::{Hash, Hasher};
use std::os::unix::fs::MetadataExt;
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

use crate::commands;
use crate::error::{AppError, AppErrorKind};
use crate::models::{
    DirectorySignature, DirectorySizeEstimate, DirectorySizeTaskSnapshot, FileEntry,
    FileHashResult, OpenWithOption, PermissionPreflightResult,
};
use crate::{next_transfer_task_id, now_unix_seconds};

#[derive(Clone, Default)]
pub(crate) struct DirectoryLoadState(Arc<Mutex<HashMap<String, u64>>>);

#[derive(Clone)]
pub(crate) struct DirectoryLoadToken {
    scope: String,
    request_id: u64,
    latest_requests: Arc<Mutex<HashMap<String, u64>>>,
}

impl DirectoryLoadState {
    pub(crate) fn mark_latest(&self, scope: String, request_id: u64) -> Result<(), AppError> {
        let mut latest = self
            .0
            .lock()
            .map_err(|_| AppError::unavailable("目录加载状态不可用"))?;
        let should_update = match latest.get(&scope).copied() {
            Some(current) => request_id >= current,
            None => true,
        };
        if should_update {
            latest.insert(scope, request_id);
        }
        Ok(())
    }

    pub(crate) fn begin(
        &self,
        scope: Option<String>,
        request_id: Option<u64>,
    ) -> Result<Option<DirectoryLoadToken>, AppError> {
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
    pub(crate) fn is_cancelled(&self) -> bool {
        match self.latest_requests.lock() {
            Ok(latest) => latest.get(&self.scope).copied() != Some(self.request_id),
            Err(_) => true,
        }
    }
}

#[derive(Clone, Default)]
pub(crate) struct DirectorySizeTaskState(Arc<Mutex<HashMap<String, DirectorySizeTask>>>);

#[derive(Clone)]
pub(crate) struct DirectorySizeTask {
    snapshot: DirectorySizeTaskSnapshot,
    cancel_requested: Arc<AtomicBool>,
}

impl DirectorySizeTaskState {
    pub(crate) fn insert(
        &self,
        snapshot: DirectorySizeTaskSnapshot,
        cancel_requested: Arc<AtomicBool>,
    ) -> Result<(), AppError> {
        let mut tasks = self
            .0
            .lock()
            .map_err(|_| AppError::unavailable("目录大小任务状态不可用"))?;
        tasks.insert(
            snapshot.id.clone(),
            DirectorySizeTask {
                snapshot,
                cancel_requested,
            },
        );
        Ok(())
    }

    fn update<F>(&self, task_id: &str, update: F)
    where
        F: FnOnce(&mut DirectorySizeTaskSnapshot),
    {
        match self.0.lock() {
            Ok(mut tasks) => {
                if let Some(task) = tasks.get_mut(task_id) {
                    update(&mut task.snapshot);
                }
            }
            Err(_) => log::error!("目录大小任务状态锁不可用，无法更新任务 {}", task_id),
        }
    }

    pub(crate) fn get(&self, task_id: &str) -> Result<Option<DirectorySizeTaskSnapshot>, AppError> {
        let tasks = self
            .0
            .lock()
            .map_err(|_| AppError::unavailable("目录大小任务状态不可用"))?;
        Ok(tasks.get(task_id).map(|task| task.snapshot.clone()))
    }

    pub(crate) fn cancel(&self, task_id: &str) -> Result<(), AppError> {
        let mut tasks = self
            .0
            .lock()
            .map_err(|_| AppError::unavailable("目录大小任务状态不可用"))?;
        if let Some(task) = tasks.get_mut(task_id) {
            task.cancel_requested.store(true, Ordering::SeqCst);
        }
        Ok(())
    }

    pub(crate) fn cleanup_finished(&self) {
        let cutoff = now_unix_seconds().saturating_sub(FINISHED_DIR_SIZE_TASK_RETENTION_SECONDS);
        if let Ok(mut tasks) = self.0.lock() {
            tasks.retain(|_, task| {
                if !matches!(
                    task.snapshot.status.as_str(),
                    "completed" | "failed" | "cancelled"
                ) {
                    return true;
                }
                task.snapshot.finished_at.unwrap_or(u64::MAX) >= cutoff
            });
        }
    }
}

const FINISHED_DIR_SIZE_TASK_RETENTION_SECONDS: u64 = 30;

pub(crate) fn next_directory_size_task_id() -> String {
    next_transfer_task_id("dir-size")
}

pub(crate) fn normalize_open_with_options(options: Vec<OpenWithOption>) -> Vec<OpenWithOption> {
    fn should_skip_open_with_path(path: &str) -> bool {
        path.contains("/Contents/Helpers/")
            || path.contains("/Contents/Frameworks/")
            || path.contains("/Library/Application Support/")
    }

    fn score_open_with_option(option: &OpenWithOption) -> i32 {
        let mut score = 0;
        if option.is_default {
            score += 100;
        }
        if option.path.starts_with("/System/Applications/") {
            score += 20;
        } else if option.path.starts_with("/Applications/")
            || option.path.contains("/Applications/")
        {
            score += 12;
        }
        if option.path.contains("/Contents/Helpers/") {
            score -= 20;
        }
        if option.path.contains("/Library/Application Support/") {
            score -= 12;
        }
        score -= option.path.len() as i32 / 32;
        score
    }

    let mut seen_paths = HashSet::new();
    let mut grouped: HashMap<String, OpenWithOption> = HashMap::new();
    for option in options {
        if option.path.trim().is_empty() || should_skip_open_with_path(&option.path) {
            continue;
        }
        if !seen_paths.insert(option.path.clone()) {
            continue;
        }

        let key = option.name.trim().to_lowercase();
        match grouped.get(&key) {
            Some(existing)
                if score_open_with_option(existing) >= score_open_with_option(&option) => {}
            _ => {
                grouped.insert(key, option);
            }
        }
    }

    let mut deduped: Vec<OpenWithOption> = grouped.into_values().collect();

    deduped.sort_by(|a, b| {
        if a.is_default != b.is_default {
            return b.is_default.cmp(&a.is_default);
        }
        a.name.to_lowercase().cmp(&b.name.to_lowercase())
    });

    deduped
}

pub(crate) fn normalize_selected_application_path(raw: &str) -> Option<String> {
    let trimmed = raw.trim().trim_end_matches('/');
    if trimmed.is_empty() {
        return None;
    }
    if !trimmed.to_lowercase().ends_with(".app") {
        return None;
    }
    Some(trimmed.to_string())
}

pub(crate) fn resolve_open_with_application_target(raw: &str) -> Result<String, AppError> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err(AppError::invalid_path(
            "目标应用无效",
            Some(raw.to_string()),
        ));
    }

    if let Some(app_path) = normalize_selected_application_path(trimmed) {
        let metadata = fs::metadata(&app_path).map_err(|e| {
            AppError::from_io(&e, Some(&app_path), format!("读取应用信息失败: {}", e))
        })?;
        if !metadata.is_dir() {
            return Err(AppError::invalid_path(
                "目标应用无效，必须选择 .app 应用程序",
                Some(app_path),
            ));
        }
        return Ok(app_path);
    }

    if trimmed.contains('/') {
        return Err(AppError::invalid_path(
            "目标应用无效，必须选择 .app 应用程序",
            Some(trimmed.to_string()),
        ));
    }

    Ok(trimmed.to_string())
}

pub(crate) fn format_size(bytes: u64) -> String {
    const KB: f64 = 1024.0;
    const MB: f64 = KB * 1024.0;
    const GB: f64 = MB * 1024.0;

    let b = bytes as f64;
    if b >= GB {
        format!("{:.1} G", b / GB)
    } else if b >= MB {
        format!("{:.1} M", b / MB)
    } else if b >= KB {
        format!("{:.1} K", b / KB)
    } else {
        format!("{} B", bytes)
    }
}

pub(crate) fn detect_mime(name: &str, is_dir: bool) -> String {
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
        "png" | "jpg" | "jpeg" | "gif" | "svg" | "webp" | "bmp" | "ico" | "tiff" | "tif"
        | "heic" | "heif" | "avif" => "image",
        "mp4" | "mov" | "mkv" | "avi" | "webm" | "m4v" | "flv" | "wmv" | "mpeg" | "mpg" => "video",
        "mp3" | "wav" | "aac" | "flac" | "ogg" | "m4a" | "aiff" | "aif" => "audio",
        "pdf" => "pdf",
        "zip" | "tar" | "gz" | "7z" | "rar" | "bz2" | "xz" | "tgz" | "dmg" | "pkg" | "iso" => {
            "archive"
        }
        "ts" | "tsx" | "js" | "jsx" | "mjs" | "cjs" | "py" | "rs" | "go" | "java" | "c" | "cc"
        | "cpp" | "h" | "hpp" | "swift" | "kt" | "rb" | "php" | "sh" | "bash" | "zsh" | "fish"
        | "sql" | "css" | "scss" | "html" | "vue" | "svelte" => "code",
        "txt" | "md" | "markdown" | "csv" | "tsv" | "json" | "yaml" | "yml" | "xml" | "toml"
        | "ini" | "cfg" | "conf" | "log" | "lock" | "rst" | "txt~" => "text",
        _ => "file",
    }
    .into()
}

pub(crate) fn find_app_icon_path(app_path: &Path) -> Option<String> {
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

pub(crate) fn app_icon_cache_dir() -> PathBuf {
    let base = std::env::var("HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|_| std::env::temp_dir());
    base.join("Library")
        .join("Caches")
        .join("Aether Explorer")
        .join("AppIcons")
}

pub(crate) fn app_icon_cache_path(app_path: &Path, source_icon: Option<&Path>) -> PathBuf {
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
pub(crate) fn export_workspace_app_icon(app_path: &Path, output_path: &Path) -> Result<(), String> {
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
pub(crate) fn export_workspace_app_icon(
    _app_path: &Path,
    _output_path: &Path,
) -> Result<(), String> {
    Err("unsupported platform".into())
}

pub(crate) fn convert_icns_to_png(icon_path: &Path, output_path: &Path) -> Result<(), String> {
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

pub(crate) fn resolve_app_icon_png(app_path: &Path) -> Option<String> {
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
pub(crate) fn get_app_icon(path: String) -> Result<Option<String>, AppError> {
    Ok(resolve_app_icon_png(Path::new(&path)))
}

#[cfg(target_os = "macos")]
pub(crate) fn resolve_bundle_identifier(app_path: &Path) -> String {
    let mdls_value = read_mdls_string(app_path, "kMDItemCFBundleIdentifier");
    if !mdls_value.is_empty() {
        return mdls_value;
    }

    let plist_path = app_path.join("Contents").join("Info.plist");
    std::process::Command::new("defaults")
        .arg("read")
        .arg(&plist_path)
        .arg("CFBundleIdentifier")
        .output()
        .ok()
        .filter(|output| output.status.success())
        .and_then(|output| String::from_utf8(output.stdout).ok())
        .map(|value| value.trim().to_string())
        .unwrap_or_default()
}

#[cfg(not(target_os = "macos"))]
pub(crate) fn resolve_bundle_identifier(_app_path: &Path) -> String {
    String::new()
}

#[cfg(target_os = "macos")]
pub(crate) fn resolve_content_type_identifier(path: &Path) -> String {
    let mdls_value = read_mdls_string(path, "kMDItemContentType");
    if !mdls_value.is_empty() {
        return mdls_value;
    }

    let Some(extension) = path
        .extension()
        .and_then(|ext| ext.to_str())
        .filter(|ext| !ext.is_empty())
    else {
        return String::new();
    };

    let script = r#"import UniformTypeIdentifiers
let ext = CommandLine.arguments[1]
if let type = UTType(filenameExtension: ext) {
    print(type.identifier)
}"#;

    std::process::Command::new("swift")
        .args(["-e", script])
        .arg(extension)
        .output()
        .ok()
        .filter(|output| output.status.success())
        .and_then(|output| String::from_utf8(output.stdout).ok())
        .map(|value| value.trim().to_string())
        .unwrap_or_default()
}

#[cfg(not(target_os = "macos"))]
pub(crate) fn resolve_content_type_identifier(_path: &Path) -> String {
    String::new()
}

#[cfg(target_os = "macos")]
pub(crate) fn list_open_with_paths(path: &Path) -> Result<Vec<String>, AppError> {
    let script = r#"ObjC.import("AppKit");
function run(argv) {
  const url = $.NSURL.fileURLWithPath(argv[0]);
  const apps = $.NSWorkspace.sharedWorkspace.URLsForApplicationsToOpenURL(url);
  if (!apps) return "";
  const lines = [];
  for (const item of ObjC.unwrap(apps)) {
    lines.push(ObjC.unwrap(item.path));
  }
  return lines.join("\n");
}"#;

    let output = std::process::Command::new("osascript")
        .args(["-l", "JavaScript", "-e", script])
        .arg(path)
        .output()
        .map_err(|e| {
            AppError::internal_at(
                format!("读取打开方式列表失败: {}", e),
                Some(path.to_string_lossy().to_string()),
            )
        })?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(AppError::internal_at(
            format!(
                "读取打开方式列表失败: {}",
                if stderr.is_empty() {
                    "osascript exited unexpectedly"
                } else {
                    &stderr
                }
            ),
            Some(path.to_string_lossy().to_string()),
        ));
    }

    Ok(String::from_utf8_lossy(&output.stdout)
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .map(str::to_string)
        .collect())
}

#[cfg(not(target_os = "macos"))]
pub(crate) fn list_open_with_paths(_path: &Path) -> Result<Vec<String>, AppError> {
    Ok(Vec::new())
}

#[cfg(target_os = "macos")]
pub(crate) fn apply_default_open_with(
    content_type: &str,
    bundle_id: &str,
    path: &Path,
) -> Result<(), AppError> {
    let script = r#"import Foundation
import CoreServices

let args = CommandLine.arguments
guard args.count >= 3 else {
    FileHandle.standardError.write(Data("missing arguments".utf8))
    exit(2)
}

let status = LSSetDefaultRoleHandlerForContentType(args[1] as NSString, .all, args[2] as NSString)
if status != 0 {
    FileHandle.standardError.write(Data("LSSetDefaultRoleHandlerForContentType failed: \(status)".utf8))
    exit(1)
}"#;

    let output = std::process::Command::new("swift")
        .args(["-e", script, content_type, bundle_id])
        .output()
        .map_err(|e| {
            AppError::internal_at(
                format!("设置默认打开方式失败: {}", e),
                Some(path.to_string_lossy().into_owned()),
            )
        })?;

    if output.status.success() {
        return Ok(());
    }

    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    Err(AppError::internal_at(
        format!(
            "设置默认打开方式失败: {}",
            if stderr.is_empty() {
                "swift exited unexpectedly"
            } else {
                &stderr
            }
        ),
        Some(path.to_string_lossy().into_owned()),
    ))
}

#[cfg(not(target_os = "macos"))]
pub(crate) fn apply_default_open_with(
    _content_type: &str,
    _bundle_id: &str,
    path: &Path,
) -> Result<(), AppError> {
    Err(AppError::internal_at(
        "当前系统不支持设置默认打开方式",
        Some(path.to_string_lossy().into_owned()),
    ))
}

#[cfg(target_os = "macos")]
pub(crate) fn pick_application_path() -> Result<Option<String>, AppError> {
    let script = r#"try
POSIX path of (choose application with prompt "选择应用")
on error number -128
return "__CANCELLED__"
end try"#;

    let output = std::process::Command::new("osascript")
        .args(["-e", script])
        .output()
        .map_err(|e| AppError::internal(format!("打开应用选择器失败: {}", e)))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(AppError::internal(format!(
            "打开应用选择器失败: {}",
            if stderr.is_empty() {
                "osascript exited unexpectedly"
            } else {
                &stderr
            }
        )));
    }

    let selected = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if selected == "__CANCELLED__" {
        return Ok(None);
    }

    normalize_selected_application_path(&selected)
        .map(Some)
        .ok_or_else(|| AppError::invalid_path("所选项目不是有效的 .app 应用程序", Some(selected)))
}

#[cfg(not(target_os = "macos"))]
pub(crate) fn pick_application_path() -> Result<Option<String>, AppError> {
    Err(AppError::internal("当前系统不支持选择应用程序"))
}

pub(crate) fn format_modified(metadata: &fs::Metadata) -> String {
    metadata
        .modified()
        .ok()
        .map(|t| {
            let dt: chrono::DateTime<chrono::Local> = t.into();
            dt.format("%Y-%m-%d %H:%M:%S").to_string()
        })
        .unwrap_or_else(|| "未知".into())
}

pub(crate) fn format_system_time(time: Option<SystemTime>) -> String {
    time.map(|t| {
        let dt: chrono::DateTime<chrono::Local> = t.into();
        dt.format("%Y-%m-%d %H:%M").to_string()
    })
    .unwrap_or_default()
}

#[cfg(target_os = "macos")]
pub(crate) fn read_mdls_date(path: &Path, attr: &str) -> String {
    let value = read_mdls_string(path, attr);
    if value.is_empty() {
        return String::new();
    }

    value
        .rsplit_once(" +")
        .map(|(head, _)| head.to_string())
        .or_else(|| value.rsplit_once(" -").map(|(head, _)| head.to_string()))
        .unwrap_or(value)
}

#[cfg(not(target_os = "macos"))]
pub(crate) fn read_mdls_date(_path: &Path, _attr: &str) -> String {
    String::new()
}

pub(crate) fn classify_directory_read_error(err: &std::io::Error, dir_path: &str) -> AppError {
    AppError::from_io(err, Some(dir_path), format!("无法读取目录: {}", err))
}

pub(crate) fn list_directory_entries(
    dir_path: &str,
    show_hidden: bool,
    cancel_token: Option<DirectoryLoadToken>,
) -> Result<Vec<FileEntry>, AppError> {
    let entries =
        fs::read_dir(dir_path).map_err(|e| classify_directory_read_error(&e, dir_path))?;

    let mut files: Vec<FileEntry> = Vec::new();
    let mut dirs: Vec<FileEntry> = Vec::new();

    for entry in entries {
        if cancel_token
            .as_ref()
            .is_some_and(DirectoryLoadToken::is_cancelled)
        {
            return Err(AppError::cancelled(
                "目录加载已被新的请求取代",
                Some(dir_path.to_string()),
            ));
        }

        let entry = entry
            .map_err(|e| AppError::from_io(&e, Some(dir_path), format!("读取条目失败: {}", e)))?;
        let name = entry.file_name().to_string_lossy().to_string();

        if !show_hidden && name.starts_with('.') {
            continue;
        }

        let path = entry.path().to_string_lossy().to_string();
        let metadata = entry
            .metadata()
            .map_err(|e| AppError::from_io(&e, Some(&path), format!("读取元数据失败: {}", e)))?;
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
            open_with: String::new(),
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
pub(crate) async fn list_directory(
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
pub(crate) fn cancel_directory_loads(
    state: tauri::State<DirectoryLoadState>,
    request_scope: String,
    request_id: u64,
) -> Result<(), AppError> {
    state.mark_latest(request_scope, request_id)
}

#[tauri::command]
pub(crate) fn get_home_dir() -> String {
    dirs_fun()
}

pub(crate) fn dirs_fun() -> String {
    std::env::var("HOME").unwrap_or_else(|_| "/".into())
}

#[tauri::command]
pub(crate) fn preflight_file_permissions() -> Vec<PermissionPreflightResult> {
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

/// 敏感文件名 / 后缀黑名单 — 默认不允许 read_text_preview 读出来在预览面板展示。
///
/// 防的是：用户右键、空格预览不小心把 .env / id_rsa 暴露在屏幕上 / 被旁边人扫到。
/// 用户仍可通过"打开方式"显式打开（go 经过他们认知层面），但不会被 8KB 自动预览。
const SENSITIVE_PREVIEW_NAMES: &[&str] = &[
    ".env",
    ".envrc",
    ".npmrc",
    ".pypirc",
    ".netrc",
    "id_rsa",
    "id_dsa",
    "id_ed25519",
    "id_ecdsa",
    ".aws/credentials",
    "kubeconfig",
    ".gnupg",
];

pub(crate) fn is_sensitive_for_preview(path: &Path) -> bool {
    let name = path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or_default()
        .to_lowercase();
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
pub(crate) fn read_text_preview(path: String) -> Result<String, AppError> {
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
    let n = file
        .read(&mut buf)
        .map_err(|e| AppError::from_io(&e, Some(&path), format!("读取失败: {}", e)))?;
    buf.truncate(n);
    String::from_utf8(buf)
        .map_err(|e| AppError::invalid_path(format!("不是有效的文本文件: {}", e), Some(path)))
}

// ── File Operations ──

// 路径规范化 — 对用户输入的目标目录做 canonicalize。
// 防 `..` 跳逃 + 符号链接绕过 scope。失败说明路径不存在或无权限，直接返 Err。
pub(crate) fn safe_canonicalize(path: &Path) -> Result<std::path::PathBuf, AppError> {
    path.canonicalize().map_err(|e| {
        AppError::from_io(
            &e,
            Some(&path.to_string_lossy()),
            format!("路径解析失败: {}", e),
        )
    })
}

pub(crate) fn path_exists_no_follow(path: &Path) -> bool {
    fs::symlink_metadata(path).is_ok()
}

pub(crate) fn unique_destination(path: &Path) -> std::path::PathBuf {
    if !path_exists_no_follow(path) {
        return path.to_path_buf();
    }

    let parent = path.parent().unwrap_or(Path::new("/"));
    let stem = path.file_stem().and_then(|s| s.to_str()).unwrap_or("copy");
    let ext = path.extension().and_then(|e| e.to_str());

    for i in 1..1000 {
        let suffix = if i == 1 {
            " copy".to_string()
        } else {
            format!(" copy {}", i)
        };
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

pub(crate) fn alias_duplicate_destination(path: &Path, is_dir: bool) -> Result<PathBuf, AppError> {
    let parent = path.parent().ok_or_else(|| {
        AppError::invalid_path(
            "无法确定副本目标目录",
            Some(path.to_string_lossy().into_owned()),
        )
    })?;
    let name = path.file_name().and_then(|s| s.to_str()).ok_or_else(|| {
        AppError::invalid_path(
            "无法确定副本名称",
            Some(path.to_string_lossy().into_owned()),
        )
    })?;

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
            "-副本".to_string()
        } else {
            format!("-副本 {}", index)
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

    Err(AppError::internal_at(
        "无法生成可用的副本名称",
        Some(path.to_string_lossy().into_owned()),
    ))
}

#[cfg(target_os = "macos")]
pub(crate) fn read_mdls_string(path: &Path, attr: &str) -> String {
    std::process::Command::new("mdls")
        .args(["-raw", "-name", attr])
        .arg(path)
        .output()
        .ok()
        .filter(|output| output.status.success())
        .and_then(|output| String::from_utf8(output.stdout).ok())
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty() && value != "(null)" && value != "null")
        .unwrap_or_default()
}

#[cfg(not(target_os = "macos"))]
pub(crate) fn read_mdls_string(_path: &Path, _attr: &str) -> String {
    String::new()
}

#[cfg(target_os = "macos")]
pub(crate) fn app_display_name_from_path(path: &Path) -> String {
    path.file_stem()
        .or_else(|| path.file_name())
        .map(|name| name.to_string_lossy().to_string())
        .unwrap_or_default()
}

#[cfg(not(target_os = "macos"))]
pub(crate) fn app_display_name_from_path(path: &Path) -> String {
    path.file_stem()
        .or_else(|| path.file_name())
        .map(|name| name.to_string_lossy().to_string())
        .unwrap_or_default()
}

#[cfg(target_os = "macos")]
pub(crate) fn resolve_default_open_with_path(path: &Path) -> Option<String> {
    let script = r#"ObjC.import("AppKit");
function run(argv) {
  const url = $.NSURL.fileURLWithPath(argv[0]);
  const appUrl = $.NSWorkspace.sharedWorkspace.URLForApplicationToOpenURL(url);
  return appUrl ? ObjC.unwrap(appUrl.path) : "";
}"#;

    std::process::Command::new("osascript")
        .args(["-l", "JavaScript", "-e", script])
        .arg(path)
        .output()
        .ok()
        .filter(|output| output.status.success())
        .and_then(|output| String::from_utf8(output.stdout).ok())
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

#[cfg(not(target_os = "macos"))]
pub(crate) fn resolve_default_open_with_path(_path: &Path) -> Option<String> {
    None
}

#[cfg(target_os = "macos")]
pub(crate) fn resolve_default_open_with_name(path: &Path) -> String {
    resolve_default_open_with_path(path)
        .map(|value| app_display_name_from_path(Path::new(&value)))
        .filter(|value| !value.trim().is_empty())
        .or_else(|| {
            list_open_with_paths(path)
                .ok()
                .and_then(|paths| paths.into_iter().next())
                .map(|value| app_display_name_from_path(Path::new(&value)))
                .filter(|value| !value.trim().is_empty())
        })
        .or_else(|| fallback_default_open_with_name(path))
        .unwrap_or_default()
}

#[cfg(not(target_os = "macos"))]
pub(crate) fn resolve_default_open_with_name(_path: &Path) -> String {
    String::new()
}

#[cfg(target_os = "macos")]
pub(crate) fn fallback_default_open_with_name(path: &Path) -> Option<String> {
    let ext = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    match ext.as_str() {
        "txt" | "md" | "markdown" | "rtf" | "log" | "csv" | "json" | "xml" | "toml" | "yaml"
        | "yml" => Some("TextEdit".into()),
        "pdf" | "png" | "jpg" | "jpeg" | "gif" | "webp" | "bmp" | "tiff" | "tif" | "heic"
        | "heif" => Some("Preview".into()),
        _ => None,
    }
}

pub(crate) fn validate_child_name(name: &str) -> Result<String, AppError> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err(AppError::invalid_path("文件名不能为空", None));
    }
    if trimmed == "." || trimmed == ".." {
        return Err(AppError::invalid_path(
            "文件名不能是 . 或 ..",
            Some(trimmed.to_string()),
        ));
    }
    if trimmed.contains('/') || trimmed.contains('\\') || trimmed.contains('\0') {
        return Err(AppError::invalid_path(
            "文件名不能包含路径分隔符",
            Some(trimmed.to_string()),
        ));
    }
    if trimmed
        .chars()
        .any(|c| c.is_control() || matches!(c, ':' | '*' | '?' | '"' | '<' | '>' | '|'))
    {
        return Err(AppError::invalid_path(
            "文件名包含非法字符",
            Some(trimmed.to_string()),
        ));
    }

    let mut components = Path::new(trimmed).components();
    match (components.next(), components.next()) {
        (Some(Component::Normal(_)), None) => Ok(trimmed.to_string()),
        _ => Err(AppError::invalid_path(
            "文件名必须是单个名称，不能是路径",
            Some(trimmed.to_string()),
        )),
    }
}

#[tauri::command]
pub(crate) fn rename_file(path: String, new_name: String) -> Result<String, AppError> {
    let new_name = validate_child_name(&new_name)?;
    let parent = Path::new(&path).parent().unwrap_or(Path::new("/"));
    let new_path = parent.join(&new_name);
    fs::rename(&path, &new_path)
        .map_err(|e| AppError::from_io(&e, Some(&path), format!("重命名失败: {}", e)))?;
    Ok(new_path.to_string_lossy().into())
}

#[tauri::command]
pub(crate) fn delete_to_trash(path: String) -> Result<(), AppError> {
    trash::delete(&path).map_err(|e| trash_delete_error(&path, e.to_string()))
}

pub(crate) fn trash_delete_error(path: &str, error: impl Into<String>) -> AppError {
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

    AppError::internal_at(
        format!("移至废纸篓失败: {}", detail),
        Some(path.to_string()),
    )
}

#[tauri::command]
pub(crate) fn create_file(parent_dir: String, name: String) -> Result<String, AppError> {
    let name = validate_child_name(&name)?;
    let file_path = unique_destination(&Path::new(&parent_dir).join(&name));
    fs::write(&file_path, "").map_err(|e| {
        AppError::from_io(
            &e,
            Some(&file_path.to_string_lossy()),
            format!("创建文件失败: {}", e),
        )
    })?;
    Ok(file_path.to_string_lossy().into())
}

#[tauri::command]
pub(crate) fn create_folder(parent_dir: String, name: String) -> Result<String, AppError> {
    let name = validate_child_name(&name)?;
    let dir_path = unique_destination(&Path::new(&parent_dir).join(&name));
    fs::create_dir(&dir_path).map_err(|e| {
        AppError::from_io(
            &e,
            Some(&dir_path.to_string_lossy()),
            format!("创建文件夹失败: {}", e),
        )
    })?;
    Ok(dir_path.to_string_lossy().into())
}

#[tauri::command]
pub(crate) fn duplicate_as_alias(path: String) -> Result<String, AppError> {
    let src_path = Path::new(&path);
    let metadata = fs::symlink_metadata(src_path)
        .map_err(|e| AppError::from_io(&e, Some(&path), format!("读取源元数据失败: {}", e)))?;
    let dst_path = alias_duplicate_destination(
        src_path,
        metadata.is_dir() && !metadata.file_type().is_symlink(),
    )?;

    commands::transfer::copy_path_with_progress(src_path, &dst_path, None)
        .map_err(|e| AppError::internal_at(format!("创建副本失败: {}", e), Some(path.clone())))?;

    Ok(dst_path.to_string_lossy().into())
}

#[tauri::command]
pub(crate) fn calculate_file_hash(path: String) -> Result<FileHashResult, AppError> {
    let metadata = fs::metadata(&path)
        .map_err(|e| AppError::from_io(&e, Some(&path), format!("读取元数据失败: {}", e)))?;
    if metadata.is_dir() {
        return Err(AppError::invalid_path(
            "文件夹暂不支持计算哈希值",
            Some(path),
        ));
    }

    let output = std::process::Command::new("shasum")
        .args(["-a", "256"])
        .arg(&path)
        .output()
        .map_err(|e| AppError::internal_at(format!("计算哈希值失败: {}", e), Some(path.clone())))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(AppError::internal_at(
            format!(
                "计算哈希值失败: {}",
                if stderr.is_empty() {
                    "shasum exited unexpectedly"
                } else {
                    &stderr
                }
            ),
            Some(path),
        ));
    }

    let value = String::from_utf8_lossy(&output.stdout)
        .split_whitespace()
        .next()
        .unwrap_or_default()
        .trim()
        .to_string();

    if value.is_empty() {
        return Err(AppError::internal_at(
            "计算哈希值失败: 输出为空",
            Some(path),
        ));
    }

    Ok(FileHashResult {
        path,
        algorithm: "SHA-256".into(),
        value,
    })
}

#[tauri::command]
pub(crate) fn compress_files(paths: Vec<String>, output: String) -> Result<String, AppError> {
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
            zip_writer.start_file(name.as_ref(), options).map_err(|e| {
                AppError::internal_at(format!("压缩失败: {}", e), Some(path_str.clone()))
            })?;
            let mut input = fs::File::open(p).map_err(|e| {
                AppError::from_io(&e, Some(path_str), format!("读取文件失败: {}", e))
            })?;
            std::io::copy(&mut input, &mut zip_writer).map_err(|e| {
                AppError::from_io(&e, Some(path_str), format!("写入压缩失败: {}", e))
            })?;
        }
    }

    zip_writer
        .finish()
        .map_err(|e| AppError::internal_at(format!("完成压缩失败: {}", e), Some(output.clone())))?;
    Ok(output)
}

#[tauri::command]
pub(crate) fn decompress_file(path: String, output_dir: String) -> Result<String, AppError> {
    let file = fs::File::open(&path)
        .map_err(|e| AppError::from_io(&e, Some(&path), format!("打开压缩文件失败: {}", e)))?;
    let mut archive = zip::ZipArchive::new(file)
        .map_err(|e| AppError::internal(format!("读取压缩文件失败: {}", e)))?;
    let output_root = Path::new(&output_dir);
    let mut planned_files = std::collections::HashSet::new();

    for i in 0..archive.len() {
        let entry = archive
            .by_index(i)
            .map_err(|e| AppError::internal(format!("读取条目失败: {}", e)))?;
        let enclosed = entry.enclosed_name().ok_or_else(|| {
            AppError::invalid_path(
                format!("压缩包包含不安全路径: {}", entry.name()),
                Some(entry.name().to_string()),
            )
        })?;
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
        let mut entry = archive
            .by_index(i)
            .map_err(|e| AppError::internal(format!("读取条目失败: {}", e)))?;
        let enclosed = entry.enclosed_name().ok_or_else(|| {
            AppError::invalid_path(
                format!("压缩包包含不安全路径: {}", entry.name()),
                Some(entry.name().to_string()),
            )
        })?;
        let out_path = output_root.join(enclosed);

        if entry.is_dir() {
            fs::create_dir_all(&out_path).ok();
        } else {
            if let Some(parent) = out_path.parent() {
                fs::create_dir_all(parent).ok();
            }
            let mut out_file = fs::File::create(&out_path).map_err(|e| {
                AppError::from_io(
                    &e,
                    Some(&out_path.to_string_lossy()),
                    format!("创建解压文件失败: {}", e),
                )
            })?;
            std::io::copy(&mut entry, &mut out_file).map_err(|e| {
                AppError::from_io(
                    &e,
                    Some(&out_path.to_string_lossy()),
                    format!("解压写入失败: {}", e),
                )
            })?;
        }
    }

    Ok(output_dir)
}

#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub(crate) struct DirectorySizeSummary {
    pub(crate) bytes: u64,
    pub(crate) allocated_bytes: u64,
    pub(crate) file_count: u64,
    pub(crate) skipped_count: u64,
}

pub(crate) fn dir_size_recursive(dir: &Path) -> DirectorySizeSummary {
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

const DIR_SIZE_TASK_PROGRESS_ENTRY_INTERVAL: u64 = 256;
const DIR_SIZE_TASK_PROGRESS_TIME_INTERVAL_MS: u128 = 90;

pub(crate) fn apply_directory_size_snapshot(
    state: &DirectorySizeTaskState,
    task_id: &str,
    summary: &DirectorySizeSummary,
    status: &str,
    is_approximate: bool,
    finished_at: Option<u64>,
    error: Option<String>,
) {
    let bytes = summary.bytes;
    let allocated_bytes = summary.allocated_bytes;
    let file_count = summary.file_count;
    let skipped_count = summary.skipped_count;
    let formatted = format_size(bytes);
    let formatted_allocated = format_size(allocated_bytes);

    state.update(task_id, move |snapshot| {
        snapshot.status = status.to_string();
        snapshot.bytes = bytes;
        snapshot.formatted = formatted;
        snapshot.allocated_bytes = allocated_bytes;
        snapshot.formatted_allocated = formatted_allocated;
        snapshot.file_count = file_count;
        snapshot.skipped_count = skipped_count;
        snapshot.is_approximate = is_approximate;
        snapshot.finished_at = finished_at;
        snapshot.error = error;
    });
}

pub(crate) fn dir_size_recursive_with_progress(
    dir: &Path,
    task_id: &str,
    state: &DirectorySizeTaskState,
    cancel_requested: &AtomicBool,
) -> Result<DirectorySizeSummary, AppError> {
    let mut summary = DirectorySizeSummary::default();
    let mut stack: Vec<PathBuf> = vec![dir.to_path_buf()];
    let mut scanned_entries = 0_u64;
    let mut last_progress_at = std::time::Instant::now();
    let dir_path = dir.to_string_lossy().into_owned();

    while let Some(current) = stack.pop() {
        if cancel_requested.load(Ordering::SeqCst) {
            return Err(AppError::cancelled("操作已取消", Some(dir_path.clone())));
        }

        let entries = match fs::read_dir(&current) {
            Ok(entries) => entries,
            Err(_) => {
                summary.skipped_count = summary.skipped_count.saturating_add(1);
                continue;
            }
        };

        for entry in entries {
            if cancel_requested.load(Ordering::SeqCst) {
                return Err(AppError::cancelled("操作已取消", Some(dir_path.clone())));
            }

            let entry = match entry {
                Ok(e) => e,
                Err(_) => {
                    summary.skipped_count = summary.skipped_count.saturating_add(1);
                    continue;
                }
            };

            scanned_entries = scanned_entries.saturating_add(1);
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

            if scanned_entries % DIR_SIZE_TASK_PROGRESS_ENTRY_INTERVAL == 0
                || last_progress_at.elapsed().as_millis() >= DIR_SIZE_TASK_PROGRESS_TIME_INTERVAL_MS
            {
                apply_directory_size_snapshot(
                    state, task_id, &summary, "running", false, None, None,
                );
                last_progress_at = std::time::Instant::now();
            }
        }
    }

    apply_directory_size_snapshot(state, task_id, &summary, "running", false, None, None);
    Ok(summary)
}

const DIR_SIZE_ESTIMATE_MAX_DIRS_PER_REQUEST: usize = 64;
const DIR_SIZE_ESTIMATE_MAX_STACK_ITEMS: usize = 128;
const DIR_SIZE_ESTIMATE_MAX_FILES_SCANNED: u64 = 600;
const DIR_SIZE_ESTIMATE_MAX_ENTRIES_SCANNED: u64 = 1800;
const DIR_SIZE_ESTIMATE_TIME_BUDGET_MS: u128 = 16;

#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub(crate) struct DirectorySizeEstimateSummary {
    bytes: u64,
    files_scanned: u64,
    entries_scanned: u64,
    timed_out: bool,
    clipped: bool,
}

pub(crate) fn estimate_dir_size_fast(dir: &Path) -> DirectorySizeEstimateSummary {
    let mut summary = DirectorySizeEstimateSummary::default();
    let mut stack: Vec<PathBuf> = vec![dir.to_path_buf()];
    let started = std::time::Instant::now();

    while let Some(current) = stack.pop() {
        if started.elapsed().as_millis() >= DIR_SIZE_ESTIMATE_TIME_BUDGET_MS {
            summary.timed_out = true;
            break;
        }
        if summary.entries_scanned >= DIR_SIZE_ESTIMATE_MAX_ENTRIES_SCANNED
            || summary.files_scanned >= DIR_SIZE_ESTIMATE_MAX_FILES_SCANNED
        {
            summary.clipped = true;
            break;
        }

        let entries = match fs::read_dir(&current) {
            Ok(entries) => entries,
            Err(_) => continue,
        };

        for entry in entries {
            if started.elapsed().as_millis() >= DIR_SIZE_ESTIMATE_TIME_BUDGET_MS {
                summary.timed_out = true;
                break;
            }
            if summary.entries_scanned >= DIR_SIZE_ESTIMATE_MAX_ENTRIES_SCANNED
                || summary.files_scanned >= DIR_SIZE_ESTIMATE_MAX_FILES_SCANNED
            {
                summary.clipped = true;
                break;
            }

            let entry = match entry {
                Ok(e) => e,
                Err(_) => continue,
            };

            summary.entries_scanned = summary.entries_scanned.saturating_add(1);
            let path = entry.path();
            let meta = match fs::symlink_metadata(&path) {
                Ok(m) => m,
                Err(_) => continue,
            };
            let file_type = meta.file_type();

            if file_type.is_symlink() {
                continue;
            }

            if file_type.is_file() {
                summary.bytes = summary.bytes.saturating_add(meta.len());
                summary.files_scanned = summary.files_scanned.saturating_add(1);
                continue;
            }

            if file_type.is_dir() {
                if stack.len() >= DIR_SIZE_ESTIMATE_MAX_STACK_ITEMS {
                    summary.clipped = true;
                    continue;
                }
                stack.push(path);
            }
        }

        if summary.timed_out || summary.clipped {
            break;
        }
    }

    summary
}

#[tauri::command]
pub(crate) fn estimate_dirs_size_fast(
    paths: Vec<String>,
) -> Result<Vec<DirectorySizeEstimate>, AppError> {
    let mut results: Vec<DirectorySizeEstimate> = Vec::new();

    for path in paths
        .into_iter()
        .take(DIR_SIZE_ESTIMATE_MAX_DIRS_PER_REQUEST)
    {
        let dir = Path::new(&path);
        if !dir.is_dir() {
            continue;
        }
        let estimate = estimate_dir_size_fast(dir);
        results.push(DirectorySizeEstimate {
            path,
            bytes: estimate.bytes,
            formatted: format_size(estimate.bytes),
            is_approximate: estimate.timed_out || estimate.clipped,
        });
    }

    Ok(results)
}

#[tauri::command]
pub(crate) fn get_dir_size(path: String) -> Result<serde_json::Value, AppError> {
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

pub(crate) fn start_dir_size_task_impl(
    state: &DirectorySizeTaskState,
    path: String,
) -> Result<String, AppError> {
    let dir = Path::new(&path);
    if !dir.is_dir() {
        return Err(AppError::invalid_path("不是一个目录", Some(path)));
    }

    state.cleanup_finished();
    let task_id = next_directory_size_task_id();
    let cancel_requested = Arc::new(AtomicBool::new(false));
    state.insert(
        DirectorySizeTaskSnapshot {
            id: task_id.clone(),
            path: path.clone(),
            status: "queued".into(),
            bytes: 0,
            formatted: format_size(0),
            allocated_bytes: 0,
            formatted_allocated: format_size(0),
            file_count: 0,
            skipped_count: 0,
            is_approximate: true,
            started_at: now_unix_seconds(),
            finished_at: None,
            error: None,
        },
        cancel_requested.clone(),
    )?;

    let state_for_worker = state.clone();
    let task_id_for_worker = task_id.clone();
    tauri::async_runtime::spawn_blocking(move || {
        state_for_worker.update(&task_id_for_worker, |snapshot| {
            if snapshot.status == "queued" {
                snapshot.status = "running".into();
            }
        });

        let result = dir_size_recursive_with_progress(
            Path::new(&path),
            &task_id_for_worker,
            &state_for_worker,
            cancel_requested.as_ref(),
        );

        match result {
            Ok(summary) => {
                apply_directory_size_snapshot(
                    &state_for_worker,
                    &task_id_for_worker,
                    &summary,
                    "completed",
                    false,
                    Some(now_unix_seconds()),
                    None,
                );
            }
            Err(error) => {
                let status = if error.kind == AppErrorKind::Cancelled {
                    "cancelled"
                } else {
                    "failed"
                };
                let summary = state_for_worker
                    .get(&task_id_for_worker)
                    .ok()
                    .flatten()
                    .map(|snapshot| DirectorySizeSummary {
                        bytes: snapshot.bytes,
                        allocated_bytes: snapshot.allocated_bytes,
                        file_count: snapshot.file_count,
                        skipped_count: snapshot.skipped_count,
                    })
                    .unwrap_or_default();
                apply_directory_size_snapshot(
                    &state_for_worker,
                    &task_id_for_worker,
                    &summary,
                    status,
                    true,
                    Some(now_unix_seconds()),
                    Some(error.message),
                );
            }
        }

        state_for_worker.cleanup_finished();
    });

    Ok(task_id)
}

#[tauri::command]
pub(crate) fn start_dir_size_task(
    state: tauri::State<DirectorySizeTaskState>,
    path: String,
) -> Result<String, AppError> {
    start_dir_size_task_impl(state.inner(), path)
}

#[tauri::command]
pub(crate) fn get_dir_size_task(
    state: tauri::State<DirectorySizeTaskState>,
    task_id: String,
) -> Result<Option<DirectorySizeTaskSnapshot>, AppError> {
    state.get(&task_id)
}

#[tauri::command]
pub(crate) fn cancel_dir_size_task(
    state: tauri::State<DirectorySizeTaskState>,
    task_id: String,
) -> Result<(), AppError> {
    state.cancel(&task_id)
}

/// 按需查目录的直接子项数（PERF_PLAN L2-B 配套）。
/// 前端建议加 TTL 缓存避免重复调用。
#[tauri::command]
pub(crate) fn get_child_count(path: String, show_hidden: bool) -> Result<u64, AppError> {
    let p = Path::new(&path);
    if !p.is_dir() {
        return Ok(0);
    }
    let count = fs::read_dir(p)
        .map_err(|e| AppError::from_io(&e, Some(&path), format!("读取目录失败: {}", e)))?
        .flatten()
        .filter(|e| {
            if show_hidden {
                true
            } else {
                e.file_name()
                    .to_str()
                    .map(|n| !n.starts_with('.'))
                    .unwrap_or(true)
            }
        })
        .count() as u64;
    Ok(count)
}

pub(crate) fn directory_signature_for_path(
    path: &str,
    show_hidden: bool,
) -> Result<DirectorySignature, AppError> {
    let dir = Path::new(path);
    if !dir.is_dir() {
        return Err(AppError::invalid_path(
            "不是一个目录",
            Some(path.to_string()),
        ));
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
pub(crate) fn get_directory_signature(
    path: String,
    show_hidden: bool,
) -> Result<DirectorySignature, AppError> {
    directory_signature_for_path(&path, show_hidden)
}

#[tauri::command]
pub(crate) fn get_open_with_options(path: String) -> Result<Vec<OpenWithOption>, AppError> {
    let file_path = Path::new(&path);
    let metadata = fs::metadata(file_path)
        .map_err(|e| AppError::from_io(&e, Some(&path), format!("读取元数据失败: {}", e)))?;
    if metadata.is_dir() {
        return Ok(Vec::new());
    }

    let default_path = resolve_default_open_with_path(file_path);
    let mut app_paths = list_open_with_paths(file_path)?;

    if let Some(default_path) = default_path.as_ref() {
        if !app_paths.iter().any(|candidate| candidate == default_path) {
            app_paths.push(default_path.clone());
        }
    }

    let options = app_paths
        .into_iter()
        .map(|candidate| OpenWithOption {
            name: app_display_name_from_path(Path::new(&candidate)),
            is_default: default_path.as_deref() == Some(candidate.as_str()),
            path: candidate,
        })
        .filter(|option| !option.name.trim().is_empty())
        .collect();

    Ok(normalize_open_with_options(options))
}

#[tauri::command]
pub(crate) fn set_default_open_with(path: String, app_path: String) -> Result<String, AppError> {
    let file_path = Path::new(&path);
    let file_metadata = fs::metadata(file_path)
        .map_err(|e| AppError::from_io(&e, Some(&path), format!("读取元数据失败: {}", e)))?;
    if file_metadata.is_dir() {
        return Err(AppError::invalid_path(
            "文件夹不支持设置默认打开方式",
            Some(path),
        ));
    }

    let app_bundle_path = Path::new(&app_path);
    let app_metadata = fs::metadata(app_bundle_path)
        .map_err(|e| AppError::from_io(&e, Some(&app_path), format!("读取应用信息失败: {}", e)))?;
    if !app_metadata.is_dir() || !app_path.to_lowercase().ends_with(".app") {
        return Err(AppError::invalid_path(
            "目标应用无效，必须选择 .app 应用程序",
            Some(app_path),
        ));
    }

    let content_type = resolve_content_type_identifier(file_path);
    if content_type.is_empty() {
        return Err(AppError::internal_at(
            "无法识别该文件的内容类型",
            Some(path),
        ));
    }

    let bundle_id = resolve_bundle_identifier(app_bundle_path);
    if bundle_id.is_empty() {
        return Err(AppError::internal_at(
            "无法识别所选应用的 Bundle Identifier",
            Some(app_path.clone()),
        ));
    }

    apply_default_open_with(&content_type, &bundle_id, file_path)?;
    Ok(app_display_name_from_path(app_bundle_path))
}

#[tauri::command]
pub(crate) fn pick_application() -> Result<Option<String>, AppError> {
    pick_application_path()
}

#[tauri::command]
pub(crate) fn get_file_info(path: String) -> Result<FileEntry, AppError> {
    let p = Path::new(&path);
    let name = p
        .file_name()
        .unwrap_or_default()
        .to_string_lossy()
        .to_string();
    let metadata = fs::metadata(&path)
        .map_err(|e| AppError::from_io(&e, Some(&path), format!("读取元数据失败: {}", e)))?;
    let is_dir = metadata.is_dir();
    let size = if is_dir {
        "--".into()
    } else {
        format_size(metadata.len())
    };
    let modified = format_modified(&metadata);
    let created = format_system_time(metadata.created().ok());
    let added = read_mdls_date(p, "kMDItemDateAdded");
    let last_opened = read_mdls_date(p, "kMDItemLastUsedDate");
    let open_with = if is_dir {
        String::new()
    } else {
        resolve_default_open_with_name(p)
    };
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

    Ok(FileEntry {
        name,
        path,
        is_dir,
        size,
        modified,
        created,
        added,
        last_opened,
        open_with,
        file_type,
        icon_path,
        child_count,
    })
}

#[tauri::command]
pub(crate) fn open_with(path: String, app_name: String) -> Result<(), AppError> {
    let app_target = resolve_open_with_application_target(&app_name)?;
    std::process::Command::new("open")
        .args(["-a", &app_target])
        .arg(&path)
        .spawn()
        .map_err(|e| {
            AppError::internal_at(format!("无法使用 {} 打开: {}", app_target, e), Some(path))
        })?;
    Ok(())
}

pub(crate) fn add_dir_to_zip(
    writer: &mut zip::ZipWriter<fs::File>,
    base: &Path,
    dir: &Path,
    options: zip::write::SimpleFileOptions,
) -> Result<(), AppError> {
    for entry in fs::read_dir(dir).map_err(|e| {
        AppError::from_io(
            &e,
            Some(&dir.to_string_lossy()),
            format!("读取目录失败: {}", e),
        )
    })? {
        let entry = entry.map_err(|e| {
            AppError::from_io(
                &e,
                Some(&dir.to_string_lossy()),
                format!("读取条目失败: {}", e),
            )
        })?;
        let path = entry.path();
        let relative = path.strip_prefix(base).unwrap_or(&path);
        let name = relative.to_string_lossy();

        if path.is_dir() {
            writer.add_directory(name.as_ref(), options).map_err(|e| {
                AppError::internal_at(
                    format!("添加目录失败: {}", e),
                    Some(path.to_string_lossy().to_string()),
                )
            })?;
            add_dir_to_zip(writer, base, &path, options)?;
        } else {
            writer.start_file(name.as_ref(), options).map_err(|e| {
                AppError::internal_at(
                    format!("添加文件失败: {}", e),
                    Some(path.to_string_lossy().to_string()),
                )
            })?;
            let mut input = fs::File::open(&path).map_err(|e| {
                AppError::from_io(
                    &e,
                    Some(&path.to_string_lossy()),
                    format!("读取文件失败: {}", e),
                )
            })?;
            std::io::copy(&mut input, &mut *writer).map_err(|e| {
                AppError::from_io(
                    &e,
                    Some(&path.to_string_lossy()),
                    format!("写入失败: {}", e),
                )
            })?;
        }
    }
    Ok(())
}

#[tauri::command]
pub(crate) fn quick_look(path: String) -> Result<(), AppError> {
    std::process::Command::new("qlmanage")
        .args(["-p", &path])
        .spawn()
        .map_err(|e| AppError::internal_at(format!("无法打开 Quick Look: {}", e), Some(path)))?;
    Ok(())
}

#[tauri::command]
pub(crate) fn reveal_in_finder(path: String) -> Result<(), AppError> {
    std::process::Command::new("open")
        .args(["-R", &path])
        .spawn()
        .map_err(|e| AppError::internal_at(format!("无法在 Finder 中显示: {}", e), Some(path)))?;
    Ok(())
}

#[tauri::command]
pub(crate) fn open_path(path: String) -> Result<(), AppError> {
    std::process::Command::new("open")
        .arg(&path)
        .spawn()
        .map_err(|e| AppError::internal_at(format!("无法打开文件: {}", e), Some(path)))?;
    Ok(())
}
