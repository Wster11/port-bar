use std::io::Write;
use std::path::Path;
use std::process::{Command, Stdio};

use crate::error::{AppError, AppResult};

/// Opens `http://localhost:<port>` in the default browser. The URL is built
/// here rather than accepted from the frontend so only localhost can be opened.
pub fn open_localhost(port: u16) -> AppResult<()> {
    run_open(&format!("http://localhost:{port}"))
}

/// Opens a directory in Finder.
pub fn reveal_in_finder(path: &str) -> AppResult<()> {
    let dir = Path::new(path);
    if !dir.is_absolute() || !dir.is_dir() {
        return Err(AppError::InvalidPath(path.to_owned()));
    }
    run_open(path)
}

pub fn copy_to_clipboard(text: &str) -> AppResult<()> {
    let clipboard_err = |e: std::io::Error| AppError::ClipboardFailed(e.to_string());

    let mut child = Command::new("/usr/bin/pbcopy")
        // GUI apps start without LANG; pbcopy then mangles non-ASCII text.
        .env("LANG", "en_US.UTF-8")
        .stdin(Stdio::piped())
        .spawn()
        .map_err(clipboard_err)?;
    if let Some(mut stdin) = child.stdin.take() {
        stdin.write_all(text.as_bytes()).map_err(clipboard_err)?;
    }
    let status = child.wait().map_err(clipboard_err)?;
    if status.success() {
        Ok(())
    } else {
        Err(AppError::ClipboardFailed(format!("pbcopy exited with {status}")))
    }
}

fn run_open(target: &str) -> AppResult<()> {
    let status = Command::new("/usr/bin/open")
        .arg(target)
        .status()
        .map_err(|e| AppError::OpenFailed(e.to_string()))?;
    if status.success() {
        Ok(())
    } else {
        Err(AppError::OpenFailed(format!("open exited with {status}")))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_relative_or_missing_paths() {
        assert!(matches!(reveal_in_finder("relative/dir"), Err(AppError::InvalidPath(_))));
        assert!(matches!(
            reveal_in_finder("/definitely/not/a/real/dir"),
            Err(AppError::InvalidPath(_))
        ));
    }
}
