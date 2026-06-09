use super::*;
use crate::commands::diagnostics::{
    aether_log_dir, format_panic_report, panic_log_path, read_last_panic_log_from_dir,
    resolve_app_reveal_path, settings_store_path, write_panic_report,
};
use crate::commands::disk::{
    build_primary_apfs_disk_info, eject_volume, format_kib, format_storage_size, parse_capacity,
    parse_df_line, parse_df_rows, parse_plist_integer, parse_plist_string, root_storage_row,
    volume_infos_from_df_rows,
};
use crate::commands::fs::{
    calculate_file_hash, decompress_file, default_full_disk_access_probe_targets, detect_mime,
    dir_size_recursive, dir_size_recursive_with_progress, directory_signature_for_path,
    duplicate_as_alias, estimate_dirs_size_fast, format_size, get_dir_size, get_file_info,
    is_sensitive_for_preview, list_directory_entries, FullDiskAccessProbeKind,
    normalize_open_with_options, normalize_selected_application_path, read_text_preview,
    resolve_open_with_application_target, summarize_full_disk_access_status, trash_delete_error,
    unique_destination, validate_child_name, DirectoryLoadState, DirectorySizeTaskState,
};
use crate::commands::terminal::{
    apple_quote, is_allowed_terminal, open_terminal_at, shell_quote, validate_shell_fragment,
};
use crate::commands::transfer::{
    is_cross_device_rename_error, replace_existing_for_copy, replace_existing_for_move,
};
use crate::commands::window::encode_query_component;
use crate::error::AppError;
use crate::models::{
    DirectorySizeTaskSnapshot, FullDiskAccessProbeResult, FullDiskAccessStatus, OpenWithOption,
};
use std::io::ErrorKind;
use std::os::unix::fs as unix_fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::AtomicBool;
use std::sync::Arc;

// ── diagnostics logging ──
#[test]
fn aether_log_dir_uses_macos_user_logs_folder() {
    let dir = aether_log_dir(Path::new("/Users/jane"));

    assert_eq!(
        dir,
        PathBuf::from("/Users/jane/Library/Logs/Aether Explorer")
    );
}

#[test]
fn panic_log_path_uses_stable_file_name() {
    let path = panic_log_path(Path::new("/tmp/aether-logs"));

    assert_eq!(path, PathBuf::from("/tmp/aether-logs/panic.log"));
}

#[test]
fn settings_store_path_uses_stable_file_name() {
    let path = settings_store_path(Path::new("/tmp/aether-config"));

    assert_eq!(path, PathBuf::from("/tmp/aether-config/settings.json"));
}

#[test]
fn resolve_app_reveal_path_prefers_app_bundle() {
    let path = resolve_app_reveal_path(Path::new(
        "/Applications/Aether Explorer.app/Contents/MacOS/aether-explorer",
    ));

    assert_eq!(path, PathBuf::from("/Applications/Aether Explorer.app"));
}

#[test]
fn resolve_app_reveal_path_prefers_outermost_app_bundle() {
    let path = resolve_app_reveal_path(Path::new(
        "/Applications/Aether Explorer.app/Contents/Frameworks/Helper.app/Contents/MacOS/tool",
    ));

    assert_eq!(path, PathBuf::from("/Applications/Aether Explorer.app"));
}

#[test]
fn resolve_app_reveal_path_falls_back_to_executable() {
    let path = resolve_app_reveal_path(Path::new(
        "/Users/jane/Projects/aether-explorer/src-tauri/target/debug/aether-explorer",
    ));

    assert_eq!(
        path,
        PathBuf::from(
            "/Users/jane/Projects/aether-explorer/src-tauri/target/debug/aether-explorer"
        )
    );
}

#[test]
fn format_panic_report_includes_message_and_location() {
    let location = std::panic::Location::caller();
    let report = format_panic_report("boom", Some(location));

    assert!(report.contains("RUST PANIC"));
    assert!(report.contains("message: boom"));
    assert!(report.contains("location: "));
    assert!(report.ends_with("\n\n"));
}

#[test]
fn write_panic_report_appends_to_panic_log() {
    let temp = std::env::temp_dir().join(format!("aether-panic-log-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&temp);

    write_panic_report(&temp, "first\n").unwrap();
    write_panic_report(&temp, "second\n").unwrap();

    assert_eq!(
        std::fs::read_to_string(panic_log_path(&temp)).unwrap(),
        "first\nsecond\n"
    );

    let _ = std::fs::remove_dir_all(&temp);
}

#[test]
fn read_last_panic_log_returns_none_when_missing() {
    let temp =
        std::env::temp_dir().join(format!("aether-missing-panic-log-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&temp);

    assert_eq!(read_last_panic_log_from_dir(&temp, 1024).unwrap(), None);
}

#[test]
fn read_last_panic_log_limits_large_files() {
    let temp = std::env::temp_dir().join(format!("aether-large-panic-log-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&temp);

    write_panic_report(&temp, "0123456789").unwrap();

    assert_eq!(
        read_last_panic_log_from_dir(&temp, 4).unwrap(),
        Some("6789".to_string())
    );

    let _ = std::fs::remove_dir_all(&temp);
}

// ── format_size ──
#[test]
fn format_size_bytes_under_1k() {
    assert_eq!(format_size(0), "0 B");
    assert_eq!(format_size(1), "1 B");
    assert_eq!(format_size(1023), "1023 B");
}

#[test]
fn format_size_kib_to_gib() {
    assert_eq!(format_size(1024), "1.0 K");
    assert_eq!(format_size(1024 * 1024), "1.0 M");
    assert_eq!(format_size(1024_u64.pow(3)), "1.0 G");
}

#[test]
fn format_size_decimal_precision() {
    assert_eq!(format_size(1536), "1.5 K");
    assert_eq!(format_size(1024 * 1024 * 3 / 2), "1.5 M");
}

// ── format_kib ──
#[test]
fn format_kib_parses_numeric_string() {
    // 输入 KiB 数字，输出人类可读
    assert_eq!(format_kib("1"), "1.0 K");
    assert_eq!(format_kib("1024"), "1.0 M");
    assert_eq!(format_kib("0"), "0 B");
}

#[test]
fn format_kib_returns_input_on_parse_failure() {
    assert_eq!(format_kib("not-a-number"), "not-a-number");
    assert_eq!(format_kib(""), "");
}

#[test]
fn format_storage_size_uses_decimal_units_for_system_storage() {
    assert_eq!(format_storage_size(494_384_795_648), "494.4 G");
    assert_eq!(format_storage_size(12_546_826_240), "12.5 G");
}

#[test]
fn parse_plist_values_from_diskutil_output() {
    let plist = r#"
<plist version="1.0">
<dict>
    <key>APFSContainerSize</key>
    <integer>494384795648</integer>
    <key>FilesystemUserVisibleName</key>
    <string>APFS &amp; Local</string>
</dict>
</plist>
"#;

    assert_eq!(
        parse_plist_integer(plist, "APFSContainerSize"),
        Some(494_384_795_648)
    );
    assert_eq!(
        parse_plist_string(plist, "FilesystemUserVisibleName").as_deref(),
        Some("APFS & Local")
    );
    assert_eq!(parse_plist_integer(plist, "Missing"), None);
}

#[test]
fn build_primary_apfs_disk_info_combines_data_and_system_usage() {
    let data_plist = r#"
<plist version="1.0">
<dict>
    <key>APFSContainerFree</key>
    <integer>101154271232</integer>
    <key>APFSContainerSize</key>
    <integer>494384795648</integer>
    <key>CapacityInUse</key>
    <integer>348680560640</integer>
    <key>FilesystemUserVisibleName</key>
    <string>APFS</string>
</dict>
</plist>
"#;
    let system_plist = r#"
<plist version="1.0">
<dict>
    <key>CapacityInUse</key>
    <integer>12546826240</integer>
</dict>
</plist>
"#;

    let info = build_primary_apfs_disk_info(data_plist, Some(system_plist)).unwrap();

    assert_eq!(info.filesystem, "APFS");
    assert_eq!(info.size, "494.4 G");
    assert_eq!(info.used, "361.2 G");
    assert_eq!(info.available, "133.2 G");
    assert_eq!(info.capacity, "73%");
    assert_eq!(info.capacity_value, 73);
    assert_eq!(info.mount, "/");
}

// ── parse_df_line ──
#[test]
fn parse_df_line_simple_mount() {
    let line = "/dev/disk1s1 488245288 244091128 244154160 50% /";
    let (fs, size, used, avail, cap, mount) = parse_df_line(line).unwrap();
    assert_eq!(fs, "/dev/disk1s1");
    assert_eq!(size, "488245288");
    assert_eq!(used, "244091128");
    assert_eq!(avail, "244154160");
    assert_eq!(cap, "50%");
    assert_eq!(mount, "/");
}

#[test]
fn parse_df_line_mount_with_spaces() {
    let line = "/dev/disk2s1 1000 500 500 50% /Volumes/My Drive";
    let (_, _, _, _, _, mount) = parse_df_line(line).unwrap();
    assert_eq!(mount, "/Volumes/My Drive");
}

#[test]
fn root_storage_row_prefers_macos_data_volume() {
    let text = "\
Filesystem   1024-blocks      Used Available Capacity  Mounted on
/dev/disk3s3s1   482797652  12252760  98786224    12%    /
/dev/disk3s1     482797652 340505604  98786224    78%    /System/Volumes/Data
";
    let rows = parse_df_rows(text);
    let row = root_storage_row(&rows).unwrap();

    assert_eq!(row.mount, "/System/Volumes/Data");
    assert_eq!(row.used, "340505604");
    assert_eq!(row.capacity, "78%");
}

#[test]
fn volume_infos_use_macos_data_volume_for_root_storage() {
    let text = "\
Filesystem   1024-blocks      Used Available Capacity  Mounted on
/dev/disk3s3s1   482797652  12252760  98786224    12%    /
/dev/disk3s1     482797652 340505604  98786224    78%    /System/Volumes/Data
/dev/disk5s1         38780     25924     12224    68%    /Volumes/Codex++
";
    let volumes = volume_infos_from_df_rows(&parse_df_rows(text));
    let root = volumes.iter().find(|volume| volume.is_root).unwrap();

    assert_eq!(root.name, "Macintosh HD");
    assert_eq!(root.path, "/");
    assert_eq!(root.used, "324.7 G");
    assert_eq!(root.capacity, "78%");
    assert_eq!(root.capacity_value, 78);
    assert_eq!(volumes.iter().filter(|volume| volume.is_root).count(), 1);
    assert!(volumes
        .iter()
        .any(|volume| volume.path == "/Volumes/Codex++"));
}

#[test]
fn parse_df_line_rejects_short_input() {
    assert!(parse_df_line("only three cols").is_err());
    assert!(parse_df_line("").is_err());
}

// ── parse_capacity ──
#[test]
fn parse_capacity_strips_percent() {
    assert_eq!(parse_capacity("85%"), 85);
    assert_eq!(parse_capacity("0%"), 0);
    assert_eq!(parse_capacity("100%"), 100);
}

#[test]
fn parse_capacity_caps_at_100() {
    // value 超出 100 截断到 100（u8::min 操作）
    assert_eq!(parse_capacity("200%"), 100);
}

#[test]
fn parse_capacity_invalid_returns_0() {
    assert_eq!(parse_capacity(""), 0);
    assert_eq!(parse_capacity("abc"), 0);
    assert_eq!(parse_capacity("xx%"), 0);
}

// ── detect_mime ──
#[test]
fn detect_mime_images() {
    assert_eq!(detect_mime("photo.png", false), "image");
    assert_eq!(detect_mime("photo.JPG", false), "image");
    assert_eq!(detect_mime("anim.gif", false), "image");
    assert_eq!(detect_mime("logo.SVG", false), "image");
}

#[test]
fn detect_mime_video_audio() {
    assert_eq!(detect_mime("clip.mp4", false), "video");
    assert_eq!(detect_mime("song.mp3", false), "audio");
    assert_eq!(detect_mime("voice.m4a", false), "audio");
}

#[test]
fn detect_mime_code_text_archive() {
    assert_eq!(detect_mime("main.rs", false), "code");
    assert_eq!(detect_mime("App.tsx", false), "code");
    assert_eq!(detect_mime("notes.md", false), "text");
    assert_eq!(detect_mime("data.json", false), "text");
    assert_eq!(detect_mime("backup.zip", false), "archive");
}

#[test]
fn detect_mime_dir_vs_app_bundle() {
    assert_eq!(detect_mime("Documents", true), "folder");
    assert_eq!(detect_mime("Safari.app", true), "application");
    assert_eq!(detect_mime("foo.APP", true), "application");
}

#[test]
fn detect_mime_unknown_extension() {
    assert_eq!(detect_mime("data.xyzunknown", false), "file");
    assert_eq!(detect_mime("Makefile", false), "file");
    assert_eq!(detect_mime("no_extension", false), "file");
}

// ── unique_destination ──
#[test]
fn unique_destination_nonexistent_returns_original() {
    let temp = std::env::temp_dir().join(format!("aether-uniq-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&temp);
    std::fs::create_dir_all(&temp).unwrap();

    let target = temp.join("brand-new.txt");
    let result = unique_destination(&target);
    assert_eq!(result, target);

    let _ = std::fs::remove_dir_all(&temp);
}

#[test]
fn unique_destination_appends_copy_suffix() {
    let temp = std::env::temp_dir().join(format!("aether-uniq2-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&temp);
    std::fs::create_dir_all(&temp).unwrap();

    let a = temp.join("a.txt");
    std::fs::write(&a, b"").unwrap();
    let next = unique_destination(&a);
    assert_eq!(next.file_name().unwrap().to_str().unwrap(), "a copy.txt");

    std::fs::write(temp.join("a copy.txt"), b"").unwrap();
    let next2 = unique_destination(&a);
    assert_eq!(next2.file_name().unwrap().to_str().unwrap(), "a copy 2.txt");

    let _ = std::fs::remove_dir_all(&temp);
}

#[test]
fn unique_destination_handles_no_extension() {
    let temp = std::env::temp_dir().join(format!("aether-uniq3-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&temp);
    std::fs::create_dir_all(&temp).unwrap();

    let f = temp.join("Makefile");
    std::fs::write(&f, b"").unwrap();
    let next = unique_destination(&f);
    assert_eq!(next.file_name().unwrap().to_str().unwrap(), "Makefile copy");

    let _ = std::fs::remove_dir_all(&temp);
}

#[test]
fn duplicate_as_alias_copies_file_with_alias_suffix() {
    let temp = std::env::temp_dir().join(format!("aether-alias-file-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&temp);
    std::fs::create_dir_all(&temp).unwrap();

    let src = temp.join("note.txt");
    std::fs::write(&src, "hello").unwrap();

    let duplicated = duplicate_as_alias(src.to_string_lossy().into()).unwrap();
    let duplicated_path = Path::new(&duplicated);

    assert_eq!(
        duplicated_path.file_name().unwrap().to_str().unwrap(),
        "note-副本.txt"
    );
    assert_eq!(std::fs::read_to_string(duplicated_path).unwrap(), "hello");
    assert!(!std::fs::symlink_metadata(duplicated_path)
        .unwrap()
        .file_type()
        .is_symlink());

    let _ = std::fs::remove_dir_all(&temp);
}

#[test]
fn duplicate_as_alias_copies_folder_as_real_folder() {
    let temp = std::env::temp_dir().join(format!("aether-alias-dir-{}", std::process::id()));
    let src = temp.join("Project");
    let nested = src.join("nested");
    let _ = std::fs::remove_dir_all(&temp);
    std::fs::create_dir_all(&nested).unwrap();
    std::fs::write(nested.join("readme.md"), "folder copy").unwrap();

    let duplicated = duplicate_as_alias(src.to_string_lossy().into()).unwrap();
    let duplicated_path = Path::new(&duplicated);
    let metadata = std::fs::symlink_metadata(duplicated_path).unwrap();

    assert_eq!(
        duplicated_path.file_name().unwrap().to_str().unwrap(),
        "Project-副本"
    );
    assert!(metadata.is_dir());
    assert!(!metadata.file_type().is_symlink());
    assert_eq!(
        std::fs::read_to_string(duplicated_path.join("nested/readme.md")).unwrap(),
        "folder copy"
    );

    let _ = std::fs::remove_dir_all(&temp);
}

#[test]
fn calculate_file_hash_returns_sha256_for_file() {
    let temp = std::env::temp_dir().join(format!("aether-hash-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&temp);
    std::fs::create_dir_all(&temp).unwrap();

    let src = temp.join("note.txt");
    std::fs::write(&src, "hello").unwrap();

    let result = calculate_file_hash(src.to_string_lossy().into()).unwrap();

    assert_eq!(result.algorithm, "SHA-256");
    assert_eq!(result.path, src.to_string_lossy());
    assert_eq!(
        result.value,
        "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824"
    );

    let _ = std::fs::remove_dir_all(&temp);
}

#[test]
fn normalize_open_with_options_keeps_default_and_deduplicates_by_name() {
    let normalized = normalize_open_with_options(vec![
        OpenWithOption {
            name: "Preview".into(),
            path: "/Applications/Preview.app".into(),
            is_default: false,
        },
        OpenWithOption {
            name: "Preview".into(),
            path: "/System/Applications/Preview.app".into(),
            is_default: true,
        },
        OpenWithOption {
            name: "Helper".into(),
            path: "/Applications/App.app/Contents/Helpers/Helper.app".into(),
            is_default: false,
        },
    ]);

    assert_eq!(normalized.len(), 1);
    assert_eq!(normalized[0].name, "Preview");
    assert_eq!(normalized[0].path, "/System/Applications/Preview.app");
    assert!(normalized[0].is_default);
}

#[test]
fn normalize_selected_application_path_trims_trailing_slash() {
    assert_eq!(
        normalize_selected_application_path("/System/Applications/Preview.app/"),
        Some("/System/Applications/Preview.app".into())
    );
    assert_eq!(
        normalize_selected_application_path("  /Applications/TextEdit.app  \n"),
        Some("/Applications/TextEdit.app".into())
    );
}

#[test]
fn normalize_selected_application_path_rejects_non_app_paths() {
    assert_eq!(normalize_selected_application_path(""), None);
    assert_eq!(normalize_selected_application_path("/Applications"), None);
    assert_eq!(
        normalize_selected_application_path("/Applications/Preview"),
        None
    );
}

#[cfg(target_os = "macos")]
#[test]
fn get_file_info_includes_default_open_with_name() {
    let temp = std::env::temp_dir().join(format!("aether-open-with-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&temp);
    std::fs::create_dir_all(&temp).unwrap();

    let src = temp.join("note.txt");
    std::fs::write(&src, "hello").unwrap();

    let mut info = get_file_info(src.to_string_lossy().into()).unwrap();
    for _ in 0..4 {
        if !info.open_with.is_empty() {
            break;
        }
        std::thread::sleep(std::time::Duration::from_millis(100));
        info = get_file_info(src.to_string_lossy().into()).unwrap();
    }

    assert_eq!(info.name, "note.txt");
    assert!(!info.open_with.is_empty());

    let _ = std::fs::remove_dir_all(&temp);
}

// ── shell_quote ──
#[test]
fn shell_quote_wraps_simple() {
    assert_eq!(shell_quote("hello"), "'hello'");
    assert_eq!(shell_quote(""), "''");
}

#[test]
fn shell_quote_escapes_single_quote() {
    // POSIX 标准转义：'it' + \\' + 's' → 'it'\''s'
    assert_eq!(shell_quote("it's"), "'it'\\''s'");
}

#[test]
fn shell_quote_keeps_shell_meta_safe() {
    // 这些字符在引号内都不会被 shell 解释
    assert_eq!(shell_quote("$(rm -rf /)"), "'$(rm -rf /)'");
    assert_eq!(shell_quote("`whoami`"), "'`whoami`'");
    assert_eq!(shell_quote("foo;bar"), "'foo;bar'");
    assert_eq!(shell_quote("foo|bar"), "'foo|bar'");
    assert_eq!(shell_quote("foo && bar"), "'foo && bar'");
}

#[test]
fn shell_quote_paths_with_spaces() {
    assert_eq!(
        shell_quote("/Users/jane/My Documents"),
        "'/Users/jane/My Documents'"
    );
}

// ── encode_query_component ──
#[test]
fn encode_query_component_keeps_safe_chars() {
    assert_eq!(encode_query_component("abc123"), "abc123");
    assert_eq!(encode_query_component("a-b_c.d~e"), "a-b_c.d~e");
}

#[test]
fn encode_query_component_percent_encodes_unsafe() {
    assert_eq!(encode_query_component(" "), "%20");
    assert_eq!(encode_query_component("a/b"), "a%2Fb");
    assert_eq!(encode_query_component("a&b"), "a%26b");
    assert_eq!(encode_query_component("a=b"), "a%3Db");
}

#[test]
fn encode_query_component_handles_multibyte() {
    // 中文按 UTF-8 三字节编码
    assert_eq!(encode_query_component("中"), "%E4%B8%AD");
}

// ── validate_shell_fragment ──
#[test]
fn validate_shell_fragment_accepts_safe_input() {
    assert_eq!(
        validate_shell_fragment("npm run dev").unwrap(),
        "npm run dev"
    );
    assert_eq!(validate_shell_fragment("  ls -la  ").unwrap(), "ls -la");
}

#[test]
fn validate_shell_fragment_allows_quoted_file_placeholders() {
    assert_eq!(
        validate_shell_fragment("code '/Users/jane/My Files/it'\\''s $(secret);.txt'").unwrap(),
        "code '/Users/jane/My Files/it'\\''s $(secret);.txt'",
    );
    assert_eq!(
        validate_shell_fragment("open '/tmp/name|with>meta<chars'").unwrap(),
        "open '/tmp/name|with>meta<chars'",
    );
}

#[test]
fn validate_shell_fragment_rejects_injection() {
    assert!(validate_shell_fragment("rm -rf /; echo ok").is_err());
    assert!(validate_shell_fragment("cat x | grep y").is_err());
    assert!(validate_shell_fragment("a && b").is_err());
    assert!(validate_shell_fragment("a || b").is_err());
    assert!(validate_shell_fragment("$(whoami)").is_err());
    assert!(validate_shell_fragment("`whoami`").is_err());
    assert!(validate_shell_fragment("x > /etc/passwd").is_err());
    assert!(validate_shell_fragment("x < secrets").is_err());
    assert!(validate_shell_fragment("a\nb").is_err());
}

#[test]
fn validate_shell_fragment_rejects_unclosed_quote() {
    assert!(validate_shell_fragment("code '/tmp/unfinished").is_err());
}

#[test]
fn validate_shell_fragment_rejects_empty() {
    assert!(validate_shell_fragment("").is_err());
    assert!(validate_shell_fragment("   ").is_err());
}

// ── is_allowed_terminal ──
#[test]
fn is_allowed_terminal_accepts_known() {
    assert!(is_allowed_terminal("Terminal"));
    assert!(is_allowed_terminal("iTerm"));
    assert!(is_allowed_terminal("ITERM2")); // 大小写不敏感
    assert!(is_allowed_terminal("warp"));
    assert!(is_allowed_terminal("WezTerm"));
}

#[test]
fn is_allowed_terminal_rejects_injection() {
    // 攻击者控制 app_name 不应能注入 AppleScript
    assert!(!is_allowed_terminal("Foo\"; do shell script \"evil"));
    assert!(!is_allowed_terminal(""));
    assert!(!is_allowed_terminal("SomeRandomApp"));
    assert!(!is_allowed_terminal("Terminal.app")); // 必须是不带后缀
}

#[test]
fn open_terminal_at_rejects_disallowed_terminal_with_structured_error() {
    let err = open_terminal_at(
        "/tmp".to_string(),
        Some("Bad\"Terminal".to_string()),
        None,
        None,
        None,
    )
    .unwrap_err();

    assert_eq!(err.kind, AppErrorKind::InvalidPath);
    assert!(err.message.contains("不允许的终端应用"));
}

// ── apple_quote ──
#[test]
fn apple_quote_wraps_simple() {
    assert_eq!(apple_quote("Terminal"), "\"Terminal\"");
}

#[test]
fn apple_quote_escapes_quotes_and_backslash() {
    assert_eq!(apple_quote(r#"it"s"#), "\"it\\\"s\"");
    assert_eq!(apple_quote(r"a\b"), "\"a\\\\b\"");
}

// ── is_sensitive_for_preview ──
#[test]
fn is_sensitive_for_preview_blocks_env_and_keys() {
    assert!(is_sensitive_for_preview(Path::new("/Users/x/.env")));
    assert!(is_sensitive_for_preview(Path::new("/Users/x/.ENV")));
    assert!(is_sensitive_for_preview(Path::new("/Users/x/.envrc")));
    assert!(is_sensitive_for_preview(Path::new("/Users/x/.ssh/id_rsa")));
    assert!(is_sensitive_for_preview(Path::new(
        "/Users/x/.ssh/id_ed25519"
    )));
    assert!(is_sensitive_for_preview(Path::new(
        "/Users/x/.aws/credentials"
    )));
    assert!(is_sensitive_for_preview(Path::new("/Users/x/.netrc")));
}

#[test]
fn is_sensitive_for_preview_allows_normal_files() {
    assert!(!is_sensitive_for_preview(Path::new("/Users/x/notes.md")));
    assert!(!is_sensitive_for_preview(Path::new("/Users/x/.gitignore")));
    assert!(!is_sensitive_for_preview(Path::new("/Users/x/script.sh")));
}

#[test]
fn read_text_preview_rejects_sensitive_files_with_permission_error() {
    let err = read_text_preview("/tmp/.env".to_string()).unwrap_err();

    assert_eq!(err.kind, AppErrorKind::PermissionDenied);
    assert_eq!(err.path.as_deref(), Some("/tmp/.env"));
}

#[test]
fn read_text_preview_rejects_invalid_utf8_with_invalid_path_error() {
    let temp = std::env::temp_dir().join(format!("aether-preview-invalid-{}", std::process::id()));
    let _ = std::fs::remove_file(&temp);
    std::fs::write(&temp, [0xff, 0xfe, 0xfd]).unwrap();

    let err = read_text_preview(temp.to_string_lossy().to_string()).unwrap_err();
    assert_eq!(err.kind, AppErrorKind::InvalidPath);
    assert_eq!(err.path.as_deref(), Some(temp.to_string_lossy().as_ref()));

    let _ = std::fs::remove_file(&temp);
}

#[test]
fn list_directory_entries_sorts_dirs_first_and_hides_dotfiles() {
    let temp = std::env::temp_dir().join(format!("aether-list-dir-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&temp);
    std::fs::create_dir_all(temp.join("z-folder")).unwrap();
    std::fs::create_dir_all(temp.join("a-folder")).unwrap();
    std::fs::write(temp.join("b-file.txt"), b"b").unwrap();
    std::fs::write(temp.join("a-file.txt"), b"a").unwrap();
    std::fs::write(temp.join(".hidden"), b"x").unwrap();

    let entries = list_directory_entries(temp.to_string_lossy().as_ref(), false, None).unwrap();
    let names: Vec<String> = entries.into_iter().map(|entry| entry.name).collect();
    assert_eq!(
        names,
        vec!["a-folder", "z-folder", "a-file.txt", "b-file.txt"]
    );

    let _ = std::fs::remove_dir_all(&temp);
}

#[test]
fn list_directory_entries_can_include_hidden_files() {
    let temp = std::env::temp_dir().join(format!("aether-list-hidden-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&temp);
    std::fs::create_dir_all(&temp).unwrap();
    std::fs::write(temp.join(".hidden"), b"x").unwrap();

    let entries = list_directory_entries(temp.to_string_lossy().as_ref(), true, None).unwrap();
    assert!(entries.iter().any(|entry| entry.name == ".hidden"));

    let _ = std::fs::remove_dir_all(&temp);
}

#[test]
fn list_directory_entries_stops_when_load_token_is_cancelled() {
    let temp = std::env::temp_dir().join(format!("aether-list-cancel-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&temp);
    std::fs::create_dir_all(&temp).unwrap();
    for index in 0..8 {
        std::fs::write(temp.join(format!("file-{}.txt", index)), b"x").unwrap();
    }

    let state = DirectoryLoadState::default();
    let token = state
        .begin(Some("main".to_string()), Some(1))
        .unwrap()
        .unwrap();
    state.mark_latest("main".to_string(), 2).unwrap();

    let err =
        list_directory_entries(temp.to_string_lossy().as_ref(), true, Some(token)).unwrap_err();
    assert_eq!(err.kind, AppErrorKind::Cancelled);

    let _ = std::fs::remove_dir_all(&temp);
}

#[test]
fn directory_signature_changes_when_visible_entries_change() {
    let temp = std::env::temp_dir().join(format!("aether-dir-signature-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&temp);
    std::fs::create_dir_all(&temp).unwrap();
    std::fs::write(temp.join("a.txt"), b"a").unwrap();

    let before = directory_signature_for_path(temp.to_string_lossy().as_ref(), false).unwrap();
    std::fs::write(temp.join("b.txt"), b"b").unwrap();
    let after = directory_signature_for_path(temp.to_string_lossy().as_ref(), false).unwrap();

    assert_ne!(before.fingerprint, after.fingerprint);
    assert_eq!(before.entry_count, 1);
    assert_eq!(after.entry_count, 2);

    let _ = std::fs::remove_dir_all(&temp);
}

#[test]
fn directory_signature_respects_hidden_file_filter() {
    let temp = std::env::temp_dir().join(format!(
        "aether-dir-signature-hidden-{}",
        std::process::id()
    ));
    let _ = std::fs::remove_dir_all(&temp);
    std::fs::create_dir_all(&temp).unwrap();

    let hidden_before =
        directory_signature_for_path(temp.to_string_lossy().as_ref(), false).unwrap();
    std::fs::write(temp.join(".hidden"), b"x").unwrap();
    let hidden_after =
        directory_signature_for_path(temp.to_string_lossy().as_ref(), false).unwrap();
    let visible_hidden =
        directory_signature_for_path(temp.to_string_lossy().as_ref(), true).unwrap();

    assert_eq!(hidden_before.fingerprint, hidden_after.fingerprint);
    assert_eq!(hidden_after.entry_count, 0);
    assert_eq!(visible_hidden.entry_count, 1);
    assert_ne!(hidden_after.fingerprint, visible_hidden.fingerprint);

    let _ = std::fs::remove_dir_all(&temp);
}

// ── Full Disk Access probes ──
#[test]
fn full_disk_access_probe_targets_are_tcc_only() {
    let targets = default_full_disk_access_probe_targets("/Users/jane");

    assert_eq!(targets.len(), 3);
    assert_eq!(
        targets[0].path,
        PathBuf::from("/Library/Application Support/com.apple.TCC/TCC.db")
    );
    assert_eq!(targets[0].kind, FullDiskAccessProbeKind::File);
    assert_eq!(
        targets[1].path,
        PathBuf::from("/Users/jane/Library/Application Support/com.apple.TCC")
    );
    assert_eq!(targets[1].kind, FullDiskAccessProbeKind::Directory);
    assert_eq!(
        targets[2].path,
        PathBuf::from("/Users/jane/Library/Application Support/com.apple.TCC/TCC.db")
    );
    assert_eq!(targets[2].kind, FullDiskAccessProbeKind::File);
}

#[test]
fn full_disk_access_status_is_granted_when_any_tcc_probe_is_readable() {
    let probes = vec![
        FullDiskAccessProbeResult {
            path: "/Library/Application Support/com.apple.TCC/TCC.db".into(),
            target_type: "file".into(),
            exists: true,
            readable: false,
            error: Some("permission denied".into()),
        },
        FullDiskAccessProbeResult {
            path: "/Users/jane/Library/Application Support/com.apple.TCC".into(),
            target_type: "directory".into(),
            exists: true,
            readable: true,
            error: None,
        },
    ];

    assert_eq!(
        summarize_full_disk_access_status(&probes),
        FullDiskAccessStatus::Granted
    );
}

#[test]
fn full_disk_access_status_distinguishes_denied_from_unknown() {
    let denied = vec![FullDiskAccessProbeResult {
        path: "/Users/jane/Library/Application Support/com.apple.TCC".into(),
        target_type: "directory".into(),
        exists: true,
        readable: false,
        error: Some("permission denied".into()),
    }];
    let unknown = vec![FullDiskAccessProbeResult {
        path: "/Users/jane/Library/Application Support/com.apple.TCC".into(),
        target_type: "directory".into(),
        exists: false,
        readable: false,
        error: None,
    }];

    assert_eq!(
        summarize_full_disk_access_status(&denied),
        FullDiskAccessStatus::Denied
    );
    assert_eq!(
        summarize_full_disk_access_status(&unknown),
        FullDiskAccessStatus::Unknown
    );
}

// ── AppError ──
#[test]
fn app_error_from_io_classifies_common_kinds() {
    let permission = std::io::Error::new(ErrorKind::PermissionDenied, "no");
    let not_found = std::io::Error::new(ErrorKind::NotFound, "missing");
    let busy = std::io::Error::other("resource busy");

    let permission_error = AppError::from_io(&permission, Some("/secret"), "fallback");
    let not_found_error = AppError::from_io(&not_found, Some("/missing"), "fallback");
    let busy_error = AppError::from_io(&busy, Some("/tmp/file"), "fallback");

    assert_eq!(permission_error.kind, AppErrorKind::PermissionDenied);
    assert_eq!(permission_error.path.as_deref(), Some("/secret"));
    assert_eq!(not_found_error.kind, AppErrorKind::NotFound);
    assert_eq!(busy_error.kind, AppErrorKind::Busy);
}

#[test]
fn app_error_unavailable_is_structured_internal_error() {
    let err = AppError::unavailable("文件剪贴板不可用");

    assert_eq!(err.kind, AppErrorKind::Internal);
    assert_eq!(err.message, "文件剪贴板不可用");
    assert_eq!(err.path, None);
}

#[test]
fn app_error_internal_at_preserves_path_context() {
    let err = AppError::internal_at("打开失败", Some("/tmp/demo.txt".to_string()));

    assert_eq!(err.kind, AppErrorKind::Internal);
    assert_eq!(err.message, "打开失败");
    assert_eq!(err.path.as_deref(), Some("/tmp/demo.txt"));
}

#[test]
fn trash_delete_error_external_volume_is_explicitly_unsupported() {
    let err = trash_delete_error("/Volumes/USB/a.txt", "unsupported");

    assert_eq!(err.kind, AppErrorKind::TrashUnsupported);
    assert_eq!(err.path.as_deref(), Some("/Volumes/USB/a.txt"));
    assert!(err.message.contains("操作已取消"));
    assert!(err.message.contains("不会改用永久删除"));
}

#[test]
fn trash_delete_error_regular_path_stays_internal_failure() {
    let err = trash_delete_error("/Users/jane/a.txt", "boom");

    assert_eq!(err.kind, AppErrorKind::Internal);
    assert_eq!(err.path.as_deref(), Some("/Users/jane/a.txt"));
    assert!(err.message.contains("移至废纸篓失败"));
}

#[test]
fn trash_delete_error_permission_failure_is_structured_permission_denied() {
    let err = trash_delete_error("/Users/jane/Documents/a.txt", "Operation not permitted");

    assert_eq!(err.kind, AppErrorKind::PermissionDenied);
    assert_eq!(err.path.as_deref(), Some("/Users/jane/Documents/a.txt"));
    assert!(err.message.contains("移至废纸篓失败"));
}

#[test]
fn get_dir_size_rejects_non_directory_with_invalid_path_error() {
    let temp = std::env::temp_dir().join(format!("aether-dir-size-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&temp);
    std::fs::create_dir_all(&temp).unwrap();
    let file = temp.join("file.txt");
    std::fs::write(&file, b"x").unwrap();

    let err = get_dir_size(file.to_string_lossy().to_string()).unwrap_err();
    assert_eq!(err.kind, AppErrorKind::InvalidPath);
    assert_eq!(err.path.as_deref(), Some(file.to_string_lossy().as_ref()));

    let _ = std::fs::remove_dir_all(&temp);
}

#[cfg(unix)]
#[test]
fn get_dir_size_rejects_unreadable_root_with_permission_error() {
    use std::os::unix::fs::PermissionsExt;

    let temp =
        std::env::temp_dir().join(format!("aether-dir-size-unreadable-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&temp);
    std::fs::create_dir_all(&temp).unwrap();
    let original_permissions = std::fs::metadata(&temp).unwrap().permissions();
    let mut locked_permissions = original_permissions.clone();
    locked_permissions.set_mode(0o000);
    std::fs::set_permissions(&temp, locked_permissions).unwrap();

    let err = get_dir_size(temp.to_string_lossy().to_string()).unwrap_err();

    std::fs::set_permissions(&temp, original_permissions).unwrap();
    let _ = std::fs::remove_dir_all(&temp);
    assert_eq!(err.kind, AppErrorKind::PermissionDenied);
    assert_eq!(err.path.as_deref(), Some(temp.to_string_lossy().as_ref()));
}

#[test]
fn get_dir_size_includes_nested_files_and_disk_size_fields() {
    let temp = std::env::temp_dir().join(format!("aether-dir-size-nested-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&temp);
    let nested = temp.join("nested");
    std::fs::create_dir_all(&nested).unwrap();
    std::fs::write(temp.join("a.txt"), b"abc").unwrap();
    std::fs::write(nested.join("b.txt"), b"12345").unwrap();

    let result = get_dir_size(temp.to_string_lossy().to_string()).unwrap();
    assert_eq!(
        result["path"].as_str(),
        Some(temp.to_string_lossy().as_ref())
    );
    assert_eq!(result["bytes"].as_u64(), Some(8));
    assert_eq!(result["formatted"].as_str(), Some("8 B"));
    assert_eq!(result["file_count"].as_u64(), Some(2));
    assert_eq!(result["skipped_count"].as_u64(), Some(0));
    assert!(result["allocated_bytes"].as_u64().is_some());
    assert!(result["formatted_allocated"].as_str().is_some());

    let _ = std::fs::remove_dir_all(&temp);
}

#[test]
fn estimate_dirs_size_fast_returns_estimate_for_directory() {
    let temp = std::env::temp_dir().join(format!("aether-estimate-size-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&temp);
    std::fs::create_dir_all(&temp).unwrap();
    std::fs::write(temp.join("a.txt"), vec![0u8; 1024]).unwrap();
    std::fs::write(temp.join("b.txt"), vec![0u8; 2048]).unwrap();

    let result = estimate_dirs_size_fast(vec![temp.to_string_lossy().to_string()]).unwrap();
    assert_eq!(result.len(), 1);
    let item = &result[0];
    assert_eq!(item.path, temp.to_string_lossy());
    assert!(!item.formatted.is_empty());
    assert!(item.bytes >= 3072);

    let _ = std::fs::remove_dir_all(&temp);
}

#[test]
fn dir_size_recursive_skips_symlinks_without_following_them() {
    let temp = std::env::temp_dir().join(format!("aether-dir-size-symlink-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&temp);
    std::fs::create_dir_all(&temp).unwrap();
    let real_file = temp.join("real.txt");
    std::fs::write(&real_file, b"real").unwrap();
    unix_fs::symlink(&real_file, temp.join("real-link")).unwrap();

    let summary = dir_size_recursive(&temp);
    assert_eq!(summary.bytes, 4);
    assert_eq!(summary.file_count, 1);
    assert_eq!(summary.skipped_count, 1);

    let _ = std::fs::remove_dir_all(&temp);
}

#[test]
fn dir_size_recursive_with_progress_updates_running_snapshot() {
    let temp =
        std::env::temp_dir().join(format!("aether-dir-size-progress-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&temp);
    std::fs::create_dir_all(&temp).unwrap();
    std::fs::write(temp.join("a.txt"), vec![0u8; 1024]).unwrap();
    std::fs::write(temp.join("b.txt"), vec![0u8; 2048]).unwrap();

    let state = DirectorySizeTaskState::default();
    let cancel_requested = Arc::new(AtomicBool::new(false));
    state
        .insert(
            DirectorySizeTaskSnapshot {
                id: "dir-size-test".into(),
                path: temp.to_string_lossy().into_owned(),
                status: "queued".into(),
                bytes: 0,
                formatted: "0 B".into(),
                allocated_bytes: 0,
                formatted_allocated: "0 B".into(),
                file_count: 0,
                skipped_count: 0,
                is_approximate: true,
                started_at: now_unix_seconds(),
                finished_at: None,
                error: None,
            },
            cancel_requested.clone(),
        )
        .unwrap();

    let summary =
        dir_size_recursive_with_progress(&temp, "dir-size-test", &state, cancel_requested.as_ref())
            .unwrap();
    let snapshot = state.get("dir-size-test").unwrap().unwrap();

    assert_eq!(summary.bytes, 3072);
    assert_eq!(summary.file_count, 2);
    assert_eq!(snapshot.status, "running");
    assert_eq!(snapshot.bytes, 3072);
    assert_eq!(snapshot.file_count, 2);
    assert!(!snapshot.is_approximate);

    let _ = std::fs::remove_dir_all(&temp);
}

#[test]
fn dir_size_recursive_with_progress_stops_when_cancelled() {
    let temp = std::env::temp_dir().join(format!("aether-dir-size-cancel-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&temp);
    std::fs::create_dir_all(&temp).unwrap();
    std::fs::write(temp.join("a.txt"), vec![0u8; 1024]).unwrap();

    let state = DirectorySizeTaskState::default();
    let cancel_requested = Arc::new(AtomicBool::new(true));
    state
        .insert(
            DirectorySizeTaskSnapshot {
                id: "dir-size-cancel-test".into(),
                path: temp.to_string_lossy().into_owned(),
                status: "queued".into(),
                bytes: 0,
                formatted: "0 B".into(),
                allocated_bytes: 0,
                formatted_allocated: "0 B".into(),
                file_count: 0,
                skipped_count: 0,
                is_approximate: true,
                started_at: now_unix_seconds(),
                finished_at: None,
                error: None,
            },
            cancel_requested.clone(),
        )
        .unwrap();

    let err = dir_size_recursive_with_progress(
        &temp,
        "dir-size-cancel-test",
        &state,
        cancel_requested.as_ref(),
    )
    .unwrap_err();

    assert_eq!(err.kind, AppErrorKind::Cancelled);
    let snapshot = state.get("dir-size-cancel-test").unwrap().unwrap();
    assert_eq!(snapshot.bytes, 0);
    assert_eq!(snapshot.file_count, 0);

    let _ = std::fs::remove_dir_all(&temp);
}

// ── file operation safety ──
#[test]
fn validate_child_name_accepts_single_safe_name() {
    assert_eq!(validate_child_name(" report.txt ").unwrap(), "report.txt");
    assert_eq!(validate_child_name("新建文件夹").unwrap(), "新建文件夹");
}

#[test]
fn validate_child_name_rejects_paths_and_illegal_chars() {
    assert!(validate_child_name("").is_err());
    assert!(validate_child_name(".").is_err());
    assert!(validate_child_name("..").is_err());
    assert!(validate_child_name("../secret").is_err());
    assert!(validate_child_name("/tmp/secret").is_err());
    assert!(validate_child_name("a/b").is_err());
    assert!(validate_child_name("a\\b").is_err());
    assert!(validate_child_name("bad:name").is_err());
    assert!(validate_child_name("bad\nname").is_err());
}

#[test]
fn validate_child_name_returns_invalid_path_error() {
    let err = validate_child_name("../secret").unwrap_err();
    assert_eq!(err.kind, AppErrorKind::InvalidPath);
    assert_eq!(err.path.as_deref(), Some("../secret"));
}

#[test]
fn eject_volume_rejects_non_volume_paths_with_invalid_path_error() {
    let err = eject_volume("/".to_string()).unwrap_err();

    assert_eq!(err.kind, AppErrorKind::InvalidPath);
    assert_eq!(err.message, "只能弹出 /Volumes 下的外置磁盘");
    assert_eq!(err.path.as_deref(), Some("/"));
}

#[test]
fn replace_existing_for_copy_restores_target_on_failure() {
    let temp = std::env::temp_dir().join(format!("aether-replace-copy-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&temp);
    std::fs::create_dir_all(&temp).unwrap();

    let src = temp.join("missing.txt");
    let dst = temp.join("target.txt");
    std::fs::write(&dst, b"original").unwrap();

    assert!(replace_existing_for_copy(&src, &dst).is_err());
    assert_eq!(std::fs::read_to_string(&dst).unwrap(), "original");

    let _ = std::fs::remove_dir_all(&temp);
}

#[test]
fn replace_existing_for_move_restores_target_on_failure() {
    let temp = std::env::temp_dir().join(format!("aether-replace-move-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&temp);
    std::fs::create_dir_all(&temp).unwrap();

    let src = temp.join("missing.txt");
    let dst = temp.join("target.txt");
    std::fs::write(&dst, b"original").unwrap();

    assert!(replace_existing_for_move(&src, &dst).is_err());
    assert_eq!(std::fs::read_to_string(&dst).unwrap(), "original");

    let _ = std::fs::remove_dir_all(&temp);
}

#[test]
fn cross_device_rename_error_detects_exdev() {
    let err = std::io::Error::from_raw_os_error(18);
    assert!(is_cross_device_rename_error(&err));
}

#[test]
fn decompress_file_rejects_existing_output_file() {
    let temp = std::env::temp_dir().join(format!("aether-decompress-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&temp);
    std::fs::create_dir_all(&temp).unwrap();

    let zip_path = temp.join("archive.zip");
    let output_dir = temp.join("out");
    std::fs::create_dir_all(&output_dir).unwrap();
    std::fs::write(output_dir.join("same.txt"), b"original").unwrap();

    {
        let file = std::fs::File::create(&zip_path).unwrap();
        let mut writer = zip::ZipWriter::new(file);
        writer
            .start_file("same.txt", zip::write::SimpleFileOptions::default())
            .unwrap();
        std::io::Write::write_all(&mut writer, b"new").unwrap();
        writer.finish().unwrap();
    }

    let result = decompress_file(
        zip_path.to_string_lossy().to_string(),
        output_dir.to_string_lossy().to_string(),
    );

    let err = result.unwrap_err();
    assert_eq!(err.kind, AppErrorKind::Conflict);
    assert_eq!(
        err.path.as_deref(),
        Some(output_dir.join("same.txt").to_string_lossy().as_ref())
    );
    assert_eq!(
        std::fs::read_to_string(output_dir.join("same.txt")).unwrap(),
        "original"
    );

    let _ = std::fs::remove_dir_all(&temp);
}

#[test]
fn decompress_file_rejects_zip_slip_entries_without_writing_files() {
    let temp =
        std::env::temp_dir().join(format!("aether-decompress-zipslip-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&temp);
    std::fs::create_dir_all(&temp).unwrap();

    let zip_path = temp.join("archive.zip");
    let output_dir = temp.join("out");
    std::fs::create_dir_all(&output_dir).unwrap();

    {
        let file = std::fs::File::create(&zip_path).unwrap();
        let mut writer = zip::ZipWriter::new(file);
        writer
            .start_file("../evil.txt", zip::write::SimpleFileOptions::default())
            .unwrap();
        std::io::Write::write_all(&mut writer, b"evil").unwrap();
        writer.finish().unwrap();
    }

    let result = decompress_file(
        zip_path.to_string_lossy().to_string(),
        output_dir.to_string_lossy().to_string(),
    );

    let err = result.unwrap_err();
    assert_eq!(err.kind, AppErrorKind::InvalidPath);
    assert!(!temp.join("evil.txt").exists());
    assert!(std::fs::read_dir(&output_dir).unwrap().next().is_none());

    let _ = std::fs::remove_dir_all(&temp);
}

#[test]
fn decompress_file_rejects_duplicate_entries_before_writing_files() {
    let temp = std::env::temp_dir().join(format!(
        "aether-decompress-duplicate-{}",
        std::process::id()
    ));
    let _ = std::fs::remove_dir_all(&temp);
    std::fs::create_dir_all(&temp).unwrap();

    let zip_path = temp.join("archive.zip");
    let output_dir = temp.join("out");
    std::fs::create_dir_all(&output_dir).unwrap();

    {
        let file = std::fs::File::create(&zip_path).unwrap();
        let mut writer = zip::ZipWriter::new(file);
        writer
            .start_file("same.txt", zip::write::SimpleFileOptions::default())
            .unwrap();
        std::io::Write::write_all(&mut writer, b"first").unwrap();
        writer
            .start_file("./same.txt", zip::write::SimpleFileOptions::default())
            .unwrap();
        std::io::Write::write_all(&mut writer, b"second").unwrap();
        writer.finish().unwrap();
    }

    let result = decompress_file(
        zip_path.to_string_lossy().to_string(),
        output_dir.to_string_lossy().to_string(),
    );

    let err = result.unwrap_err();
    assert_eq!(err.kind, AppErrorKind::Conflict);
    assert!(err
        .path
        .as_deref()
        .unwrap_or_default()
        .ends_with("same.txt"));
    assert!(!output_dir.join("same.txt").exists());

    let _ = std::fs::remove_dir_all(&temp);
}

#[test]
fn resolve_open_with_application_accepts_named_apps() {
    assert_eq!(
        resolve_open_with_application_target(" Preview ").unwrap(),
        "Preview"
    );
}

#[test]
fn resolve_open_with_application_accepts_existing_app_bundle_paths() {
    let temp = std::env::temp_dir().join(format!("aether-open-with-app-{}", std::process::id()));
    let app_path = temp.join("Demo.app");
    let _ = std::fs::remove_dir_all(&temp);
    std::fs::create_dir_all(&app_path).unwrap();

    assert_eq!(
        resolve_open_with_application_target(&format!("{}/", app_path.to_string_lossy())).unwrap(),
        app_path.to_string_lossy()
    );

    let _ = std::fs::remove_dir_all(&temp);
}

#[test]
fn resolve_open_with_application_rejects_invalid_app_bundle_paths() {
    let err = resolve_open_with_application_target("/tmp/not-an-app").unwrap_err();
    assert_eq!(err.kind, AppErrorKind::InvalidPath);
}
