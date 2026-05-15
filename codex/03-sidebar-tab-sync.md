# 03 导航栏与标签一致性 (Sidebar-Tab-Sync)

**状态**: ✅  **首次落地**: [2026-05-15]  **最近更新**: [2026-05-15]  **域**: 侧边栏导航高亮与标签页实际路径保持一致，单击/双击开标签行为可预期

← 返回 [索引](./README.md)

## 03.1 一句话总结

将侧边栏“激活态”从 `view id` 绑定改为“当前标签路径”绑定，同时拆分单击与双击开标签策略：单击优先复用根路径标签，双击始终新开。

## 03.2 决策与权衡

| 决策点 | 旧行为 | 新行为 | 选择原因 |
|---|---|---|---|
| 导航高亮依据 | `currentView` / id 前缀 | `currentPath` 与导航根路径比对 | 用户进入子目录后，导航高亮应跟随真实路径 |
| 单击导航开标签 | 只按 labelKey 查同类标签 | 仅复用“仍停在导航根路径”的标签 | 防止“下载标签已走到子目录”时，单击下载无效 |
| 双击导航开标签 | 容易与单击竞争，偶发重复开两个 | 单击延迟 180ms，双击清掉单击定时器并强制新开 | 满足“单击最多开一个，双击一定新开一个” |
| 设置页切换回退 | Explorer 可能被卸载，路径状态回退 | Explorer 全部保持挂载，仅隐藏非激活 | 防止从设置返回后标签标题/路径闪回旧值 |

**不变量：**

1. `settings` / `storage` 仍走固定视图，不走标签复用逻辑。
2. 导航高亮必须由当前激活标签 `currentPath` 驱动，而不是历史 `labelTranslationKey`。
3. 双击导航的意图优先级高于单击；双击出现时必须取消单击定时器。

## 03.3 实现拓扑

```
Sidebar Click
   ├─ 180ms 延迟 → openMenuTab(forceNew=false)
   │      ├─ 按 menuRootPath 匹配 existing tab
   │      ├─ 找到则切换
   │      └─ 未找到则新建
   └─ Double Click
          ├─ clear single-click timer
          └─ openMenuTab(forceNew=true) 始终新建

Explorer Active Tab
   └─ onPathChange(tabId, currentPath)
         ↓
       App.tabs[currentTab].currentPath 更新
         ↓
       Sidebar(currentPath=activeTabPath)
         ↓
       菜单/磁盘激活态按 path 精确匹配
```

## 03.4 关键文件 & 行号

| 文件 | 锚点 | 说明 |
|---|---|---|
| `src/components/Sidebar.tsx` | `:69` | `getMenuPath()`：导航项到根路径映射 |
| `src/components/Sidebar.tsx` | `:141` | `handleMenuClick()`：单击延迟分发 |
| `src/components/Sidebar.tsx` | `:153` | `openMenuTab()`：复用/新建决策 |
| `src/components/Sidebar.tsx` | `:177` | `handleMenuDoubleClick()`：强制新建 + 取消单击 |
| `src/components/Sidebar.tsx` | `:307` | 导航激活态由 `currentPath` 判断 |
| `src/components/Sidebar.tsx` | `:374` | 外置卷激活态由 `volume.path` 判断 |
| `src/App.tsx` | `:140` | `activeTabPath` 计算 |
| `src/App.tsx` | `:456` | 关闭标签时改为函数式更新，避免竞态 |
| `src/App.tsx` | `:528` | 透传 `currentPath` 给 `Sidebar` |
| `src/App.tsx` | `:554` | Explorer 视图保持挂载，仅隐藏 |
| `src/components/ExplorerView.tsx` | `:595` | `onPathChange(view, currentPath)` 回传标签路径 |

## 03.7 失败模式与排查

| 现象 | 根因 | 修复 |
|---|---|---|
| 双击导航开两个标签 | 单击与双击同时命中 | 使用 `menuClickTimerRef`，双击时清理单击定时器 |
| 下载菜单始终高亮，即使已进入子目录 | 激活态按 labelKey 判断 | 改成 `currentPath === menuPath` |
| 从设置页返回后标签标题回退 | Explorer 被卸载导致状态重建 | 保持 Explorer 挂载，仅切换可见性 |
| 单击下载无效（已存在“下载类标签”但路径不在下载根） | 复用策略过宽 | 复用条件收敛为“当前路径仍等于导航根路径” |

## 03.9 经验教训

1. 文件管理器的“语义实体”是路径，不是标签名。用标签名驱动导航状态会在“进入子目录”后立刻偏离用户认知。
2. 单击/双击冲突是经典时序问题，前端必须显式建模；依赖浏览器默认事件顺序会出现平台差异。
3. 设置页这类“工具面板”不应破坏 Explorer 生命周期，否则会触发难排查的状态回退。
