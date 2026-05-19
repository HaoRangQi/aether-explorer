use serde::{Deserialize, Serialize};
use std::fs;
use std::hash::{Hash, Hasher};
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
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
fn get_app_icon(path: String) -> Result<Option<String>, String> {
    Ok(resolve_app_icon_png(Path::new(&path)))
}

fn format_modified(metadata: &fs::Metadata) -> String {
    metadata
        .modified()
        .ok()
        .and_then(|t| {
            let dt: chrono::DateTime<chrono::Local> = t.into();
            Some(dt.format("%Y-%m-%d %H:%M:%S").to_string())
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
fn read_text_preview(path: String) -> Result<String, String> {
    use std::io::Read;
    let p = Path::new(&path);
    if is_sensitive_for_preview(p) {
        return Err("此文件类型默认不在预览面板展示（含敏感信息）— 可使用『打开方式』显式打开".into());
    }
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
) -> Result<Option<String>, String> {
    let windows = app.webview_windows();
    for (label, win) in windows.iter() {
        if label == &except_window { continue; }
        if label == "drag-preview" { continue; }
        let factor = win.scale_factor().map_err(|e| e.to_string())?;
        let pos = win.outer_position().map_err(|e| e.to_string())?;
        let size = win.outer_size().map_err(|e| e.to_string())?;
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

// 路径规范化 — 对用户输入的目标目录做 canonicalize。
// 防 `..` 跳逃 + 符号链接绕过 scope。失败说明路径不存在或无权限，直接返 Err。
fn safe_canonicalize(path: &Path) -> Result<std::path::PathBuf, String> {
    path.canonicalize()
        .map_err(|e| format!("路径解析失败 {}: {}", path.display(), e))
}

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

#[tauri::command]
fn set_file_clipboard(
    state: tauri::State<FileClipboardState>,
    paths: Vec<String>,
    cut: bool,
) -> Result<(), String> {
    let mut clipboard = state.0.lock().map_err(|_| "文件剪贴板不可用".to_string())?;
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
) -> Result<Option<FileTransferPayload>, String> {
    let clipboard = state.0.lock().map_err(|_| "文件剪贴板不可用".to_string())?;
    Ok(clipboard.clone())
}

#[tauri::command]
fn clear_file_clipboard(state: tauri::State<FileClipboardState>) -> Result<(), String> {
    let mut clipboard = state.0.lock().map_err(|_| "文件剪贴板不可用".to_string())?;
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
) -> Result<(), String> {
    let mut drag_payload = state.0.lock().map_err(|_| "文件拖拽状态不可用".to_string())?;
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
) -> Result<Option<FileTransferPayload>, String> {
    let drag_payload = state.0.lock().map_err(|_| "文件拖拽状态不可用".to_string())?;
    Ok(drag_payload.clone())
}

#[tauri::command]
fn clear_file_drag_payload(state: tauri::State<FileDragState>) -> Result<(), String> {
    let mut drag_payload = state.0.lock().map_err(|_| "文件拖拽状态不可用".to_string())?;
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

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct CopyResult {
    copied: Vec<String>,
    failed: Vec<MoveFailure>,
    conflicts: Vec<MoveConflict>,
}

#[tauri::command]
fn copy_files(
    srcs: Vec<String>,
    dst_dir: String,
    conflict_strategy: Option<MoveConflictStrategy>,
) -> Result<CopyResult, String> {
    let dst_buf = safe_canonicalize(Path::new(&dst_dir))?;
    let dst = dst_buf.as_path();
    if !dst.is_dir() {
        return Err(format!("目标不是目录: {}", dst_dir));
    }

    let conflict_strategy = conflict_strategy.unwrap_or(MoveConflictStrategy::Abort);
    let mut copied: Vec<String> = Vec::new();
    let mut failed: Vec<MoveFailure> = Vec::new();
    let mut conflicts: Vec<MoveConflict> = Vec::new();

    if matches!(conflict_strategy, MoveConflictStrategy::Abort) {
        for src in &srcs {
            let src_path = Path::new(src);
            if !src_path.exists() {
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
            return Ok(CopyResult { copied, failed, conflicts });
        }
    }

    for src in srcs {
        let src_path = Path::new(&src);

        if !src_path.exists() {
            failed.push(MoveFailure { src: src.clone(), error: "源不存在".into() });
            continue;
        }

        if src_path.is_dir() && (dst == src_path || dst.starts_with(src_path)) {
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
                if base_dst_path == src_path {
                    failed.push(MoveFailure {
                        src: src.clone(),
                        error: "不能替换自身".into(),
                    });
                    continue;
                }
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

        let copy_outcome = if src_path.is_dir() {
            copy_dir_recursive(src_path, &dst_path)
        } else {
            fs::copy(src_path, &dst_path)
                .map(|_| ())
                .map_err(|e| format!("复制失败: {}", e))
        };

        match copy_outcome {
            Ok(_) => copied.push(dst_path.to_string_lossy().into()),
            Err(e) => failed.push(MoveFailure { src: src.clone(), error: e }),
        }
    }

    Ok(CopyResult { copied, failed, conflicts })
}

#[tauri::command]
fn move_files(
    srcs: Vec<String>,
    dst_dir: String,
    conflict_strategy: Option<MoveConflictStrategy>,
) -> Result<MoveResult, String> {
    let dst_buf = safe_canonicalize(Path::new(&dst_dir))?;
    let dst = dst_buf.as_path();
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

/// 按需查目录的直接子项数（PERF_PLAN L2-B 配套）。
/// 前端建议加 TTL 缓存避免重复调用。
#[tauri::command]
fn get_child_count(path: String, show_hidden: bool) -> Result<u64, String> {
    let p = Path::new(&path);
    if !p.is_dir() {
        return Ok(0);
    }
    let count = fs::read_dir(p)
        .map(|c| c.flatten()
            .filter(|e| {
                if show_hidden { true }
                else { e.file_name().to_str().map(|n| !n.starts_with('.')).unwrap_or(true) }
            })
            .count() as u64)
        .unwrap_or(0);
    Ok(count)
}

#[tauri::command]
fn get_file_info(path: String) -> Result<FileEntry, String> {
    let p = Path::new(&path);
    let name = p.file_name().unwrap_or_default().to_string_lossy().to_string();
    let metadata = fs::metadata(&path).map_err(|e| format!("读取元数据失败: {}", e))?;
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
fn open_with(path: String, app_name: String) -> Result<(), String> {
    std::process::Command::new("open")
        .args(["-a", &app_name])
        .arg(&path)
        .spawn()
        .map_err(|e| format!("无法使用 {} 打开: {}", app_name, e))?;
    Ok(())
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

/// 拒绝包含 shell 元字符的用户命令片段。
///
/// 这一层防御针对自动化路径：菜单扩展的 terminalArgs / shell command 字段在没有
/// 用户二次确认时（confirmExecution=false）执行，必须保证 user_cmd 不会
/// "逃出" 我们包装的引号 / `cd` 前缀。
///
/// 拒绝的字符 / 序列见 FORBIDDEN_TOKENS。用户在设置面板手敲"高级命令"应走
/// confirmExecution=true 流程，前端可以选择跳过此校验。
const FORBIDDEN_TOKENS: &[&str] = &["$(", "`", "&&", "||", ";", "|", ">", "<", "\n", "\r"];

fn validate_shell_fragment(s: &str) -> Result<String, String> {
    let trimmed = s.trim();
    if trimmed.is_empty() {
        return Err("命令为空".into());
    }
    for tok in FORBIDDEN_TOKENS {
        if trimmed.contains(tok) {
            return Err(format!(
                "命令含受限字符 {} — 请改用『扩展菜单』的高级命令模式（启用执行前确认）",
                tok
            ));
        }
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
fn open_terminal_at(path: String, terminal_app: Option<String>, args: Option<String>, scripts: Option<Vec<String>>, custom_command: Option<String>) -> Result<(), String> {
    let target_path = Path::new(&path);
    let dir = if target_path.is_dir() {
        target_path.to_path_buf()
    } else {
        target_path.parent().unwrap_or(Path::new("/")).to_path_buf()
    };
    let dir_str = dir.to_string_lossy().to_string();

    let app_name = terminal_app.unwrap_or_else(|| "Terminal".into());
    if !is_allowed_terminal(&app_name) {
        return Err(format!("不允许的终端应用: {}", app_name));
    }
    let arg_text = args.unwrap_or_default();

    // scripts 数组逐条验证后拼接
    let scripts_tail: Option<String> = scripts
        .map(|ss| ss.into_iter().filter(|s| !s.trim().is_empty()).collect::<Vec<_>>())
        .filter(|ss| !ss.is_empty())
        .map(|ss| {
            ss.into_iter()
                .map(|s| validate_shell_fragment(&s))
                .collect::<Result<Vec<_>, _>>()
        })
        .transpose()?
        .map(|validated| validated.join(" && "));

    let lower = app_name.to_lowercase();
    let raw_tail = custom_command
        .as_deref()
        .map(str::trim)
        .filter(|c| !c.is_empty())
        .map(|c| validate_shell_fragment(c))
        .transpose()?
        .or_else(|| scripts_tail.clone())
        .or_else(|| {
            let trimmed_args = arg_text.trim();
            if trimmed_args.is_empty() { None } else { validate_shell_fragment(trimmed_args).ok() }
        });
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
            .map_err(|e| format!("打开终端失败: {}", e))?;
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(format!("AppleScript 错误: {}", stderr));
        }
    } else {
        // 非 Terminal/iTerm 终端：通过临时脚本传递命令
        if let Some(tail) = raw_tail.as_deref() {
            let tmp_script = std::env::temp_dir().join(format!("aether-launch-{}.sh", std::process::id()));
            let script_content = format!("#!/bin/sh\ncd {}\n{}\nexec $SHELL", shell_quote(&dir_str), tail);
            std::fs::write(&tmp_script, &script_content)
                .map_err(|e| format!("写入临时脚本失败: {}", e))?;
            std::fs::set_permissions(&tmp_script, std::fs::Permissions::from_mode(0o755))
                .map_err(|e| format!("设置脚本权限失败: {}", e))?;
            std::process::Command::new("open")
                .args(["-a", &app_name, tmp_script.to_string_lossy().as_ref()])
                .spawn()
                .map_err(|e| format!("打开终端应用失败: {}", e))?;
        } else {
            std::process::Command::new("open")
                .args(["-a", &app_name, &dir_str])
                .spawn()
                .map_err(|e| format!("打开终端应用失败: {}", e))?;
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .manage(FileClipboardState(Mutex::new(None)))
        .manage(FileDragState(Mutex::new(None)))
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_http::init())
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
            raise_window_at,
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
            copy_files,
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
            make_alias,
            compress_files,
            decompress_file,
            get_file_info,
            get_app_icon,
            get_dir_size,
            get_child_count,
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
}

