use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::Manager;

mod commands;
mod error;
mod models;
mod native_menu;
mod remote;

pub(crate) use commands::fs::{detect_mime, format_size, safe_canonicalize, unique_destination};
use commands::fs::{DirectoryLoadState, DirectorySizeTaskState};
use commands::transfer::{FileClipboardState, FileDragState, TransferTaskState};
pub(crate) use error::AppError;
use error::AppErrorKind;
use models::FileEntry;

#[cfg(target_os = "macos")]
use tauri::menu::MenuEvent;

pub(crate) fn now_unix_seconds() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or(0)
}

pub(crate) fn next_transfer_task_id(kind: &str) -> String {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or(0);
    format!("{}-{}-{}", kind, std::process::id(), nanos)
}

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! Welcome to Aether Explorer.", name)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .manage(FileClipboardState(Mutex::new(None)))
        .manage(FileDragState(Mutex::new(None)))
        .manage(DirectoryLoadState::default())
        .manage(TransferTaskState::default())
        .manage(DirectorySizeTaskState::default())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_updater::Builder::default().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_liquid_glass::init())
        .setup(|app| {
            commands::diagnostics::install_logging(app)?;

            // 设置 macOS 原生应用菜单与状态栏菜单
            #[cfg(target_os = "macos")]
            {
                let app_handle = app.handle().clone();
                let app_menu = native_menu::build_native_app_menu(&app_handle)?;
                app.set_menu(app_menu)?;
                native_menu::install_tray(&app_handle)?;

                app.on_menu_event(move |_app, event: MenuEvent| match event.id().as_ref() {
                    "new-window" => {
                        let handle = app_handle.clone();
                        tauri::async_runtime::spawn(async move {
                            let _ = commands::window::create_app_window(handle, None, None).await;
                        });
                    }
                    "show-all-windows" => native_menu::reveal_any_window(&app_handle),
                    "open-settings" => {
                        native_menu::emit_native_menu_command(&app_handle, "open-settings")
                    }
                    "refresh-view" | "refresh-view-in-view-menu" => {
                        native_menu::emit_native_menu_command(&app_handle, "refresh")
                    }
                    "view-list" => {
                        native_menu::emit_native_menu_command(&app_handle, "display-mode:list")
                    }
                    "view-grid" => {
                        native_menu::emit_native_menu_command(&app_handle, "display-mode:grid")
                    }
                    "view-column" => {
                        native_menu::emit_native_menu_command(&app_handle, "display-mode:column")
                    }
                    "toggle-hidden-files" => {
                        native_menu::emit_native_menu_command(&app_handle, "toggle-hidden-files")
                    }
                    "toggle-inspector" => {
                        native_menu::emit_native_menu_command(&app_handle, "toggle-inspector")
                    }
                    "show-help" => native_menu::show_help_message(&app_handle),
                    "check-updates" => native_menu::check_updates_message(app_handle.clone()),
                    "force-quit-app" => app_handle.exit(0),
                    _ => {}
                });
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            greet,
            commands::fs::list_directory,
            commands::fs::cancel_directory_loads,
            commands::fs::get_home_dir,
            commands::fs::full_disk_access_status,
            commands::fs::register_full_disk_access,
            commands::diagnostics::open_system_settings,
            commands::diagnostics::get_app_identity,
            commands::diagnostics::reveal_app_in_finder,
            commands::diagnostics::get_logs_dir,
            commands::diagnostics::get_config_dir,
            commands::diagnostics::open_logs_dir,
            commands::diagnostics::open_config_dir,
            commands::diagnostics::read_last_panic_log,
            commands::window::start_window_drag,
            commands::window::raise_window_at,
            commands::window::debug_log,
            commands::window::get_native_liquid_glass_status,
            commands::window::set_native_liquid_glass_enabled,
            commands::window::list_fonts,
            commands::terminal::list_terminal_apps,
            commands::terminal::open_terminal_at,
            commands::window::create_app_window,
            commands::fs::read_text_preview,
            commands::disk::get_disk_info,
            commands::disk::list_volumes,
            commands::disk::eject_volume,
            commands::transfer::copy_file,
            commands::transfer::copy_files,
            commands::transfer::preview_copy_file_conflicts,
            commands::transfer::preview_move_file_conflicts,
            commands::transfer::start_copy_files_task,
            commands::transfer::start_move_files_task,
            commands::transfer::list_transfer_tasks,
            commands::transfer::cancel_transfer_task,
            commands::transfer::clear_finished_transfer_tasks,
            commands::transfer::move_file,
            commands::transfer::set_file_clipboard,
            commands::transfer::get_file_clipboard,
            commands::transfer::clear_file_clipboard,
            commands::transfer::set_file_drag_payload,
            commands::transfer::get_file_drag_payload,
            commands::transfer::clear_file_drag_payload,
            commands::transfer::move_files,
            commands::fs::rename_file,
            commands::fs::delete_to_trash,
            commands::fs::create_file,
            commands::fs::create_text_file,
            commands::fs::read_clipboard_text,
            commands::fs::has_clipboard_text,
            commands::fs::create_folder,
            commands::fs::duplicate_as_alias,
            commands::fs::calculate_file_hash,
            commands::fs::compress_files,
            commands::fs::decompress_file,
            commands::fs::get_file_info,
            commands::fs::get_open_with_options,
            commands::fs::set_default_open_with,
            commands::fs::pick_application,
            commands::fs::get_app_icon,
            commands::fs::estimate_dirs_size_fast,
            commands::fs::get_dir_size,
            commands::fs::start_dir_size_task,
            commands::fs::get_dir_size_task,
            commands::fs::cancel_dir_size_task,
            commands::fs::get_child_count,
            commands::fs::get_directory_signature,
            remote::list_remote_connections,
            remote::save_remote_connection,
            remote::delete_remote_connection,
            remote::test_remote_connection,
            remote::test_remote_connection_input,
            remote::list_remote_directory,
            commands::window::open_devtools,
            commands::fs::quick_look,
            commands::fs::reveal_in_finder,
            commands::fs::open_path,
            commands::fs::open_with
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
                    let _ = commands::window::create_app_window(app_handle, None, None).await;
                });
            }
        }
    });
}

#[cfg(test)]
mod lib_tests;
