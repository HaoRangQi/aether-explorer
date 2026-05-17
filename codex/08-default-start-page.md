# 08 默认首页 (Default-Start-Page)

**状态**: ✅  **首次落地**: [2026-05-17]  **最近更新**: [2026-05-17]  **域**: App 启动时打开的内容（不是系统 `~/`）

## 08.1 一句话总结

**「首页」是产品概念（App 启动时定位的内容），不是 macOS 主目录**。默认首页 = `theme.defaultHomePath`，默认值 `aether://favorites`（我的收藏）。术语严格区分：
- **首页** = App 启动定位（语义可变，aether://favorites / 真实路径都行）
- **用户主页** = macOS `~/`（语义固定，侧栏 `sidebar.home`）

## 08.2 决策与权衡

| 维度 | 选项 A | 选项 B | 决策 |
|---|---|---|---|
| 默认首页内容 | `~/Downloads` 硬编码 | `aether://favorites` 虚拟路径 | **B** — 收藏是用户主动管理的入口，比"下载文件夹"更符合"个人化首页"语义 |
| "首页" vs "主页" 命名 | 沿用"主页" | 改"首页"（与系统主目录区分） | **改"首页"** — 用户实际反馈"主页" 和 macOS `~/` 概念混淆 |
| 用户改默认首页的入口 | 仅设置面板选目录 | 设置面板 + 文件区空白右键 | **两者都做** — Finder 风格右键"设为首页"是核心交互，设置面板做兜底 |
| `defaultHomePath` 改变后 desktop tab 行为 | 保留 currentPath，下次冷启动才生效 | 立即重置 currentPath | **立即重置** — "恢复我的收藏"按钮等隐式要求即时反馈 |

**核心不变量**：
- `theme.defaultHomePath` 始终非空（`normalizeDefaultHomePath` 在 `settings.ts:84-90` 保证）
- 任何 fallback 兜底都是 `FAVORITES_VIRTUAL_PATH`（不再有 `~/Downloads` 兜底）
- 标签页 `id === 'desktop'` 是历史命名，**含义是"首页 tab"**，不是 macOS 桌面

## 08.3 实现拓扑

```
                ┌───────────────────────────────────────┐
                │ Tauri Store settings.json             │
                │   theme.defaultHomePath               │
                │   = "aether://favorites" (默认)        │
                └───────────────────────────────────────┘
                              │ load (async)
                              ▼
┌─────────────────────────────────────────────────────────┐
│ App.tsx                                                 │
│  loadThemeFromLocalStorage → normalizeThemeSettings     │
│     ↓ 第 78 行                                          │
│  getInitialTabs(theme.defaultHomePath)                  │
│     ↓ path-helpers.ts:48-74                             │
│  tabs[0] = { id:'desktop',                              │
│              labelTranslationKey: 'tabs.favorites',     │  ← 跟随路径变 key
│              initialPath: 'aether://favorites' }        │
│                                                         │
│  useEffect [theme.defaultHomePath]                      │
│     ↓ 第 95-127 行                                      │
│  setTabs(desktop tab 强制重置 currentPath = 新首页)     │
└─────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────┐
│ ExplorerView.tsx                                        │
│  useEffect [initialPath] → setCurrentPath(initialPath)  │
│     ↓ 第 752-759 行                                     │
│  fallback = FAVORITES_VIRTUAL_PATH (不是 ~/Downloads)   │
│                                                         │
│  viewPathMap.desktop = theme.defaultHomePath            │
│     ↓ 第 612, 616 行                                    │
│  ⚠️ 历史 bug：曾硬编码 = homeDir 覆盖 favorites           │
│                                                         │
│  view-mapping effect [view, homeDir, baseView]          │
│     ↓ 第 781-786 行                                     │
│  navigateToPath(mappedPath) — 仅在 mappedPath ≠ current │
└─────────────────────────────────────────────────────────┘
                              │
                              ▼
            最终 currentPath = aether://favorites
            Sidebar 'favorites-list' 项识别并高亮
                (Sidebar.tsx:322-326)
```

## 08.4 关键文件 & 行号

| 文件 | 行 | 角色 |
|---|---|---|
| `src/lib/settings.ts` | 15 | `FAVORITES_VIRTUAL_PATH = 'aether://favorites'` 唯一源 |
| `src/lib/settings.ts` | 64 | `DEFAULT_THEME.defaultHomePath` 兜底值 |
| `src/lib/settings.ts` | 86-90 | `normalizeDefaultHomePath` — 空 / null / undefined 归一 |
| `src/lib/settings.ts` | 96 | `normalizeThemeSettings` 调用 normalize（保证从 Store/localStorage 出来总有非空） |
| `src/lib/path-helpers.ts` | 60-64 | `getInitialTabs` 根据虚拟路径选 `labelTranslationKey`（favorites/recent/home） |
| `src/App.tsx` | 78 | `getInitialTabs(theme.defaultHomePath \|\| FAVORITES_VIRTUAL_PATH)` |
| `src/App.tsx` | 95-127 | `theme.defaultHomePath` 变化 effect — 强制重置 desktop tab currentPath |
| `src/App.tsx` | 132-138 | `createNewWindow` 兜底带上 defaultHomePath（避免新窗口 fallback 到 ~/） |
| `src/components/ExplorerView.tsx` | 612 | `homeTabPath = theme.defaultHomePath \|\| FAVORITES`，跟随用户设置 |
| `src/components/ExplorerView.tsx` | 616 | `viewPathMap.desktop = homeTabPath` ← **修复点：曾硬编码 homeDir** |
| `src/components/ExplorerView.tsx` | 752-759 | init effect fallback = FAVORITES_VIRTUAL_PATH（不是 ~/Downloads） |
| `src/components/ExplorerView.tsx` | 781-786 | view-mapping effect — homeDir resolve 后 navigateToPath |
| `src/components/ExplorerView.tsx` | 2992-3000 | `handleSetCurrentAsHome` — 右键"设为首页" |
| `src/components/SettingsView.tsx` | 190-194 | `handleResetDefaultHome` — 「恢复我的收藏」+ 切回首页 tab |
| `src/components/SettingsView.tsx` | 1535-1542 | 默认首页地址友好显示（"我的收藏" / "最近使用" / 真实路径） |
| `src/components/Sidebar.tsx` | 322-326 | `favorites-list` 项识别 `currentPath === FAVORITES_VIRTUAL_PATH` |
| `src/i18n/locales/zh.ts` | 4-5, 73, 207-209 | "用户主页" / "默认首页" / "我的收藏" / "最近使用" |

## 08.5 数据契约

`ThemeSettings.defaultHomePath: string`：
- 必须是非空字符串
- 三类合法值：
  - `aether://favorites` — 我的收藏（默认）
  - `aether://recent` — 最近使用
  - POSIX 绝对路径（用户手选或右键"设为首页"得到）
- **不接受** 相对路径、空字符串、null（normalize 会归一为 favorites）

`TabData.labelTranslationKey: string`：
- `'tabs.favorites'` — defaultHomePath === favorites
- `'tabs.recent'` — defaultHomePath === recent
- `'tabs.home'` — 真实路径或 fallback

## 08.7 失败模式与排查

| 现象 | 根因 | 修复 |
|---|---|---|
| 启动进入 `~/` 而不是收藏 | `ExplorerView.viewPathMap.desktop = homeDir` 硬编码；init 后 homeDir 异步 resolve → view-mapping effect 用 homeDir 覆盖 favorites | 把 `viewPathMap.desktop` 改为 `theme.defaultHomePath`（commit `7b91400`） |
| 启动进入 `~/Downloads` | ExplorerView init effect fallback = `${home}/Downloads`（v0.2 之前的历史默认） | fallback 改 `FAVORITES_VIRTUAL_PATH`（commit `29dab7c`） |
| Cmd+N 新窗口默认进 Downloads | `createNewWindow` 不传 tab 时 path = undefined，新窗口 ExplorerView 走 fallback | createNewWindow 用 `theme.defaultHomePath` 兜底（commit `29dab7c`） |
| 点"恢复我的收藏"没反应 | `App.tsx` effect 中 `tab.currentPath` 保留条件过严，已 navigate 过的真实路径不重置 | effect 简化为强制重置 desktop tab 的 currentPath（commit `e007d2f`） |
| "默认主页"和 macOS"主目录"概念混淆 | 文案沿用 macOS Finder 的"主页/主目录"叫法 | 改"首页" / "用户主页"（commit `6a9e2d1`） |
| 设置面板显示 `aether://favorites` 字面字符串 | 直接 render raw value | i18n 翻译为"我的收藏"（commit `e007d2f`） |
| 用户想把当前目录设为首页要走 5 步 | 仅设置面板入口 + 系统目录选择对话框 | 文件区空白右键加"设为首页"（commit `83b9ce9`） |

## 08.8 SOP — 添加新的"虚拟首页"种类

例如想加 `aether://tags/red` 作为合法首页：

1. `src/lib/path-helpers.ts:60-64` 给 `homeLabelKey` 加分支
2. `src/lib/settings.ts:84` `normalizeDefaultHomePath` 不需改（任何非空都保留）
3. `src/i18n/locales/{zh,en}.ts` `tabs.*` 加新 key
4. `src/components/SettingsView.tsx:1535` 友好显示加分支
5. `src/components/ExplorerView.tsx:612-630` `viewPathMap` 已支持虚拟路径
6. 测试：`src/__tests__/settings.test.ts` `normalizeDefaultHomePath` case

## 08.9 经验教训

1. **同名命名空间冲突极其危险**：tab id `'desktop'` 和 sidebar view id `'desktop'` 共用，让"首页 tab"被 sidebar"桌面"映射打回 `~/`。新功能起标识符前必须 grep 全代码确认无碰撞。优先用语义清晰的 ID（如 `'home-tab'`）。

2. **fallback 默认值是产品决策、不是工程默认**：`ExplorerView.tsx:756` 写 `setCurrentPath(initialPath || \`${home}/Downloads\`)` 是 v0.2 之前的产品决策遗留。改产品方向（首页 = 收藏）后所有 fallback 必须同步搜全。**全代码 grep `homeDir/Downloads` / `~/Downloads` 等硬编码**作为审计 checklist。

3. **「术语统一」是产品诚意的体现**：用户混淆"主页/主目录/首页"是因为我们也没厘清。三个词对应三种概念，文档优先（08.1 一句话总结）+ i18n key 命名优先 + 注释优先 — 任何一处不一致都会污染整个产品认知。

4. **设置项的"即时反馈"必须显式做**：用户点"恢复我的收藏"期待"立刻看到收藏"，不是"下次启动看到"。`SettingsView` → `onNavigateToHome` 回调显式切 view 比依赖 effect 链路传播更可靠。

5. **"流程不要超过 2 步"是配置项的产品红线**：传统设置面板 → 点选目录 → macOS Finder 对话框翻找 → 确定 = 4 步。Finder 风格的"右键当前位置 → 设为首页" = 2 步。**只要配置项有"用户当前在该状态"的场景，必须提供右键 / 工具栏一键入口**。

## 08.10 未来扩展

- **多 home page 切换**（类似浏览器多首页）— 已识别为 IMPROVEMENT_PROPOSALS 1.3（state machine + tagged union）的前置工作，需先把 `defaultHomePath: string` 改成 `defaultHome: { kind: 'virtual'|'path'; ... }`。可放弃。
- **Onboarding 时引导用户右键设首页** — 等真有新用户后再做（首次启动 onboarding 整体未做）。
