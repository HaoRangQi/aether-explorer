use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::io::{Read, Write};
use std::os::unix::fs as unix_fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

use crate::commands::window::write_drag_debug_log;
use crate::error::AppError;
use crate::{next_transfer_task_id, now_unix_seconds, safe_canonicalize, unique_destination};

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct FileTransferPayload {
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

pub(crate) struct FileClipboardState(pub(crate) Mutex<Option<FileTransferPayload>>);
pub(crate) struct FileDragState(pub(crate) Mutex<Option<FileTransferPayload>>);

#[derive(Clone, Default)]
pub(crate) struct TransferTaskState(Arc<Mutex<HashMap<String, TransferTask>>>);

#[derive(Clone)]
struct TransferTask {
    snapshot: TransferTaskSnapshot,
    cancel_requested: Arc<AtomicBool>,
    move_dedupe_key: Option<String>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TransferTaskSnapshot {
    pub(crate) id: String,
    pub(crate) kind: String,
    pub(crate) status: String,
    pub(crate) total_items: u64,
    pub(crate) completed_items: u64,
    pub(crate) total_bytes: u64,
    pub(crate) completed_bytes: u64,
    pub(crate) current_name: Option<String>,
    pub(crate) error: Option<String>,
    pub(crate) error_path: Option<String>,
    pub(crate) started_at: u64,
    pub(crate) finished_at: Option<u64>,
    pub(crate) copied: u64,
    pub(crate) moved: u64,
    pub(crate) copied_cross_device: u64,
    pub(crate) failed: u64,
    pub(crate) conflicts: u64,
    pub(crate) skipped: u64,
    pub(crate) skipped_same_dir: u64,
    pub(crate) skipped_conflicts: u64,
}

#[derive(Clone)]
pub(crate) struct TransferProgress {
    pub(crate) task_id: String,
    pub(crate) state: TransferTaskState,
    pub(crate) cancel_requested: Arc<AtomicBool>,
}

#[derive(Default)]
struct TransferEstimate {
    items: u64,
    bytes: u64,
}

impl TransferTaskState {
    pub(crate) fn insert(
        &self,
        snapshot: TransferTaskSnapshot,
        cancel_requested: Arc<AtomicBool>,
    ) -> Result<(), AppError> {
        self.insert_with_move_dedupe(snapshot, cancel_requested, None)
    }

    fn insert_with_move_dedupe(
        &self,
        snapshot: TransferTaskSnapshot,
        cancel_requested: Arc<AtomicBool>,
        move_dedupe_key: Option<String>,
    ) -> Result<(), AppError> {
        let mut tasks = self
            .0
            .lock()
            .map_err(|_| AppError::unavailable("传输任务状态不可用"))?;
        tasks.insert(
            snapshot.id.clone(),
            TransferTask {
                snapshot,
                cancel_requested,
                move_dedupe_key,
            },
        );
        Ok(())
    }

    fn get_or_create_move_task(
        &self,
        srcs: &[String],
        dst_dir: &str,
        strategy: MoveConflictStrategy,
    ) -> Result<(String, Option<Arc<AtomicBool>>), AppError> {
        let dedupe_key = build_move_task_dedupe_key(srcs, dst_dir, strategy);
        let now = now_unix_seconds();
        let mut tasks = self
            .0
            .lock()
            .map_err(|_| AppError::unavailable("传输任务状态不可用"))?;

        let mut newest_existing: Option<(u64, String)> = None;
        for task in tasks.values() {
            if task.snapshot.kind != "move" {
                continue;
            }
            if task.move_dedupe_key.as_deref() != Some(dedupe_key.as_str()) {
                continue;
            }

            let status = task.snapshot.status.as_str();
            if !is_terminal_transfer_status(status) {
                let ts = task.snapshot.started_at;
                match &newest_existing {
                    Some((best_ts, _)) if *best_ts >= ts => {}
                    _ => newest_existing = Some((ts, task.snapshot.id.clone())),
                }
                continue;
            }

            let finished_at = task
                .snapshot
                .finished_at
                .unwrap_or(task.snapshot.started_at);
            if now.saturating_sub(finished_at) > MOVE_TASK_DEDUPE_WINDOW_SECONDS {
                continue;
            }
            match &newest_existing {
                Some((best_ts, _)) if *best_ts >= finished_at => {}
                _ => newest_existing = Some((finished_at, task.snapshot.id.clone())),
            }
        }

        if let Some((_, task_id)) = newest_existing {
            write_drag_debug_log(&format!(
                "backendMoveTask deduped taskId={} key={} srcCount={} dstDir={} paths={}",
                task_id,
                dedupe_key,
                srcs.len(),
                dst_dir,
                describe_debug_paths(srcs)
            ));
            return Ok((task_id, None));
        }

        let estimate = estimate_transfer_paths(srcs);
        let task_id = next_transfer_task_id("move");
        let cancel_requested = Arc::new(AtomicBool::new(false));
        tasks.insert(
            task_id.clone(),
            TransferTask {
                snapshot: TransferTaskSnapshot {
                    id: task_id.clone(),
                    kind: "move".into(),
                    status: "queued".into(),
                    total_items: estimate.items,
                    completed_items: 0,
                    total_bytes: estimate.bytes,
                    completed_bytes: 0,
                    current_name: None,
                    error: None,
                    error_path: None,
                    started_at: now,
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
                cancel_requested: cancel_requested.clone(),
                move_dedupe_key: Some(dedupe_key.clone()),
            },
        );

        write_drag_debug_log(&format!(
            "backendMoveTask created taskId={} key={} srcCount={} dstDir={} totalItems={} totalBytes={} paths={}",
            task_id,
            dedupe_key,
            srcs.len(),
            dst_dir,
            estimate.items,
            estimate.bytes,
            describe_debug_paths(srcs)
        ));
        Ok((task_id, Some(cancel_requested)))
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

    pub(crate) fn list(&self) -> Result<Vec<TransferTaskSnapshot>, AppError> {
        let tasks = self
            .0
            .lock()
            .map_err(|_| AppError::unavailable("传输任务状态不可用"))?;
        let mut snapshots: Vec<TransferTaskSnapshot> =
            tasks.values().map(|task| task.snapshot.clone()).collect();
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
            snapshot.completed_items = snapshot
                .completed_items
                .saturating_add(items)
                .min(snapshot.total_items);
            snapshot.completed_bytes = snapshot
                .completed_bytes
                .saturating_add(bytes)
                .min(snapshot.total_bytes);
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

pub(crate) const FINISHED_TRANSFER_TASK_RETENTION_SECONDS: u64 = 30;
const MOVE_TASK_DEDUPE_WINDOW_SECONDS: u64 = 2;

fn describe_debug_paths(paths: &[String]) -> String {
    if paths.is_empty() {
        "(none)".into()
    } else {
        paths.join("|")
    }
}

fn normalize_transfer_path_for_dedupe(path: &str) -> String {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return String::new();
    }
    if trimmed == "/" {
        return "/".to_string();
    }
    trimmed.trim_end_matches('/').to_string()
}

fn move_conflict_strategy_key(strategy: MoveConflictStrategy) -> &'static str {
    match strategy {
        MoveConflictStrategy::Abort => "abort",
        MoveConflictStrategy::Replace => "replace",
        MoveConflictStrategy::KeepBoth => "keep-both",
        MoveConflictStrategy::Skip => "skip",
    }
}

fn build_move_task_dedupe_key(
    srcs: &[String],
    dst_dir: &str,
    strategy: MoveConflictStrategy,
) -> String {
    let dst = normalize_transfer_path_for_dedupe(dst_dir);
    let mut normalized_srcs: Vec<String> = srcs
        .iter()
        .map(|src| normalize_transfer_path_for_dedupe(src))
        .filter(|src| !src.is_empty())
        .collect();
    normalized_srcs.sort();
    normalized_srcs.dedup();

    format!(
        "{}::{}::{}",
        move_conflict_strategy_key(strategy),
        dst,
        normalized_srcs.join("\u{1f}")
    )
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
    paths
        .iter()
        .fold(TransferEstimate::default(), |mut estimate, path| {
            estimate_transfer_path_into(Path::new(path), &mut estimate);
            estimate
        })
}

struct TransferErrorSummary {
    message: String,
    path: Option<String>,
}

fn looks_like_permission_denied(message: &str) -> bool {
    let lower = message.to_ascii_lowercase();
    lower.contains("permission")
        || lower.contains("denied")
        || lower.contains("not allowed")
        || lower.contains("not permitted")
}

fn summarize_transfer_error(
    failed: &[MoveFailure],
    conflicts: &[MoveConflict],
) -> Option<TransferErrorSummary> {
    if !conflicts.is_empty() {
        return Some(TransferErrorSummary {
            message: format!("存在 {} 个文件冲突", conflicts.len()),
            path: conflicts.first().map(|conflict| conflict.src.clone()),
        });
    }
    if !failed.is_empty() {
        let primary_failure = failed
            .iter()
            .find(|failure| looks_like_permission_denied(&failure.error))
            .unwrap_or(&failed[0]);
        return Some(TransferErrorSummary {
            message: format!("{} 个项目失败：{}", failed.len(), primary_failure.error),
            path: Some(primary_failure.src.clone()),
        });
    }
    None
}

fn replace_backup_path(path: &Path) -> PathBuf {
    let parent = path.parent().unwrap_or(Path::new("/"));
    let name = path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("target");
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    parent.join(format!(
        ".{}.aether-replace-backup-{}-{}",
        name,
        std::process::id(),
        now
    ))
}

fn transfer_temp_path(path: &Path, label: &str) -> PathBuf {
    let parent = path.parent().unwrap_or(Path::new("/"));
    let name = path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("target");
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    parent.join(format!(
        ".{}.aether-{}-{}-{}",
        name,
        label,
        std::process::id(),
        now
    ))
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

fn copy_symlink_with_progress(
    src: &Path,
    dst: &Path,
    progress: Option<&TransferProgress>,
) -> Result<(), String> {
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

fn copy_file_contents_with_progress(
    src: &Path,
    dst: &Path,
    progress: Option<&TransferProgress>,
) -> Result<(), String> {
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
        let read = reader
            .read(&mut buffer)
            .map_err(|e| format!("读取文件失败: {}", e))?;
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

pub(crate) fn commit_staged_path(
    staged: &Path,
    dst: &Path,
    progress: Option<&TransferProgress>,
) -> Result<(), String> {
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

pub(crate) fn copy_file_with_progress(
    src: &Path,
    dst: &Path,
    progress: Option<&TransferProgress>,
) -> Result<(), String> {
    let temp = transfer_temp_path(dst, "copy-temp");
    let copy_result = match fs::symlink_metadata(src) {
        Ok(metadata) if metadata.file_type().is_symlink() => {
            copy_symlink_with_progress(src, &temp, progress)
        }
        Ok(_) => copy_file_contents_with_progress(src, &temp, progress),
        Err(error) => Err(format!("读取源元数据失败: {}", error)),
    };

    if let Err(error) = copy_result {
        let _ = remove_path(&temp);
        return Err(error);
    }

    commit_staged_path(&temp, dst, progress)
}

pub(crate) fn copy_path_with_progress(
    src: &Path,
    dst: &Path,
    progress: Option<&TransferProgress>,
) -> Result<(), String> {
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
pub(crate) fn replace_existing_for_copy(src: &Path, dst: &Path) -> Result<(), String> {
    replace_existing_for_copy_with_progress(src, dst, None)
}

pub(crate) fn replace_existing_for_copy_with_progress(
    src: &Path,
    dst: &Path,
    progress: Option<&TransferProgress>,
) -> Result<(), String> {
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

pub(crate) enum MovePathOutcome {
    Moved,
    CopiedCrossDevice,
}

pub(crate) fn is_cross_device_rename_error(err: &std::io::Error) -> bool {
    matches!(err.raw_os_error(), Some(18))
}

fn rename_or_copy_cross_device(src: &Path, dst: &Path) -> Result<MovePathOutcome, String> {
    rename_or_copy_cross_device_with_progress(src, dst, None)
}

fn rename_or_copy_cross_device_with_progress(
    src: &Path,
    dst: &Path,
    progress: Option<&TransferProgress>,
) -> Result<MovePathOutcome, String> {
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
pub(crate) fn replace_existing_for_move(src: &Path, dst: &Path) -> Result<MovePathOutcome, String> {
    replace_existing_for_move_with_progress(src, dst, None)
}

pub(crate) fn replace_existing_for_move_with_progress(
    src: &Path,
    dst: &Path,
    progress: Option<&TransferProgress>,
) -> Result<MovePathOutcome, String> {
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
pub(crate) fn copy_dir_recursive(src: &Path, dst: &Path) -> Result<(), String> {
    copy_dir_recursive_with_progress(src, dst, None)
}

pub(crate) fn copy_dir_recursive_with_progress(
    src: &Path,
    dst: &Path,
    progress: Option<&TransferProgress>,
) -> Result<(), String> {
    let temp = transfer_temp_path(dst, "copy-dir-temp");
    let copy_result = copy_dir_recursive_contents_with_progress(src, &temp, progress);
    if let Err(error) = copy_result {
        let _ = remove_path(&temp);
        return Err(error);
    }
    commit_staged_path(&temp, dst, progress)
}

fn copy_dir_recursive_contents_with_progress(
    src: &Path,
    dst: &Path,
    progress: Option<&TransferProgress>,
) -> Result<(), String> {
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
        let metadata =
            fs::symlink_metadata(&src_path).map_err(|e| format!("读取源元数据失败: {}", e))?;
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
pub(crate) fn copy_file(src: String, dst: String) -> Result<String, AppError> {
    let src_path = Path::new(&src);
    let name = src_path.file_name().unwrap_or_default().to_string_lossy();
    let dst_path = unique_destination(&Path::new(&dst).join(name.as_ref()));
    copy_path_with_progress(src_path, &dst_path, None)
        .map_err(|e| AppError::internal_at(e, Some(src.clone())))?;
    Ok(dst_path.to_string_lossy().into())
}

#[tauri::command]
pub(crate) fn move_file(src: String, dst_dir: String) -> Result<String, AppError> {
    let src_path = Path::new(&src);
    let name = src_path.file_name().unwrap_or_default().to_string_lossy();
    let dst_path = unique_destination(&Path::new(&dst_dir).join(name.as_ref()));
    rename_or_copy_cross_device(src_path, &dst_path)
        .map_err(|e| AppError::internal_at(format!("移动失败: {}", e), Some(src.clone())))?;
    Ok(dst_path.to_string_lossy().into())
}

#[tauri::command]
pub(crate) fn set_file_clipboard(
    state: tauri::State<FileClipboardState>,
    paths: Vec<String>,
    cut: bool,
) -> Result<(), AppError> {
    let mut clipboard = state
        .0
        .lock()
        .map_err(|_| AppError::unavailable("文件剪贴板不可用"))?;
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
pub(crate) fn get_file_clipboard(
    state: tauri::State<FileClipboardState>,
) -> Result<Option<FileTransferPayload>, AppError> {
    let clipboard = state
        .0
        .lock()
        .map_err(|_| AppError::unavailable("文件剪贴板不可用"))?;
    Ok(clipboard.clone())
}

#[tauri::command]
pub(crate) fn clear_file_clipboard(
    state: tauri::State<FileClipboardState>,
) -> Result<(), AppError> {
    let mut clipboard = state
        .0
        .lock()
        .map_err(|_| AppError::unavailable("文件剪贴板不可用"))?;
    *clipboard = None;
    Ok(())
}

#[tauri::command]
pub(crate) fn set_file_drag_payload(
    state: tauri::State<FileDragState>,
    paths: Vec<String>,
    cut: bool,
    source_window: Option<String>,
    transfer_id: Option<String>,
    preview_name: Option<String>,
    count: Option<u32>,
) -> Result<(), AppError> {
    let mut drag_payload = state
        .0
        .lock()
        .map_err(|_| AppError::unavailable("文件拖拽状态不可用"))?;
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
pub(crate) fn get_file_drag_payload(
    state: tauri::State<FileDragState>,
) -> Result<Option<FileTransferPayload>, AppError> {
    let drag_payload = state
        .0
        .lock()
        .map_err(|_| AppError::unavailable("文件拖拽状态不可用"))?;
    Ok(drag_payload.clone())
}

#[tauri::command]
pub(crate) fn clear_file_drag_payload(state: tauri::State<FileDragState>) -> Result<(), AppError> {
    let mut drag_payload = state
        .0
        .lock()
        .map_err(|_| AppError::unavailable("文件拖拽状态不可用"))?;
    *drag_payload = None;
    Ok(())
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MoveFailure {
    pub(crate) src: String,
    pub(crate) error: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MoveConflict {
    pub(crate) src: String,
    pub(crate) dst: String,
    pub(crate) name: String,
}

#[derive(Debug, Deserialize, Clone, Copy)]
#[serde(rename_all = "camelCase")]
pub(crate) enum MoveConflictStrategy {
    Abort,
    Replace,
    KeepBoth,
    Skip,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MoveResult {
    pub(crate) moved: Vec<String>,
    pub(crate) copied_cross_device: Vec<String>,
    pub(crate) failed: Vec<MoveFailure>,
    pub(crate) conflicts: Vec<MoveConflict>,
    pub(crate) skipped_same_dir: u32,
    pub(crate) skipped_conflicts: u32,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CopyResult {
    pub(crate) copied: Vec<String>,
    pub(crate) failed: Vec<MoveFailure>,
    pub(crate) conflicts: Vec<MoveConflict>,
    pub(crate) skipped_conflicts: u32,
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
            return Ok(CopyResult {
                copied,
                failed,
                conflicts,
                skipped_conflicts,
            });
        }
    }

    for src in srcs {
        if let Some(progress) = progress {
            if let Err(error) = progress.check_cancelled() {
                failed.push(MoveFailure {
                    src: src.clone(),
                    error,
                });
                break;
            }
        }

        let src_path = Path::new(&src);

        if !path_exists_no_follow(src_path) {
            failed.push(MoveFailure {
                src: src.clone(),
                error: "源不存在".into(),
            });
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
        if matches!(conflict_strategy, MoveConflictStrategy::Skip)
            && path_exists_no_follow(&base_dst_path)
        {
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
            Err(e) => failed.push(MoveFailure {
                src: src.clone(),
                error: e,
            }),
        }
    }

    Ok(CopyResult {
        copied,
        failed,
        conflicts,
        skipped_conflicts,
    })
}

#[tauri::command]
pub(crate) fn copy_files(
    srcs: Vec<String>,
    dst_dir: String,
    conflict_strategy: Option<MoveConflictStrategy>,
) -> Result<CopyResult, AppError> {
    copy_files_impl(srcs, dst_dir, conflict_strategy, None)
}

#[tauri::command]
pub(crate) fn preview_copy_file_conflicts(
    srcs: Vec<String>,
    dst_dir: String,
) -> Result<Vec<MoveConflict>, AppError> {
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
            return Ok(MoveResult {
                moved,
                copied_cross_device,
                failed,
                conflicts,
                skipped_same_dir,
                skipped_conflicts,
            });
        }
    }

    for src in srcs {
        if let Some(progress) = progress {
            if let Err(error) = progress.check_cancelled() {
                failed.push(MoveFailure {
                    src: src.clone(),
                    error,
                });
                break;
            }
        }

        let src_path = Path::new(&src);

        if !path_exists_no_follow(src_path) {
            failed.push(MoveFailure {
                src: src.clone(),
                error: "源不存在".into(),
            });
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
        if matches!(conflict_strategy, MoveConflictStrategy::Skip)
            && path_exists_no_follow(&base_dst_path)
        {
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
            Ok(MovePathOutcome::CopiedCrossDevice) => {
                copied_cross_device.push(dst_path.to_string_lossy().into())
            }
            Err(e) => failed.push(MoveFailure {
                src: src.clone(),
                error: e,
            }),
        }
    }

    Ok(MoveResult {
        moved,
        copied_cross_device,
        failed,
        conflicts,
        skipped_same_dir,
        skipped_conflicts,
    })
}

#[tauri::command]
pub(crate) fn move_files(
    srcs: Vec<String>,
    dst_dir: String,
    conflict_strategy: Option<MoveConflictStrategy>,
) -> Result<MoveResult, AppError> {
    move_files_impl(srcs, dst_dir, conflict_strategy, None)
}

#[tauri::command]
pub(crate) fn preview_move_file_conflicts(
    srcs: Vec<String>,
    dst_dir: String,
) -> Result<Vec<MoveConflict>, AppError> {
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
            error_path: None,
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

fn finish_copy_transfer_task(
    state: &TransferTaskState,
    task_id: &str,
    result: Result<CopyResult, AppError>,
) {
    match result {
        Ok(result) => {
            let error = summarize_transfer_error(&result.failed, &result.conflicts);
            let was_cancelled = result
                .failed
                .iter()
                .any(|failure| failure.error.contains("取消"));
            let status = if error.is_some() {
                if was_cancelled {
                    "cancelled"
                } else {
                    "failed"
                }
            } else {
                "completed"
            };
            write_drag_debug_log(&format!(
                "backendCopyTask finishOk taskId={} status={} copied={} failed={} conflicts={} skippedConflicts={} error={} errorPath={}",
                task_id,
                status,
                result.copied.len(),
                result.failed.len(),
                result.conflicts.len(),
                result.skipped_conflicts,
                error.as_ref().map(|summary| summary.message.as_str()).unwrap_or("(none)"),
                error.as_ref().and_then(|summary| summary.path.as_deref()).unwrap_or("(none)")
            ));
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
                snapshot.error = error.as_ref().map(|summary| summary.message.clone());
                snapshot.error_path = error.and_then(|summary| summary.path);
                snapshot.finished_at = Some(now_unix_seconds());
                if snapshot.status == "completed" {
                    snapshot.completed_items = snapshot.total_items;
                    snapshot.completed_bytes = snapshot.total_bytes;
                }
            });
        }
        Err(error) => {
            write_drag_debug_log(&format!(
                "backendCopyTask finishErr taskId={} error={} errorPath={}",
                task_id,
                error.message,
                error.path.as_deref().unwrap_or("(none)")
            ));
            state.update(task_id, |snapshot| {
                if snapshot.status == "cancelling" {
                    snapshot.status = "cancelled".into();
                    snapshot.error = Some("操作已取消".into());
                    snapshot.finished_at = Some(now_unix_seconds());
                    return;
                }
                snapshot.status = "failed".into();
                snapshot.error_path = error.path.clone();
                snapshot.error = Some(error.message);
                snapshot.finished_at = Some(now_unix_seconds());
            });
        }
    }
}

pub(crate) fn finish_move_transfer_task(
    state: &TransferTaskState,
    task_id: &str,
    result: Result<MoveResult, AppError>,
) {
    match result {
        Ok(result) => {
            let error = summarize_transfer_error(&result.failed, &result.conflicts);
            let was_cancelled = result
                .failed
                .iter()
                .any(|failure| failure.error.contains("取消"));
            let status = if error.is_some() {
                if was_cancelled {
                    "cancelled"
                } else {
                    "failed"
                }
            } else {
                "completed"
            };
            write_drag_debug_log(&format!(
                "backendMoveTask finishOk taskId={} status={} moved={} copiedCrossDevice={} failed={} conflicts={} skippedSameDir={} skippedConflicts={} error={} errorPath={}",
                task_id,
                status,
                result.moved.len(),
                result.copied_cross_device.len(),
                result.failed.len(),
                result.conflicts.len(),
                result.skipped_same_dir,
                result.skipped_conflicts,
                error.as_ref().map(|summary| summary.message.as_str()).unwrap_or("(none)"),
                error.as_ref().and_then(|summary| summary.path.as_deref()).unwrap_or("(none)")
            ));
            state.update(task_id, |snapshot| {
                snapshot.moved = result.moved.len() as u64;
                snapshot.copied_cross_device = result.copied_cross_device.len() as u64;
                snapshot.failed = result.failed.len() as u64;
                snapshot.conflicts = result.conflicts.len() as u64;
                snapshot.skipped = result
                    .skipped_same_dir
                    .saturating_add(result.skipped_conflicts)
                    as u64;
                snapshot.skipped_same_dir = result.skipped_same_dir as u64;
                snapshot.skipped_conflicts = result.skipped_conflicts as u64;
                if snapshot.status == "cancelling" && was_cancelled {
                    snapshot.status = "cancelled".into();
                    snapshot.error = Some("操作已取消".into());
                    snapshot.finished_at = Some(now_unix_seconds());
                    return;
                }
                snapshot.status = status.into();
                snapshot.error = error.as_ref().map(|summary| summary.message.clone());
                snapshot.error_path = error.and_then(|summary| summary.path);
                snapshot.finished_at = Some(now_unix_seconds());
                if snapshot.status == "completed" {
                    snapshot.completed_items = snapshot.total_items;
                    snapshot.completed_bytes = snapshot.total_bytes;
                }
            });
        }
        Err(error) => {
            write_drag_debug_log(&format!(
                "backendMoveTask finishErr taskId={} error={} errorPath={}",
                task_id,
                error.message,
                error.path.as_deref().unwrap_or("(none)")
            ));
            state.update(task_id, |snapshot| {
                if snapshot.status == "cancelling" {
                    snapshot.status = "cancelled".into();
                    snapshot.error = Some("操作已取消".into());
                    snapshot.finished_at = Some(now_unix_seconds());
                    return;
                }
                snapshot.status = "failed".into();
                snapshot.error_path = error.path.clone();
                snapshot.error = Some(error.message);
                snapshot.finished_at = Some(now_unix_seconds());
            });
        }
    }
}

#[tauri::command]
pub(crate) fn start_copy_files_task(
    state: tauri::State<TransferTaskState>,
    srcs: Vec<String>,
    dst_dir: String,
    conflict_strategy: Option<MoveConflictStrategy>,
) -> Result<String, AppError> {
    write_drag_debug_log(&format!(
        "backendCopyTask startRequest srcCount={} dstDir={} strategy={} paths={}",
        srcs.len(),
        dst_dir,
        conflict_strategy
            .map(move_conflict_strategy_key)
            .unwrap_or("abort"),
        describe_debug_paths(&srcs)
    ));
    let state = state.inner().clone();
    let strategy = conflict_strategy.unwrap_or(MoveConflictStrategy::Abort);
    let (task_id, cancel_requested) = create_transfer_task(&state, "copy", &srcs)?;
    let progress = TransferProgress {
        task_id: task_id.clone(),
        state: state.clone(),
        cancel_requested,
    };
    let task_id_for_worker = task_id.clone();
    let worker_dst_dir = dst_dir.clone();
    let worker_src_count = srcs.len();
    let worker_paths = describe_debug_paths(&srcs);

    write_drag_debug_log(&format!(
        "backendCopyTask workerSpawn taskId={} dstDir={} strategy={} srcCount={} paths={}",
        task_id,
        dst_dir,
        move_conflict_strategy_key(strategy),
        worker_src_count,
        worker_paths
    ));

    tauri::async_runtime::spawn_blocking(move || {
        write_drag_debug_log(&format!(
            "backendCopyTask workerRunning taskId={} dstDir={} strategy={} srcCount={} paths={}",
            task_id_for_worker,
            worker_dst_dir,
            move_conflict_strategy_key(strategy),
            worker_src_count,
            worker_paths
        ));
        state.update(&task_id_for_worker, |snapshot| {
            if snapshot.status == "queued" {
                snapshot.status = "running".into();
            }
        });
        let result = copy_files_impl(srcs, dst_dir, Some(strategy), Some(&progress));
        finish_copy_transfer_task(&state, &task_id_for_worker, result);
    });

    Ok(task_id)
}

#[tauri::command]
pub(crate) fn start_move_files_task(
    state: tauri::State<TransferTaskState>,
    srcs: Vec<String>,
    dst_dir: String,
    conflict_strategy: Option<MoveConflictStrategy>,
) -> Result<String, AppError> {
    write_drag_debug_log(&format!(
        "backendMoveTask startRequest srcCount={} dstDir={} strategy={} paths={}",
        srcs.len(),
        dst_dir,
        conflict_strategy
            .map(move_conflict_strategy_key)
            .unwrap_or("abort"),
        describe_debug_paths(&srcs)
    ));
    let state = state.inner().clone();
    let strategy = conflict_strategy.unwrap_or(MoveConflictStrategy::Abort);
    let (task_id, maybe_cancel_requested) =
        state.get_or_create_move_task(&srcs, &dst_dir, strategy)?;
    let Some(cancel_requested) = maybe_cancel_requested else {
        write_drag_debug_log(&format!(
            "backendMoveTask startDedupedReturn taskId={} dstDir={} strategy={} srcCount={}",
            task_id,
            dst_dir,
            move_conflict_strategy_key(strategy),
            srcs.len()
        ));
        return Ok(task_id);
    };
    let progress = TransferProgress {
        task_id: task_id.clone(),
        state: state.clone(),
        cancel_requested,
    };
    let task_id_for_worker = task_id.clone();
    let worker_dst_dir = dst_dir.clone();
    let worker_src_count = srcs.len();
    let worker_paths = describe_debug_paths(&srcs);

    write_drag_debug_log(&format!(
        "backendMoveTask workerSpawn taskId={} dstDir={} strategy={} srcCount={} paths={}",
        task_id,
        dst_dir,
        move_conflict_strategy_key(strategy),
        worker_src_count,
        worker_paths
    ));

    tauri::async_runtime::spawn_blocking(move || {
        write_drag_debug_log(&format!(
            "backendMoveTask workerRunning taskId={} dstDir={} strategy={} srcCount={} paths={}",
            task_id_for_worker,
            worker_dst_dir,
            move_conflict_strategy_key(strategy),
            worker_src_count,
            worker_paths
        ));
        state.update(&task_id_for_worker, |snapshot| {
            if snapshot.status == "queued" {
                snapshot.status = "running".into();
            }
        });
        let result = move_files_impl(srcs, dst_dir, Some(strategy), Some(&progress));
        finish_move_transfer_task(&state, &task_id_for_worker, result);
    });

    Ok(task_id)
}

#[tauri::command]
pub(crate) fn list_transfer_tasks(
    state: tauri::State<TransferTaskState>,
) -> Result<Vec<TransferTaskSnapshot>, AppError> {
    state.list()
}

#[tauri::command]
pub(crate) fn cancel_transfer_task(
    state: tauri::State<TransferTaskState>,
    task_id: String,
) -> Result<(), AppError> {
    let mut tasks = state
        .0
        .lock()
        .map_err(|_| AppError::unavailable("传输任务状态不可用"))?;
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
pub(crate) fn clear_finished_transfer_tasks(
    state: tauri::State<TransferTaskState>,
) -> Result<(), AppError> {
    let mut tasks = state
        .0
        .lock()
        .map_err(|_| AppError::unavailable("传输任务状态不可用"))?;
    let now = now_unix_seconds();
    tasks.retain(|_, task| should_retain_transfer_task_after_clear(&task.snapshot, now));
    Ok(())
}

pub(crate) fn should_retain_transfer_task_after_clear(
    snapshot: &TransferTaskSnapshot,
    now: u64,
) -> bool {
    if !is_terminal_transfer_status(&snapshot.status) {
        return true;
    }
    let Some(finished_at) = snapshot.finished_at else {
        return false;
    };
    now.saturating_sub(finished_at) < FINISHED_TRANSFER_TASK_RETENTION_SECONDS
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::now_unix_seconds;
    use std::os::unix::fs as unix_fs;
    use std::path::PathBuf;
    use std::sync::atomic::AtomicBool;
    use std::sync::Arc;

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
        )
        .unwrap();

        assert_eq!(result.skipped_conflicts, 1);
        assert_eq!(result.copied.len(), 1);
        assert_eq!(
            std::fs::read_to_string(dst_dir.join("same.txt")).unwrap(),
            "existing"
        );
        assert_eq!(
            std::fs::read_to_string(dst_dir.join("fresh.txt")).unwrap(),
            "fresh"
        );

        let _ = std::fs::remove_dir_all(&temp);
    }

    #[test]
    fn copy_files_replace_conflicts_overwrites_existing_target() {
        let temp =
            std::env::temp_dir().join(format!("aether-copy-replace-{}", std::process::id()));
        let src_dir = temp.join("src");
        let dst_dir = temp.join("dst");
        let _ = std::fs::remove_dir_all(&temp);
        std::fs::create_dir_all(&src_dir).unwrap();
        std::fs::create_dir_all(&dst_dir).unwrap();

        let src = src_dir.join("same.txt");
        let dst = dst_dir.join("same.txt");
        std::fs::write(&src, b"new-content").unwrap();
        std::fs::write(&dst, b"old-content").unwrap();
        let expected_dst = dst.canonicalize().unwrap().to_string_lossy().to_string();

        let result = copy_files(
            vec![src.to_string_lossy().into()],
            dst_dir.to_string_lossy().into(),
            Some(MoveConflictStrategy::Replace),
        )
        .unwrap();

        assert!(result.conflicts.is_empty());
        assert!(result.failed.is_empty());
        assert_eq!(result.copied, vec![expected_dst]);
        assert_eq!(std::fs::read_to_string(&dst).unwrap(), "new-content");
        assert_eq!(std::fs::read_to_string(&src).unwrap(), "new-content");
        assert!(std::fs::read_dir(&dst_dir).unwrap().all(|entry| !entry
            .unwrap()
            .file_name()
            .to_string_lossy()
            .contains("aether-replace-backup")));

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
        )
        .unwrap();

        assert_eq!(result.skipped_conflicts, 1);
        assert_eq!(result.moved.len(), 1);
        assert!(conflicting_src.exists());
        assert!(!fresh_src.exists());
        assert_eq!(
            std::fs::read_to_string(dst_dir.join("same.txt")).unwrap(),
            "existing"
        );
        assert_eq!(
            std::fs::read_to_string(dst_dir.join("fresh.txt")).unwrap(),
            "fresh"
        );

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
            error_path: None,
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

        snapshot.finished_at =
            Some(now.saturating_sub(FINISHED_TRANSFER_TASK_RETENTION_SECONDS + 1));
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
                    error_path: None,
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
    fn finish_move_transfer_task_preserves_failed_source_path() {
        let state = TransferTaskState::default();
        let cancel_requested = Arc::new(AtomicBool::new(false));
        state
            .insert(
                TransferTaskSnapshot {
                    id: "move-failed-source".into(),
                    kind: "move".into(),
                    status: "running".into(),
                    total_items: 1,
                    completed_items: 0,
                    total_bytes: 0,
                    completed_bytes: 0,
                    current_name: None,
                    error: None,
                    error_path: None,
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
            "move-failed-source",
            Ok(MoveResult {
                moved: vec![],
                copied_cross_device: vec![],
                failed: vec![
                    MoveFailure {
                        src: "/tmp/other.txt".into(),
                        error: "No such file or directory".into(),
                    },
                    MoveFailure {
                        src: "/Users/jane/Documents/report.txt".into(),
                        error: "Operation not permitted".into(),
                    },
                ],
                conflicts: vec![],
                skipped_same_dir: 0,
                skipped_conflicts: 0,
            }),
        );

        let snapshot = state.list().unwrap().into_iter().next().unwrap();
        assert_eq!(snapshot.status, "failed");
        assert_eq!(
            snapshot.error_path.as_deref(),
            Some("/Users/jane/Documents/report.txt")
        );
    }

    #[test]
    fn move_conflict_preview_treats_noncanonical_same_dir_as_same_dir() {
        let temp = std::env::temp_dir().join(format!(
            "aether-move-canonical-same-dir-{}",
            std::process::id()
        ));
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
        let temp =
            std::env::temp_dir().join(format!("aether-copy-canonical-self-{}", std::process::id()));
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
        let temp =
            std::env::temp_dir().join(format!("aether-copy-progress-{}", std::process::id()));
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
                    error_path: None,
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
        let temp =
            std::env::temp_dir().join(format!("aether-copy-file-cancel-{}", std::process::id()));
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
        assert!(std::fs::read_dir(&temp).unwrap().all(|entry| !entry
            .unwrap()
            .file_name()
            .to_string_lossy()
            .contains("aether-copy-temp")));

        let _ = std::fs::remove_dir_all(&temp);
    }

    #[test]
    fn copy_dir_recursive_with_progress_removes_staged_tree_on_cancel() {
        let temp =
            std::env::temp_dir().join(format!("aether-copy-dir-cancel-{}", std::process::id()));
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
        assert!(std::fs::read_dir(&temp).unwrap().all(|entry| !entry
            .unwrap()
            .file_name()
            .to_string_lossy()
            .contains("aether-copy-dir-temp")));

        let _ = std::fs::remove_dir_all(&temp);
    }

    #[test]
    fn copy_dir_recursive_copies_symlink_without_following_target() {
        let temp =
            std::env::temp_dir().join(format!("aether-copy-symlink-dir-{}", std::process::id()));
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
        assert!(std::fs::symlink_metadata(&copied_link)
            .unwrap()
            .file_type()
            .is_symlink());
        assert_eq!(std::fs::read_link(&copied_link).unwrap(), outside);
        assert!(!dst.join("outside").exists());

        let _ = std::fs::remove_dir_all(&temp);
    }

    #[test]
    fn copy_dir_recursive_copies_self_symlink_without_recursing() {
        let temp =
            std::env::temp_dir().join(format!("aether-copy-self-symlink-{}", std::process::id()));
        let src = temp.join("src");
        let dst = temp.join("dst");
        let _ = std::fs::remove_dir_all(&temp);
        std::fs::create_dir_all(&src).unwrap();
        std::fs::write(src.join("file.txt"), b"content").unwrap();
        unix_fs::symlink(&src, src.join("self-link")).unwrap();

        copy_dir_recursive(&src, &dst).unwrap();

        let copied_link = dst.join("self-link");
        assert!(std::fs::symlink_metadata(&copied_link)
            .unwrap()
            .file_type()
            .is_symlink());
        assert_eq!(std::fs::read_link(&copied_link).unwrap(), src);
        assert_eq!(
            std::fs::read_to_string(dst.join("file.txt")).unwrap(),
            "content"
        );

        let _ = std::fs::remove_dir_all(&temp);
    }

    #[test]
    fn copy_files_preserves_dangling_symlink() {
        let temp = std::env::temp_dir().join(format!(
            "aether-copy-dangling-symlink-{}",
            std::process::id()
        ));
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
        assert!(std::fs::symlink_metadata(&copied_link)
            .unwrap()
            .file_type()
            .is_symlink());
        assert_eq!(std::fs::read_link(&copied_link).unwrap(), missing_target);
        assert!(!copied_link.exists());

        let _ = std::fs::remove_dir_all(&temp);
    }

    #[test]
    fn copy_file_command_preserves_symlink() {
        let temp = std::env::temp_dir().join(format!(
            "aether-copy-command-symlink-{}",
            std::process::id()
        ));
        let src_dir = temp.join("src");
        let dst_dir = temp.join("dst");
        let _ = std::fs::remove_dir_all(&temp);
        std::fs::create_dir_all(&src_dir).unwrap();
        std::fs::create_dir_all(&dst_dir).unwrap();
        let real_file = src_dir.join("real.txt");
        let link = src_dir.join("real-link.txt");
        std::fs::write(&real_file, b"real").unwrap();
        unix_fs::symlink(&real_file, &link).unwrap();

        let copied = copy_file(
            link.to_string_lossy().into(),
            dst_dir.to_string_lossy().into(),
        )
        .unwrap();
        let copied_link = PathBuf::from(copied);

        assert!(std::fs::symlink_metadata(&copied_link)
            .unwrap()
            .file_type()
            .is_symlink());
        assert_eq!(std::fs::read_link(&copied_link).unwrap(), real_file);

        let _ = std::fs::remove_dir_all(&temp);
    }

    #[test]
    fn commit_staged_path_removes_staged_target_when_cancelled() {
        let temp =
            std::env::temp_dir().join(format!("aether-commit-cancel-{}", std::process::id()));
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
        let temp =
            std::env::temp_dir().join(format!("aether-replace-copy-cancel-{}", std::process::id()));
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
        assert!(std::fs::read_dir(&temp).unwrap().all(|entry| !entry
            .unwrap()
            .file_name()
            .to_string_lossy()
            .contains("aether-replace-backup")));

        let _ = std::fs::remove_dir_all(&temp);
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
}
