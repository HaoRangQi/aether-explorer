# Aether Explorer — 项目总览

macOS 本地优先文件工作台 | Tauri v2 + React 19 + TypeScript + Rust

## 项目定位

Aether Explorer 是面向 macOS 重度用户的 Finder 增强工具，而不是系统默认文件管理器替代品。

- **本地优先**：文件、设置、标签和 AI 操作历史默认保存在本机。
- **公益分发**：不规划商业化、订阅、企业版或付费墙。
- **信任优先**：文件操作必须可解释、可恢复、可审计；不以新功能牺牲数据安全。
- **渐进增强**：先补齐 Finder 高频工作流，再做命令面板、暂存夹板、智能文件夹等差异化能力。
- **当前暂缓**：Developer ID 签名 / notarization、App Store、云同步、团队协作。

## 当前进度

**M1 基础架构与窗口外壳** ✅ 完成 (13/13)  
**M2 文件系统与视图模式** ✅ 完成 (10/10)  
**M3 文件操作与交互** ✅ 核心工作流可验收，已知限制继续跟踪
**M4 预览与侧边栏** ✅ 可验收版本完成，外接磁盘自动刷新与快速访问待增强
**M5 设置与原生集成** ✅ 可验收版本完成，Dock/发布链路待增强
**M6 信任、错误处理与架构治理** 🚧 进行中

```
M1 ████████████████ 100%  基础架构与窗口外壳
M2 ████████████████ 100%  文件系统接入 + 视图模式
M3 ████████████████ 100%  文件操作与交互（核心工作流可验收）
M4 ██████████████░░  85%  预览面板与侧边栏（可验收版）
M5 ████████████░░░░  75%  设置系统与原生集成（可验收版）
M6 ████░░░░░░░░░░░░  25%  文件安全 + 结构化错误 + 模块治理
```

## 执行方案

### M1 — 基础架构与窗口外壳 ✅ (13 项，4 个任务，2 波)

| 任务 | 功能 | 状态 |
|------|------|------|
| TASK-001 Tauri 项目脚手架 | 0.1-0.5 初始化/构建/Rust骨架 | ✅ |
| TASK-002 窗口管理与 Mica | 1.1-1.3 无边框窗口/拖拽/毛玻璃 | ✅ |
| TASK-003 主题系统迁移 | 1.4-1.5 深浅色/强调色/持久化 | ✅ |
| TASK-004 个性化设置 | 1.6-1.8 壁纸/字体/语言 | ✅ |

### M2 — 文件系统与视图模式 ✅ (10 项)

详见 [FEATURES.md](FEATURES.md) Tier 2 + Tier 3

### M3 — 文件操作与交互 ✅ (核心工作流可验收)

详见 [FEATURES.md](FEATURES.md) Tier 4 + Tier 5；已知限制继续在 [BUG.md](BUG.md) 跟踪。

### M4 — 预览与侧边栏 ⚠️ (骨架可用)

详见 [FEATURES.md](FEATURES.md) Tier 6 + Tier 7 + Tier 8

### M5 — 设置与原生集成 ⚠️ (骨架可用)

详见 [FEATURES.md](FEATURES.md) Tier 9 + Tier 10 + Tier 11

### M6 — 信任、错误处理与架构治理 🚧

| 任务 | 功能 | 状态 |
|------|------|------|
| 文件操作安全 | 替换失败恢复、文件名后端校验、解压冲突保护 | ✅ |
| 设置安全 | AI API Key 不写入 localStorage | ✅ |
| 结构化错误基础 | Rust `AppError` + 前端 `AetherAppError` 规范化 | ✅ |
| 文档路线对齐 | 公益定位、非商业化、暂缓签名公证 | ✅ |
| 模块拆分 | Explorer / Settings / Rust commands 深 Module 化 | ⏳ |
| 异步目录加载 | `list_directory` spawn_blocking + cooperative cancellation + 旧请求回写保护 | ✅ |

## 已知 Bug

| ID | 标题 | 严重度 | 状态 |
|----|------|--------|------|
| ISS-001 | 窗口拖拽移动无效 | high | fixed |
| ISS-002 | 窗口圆弧未生效 | medium | in-progress |
| ISS-003 | 跨窗口拖拽底层窗口置顶不可靠 | medium | known-limitation |
| ISS-004 | 分栏模式预览框 | medium | open |
| ISS-005 | 打开方式子菜单背景与父菜单不完全一致 | low | known-limitation |

详见 [BUG.md](BUG.md) 与 [codex/scratch.md](codex/scratch.md)。

## 关键决策

- **持久化**: Tauri Store 为主，localStorage 降级
- **密钥处理**: AI API Key 不写入 localStorage；后续评估系统 Keychain
- **毛玻璃**: CSS backdrop-filter（非原生 NSVisualEffectView）
- **窗口**: 无边框透明 + macOSPrivateApi
- **拖拽**: 顶部原生拖拽区域 + JS `startDragging()` + Rust `start_window_drag` 兜底
- **错误处理**: 新增结构化 `AppError`，旧字符串错误逐步迁移
- **发布**: GitHub Release，不上架 App Store；暂不把 Developer ID 签名 / notarization 作为当前阻塞项
- **商业化**: 不做商业化，按公益项目维护
- **云同步/团队协作**: 本期不做，后续仅在不破坏本地优先前提下评估

## 快速命令

```bash
npm run dev          # 前端开发
npx tauri dev        # Tauri 开发（前端 + Rust）
npx tauri build      # 生产构建 → .app + .dmg
```

## 文件导航

```
aether-explorer/
├── PROJECT.md              # ← 你在这里
├── src/                    # React 前端
│   ├── components/         # UI 组件
│   ├── i18n/               # 中英文翻译
│   └── App.tsx             # 主入口
├── src-tauri/              # Tauri/Rust
│   ├── src/lib.rs          # Rust 后端
│   ├── tauri.conf.json     # 窗口配置
│   └── capabilities/       # 权限声明
└── .workflow/              # 工作流数据
    ├── state.json          # 项目状态注册表
    ├── issues/issues.jsonl # Bug 追踪
    └── scratch/tier-01/    # M1 执行产物
```
