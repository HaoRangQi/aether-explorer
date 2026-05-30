# Aether Explorer

[**中文**](./README.md) | [**English**](./README_EN.md)

macOS 本地优先文件工作台，基于 Tauri v2 + React 19 + Rust 构建。
定位是 Finder 增强工具，而不是系统默认文件管理器替代品。

<p align="center">
  <strong>随缘关注，有缘更新</strong>
</p>

## 团队

| 角色 | |
|------|-----|
| 舵手 | HaoRanQi |
| 设计师 | Gemini |
| 代码贡献 | DeepSeek · Claude · GPT |

## 截图

### 浅色模式

| 列表视图 | 网格视图 | 分栏视图 |
|:---:|:---:|:---:|
| ![列表视图](assets/images/ae-l-1.png) | ![网格视图](assets/images/ae-l-2.png) | ![分栏视图](assets/images/ae-l-3.png) |

### 深色模式

![深色模式预览](assets/images/ae-d-1.png)

### 设置页面

![设置页面预览](assets/images/ae-settings.png)

## 特性

### 文件浏览
- 真实文件系统操作 — 浏览、打开、复制、移动、重命名、删除（移至废纸篓）
- 三种视图模式 — 列表、网格、Miller Columns 分栏，布局参数可调
- 文件预览 — 图片缩略图、PDF 首页、视频缩略图与时长、文本预览、Quick Look 空格预览
- 搜索与排序 — 实时搜索过滤、多字段排序、按类型/日期分组

### macOS 深度集成
- 原生体验 — 毛玻璃模糊效果、浅色/深色/自动主题、6 种强调色
- Quick Look — 空格键调用系统原生预览
- 废纸篓 — 删除操作只移入废纸篓，不做物理删除
- 终端集成 — 右键在终端打开，支持 Terminal/iTerm 等
- 完全磁盘访问 — 权限引导和结构化错误提示

### 窗口与标签页
- 多窗口 — Cmd+N 新建窗口，跨窗口拖拽标签页
- 标签页管理 — 拖拽分离、跨窗口合并、关闭保护、Cmd+W 关闭标签
- 壁纸背景 — 自定义壁纸 URL 或本地图片，可调模糊度

### 设置与个性化
- 外观 — 主题模式、强调色、字体、透明度、模糊强度
- 右键菜单 — 可配置的扩展菜单，支持自定义终端命令
- 语言 — 中/英双语，默认中文
- 操作历史（AI + 文件操作）— 真分页、按日期/文件名搜索、可配置保留期（默认 7 天，最长 90 天）

## 已知不足

- 传输管理器已接入真实后台任务、进度、取消和冲突摘要；仍需继续打磨系统通知与极端目录性能
- Aether 直接拖出到 Finder 目前只给明确 fallback 提示，原生拖出需要后续 native pasteboard 方案
- 超大目录还需要分批返回或分批渲染，极端目录下仍需性能治理
- 外接磁盘自动刷新、快速访问、AirDrop 入口仍待增强
- 分栏模式下子分栏无法弹出预览框（[BUG.md](./BUG.md)）

完整待办详见 [TODO.md](./TODO.md)。

## 技术栈

| 层 | 技术 |
|---|---|
| 桌面框架 | Tauri v2 |
| 前端 | React 19 + TypeScript |
| 构建 | Vite 6 |
| 样式 | Tailwind CSS 4 |
| 动画 | Motion (Framer Motion) |
| 后端 | Rust |
| 国际化 | i18next |
| 存储 | Tauri Store + localStorage |

## 快速开始

### 环境要求
- macOS 12+
- Node.js 18+
- Rust 工具链（[rustup](https://rustup.rs)）

### 开发

```bash
npm install        # 安装依赖
npm run dev        # 启动前端
npx tauri dev      # 启动 Tauri 桌面应用
```

### 构建

```bash
npm run build      # 构建前端
npx tauri build    # 构建 macOS .app
```

应用包输出在 `src-tauri/target/release/bundle/`。

## 项目结构

```
aether-explorer/
├── src/                    # React 前端
│   ├── components/         # UI 组件
│   │   ├── TopBar.tsx      # 标签栏（拖拽、跨窗口传输）
│   │   ├── Sidebar.tsx     # 侧边栏（导航、收藏）
│   │   ├── ExplorerView.tsx # 文件视图（列表/网格/分栏）
│   │   ├── SettingsView.tsx # 设置面板
│   │   └── TransferModal.tsx # 传输进度
│   ├── i18n/               # 国际化（中/英）
│   ├── types.ts            # 类型定义
│   ├── constants.ts        # 常量配置
│   └── App.tsx             # 根组件
├── src-tauri/              # Rust 后端
│   ├── src/
│   │   ├── main.rs         # 入口
│   │   ├── lib.rs          # Tauri 命令注册
│   │   └── file_ops.rs     # 文件系统操作
│   └── tauri.conf.json     # Tauri 配置
├── assets/images/          # 截图和展示图片
├── design/                 # 设计资源
├── FEATURES.md             # 完整功能清单
├── TODO.md                 # 待实现功能
├── BUG.md                  # 已知 Bug
└── package.json
```

## 功能清单

详见 [FEATURES.md](./FEATURES.md) 的完整状态表。

## 文档治理

- 法典总索引：[`codex/README.md`](./codex/README.md)
- 发版流程与验收：[`codex/06-release-runbook.md`](./codex/06-release-runbook.md)
- 液态玻璃与文件工作台治理：[`codex/14-liquid-glass-file-workbench.md`](./codex/14-liquid-glass-file-workbench.md)
- 全栈测试报告：[`docs/FULL_TEST_REPORT.md`](./docs/FULL_TEST_REPORT.md)

## 注意事项

- 删除操作只会移至 macOS 废纸篓，不做物理删除
- 颜色标签当前保存在本地设置中，不写入 macOS 扩展属性
- 隐私和外发请求说明见 [docs/PRIVACY.md](./docs/PRIVACY.md)
- 安全披露见 [SECURITY.md](./SECURITY.md)，贡献流程见 [CONTRIBUTING.md](./CONTRIBUTING.md)

## 常见问题

### 未签名构建如何打开

当前项目按公益分发维护，暂不把 Developer ID 签名 / notarization 作为路线阻塞项。首次打开 DMG 安装的 Aether Explorer，macOS 可能会提示「已损坏，无法打开」或拦截未签名应用。

**原因：** 当前构建没有 Apple Developer 签名认证，Gatekeeper 会按未签名应用处理。

**建议方式：**

1. 打开 **系统设置 → 隐私与安全性**
2. 向下滚动到「安全性」部分
3. 点击「仍要打开」按钮
4. 在弹出的确认对话框中选择「打开」

**高级用户备用方式：**

```bash
# 确认来源可信后再执行
xattr -rd com.apple.quarantine /Applications/Aether\ Explorer.app
```

> 未签名应用不应被包装成正式可信分发。请只从项目发布页获取安装包，并在真实重要文件上操作前先用测试目录验证。

## License

MIT
