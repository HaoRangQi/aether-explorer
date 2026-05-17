# 10 颜色细化控制系统 (Color-Fine-Tuning)

**状态**: ✅  **首次落地**: [2026-05-17]  **最近更新**: [2026-05-17]  **域**: 用户可自定义 14 项 UI 颜色，通过 CSS 变量驱动实时生效，支持重置为默认配色

## 10.1 一句话总结

在外观设置中新增颜色细化控制面板，允许用户独立定制图标、选中态、悬浮态、文字、边框、分隔线、阴影等 14 项 UI 颜色，通过 CSS 变量注入实现实时预览和即时生效，支持全量重置。

## 10.2 决策与权衡

| 方案 | 优点 | 缺点 | 选择 |
|---|---|---|---|
| **CSS 变量 + setProperty/removeProperty** | 无需页面刷新、性能好、支持即时重置、与现有 Tailwind 集成无缝 | 需要系统地替换所有颜色类 | ✅ 采用 |
| 状态管理 + 组件重渲染 | 逻辑集中 | 性能差、需要大量 re-render、重置需要刷新 | ❌ 否决 |
| localStorage 持久化 + 页面加载时恢复 | 用户偏好保留 | 需要额外的初始化逻辑 | ✅ 并行实现 |

**不变量**：
- 14 项颜色是完整的 UI 色彩空间（图标、前景、背景、文字、边框、分隔线、阴影、标签、搜索框）
- 未设置的颜色使用 CSS 默认值（通过 `color-mix()` 计算）
- 重置操作通过 `removeProperty()` 清除 inline style，让 CSS 默认值生效
- 所有颜色变量在 `:root` 级别注入，全局生效

## 10.3 实现拓扑

```
用户在 SettingsView 中点击颜色块
    ↓
打开原生 HTML color picker
    ↓
选择颜色 → 更新 theme state
    ↓
App.tsx effect hook 监听 theme 变化
    ↓
遍历 14 项颜色字段
    ├─ 若有值 → root.style.setProperty('--color-xxx', value)
    └─ 若无值 → root.style.removeProperty('--color-xxx')
    ↓
CSS 变量更新 → 所有使用 var(--color-xxx) 的元素即时重新渲染
    ↓
实时预览区域同步显示（使用相同的 CSS 变量类）
    ↓
用户点击"全部重置" → 清空所有 14 项 → removeProperty 全部调用 → 恢复默认配色
```

## 10.4 关键文件 & 行号

| 文件 | 行号 | 用途 |
|---|---|---|
| `src/types.ts` | 105-118 | 14 项颜色字段定义（ThemeSettings 接口） |
| `src/lib/settings.ts` | — | DEFAULT_THEME 中 14 项颜色初始化为 undefined |
| `src/index.css` | 62-76 | @theme 中 14 项 CSS 变量定义 + color-mix() 默认值 |
| `src/index.css` | 143-159 | 14 项颜色工具类（.text-icon、.bg-selected 等） |
| `src/App.tsx` | — | effect hook 监听 theme 变化，调用 setProperty/removeProperty |
| `src/components/SettingsView.tsx` | — | 颜色细化控制面板：7 列 2 行圆形色块 + 实时预览区 |
| `src/components/Sidebar.tsx` | — | 替换硬编码 Tailwind 类为 CSS 变量类 |
| `src/components/ExplorerView.tsx` | — | 替换硬编码 Tailwind 类为 CSS 变量类 |

## 10.5 数据契约

**ThemeSettings 颜色字段**（src/types.ts:105-118）：

```typescript
interface ThemeSettings {
  colorIcon?: string;              // 图标颜色
  colorSelectedFg?: string;        // 选中前景色
  colorSelectedBg?: string;        // 选中背景色
  colorHoverFg?: string;           // 悬浮前景色
  colorHoverBg?: string;           // 悬浮背景色
  colorPanelBg?: string;           // 面板底色
  colorTextPrimary?: string;       // 主文字色
  colorTextSecondary?: string;     // 次文字色
  colorBorder?: string;            // 边框色
  colorDivider?: string;           // 分隔线色
  colorShadow?: string;            // 阴影色
  colorActiveIconBg?: string;      // 激活图标背景
  colorTagSelected?: string;       // 标签选中色
  colorSearchBg?: string;          // 搜索框底色
}
```

**CSS 变量映射**（src/index.css:62-76）：

```css
--color-icon: var(--primary);
--color-selected-fg: var(--on-surface);
--color-selected-bg: color-mix(in srgb, var(--primary) 40%, transparent);
--color-hover-fg: var(--primary);
--color-hover-bg: color-mix(in srgb, var(--primary) 20%, transparent);
--color-panel-bg: color-mix(in srgb, var(--primary) 5%, transparent);
--color-text-primary: var(--on-surface);
--color-text-secondary: color-mix(in srgb, var(--on-surface) 60%, transparent);
--color-border: color-mix(in srgb, var(--primary) 20%, transparent);
--color-divider: color-mix(in srgb, var(--on-surface) 10%, transparent);
--color-shadow: var(--primary);
--color-active-icon-bg: var(--primary);
--color-tag-selected: var(--primary);
--color-search-bg: color-mix(in srgb, var(--primary) 5%, transparent);
```

## 10.6 状态机 / 生命周期

```
初始化
  ↓
从 localStorage 读取用户保存的颜色偏好（如有）
  ↓
App.tsx effect 调用 setProperty/removeProperty 注入 CSS 变量
  ↓
用户在 SettingsView 中修改颜色
  ↓
theme state 更新 → effect 重新执行 → CSS 变量更新
  ↓
用户点击"全部重置"
  ↓
所有 14 项颜色字段设为 undefined
  ↓
effect 调用 removeProperty 清除 inline style
  ↓
CSS 默认值生效（color-mix 计算）
```

## 10.7 失败模式与排查

| 现象 | 根因 | 修复 |
|---|---|---|
| 设置颜色后 UI 不变 | 组件仍使用硬编码 Tailwind 类，未替换为 CSS 变量类 | 系统地替换所有颜色类为 CSS 变量类（.text-icon、.bg-selected 等） |
| 重置后需要刷新才生效 | 只调用了 setProperty，未调用 removeProperty 清除 inline style | 在 effect 中同时处理两种情况：有值→setProperty，无值→removeProperty |
| 颜色块与预览不同步 | 预览区域使用了不同的 CSS 类或硬编码颜色 | 预览区域必须使用相同的 CSS 变量类（.bg-selected、.text-primary-custom 等） |
| CSS 变量循环引用 | 初始定义中 `--color-icon: var(--color-icon, ...)` 形成循环 | 改为直接引用基础变量：`--color-icon: var(--primary)` |
| 颜色块与大色块对不上 | 小色块和大色块使用了不同的数据源或更新时机不一致 | 统一使用单一数据源（theme state），所有 UI 元素通过 CSS 变量驱动 |

## 10.8 SOP

### 上手

1. 理解 14 项颜色的语义（见 10.5 数据契约）
2. 查看 src/index.css 中的 CSS 变量定义和默认值
3. 查看 src/components/SettingsView.tsx 中的颜色细化控制面板 UI
4. 查看 src/App.tsx 中的 effect hook，理解 setProperty/removeProperty 的调用时机

### 新增颜色项

1. 在 src/types.ts 中添加新字段（ThemeSettings 接口）
2. 在 src/lib/settings.ts 中初始化为 undefined
3. 在 src/index.css 中定义 CSS 变量和默认值
4. 在 src/index.css 中添加对应的工具类（.text-xxx 或 .bg-xxx）
5. 在 src/components/SettingsView.tsx 中添加颜色块
6. 在 src/App.tsx effect 中添加 setProperty/removeProperty 调用
7. 在需要使用该颜色的组件中替换为 CSS 变量类

### 替换组件颜色

1. 找到使用硬编码颜色的组件（如 `text-primary`、`bg-blue-500`）
2. 确定该颜色对应的语义（图标、文字、背景等）
3. 替换为对应的 CSS 变量类（如 `.text-icon`、`.text-primary-custom`）
4. 验证实时预览和重置功能正常

### 发布

1. 确保所有主要组件已替换为 CSS 变量类
2. 测试颜色设置、预览、重置功能
3. 测试 localStorage 持久化（关闭重开应保留用户设置）
4. 提交 commit

## 10.9 经验教训

1. **CSS 变量 vs 状态管理**：初期考虑用 React state 管理颜色，但这会导致大量 re-render。CSS 变量方案性能更好，且支持即时重置（removeProperty 清除 inline style，让 CSS 默认值生效）。

2. **单一数据源**：颜色块和预览区域最初分别维护状态，导致同步问题。改为统一通过 CSS 变量驱动，预览区域使用相同的 CSS 类，问题解决。

3. **UI 设计迭代**：初期设计有小色块 + 大色块两套 UI，用户反馈"能一个色块解决的，不要搞那么多"。最终设计为 7 列 2 行圆形色块 + 实时预览区，简洁高效。

4. **实时预览的重要性**：用户要求"把底下的实时预览放到细化那里"，说明实时预览对用户体验至关重要。预览区域必须使用相同的 CSS 变量类，确保所见即所得。

5. **removeProperty 的必要性**：重置功能最初只清空 state，但 inline style 仍然存在，导致需要刷新才能看到效果。添加 removeProperty 调用后，CSS 默认值立即生效。

6. **颜色默认值的计算**：使用 `color-mix()` 计算默认值（如 `color-mix(in srgb, var(--primary) 40%, transparent)` 用于选中背景），避免硬编码颜色，保持与主题色的关联。

7. **组件替换的系统性**：颜色细化控制系统需要系统地替换所有组件中的硬编码颜色类。这不是一次性工作，而是持续的重构过程。建议按组件优先级逐步替换（Sidebar → ExplorerView → 其他组件）。

## 10.10 未来扩展

- **颜色预设**：提供几套预定义的颜色方案（如"深色"、"浅色"、"高对比度"），用户可一键切换
- **颜色导出/导入**：允许用户导出自定义颜色配置为 JSON，分享给他人或备份
- **颜色历史**：记录用户最近使用过的颜色，方便快速选择
- **无障碍增强**：添加颜色对比度检查，确保自定义颜色满足 WCAG AA 标准
- **更多颜色项**：根据用户反馈，可能需要添加更多细化颜色（如按钮、输入框、滚动条等）
