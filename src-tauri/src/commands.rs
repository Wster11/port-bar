use tauri::AppHandle;

use crate::error::{AppError, AppResult};
use crate::locale;
use crate::ports::{self, KillOutcome, ListeningPort};

// Both commands shell out / sleep, so run them on the blocking pool to keep
// the async runtime and the UI thread free.

#[tauri::command]
pub async fn list_listening_ports() -> AppResult<Vec<ListeningPort>> {
    tauri::async_runtime::spawn_blocking(ports::list_listening_ports)
        .await
        .map_err(|e| AppError::Task(e.to_string()))?
}

#[tauri::command]
pub async fn kill_process(pid: i32) -> AppResult<KillOutcome> {
    tauri::async_runtime::spawn_blocking(move || ports::kill_process(pid))
        .await
        .map_err(|e| AppError::Task(e.to_string()))?
}

#[tauri::command]
pub fn system_locale() -> String {
    locale::system_locale()
}

#[tauri::command]
pub fn quit_app(app: AppHandle) {
    app.exit(0);
}
