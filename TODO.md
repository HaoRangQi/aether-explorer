# Aether Explorer 路线图

> 最后整理：2026-05-23
> 定位：macOS 本地优先文件工作台，公益分发，不做商业化，不把 Developer ID 签名 / 公证作为当前路线阻塞项。
> 维护规则：完成后划 `[x]`；新增任务按阶段插入；涉及设计背景时引用 `docs/`。

## 一、当前分支目标

当前分支：`codex-fix-review-findings`

- [x] 文件操作安全补强：`replace` 失败恢复、后端文件名校验、解压不覆盖已有文件
- [x] AI API Key 不再写入 `localStorage`
- [x] 收窄 `shell` capability，保留实际需要的 `shell.open`
- [x] 结构化错误基础：Rust 端错误分类，前端统一规范化显示
- [x] 路线图和功能文档状态对齐

## 二、近期原则

1. **不污染主分支**：所有实验和修复都在功能分支完成，验证后再合并。
2. **用户信任优先**：不丢文件、失败可解释、操作可撤销，比新功能更重要。
3. **Finder 增强而非替代**：补齐重度用户高频工作流，但不承诺成为默认文件管理器。
4. **公益分发**：不规划付费墙、订阅、企业版；优先让更多人能安全使用。
5. **先深后宽**：继续加功能前，先把 `ExplorerView.tsx`、`SettingsView.tsx`、`src-tauri/src/lib.rs` 的浅 Module 拆深。

## 三、P0：信任与安全

- [x] AppleScript / shell 命令注入修复
- [x] `shell.open` 协议白名单
- [x] CSP 配置 + 敏感文件预览黑名单
- [x] `prompt()` 替换为 dialog + 路径 canonicalize
- [x] Updater endpoint 加固 + release notes
- [x] 隐私与外发请求说明：`docs/PRIVACY.md`
- [x] 文件传输写入临时路径并原子提交；失败 / 取消清理半成品，替换失败可恢复旧目标
- [x] 解压前检测输出冲突，避免静默覆盖
- [x] 后端拒绝路径穿透式文件名
- [x] `prefers-reduced-motion` 第一轮收口：CSS 动画降级、motion/react 遵从系统设置、Loader / 进度动画静态化
- [x] 结构化错误基础：`PermissionDenied` / `NotFound` / `DiskFull` / `Busy` / `InvalidPath` / `Conflict` / `Cancelled` / `TrashUnsupported` / `Internal`
- [x] 将剩余 Tauri commands 逐步迁移到结构化错误返回
- [x] Rust panic hook + 本地日志落盘到 `~/Library/Logs/Aether Explorer/`
- [x] 设置页诊断入口：复制脱敏诊断信息、打开日志目录、读取最近崩溃日志
- [x] 设置页诊断入口可打开 Tauri `settings.json` 所在配置文件夹
- [x] 启动后发现新的崩溃日志时提示查看诊断页
- [x] 设置导入前 schema 校验，拒绝危险扩展配置
- [x] 设置备份恢复本轮收口：导出 schema 版本、页面内导入错误、二次确认重置全部配置

暂不纳入当前阻塞项：

- Developer ID 签名 / notarization
- App Store 发布
- 商业化、订阅、企业团队功能

## 四、P1：重度用户核心体验

### Finder 级基础工作流

- [x] 复制 / 剪切 / 粘贴（内部剪贴板）
- [x] 键盘上下选择文件
- [x] `?` 快捷键 cheatsheet：窗口 / 导航 / 选择 / 文件 / 视图 / 工具快捷键集中展示
- [x] Cmd+W 关闭当前标签页
- [x] Quick Look 空格预览开关
- [x] 文件拖入文件夹（同窗口）
- [x] 原生菜单栏：文件 / 编辑 / 显示 / 帮助
- [x] 完整快捷键：`Cmd+C/V/X/Delete/I/N/W/R`、方向键、Enter、Escape
- [x] Finder → Aether 拖入稳定化
- [x] Aether → Finder 拖出方案验证
- [x] 外部文件变更自动刷新

### 文件传输

- [x] 真实传输管理器基础：后端异步任务队列、轮询快照、Finder 拖入复制任务接入
- [x] 大文件复制 / 移动进度回调：后台传输任务使用分块复制并持续更新字节进度
- [x] 取消传输任务：支持单任务 / 全部取消的 cooperative cancellation，取消复制时清理临时文件 / 目录
- [x] 将粘贴复制、复制到、冲突弹窗后的复制、移动到菜单迁移到传输任务
- [x] 将剪切粘贴、拖拽移动、跨窗口移动等高风险移动入口迁移到传输任务
- [x] 冲突策略统一：跳过 / 替换 / 保留两者
- [x] 传输任务结果区分 `skippedSameDir` 与 `skippedConflicts`，并纳入 smoke test 验收
- [x] 复制目录时符号链接按链接本身复制，不递归跟随目标
- [x] 跨设备移动时默认复制，并清晰提示
- [x] 单次操作 paths > 5000 时二次确认

### 预览与信息

- [x] 文本预览敏感文件保护
- [x] 文件夹大小统计
- [x] PDF 首页预览
- [x] 视频缩略图 + 时长
- [x] 文件属性详情面板
- [x] 标签与收藏信息统一展示

## 五、P2：性能与架构

### 性能

- [x] 列表虚拟滚动恢复
- [x] `list_directory` 去掉 N+1 `child_count`
- [x] 应用图标批量更新
- [x] file item 去掉高成本 hover motion
- [x] `list_directory` 改 `spawn_blocking` 异步执行
- [x] 目录加载前端取消令牌，快速切目录时阻止旧请求回写
- [x] 后端目录扫描可中断，避免旧 `spawn_blocking` 任务继续占用线程
- [ ] 超大目录分批返回或分批渲染
- [x] `fileById` Map，避免 `selectedFiles` / `lastSelectedFile` O(n) 查找
- [x] 搜索 debounce 150ms
- [ ] inactive tab unmount 或状态提升
- [x] 缩略图 / app icon LRU 缓存

### 架构

- [ ] 拆 `ExplorerView.tsx`：
  - `ExplorerShell`
  - `FileListView`
  - `GridView`
  - `ColumnView`
  - `ContextMenu`
  - `PreviewPanel`
  - `useExplorerState`
- [ ] 拆 `SettingsView.tsx`：
  - 外观
  - 文件行为
  - 右键扩展
  - AI provider
  - 权限与诊断
- [ ] 拆 `src-tauri/src/lib.rs`：
  - `commands/fs.rs`
  - `commands/window.rs`
  - `commands/terminal.rs`
  - `commands/disk.rs`
  - `error.rs`
- [ ] 建立 `filesystem-core` 深 Module：文件操作、冲突策略、结构化错误、传输任务统一封装
- [ ] 建立 `settings-store` Module：schema、迁移、脱敏、导入导出

## 六、P3：差异化公益功能

- [ ] `Cmd+K` 命令面板：打开路径、切换视图、触发文件操作
- [ ] 暂存夹板 Stack：跨目录收集文件后统一操作
- [ ] 智能文件夹：保存搜索条件，优先基于 `mdfind`
- [ ] 双窗格视图：左右目录比较、复制、移动
- [ ] AI 文件助手升级：
  - dry-run
  - 风险分级
  - 操作范围限制
  - 批量撤销
  - 审计日志

## 七、测试与发布卫生

- [x] Vitest + jsdom：当前 14 个测试文件、129 个用例通过
- [x] Rust `cargo test --lib`：当前 81 个单元测试通过
- [x] `window.__aether.smoke()` 自检
- [x] release/test gate：lint / README sync / i18n / CI gate / Vitest / Rust test / clippy / build，并覆盖声明的 push 分支与 PR 到 `main`
- [x] release 前清理旧构建产物，并为 versioned release 上传 / 验收 `SHA256SUMS`
- [x] Vite manualChunks 拆包：主入口 chunk 约 683 KB → 约 258 KB
- [ ] 组件级测试覆盖 Explorer 关键工作流
- [ ] Tauri command 集成测试
- [x] ESLint 接入 CI：`lint:eslint` + `npm run lint` 串联 TypeScript / ESLint + `lint:ci-gates`
- [x] ExplorerView `react-hooks/exhaustive-deps` warning 清零，并将规则升级为 error 防回退
- [x] clippy 接入 CI：`lint:rust` + test / release workflow + `lint:ci-gates`
- [x] `SECURITY.md` / `CONTRIBUTING.md` / GitHub issue templates
- [x] README 中英文自动同步检查
- [x] 第一批 i18n 收口：ExplorerView 高风险路径 + `lint:i18n`
- [x] AI 文件助手面板 i18n 收口：`aiRename.*` + `lint:i18n`
- [x] SettingsView i18n 后续收口：分类 / 页头 / 权限 / 扩展 / 清理缓存高风险文案 + `lint:i18n`
- [ ] `CHANGELOG.md` / `SECURITY.md` / `CONTRIBUTING.md` 定期维护

## 八、暂缓或不做

- 不做默认文件管理器
- 不做 App Store
- 不做商业化订阅
- 暂不做 Developer ID 签名 / 公证
- 暂不做云同步
- 暂不做团队协作
- 暂不做完整插件市场；先做受限扩展和命令模板

## 文档索引

| 文档 | 内容 |
|------|------|
| `docs/RELEASE_AUDIT.md` | 安全与发版风险审计 |
| `docs/PERF_PLAN.md` | 性能瓶颈与治理计划 |
| `docs/PRIVACY.md` | 隐私与外发请求说明 |
| `docs/IMPROVEMENT_PROPOSALS.md` | 架构、产品和长期体验建议 |
| `docs/CROSS_WINDOW_DRAG.md` | 跨窗口拖拽设计 |
| `docs/TEST_PLAN.md` | 测试策略 |
| `docs/SMOKE_TEST.md` | 手工和控制台自检 |
| `FEATURES.md` | 功能规格 |
| `PROJECT.md` | 项目总览 |
