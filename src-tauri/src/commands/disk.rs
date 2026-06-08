use crate::error::{AppError, AppErrorKind};
use crate::format_size;
use crate::models::{DiskInfo, VolumeInfo};
use std::path::Path;

pub(crate) fn format_kib(kib: &str) -> String {
    kib.parse::<u64>()
        .map(|value| format_size(value.saturating_mul(1024)))
        .unwrap_or_else(|_| kib.into())
}

pub(crate) fn format_storage_size(bytes: u64) -> String {
    const KB: f64 = 1000.0;
    const MB: f64 = KB * 1000.0;
    const GB: f64 = MB * 1000.0;

    let b = bytes as f64;
    if b >= GB {
        format!("{:.1} G", b / GB)
    } else if b >= MB {
        format!("{:.1} M", b / MB)
    } else if b >= KB {
        format!("{:.1} K", b / KB)
    } else {
        format!("{} B", bytes)
    }
}

pub(crate) fn storage_capacity_value(used: u64, size: u64) -> u8 {
    if size == 0 {
        return 0;
    }

    (((used as f64 / size as f64) * 100.0).round() as u8).min(100)
}

pub(crate) fn parse_plist_integer(text: &str, key: &str) -> Option<u64> {
    let key_tag = format!("<key>{}</key>", key);
    let after_key = text.split_once(&key_tag)?.1;
    let after_open = after_key.split_once("<integer>")?.1;
    let value = after_open.split_once("</integer>")?.0.trim();
    value.parse::<u64>().ok()
}

pub(crate) fn decode_plist_string(value: &str) -> String {
    value
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&apos;", "'")
}

pub(crate) fn parse_plist_string(text: &str, key: &str) -> Option<String> {
    let key_tag = format!("<key>{}</key>", key);
    let after_key = text.split_once(&key_tag)?.1;
    let after_open = after_key.split_once("<string>")?.1;
    let value = after_open.split_once("</string>")?.0.trim();
    Some(decode_plist_string(value))
}

pub(crate) fn build_primary_apfs_disk_info(
    data_plist: &str,
    system_plist: Option<&str>,
) -> Option<DiskInfo> {
    let size = parse_plist_integer(data_plist, "APFSContainerSize")
        .or_else(|| parse_plist_integer(data_plist, "TotalSize"))
        .or_else(|| parse_plist_integer(data_plist, "Size"))?;
    let data_used = parse_plist_integer(data_plist, "CapacityInUse")?;
    let system_used = system_plist
        .and_then(|plist| parse_plist_integer(plist, "CapacityInUse"))
        .unwrap_or(0);
    let used = data_used.saturating_add(system_used).min(size);
    let available = size.saturating_sub(used);
    let capacity_value = storage_capacity_value(used, size);
    let filesystem = parse_plist_string(data_plist, "FilesystemUserVisibleName")
        .or_else(|| parse_plist_string(data_plist, "FilesystemName"))
        .unwrap_or_else(|| "APFS".to_string());

    Some(DiskInfo {
        filesystem,
        size: format_storage_size(size),
        used: format_storage_size(used),
        available: format_storage_size(available),
        capacity: format!("{}%", capacity_value),
        capacity_value,
        mount: "/".to_string(),
    })
}

#[cfg(target_os = "macos")]
pub(crate) fn diskutil_info_plist(path: &str) -> Option<String> {
    let output = std::process::Command::new("diskutil")
        .args(["info", "-plist", path])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    String::from_utf8(output.stdout).ok()
}

#[cfg(target_os = "macos")]
pub(crate) fn get_primary_apfs_disk_info(path: &str) -> Option<DiskInfo> {
    if path != "/" {
        return None;
    }

    let data_plist = diskutil_info_plist("/System/Volumes/Data")?;
    let system_plist = diskutil_info_plist("/");
    build_primary_apfs_disk_info(&data_plist, system_plist.as_deref())
}

pub(crate) fn parse_df_line(line: &str) -> Result<(&str, &str, &str, &str, &str, String), String> {
    let cols: Vec<&str> = line.split_whitespace().collect();
    if cols.len() < 6 {
        return Err(format!("磁盘信息格式异常: {}", line));
    }
    Ok((
        cols[0],
        cols[1],
        cols[2],
        cols[3],
        cols[4],
        cols[5..].join(" "),
    ))
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct DfRow {
    pub(crate) filesystem: String,
    pub(crate) size: String,
    pub(crate) used: String,
    pub(crate) available: String,
    pub(crate) capacity: String,
    pub(crate) mount: String,
}

pub(crate) fn parse_df_row(line: &str) -> Result<DfRow, String> {
    let (filesystem, size, used, available, capacity, mount) = parse_df_line(line)?;
    Ok(DfRow {
        filesystem: filesystem.into(),
        size: size.into(),
        used: used.into(),
        available: available.into(),
        capacity: capacity.into(),
        mount,
    })
}

pub(crate) fn parse_df_rows(text: &str) -> Vec<DfRow> {
    text.lines()
        .skip(1)
        .filter_map(|line| parse_df_row(line).ok())
        .collect()
}

pub(crate) fn root_storage_row(rows: &[DfRow]) -> Option<&DfRow> {
    rows.iter()
        .find(|row| row.mount == "/System/Volumes/Data")
        .or_else(|| rows.iter().find(|row| row.mount == "/"))
}

pub(crate) fn disk_info_from_df_row(row: &DfRow, mount: Option<&str>) -> DiskInfo {
    DiskInfo {
        filesystem: row.filesystem.clone(),
        size: format_kib(&row.size),
        used: format_kib(&row.used),
        available: format_kib(&row.available),
        capacity: row.capacity.clone(),
        capacity_value: parse_capacity(&row.capacity),
        mount: mount.unwrap_or(&row.mount).to_string(),
    }
}

pub(crate) fn volume_info_from_df_row(row: &DfRow, is_root: bool) -> VolumeInfo {
    let path = if is_root {
        "/".to_string()
    } else {
        row.mount.clone()
    };
    let name = if is_root {
        "Macintosh HD".to_string()
    } else {
        Path::new(&row.mount)
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or(&row.mount)
            .to_string()
    };

    VolumeInfo {
        name,
        path: path.clone(),
        filesystem: row.filesystem.clone(),
        size: format_kib(&row.size),
        used: format_kib(&row.used),
        available: format_kib(&row.available),
        capacity: row.capacity.clone(),
        capacity_value: parse_capacity(&row.capacity),
        is_root,
        is_external: path.starts_with("/Volumes/"),
        is_ejectable: path.starts_with("/Volumes/"),
    }
}

pub(crate) fn volume_infos_from_df_rows(rows: &[DfRow]) -> Vec<VolumeInfo> {
    let root_mount = root_storage_row(rows).map(|row| row.mount.as_str());
    let mut seen_mounts = std::collections::HashSet::new();
    let mut volumes = Vec::new();

    for row in rows {
        let is_root = root_mount == Some(row.mount.as_str());
        if !is_root && !row.mount.starts_with("/Volumes") {
            continue;
        }

        let volume = volume_info_from_df_row(row, is_root);
        if !seen_mounts.insert(volume.path.clone()) {
            continue;
        }
        volumes.push(volume);
    }

    volumes.sort_by(|a, b| {
        b.is_root
            .cmp(&a.is_root)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
    volumes
}

#[tauri::command]
pub(crate) fn get_disk_info(path: String) -> Result<DiskInfo, AppError> {
    #[cfg(target_os = "macos")]
    if let Some(info) = get_primary_apfs_disk_info(&path) {
        return Ok(info);
    }

    let mut command = std::process::Command::new("df");
    command.args(["-k", "-P"]);
    if path != "/" {
        command.arg(&path);
    }

    let output = command.output().map_err(|e| {
        AppError::internal_at(format!("获取磁盘信息失败: {}", e), Some(path.clone()))
    })?;
    let text = String::from_utf8(output.stdout).map_err(|e| {
        AppError::internal_at(format!("解析磁盘信息失败: {}", e), Some(path.clone()))
    })?;

    let rows = parse_df_rows(&text);
    let row = if path == "/" {
        root_storage_row(&rows)
    } else {
        rows.first()
    }
    .ok_or_else(|| AppError::internal_at("磁盘信息为空", Some(path.clone())))?;

    Ok(disk_info_from_df_row(
        row,
        if path == "/" { Some("/") } else { None },
    ))
}

pub(crate) fn parse_capacity(value: &str) -> u8 {
    value
        .trim_end_matches('%')
        .parse::<u8>()
        .unwrap_or(0)
        .min(100)
}

#[tauri::command]
pub(crate) fn list_volumes() -> Result<Vec<VolumeInfo>, AppError> {
    let output = std::process::Command::new("df")
        .args(["-k", "-P"])
        .output()
        .map_err(|e| AppError::internal(format!("获取卷信息失败: {}", e)))?;

    let text = String::from_utf8(output.stdout)
        .map_err(|e| AppError::internal(format!("解析卷信息失败: {}", e)))?;
    Ok(volume_infos_from_df_rows(&parse_df_rows(&text)))
}

#[tauri::command]
pub(crate) fn eject_volume(path: String) -> Result<(), AppError> {
    if !path.starts_with("/Volumes/") {
        return Err(AppError::invalid_path(
            "只能弹出 /Volumes 下的外置磁盘",
            Some(path),
        ));
    }

    let status = std::process::Command::new("diskutil")
        .args(["eject", &path])
        .status()
        .map_err(|e| AppError::internal_at(format!("弹出磁盘失败: {}", e), Some(path.clone())))?;

    if status.success() {
        Ok(())
    } else {
        Err(AppError::new(
            AppErrorKind::Busy,
            "弹出磁盘失败：磁盘可能正在被占用",
            Some(path),
        ))
    }
}
