# Aether Explorer Smoke Test

> 每次合并 / 发版前过一遍。预计耗时：5 分钟。
> 配套 `window.__aether.smoke()` 控制台脚本可自动完成约一半检查。
> 发版候选的 Full Disk Access 证据优先用设置页“复制权限证据”按钮；DevTools 中的 `window.__aether.permissionEvidence()` 是备用方式，且不依赖 dev-only smoke runner。

---

## 0. 启动 / 控制台自检（30 秒）

```bash
cd /Users/macos/Downloads/Projects/aether-explorer
npm run dev
```

启动后打开 DevTools（设置 → 启用开发者控制台 → 状态栏 ⚡），控制台输入：
```js
window.__aether.smoke()
```

期望输出 `ok: true`，所有 check 列表全绿。

- [ ] check 列表包含 `full_disk_access_status returns status/probes`；允许结果是 granted / denied / unknown，但不能是 unknown command 或缺少 probes。
  首次启动时 status 为 `denied` 或 `unknown` 是正常状态，用户授权后应变为 `granted`。
- [ ] 如需记录权限验收证据，优先进入“设置 → 权限与隐私”点击“复制权限证据”。如果需要控制台备用方式，输入（dev / 发版候选均可用）：
  ```js
  JSON.stringify(await window.__aether.permissionEvidence(), null, 2)
  ```
  输出应包含 `capturedAt`、`appIdentity.appName`、`appIdentity.bundleIdentifier`、`appIdentity.version`、`appIdentity.appPath`、`fullDiskAccess.status`、`fullDiskAccess.probes`、`runtime.currentWindowLabel` 和 `runtime.userAgent`。
- [ ] 首次启动若弹出完全磁盘访问引导，打开系统设置并开启权限后，弹窗应在下一轮自动检查通过并关闭；“检查授权”按钮只作为手动刷新备用。
- [ ] 若上次存在新的 Rust 崩溃日志，启动后应弹出“上次异常退出”提示；点“查看诊断”进入设置 → 关于 → 诊断与反馈。

## 0.1 Full Disk Access 干净用户验收（发版候选必须，15-20 分钟）

> 这是 MoleUI FDA 模型的闭环证据。不要在主力用户上跑 `tccutil reset`；用新的 macOS 用户、干净 VM 或可丢弃测试机。

- [ ] 在干净用户 / VM 中首次启动前，先对发版候选 `.app` 跑打包产物权限模型预检：
  ```bash
  npm run validate:macos-app:release -- "/Applications/Aether Explorer.app"
  ```
  命令必须通过；它要求发版候选具备稳定签名身份（非 ad-hoc，`TeamIdentifier` 存在，签名 `Identifier` 匹配 `com.aether.explorer`），检查 `Info.plist` 和可读取的 entitlements，不启动 app，不会修改 TCC，也不能替代后续 FDA 人工授权证据。
- [ ] 使用稳定安装路径启动发版候选，优先 `/Applications/Aether Explorer.app`。记录 `CFBundleIdentifier`、App bundle 名称和构建版本。
- [ ] 首次启动时，Aether 能触发完全磁盘访问引导；点击“在 Finder 中显示 Aether”能定位当前授权目标，打包版必须定位 `.app`。
- [ ] 点击“打开系统设置”后，Aether 能出现在“隐私与安全性 → 完全磁盘访问权限”列表中。
- [ ] 手动打开 Aether 的完全磁盘访问开关后，回到 Aether；启动引导应在下一轮自动检查后关闭，设置页“重新检查”应显示 `granted`。
- [ ] 在“设置 → 权限与隐私”点击“复制权限证据”并保存 JSON；`appIdentity` 必须匹配当前发版候选，`fullDiskAccess.status` 必须为 `granted`，`fullDiskAccess.probes` 只能是 TCC 路径。DevTools 可用时，也可用 `await window.__aether.permissionEvidence()` 采集同一份证据。
  TCC-only probe 是为了避免把 Desktop / Documents / Downloads 等用户内容读取误当成 FDA 状态证明。
  保存后在项目根目录运行：
  ```bash
  npm run validate:fda-evidence -- /path/to/fda-evidence.json
  npm run validate:macos-permission-release -- --app "/Applications/Aether Explorer.app" --evidence /path/to/fda-evidence.json
  ```
  两条命令都必须通过；联合校验会复用发版候选 `.app` 预检和 FDA evidence 预检，并额外确认 JSON 中的 `appIdentity` 与当前 `.app` 的 bundle id、版本和真实路径一致。它只读检查文件，不启动 app，不修改 TCC，也不能替代人工授权步骤。
- [ ] 若当前候选是 dev 构建，再运行 `window.__aether.smoke()`；`full_disk_access_status returns status/probes` 应通过。production 发版候选以 `permissionEvidence()` JSON 和人工路径检查为准。
- [ ] 退出并重新打开 Aether；不应再次要求权限，设置页 probe 仍为 `granted`。
- [ ] 用同 bundle id、同 app 名、同安装路径替换为下一份候选构建；probe 为 `granted` 时不应打扰用户，probe 失败时才进入统一恢复流程。
- [ ] 打开受保护目录（Desktop / Documents / Downloads / iCloud Drive 下的普通目录）并执行核心浏览、搜索、预览、复制、移动、重命名、移至废纸篓；不应对同一个目录反复弹目录级授权。
- [ ] 在受保护本地目录触发完全磁盘访问恢复界面后，手动开启 FDA 并回到 Aether；当前失败的目录应自动重试一次。若这一次仍失败，应显示普通目录读取失败，不再自动打开或反复引导完全磁盘访问。
- [ ] 在尚未开启 FDA 时点击受保护目录恢复界面的“重试”，应只重新检查完全磁盘访问状态，不应反复读取同一个受保护目录或制造新的目录级授权提示。
- [ ] 远程连接返回权限失败时，只显示远程加载失败 / 重试，不显示 macOS 完全磁盘访问或“打开系统设置”恢复入口。
- [ ] 检查 macOS 隐私列表：默认启动、probe 和核心浏览不应新增 Mail、Safari、Messages、Contacts、Calendars、Photos、Accessibility、Apple Events 等无关隐私域。
- [ ] 记录结果：通过 / 失败项、macOS 版本、构建 hash、安装路径、FDA status、失败截图或控制台输出。

没有跑完本节，只能说“权限方案设计与自动化验证完成”，不能说“权限体验已闭环”。

---

## 1. 窗口外壳（30 秒）

- [ ] 默认 1200×800 启动，圆角 + 毛玻璃显示正常
- [ ] 拖动顶栏可移动窗口
- [ ] 右上角红/黄/绿按钮可关闭/最小化/全屏
- [ ] `Cmd+N` 新建窗口
- [ ] `Cmd+W` 关闭标签页；只有一个标签页时关闭窗口
- [ ] 按 `?` 打开快捷键列表；按 `Esc` 或关闭按钮收起；光标在搜索框 / 重命名输入框内时不触发
- [ ] `Cmd+,` （如已绑定）进入设置

## 2. 文件浏览（1 分钟）

- [ ] 进入主页加载 < 1 秒
- [ ] 切换 列表 / 网格 / 分栏 三种视图
- [ ] 双击文件夹进入；← 返回上级；→ 前进
- [ ] 面包屑可点跳转、可点编辑路径
- [ ] 隐藏文件开关切换有效（看 `.DS_Store` / `.git` 等）

## 3. 文件操作（1 分钟）

- [ ] 单击选中、`Cmd+点击` 追加、`Shift+点击` 范围选
- [ ] `Cmd+A` 全选
- [ ] `Cmd+C` / `Cmd+V` 在同一目录粘贴会自动 " copy" 命名
- [ ] 右键 → 「复制到」/「移动到」弹出**目录选择对话框**（不再是 prompt!）
- [ ] 移动到同一目录 → 源文件不变、目标无新增，提示为同目录而不是同名冲突跳过
- [ ] 冲突弹窗选择「跳过」→ 同名目标保持原内容，非冲突项继续处理，传输管理器显示同名跳过计数
- [ ] 大文件复制中打开传输管理器 → 取消任务 → 目标目录不出现完整目标文件，已有同名旧文件内容不变
- [ ] 目录内放一个指向外部目录 / 父目录的 symlink → 复制后目标仍是 symlink，且没有展开复制链接目标内容
- [ ] 右键 → 移至废纸篓 → 文件消失
- [ ] 双击 `.txt` 用系统默认应用打开
- [ ] 重命名（F2 / 双击文件名）
- [ ] 用 AI 文件助手执行一次操作后打开 AI 操作历史，可看到新记录
- [ ] AI 操作历史支持按文件名关键词搜索、按日期筛选（今天 / 近 7 天 / 自定义）和分页翻页

## 4. 拖拽（1 分钟）

- [ ] **同窗口**：拖文件到子文件夹，文件夹高亮 → 松手移入
- [ ] **跨窗口**：A 拖文件出去，B 出现 "松开鼠标即可复制到此" overlay；松手在 B 内 → 复制
- [ ] **跨窗口移动**：Cmd + 松手 → A 中文件消失（按设置）
- [ ] **跨窗口冲突跳过**：移动到已含同名文件的目录，选择「跳过」后只跳过冲突项，非冲突项继续处理
- [ ] **跨窗口取消**：跨窗口复制 / 移动触发传输后取消，B 不留下半复制文件；移动取消后 A 源文件仍在
- [ ] **跨窗口 symlink**：拖拽复制含 symlink 的目录后，目标保留 symlink 本身而不是展开目标内容
- [ ] **设置 → 跨窗口拖拽默认动作**：切到"移动"，普通松手 = 移动；切到"每次询问"暂只走 copy（安全兜底）
- [ ] **Finder → Aether**：从 Finder 拖文件入 Aether 文件区 → overlay → 松手复制
- [ ] **拖到桌面 / Finder**：拖出 Aether 窗口外，松手 → 显示“暂不支持直接拖到 Finder”，引导使用“在 Finder 中显示”

## 5. 设置（1 分钟）

- [ ] 主题切换（浅色/深色/自动）即时生效
- [ ] 强调色选择 6 种预设 → 文字 / 高亮颜色实时变
- [ ] 模糊强度滑块默认 **0**（性能优先；> 0 时 GPU 占用上升）
- [ ] 字体下拉换字体生效
- [ ] **空格键预览**开关：开 → 选文件按空格 → Quick Look 弹出；关 → 不弹（其他入口仍可用）
- [ ] **跨窗口拖拽默认动作**：三段开关清晰可切
- [ ] **AI 操作历史保留期**：设置项可切换（3/7/15/30/90 天），关闭重开后配置保持
- [ ] 设置 → 权限与隐私：只显示一个“完全磁盘访问权限”状态，不再列 Desktop / Documents / Downloads 等逐目录状态。
- [ ] 点击“打开系统设置”后应进入 macOS 系统设置的隐私权限入口；进入“隐私与安全性 → 完全磁盘访问权限”，为 Aether Explorer 打开开关。
- [ ] 点击“在 Finder 中显示 Aether”后应定位当前 Aether app；打包版应定位 `.app`，开发版可定位当前可执行文件。
- [ ] 回到 Aether 点击“重新检查”：页面使用 `full_disk_access_status` 重新探测，显示 granted / denied / unknown 之一，并展示 TCC 探针证据。
- [ ] 探针证据只应包含 `/Library/Application Support/com.apple.TCC` 或 `~/Library/Application Support/com.apple.TCC` 相关路径，不应读取桌面、文稿或下载内容。
- [ ] 设置 → 文件与存储 → 配置备份与恢复：导出 JSON 含 `schemaVersion`；导入无效 JSON 在页面内显示错误；重置全部配置需要二次确认
- [ ] 设置 → 关于 → 诊断与反馈：可复制诊断信息、打开日志目录、打开配置文件夹、读取最近崩溃日志

## 6. 安全 / 边界（30 秒，开发者关注）

- [ ] 控制台试 `await window.__TAURI__.shell.open('javascript:alert(1)')` → 应被 Tauri capability 拒绝；用 `safeShellOpen` 也拒绝
- [ ] 设置 → 添加自定义扩展，命令含 `; rm` → 执行应失败（提示受限字符）
- [ ] 右键 `.env` 文件 → 预览面板提示"不在预览面板展示（含敏感信息）"
- [ ] macOS 开启“减少动态效果”后：网格 hover 不上浮，`?` 快捷键弹窗 / 传输弹窗不做位移缩放，加载指示器不持续旋转

## 7. 远程访问（1 分钟）

- [ ] 侧栏「远程访问」点击添加按钮，弹窗立即出现。
- [ ] SFTP 可选择密码登录或密钥文件登录；点击「浏览」默认打开 `~/.ssh`。
- [ ] 新建连接先点「测试连接」：按钮 5 秒内结束，成功显示「连接成功」，失败显示明确原因，不持续转圈。
- [ ] 测试成功后保存并点击侧栏连接，远程根目录应加载，继续点击远程子目录能进入。
- [ ] 如果 SFTP 返回 `Unable to exchange encryption keys`，提示应说明是 SSH 算法协商失败，并建议服务器启用 `curve25519-sha256`、`ecdh-sha2-nistp256`、`diffie-hellman-group14-sha256`、`ssh-ed25519`、`rsa-sha2-256/512`、`aes128-ctr` 或 `hmac-sha2-256`，不能提示成账号密码错误。
- [ ] 已保存连接可从侧栏编辑；编辑弹窗可删除连接，删除后侧栏和已打开远程标签同步移除。

## 8. 自动化测试（10 秒）

```bash
npm run lint          # TypeScript + ESLint + macOS 权限模型预检
npm run lint:eslint   # 前端 console / browser dialog / Hooks 风险门禁
npm run lint:macos-permissions # 非沙盒 FDA 权限模型配置预检
npm run lint:readme   # 中英文 README 标题同步，当前 23 个 tracked headings
npm run lint:i18n     # 高风险文案 i18n 覆盖，当前 77 个 locale key、24 处 ExplorerView 用法、3 处 Full Disk Access recovery 用法、12 处 AIRenamePanel 用法、4 处 app diagnostics 用法、7 处 settings diagnostics 用法、15 处 settings backup 用法、43 处 SettingsView 高风险用法、10 处 shortcut help 用法
npm run lint:ci-gates # CI / release 关键门禁覆盖，当前 8 test gates / 8 release gates / 8 local release gates / 15 script implementations / 3 dependency resolution checks / 19 CI setup checks / 3 timeout checks / 6 work branch triggers / 1 pull request target / 6 release trigger checks / 13 release security checks / 11 version checks / release integrity checks
npm run lint:rust     # Rust clippy，按 warning 即失败
npm run validate:macos-app:release -- "/Applications/Aether Explorer.app" # 发版候选签名 .app 权限模型预检；路径换成实际安装位置
npm run validate:macos-permission-release -- --app "/Applications/Aether Explorer.app" --evidence /path/to/fda-evidence.json # clean-user FDA 证据与同一发版候选 .app 的联合校验；需要先保存 evidence JSON
npm test              # vitest，当前 31 个测试文件 / 334 个用例
npm run test:rust     # cargo test --lib，当前 129 个 Rust 单元测试
npm run build         # production build smoke
```

上述前端、Rust、文档、i18n、CI gate 和 production build 检查都通过，才算可以合并 / 发版。

---

## 失败后的处置

| 失败项 | 可能原因 | 第一步 |
|--------|---------|-------|
| smoke 第 N 项报 unknown command | Rust 端命令未注册 | 检查 `invoke_handler!` 列表 |
| `full_disk_access_status` 没有返回 status/probes | 权限命令未注册或 Rust 结构序列化回归 | 检查 `src-tauri/src/lib.rs` 和 FDA probe model |
| `list_directory` 不返回数组 | 权限被拒 / 路径不存在 | 看 macOS 系统设置 → 隐私与安全性 → 完全磁盘访问 |
| 跨窗口拖拽 banner 不显示 | event 注册失败 | DevTools 看 console 是否有 `aether-file-drag-start` log |
| Quick Look 不弹 | enableSpacePreview 关了 / qlmanage 不在 PATH | 重新打开开关 / 试 `which qlmanage` |
| 颜色 / 主题不切换 | localStorage 损坏 | 控制台 `localStorage.removeItem('theme-settings')` 后刷新 |

---

## 历史问题清单（已知不复现即可）

- 跨窗口拖拽底层窗口不能可靠置顶 — 见 `BUG.md` 与 `docs/CROSS_WINDOW_DRAG.md`；如要根治需评估 CGEventTap 路线
- 大文件复制无进度 — 已接入 TransferModal + Rust 字节进度；回归时确认取消不留半成品
- 网格视图 hover 上浮已改 CSS（之前 framer-motion whileHover）；开启 reduced-motion 后应完全不上浮
