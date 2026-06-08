use crate::error::AppError;
use std::fs;
use std::os::unix::fs::PermissionsExt;
use std::path::Path;

#[tauri::command]
pub(crate) fn list_terminal_apps() -> Result<Vec<String>, AppError> {
    let mut terminals = vec!["Terminal".to_string(), "iTerm".to_string()];
    let candidates = [
        "/Applications",
        "/System/Applications",
        "/Applications/Utilities",
    ];
    let terminal_keywords = [
        "terminal",
        "iterm",
        "warp",
        "kitty",
        "wezterm",
        "alacritty",
        "ghostty",
        "tabby",
        "hyper",
    ];

    if let Ok(output) = std::process::Command::new("mdfind")
        .args(["kMDItemContentType == 'com.apple.application-bundle'"])
        .output()
    {
        if let Ok(text) = String::from_utf8(output.stdout) {
            for path in text.lines() {
                let name = Path::new(path)
                    .file_name()
                    .and_then(|n| n.to_str())
                    .unwrap_or_default();
                let lower = name.to_lowercase();
                if name.ends_with(".app") && terminal_keywords.iter().any(|kw| lower.contains(kw)) {
                    let app_name = name.trim_end_matches(".app").to_string();
                    if !terminals.iter().any(|t| t == &app_name) {
                        terminals.push(app_name);
                    }
                }
            }
        }
    }

    for dir in candidates {
        if let Ok(entries) = fs::read_dir(dir) {
            for entry in entries.flatten() {
                let name = entry.file_name().to_string_lossy().to_string();
                let lower = name.to_lowercase();
                if name.ends_with(".app") && terminal_keywords.iter().any(|kw| lower.contains(kw)) {
                    let app_name = name.trim_end_matches(".app").to_string();
                    if !terminals.iter().any(|t| t == &app_name) {
                        terminals.push(app_name);
                    }
                }
            }
        }
    }

    terminals.sort_by_key(|a| a.to_lowercase());
    terminals.dedup();
    Ok(terminals)
}

/// 拒绝包含未被 shell 单引号保护的 shell 元字符的用户命令片段。
///
/// 这一层防御针对自动化路径：菜单扩展的 terminalArgs / shell command 字段在没有
/// 用户二次确认时（confirmExecution=false）执行，必须保证 user_cmd 不会
/// "逃出" 我们包装的引号 / `cd` 前缀。
///
/// 前端会先对模板占位符执行 shell_quote；这里保留后端兜底，允许危险字符
/// 出现在已引用参数内。用户在设置面板手敲"高级命令"应走
/// confirmExecution=true 流程，前端可以选择跳过此校验。
pub(crate) fn find_forbidden_shell_token_outside_quotes(
    s: &str,
) -> Result<Option<&'static str>, String> {
    let bytes = s.as_bytes();
    let mut i = 0;
    let mut in_single_quote = false;

    while i < bytes.len() {
        let ch = bytes[i] as char;
        if ch == '\n' || ch == '\r' {
            return Ok(Some(if ch == '\n' { "\n" } else { "\r" }));
        }

        if in_single_quote
            && ch == '\''
            && i + 3 < bytes.len()
            && bytes[i + 1] as char == '\\'
            && bytes[i + 2] as char == '\''
            && bytes[i + 3] as char == '\''
        {
            i += 4;
            continue;
        }

        if ch == '\'' {
            in_single_quote = !in_single_quote;
            i += 1;
            continue;
        }

        if in_single_quote {
            i += 1;
            continue;
        }

        if ch == '\\' {
            i = (i + 2).min(bytes.len());
            continue;
        }

        if i + 1 < bytes.len() {
            match (bytes[i], bytes[i + 1]) {
                (b'$', b'(') => return Ok(Some("$(")),
                (b'&', b'&') => return Ok(Some("&&")),
                (b'|', b'|') => return Ok(Some("||")),
                _ => {}
            }
        }

        match ch {
            '`' => return Ok(Some("`")),
            ';' => return Ok(Some(";")),
            '|' => return Ok(Some("|")),
            '>' => return Ok(Some(">")),
            '<' => return Ok(Some("<")),
            _ => {}
        }
        i += 1;
    }

    if in_single_quote {
        return Err("命令含未闭合的单引号".into());
    }
    Ok(None)
}

pub(crate) fn validate_shell_fragment(s: &str) -> Result<String, String> {
    let trimmed = s.trim();
    if trimmed.is_empty() {
        return Err("命令为空".into());
    }
    if let Some(tok) = find_forbidden_shell_token_outside_quotes(trimmed)? {
        return Err(format!(
            "命令含受限字符 {} — 请改用『扩展菜单』的高级命令模式（启用执行前确认）",
            tok
        ));
    }
    Ok(trimmed.to_string())
}

/// 终端应用白名单 — 拒绝任意名字以防 app_name 含 AppleScript 注入字符。
const ALLOWED_TERMINAL_APPS: &[&str] = &[
    "Terminal",
    "iTerm",
    "iTerm2",
    "Warp",
    "kitty",
    "WezTerm",
    "Alacritty",
    "Ghostty",
    "Tabby",
    "Hyper",
];

pub(crate) fn is_allowed_terminal(name: &str) -> bool {
    ALLOWED_TERMINAL_APPS
        .iter()
        .any(|a| a.eq_ignore_ascii_case(name))
}

#[tauri::command]
pub(crate) fn open_terminal_at(
    path: String,
    terminal_app: Option<String>,
    args: Option<String>,
    scripts: Option<Vec<String>>,
    custom_command: Option<String>,
) -> Result<(), AppError> {
    let target_path = Path::new(&path);
    let dir = if target_path.is_dir() {
        target_path.to_path_buf()
    } else {
        target_path.parent().unwrap_or(Path::new("/")).to_path_buf()
    };
    let dir_str = dir.to_string_lossy().to_string();

    let app_name = terminal_app.unwrap_or_else(|| "Terminal".into());
    if !is_allowed_terminal(&app_name) {
        return Err(AppError::invalid_path(
            format!("不允许的终端应用: {}", app_name),
            None,
        ));
    }
    let arg_text = args.unwrap_or_default();

    // scripts 数组逐条验证后拼接
    let scripts_tail: Option<String> = scripts
        .map(|ss| {
            ss.into_iter()
                .filter(|s| !s.trim().is_empty())
                .collect::<Vec<_>>()
        })
        .filter(|ss| !ss.is_empty())
        .map(|ss| {
            ss.into_iter()
                .map(|s| {
                    validate_shell_fragment(&s).map_err(|err| AppError::invalid_path(err, None))
                })
                .collect::<Result<Vec<_>, AppError>>()
        })
        .transpose()?
        .map(|validated| validated.join(" && "));

    let lower = app_name.to_lowercase();
    let args_tail = {
        let trimmed_args = arg_text.trim();
        if trimmed_args.is_empty() {
            None
        } else {
            Some(
                validate_shell_fragment(trimmed_args)
                    .map_err(|err| AppError::invalid_path(err, None))?,
            )
        }
    };
    let raw_tail = custom_command
        .as_deref()
        .map(str::trim)
        .filter(|c| !c.is_empty())
        .map(|c| validate_shell_fragment(c).map_err(|err| AppError::invalid_path(err, None)))
        .transpose()?
        .or_else(|| scripts_tail.clone())
        .or(args_tail);
    let command = match raw_tail.as_deref() {
        Some(tail) => format!("cd {} && {}", shell_quote(&dir_str), tail),
        None => format!("cd {}", shell_quote(&dir_str)),
    };

    if lower.contains("terminal") || lower.contains("iterm") {
        // command 已经只含白名单字符 + 我们自己拼接的 cd 包装 — 用 apple_quote 包字符串进 AppleScript。
        // app_name 已通过白名单，进 apple_quote 是双重保险。
        let script = if lower.contains("iterm") {
            format!(
                "tell application {}\nactivate\ncreate window with default profile\ntell current session of current window to write text {}\nend tell",
                apple_quote(&app_name),
                apple_quote(&command),
            )
        } else {
            // Terminal.app: 始终在新 tab 执行，确保用户能看到命令输出
            format!(
                "tell application {}\nactivate\ndo script {}\nend tell",
                apple_quote(&app_name),
                apple_quote(&command),
            )
        };
        let output = std::process::Command::new("osascript")
            .args(["-e", &script])
            .output()
            .map_err(|e| {
                AppError::internal_at(format!("打开终端失败: {}", e), Some(path.clone()))
            })?;
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(AppError::internal_at(
                format!("AppleScript 错误: {}", stderr),
                Some(path),
            ));
        }
    } else {
        // 非 Terminal/iTerm 终端：通过临时脚本传递命令
        if let Some(tail) = raw_tail.as_deref() {
            let tmp_script =
                std::env::temp_dir().join(format!("aether-launch-{}.sh", std::process::id()));
            let script_content = format!(
                "#!/bin/sh\ncd {}\n{}\nexec $SHELL",
                shell_quote(&dir_str),
                tail
            );
            std::fs::write(&tmp_script, &script_content).map_err(|e| {
                AppError::internal_at(
                    format!("写入临时脚本失败: {}", e),
                    Some(tmp_script.to_string_lossy().to_string()),
                )
            })?;
            std::fs::set_permissions(&tmp_script, std::fs::Permissions::from_mode(0o755)).map_err(
                |e| {
                    AppError::internal_at(
                        format!("设置脚本权限失败: {}", e),
                        Some(tmp_script.to_string_lossy().to_string()),
                    )
                },
            )?;
            std::process::Command::new("open")
                .args(["-a", &app_name, tmp_script.to_string_lossy().as_ref()])
                .spawn()
                .map_err(|e| {
                    AppError::internal_at(format!("打开终端应用失败: {}", e), Some(path))
                })?;
        } else {
            std::process::Command::new("open")
                .args(["-a", &app_name, &dir_str])
                .spawn()
                .map_err(|e| {
                    AppError::internal_at(format!("打开终端应用失败: {}", e), Some(path))
                })?;
        }
    }
    Ok(())
}

pub(crate) fn apple_quote(value: &str) -> String {
    format!("\"{}\"", value.replace('\\', "\\\\").replace('"', "\\\""))
}

pub(crate) fn shell_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}
