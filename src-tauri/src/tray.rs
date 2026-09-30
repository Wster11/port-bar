use tauri::{
    image::Image,
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager,
};
use tauri_plugin_positioner::{Position, WindowExt};

use crate::locale;

pub const MAIN_WINDOW: &str = "main";
const PANEL_SHOWN_EVENT: &str = "panel-shown";
const MENU_QUIT: &str = "quit";

pub fn create(app: &AppHandle) -> tauri::Result<()> {
    let quit_label = if locale::is_chinese() { "退出 PortBar" } else { "Quit PortBar" };
    let quit = MenuItem::with_id(app, MENU_QUIT, quit_label, true, Some("CmdOrCtrl+Q"))?;
    let menu = Menu::with_items(app, &[&quit])?;

    TrayIconBuilder::with_id("main-tray")
        .icon(Image::from_bytes(include_bytes!("../icons/tray-icon.png"))?)
        // Template icons are recolored by macOS to match light/dark menu bars.
        .icon_as_template(true)
        .tooltip("PortBar")
        .menu(&menu)
        // Left click toggles the panel; right click opens the menu.
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| {
            if event.id.as_ref() == MENU_QUIT {
                app.exit(0);
            }
        })
        .on_tray_icon_event(|tray, event| {
            let app = tray.app_handle();
            tauri_plugin_positioner::on_tray_event(app, &event);
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                toggle_panel(app);
            }
        })
        .build(app)?;

    Ok(())
}

fn toggle_panel(app: &AppHandle) {
    let Some(window) = app.get_webview_window(MAIN_WINDOW) else {
        return;
    };

    if window.is_visible().unwrap_or(false) {
        let _ = window.hide();
        return;
    }

    let _ = window.move_window(Position::TrayBottomCenter);
    let _ = window.show();
    let _ = window.set_focus();
    let _ = app.emit_to(MAIN_WINDOW, PANEL_SHOWN_EVENT, ());
}
