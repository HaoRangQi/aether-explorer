use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{Manager, TitleBarStyle, WebviewUrl, WebviewWindowBuilder};

#[cfg(target_os = "macos")]
use tauri::menu::{Menu, MenuItem};

#[derive(Debug, Serialize, Clone)]
struct FileEntry {
    name: String,
    path: String,
    is_dir: bool,
    size: String,
    modified: String,
    #[serde(rename = "type")]
    file_type: String,
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

fn parse_df_line(line: &str) -> Result<(&str, &str, &str, &str, &str, String), String> {
    let cols: Vec<&str> = line.split_whitespace().collect();
    if cols.len() < 6 {
        return Err(format!("磁盘信息格式异常: {}", line));
    }
    Ok((cols[0], cols[1], cols[2], cols[3], cols[4], cols[5..].join(" ")))
}

fn detect_mime(name: &str, is_dir: bool) -> String {
    if is_dir {
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
        "txt" | "md" | "markdown" | "csv" | "tsv" | "json" | "yaml" | "yml" | "xml" | "toml" | "ini" | "cfg" | "conf" | "log" | "lock" | "env" | "rst" | "txt~" => "text",
        _ => "file",
    }
    .into()
}

fn format_modified(metadata: &fs::Metadata) -> String {
    metadata
        .modified()
        .ok()
        .and_then(|t| {
            let dt: chrono::DateTime<chrono::Local> = t.into();
            Some(dt.format("%Y-%m-%d %H:%M").to_string())
        })
        .unwrap_or_else(|| "未知".into())
}

#[tauri::command]
fn list_directory(dir_path: String, show_hidden: bool) -> Result<Vec<FileEntry>, String> {
    let entries = fs::read_dir(&dir_path).map_err(|e| {
        let msg = e.to_string();
        if msg.contains("permission") || msg.contains("denied") || msg.contains("not allowed") {
            format!("PermissionDenied: 无法读取目录 {}", dir_path)
        } else {
            format!("无法读取目录: {}", e)
        }
    })?;

    let mut files: Vec<FileEntry> = Vec::new();
    let mut dirs: Vec<FileEntry> = Vec::new();

    for entry in entries {
        let entry = entry.map_err(|e| format!("读取条目失败: {}", e))?;
        let name = entry.file_name().to_string_lossy().to_string();

        if !show_hidden && name.starts_with('.') {
            continue;
        }

        let path = entry.path().to_string_lossy().to_string();
        let metadata = entry.metadata().map_err(|e| format!("读取元数据失败: {}", e))?;
        let is_dir = metadata.is_dir();
        let size = if is_dir {
            "--".into()
        } else {
            format_size(metadata.len())
        };
        let modified = format_modified(&metadata);
        let file_type = detect_mime(&name, is_dir);

        let fe = FileEntry {
            name,
            path,
            is_dir,
            size,
            modified,
            file_type,
        };

        if is_dir {
            dirs.push(fe);
        } else {
            files.push(fe);
        }
    }

    // Sort: directories first, then files, both alphabetically
    dirs.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    files.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    dirs.append(&mut files);

    Ok(dirs)
}

#[tauri::command]
fn get_home_dir() -> String {
    dirs_fun()
}

fn dirs_fun() -> String {
    std::env::var("HOME").unwrap_or_else(|_| "/".into())
}

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! Welcome to Aether Explorer.", name)
}

#[tauri::command]
fn read_text_preview(path: String) -> Result<String, String> {
    use std::io::Read;
    let mut file = fs::File::open(&path).map_err(|e| format!("无法打开文件: {}", e))?;
    let mut buf = vec![0u8; 8192]; // First 8KB
    let n = file.read(&mut buf).map_err(|e| format!("读取失败: {}", e))?;
    buf.truncate(n);
    String::from_utf8(buf).map_err(|e| format!("不是有效的文本文件: {}", e))
}

#[tauri::command]
fn open_system_settings() -> Result<(), String> {
    std::process::Command::new("open")
        .args(["x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles"])
        .spawn()
        .map_err(|e| format!("无法打开系统设置: {}", e))?;
    Ok(())
}

#[tauri::command]
fn start_window_drag(window: tauri::WebviewWindow) -> Result<(), String> {
    window.start_dragging().map_err(|e| format!("启动窗口拖拽失败: {}", e))
}

#[tauri::command]
fn debug_log(message: String) {
    println!("[DEBUG-dnd] {}", message);
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
) -> Result<String, String> {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| format!("生成窗口标识失败: {}", e))?
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
        .map_err(|e| format!("创建窗口失败: {}", e))?;

    let _ = window.show();
    let _ = window.set_focus();
    Ok(label)
}

#[tauri::command]
fn list_fonts() -> Result<Vec<String>, String> {
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
    fonts.sort_by(|a, b| a.to_lowercase().cmp(&b.to_lowercase()));
    Ok(fonts)
}

// ── File Operations ──

fn unique_destination(path: &Path) -> std::path::PathBuf {
    if !path.exists() {
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
        if !candidate.exists() {
            return candidate;
        }
    }

    path.to_path_buf()
}

fn copy_dir_recursive(src: &Path, dst: &Path) -> Result<(), String> {
    fs::create_dir_all(dst).map_err(|e| format!("创建目标目录失败: {}", e))?;
    for entry in fs::read_dir(src).map_err(|e| format!("读取目录失败: {}", e))? {
        let entry = entry.map_err(|e| format!("读取条目失败: {}", e))?;
        let src_path = entry.path();
        let dst_path = dst.join(entry.file_name());
        if src_path.is_dir() {
            copy_dir_recursive(&src_path, &dst_path)?;
        } else {
            fs::copy(&src_path, &dst_path).map_err(|e| format!("复制文件失败: {}", e))?;
        }
    }
    Ok(())
}

#[tauri::command]
fn copy_file(src: String, dst: String) -> Result<String, String> {
    let src_path = Path::new(&src);
    let name = src_path.file_name().unwrap_or_default().to_string_lossy();
    let dst_path = unique_destination(&Path::new(&dst).join(name.as_ref()));
    if src_path.is_dir() {
        copy_dir_recursive(src_path, &dst_path)?;
    } else {
        fs::copy(&src, &dst_path).map_err(|e| format!("复制失败: {}", e))?;
    }
    Ok(dst_path.to_string_lossy().into())
}

#[tauri::command]
fn move_file(src: String, dst_dir: String) -> Result<String, String> {
    let src_path = Path::new(&src);
    let name = src_path.file_name().unwrap_or_default().to_string_lossy();
    let dst_path = unique_destination(&Path::new(&dst_dir).join(name.as_ref()));
    fs::rename(&src, &dst_path).map_err(|e| format!("移动失败: {}", e))?;
    Ok(dst_path.to_string_lossy().into())
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

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
enum MoveConflictStrategy {
    Abort,
    Replace,
    KeepBoth,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct MoveResult {
    moved: Vec<String>,
    failed: Vec<MoveFailure>,
    conflicts: Vec<MoveConflict>,
    skipped_same_dir: u32,
}

#[tauri::command]
fn move_files(
    srcs: Vec<String>,
    dst_dir: String,
    conflict_strategy: Option<MoveConflictStrategy>,
) -> Result<MoveResult, String> {
    let dst = Path::new(&dst_dir);
    if !dst.is_dir() {
        return Err(format!("目标不是目录: {}", dst_dir));
    }

    let conflict_strategy = conflict_strategy.unwrap_or(MoveConflictStrategy::Abort);
    let mut moved: Vec<String> = Vec::new();
    let mut failed: Vec<MoveFailure> = Vec::new();
    let mut conflicts: Vec<MoveConflict> = Vec::new();
    let mut skipped_same_dir: u32 = 0;

    if matches!(conflict_strategy, MoveConflictStrategy::Abort) {
        for src in &srcs {
            let src_path = Path::new(src);
            if !src_path.exists() {
                continue;
            }
            if src_path.parent().is_some_and(|parent| parent == dst) {
                continue;
            }

            let name = src_path.file_name().unwrap_or_default().to_string_lossy();
            let dst_path = dst.join(name.as_ref());
            if dst_path.exists() {
                conflicts.push(MoveConflict {
                    src: src.clone(),
                    dst: dst_path.to_string_lossy().into(),
                    name: name.into(),
                });
            }
        }

        if !conflicts.is_empty() {
            return Ok(MoveResult { moved, failed, conflicts, skipped_same_dir });
        }
    }

    for src in srcs {
        let src_path = Path::new(&src);

        if !src_path.exists() {
            failed.push(MoveFailure { src: src.clone(), error: "源不存在".into() });
            continue;
        }

        if let Some(parent) = src_path.parent() {
            if parent == dst {
                skipped_same_dir += 1;
                continue;
            }
        }

        if dst == src_path || dst.starts_with(src_path) {
            failed.push(MoveFailure {
                src: src.clone(),
                error: "目标在源目录内".into(),
            });
            continue;
        }

        let name = src_path.file_name().unwrap_or_default().to_string_lossy();
        let base_dst_path = dst.join(name.as_ref());
        let dst_path = match conflict_strategy {
            MoveConflictStrategy::Abort => base_dst_path,
            MoveConflictStrategy::KeepBoth => unique_destination(&base_dst_path),
            MoveConflictStrategy::Replace => {
                if base_dst_path.exists() {
                    let remove_result = if base_dst_path.is_dir() {
                        fs::remove_dir_all(&base_dst_path)
                    } else {
                        fs::remove_file(&base_dst_path)
                    };
                    if let Err(e) = remove_result {
                        failed.push(MoveFailure {
                            src: src.clone(),
                            error: format!("替换目标失败: {}", e),
                        });
                        continue;
                    }
                }
                base_dst_path
            }
        };

        match fs::rename(&src, &dst_path) {
            Ok(_) => moved.push(dst_path.to_string_lossy().into()),
            Err(e) => {
                // EXDEV on macOS / Linux = 18 (cross-device link)
                let is_cross_device = matches!(e.raw_os_error(), Some(18));
                if is_cross_device {
                    let copy_outcome = if src_path.is_dir() {
                        copy_dir_recursive(src_path, &dst_path)
                    } else {
                        fs::copy(src_path, &dst_path)
                            .map(|_| ())
                            .map_err(|err| format!("跨设备复制失败: {}", err))
                    };
                    match copy_outcome {
                        Ok(_) => {
                            let rm_outcome = if src_path.is_dir() {
                                fs::remove_dir_all(src_path)
                            } else {
                                fs::remove_file(src_path)
                            };
                            if let Err(rm_err) = rm_outcome {
                                failed.push(MoveFailure {
                                    src: src.clone(),
                                    error: format!("已复制但源删除失败: {}", rm_err),
                                });
                            } else {
                                moved.push(dst_path.to_string_lossy().into());
                            }
                        }
                        Err(copy_err) => failed.push(MoveFailure {
                            src: src.clone(),
                            error: copy_err,
                        }),
                    }
                } else {
                    failed.push(MoveFailure {
                        src: src.clone(),
                        error: format!("{}", e),
                    });
                }
            }
        }
    }

    Ok(MoveResult { moved, failed, conflicts, skipped_same_dir })
}

#[tauri::command]
fn rename_file(path: String, new_name: String) -> Result<String, String> {
    let parent = Path::new(&path).parent().unwrap_or(Path::new("/"));
    let new_path = parent.join(&new_name);
    fs::rename(&path, &new_path).map_err(|e| format!("重命名失败: {}", e))?;
    Ok(new_path.to_string_lossy().into())
}

#[tauri::command]
fn delete_to_trash(path: String) -> Result<(), String> {
    trash::delete(&path).map_err(|e| format!("移至废纸篓失败: {}", e))
}

#[tauri::command]
fn create_file(parent_dir: String, name: String) -> Result<String, String> {
    let file_path = unique_destination(&Path::new(&parent_dir).join(&name));
    fs::write(&file_path, "").map_err(|e| format!("创建文件失败: {}", e))?;
    Ok(file_path.to_string_lossy().into())
}

#[tauri::command]
fn create_folder(parent_dir: String, name: String) -> Result<String, String> {
    let dir_path = unique_destination(&Path::new(&parent_dir).join(&name));
    fs::create_dir(&dir_path).map_err(|e| format!("创建文件夹失败: {}", e))?;
    Ok(dir_path.to_string_lossy().into())
}

#[tauri::command]
fn make_alias(path: String) -> Result<String, String> {
    let parent = Path::new(&path).parent().unwrap_or(Path::new("/"));
    let name = Path::new(&path).file_name().unwrap_or_default().to_string_lossy();
    let alias_name = format!("{} 的替身", name);
    let alias_path = parent.join(&alias_name);

    #[cfg(target_os = "macos")]
    std::os::unix::fs::symlink(&path, &alias_path)
        .map_err(|e| format!("创建替身失败: {}", e))?;

    #[cfg(not(target_os = "macos"))]
    fs::write(&alias_path, format!("alias: {}", path))
        .map_err(|e| format!("创建替身失败: {}", e))?;

    Ok(alias_path.to_string_lossy().into())
}

#[tauri::command]
fn compress_files(paths: Vec<String>, output: String) -> Result<String, String> {
    let file = fs::File::create(&output).map_err(|e| format!("创建压缩文件失败: {}", e))?;
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
                .map_err(|e| format!("压缩失败: {}", e))?;
            let mut input = fs::File::open(p).map_err(|e| format!("读取文件失败: {}", e))?;
            std::io::copy(&mut input, &mut zip_writer).map_err(|e| format!("写入压缩失败: {}", e))?;
        }
    }

    zip_writer.finish().map_err(|e| format!("完成压缩失败: {}", e))?;
    Ok(output)
}

#[tauri::command]
fn decompress_file(path: String, output_dir: String) -> Result<String, String> {
    let file = fs::File::open(&path).map_err(|e| format!("打开压缩文件失败: {}", e))?;
    let mut archive = zip::ZipArchive::new(file).map_err(|e| format!("读取压缩文件失败: {}", e))?;

    for i in 0..archive.len() {
        let mut entry = archive.by_index(i).map_err(|e| format!("读取条目失败: {}", e))?;
        let enclosed = entry
            .enclosed_name()
            .ok_or_else(|| format!("压缩包包含不安全路径: {}", entry.name()))?;
        let out_path = Path::new(&output_dir).join(enclosed);

        if entry.is_dir() {
            fs::create_dir_all(&out_path).ok();
        } else {
            if let Some(parent) = out_path.parent() {
                fs::create_dir_all(parent).ok();
            }
            let mut out_file = fs::File::create(&out_path)
                .map_err(|e| format!("创建解压文件失败: {}", e))?;
            std::io::copy(&mut entry, &mut out_file)
                .map_err(|e| format!("解压写入失败: {}", e))?;
        }
    }

    Ok(output_dir)
}

fn dir_size_recursive(dir: &Path) -> (u64, u64) {
    let mut total_bytes: u64 = 0;
    let mut file_count: u64 = 0;
    let mut stack: Vec<std::path::PathBuf> = vec![dir.to_path_buf()];

    while let Some(current) = stack.pop() {
        let entries = match fs::read_dir(&current) {
            Ok(entries) => entries,
            Err(_) => continue, // 跳过无权限的目录
        };
        for entry in entries {
            let entry = match entry {
                Ok(e) => e,
                Err(_) => continue,
            };
            let path = entry.path();
            if path.is_symlink() {
                continue;
            }
            match entry.metadata() {
                Ok(meta) => {
                    if meta.is_dir() {
                        stack.push(path);
                    } else {
                        total_bytes += meta.len();
                        file_count += 1;
                    }
                }
                Err(_) => continue,
            }
        }
    }
    (total_bytes, file_count)
}

#[tauri::command]
fn get_dir_size(path: String) -> Result<serde_json::Value, String> {
    let dir = Path::new(&path);
    if !dir.is_dir() {
        return Err("不是一个目录".into());
    }
    let (bytes, file_count) = dir_size_recursive(dir);
    Ok(serde_json::json!({
        "bytes": bytes,
        "formatted": format_size(bytes),
        "file_count": file_count
    }))
}

#[tauri::command]
fn get_file_info(path: String) -> Result<FileEntry, String> {
    let p = Path::new(&path);
    let name = p.file_name().unwrap_or_default().to_string_lossy().to_string();
    let metadata = fs::metadata(&path).map_err(|e| format!("读取元数据失败: {}", e))?;
    let is_dir = metadata.is_dir();
    let size = if is_dir { "--".into() } else { format_size(metadata.len()) };
    let modified = format_modified(&metadata);
    let file_type = detect_mime(&name, is_dir);

    Ok(FileEntry { name, path, is_dir, size, modified, file_type })
}

fn add_dir_to_zip(
    writer: &mut zip::ZipWriter<fs::File>,
    base: &Path,
    dir: &Path,
    options: zip::write::SimpleFileOptions,
) -> Result<(), String> {
    for entry in fs::read_dir(dir).map_err(|e| format!("读取目录失败: {}", e))? {
        let entry = entry.map_err(|e| format!("读取条目失败: {}", e))?;
        let path = entry.path();
        let relative = path.strip_prefix(base).unwrap_or(&path);
        let name = relative.to_string_lossy();

        if path.is_dir() {
            writer
                .add_directory(name.as_ref(), options)
                .map_err(|e| format!("添加目录失败: {}", e))?;
            add_dir_to_zip(writer, base, &path, options)?;
        } else {
            writer
                .start_file(name.as_ref(), options)
                .map_err(|e| format!("添加文件失败: {}", e))?;
            let mut input = fs::File::open(&path).map_err(|e| format!("读取文件失败: {}", e))?;
            std::io::copy(&mut input, &mut *writer).map_err(|e| format!("写入失败: {}", e))?;
        }
    }
    Ok(())
}

#[tauri::command]
fn open_devtools(window: tauri::WebviewWindow) -> Result<(), String> {
    window.open_devtools();
    Ok(())
}

#[tauri::command]
fn quick_look(path: String) -> Result<(), String> {
    std::process::Command::new("qlmanage")
        .args(["-p", &path])
        .spawn()
        .map_err(|e| format!("无法打开 Quick Look: {}", e))?;
    Ok(())
}

#[tauri::command]
fn reveal_in_finder(path: String) -> Result<(), String> {
    std::process::Command::new("open")
        .args(["-R", &path])
        .spawn()
        .map_err(|e| format!("无法在 Finder 中显示: {}", e))?;
    Ok(())
}

#[tauri::command]
fn open_path(path: String) -> Result<(), String> {
    std::process::Command::new("open")
        .arg(&path)
        .spawn()
        .map_err(|e| format!("无法打开文件: {}", e))?;
    Ok(())
}

#[tauri::command]
fn get_disk_info(path: String) -> Result<DiskInfo, String> {
    let output = std::process::Command::new("df")
        .args(["-k", "-P", &path])
        .output()
        .map_err(|e| format!("获取磁盘信息失败: {}", e))?;
    let text = String::from_utf8(output.stdout).map_err(|e| format!("解析磁盘信息失败: {}", e))?;
    let line = text.lines().nth(1).ok_or_else(|| "磁盘信息为空".to_string())?;
    let (filesystem, size, used, available, capacity, mount) = parse_df_line(line)?;
    Ok(DiskInfo {
        filesystem: filesystem.into(),
        size: format_kib(size),
        used: format_kib(used),
        available: format_kib(available),
        capacity: capacity.into(),
        capacity_value: parse_capacity(capacity),
        mount,
    })
}

fn parse_capacity(value: &str) -> u8 {
    value
        .trim_end_matches('%')
        .parse::<u8>()
        .unwrap_or(0)
        .min(100)
}

#[tauri::command]
fn list_volumes() -> Result<Vec<VolumeInfo>, String> {
    let output = std::process::Command::new("df")
        .args(["-k", "-P"])
        .output()
        .map_err(|e| format!("获取卷信息失败: {}", e))?;

    let text = String::from_utf8(output.stdout).map_err(|e| format!("解析卷信息失败: {}", e))?;
    let mut volumes = Vec::new();
    let mut seen_mounts = std::collections::HashSet::new();

    for line in text.lines().skip(1) {
        let Ok((filesystem, size, used, available, capacity, mount)) = parse_df_line(line) else {
            continue;
        };
        if mount != "/" && !mount.starts_with("/Volumes") {
            continue;
        }
        if !seen_mounts.insert(mount.clone()) {
            continue;
        }

        let name = if mount == "/" {
            "Macintosh HD".to_string()
        } else {
            Path::new(&mount)
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or(&mount)
                .to_string()
        };

        volumes.push(VolumeInfo {
            name,
            path: mount.clone(),
            filesystem: filesystem.into(),
            size: format_kib(size),
            used: format_kib(used),
            available: format_kib(available),
            capacity: capacity.into(),
            capacity_value: parse_capacity(capacity),
            is_root: mount == "/",
            is_external: mount.starts_with("/Volumes/"),
            is_ejectable: mount.starts_with("/Volumes/"),
        });
    }

    volumes.sort_by(|a, b| b.is_root.cmp(&a.is_root).then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase())));
    Ok(volumes)
}

#[tauri::command]
fn eject_volume(path: String) -> Result<(), String> {
    if !path.starts_with("/Volumes/") {
        return Err("只能弹出 /Volumes 下的外置磁盘".into());
    }

    let status = std::process::Command::new("diskutil")
        .args(["eject", &path])
        .status()
        .map_err(|e| format!("弹出磁盘失败: {}", e))?;

    if status.success() {
        Ok(())
    } else {
        Err("弹出磁盘失败：磁盘可能正在被占用".into())
    }
}

#[tauri::command]
fn list_terminal_apps() -> Result<Vec<String>, String> {
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

    terminals.sort_by(|a, b| a.to_lowercase().cmp(&b.to_lowercase()));
    terminals.dedup();
    Ok(terminals)
}

#[tauri::command]
fn open_terminal_at(path: String, terminal_app: Option<String>, args: Option<String>, custom_command: Option<String>) -> Result<(), String> {
    let target_path = Path::new(&path);
    let dir = if target_path.is_dir() {
        target_path.to_path_buf()
    } else {
        target_path.parent().unwrap_or(Path::new("/")).to_path_buf()
    };
    let dir_str = dir.to_string_lossy().to_string();

    let app_name = terminal_app.unwrap_or_else(|| "Terminal".into());
    let arg_text = args.unwrap_or_default();
    let lower = app_name.to_lowercase();
    let command_tail = custom_command
        .as_deref()
        .map(str::trim)
        .filter(|c| !c.is_empty())
        .or_else(|| {
            let trimmed_args = arg_text.trim();
            if trimmed_args.is_empty() { None } else { Some(trimmed_args) }
        });
    let command = match command_tail {
        Some(tail) => format!("cd {} && {}", shell_quote(&dir_str), tail),
        None => format!("cd {}", shell_quote(&dir_str)),
    };

    if lower.contains("terminal") || lower.contains("iterm") {
        let script = if lower.contains("iterm") {
            format!(
                "tell application \"{}\"\nactivate\ncreate window with default profile\ntell current session of current window to write text \"{}\"\nend tell",
                app_name.replace('\\', "\\\\").replace('"', "\\\""),
                command.replace('\\', "\\\\").replace('"', "\\\"")
            )
        } else {
            format!(
                "tell application \"{}\" to do script \"{}\"",
                app_name.replace('\\', "\\\\").replace('"', "\\\""),
                command.replace('\\', "\\\\").replace('"', "\\\"")
            )
        };
        let output = std::process::Command::new("osascript")
            .args(["-e", &script])
            .output()
            .map_err(|e| format!("打开终端失败: {}", e))?;
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(format!("AppleScript 错误: {}", stderr));
        }
    } else {
        std::process::Command::new("open")
            .args(["-a", &app_name, &dir_str])
            .spawn()
            .map_err(|e| format!("打开终端应用失败: {}", e))?;
    }
    Ok(())
}

fn apple_quote(value: &str) -> String {
    format!("\"{}\"", value.replace('\\', "\\\\").replace('"', "\\\""))
}

fn shell_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_updater::Builder::default().build())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            // 设置 macOS Dock 菜单
            #[cfg(target_os = "macos")]
            {
                use tauri::menu::MenuEvent;

                let new_window_item = MenuItem::with_id(app, "new-window", "新建窗口", true, Some("CmdOrCtrl+N"))?;
                let dock_menu = Menu::with_items(app, &[&new_window_item])?;

                // 使用 app.set_menu 而不是 set_dock_menu
                app.set_menu(dock_menu)?;

                // 监听菜单事件
                let app_handle = app.handle().clone();
                app.on_menu_event(move |_app, event: MenuEvent| {
                    if event.id() == "new-window" {
                        let handle = app_handle.clone();
                        tauri::async_runtime::spawn(async move {
                            let _ = create_app_window(handle, None, None).await;
                        });
                    }
                });
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            greet,
            list_directory,
            get_home_dir,
            open_system_settings,
            start_window_drag,
            debug_log,
            list_fonts,
            list_terminal_apps,
            open_terminal_at,
            create_app_window,
            read_text_preview,
            get_disk_info,
            list_volumes,
            eject_volume,
            copy_file,
            move_file,
            move_files,
            rename_file,
            delete_to_trash,
            create_file,
            create_folder,
            make_alias,
            compress_files,
            decompress_file,
            get_file_info,
            get_dir_size,
            open_devtools,
            quick_look,
            reveal_in_finder,
            open_path
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
