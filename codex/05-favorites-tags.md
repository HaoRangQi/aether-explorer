# 05 收藏与颜色标签域 (Favorites-Tags-Domain)

**状态**: ✅  **首次落地**: [2026-05-15]  **最近更新**: [2026-05-15]  **域**: 将“我的收藏”和颜色标签从假筛选改为真实虚拟根视图，并统一跨标签页状态与右键入口

← 返回 [索引](./README.md)

## 05.1 一句话总结

收藏与颜色标签都升级为真实数据视图：支持从任意目录解析展示，支持系统/自绘右键打标与收藏切换，默认首页改为“我的收藏”。

## 05.2 决策与权衡

| 决策点 | 旧行为 | 新行为 | 选择原因 |
|---|---|---|---|
| 收藏页展示模型 | 进入 home 后按 `favorites.includes(file.id)` 过滤当前目录列表 | 使用 `aether://favorites` 虚拟根，按收藏路径逐个 `get_file_info` 解析真实文件 | 避免“收藏其他目录不显示”的假功能 |
| 标签页展示模型 | `tag-*` 菜单映射到 home，再按当前目录过滤 | 使用 `aether://tags/<tag-id>` 虚拟根，按 `fileTags` 索引全局解析真实文件 | 标签视图应跨目录，不应被当前目录限制 |
| 标签状态存储 | `ExplorerView` 局部 state + localStorage | 提升到 `App` 全局 state，透传到所有 Explorer tab，并同步 `settings.json` + localStorage | 多标签页 / 多窗口一致性更强 |
| 默认首屏 | `home` | `favorites-list` | 与“我的收藏”入口语义一致，减少启动后的无效导航 |
| 右键功能入口 | 仅有“复制文件名”等，收藏/标签入口缺失 | 系统菜单与自绘菜单都提供：收藏/取消收藏 + 颜色标签 | 用户需要可见、可发现、可批量的操作入口 |

**不变量：**

1. 虚拟根仅用于导航与列表展示，不参与真实文件系统路径写入。
2. 收藏与打标动作均以 `file.path` 为唯一键，不依赖目录内临时 `id`。
3. 双击虚拟列表中的文件夹后进入真实路径，侧边栏高亮应从虚拟入口切回真实目录入口。

## 05.3 实现拓扑

```
Sidebar (favorites-list / tag-*)
   ↓ getMenuPath()
Virtual Path
   ├─ aether://favorites
   └─ aether://tags/<tag-id>
   ↓
ExplorerView
   ├─ resolveFavoriteItems(paths) -> getFileInfo(path)
   ├─ resolveTaggedItems(tagId, fileTags)
   └─ displayedFiles = favoriteFiles | taggedFiles | files
   ↓
UI Actions
   ├─ 地址栏 Star: onToggleFavorite(currentPath)
   ├─ 右键菜单: 收藏/取消收藏
   └─ 右键菜单 + 顶部标签面板: 颜色标签增删
   ↓
App State
   ├─ favorites
   └─ fileTags
      ↓
localStorage + settings.json(store)
```

## 05.4 关键文件 & 行号

| 文件 | 锚点 | 说明 |
|---|---|---|
| `src/App.tsx` | `:16` | 定义 `FAVORITES_VIRTUAL_PATH` |
| `src/App.tsx` | `:52` | `getInitialTabs()` 默认返回收藏标签 |
| `src/App.tsx` | `:122` | `loadFileTagsFromLocalStorage()` |
| `src/App.tsx` | `:156` | `fileTags` 全局状态 |
| `src/App.tsx` | `:283` | 从 Tauri store 读取 `fileTags` |
| `src/App.tsx` | `:319` | 写回 `aether-file-tags` 与 store |
| `src/App.tsx` | `:617` | 透传 `fileTags/onFileTagsChange` 到 Explorer |
| `src/components/Sidebar.tsx` | `:27` | `FAVORITES_VIRTUAL_PATH` / `TAGS_VIRTUAL_PREFIX` |
| `src/components/Sidebar.tsx` | `:72` | `getMenuPath()` 返回虚拟路径 |
| `src/components/ExplorerView.tsx` | `:38` | 定义虚拟路径常量 |
| `src/components/ExplorerView.tsx` | `:73` | `fileTags` props 契约 |
| `src/components/ExplorerView.tsx` | `:176` | `resolveFavoriteItems()` |
| `src/components/ExplorerView.tsx` | `:192` | `resolveTaggedItems()` |
| `src/components/ExplorerView.tsx` | `:407` | `isFavoritesRoot/isTagRoot/isVirtualRoot` |
| `src/components/ExplorerView.tsx` | `:417` | `viewPathMap` 虚拟根映射 |
| `src/components/ExplorerView.tsx` | `:592` | 收藏视图加载 effect |
| `src/components/ExplorerView.tsx` | `:616` | 标签视图加载 effect |
| `src/components/ExplorerView.tsx` | `:726` | `displayedFiles` 三路切换 |
| `src/components/ExplorerView.tsx` | `:1009` | `toggleTagForItems()` 批量打标/去标 |
| `src/components/ExplorerView.tsx` | `:1974` | 系统右键菜单收藏/取消收藏 |
| `src/components/ExplorerView.tsx` | `:1980` | 系统右键菜单颜色标签子菜单 |
| `src/components/ExplorerView.tsx` | `:2513` | 虚拟根地址栏展示（非真实路径） |
| `src/components/ExplorerView.tsx` | `:2727` | 顶部标签面板打标入口 |
| `src/components/ExplorerView.tsx` | `:3333` | 自绘右键收藏入口 |
| `src/components/ExplorerView.tsx` | `:3337` | 自绘右键颜色标签入口 |
| `src/components/TopBar.tsx` | `:269` | 标签最大宽度约束（防止长目录名挤压） |
| `src/i18n/locales/zh.ts` | `:141` | 收藏/标签文案 |
| `src/i18n/locales/zh.ts` | `:246` | 收藏与颜色标签反馈文案 |
| `src/i18n/locales/en.ts` | `:196` | `{{count}}` 占位符修正与新文案 |

## 05.7 失败模式与排查

| 现象 | 根因 | 修复 |
|---|---|---|
| “我的收藏”点开后看不到跨目录收藏项 | 实际只过滤当前目录 `files` | 切换为虚拟根 + `getFileInfo(path)` 全路径解析 |
| 颜色标签菜单点了没全局生效 | 标签状态是单个 Explorer 局部 state | 状态提升到 `App`，通过 props 广播到所有标签页 |
| 右键无法直接打标签/收藏 | 菜单仅保留基础文件操作 | 在系统菜单与自绘菜单都新增对应动作 |
| 收藏页/标签页显示真实路径面包屑导致混淆 | 虚拟根当成普通目录渲染 | 虚拟根模式下显示域名标题与图标，不暴露伪路径 |
| 国际化计数提示显示 `{count}` 原样文本 | i18n 占位符使用单花括号 | 统一修为 `{{count}}` 插值格式 |

## 05.9 经验教训

1. 文件管理器里的“跨目录集合”必须建模成独立视图域，不能依赖“先进某目录再过滤”，否则必然出现假功能。
2. 任何“批量元数据操作”（收藏、标签、评分）都要以绝对路径作为主键，避免视图切换后数据错位。
3. 系统菜单和自绘菜单的能力面需要对齐，否则用户会认为功能“不稳定”或“有时可用有时不可用”。
4. i18n 占位符风格要前后端统一，单花括号和双花括号混用会直接暴露到 UI 文本。

## 05.10 增量记录（2026-05-15，近期体验修复）

### A. 收藏页进入目录卡顿/假死

- **现象**: 从“我的收藏”进入真实目录时，长时间转圈或疑似卡死；从普通目录进入同路径通常秒开。
- **根因**:  
  1) 目录列表阶段对每个条目同步调用 `mdls` 和 `.app` 图标解析，I/O 过重；  
  2) 请求代次保护实现位置不当，`recentItems` 更新会误使当前目录请求过期，造成 loading 状态异常收口。
- **修复**:  
  1) `list_directory` 阶段不再逐项做 `mdls`/icon 解析，仅保留基础元数据；  
  2) `loadRequestSeqRef` 改为“仅在分支实际发起请求时自增”，并在回写点校验 requestId。

**代码锚点：**

- `src-tauri/src/lib.rs:243` / `:244` / `:247` — 列表阶段跳过 `added` / `last_opened` / `icon_path`
- `src/components/ExplorerView.tsx:606` / `:633` / `:659` / `:684` — 分支内请求代次控制
- `src/components/ExplorerView.tsx:2209` — `refreshCurrentDir` 统一 requestId 保护

### B. 打开方式子菜单（原生设计版）

- **目标**: 右键菜单只显示“打开方式”，鼠标悬停展开子菜单；子菜单含“其它…”，允许用户从应用程序列表选择。
- **落地**:  
  1) 系统菜单保持 `Submenu`，新增“其它…”项；  
  2) 自绘菜单改为悬停子菜单，不再在主菜单铺一排默认应用；  
  3) 修复子菜单显示异常：父容器与内层滚动容器均放开裁切（`overflow-visible`），避免只露出细条。

**代码锚点：**

- `src/components/ExplorerView.tsx:2067` / `:2077` — 系统菜单 `openWith` + `openWithOther`
- `src/components/ExplorerView.tsx:2279` — `handleOpenWithOther`
- `src/components/ExplorerView.tsx:3498` — 自绘菜单悬停子菜单入口
- `src/components/ExplorerView.tsx:3445` / `:3452` — 右键菜单容器 overflow 修复
- `src/i18n/locales/zh.ts:147` / `src/i18n/locales/en.ts:133` — `openWithOther` 文案
