use crate::error::AppError;
use serde::Serialize;
use std::fs;
use std::io::{ErrorKind, Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::Manager;
use tauri_plugin_log::{Target, TargetKind};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AppIdentity {
    pub(crate) app_name: String,
    pub(crate) bundle_identifier: String,
    pub(crate) version: String,
    pub(crate) app_path: String,
}

pub(crate) fn aether_log_dir(home_dir: &Path) -> PathBuf {
    home_dir
        .join("Library")
        .join("Logs")
        .join("Aether Explorer")
}

pub(crate) fn panic_log_path(log_dir: &Path) -> PathBuf {
    log_dir.join("panic.log")
}

#[cfg(test)]
pub(crate) fn settings_store_path(config_dir: &Path) -> PathBuf {
    config_dir.join("settings.json")
}

pub(crate) fn format_panic_report(
    message: &str,
    location: Option<&std::panic::Location<'_>>,
) -> String {
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

pub(crate) fn write_panic_report(log_dir: &Path, report: &str) -> std::io::Result<()> {
    fs::create_dir_all(log_dir)?;
    let mut file = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(panic_log_path(log_dir))?;
    file.write_all(report.as_bytes())
}

pub(crate) fn read_last_panic_log_from_dir(
    log_dir: &Path,
    max_bytes: u64,
) -> std::io::Result<Option<String>> {
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

pub(crate) fn install_panic_hook(log_dir: PathBuf) {
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

pub(crate) fn install_logging(app: &mut tauri::App) -> tauri::Result<()> {
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

    Ok(())
}

#[tauri::command]
pub(crate) fn open_system_settings() -> Result<(), AppError> {
    std::process::Command::new("open")
        .args(["x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles"])
        .spawn()
        .map_err(|e| AppError::internal(format!("Failed to open System Settings: {}", e)))?;
    Ok(())
}

#[tauri::command]
pub(crate) fn get_app_identity(app: tauri::AppHandle) -> Result<AppIdentity, AppError> {
    let package_info = app.package_info();
    let config = app.config();
    let exe_path = std::env::current_exe()
        .map_err(|e| AppError::internal(format!("Failed to locate current application: {}", e)))?;
    let app_path = resolve_app_reveal_path(&exe_path).to_string_lossy().into_owned();
    Ok(AppIdentity {
        app_name: config
            .product_name
            .clone()
            .unwrap_or_else(|| package_info.name.clone()),
        bundle_identifier: config.identifier.clone(),
        version: package_info.version.to_string(),
        app_path,
    })
}

pub(crate) fn resolve_app_reveal_path(exe_path: &Path) -> PathBuf {
    exe_path
        .ancestors()
        // Prefer the outermost app bundle, e.g. Aether.app over nested Helper.app.
        .filter(|path| {
            path.extension()
                .and_then(|extension| extension.to_str())
                .is_some_and(|extension| extension.eq_ignore_ascii_case("app"))
        })
        .last()
        .unwrap_or(exe_path)
        .to_path_buf()
}

#[tauri::command]
pub(crate) fn reveal_app_in_finder() -> Result<(), AppError> {
    let exe_path = std::env::current_exe()
        .map_err(|e| AppError::internal(format!("Failed to locate current application: {}", e)))?;
    let reveal_path = resolve_app_reveal_path(&exe_path);
    std::process::Command::new("open")
        .arg("-R")
        .arg(&reveal_path)
        .spawn()
        .map_err(|e| AppError::internal(format!("Failed to reveal current application in Finder: {}", e)))?;
    Ok(())
}

#[tauri::command]
pub(crate) fn get_logs_dir(app: tauri::AppHandle) -> Result<String, AppError> {
    let home_dir = app
        .path()
        .home_dir()
        .map_err(|e| AppError::internal(format!("无法读取用户目录: {}", e)))?;
    Ok(aether_log_dir(&home_dir).to_string_lossy().into_owned())
}

#[tauri::command]
pub(crate) fn get_config_dir(app: tauri::AppHandle) -> Result<String, AppError> {
    let config_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| AppError::internal(format!("无法读取配置目录: {}", e)))?;
    Ok(config_dir.to_string_lossy().into_owned())
}

#[tauri::command]
pub(crate) fn open_logs_dir(app: tauri::AppHandle) -> Result<(), AppError> {
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
pub(crate) fn open_config_dir(app: tauri::AppHandle) -> Result<(), AppError> {
    let config_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| AppError::internal(format!("无法读取配置目录: {}", e)))?;
    fs::create_dir_all(&config_dir).map_err(|e| {
        AppError::from_io(&e, config_dir.to_str(), format!("无法创建配置目录: {}", e))
    })?;
    std::process::Command::new("open")
        .arg(&config_dir)
        .spawn()
        .map_err(|e| AppError::internal(format!("无法打开配置目录: {}", e)))?;
    Ok(())
}

#[tauri::command]
pub(crate) fn read_last_panic_log(app: tauri::AppHandle) -> Result<Option<String>, AppError> {
    let home_dir = app
        .path()
        .home_dir()
        .map_err(|e| AppError::internal(format!("无法读取用户目录: {}", e)))?;
    let log_dir = aether_log_dir(&home_dir);
    read_last_panic_log_from_dir(&log_dir, 64 * 1024).map_err(|e| {
        AppError::from_io(
            &e,
            panic_log_path(&log_dir).to_str(),
            format!("无法读取崩溃日志: {}", e),
        )
    })
}
