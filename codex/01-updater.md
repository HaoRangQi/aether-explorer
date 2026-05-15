# 01 自动更新管线 (Updater)

**状态**: ✅ 已落地  **首次落地**: [2026-05-14]  **最近更新**: [2026-05-15]  **域**: 客户端自动更新 / 发版流水线

← 返回 [索引](./README.md)

---

## 01.1 一句话总结

基于 **Tauri Updater Plugin + minisign 签名 + GitHub Release**，做到：检查 → 后台下载 → 进度动画 → 静默替换 → 自动重启。无需用户手动下载 DMG。

## 01.2 决策与权衡

| 决策 | 选项 | 选了 | 理由 |
|---|---|---|---|
| 更新机制 | a) 手撸 GitHub API + `shellOpen(dmg)`<br>b) Tauri Updater Plugin | **b** | a 无校验、UX 差、无进度；b 是 Tauri 标准管线，签名校验 + 自动重启全内置 |
| macOS 更新包格式 | a) `.dmg`<br>b) `.app.tar.gz` | **b** | Tauri Updater 标准格式，可直接替换 `.app` bundle；`.dmg` 留给手动下载用户 |
| 架构 | a) Intel + ARM 分别发<br>b) universal binary | **b** | 一次构建覆盖 Intel + Apple Silicon，`latest.json` 只需一组 url，运维简单 |
| 密钥位置 | a) 仓库 secrets<br>b) `~/.tauri/*.key` 本地<br>c) 二者皆有 | **c** | CI 用 GitHub Secrets 作为真相源；本地私钥只用于应急脚本。**不进 git** |
| 校验方式 | 强制 minisign | — | Tauri 不允许关闭签名校验，配了 pubkey 就必须签；这是 feature 不是 bug |
| 首次正式基线 | a) 沿用 `v0.1.1`<br>b) 重置到 `v0.2.0` | **b** | `v0.1.1` 是错误版本号和调试过程产物；`v0.2.0` 作为第一次正式发布基线 |

**重要不变量（碰之前先想清楚）：**

1. **`tauri.conf.json` 里的 pubkey 一旦有真实用户安装就不能轻易换** — 老客户端只信这把公钥；换了 = 老用户失联。
   _`v0.2.0` 是首次正式基线，之后若要换 key，必须先发迁移版本。_
2. **`latest.json` 的 `version` 必须严格大于客户端当前版本** — 否则 `check()` 返回 null 表示"已最新"。
   _发版前必须同步 bump `src-tauri/tauri.conf.json` 和 `src-tauri/Cargo.toml`。_
3. **每个 platform 的 `signature` 字段必须是 `.app.tar.gz.sig` 的完整内容**（包含 `untrusted comment:` 注释行）。

## 01.3 实现拓扑

```
┌───────────────────── 发版端 ─────────────────────┐
│                                                  │
│  src-tauri/tauri.conf.json                       │
│    .plugins.updater.pubkey   ──┐                 │
│    .plugins.updater.endpoints  │                 │
│                                ▼                 │
│  env: TAURI_SIGNING_PRIVATE_KEY                  │
│       TAURI_SIGNING_PRIVATE_KEY_PASSWORD         │
│                ▼                                 │
│  $ tauri build (universal-apple-darwin)          │
│     ├─ <Name>.app                                │
│     ├─ <Name>.dmg                                │
│     ├─ <Name>.app.tar.gz       ← updater 资产    │
│     └─ <Name>.app.tar.gz.sig   ← minisign 签名   │
│                ▼                                 │
│  scripts/release.sh  或  .github/workflows/      │
│     1. jq 生成 latest.json (含 signature)        │
│     2. gh release upload                         │
│                                                  │
└──────────────────────────────────────────────────┘
                       │
                       │ HTTPS (GitHub CDN)
                       ▼
┌───────────────────── 客户端 ─────────────────────┐
│                                                  │
│  SettingsView.tsx                                │
│   handleCheckUpdates                             │
│     └─ check()  → 拉 latest.json                 │
│                  → 版本对比                      │
│                                                  │
│   handleDownloadUpdate                           │
│     └─ update.downloadAndInstall(onEvent)        │
│         ├─ Started   → setState downloading      │
│         ├─ Progress  → 推进度条                  │
│         └─ Finished  → setState installing       │
│             ├─ pubkey 校验 signature             │
│             ├─ 解压并替换 .app bundle            │
│             └─ relaunch()                        │
│                                                  │
└──────────────────────────────────────────────────┘
```

## 01.4 关键文件 & 行号

| 角色 | 路径 | 锚点 |
|---|---|---|
| **客户端 — 配置** | | |
| pubkey + endpoint | `src-tauri/tauri.conf.json` | `plugins.updater` |
| 插件权限 | `src-tauri/capabilities/default.json` | `updater:default`, `process:default` |
| Rust 插件注册 | `src-tauri/src/lib.rs:817-818` | `tauri_plugin_updater`, `tauri_plugin_process` |
| **客户端 — UI 与状态** | | |
| 状态机类型 | `src/components/SettingsView.tsx:64` | `type UpdateStatus` |
| 默认状态 | `src/components/SettingsView.tsx:76` | `DEFAULT_UPDATE_STATUS` |
| 字节格式化 | `src/components/SettingsView.tsx:88` | `formatBytes` |
| 检查更新 | `src/components/SettingsView.tsx:322` | `handleCheckUpdates` |
| 下载安装 | `src/components/SettingsView.tsx:362` | `handleDownloadUpdate` |
| UI 进度条 | `src/components/SettingsView.tsx:1284` | progress section |
| i18n 文案 | `src/i18n/locales/{zh,en}.ts` | `settings.update.*` |
| **发版端** | | |
| 私钥（本机） | `~/.tauri/aether-updater.key` | **不入 git、不外发** |
| 公钥（可外发） | `~/.tauri/aether-updater.key.pub` | base64 后写入 `tauri.conf.json` |
| 本地发版脚本 | `scripts/release.sh` | 手动应急发布 |
| CI 发版工作流 | `.github/workflows/release.yml` | 推 `v*` tag 或手动 workflow_dispatch 触发 |
| 发布 SOP | `codex/06-release-runbook.md` | 版本、发布、验收、故障处理的执行手册 |

## 01.5 数据契约 — `latest.json`

```json
{
  "version": "0.2.0",
  "notes": "release notes",
  "pub_date": "2026-05-14T12:34:56Z",
  "platforms": {
    "darwin-aarch64": {
      "signature": "untrusted comment: ...\nRWQ...完整 minisign 文本...",
      "url": "https://github.com/HaoRangQi/aether-explorer/releases/download/v0.2.0/Aether.Explorer_0.2.0_universal.app.tar.gz"
    },
    "darwin-x86_64": {
      "signature": "...同上...",
      "url": "...同上 url（universal 二进制共用）..."
    }
  }
}
```

**字段约束：**

- `version`: 不带 `v` 前缀的纯 semver
- `pub_date`: ISO-8601，UTC
- `platforms` key 取值由 plugin-updater 决定，macOS 用 `darwin-aarch64` / `darwin-x86_64`，Windows 是 `windows-x86_64`，Linux 是 `linux-x86_64`
- `signature`: `.sig` 文件**完整内容**（含 `untrusted comment:` 行 + base64 主体），用 `\n` 分隔；jq 字符串赋值会自动转义
- `url`: 必须可匿名 HTTPS 直连，GitHub Release 的 `releases/download/<tag>/` 自动满足

## 01.6 状态机

```
                ┌──────┐
                │ idle │ ← 初始
                └───┬──┘
                    │ handleCheckUpdates
                    ▼
                ┌──────────┐
                │ checking │
                └────┬─────┘
              ┌─────┴──────┐
        null  │            │  Update 对象
              ▼            ▼
         ┌─────────┐  ┌──────────┐
         │ current │  │ available│  ← 显示版本对比 + 按钮
         └────▲────┘  └─────┬────┘
              │             │ handleDownloadUpdate
              │             ▼
              │        ┌────────────┐
              │        │downloading │  ← Started/Progress 事件
              │        └─────┬──────┘
              │              │ Finished
              │              ▼
              │        ┌───────────┐
              │        │ installing│  ← 校验 + 替换 .app
              │        └─────┬─────┘
              │              │
              │              ▼
              │        ┌───────────┐
              │        │restarting │  ← relaunch() 前
              │        └─────┬─────┘
              │              │ 进程退出
              │
        (任意阶段抛错)
              ▼
         ┌───────┐
         │ error │
         └───────┘
```

**UI 表现速查：**

| 状态 | 顶部图标 | 主体内容 |
|---|---|---|
| idle | `BadgeCheck` 静态 | 文案 `idleHint` |
| checking | `Loader2` 旋转 | 文案 `checking` |
| current | `BadgeCheck` 静态 | 文案 `alreadyLatest` |
| available | `BadgeCheck` 静态 | 版本对比卡 + 下载按钮 + 发布说明 |
| downloading | `Loader2` 旋转 | 进度条 + 字节数（未知大小时呼吸动画） |
| installing | `Loader2` 旋转 | 进度条满格 |
| restarting | `Loader2` 旋转 | 进度条满格 + `RotateCw` 提示文案 |
| error | `X` 红色 | 错误消息（含原始 err 字符串） |

## 01.7 失败模式与排查

| 现象 | 根因 | 修复 |
|---|---|---|
| `check()` 抛 `"could not validate the signature"` | `latest.json` 缺 `signature` 字段，或字段为空字符串 | 用 `scripts/release.sh` 重发；不要手动拼 json |
| `check()` 抛 `"signature mismatch"` | `tauri.conf.json` 里 pubkey 与签名时用的私钥不配对 | `cat ~/.tauri/*.key.pub` 与 conf.pubkey base64 解码后比对 |
| `check()` 一直返回 null | `latest.json.version <= 客户端当前 version` | bump `tauri.conf.json` + `Cargo.toml` 的 version，重新发版 |
| 下载完成但卡在 installing | macOS Gatekeeper 拦截未公证的 .app | 当前阶段未 notarize，用户首次安装需手动右键打开；自动更新替换后会沿用原 quarantine 标记 |
| Actions 构建失败 `missing TAURI_SIGNING_PRIVATE_KEY secret` | 没在 repo Settings 配置 signing secret | 配 `TAURI_SIGNING_PRIVATE_KEY` 和 `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`（无密码就填空字符串） |
| Actions 构建失败 `Missing comment in secret key` | `TAURI_SIGNING_PRIVATE_KEY` secret 为空或不是完整私钥内容 | 用 `gh secret set TAURI_SIGNING_PRIVATE_KEY < ~/.tauri/aether-updater.key` 重写 secret |
| Actions 构建失败 `Wrong password for that key` | 私钥密码 secret 不匹配 | 重写 `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`，或切换无密码 key 并同步 pubkey |
| Release 有包但没有 `latest.json` | manifest 步骤找错 target bundle 目录，或上传阶段失败 | 先用 `.sig` 手动生成并上传 `latest.json`，再修 workflow；没有 manifest 不算发布完成 |
| Release 里出现 `latest-json.xxxxx.json` 之类随机名 | 误把 `gh release upload/create` 的 `file#label` 当成“重命名资产”机制 | 上传前先把文件真正命名为 `latest.json`，label 只能做展示，不能代替文件名 |
| `latest.json` 存在但 updater 下载 404 或 URL 不匹配 | manifest 使用了原始构建文件名，未对齐最终 release 资产名 | 先统一 release 资产命名，再基于最终上传名生成 `platforms.*.url` |
| 本地脚本签名步骤交互式卡住 | 私钥有密码但没设置环境变量 | `export TAURI_SIGNING_PRIVATE_KEY_PASSWORD='...'` |
| `relaunch()` 后旧进程没退 | Tauri internal，目前未观察到 | 待复现后再补 |
| `tauri-action` 上传半成品或找不到 npm script | action 默认行为不匹配本仓库 | workflow 直接调用 `npx @tauri-apps/cli build --target universal-apple-darwin`，再统一上传 |
| 进度条卡在 20% 呼吸动画 | `event.data.contentLength` 是 0，多见于 Cloudflare 等代理剥离 Content-Length | 当前是已知降级行为，UI 已用呼吸动画兜底；不影响功能 |

## 01.8 SOP — 发版

### 标准发版（CI 路径，推荐）

完整执行手册见 [06 发布运行手册](./06-release-runbook.md)。这里保留最短路径：

```bash
# 1. bump 版本号（两处必须一致）
#    src-tauri/tauri.conf.json   "version": "0.2.0"
#    src-tauri/Cargo.toml        version = "0.2.0"

# 2. 提交 + 打 tag
git add -A
git commit -m "chore: bump to v0.2.0"
git tag v0.2.0
git push origin main --tags

# 3. Actions 自动跑（约 10-15 分钟）
#    完成后 GitHub Release 会自动出现 dmg / app.tar.gz / sig / latest.json

# 4. 验证：执行 codex/06-release-runbook.md 的验收清单，再在旧版本里点"检查更新"
```

### 应急发版（本地路径）

```bash
# 前置：私钥在 ~/.tauri/aether-updater.key
# 前置：gh auth login 已完成

# 如果私钥有密码：
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD='你的密码'

bash scripts/release.sh
```

### 首次配置 CI Secrets

```bash
# 复制私钥内容到剪贴板
cat ~/.tauri/aether-updater.key | pbcopy
# → 粘贴到 GitHub repo Settings → Secrets → Actions → TAURI_SIGNING_PRIVATE_KEY

# 私钥密码（无密码就填空字符串）
# → 同上路径添加 TAURI_SIGNING_PRIVATE_KEY_PASSWORD
```

## 01.9 经验教训

1. **私钥放本地，不入 git，不进 cloud 同步盘**。哪怕是私有仓库 — 离职/泄露成本太高。
2. **Tauri 2 macOS updater 要的是 `.app.tar.gz`，不是 `.dmg`**。这点 v1 → v2 升级时容易搞错，文档也不算显眼。
3. **universal binary 的 target 写法是 `--target universal-apple-darwin`**（注意是连字符），漏写就只构出当前架构。
4. **不要让 `tauri-action` 代管上传**。它容易与仓库脚本约定不一致，甚至先上传半成品；workflow 应直接调用 Tauri CLI，等 `.dmg` / `.app.tar.gz` / `.sig` / `latest.json` 齐全后统一上传。
5. **i18next 占位符是 `{{name}}` 双大括号**。仓库历史代码里很多 `{name}` 单大括号写法是 bug — 不影响渲染（fallback 原样输出）但实际没替换。本次 updater 文案用了正确的双大括号；其他地方留给后续清理。
6. **状态机必须显式 `restarting` 中间态**，不要直接 `await relaunch()`。用户需要看到"即将重启"的提示，否则会以为程序卡死。
7. **进度条要为 `contentLength = 0` 的场景准备呼吸动画**。某些 CDN / 代理会剥 Content-Length，否则进度条永远卡 0%。
8. **`check()` 返回的 `Update` 对象有 `.body` 字段（release notes）**，可以直接展示在"发现新版本"卡片里，比起跳转网页体验更好。
9. **不要写 `--no-verify` 跳过 git hooks 来"快速发版"**。pre-commit 检查（lint / 类型）失败说明发出来的版本可能炸 — 修问题比绕过省心。
10. **pubkey 是项目身份证**。从 `v0.2.0` 这个正式基线开始，换 pubkey = 老客户端断连。若未来要换，必须先发迁移版本。
11. **发布完成必须命令验收**。`gh release view` 要看到 4 个资产，`latest.json` 要能 curl 到且 version/signature/url 正确；页面看起来有包不等于 updater 可用。
12. **manifest 必须基于“最终上传后的资产名”生成，不要基于原始 bundle 文件名生成。** 否则 release 页面看起来有包，但 updater URL 会失真。
13. **GitHub Release 的 label 不是文件名。** `latest.json` 这种关键入口必须是真文件名，不能靠 `#label` 伪装。

## 01.10 未来扩展

- 💡 **静默后台自动检查**：app 启动后 N 秒（避开冷启动峰值）静默 `check()`，发现更新时仅显示一个不阻塞的 Toast，用户点击才进入 SettingsView 下载
- 💡 **增量更新（delta patch）**：当前每次都是全量 `.app.tar.gz`（20MB+）。若包体增长，可调研 bsdiff/zsync 类增量方案
- 💡 **Windows / Linux 支持**：`latest.json.platforms` 加 `windows-x86_64` / `linux-x86_64`；workflow 拆 matrix
- 💡 **代码签名 + Notarization**：macOS 当前未 notarize，首次安装需绕过 Gatekeeper。补 notarize 后可做到真正"无感"更新
- 💡 **回滚机制**：保留前一版 `.app`，更新失败时自动回滚。当前是 Tauri 内部处理（失败时 .app 保持原样），但缺乏前端可见的"回滚到 X 版本"按钮
- ⚠️ **`releaseUrl` 当前是硬编码组装**（`https://github.com/HaoRangQi/aether-explorer/releases/tag/v${latestVersion}`）。如果仓库迁移或改名，需要同步改 `SettingsView.tsx`。考虑提到 `tauri.conf.json` 的 build env 或 constants
