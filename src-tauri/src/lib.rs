mod commands;
mod error;
mod locale;
mod ports;
mod tray;

use tauri::WindowEvent;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_positioner::init())
        .setup(|app| {
            // Menu bar only: no Dock icon, no app switcher entry.
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            tray::create(app.handle())?;
            Ok(())
        })
        .on_window_event(|window, event| {
            // Behave like a native menu bar popover: dismiss when focus is lost.
            if window.label() == tray::MAIN_WINDOW {
                if let WindowEvent::Focused(false) = event {
                    let _ = window.hide();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::list_listening_ports,
            commands::kill_process,
            commands::system_locale,
            commands::quit_app,
        ])
        .run(tauri::generate_context!())
        .expect("error while running PortBar");
}
