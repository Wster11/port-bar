use serde::{Serialize, Serializer};

/// `Display` messages are English and meant for logs; the UI translates the
/// serialized `code` instead (see `src/i18n.ts`).
#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("failed to run lsof: {0}")]
    LsofSpawn(#[from] std::io::Error),

    #[error("lsof failed: {0}")]
    LsofFailed(String),

    #[error("refusing to kill protected pid {0}")]
    ProtectedPid(i32),

    #[error("process {0} does not exist")]
    NoSuchProcess(i32),

    #[error("permission denied to signal pid {0}")]
    PermissionDenied(i32),

    #[error("failed to signal pid {pid}: {source}")]
    Signal {
        pid: i32,
        #[source]
        source: std::io::Error,
    },

    #[error("background task failed: {0}")]
    Task(String),
}

/// Wire format consumed by `AppErrorPayload` in `src/types.ts`.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ErrorPayload {
    code: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pid: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    detail: Option<String>,
}

impl AppError {
    fn payload(&self) -> ErrorPayload {
        let (code, pid, detail) = match self {
            Self::LsofSpawn(e) => ("lsofSpawn", None, Some(e.to_string())),
            Self::LsofFailed(msg) => ("lsofFailed", None, Some(msg.clone())),
            Self::ProtectedPid(pid) => ("protectedPid", Some(*pid), None),
            Self::NoSuchProcess(pid) => ("noSuchProcess", Some(*pid), None),
            Self::PermissionDenied(pid) => ("permissionDenied", Some(*pid), None),
            Self::Signal { pid, source } => ("signal", Some(*pid), Some(source.to_string())),
            Self::Task(msg) => ("task", None, Some(msg.clone())),
        };
        ErrorPayload { code, pid, detail }
    }
}

impl Serialize for AppError {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        self.payload().serialize(serializer)
    }
}

pub type AppResult<T> = Result<T, AppError>;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn serializes_to_code_payload() {
        let json = serde_json::to_value(AppError::PermissionDenied(42)).unwrap();
        assert_eq!(json, serde_json::json!({ "code": "permissionDenied", "pid": 42 }));

        let json = serde_json::to_value(AppError::LsofFailed("boom".into())).unwrap();
        assert_eq!(json, serde_json::json!({ "code": "lsofFailed", "detail": "boom" }));
    }
}
