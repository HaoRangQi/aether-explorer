use serde::Serialize;
use std::io::ErrorKind;

#[derive(Debug, Serialize, Clone, PartialEq, Eq)]
pub(crate) enum AppErrorKind {
    PermissionDenied,
    NotFound,
    DiskFull,
    Busy,
    InvalidPath,
    Conflict,
    Cancelled,
    TrashUnsupported,
    Internal,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AppError {
    pub(crate) kind: AppErrorKind,
    pub(crate) message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) path: Option<String>,
}

impl AppError {
    pub(crate) fn new(
        kind: AppErrorKind,
        message: impl Into<String>,
        path: Option<String>,
    ) -> Self {
        Self {
            kind,
            message: message.into(),
            path,
        }
    }

    pub(crate) fn internal(message: impl Into<String>) -> Self {
        Self::new(AppErrorKind::Internal, message, None)
    }

    pub(crate) fn internal_at(message: impl Into<String>, path: Option<String>) -> Self {
        Self::new(AppErrorKind::Internal, message, path)
    }

    pub(crate) fn invalid_path(message: impl Into<String>, path: Option<String>) -> Self {
        Self::new(AppErrorKind::InvalidPath, message, path)
    }

    pub(crate) fn conflict(message: impl Into<String>, path: Option<String>) -> Self {
        Self::new(AppErrorKind::Conflict, message, path)
    }

    pub(crate) fn cancelled(message: impl Into<String>, path: Option<String>) -> Self {
        Self::new(AppErrorKind::Cancelled, message, path)
    }

    pub(crate) fn trash_unsupported(message: impl Into<String>, path: Option<String>) -> Self {
        Self::new(AppErrorKind::TrashUnsupported, message, path)
    }

    pub(crate) fn unavailable(message: impl Into<String>) -> Self {
        Self::new(AppErrorKind::Internal, message, None)
    }

    pub(crate) fn from_io(
        err: &std::io::Error,
        path: Option<&str>,
        fallback: impl Into<String>,
    ) -> Self {
        let path_string = path.map(|p| p.to_string());
        match err.kind() {
            ErrorKind::PermissionDenied => Self::new(
                AppErrorKind::PermissionDenied,
                "权限不足，无法访问该路径",
                path_string,
            ),
            ErrorKind::NotFound => Self::new(AppErrorKind::NotFound, "路径不存在", path_string),
            ErrorKind::StorageFull => {
                Self::new(AppErrorKind::DiskFull, "磁盘空间不足", path_string)
            }
            _ => {
                let msg = err.to_string();
                if msg.contains("permission")
                    || msg.contains("denied")
                    || msg.contains("not allowed")
                {
                    Self::new(
                        AppErrorKind::PermissionDenied,
                        "权限不足，无法访问该路径",
                        path_string,
                    )
                } else if msg.contains("busy") {
                    Self::new(AppErrorKind::Busy, "文件正在被占用", path_string)
                } else {
                    Self::new(AppErrorKind::Internal, fallback, path_string)
                }
            }
        }
    }
}
