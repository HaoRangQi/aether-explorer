use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Clone)]
pub(crate) struct FileEntry {
    pub(crate) name: String,
    pub(crate) path: String,
    pub(crate) is_dir: bool,
    pub(crate) size: String,
    pub(crate) modified: String,
    pub(crate) created: String,
    pub(crate) added: String,
    #[serde(rename = "lastOpened")]
    pub(crate) last_opened: String,
    #[serde(rename = "openWith")]
    pub(crate) open_with: String,
    #[serde(rename = "type")]
    pub(crate) file_type: String,
    #[serde(rename = "iconPath", skip_serializing_if = "Option::is_none")]
    pub(crate) icon_path: Option<String>,
    #[serde(rename = "childCount", skip_serializing_if = "Option::is_none")]
    pub(crate) child_count: Option<u64>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct FileHashResult {
    pub(crate) path: String,
    pub(crate) algorithm: String,
    pub(crate) value: String,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct OpenWithOption {
    pub(crate) name: String,
    pub(crate) path: String,
    pub(crate) is_default: bool,
}

#[derive(Debug, Serialize, Clone)]
pub(crate) struct DirectorySizeEstimate {
    pub(crate) path: String,
    pub(crate) bytes: u64,
    #[serde(rename = "formatted")]
    pub(crate) formatted: String,
    #[serde(rename = "isApproximate")]
    pub(crate) is_approximate: bool,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DirectorySizeTaskSnapshot {
    pub(crate) id: String,
    pub(crate) path: String,
    pub(crate) status: String,
    pub(crate) bytes: u64,
    pub(crate) formatted: String,
    pub(crate) allocated_bytes: u64,
    pub(crate) formatted_allocated: String,
    pub(crate) file_count: u64,
    pub(crate) skipped_count: u64,
    pub(crate) is_approximate: bool,
    pub(crate) started_at: u64,
    pub(crate) finished_at: Option<u64>,
    pub(crate) error: Option<String>,
}

#[derive(Debug, Serialize, Clone)]
pub(crate) struct DiskInfo {
    pub(crate) filesystem: String,
    pub(crate) size: String,
    pub(crate) used: String,
    pub(crate) available: String,
    pub(crate) capacity: String,
    pub(crate) capacity_value: u8,
    pub(crate) mount: String,
}

#[derive(Debug, Serialize, Clone)]
pub(crate) struct VolumeInfo {
    pub(crate) name: String,
    pub(crate) path: String,
    pub(crate) filesystem: String,
    pub(crate) size: String,
    pub(crate) used: String,
    pub(crate) available: String,
    pub(crate) capacity: String,
    pub(crate) capacity_value: u8,
    pub(crate) is_root: bool,
    pub(crate) is_external: bool,
    pub(crate) is_ejectable: bool,
}

#[derive(Debug, Serialize, Clone, PartialEq, Eq)]
pub(crate) struct DirectorySignature {
    pub(crate) fingerprint: String,
    pub(crate) entry_count: u64,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LiquidGlassStatus {
    pub(crate) requested: bool,
    pub(crate) supported: bool,
    pub(crate) applied: bool,
    pub(crate) reason: Option<String>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PermissionPreflightResult {
    pub(crate) path: String,
    pub(crate) ok: bool,
    pub(crate) error: Option<String>,
}
