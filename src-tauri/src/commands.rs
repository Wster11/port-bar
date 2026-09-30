use tauri::AppHandle;

use crate::error::{AppError, AppResult};
use crate::locale;
use crate::ports::{self, KillOutcome, ListeningPort};
use crate::system;

/// Runs shell-outs / sleeps on the blocking pool to keep the async runtime
/// and the UI thread free.
async fn blocking<T, F>(work: F) -> AppResult<T>
where
    T: Send + 'static,
    F: FnOnce() -> AppResult<T> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(work)
        .await
        .map_err(|e| AppError::Task(e.to_string()))?
}

#[tauri::command]
pub async fn list_listening_ports() -> AppResult<Vec<ListeningPort>> {
    blocking(ports::list_listening_ports).await
}

#[tauri::command]
pub async fn kill_process(pid: i32) -> AppResult<KillOutcome> {
    blocking(move || ports::kill_process(pid)).await
}

#[tauri::command]
pub async fn open_in_browser(port: u16) -> AppResult<()> {
    blocking(move || system::open_localhost(port)).await
}

#[tauri::command]
pub async fn reveal_in_finder(path: String) -> AppResult<()> {
    blocking(move || system::reveal_in_finder(&path)).await
}

#[tauri::command]
pub async fn copy_to_clipboard(text: String) -> AppResult<()> {
    blocking(move || system::copy_to_clipboard(&text)).await
}

#[tauri::command]
pub fn system_locale() -> String {
    locale::system_locale()
}

#[tauri::command]
pub fn quit_app(app: AppHandle) {
    app.exit(0);
}
