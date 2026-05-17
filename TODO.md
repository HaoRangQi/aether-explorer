# Aether Explorer 待办与路线

> 最后整理：2026-05-17
> 维护规则：每完成一项划 `[x]`；新增按优先级插入对应区块；引用文档用 `→ docs/X.md`。
> 优先级标签：🔴 阻塞 / 🟠 必修 / 🟡 改善 / 🟣 长线

---

## 一、当前进行中（feat/cross-window-drag）

| 状态 | 项 | 备注 |
|------|----|------|
| ✅ | Aether ↔ Aether 跨窗口拖拽（松手即复制） | commit `71c95b6` |
| ✅ | 跨窗口拖拽默认动作设置项（复制 / 移动 / 每次询问） | commit `0a65435` |
| ✅ | Finder → Aether 系统拖入兜底 + overlay 提示 | commit `55d52ad` |
| ✅ | banner 可见时长加长 + 倒计时进度条（修"一闪就没"） | commit `0a65435` |
| ✅ | 空格预览改为真开关（默认开） | commit `ae5a46d` |
| ⚠️ | **底层窗口自动置顶 — 部分有效** | commit `ae5a46d`；详见下条 |
| ✅ | 默认首页全链路统一为「我的收藏」+ 文案厘清「首页/用户主页」 | commits `29dab7c` `6a9e2d1` `e007d2f` `7b91400` |
| ✅ | 空白右键「设为首页」一键设当前目录 | commit `83b9ce9` |
| ✅ | 分栏视图多列横向滚动 + 子文件夹真正展开 | commits `4ebe106` `d0ff36a` |
| ✅ | 列表视图虚拟滚动修复（两套 list 视图共存陷阱） | commits `4ebe106` `d0ff36a` |
| ⚠️ | 打开方式子菜单背景跟父菜单不完全统一 | commit `7d969c2`，详见 `codex/scratch.md` |

### 🟠 跨窗口拖拽 — 底层窗口置顶仍不可靠
**现状**：源端 `document.addEventListener('drag')` 节流广播屏幕坐标到 Rust `raise_window_at`，目标端 `onDragEnter` 兜底 `setFocus`。
**问题**：macOS WebKit 在鼠标离开源窗口的可视区后 **`drag` 事件停止派发**，跨窗口边界恰好失效；目标 `onDragEnter` 在 HTML5 拖拽跨窗口场景下也不稳定。
**根本修法**（1-2 天）：
- Rust 端用 `core-graphics` 的 `CGEventTap` 全局监听 mouseMoved，30Hz 轮询坐标，仍调 `raise_window_at`
- macOS Sequoia 起需要"输入监控"权限 → 首次启用时弹授权框 + 引导
- 仅在 dragStart→dragEnd 期间开启 EventTap，结束立即停止，避免持久权限占用
**决策点**：是否引入"输入监控"权限值得**权衡产品定位**；当前实现在"窗口不重叠"场景已能用

---

## 二、🔴 阻塞发版（来自 `docs/RELEASE_AUDIT.md`）

- [x] **P0-1** AppleScript / shell 命令注入修复（commit `5388fe5`）
- [x] **P0-2** `shell.open` 协议白名单（commit `5388fe5`）
- [x] **P0-3** CSP 配置 + 敏感文件预览黑名单（commit `5388fe5`）
- [x] **P0-4** `prompt()` 替换为 dialog + 路径 canonicalize（commit `5388fe5`）
- [x] **P0-5** Updater endpoint 改稳定 URL + 真实 release notes（commit `5388fe5`）
- [ ] **P0-6** Developer ID 签名 + notarytool；删 README 的 `sudo xattr` 教程（需要 Apple 开发者账号）
- [ ] **P0-7** 完全磁盘访问真实检测（TCC 状态探针）— 需 P0-6 完成才有意义

P0-1 到 P0-5 已完成。P0-6/7 依赖外部条件（Apple Developer Program $99/年），路线图保留。

详细方案见 `docs/RELEASE_AUDIT.md`。

---

## 三、🟠 必修（v0.3 之前）

### 性能（来自 `docs/PERF_PLAN.md`）
- [x] **L1** 重新启用虚拟滚动（commit `d3c0e35`）
- [x] **L2-B** 去掉 `list_directory` 的 N+1 `child_count`（commit `d3c0e35`）
- [x] **L3-A** `hydrateAppIcons` 批量 `setAppIconMap`（commit `d3c0e35`）
- [x] **L4** file-item 去 motion `whileHover`，CSS 接管 + 加 prefers-reduced-motion（commit `d3c0e35`）
- [x] **L6-C** 默认 `blurIntensity = 0`（DEFAULT_THEME 已改，commit `5f55ea3`）
- [ ] **L2-A** `list_directory` 异步化 + 取消令牌（仍同步阻塞，下一步）
- [ ] **L2-C** 分批流式返回（超大目录 > 1000 项时）
- [ ] **L3-B** `fileById` Map 索引（selectedFiles / lastSelectedFile O(1) 查找）
- [ ] **L3-C** 搜索 debounce 150ms
- [ ] **L5** tab inactive 时 unmount + state 提升到 App
- [ ] **L6-A** 应用图标只对可见区域加载 + LRU（结合 L1 虚拟滚动）

### 跨窗口拖拽剩余事项
- [ ] 底层窗口置顶根治（CGEventTap 方案，详见第一节）
- [ ] 大文件复制时 TransferModal 真接进度（已有 UI 骨架）
- [ ] 跨设备拖拽时弹"复制 vs 移动"对话框（同卷默认 move、跨卷默认 copy）
- [ ] 单次拖拽 paths > 5000 时弹确认（防止 UI 卡死）

### 用户教育 / 错误处理
- [ ] 设置导入 / 导出 / 重置
- [ ] Rust panic hook + 崩溃日志落盘 `~/Library/Logs/Aether Explorer/`
- [ ] 结构化错误类型（`AppError` 枚举），前端按 kind 分支处理
- [ ] 首次启动 onboarding（3 屏）
- [ ] 按 `?` 弹快捷键 cheatsheet

详见 `docs/IMPROVEMENT_PROPOSALS.md`。

---

## 四、🟢 已建立的测试与防回归基础（commit `5f55ea3` / `149cd85`）

- [x] vitest + jsdom 配置（`src/__tests__/`）
- [x] Rust `#[cfg(test)] mod tests`（src-tauri/src/lib.rs 末尾）
- [x] **76 个测试通过**：TS 41 + Rust 35
- [x] CI 加 `test.yml` workflow，push / PR 都跑
- [x] release.yml 加 `needs: test-gate`
- [x] 本地 `scripts/release.sh` 也加测试门槛
- [x] DevTools 控制台 `window.__aether.smoke()` 一键自检 15 项断言
- [x] `docs/SMOKE_TEST.md` 5 分钟人工 + console 混合 checklist
- [x] 生产构建经 esbuild drop console / debugger（PERF P1-8）

测试相关命令：
```bash
npm test            # vitest 41 个
npm run test:rust   # cargo test --lib 35 个
npm run test:all    # 两层都跑
```

详见 `docs/TEST_PLAN.md`。

---

## 五、🟡 改善（v0.3 内随机做）

### 基础功能缺口
- [x] 复制 / 粘贴 / 剪切（内部剪贴板）
- [x] 键盘导航（上下键选择文件）
- [x] 查看简介（预览面板显示文件夹大小统计）
- [x] 右键菜单重构（统一分组、删除复制到/移动到）
- [x] Cmd+W 关闭当前标签页
- [x] 开发者控制台开关 + 状态栏图标
- [x] 标签区域扩展至窗口右边界 + 滚轮横向滚动
- [x] 工具栏刷新按钮 + 右键刷新
- [x] 文件拖入文件夹 — 已实现（同窗口）；跨窗口见第一节
- [x] 跨窗口拖拽复制 — 见第一节
- [x] 空格键预览开关（默认开）
- [x] 右键"复制到 / 移动到"用 dialog（不再 prompt）
- [ ] 应用图标 — 当前使用占位图标，需要专业设计

### 收藏 / 标签系统升级
- [ ] **收藏系统结构化**（FavoriteItem with color / type / addedAt）
- [ ] **路径颜色标签** — 10 预设色按 hash 自动分配
- [ ] **侧边栏动态收藏列表** — 颜色圆点 + 图标 + 名称
- [ ] **标签页颜色显示** — TopBar 标签页左侧 8px 圆点

### 侧边栏 / 导航
- [ ] **快速访问** — 常用目录 / 最近文件（基于访问频率）
- [ ] **外接磁盘检测** — Rust 监听 `/Volumes` 推事件给前端
- [ ] **存储空间** — 加外接卷

### 预览面板增强
- [ ] 视频缩略图 + 时长
- [ ] PDF 首页预览
- [ ] 文件属性详情面板

### macOS 原生集成
- [ ] 菜单栏完善
- [ ] Dock 图标菜单（当前误用 `app.set_menu`，详见 `docs/RELEASE_AUDIT.md` DEF-30）
- [ ] 全局快捷键系统
- [ ] 拖入 / 拖出 Finder（Aether→Finder 见 `docs/CROSS_WINDOW_DRAG.md` 方案 B）

### 打磨
- [ ] 错误处理（权限不足、磁盘满、路径不存在、文件被占用）
- [ ] 加载状态（大目录异步加载 Material 3 Loader）
- [ ] 空状态（"此文件夹为空"+ 快捷操作）
- [ ] 无障碍（aria-label + 键盘 Tab / 方向键）
- [ ] 崩溃报告（Sentry 或本地日志）

---

## 六、🟣 长线（v0.5+）

### 差异化卖点（产品力）
- [ ] **命令面板（Cmd+K）** — 详见 `docs/IMPROVEMENT_PROPOSALS.md` 第七节
- [ ] **暂存夹板（Stack）** — 跨窗口暂存 + 任意位置粘贴
- [ ] **智能文件夹** — 保存搜索（基于 `mdfind`）
- [ ] **双窗格视图** — 左右分屏同时显示两个目录

### 架构
- [ ] `ExplorerView.tsx` 拆分（4000 行 → 单文件 < 800 行）
- [ ] Rust `lib.rs` 拆模块（`commands/fs.rs` `commands/terminal.rs` 等）
- [ ] FS 监听（`notify-debouncer-mini`）解决"刷新滞后"
- [ ] 测试覆盖扩张（组件级测试、Tauri 命令集成测试）
- [ ] ESLint + clippy 接入 CI

### 工程
- [ ] Bundle 拆包（主 chunk 574KB → 多 chunk）
- [ ] i18n 按语言动态加载
- [ ] CHANGELOG / SECURITY / CONTRIBUTING 三件套
- [ ] PR / Issue / CODEOWNERS / commitlint
- [ ] SBOM + SHA256 + 第三方 license 清单

### 扩展生态
- [ ] 插件机制（沙箱 iframe + postMessage）
- [ ] SFTP / WebDAV 协议支持
- [ ] 工作区配置（每目录独立设置）
- [ ] 文件夹比较

详见 `docs/IMPROVEMENT_PROPOSALS.md`。

---

## 七、🟣 在线更新（Tauri Updater）

**状态**：已实现，发版流水线见 `scripts/release.sh` 与 `.github/workflows/release.yml`。
**已加固**：双 endpoint 兜底 + CHANGELOG release notes（commit `5388fe5`）。
**未做**：见 `RELEASE_AUDIT.md` P0-6（签名）— 需 Apple Developer 账号。

---

## 文档索引

| 文档 | 内容 |
|------|------|
| `docs/RELEASE_AUDIT.md` | 发版前破坏性审计，34 项 P0~P3 风险 + 修复方案 |
| `docs/PERF_PLAN.md` | 性能六链路诊断 + 三周治理计划 |
| `docs/IMPROVEMENT_PROPOSALS.md` | 16 维度持续提升建议 |
| `docs/CROSS_WINDOW_DRAG.md` | 跨窗口拖拽完整设计方案 |
| `docs/TEST_PLAN.md` | 三层测试与回归保障计划 |
| `docs/SMOKE_TEST.md` | 5 分钟人工 + console 混合 checklist |
| `BUG.md` | 已知 Bug |
| `FEATURES.md` | 完整功能清单（84 项分 12 层） |
| `PROJECT.md` | 项目总览 + 里程碑进度 |

---

## 二、🔴 阻塞发版（来自 `docs/RELEASE_AUDIT.md`）

未启动，按 P0 红线清单做：

- [ ] **P0-1** AppleScript / shell 命令注入修复（`open_terminal_at` + `apple_quote` 死代码清理）
- [ ] **P0-2** `shell.open` 协议白名单 + `urlTemplate` 校验
- [ ] **P0-3** CSP 配置（`tauri.conf.json` 当前 `"csp": null`）+ 敏感文件预览黑名单（.env / id_rsa 等）
- [ ] **P0-4** `prompt('复制到...')` 替换为 dialog + 路径 canonicalize
- [ ] **P0-5** Updater endpoint 改稳定 URL（不用 `/latest/download/`）+ prerelease 守卫 + 真实 release notes
- [ ] **P0-6** Developer ID 签名 + notarytool；删 README 的 `sudo xattr` 教程
- [ ] **P0-7** 完全磁盘访问真实检测（TCC 状态探针）

详细修复方案见 `docs/RELEASE_AUDIT.md`。

---

## 三、🟠 必修（v0.3 之前）

### 性能（来自 `docs/PERF_PLAN.md`）
- [ ] **L1** 重新启用虚拟滚动（当前 `< 999999` 等效禁用）
- [ ] **L2-B** 去掉 `list_directory` 的 N+1 `child_count`，改按需懒查
- [ ] **L3-A** `hydrateAppIcons` 批量 `setAppIconMap`（80ms 节流）
- [ ] **L4** file-item 拆 `FileItemAnimWrapper`，普通项移除 motion
- [ ] **L6-C** 默认 `blurIntensity = 0`，去掉 `transition-all`

### 跨窗口拖拽剩余事项
- [ ] 底层窗口置顶根治（CGEventTap 方案，详见第一节）
- [ ] 大文件复制时 TransferModal 真接进度（已有 UI 骨架）
- [ ] 跨设备拖拽时弹"复制 vs 移动"对话框（同卷默认 move、跨卷默认 copy）
- [ ] 单次拖拽 paths > 5000 时弹确认（防止 UI 卡死）

### 用户教育 / 错误处理
- [ ] 设置导入 / 导出 / 重置
- [ ] Rust panic hook + 崩溃日志落盘 `~/Library/Logs/Aether Explorer/`
- [ ] 结构化错误类型（`AppError` 枚举），前端按 kind 分支处理
- [ ] 首次启动 onboarding（3 屏）
- [ ] 按 `?` 弹快捷键 cheatsheet

详见 `docs/IMPROVEMENT_PROPOSALS.md`。

---

## 四、🟡 改善（v0.3 内随机做）

### 基础功能缺口
- [x] 复制 / 粘贴 / 剪切（内部剪贴板）
- [x] 键盘导航（上下键选择文件）
- [x] 查看简介（预览面板显示文件夹大小统计）
- [x] 右键菜单重构（统一分组、删除复制到/移动到）
- [x] Cmd+W 关闭当前标签页
- [x] 开发者控制台开关 + 状态栏图标
- [x] 标签区域扩展至窗口右边界 + 滚轮横向滚动
- [x] 工具栏刷新按钮 + 右键刷新
- [x] 文件拖入文件夹 — 已实现（同窗口）；跨窗口见第一节
- [x] 跨窗口拖拽复制 — 见第一节
- [x] 空格键预览开关（默认开）
- [ ] 应用图标 — 当前使用占位图标，需要专业设计

### 收藏 / 标签系统升级
- [ ] **收藏系统结构化** — 将 `favorites: string[]` 升级为：
  ```typescript
  interface FavoriteItem {
    id: string; path: string; label: string;
    type: 'file' | 'folder';
    color: string;        // 关联颜色标签
    addedAt: number;
  }
  ```
  存 localStorage + Tauri Store，侧边栏动态列出，文件视图顶栏 ⭐ 添加，自动分配颜色
- [ ] **路径颜色标签** — `PathColorMap = Record<string, string>`，10 种预设色按 hash 自动分配，右键标签页手动改色
- [ ] **侧边栏动态收藏列表** — 颜色圆点 + 图标 + 名称，点击新标签页打开，hover 显示完整路径
- [ ] **标签页颜色显示** — TopBar 标签页左侧 8px 圆点

### 侧边栏 / 导航
- [ ] **快速访问** — 显示常用目录和最近文件（基于访问频率）
- [ ] **外接磁盘检测** — Rust 后端监听 `/Volumes`，事件推送前端
- [ ] **存储空间** — 已有根卷信息，待加外接卷

### 预览面板增强
- [ ] 视频缩略图 + 时长
- [ ] PDF 首页预览
- [ ] 文件属性详情面板（已有骨架，待补字段）

### macOS 原生集成
- [ ] 菜单栏完善（File / Edit / View / Window / Help）
- [ ] Dock 图标菜单（当前误用 `app.set_menu`，详见 `docs/RELEASE_AUDIT.md` DEF-30）
- [ ] 全局快捷键系统（Cmd+N/W/Q/I/Delete 等）
- [ ] 拖入 / 拖出 Finder（Aether→Finder 见 `docs/CROSS_WINDOW_DRAG.md` 方案 B，长线）

### 打磨
- [ ] 错误处理（权限不足、磁盘满、路径不存在、文件被占用）
- [ ] 加载状态（大目录异步加载 Material 3 Loader）
- [ ] 空状态（"此文件夹为空"+ 快捷操作）
- [ ] 无障碍（aria-label + 键盘 Tab / 方向键）
- [ ] 崩溃报告（Sentry 或本地日志）

---

## 五、🟣 长线（v0.5+）

### 差异化卖点（产品力）
- [ ] **命令面板（Cmd+K）** — 详见 `docs/IMPROVEMENT_PROPOSALS.md` 第七节
- [ ] **暂存夹板（Stack）** — 跨窗口暂存 + 任意位置粘贴
- [ ] **智能文件夹** — 保存搜索（基于 `mdfind`）
- [ ] **双窗格视图** — 左右分屏同时显示两个目录

### 架构
- [ ] `ExplorerView.tsx` 拆分（4000 行 → 单文件 < 800 行）
- [ ] Rust `lib.rs` 拆模块（`commands/fs.rs` `commands/terminal.rs` 等）
- [ ] FS 监听（`notify-debouncer-mini`）解决"刷新滞后"
- [ ] 单元测试覆盖（`vitest` + `cargo test`）
- [ ] ESLint + clippy 接入 CI

### 工程
- [ ] Bundle 拆包（主 chunk 568KB → 多 chunk）
- [ ] i18n 按语言动态加载
- [ ] CHANGELOG / SECURITY / CONTRIBUTING 三件套
- [ ] PR / Issue / CODEOWNERS / commitlint
- [ ] SBOM + SHA256 + 第三方 license 清单

### 扩展生态
- [ ] 插件机制（沙箱 iframe + postMessage）
- [ ] SFTP / WebDAV 协议支持
- [ ] 工作区配置（每目录独立设置）
- [ ] 文件夹比较

详见 `docs/IMPROVEMENT_PROPOSALS.md`。

---

## 六、🟣 在线更新（Tauri Updater）

**状态**：已实现，发版流水线见 `scripts/release.sh` 与 `.github/workflows/release.yml`。
**未做**：见 `RELEASE_AUDIT.md` P0-5（endpoint 不稳定 / 无 prerelease 守卫 / notes 硬编码）。

---

## 文档索引

| 文档 | 内容 |
|------|------|
| `docs/RELEASE_AUDIT.md` | 发版前破坏性审计，34 项 P0~P3 风险 + 修复方案 |
| `docs/PERF_PLAN.md` | 性能六链路诊断 + 三周治理计划 |
| `docs/IMPROVEMENT_PROPOSALS.md` | 16 维度持续提升建议（状态机、错误处理、a11y、命令面板等） |
| `docs/CROSS_WINDOW_DRAG.md` | 跨窗口拖拽完整设计方案（含 Aether→Finder 长线方案） |
| `BUG.md` | 已知 Bug |
| `FEATURES.md` | 完整功能清单（84 项分 12 层） |
| `PROJECT.md` | 项目总览 + 里程碑进度 |
