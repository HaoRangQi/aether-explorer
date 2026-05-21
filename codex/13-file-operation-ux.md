# 13 文件操作 UX (File-Operation-UX)

**状态**: ✅ 已落地  **首次落地**: [2026-05-21]  **最近更新**: [2026-05-21]  **域**: 新建文件定位、重命名交互、Tooltip 即时显示

← 返回 [索引](./README.md)

---

## 13.1 一句话总结

新建文件/文件夹后精确滚动定位（兼容虚拟滚动）；重命名时禁用拖动、双击不触发打开；图标组 Tooltip 用自定义组件替代浏览器原生 title，实现 75ms 即时显示。

---

## 13.2 决策与权衡

| 决策 | 选择 | 否决方案 | 原因 |
|---|---|---|---|
| 新建后定位 | `requestAnimationFrame` 重试 + index 偏移计算 | `setTimeout(50ms)` | 虚拟滚动时新文件可能不在 DOM 里，`querySelector` 找不到；先用 `index * listItemHeight` 滚到目标区域，再 rAF 重试 `scrollIntoView` |
| 重命名时禁拖动 | `draggable={renamingFile?.id !== file.id}` | 全局禁用拖动 | 只禁当前重命名的文件，其他文件不受影响 |
| Tooltip | 自定义 `Tooltip.tsx`（CSS `group-hover`） | 浏览器原生 `title` | 原生 title 有 500ms+ 延迟，用户不知道图标功能；自定义组件 `duration-75` 几乎即时 |

---

## 13.4 关键文件 & 行号

| 文件 | 职责 | 关键符号 |
|---|---|---|
| `src/components/ExplorerView.tsx:2132` | 重命名时跳过双击 | `handleDoubleClick` 开头 `if (renamingFile?.id === file.id) return` |
| `src/components/ExplorerView.tsx:2270` | 重命名时禁拖动 | `draggable={renamingFile?.id !== file.id}` |
| `src/components/ExplorerView.tsx:3176` | 新建后精确定位 | `scrollToCreated()` rAF 重试逻辑 |
| `src/components/ExplorerView.tsx:1142` | 虚拟滚动行高 | `listItemHeight` |
| `src/components/Tooltip.tsx:9` | 自定义 Tooltip 组件 | `group/tip` CSS group |

---

## 13.7 失败模式与排查

| 现象 | 根因 | 修复 |
|---|---|---|
| 新建文件后不定位 | `setTimeout(50ms)` 时 DOM 未更新，虚拟滚动未渲染新文件 | 先 `scrollTo(index * listItemHeight)` 触发虚拟滚动渲染，再 rAF 重试 `scrollIntoView` |
| 重命名时鼠标滑动触发拖拽 | `motion.div` 的 `onMouseDown` 处理拖拽，`onClick` 阻止冒泡不够 | `onMouseDown` 和 `onDragStart` 都判断 `renamingFile?.id === file.id` 时 return/preventDefault |
| 双击重命名输入框进入文件夹 | `onDoubleClick` 没有判断重命名状态 | `handleDoubleClick` 开头加 `if (renamingFile?.id === file.id) return` |
| 新建后菜单不消失 | `handleNewFile`/`handleNewFolder` 没有调 `setActiveDropdown(null)` | 两个函数开头加 `setActiveDropdown(null)` |

---

## 13.9 经验教训

1. **虚拟滚动的 DOM 盲区**：文件数 > 80 时启用虚拟滚动（`VIRTUAL_LIST_THRESHOLD = 80`，`src/components/ExplorerView.tsx:1158`），可视区外的文件行不在 DOM 里。任何依赖 `querySelector('[data-id]')` 的操作，在虚拟滚动场景下都可能找不到元素。正确做法：先用 `index * listItemHeight` 滚到目标位置，触发虚拟滚动渲染，再用 rAF 重试精确定位。

2. **`draggable` 属性要动态控制**：HTML5 拖拽的 `draggable` 属性一旦为 `true`，`mousedown` 事件就会被拖拽系统接管，导致输入框无法正常选中文字。重命名时必须把 `draggable` 设为 `false`，同时 `onMouseDown` 和 `onDragStart` 也要 guard。

3. **浏览器原生 `title` tooltip 不可用**：macOS WebView 的 `title` tooltip 延迟约 500ms-1s，用户体验差。图标组这类高频交互区域必须用自定义 Tooltip，`duration-75` 的 CSS transition 足够。
