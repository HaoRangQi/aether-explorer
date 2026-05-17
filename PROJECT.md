# Aether Explorer — 项目总览

macOS 平台文件管理器 | Tauri v2 + React 19 + TypeScript + Rust

## 当前进度

**M1 基础架构与窗口外壳** ✅ 完成 (13/13)  
**M2 文件系统与视图模式** ✅ 完成 (10/10)  
**M3 文件操作与交互** ✅ 可验收版本完成 (19/19)  
**M4 预览与侧边栏** ✅ 可验收版本完成，外接磁盘/真实传输进度待增强  
**M5 设置与原生集成** ✅ 可验收版本完成，Dock/发布链路待增强

```
M1 ████████████████ 100%  基础架构与窗口外壳
M2 ████████████████ 100%  文件系统接入 + 视图模式
M3 ████████████████ 100%  文件操作与交互（可验收版）
M4 ██████████████░░  85%  预览面板与侧边栏（可验收版）
M5 ████████████░░░░  75%  设置系统与原生集成（可验收版）
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

### M3 — 文件操作与交互 ✅ (19 项，可验收版)

详见 [FEATURES.md](FEATURES.md) Tier 4 + Tier 5

### M4 — 预览与侧边栏 ⚠️ (骨架可用)

详见 [FEATURES.md](FEATURES.md) Tier 6 + Tier 7 + Tier 8

### M5 — 设置与原生集成 ⚠️ (骨架可用)

详见 [FEATURES.md](FEATURES.md) Tier 9 + Tier 10 + Tier 11

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
- **毛玻璃**: CSS backdrop-filter（非原生 NSVisualEffectView）
- **窗口**: 无边框透明 + macOSPrivateApi
- **拖拽**: 顶部原生拖拽区域 + JS `startDragging()` + Rust `start_window_drag` 兜底
- **发布**: GitHub Release，不上架 App Store
- **云同步/加密/AI**: 本期不做，后续扩展

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
