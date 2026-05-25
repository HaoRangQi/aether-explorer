# Changelog

所有版本的重要变更记录。格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)。

## [Unreleased]

### 新增
- 设置页“关于”新增诊断与反馈入口：支持复制脱敏诊断信息、打开本地日志目录、打开配置文件夹、读取最近 Rust 崩溃日志，并保持本地优先、不自动上传。
- 启动后若发现新的 Rust 崩溃日志，会提示用户打开诊断页查看；提示确认后记录日志指纹，避免重复打扰。
- 新增 `?` 快捷键列表弹窗，集中展示窗口、导航、选择、文件操作、视图和工具类快捷键。
- 设置备份恢复新增版本化 JSON schema，并提供二次确认的“重置全部配置”入口。

### 改进
- AI 文件助手面板接入 `aiRename.*` 国际化命名空间，标题、预设、占位符、错误提示、操作类型和执行进度支持中英文切换。
- `lint:i18n` 扩展覆盖 `AIRenamePanel` 高风险用户可见文案，避免后续回退成硬编码中文。
- `lint:i18n` 继续覆盖 `SettingsView` 的分类、页头、权限、扩展和清理缓存高风险文案。
- 新增 `lint:eslint`，并让 `npm run lint` 串联 TypeScript 与 ESLint，覆盖前端 `console`、浏览器 `prompt/alert/confirm` 和基础 Hooks 风险门禁。
- 分批收口 `react-hooks/exhaustive-deps` 历史 warning，先稳定 App 快捷键关闭标签页、Explorer 路径映射、收藏 / 最近 / 标签解析、应用图标 hydration 和分组 helper 链路。
- ExplorerView 拖拽、外部导入、键盘快捷键和刷新链路的 `react-hooks/exhaustive-deps` warning 已清零，并将该规则升级为 error 门禁防回退。
- Vite production build 增加 `manualChunks`，拆出 React、Tauri、icons、i18n 和通用 vendor chunk，主入口 chunk 从约 683 KB 降到约 258 KB。
- 新增 `lint:rust`，并把 `cargo clippy --lib -- -D warnings` 接入 test / release workflow 与 `lint:ci-gates`。
- `?` 快捷键帮助在输入框、重命名和路径编辑时不会触发，避免打断用户输入。
- 减少动态效果兼容性收口：CSS 动画、motion/react 弹窗 / 面板、Loader、传输进度和存储圆环会尊重系统 reduced-motion 设置。
- 配置导入 / 导出 / 重置改为设置页内状态反馈，导入失败不再使用 `alert`。
- 配置和右键扩展导入复用 sanitizer：过滤畸形 / deprecated / 重复扩展、危险或空白 URL 模板，规范化 `id` / `label` / `workingDirectory`，校验导入枚举值，并强制 terminal / shell 扩展保留执行确认。
- 设置导入 / 重置 / 扩展删除确认迁移到 Tauri dialog，避免继续使用浏览器 `confirm`。
- release 流程在打包前清理旧 `dist` / Tauri bundle，并为 versioned release 上传和远程验收 `SHA256SUMS`。

### 文档
- 新增 `SECURITY.md`、`CONTRIBUTING.md` 与 GitHub issue templates，补齐公益社区维护入口。
- 校准审计、路线图和 smoke 文档中已经过期的完成状态。
- 发版门禁补齐 production build smoke，并新增 `lint:ci-gates` 防止 CI / release 关键检查被误删、关键 npm scripts 退化为空命令、Codex 工作分支失去 CI 触发、release job 绕过 `test-gate` 或发布版本一致性校验退化。

## [0.3.11] - 2026-05-23

### 修复
- 受保护目录下关闭自动图片缩略图、应用图标解析、文本与 PDF 预览，避免进入子目录时继续触发 macOS 权限请求。
- 预览面板在受保护目录中改为明确提示“已关闭自动预览”，不再一边提示一边继续偷偷读文件。

## [0.3.10] - 2026-05-21

### 新增
- macOS 原生应用菜单与状态栏菜单：支持显示主窗口、新建窗口、重新加载窗口、检查更新和退出。

### 修复
- 受保护目录访问改为用户明确继续后再读取，减少启动和导航时的 macOS 权限弹框。
- 同一会话内记住已确认访问的下载、文稿、桌面、iCloud Drive、废纸篓根目录，避免每进一层都重复提示。
- 目录读取错误分型为权限拒绝、路径不存在、普通读取失败，避免所有失败都误导为完全磁盘访问问题。

### 文档
- 沉淀法典 11（AI 文件助手系统）、12（macOS TCC 权限管理）、13（文件操作 UX）

## [0.3.9] - 2026-05-20

### 新增
- 图标组自定义 Tooltip，鼠标悬停立即显示（75ms），替代浏览器原生 title 的 500ms+ 延迟
- 新建窗口按钮移入中间图标组，tooltip 标注"新建窗口 (⌘N)"，删除标签区误导性的 + 按钮

### 修复
- 新建文件/文件夹后菜单不消失
- 重命名时双击不再触发打开文件/进入文件夹
- 重命名时禁用文件拖动，输入框可正常选中文字
- 新建文件/文件夹后精确定位：先按 index 计算偏移滚动，再 requestAnimationFrame 重试 scrollIntoView
- 文件展示区滚动条深色模式背景白色：改用 custom-scrollbar
- 深色模式背景 fallback 修正（html.dark 规则）
- 配置导出/导入：注册 tauri-plugin-fs，加 fs/dialog:save 权限
- 权限检查改为手动触发，不再启动时自动访问受保护目录

## [0.3.8] - 2026-05-20

### 修复
- 导航栏滚动条在正式版中始终可见：改用 `scrollbar-hide` 完全隐藏，内容仍可滚动

## [0.3.7] - 2026-05-20

### 修复
- macOS 每次启动重复弹权限框：添加 `NS*UsageDescription` 到 Info.plist，TCC 授权后不再重复请求
- 清理 Entitlements.plist 中无效的 `com.apple.security.files.all` key

## [0.3.6] - 2026-05-20

### 新增
- AI 文件助手：支持 rename / mkdir / move / trash / compress 五种操作，AI 生成操作计划，用户确认后执行
- AI 操作历史：记录每次 AI 操作，支持一键回滚（rename/move/mkdir 可自动回滚，trash 提示手动恢复）
- AI 服务支持多 provider 并存（Claude / OpenAI 中转站 / Ollama），独立设置页管理
- 模型列表从 API 自动拉取，自定义下拉选择，支持搜索过滤
- AI 文件助手无需选中文件即可触发，未选中时操作当前目录所有文件
- AI 文件助手 / AI 操作历史作为系统内置扩展，在右键菜单扩展设置中可启用/禁用
- 配置导出/导入：主题、收藏夹、文件标签、最近使用一键备份恢复
- 底部状态栏开发环境标识（仅 dev 模式显示）

### 修复
- 滚动条样式统一：导航栏仅 hover 时显示，设置/存储页使用半透明细滚动条
- AI 请求加 30s 超时，卡死不再无限转圈
- AI API Key / Base URL 自动清理不可见字符，修复 `The string did not match the expected pattern` 报错
- 修复 `Maximum call stack size exceeded`（fetchWithTimeout 递归调用自身）

### 变更
- AI 批量重命名升级为通用 AI 文件助手，单个文件也可操作
- 删除 `AI 智能扫描` 占位扩展，替换为真实可用的 AI 文件助手和 AI 操作历史
- 右键菜单（空白/文件）、工具栏更多菜单均保留 AI 入口

## [0.3.5] - 2026-05-19

### 新增
- 深浅色默认主题：浅色竹青 `#789262` / 深色黛蓝 `#425066`，切换模式自动应用对应强调色
- 渐变背景开关（默认关闭），纯色背景浅 `#FCFCFD` / 深 `#1E1E2E`
- 主背景色细化控制项 `colorAppBg`，用户可自定义纯色背景
- 列表视图：修改时间显示到秒，附带相对时间标签（刚刚 / N 分钟前 / 今天 / 昨天等）
- 列表视图：更多菜单新增「显示勾选框 / 显示排序」开关，勾选框支持全选
- 终端脚本支持逐条禁用不删除
- macOS Entitlements 关闭 App Sandbox，解决反复弹权限确认
- AI 批量重命名：选中多个文件后通过右键菜单 / 工具栏 / `⌘⇧R` 触发，输入自然语言意图，AI 生成预览后确认执行
- AI 服务独立设置页：支持多 provider 并存（Claude / OpenAI 中转站 / Ollama 本地），每个 provider 独立配置 API Key、Base URL、模型
- 模型列表从 API 自动拉取，自定义下拉选择组件，支持搜索过滤
- Base URL 下方实时预览完整请求 URL，测试连接内联反馈

### 修复
- 壁纸设置后模糊不清：去掉多余遮罩层，壁纸清晰显示
- 终端启动脚本不执行：`validate_shell_fragment` 拒绝 `&&`，改为后端逐条验证后安全拼接
- 非 Terminal/iTerm 终端（Warp、Ghostty 等）无法执行启动脚本：通过临时脚本文件传递命令
- 右键菜单无法通过点击外部区域关闭
- 导航栏滚动条在非 hover 区域也显示
- Sidebar TS 类型错误：移除 RightElement 残留引用

### 变更
- 导航栏「文稿」去掉 Cloud 图标
- 去掉「查看全部」按钮
- 关于页面整理：去掉冗余小卡片和重复文字
- `terminalScripts` 数据结构从 `string[]` 迁移为 `{script, enabled}[]`（自动兼容旧数据）
- 切换深浅色模式自动应用对应默认强调色（不再需要手动恢复默认）

## [0.3.0] - 2025-05-18

### 新增
- 颜色细化控制系统（14 项）：图标、选中、悬浮、面板、文字、边框等独立可调
- 颜色细化控制实时预览面板
- 空白右键「设为首页」功能
- 默认首页可配置（我的收藏 / 任意目录）

### 修复
- 打开方式子菜单样式不一致
- 分栏横向滚动 + 虚拟滚动第二处 list 视图
- 颜色重置后立即生效
- CSS 变量循环引用
- 启动定位收藏 + 标签页语义化 label
- 默认主页全链路统一

### 变更
- 颜色细化控制面板重新设计（单色块 + 紧凑排列）
- 组件颜色全面替换为 CSS 变量驱动

## [0.2.1] - 2025-05-15

### 新增
- 跨窗口拖拽（Aether↔Aether + Finder→Aether）
- 跨窗口拖拽自动置顶 + 松手即生效语义
- 跨窗口拖拽 banner 与设置项
- 空格预览改为真开关
- 桌面壳文件展示体验完善

### 修复
- 发布资产命名与验收流程修正

## [0.2.0] - 2025-05-14

### 新增
- P0 安全红线修复（命令注入 / shell.open / CSP / 路径遍历 / Updater 签名）
- 性能高优修复（虚拟滚动、懒加载、缓存策略）
- 测试基础设施 + 首批 67 个测试用例
- CI test workflow + 本地 release.sh test gate
- Updater 签名密钥切换

## [0.1.1] - 2025-05-12

### 新增
- 拖拽文件移动功能
- 收藏与标签系统
- 默认主页可配置 + 右键打开方式子菜单
- 完整国际化支持（对话框、操作反馈、图标注释）
- 在线更新框架（Updater + GitHub API）
- 终端脚本配置
- 侧边栏单击定位 / 双击新建标签
- 右键复制粘贴、显示简介、文件夹大小统计、键盘导航

### 修复
- 侧边栏主页单击不再重复新建标签
- 多窗口拖拽与右键菜单行为修正
- Release 流水线与 updater 产物修正
