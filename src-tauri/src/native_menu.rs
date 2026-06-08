use crate::commands::window::create_app_window;

#[cfg(target_os = "macos")]
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};
#[cfg(target_os = "macos")]
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
#[cfg(target_os = "macos")]
use tauri::{Emitter, Manager};
#[cfg(target_os = "macos")]
use tauri_plugin_dialog::DialogExt;
#[cfg(target_os = "macos")]
use tauri_plugin_updater::UpdaterExt;

#[cfg(target_os = "macos")]
pub(crate) fn reveal_any_window(app: &tauri::AppHandle) {
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
pub(crate) fn check_updates_message(app: tauri::AppHandle) {
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
pub(crate) fn show_help_message(app: &tauri::AppHandle) {
    app.dialog()
        .message("Aether Explorer 是本地优先的 macOS 文件工作台。\n\n常用快捷键：\n⌘N 新建窗口\n⌘R 刷新\n⌘I 显示简介\n⌘C / ⌘X / ⌘V 复制、剪切、粘贴\n空格 Quick Look")
        .title("Aether Explorer 帮助")
        .show(|_| {});
}

#[cfg(target_os = "macos")]
pub(crate) fn emit_native_menu_command(app: &tauri::AppHandle, command: &str) {
    let _ = app.emit("aether-native-menu-command", command);
}

#[cfg(target_os = "macos")]
pub(crate) fn build_native_app_menu(app: &tauri::AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
    let app_name = app.package_info().name.clone();
    let new_window = MenuItem::with_id(app, "new-window", "新建窗口", true, Some("CmdOrCtrl+N"))?;
    let refresh_view = MenuItem::with_id(app, "refresh-view", "刷新", true, Some("CmdOrCtrl+R"))?;
    let refresh_view_in_view_menu =
        MenuItem::with_id(app, "refresh-view-in-view-menu", "刷新", true, None::<&str>)?;
    let open_settings =
        MenuItem::with_id(app, "open-settings", "设置…", true, Some("CmdOrCtrl+,"))?;
    let check_updates = MenuItem::with_id(app, "check-updates", "检查更新…", true, None::<&str>)?;
    let show_help =
        MenuItem::with_id(app, "show-help", "Aether Explorer 帮助", true, None::<&str>)?;
    let show_all_windows =
        MenuItem::with_id(app, "show-all-windows", "显示主窗口", true, None::<&str>)?;
    let force_quit = MenuItem::with_id(
        app,
        "force-quit-app",
        "退出 Aether Explorer",
        true,
        Some("CmdOrCtrl+Q"),
    )?;
    let view_list = MenuItem::with_id(app, "view-list", "列表视图", true, Some("CmdOrCtrl+1"))?;
    let view_grid = MenuItem::with_id(app, "view-grid", "网格视图", true, Some("CmdOrCtrl+2"))?;
    let view_column = MenuItem::with_id(app, "view-column", "分栏视图", true, Some("CmdOrCtrl+3"))?;
    let toggle_hidden = MenuItem::with_id(
        app,
        "toggle-hidden-files",
        "显示/隐藏隐藏文件",
        true,
        Some("CmdOrCtrl+Shift+."),
    )?;
    let toggle_inspector = MenuItem::with_id(
        app,
        "toggle-inspector",
        "显示/隐藏简介",
        true,
        Some("CmdOrCtrl+I"),
    )?;

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

    let help_menu = Submenu::with_items(app, "帮助", true, &[&show_help, &check_updates])?;

    Menu::with_items(
        app,
        &[
            &app_menu,
            &file_menu,
            &edit_menu,
            &view_menu,
            &window_menu,
            &help_menu,
        ],
    )
}

#[cfg(target_os = "macos")]
pub(crate) fn install_tray(app: &tauri::AppHandle) -> tauri::Result<()> {
    let show_window = MenuItem::with_id(app, "tray-show-window", "显示主窗口", true, None::<&str>)?;
    let new_window = MenuItem::with_id(
        app,
        "tray-new-window",
        "新建窗口",
        true,
        Some("CmdOrCtrl+N"),
    )?;
    let reload_window = MenuItem::with_id(
        app,
        "tray-reload-window",
        "重新加载窗口",
        true,
        Some("CmdOrCtrl+R"),
    )?;
    let check_updates =
        MenuItem::with_id(app, "tray-check-updates", "检查更新…", true, None::<&str>)?;
    let quit = MenuItem::with_id(
        app,
        "tray-quit",
        "退出 Aether Explorer",
        true,
        Some("CmdOrCtrl+Q"),
    )?;
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
