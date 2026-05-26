# 14 原生玻璃与文件工作台治理 (Liquid-Glass-File-Workbench)

**状态**: ✅ 已落地并验证  **首次落地**: [2026-05-26]  **最近更新**: [2026-05-26]  **域**: macOS 原生 Liquid Glass、文件操作状态机、分栏导航、大小统计、权限预检与 release 版本线治理

← 返回 [索引](./README.md)

---

## 14.1 一句话总结

本轮把“看起来像 Finder”的体验从单点 UI 调参提升为跨层治理：原生玻璃由 Rust/Tauri 插件负责，文件工作台的拖拽、分栏、简介、大小和权限提示都必须有明确状态源，不允许靠局部视觉补丁掩盖状态错误。

## 14.2 决策与权衡

| 决策 | 规则 | 原因 |
|---|---|---|
| Liquid Glass 走原生插件 | 使用 `tauri-plugin-liquid-glass`；不支持时关闭开关并展示原因 | WebView 内 `backdrop-filter` 只能处理 Web 渲染树，不能真折射桌面像素 |
| 玻璃主题与原生材质分层 | Rust 负责 native effect；React/CSS 只负责文本、面板、菜单和 token | 防止“原生没启用但 UI 看起来像启用”的假状态 |
| 权限处理前置 | 启动后做一次 best-effort preflight；业务中尽量只执行实际操作，不弹自定义权限拦截 | macOS TCC 的系统弹窗不可完全替代，但应用不应反复二次提示 |
| 分栏路径是 branch，不是 selection | `columnPaths` 只表示已展开文件夹分支；真实选中仍归 `selectedFileIds` | 避免父文件夹和普通文件同时高亮造成“多选错觉” |
| 文件点击必须裁剪后代列 | 点击普通文件时按来源列裁剪 `columnPaths`，关闭右侧 stale 子栏 | Finder 分栏语义是单一路径分支，不允许同一父列同时展开多个后代 |
| 拖拽传输以任务为源 | 用户可见的 copy/move 走 transfer task；同页面 drop 用本地 handled 标记去重 | 避免同时触发 HTML5 drop、全局 dragEnd fallback 和跨窗口兜底 |
| 大小和磁盘统计在 Rust 层计算 | 文件夹大小走 `get_dir_size`；根卷容量优先走 macOS `diskutil info -plist` | UI 只展示结果，避免前端用字符串或错误挂载点估算 |
| 替身是复制品，不是 symlink | “制作替身”调用 `duplicate_as_alias` 真实复制，并命名为 `xxx-替身` | 文件管理器里的“替身”对当前产品语义是快速复制，不是 Unix 链接 |
| release 版本线回到 `0.4.2` | tag、`package.json`、`package-lock.json`、`tauri.conf.json`、`Cargo.toml` 必须一致 | 历史 `v4.0.1` 是版本线异常；后续按 `0.x` release 线继续治理 |

不可违反的不变量：

- `theme.enableLiquidGlass === true` 只能在 native status `applied === true` 后保留。
- `columnPaths[index]` 只代表第 `index` 列中被打开的文件夹路径，不代表该 item 被真实选中。
- 右侧简介面板解析选中项时必须覆盖当前目录文件和分栏缓存文件。
- 任务结束后的传输面板可自动关闭，但鼠标活动必须重置倒计时。
- 发版必须走 [§ 06 发布运行手册](./06-release-runbook.md)，不得手写 `latest.json`。

## 14.3 实现拓扑

```text
SettingsView toggle
      │
      ▼
set_native_liquid_glass_enabled ──► tauri-plugin-liquid-glass
      │                                  │
      │ status(applied/supported/reason) │
      ▼                                  ▼
theme.enableLiquidGlass           native NSGlassEffectView
      │
      ▼
CSS token layer (.liquid-glass-theme / .liquid-glass)


ExplorerView click/drop/preview
      │
      ├─ column-navigation.ts ──► columnPaths branch state
      ├─ TransferTask API ──────► TransferModal auto-close + detail actions
      ├─ get_dir_size ─────────► Inspector size fields
      └─ get_disk_info ────────► footer storage ratio
```

## 14.4 关键文件 & 行号

| 文件 | 责任 |
|---|---|
| `src-tauri/Cargo.toml:22` | Tauri 开启 `macos-private-api`，这是原生 Liquid Glass 的前置条件 |
| `src-tauri/Cargo.toml:34` | 引入 `tauri-plugin-liquid-glass` |
| `src-tauri/src/lib.rs:1055` | 启动权限 preflight 的 Rust 命令 |
| `src-tauri/src/lib.rs:2511` | `duplicate_as_alias`，把“替身”实现为真实复制 |
| `src-tauri/src/lib.rs:2669` | `get_dir_size`，递归统计文件夹大小、磁盘占用和跳过项 |
| `src-tauri/src/lib.rs:2864` | `get_disk_info`，根卷优先使用 APFS Data 统计 |
| `src/App.tsx:226` | 启动后延迟触发权限 preflight |
| `src/App.tsx:441` | 根据 Liquid Glass 状态注入主题 class 和 CSS 变量 |
| `src/App.tsx:497` | 同步 native Liquid Glass 状态，失败时回滚主题开关 |
| `src/components/SettingsView.tsx:846` | 设置页 Liquid Glass toggle 与不支持提示 |
| `src/index.css:150` | Liquid Glass 主题 token |
| `src/index.css:280` | `.liquid-glass` 组件级材质样式 |
| `src/components/ExplorerView.tsx:1335` | 选中项 lookup 覆盖分栏缓存，保证右侧面板识别子栏 item |
| `src/components/ExplorerView.tsx:2198` | 分栏点击后更新 branch；文件点击裁剪后代列 |
| `src/components/ExplorerView.tsx:2844` | 分栏 branch 高亮和真实 selection 分离 |
| `src/components/ExplorerView.tsx:4259` | 简介面板的文件夹大小状态绑定 |
| `src/components/TransferModal.tsx:137` | 任务完成后的 1.5 秒自动关闭倒计时 |
| `src/lib/column-navigation.ts:16` | 文件夹选择后的分栏路径解析 |
| `src/lib/column-navigation.ts:37` | 普通文件选择后的分栏路径裁剪 |
| `src/__tests__/column-navigation.test.ts:55` | 点击普通文件关闭右侧 stale 子栏的回归测试 |
| `liquid-glass-research-Docs/tauri-liquid-glass-feasibility.md:1` | 原生 Liquid Glass 选型调研 |
| `liquid-glass-research-Docs/liquid-glass-research.md:1` | Web SVG 位移图玻璃研究，作为非桌面折射参考 |

## 14.5 数据契约

### NativeLiquidGlassStatus

```ts
type NativeLiquidGlassStatus = {
  requested: boolean;
  supported: boolean;
  applied: boolean;
  reason?: string;
};
```

契约含义：

- `requested`: 用户或启动同步是否请求开启。
- `supported`: 当前系统和插件是否支持 native effect。
- `applied`: native 层是否真的应用成功。前端开关只信这个字段。
- `reason`: 失败或不支持时给设置页展示。

### columnPaths

```ts
type ColumnPaths = string[];
// allColumns = [undefined, ...columnPaths]
// colIndex 0 = root/current column
// columnPaths[0] = second column parent path
```

规则：

- 点击第 `colIndex` 列文件夹：保留 `columnPaths.slice(0, colIndex)` 后追加该文件夹路径。
- 点击第 `colIndex` 列普通文件：只保留 `columnPaths.slice(0, colIndex)`。
- 不要把 `columnPaths.includes(file.path)` 当成真实 selection。

### DirectorySizeInfo

```ts
type DirectorySizeInfo = {
  path: string;
  bytes: number;
  formatted: string;
  allocated_bytes?: number;
  formatted_allocated?: string;
  file_count: number;
  skipped_count?: number;
};
```

展示规则：简介面板永远展示大小字段。文件夹在 loading 时显示 shimmer；成功后展示逻辑大小、文件数、可选磁盘占用和跳过项；失败时展示 `--` 并在 title 中保留错误。

## 14.6 状态机 / 生命周期

### Liquid Glass

```text
User toggles on
  └─ invoke(set_native_liquid_glass_enabled)
       ├─ applied=true  → persist theme.enableLiquidGlass=true
       └─ applied=false → show reason, persist false

App startup / theme mode change
  └─ sync native effect from persisted theme
       ├─ success → inject CSS token class
       └─ failure → rollback persisted flag
```

### 分栏点击

```text
click folder in column N
  └─ select item + replace branch after N

click file in column N
  └─ select file + close every descendant column after N
```

### 传输管理器

```text
tasks queued/running/cancelling
  └─ stay open and poll

all tasks finished or no tasks
  └─ start 1500ms close countdown
       ├─ mousemove → restart countdown
       └─ timeout   → close modal
```

## 14.7 失败模式与排查

| 现象 | 根因 | 修复 |
|---|---|---|
| 用户认为“液态玻璃只是毛玻璃” | Web CSS 玻璃无法折射桌面，只能模糊 WebView 背景 | 改用 `tauri-plugin-liquid-glass`，不支持时明确关闭而非伪装 |
| 开右侧简介后点击子栏文件没反应 | `fileLookup` 只收录当前目录，不收录 column cache | `selectableFiles` 合并当前层和 `columnFilesCache` |
| 点击同列普通文件后旧子栏还在 | 文件点击没有裁剪 `columnPaths` 后代 | 新增 `resolveColumnPathsAfterFileSelection` 并补测试 |
| 父文件夹和普通文件同时高亮 | branch path 高亮与 `selectedFileIds` 混用 | `isColumnBranchSelected` 与真实 selection 分开 |
| 同页面拖入文件夹却提示不能拖入 Finder | dragEnd fallback 没区分本地 drop 是否已处理 | `localFileDropHandledRef` 标记本地处理，Finder 提示只做离开 webview 的兜底 |
| 左下角存储比例明显不对 | `df /` 读到 System snapshot，不是 Data volume | 根卷优先用 `diskutil info -plist /System/Volumes/Data` |
| 简介大小显示“点击查看简介以统计” | 大小统计绑定在手动简介动作上，不是 inspector 生命周期 | 根据 `inspectorPath` 自动调用 `get_dir_size` |
| 传输管理器结束后一直挡住界面 | 完成态没有自动关闭策略 | 任务完成后倒计时关闭，鼠标活动重置 |
| “替身”变成文件系统链接 | 直接映射 Finder alias/symlink 语义 | 改为真实复制并加 `-替身` 后缀 |

## 14.8 SOP

改这些域时按下面顺序走：

```bash
npm test -- src/__tests__/column-navigation.test.ts
npm run lint
npm run lint:readme
npm run lint:i18n
npm run lint:ci-gates
npm test
npm run test:rust
npm run lint:rust
npm run build
```

发布前额外核对：

```bash
jq -r '.version' package.json package-lock.json src-tauri/tauri.conf.json
awk -F ' *= *' '/^version = / { gsub(/"/, "", $2); print $2; exit }' src-tauri/Cargo.toml
git tag --list 'v0.4.2'
```

## 14.9 经验教训

1. 文件管理器的视觉 bug 往往是状态源 bug。先找 selection、branch、cache、task 的 owner，再调 CSS。
2. 分栏模式必须把“打开的路径分支”和“真实选中项”分开；否则任何视觉高亮都会变成多选错觉。
3. 原生 Liquid Glass 不是 Web CSS 能补出来的。Web 研究文档可以帮助理解折射，但桌面像素折射必须交给 OS 或原生渲染层。
4. macOS 根卷容量不能直接信 `/` 的 `df` 结果；APFS Data/System 拆分后，用户看到的“磁盘占用”应以 Data 容器为主。
5. 传输 UI 要跟任务生命周期绑定。同步 copy/move 只适合需要立即结果摘要的内部调用，用户可见批量操作应使用 transfer task。
6. `v4.0.1` 已进入历史 tag，但产品 release 线继续按 `0.x` 管理；发版前必须同时看 tag 历史和 updater 版本比较风险。

## 14.10 未来扩展

- 如果未来要上 App Store，需要重新评估 `macos-private-api` 和 `tauri-plugin-liquid-glass`，可能要退回公开 Vibrancy 或自研 Metal。
- 分栏导航如果继续增长，应把 `ExplorerView` 中的 column 渲染拆出独立组件，但路径状态 owner 仍保留在 `column-navigation.ts`。
- 权限 preflight 当前是 best-effort；若要做到完整首启引导，需要单独设计系统权限向导，而不是在文件操作中继续堆提示。
