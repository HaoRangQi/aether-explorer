use crate::error::AppError;
use crate::models::LiquidGlassStatus;
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{Manager, TitleBarStyle, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_liquid_glass::{GlassMaterialVariant, LiquidGlassConfig, LiquidGlassExt};

const MAX_DRAG_DEBUG_LOG_BYTES: u64 = 2 * 1024 * 1024;

#[tauri::command]
pub(crate) fn start_window_drag(window: tauri::WebviewWindow) -> Result<(), AppError> {
    window
        .start_dragging()
        .map_err(|e| AppError::internal(format!("启动窗口拖拽失败: {}", e)))
}

/// 拖拽期间被源窗口频繁调用：把屏幕坐标下的非源窗口置顶。
/// 用于多窗口拖拽时让“底层窗口”自动浮到前面，看清放置提示。
///
/// - `screen_x` / `screen_y`：CSS 逻辑像素（DragEvent.screenX/screenY）
/// - `except_window`：源窗口 label，不会被 raise
///
/// 返回被 raise 的窗口 label（如有），便于前端 debug 与去重。
#[tauri::command]
pub(crate) fn raise_window_at(
    app: tauri::AppHandle,
    screen_x: f64,
    screen_y: f64,
    except_window: String,
) -> Result<Option<String>, AppError> {
    let windows = app.webview_windows();
    for (label, win) in windows.iter() {
        if label == &except_window {
            continue;
        }
        if label == "drag-preview" {
            continue;
        }
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
pub(crate) fn debug_log(message: String) {
    write_drag_debug_log(&message);
}

pub(crate) fn write_drag_debug_log(message: &str) {
    let timestamp_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or_default();
    let line = format!("[{}] {}\n", timestamp_ms, message);
    print!("[DEBUG-dnd] {}", line);

    let Some(home) = std::env::var_os("HOME").map(PathBuf::from) else {
        return;
    };
    let path = drag_debug_log_path_for_home(&home);
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    rotate_drag_debug_log_if_needed(&path);
    if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(path) {
        let _ = file.write_all(line.as_bytes());
    }
}

pub(crate) fn drag_debug_log_path_for_home(home: &Path) -> PathBuf {
    home.join("Library")
        .join("Logs")
        .join("Aether Explorer")
        .join("drag-debug.log")
}

fn rotate_drag_debug_log_if_needed(path: &Path) {
    let Ok(metadata) = fs::metadata(path) else {
        return;
    };
    if metadata.len() <= MAX_DRAG_DEBUG_LOG_BYTES {
        return;
    }
    let rotated = path.with_file_name("drag-debug.log.1");
    let _ = fs::remove_file(&rotated);
    let _ = fs::rename(path, rotated);
}

#[cfg(test)]
mod tests {
    use super::{
        drag_debug_log_path_for_home, rotate_drag_debug_log_if_needed, MAX_DRAG_DEBUG_LOG_BYTES,
    };
    use std::fs;
    use std::path::Path;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn drag_debug_log_path_uses_macos_user_logs_directory() {
        assert_eq!(
            drag_debug_log_path_for_home(Path::new("/Users/tester")),
            Path::new("/Users/tester/Library/Logs/Aether Explorer/drag-debug.log")
        );
    }

    #[test]
    fn drag_debug_log_rotates_when_it_exceeds_size_limit() {
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("aether-drag-log-test-{}", suffix));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("drag-debug.log");
        fs::write(&path, vec![b'x'; MAX_DRAG_DEBUG_LOG_BYTES as usize + 1]).unwrap();

        rotate_drag_debug_log_if_needed(&path);

        assert!(!path.exists());
        assert!(dir.join("drag-debug.log.1").exists());
        let _ = fs::remove_dir_all(dir);
    }
}

#[tauri::command]
pub(crate) fn get_native_liquid_glass_status(app: tauri::AppHandle) -> LiquidGlassStatus {
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
pub(crate) fn set_native_liquid_glass_enabled(
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

pub(crate) fn encode_query_component(value: &str) -> String {
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
pub(crate) async fn create_app_window(
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
pub(crate) fn list_fonts() -> Result<Vec<String>, AppError> {
    let mut fonts = Vec::new();
    let font_dirs = ["/System/Library/Fonts", "/Library/Fonts"];
    // User fonts
    if let Ok(home) = std::env::var("HOME") {
        let user_fonts = format!("{}/Library/Fonts", home);
        if Path::new(&user_fonts).exists() {
            for dir in &[user_fonts.as_str()] {
                if let Ok(entries) = fs::read_dir(dir) {
                    for entry in entries.flatten() {
                        let name = entry.file_name().to_string_lossy().to_string();
                        if name.ends_with(".ttf")
                            || name.ends_with(".otf")
                            || name.ends_with(".ttc")
                        {
                            // Extract font family name from filename
                            let family = name.rsplitn(2, '.').last().unwrap_or(&name).to_string();
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
                    let family = name.rsplitn(2, '.').last().unwrap_or(&name).to_string();
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

#[tauri::command]
pub(crate) fn open_devtools(window: tauri::WebviewWindow) -> Result<(), AppError> {
    window.open_devtools();
    Ok(())
}
