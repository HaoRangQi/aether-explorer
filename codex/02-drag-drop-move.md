# 02 文件拖拽移动 (Drag-Drop-Move)

**状态**: ✅ **首次落地**: [2026-05-14]  **最近更新**: [2026-05-15]  **域**: 文件拖拽到文件夹即可原子批量移动，视觉反馈清晰，跨设备自动降级

## 02.1 一句话总结

拖拽文件/文件夹到目标文件夹，后端单一 `move_files()` invoke 处理原子性；前端用 `dragOverFolderId` state 提供视觉反馈；跨设备（EXDEV=18）自动降级为 copy+rm，同目录拖拽无操作但计数告知。

## 02.2 决策与权衡

| 方案 | 优点 | 劣点 | 选定 |
|---|---|---|---|
| **单 invoke 批量移动** | 原子性强，一次往返，toast 统计清晰（moved/failed/skipped） | 后端需处理多种失败情况 | ✅ 采纳 |
| 逐个 invoke | 简单，失败单条处理 | 来回次数多，原子性差，用户无法统一了解结果 | ❌ |
| 前端先删除选中状态再移动 | 避免移动后再清选中 | 视觉抖动，用户可能误解 | ❌ |

**不变量：**
- 不能移动文件夹到自身或其子目录内（拓扑禁止）
- 同目录拖拽不操作（无损，但计数到 `skippedSameDir`）
- 跨设备（挂载点不同）时 copy_dir_recursive + remove 降级

## 02.3 实现拓扑

```
User Drags File/Folder
        ↓
   [handleDragStart]  记录 file.id 到 dataTransfer
        ↓
   [handleDragOver]   
     ├─ 若目标是 folder → 高亮 (dragOverFolderId = target.id)
     └─ 设置 dropEffect = 'move'
        ↓
   [handleDragLeave]  清理高亮 (relatedTarget.contains 防嵌套误清)
        ↓
   [handleDrop]
     ├─ 获取所有选中文件（包含主体）
     ├─ 调后端 moveFiles(srcs, dstDir)
     └─ 处理结果：moved / failed / skippedSameDir
        ↓
   [后端 move_files]
     ├─ 逐个文件检查
     │  ├─ 源不存在 → failed
     │  ├─ 父目录 == 目标 → skippedSameDir++
     │  ├─ 目标在源内 → failed（拓扑禁止）
     │  └─ 尝试 fs::rename
     │       ├─ 成功 → moved
     │       └─ EXDEV=18 → copy+rm 降级
     └─ 返回汇总结果
        ↓
   [前端 toast]  按 moved/failed/skipped 显示反馈
```

## 02.4 关键文件 & 行号

| 文件 | 行号 | 描述 |
|---|---|---|
| `src-tauri/src/lib.rs` | 378-471 | `move_files()` 命令实现，含 EXDEV 降级、拓扑检查 |
| `src-tauri/src/lib.rs` | 968 | 命令注册到 Tauri 插件 |
| `src/api/filesystem.ts` | 54-66 | `MoveResult` / `moveFiles()` TypeScript 接口 & 包装 |
| `src/components/ExplorerView.tsx` | 76 | `dragOverFolderId` state 声明 |
| `src/components/ExplorerView.tsx` | 785-801 | 四个 handlers：dragStart / dragOver / dragLeave / dragEnd |
| `src/components/ExplorerView.tsx` | 803-835 | `handleDrop`：获取选中文件、调 moveFiles、处理结果 |
| `src/components/ExplorerView.tsx` | 922 | `isDropTarget` 计算（高亮条件） |
| `src/components/ExplorerView.tsx` | 943-945, 1003-1005, 1053-1055 | List / Column / Grid 三视图的拖拽事件绑定 |
| `src/components/ExplorerView.tsx` | 956, 1015, 1066 | 高亮 className：`ring-4 ring-primary scale-[1.01]` |
| `src/i18n/locales/en.ts` | 213-214 | `partialMove` / `sameDirectory` i18n keys |
| `src/i18n/locales/zh.ts` | 226-227 | 中文翻译 |

## 02.5 数据契约

### MoveResult (后端→前端)

```typescript
interface MoveResult {
  moved: string[];              // 成功移动的文件完整路径
  failed: MoveFailure[];        // 失败列表 { src, error }
  skippedSameDir: number;       // 同目录被跳过的计数
}

interface MoveFailure {
  src: string;                  // 源路径
  error: string;                // 错误描述（中文）
}
```

### 错误信息种类

| 错误 | 根因 | 用户感知 |
|---|---|---|
| `"源不存在"` | 文件被外部删除 | Move 失败 |
| `"目标在源目录内"` | 拖到自身/子目录 | 操作被禁止 |
| `"目标不是目录"` | 程序 bug（不应该发生） | 操作失败 |
| `"跨设备复制失败: xxx"` | copy_dir_recursive 失败 | Move 失败 |
| `"已复制但源删除失败: xxx"` | 跨设备时 copy 成功但 rm 失败 | Move 部分成功（源仍存） |
| `"xxx"` (其他 fs::rename 错误) | 权限、磁盘满、符号链接循环等 | Move 失败 |

## 02.6 状态机 / 生命周期

```
[Idle]
  ↓ DragStart (fileId)
[Dragging]
  ├─ DragOver (target=folder)  → [DragOver: target高亮]
  ├─ DragLeave (target)        → [DragOver: 清高亮]
  └─ DragEnd                   → [Idle]（用户中止）
  ↓ Drop (target=folder)
[Processing]  （调 moveFiles 中）
  ↓ Response (result)
[Done]  （toast 显示）
  ↓
[Idle]
```

## 02.7 失败模式与排查

| 现象 | 根因 | 排查 / 修复 |
|---|---|---|
| 拖拽文件夹到目标，目标高亮但 drop 无反应 | 目标不是 folder 类型，或 file.type 与实际不符 | 检查 `isDropTarget` 条件；grep `file.type === 'folder'` 确认绑定 |
| 移动后文件仍在源位置（跨设备） | copy_dir_recursive 部分成功，remove 失败 | 手工检查源、目标目录；查看错误消息中"已复制但源删除失败" |
| Toast 显示"已在该目录中"，但没有操作 | 源 / 目标父目录判定有误 | 检查 `src_path.parent() == dst`；在后端加日志 |
| 同目录拖拽无操作但也没 toast | 前端处理了 `skippedSameDir` 但没转 toast | 查看 handleDrop 的 skippedSameDir > 0 分支 |
| 拖拽时高亮不清 / 嵌套时误清 | handleDragLeave 的 relatedTarget 判定不准 | 检查 `e.currentTarget.contains(related)`；可加日志看 relatedTarget |

## 02.8 SOP

### 测试清单（手工）

1. **基础拖拽**：拖单个文件到其他文件夹 → 文件应移入
2. **多选拖拽**：Cmd/Shift 选多个文件 → 一起拖拽 → 全部移入
3. **同目录**：在当前目录内拖拽 → toast 提示"已在该目录中"，无操作
4. **禁止自身**：拖文件夹到自身 → toast "目标在源目录内"
5. **禁止子目录**：拖文件夹到其子文件夹 → toast "目标在源目录内"
6. **三种视图**：List / Column / Grid 都应支持拖拽移动
7. **视觉反馈**：拖拽时目标文件夹应该蓝色高亮 + 微妙放大
8. **拖到文件上**：不应高亮（只有文件夹接受）
9. **跨设备**：若从 USB 拖到内部盘 → 应自动 copy+rm 而非原地不动
10. **权限问题**：拖到只读目录 → toast 显示具体权限错误
11. **删除仍可用**：拖拽完后删除文件应仍工作（无副作用）

### 代码变更清单（若重构）

- [ ] 后端 `move_files()` 的错误分支应在 git log 中有测试用例
- [ ] 前端 `isDropTarget` 计算更新时，确认三视图都同步修改
- [ ] i18n key 若增删，检查 `zh.ts` 和 `en.ts` 是否同步
- [ ] 跨设备检测的 EXDEV=18 仅适用 macOS/Linux；Windows 使用 ERROR_NOT_SAME_DEVICE（5）

## 02.9 经验教训

1. **原子性来自后端而非前端排列**  
   初初设想前端逐个调 moveFile，但这样即使部分失败用户也无法一眼看出汇总结果。改为后端 `move_files()` 单 invoke，返回 `{ moved, failed, skippedSameDir }` 后，toast 能清晰说"移了 5 个，失败 1 个，跳过 2 个同目录的"。

2. **dragOverFolderId state 需跟踪，不能只靠 CSS hover**  
   DragOver 是一个**序列事件**（频繁触发），不能靠单次 hover 决定高亮；需 state 记住"当前哪个文件夹在被拖到"。否则快速拖拽时高亮会闪烁或不出现。

3. **relatedTarget 的包含关系要小心**  
   DragLeave 触发时，relatedTarget 可能是子元素（如文件名文本）。直接清高亮会导致嵌套的拖拽容器误清。必须用 `e.currentTarget.contains(related)` 来判断是否真正离开了盒子。

4. **跨设备降级必须有备手段**  
   macOS / Linux 用 fs::rename 跨挂载点会报 EXDEV=18。初初想"算了，告诉用户失败"，但实际 copy_dir_recursive + remove 是可靠的备手段，只是慢一点。加上后，用户拖 USB 到内部盘时不再卡壳。

5. **同目录拖拽不是错，是 UX 考量**  
   同目录拖拽应该 no-op（不动，不报错），但需要在 result 中计数 skippedSameDir。用户可能意外拖拽，收到"已在该目录中"时能理解（而非奇怪的失败）。

6. **三视图的拖拽绑定要逐个同步**  
   List / Column / Grid 各有自己的 item 渲染逻辑。拖拽事件和 isDropTarget 计算需要在**每个视图**都手动添加。容易漏掉其中一个。建议 handler 提取为公共方法，视图层只做数据绑定。

## 02.10 未来扩展

- **修饰键支持**（Option/Cmd 复制）：目前 drop 总是 move；若用户按 Cmd，dataTransfer.effectAllowed 应改为 'copy'，后端需新增 copyFiles()
- **Sidebar 快捷文件夹接 drop**：当前只有 Explorer 的 file-item 接 drop；可扩展到 Sidebar 的位置条目，如拖文件到"下载"文件夹
- **面包屑导航接 drop**：拖文件到面包屑中某个上级目录
- **自动展开嵌套文件夹**：长按拖拽悬停某个文件夹 >1s 时自动打开，便于拖到更深的目录
- **回收站 drop**：拖到"废纸篓"按钮时自动删除（需确认或直接删）

## 02.11 2026-05-15 增量

### 新增能力

- **同名冲突改为用户选择**：后端 `move_files` 支持 `Abort / Replace / KeepBoth` 三策略，`Abort` 时先返回冲突清单，前端弹窗让用户选（`src-tauri/src/lib.rs:390`, `src-tauri/src/lib.rs:416`, `src/components/ExplorerView.tsx:2910`）。
- **拖拽跟手预览恢复**：改为内部鼠标拖拽状态机 + 浮层预览，拖拽过程可看到当前目标文件夹（`src/components/ExplorerView.tsx:849`, `src/components/ExplorerView.tsx:896`, `src/components/ExplorerView.tsx:1111`）。
- **文件名禁用蓝底选中文本**：文件项容器和名称文本统一加 `select-none`，避免拖拽上划时文件名出现系统文字选中态（`src/components/ExplorerView.tsx:1199`, `src/components/ExplorerView.tsx:1218`, `src/components/ExplorerView.tsx:1260`, `src/components/ExplorerView.tsx:1312`）。
- **右键菜单补“复制文件名”**：原生风格和系统风格两个菜单都加了同一动作，并补 `nameCopied` 提示文案（`src/components/ExplorerView.tsx:1568`, `src/components/ExplorerView.tsx:2844`, `src/i18n/locales/zh.ts:236`, `src/i18n/locales/en.ts:223`）。

### 经验补充

1. 冲突处理不能内建“自动重命名”默认行为。默认必须是 `Abort`，让 UI 先拿到冲突上下文再由用户决策；否则会造成用户对结果不可预期。
2. 浏览器原生 `dragstart` 在复杂布局下容易丢目标命中，内部鼠标拖拽状态机更稳定，但要同步做好 `dragPreview` 清理，防止卡住悬浮层。
3. 拖拽视觉反馈要和文本选择策略联动。只做 ring 高亮不够，若不禁文本选中，用户仍会误判为“选择文本而非拖文件”。

## 02.12 2026-05-15 跨窗口增量

### 新增能力

- **跨窗口文件剪贴板**：复制/剪切不再放在单个 `ExplorerView` 的 React ref 中，改为 Rust app state 里的 `FileClipboardState`，所有 Tauri WebView 共用同一份文件路径载荷（`src-tauri/src/lib.rs:55`, `src-tauri/src/lib.rs:395`, `src/api/filesystem.ts:59`, `src/components/ExplorerView.tsx:210`）。
- **跨窗口拖拽移动**：拖拽开始时写入 `FileDragState`，同时广播 `aether-file-drag-start` 给其他窗口；目标窗口即使拿不到跨 WebView 的自定义 `dataTransfer` 类型，也会进入可 drop 状态，并在 drop 时按共享 paths 移动（`src-tauri/src/lib.rs:56`, `src-tauri/src/lib.rs:425`, `src/components/ExplorerView.tsx:206`, `src/components/ExplorerView.tsx:229`, `src/components/ExplorerView.tsx:256`, `src/components/ExplorerView.tsx:1215`）。
- **空白区域也可接收跨窗口移动**：拖到另一个窗口的当前目录空白处，会移动到该窗口当前目录；拖到文件夹 item 上则移动进该文件夹（`src/components/ExplorerView.tsx:1006`, `src/components/ExplorerView.tsx:1013`, `src/components/ExplorerView.tsx:1179`）。
- **剪切粘贴复用冲突选择**：跨窗口剪切粘贴走 `move_files(..., Abort)`，遇到同名冲突仍弹用户选择，不再用旧的 `move_file` 自动重命名路径（`src/components/ExplorerView.tsx:224`, `src/components/ExplorerView.tsx:234`, `src/components/ExplorerView.tsx:1056`）。
- **复制粘贴也复用冲突选择**：新增 `copy_files(..., Abort / Replace / KeepBoth)`，复制粘贴默认先返回同名冲突并弹选择；只有用户点“保留两者”才走自动重命名（`src-tauri/src/lib.rs:488`, `src-tauri/src/lib.rs:495`, `src/api/filesystem.ts:50`, `src/components/ExplorerView.tsx:1181`, `src/components/ExplorerView.tsx:1226`）。
- **快捷键语义回归文件管理器**：`Cmd+C` 写文件剪贴板，`Cmd+X` 写剪切状态，`Cmd+V` 从 app 级文件剪贴板粘贴；复制路径仍由右键菜单提供（`src/components/ExplorerView.tsx:691`, `src/components/ExplorerView.tsx:697`, `src/components/ExplorerView.tsx:706`）。

### 经验补充

1. 多窗口 Tauri 是多 WebView，不共享 React 内存。任何希望跨窗口生效的文件操作状态，都不能只放 `useRef` / component state，至少要放到 Rust app state 或系统剪贴板。
2. 跨窗口拖拽必须传 `path`，不能传 `file.id` 后让目标窗口二次解析。目标窗口的 `files` / `columnFilesCache` 只代表它当前看得见的目录，源窗口选中的文件在目标窗口通常不存在。
3. 复制和移动必须共享“默认询问用户”的冲突策略。单文件 `copy_file` 仍可用于 Finder 导入等非剪贴板路径，但 app 内复制粘贴必须走 `copy_files(..., Abort)`，否则会绕过用户选择直接重命名。

## 02.13 2026-05-15 菜单与置顶增量

### 新增能力

- **多窗口右键先置顶再开菜单**：文件展示区右键链路改为先激活当前窗口，再展示菜单，降低“底下窗口弹菜单但窗口仍在下层”的竞态（`src/components/ExplorerView.tsx:224`, `src/components/ExplorerView.tsx:1798`, `src/components/ExplorerView.tsx:1925`, `src/components/ExplorerView.tsx:2664`）。
- **全局右键兜底置顶**：在 App 顶层捕获阶段监听 `contextmenu` 并触发 `setFocus`，覆盖导航栏、侧边栏和设置页等非文件展示区（`src/App.tsx:147`）。
- **原生设计菜单定位收敛**：自绘菜单位置从“固定宽高估算”改为“首帧估算 + 实际尺寸回填 + 视口夹取”，减少边缘场景偏离鼠标过远（`src/components/ExplorerView.tsx:358`, `src/components/ExplorerView.tsx:443`, `src/components/ExplorerView.tsx:3086`）。

### 经验补充

1. 右键菜单定位不能只用常量宽高。菜单项数量、分组和窗口高度都会影响真实尺寸，常量估算会在屏幕边缘产生“过度回退”。
2. 多窗口下“菜单显示”和“窗口置顶”是两条异步链路，必须让置顶先发生或至少同帧触发，否则用户看到的是菜单先出、窗口后上来，感知就是错位。
