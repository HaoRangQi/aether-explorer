# 07 桌面壳与文件展示体验 (Desktop-Shell-File-Experience)

**状态**: ✅  **首次落地**: [2026-05-15]  **最近更新**: [2026-05-15]  **域**: 桌面 app 启动、系统目录语义、真实文件图标、网格展示与文件状态细节

← 返回 [索引](./README.md)

## 07.1 一句话总结

这轮把“像网页一样能跑”推进到“像桌面文件管理器一样可信”：Tauri dev 端口自动避让，应用程序展示真实 app 图标，默认主页与系统主目录拆开，网格多媒体尺寸可控，外置磁盘弹出与隐藏文件样式补齐。

## 07.2 决策与权衡

| 决策点 | 旧行为 / 风险 | 新行为 | 选择原因 |
|---|---|---|---|
| `.app` 图标 | 应用程序页显示默认文件夹图标 | 后端解析 `.app` 图标并导出 PNG 缓存，前端异步补齐 | Finder 语义必须靠真实程序图标建立信任 |
| app 图标加载时机 | 目录列表阶段同步解析重资源 | 列表先返回基础信息，Explorer 按并发限制异步补 icon | 避免从收藏页进入大目录时卡死 |
| 默认主页 vs 系统 home | 侧栏“主页”和 app 默认页混用 | 侧栏改名“主目录”，永远指向系统 home；启动默认页由设置控制 | 避免点“主页”却进入收藏页的语义错位 |
| dev 端口 | 固定常见端口，冲突时启动失败或壳连错 | 从 `41873` 起探测可用端口，并生成临时 Tauri config | 保证桌面壳和 Vite 使用同一个实际端口 |
| 多媒体网格 | 图片 / 视频卡片尺寸固定偏大 | 默认跟随普通网格，“更多”里可独立调宽高 | 默认不破坏密度，高级需求保留控制权 |
| 隐藏文件 | 显示隐藏文件时与普通文件完全同色 | `.` 开头文件名与元信息置灰 | 用户能快速区分系统/隐藏项 |
| 外置磁盘弹出 | 点击弹出图标会冒泡进入目录 | 弹出按钮隔离 pointer/mouse/click/doubleClick 事件 | 图标按钮应执行弹出，不应触发行导航 |

**不变量：**

1. `aether://favorites` 仍可以作为 app 启动默认页，但侧栏“主目录”不再受 `theme.defaultHomePath` 影响。
2. `.app` 图标缓存是性能优化，不是文件数据源；缓存失败时仍应展示基础文件项。
3. `npm run dev` 必须启动桌面 app 壳，并保证 Tauri `devUrl` 与 Vite 实际监听端口一致。
4. 隐藏文件只是视觉弱化，不改变选择、右键、打开、拖拽等文件操作语义。

## 07.3 实现拓扑

```
npm run dev
   ↓ scripts/dev.mjs probes 41873..41972
temp tauri.dev.json
   ↓ build.devUrl + beforeDevCommand(port)
Tauri desktop shell ─────→ Vite frontend

ExplorerView
   ├─ listDirectory(path)        -> fast base entries
   ├─ hydrateAppIcons(entries)   -> getAppIcon(path), concurrency 4
   ├─ viewPathMap.desktop/home   -> system homeDir
   ├─ grid size                  -> max(normal grid, media grid)
   └─ renderFileItem             -> hidden file gray classes

Rust backend
   ├─ find_app_icon_path(.app/Contents/Info.plist)
   ├─ convert_icns_to_png()
   ├─ export_workspace_app_icon()
   └─ ~/Library/Caches/Aether Explorer/AppIcons/*.png
```

## 07.4 关键文件 & 行号

| 文件 | 锚点 | 说明 |
|---|---|---|
| `scripts/dev.mjs` | `:7` | 从 `AETHER_DEV_PORT` / `VITE_DEV_PORT` / `41873` 选择起始端口 |
| `scripts/dev.mjs` | `:24` | 从起始端口向后探测可用端口 |
| `scripts/dev.mjs` | `:31` | 生成临时 Tauri config，写入实际 `devUrl` 与 Vite 端口 |
| `package.json` | `:7` | `npm run dev` 进入桌面壳启动脚本 |
| `vite.config.ts` | `:22` | Vite 默认端口改为 `41873`，允许被脚本覆盖 |
| `src-tauri/tauri.conf.json` | `:8` | 静态 devUrl 默认值，同脚本首选端口一致 |
| `src-tauri/src/lib.rs` | `:125` | `find_app_icon_path()` 从 `.app` 包解析图标源 |
| `src-tauri/src/lib.rs` | `:173` | `app_icon_cache_dir()` 定义 app 图标 PNG 缓存目录 |
| `src-tauri/src/lib.rs` | `:241` | `convert_icns_to_png()` 将 `.icns` 转为前端可用 PNG |
| `src-tauri/src/lib.rs` | `:257` | `resolve_app_icon_png()` 统一 icon 解析、缓存和 fallback |
| `src-tauri/src/lib.rs` | `:285` | Tauri command `get_app_icon` |
| `src/api/filesystem.ts` | `:51` | 前端 `getAppIcon(path)` API |
| `src/components/ExplorerView.tsx` | `:211` | `hydrateAppIcons()` 异步补齐 app 图标 |
| `src/components/ExplorerView.tsx` | `:473` | `desktop/home` 视图固定映射到系统 `homeDir` |
| `src/components/ExplorerView.tsx` | `:1697` | 隐藏文件识别与置灰 class |
| `src/components/ExplorerView.tsx` | `:1828` | 多媒体网格尺寸默认跟随普通网格，支持独立配置 |
| `src/components/ExplorerView.tsx` | `:3180` | 网格列宽取普通/多媒体尺寸最大值，避免布局溢出 |
| `src/components/SettingsView.tsx` | `:114` | 关于页版本号 state |
| `src/components/SettingsView.tsx` | `:121` | 通过 Tauri `getVersion()` 动态读取版本 |
| `src/components/SettingsView.tsx` | `:788` | 设置 - 网格 - 多媒体项目入口 |
| `src/components/SettingsView.tsx` | `:1521` | 默认主页目录设置项 |
| `src/components/Sidebar.tsx` | `:73` | `getMenuPath()` 不再让主目录跟随 app 默认页 |
| `src/components/Sidebar.tsx` | `:216` | 外置磁盘弹出按钮事件隔离 |
| `src/components/Sidebar.tsx` | `:244` | 侧栏文案改为 `sidebar.homeDirectory` |
| `src/types.ts` | `:74` | `ThemeSettings.mediaGridLinked` 契约 |
| `src/i18n/locales/zh.ts` | `:5` | 中文“主目录”文案 |
| `src/i18n/locales/zh.ts` | `:85` | 中文多媒体网格文案 |
| `src/i18n/locales/en.ts` | `:5` | 英文 “Home Folder” 文案 |

## 07.7 失败模式与排查

| 现象 | 根因 | 修复 |
|---|---|---|
| 应用程序页图标都是默认文件夹 | 前端只拿到普通目录元数据，没有解析 `.app` 包图标 | 后端解析 `.app` icon 并缓存 PNG，前端异步 `getAppIcon()` 补齐 |
| 从收藏页进入目录疑似卡死 | 列表阶段做了过重的同步文件信息解析 | 列表只取基础字段，图标等重信息延后异步加载 |
| 点侧栏“主页”进入“我的收藏” | app 默认页和系统 home 被同一个设置值绑定 | 侧栏改“主目录”并固定 `homeDir`；默认启动页独立设置 |
| 启动桌面壳时端口冲突 | Tauri 静态 devUrl 与 Vite 实际端口可能不一致 | dev 脚本先探测端口，再生成临时 config 同步两边 |
| 点击外置磁盘弹出图标却进入磁盘目录 | 按钮事件冒泡到整行 `onClick` | 弹出按钮吞掉 pointer/mouse/click/doubleClick 事件 |
| 显示隐藏文件后视觉上无法区分 | 隐藏文件和普通文件共用名称 class | `.` 开头项目名称与元信息置灰 |

## 07.8 SOP

### 本地桌面壳启动

```bash
npm run dev
```

期望日志包含：

```text
[aether-dev] using frontend port <port>
```

如果 `41873` 被占用，脚本会自动尝试后续端口；不要手工只启动 `vite` 来验证桌面能力。

### 验证应用程序真实图标

1. 打开 `/Applications`。
2. 等待列表先出现基础项，再观察 `.app` 图标陆续替换为真实图标。
3. 缓存目录应落在 `~/Library/Caches/Aether Explorer/AppIcons`。

### 验证主目录 / 默认主页拆分

1. 设置默认主页为“我的收藏”或自定义目录。
2. 重启 app，首个标签应进入默认主页。
3. 点击侧栏“主目录”，必须进入系统用户目录，而不是 app 默认主页。

## 07.9 经验教训

1. 桌面文件管理器不能用“网页列表”的心态做文件展示。应用程序、隐藏文件、外置磁盘这些系统语义，如果 UI 不跟随，会直接显得不可信。
2. 重 I/O 信息要分层加载：目录打开路径只做必要元数据，图标、扩展属性、最近打开等信息延迟补齐，否则虚拟集合进入真实目录时最容易卡住。
3. “主页”这个词同时指 app 首屏和系统 home 时会制造长期歧义。产品文案要把导航目标和启动策略拆开命名。
4. Tauri dev 不是纯前端 dev server。端口自动避让必须同步写入 Tauri `devUrl`，只让 Vite 自动换端口会让桌面壳连错目标。
5. 小图标按钮嵌在可点击行内时，要把 pointer/mouse/click/doubleClick 都按交互意图隔离；只处理 `onClick` 不足以覆盖双击和按下态。

## 07.10 未来扩展

1. `.app` 图标缓存可以增加清理策略，例如按 mtime 或缓存大小淘汰，避免长期积累。
2. 隐藏文件识别当前以 `.` 前缀为主，未来如要覆盖 Finder 的 `hidden` flag，需要后端补充 macOS 文件标志位。
3. 外置磁盘弹出后可以监听卷列表刷新并给出更明确的成功/失败状态，而不只依赖当前消息提示。
