# 跨窗口拖拽复制文件 — 设计方案

> 起草日期：2026-05-16
> 状态：未实现（同窗口拖入子文件夹已可用；同窗口外拖即丢失）
> 难度：⭐⭐⭐⭐（需要克服 WebView 沙箱 + 跨进程协议）

---

## 一、为什么这是难题（先把幻觉打破）

### 1.1 HTML5 Drag & Drop 在跨窗口场景下的根本限制

浏览器/WebView 的 `dragstart` → `dragend` 整套事件是**窗口级私有上下文**：

- `dataTransfer` 对象在源窗口的 JS 内存里，目标窗口 JS **无法访问**
- 同窗口内的 `e.dataTransfer.getData(MIME)` 在目标 `onDrop` 里可读，**跨窗口直接失效**
- WebKit/Chromium 在系统层处理拖拽时，**只有特定 OS-level MIME 类型**（如 `public.file-url`、`NSFilenamesPboardType`、`text/uri-list`）会被转交给系统拖拽板，从而能被其他进程窗口看到
- Tauri 的 WebView 默认**不能向系统拖拽板写入文件引用** — 这是 webview2 / wkwebview 的安全限制，不是 Tauri 的 bug

### 1.2 当前代码已经踩过的坑

`src/components/ExplorerView.tsx:36-37`：

```ts
const FILE_DRAG_START_EVENT = 'aether-file-drag-start';
const FILE_DRAG_END_EVENT = 'aether-file-drag-end';
```

`src/components/ExplorerView.tsx:267-297`：

```ts
const markAppFileDragActive = () => {
  setIsAppFileDragActive(true);
  // ... 7 秒超时
};
```

**说明开发者已经意识到** "目标窗口看不到 dataTransfer"，所以走了 Tauri event + 后端 state 的兜底（`setFileDragPayload` → Rust `FileDragState` Mutex → 任何窗口 `getFileDragPayload` 读）。

但还差最后一步：**目标窗口要怎么知道"现在有拖拽进入我了"，并且渲染放置区？**

这正是 `TopBar.tsx` 跨窗口"标签页拖拽"的做法 — 但**标签页拖拽是『窗口标题栏区域』**，而文件拖拽要把整个文件浏览区都变成放置目标。这两者难度不在一个级别。

---

## 二、根因：三种「跨窗口拖拽」分别需要不同方案

业界惯例（Finder、ForkLift、VSCode、Figma）实际上是**三种独立机制叠加**：

| 场景 | 现在做什么 | 缺什么 | 难度 |
|------|-----------|--------|------|
| **A. 同进程内 Aether 窗口间** | event + Rust state 已有基础 | 目标窗口的"拖入提示"和"释放处理" | ⭐⭐ |
| **B. Aether → Finder / 其他 macOS 应用** | 完全不工作 | WebView 需要写系统拖拽板 | ⭐⭐⭐⭐⭐ |
| **C. Finder / 其他应用 → Aether** | 已部分工作（`'Files'` MIME 类型走 `handleExternalDrop`，1563 行） | 视觉反馈和多源合并 | ⭐⭐ |

**第一步先把 A 做扎实**，B/C 作为长线目标。

---

## 三、方案 A：同进程多窗口之间拖拽（推荐先做）

### 3.1 整体架构

```
源窗口 A (Webview)              Rust 后端 (主进程)          目标窗口 B (Webview)
─────────────────              ──────────────────          ──────────────────
mousedown on file
   │
   ▼
dragstart
   │ ① writeDragPayload(file)
   │   └→ setFileDragPayload([paths], cut)
   ▼                            ┌──────────────────┐
                                │ FileDragState     │
emit('aether-file-drag-start',  │ paths: [...]     │
     { paths, sourceWindow,     │ sourceWindow: A  │
       previewMeta })           │ cut: true        │
   │                            └──────────────────┘
   ▼ ② 广播开始事件 ─────────────┼──────────────────────────►
                                                       listen('aether-file-drag-start')
                                                       setIncomingDrag(payload)
                                                       渲染 "覆盖层 + 放置提示"
                                                              │
   用户拖到 B 窗口空白                                          ▼
                                                       onMouseEnter / pointermove
                                                       onMouseUp on target folder
                                                              │
                                                              ▼ ③ readTransferPayload()
                                                       getFileDragPayload()
                                                       ◄─────── { paths, ... }
                                                              │
                                                              ▼ ④ executeCopyFiles / executeMoveFiles
                                                       emit('aether-file-drop-accepted',
                                                            { transferId, op: 'copy'|'move' })
                              ◄─────────────────────────────  │
   ▼ ⑤ 源窗口收到 drop-accepted
   清除本地状态、Toast 提示
   clearFileDragPayload()
```

### 3.2 关键设计决策

#### 决策 1：拖拽期间用「pointer 事件」而非 HTML5 拖拽事件

HTML5 `dragstart` 一旦触发，**会被 OS 接管鼠标**，跨窗口的 `dragover` 几乎收不到（只有当 webview 实现写了 `public.file-url` 时才行）。

替代方案：**自定义指针拖拽**（不使用 `draggable` 属性）

```ts
// src/hooks/useCrossWindowDrag.ts
interface CrossWindowDragState {
  active: boolean;
  paths: string[];
  sourceWindow: string;
  preview: { name: string; type: string; count: number };
  pointerX: number;
  pointerY: number;
  monitorBounds?: { x: number; y: number; w: number; h: number };
}

export function useCrossWindowDrag() {
  const [state, setState] = useState<CrossWindowDragState | null>(null);

  // 全局指针监听（仅在 active 时启用）
  useEffect(() => {
    if (!state?.active) return;
    const onMove = (e: PointerEvent) => {
      setState(prev => prev ? { ...prev, pointerX: e.screenX, pointerY: e.screenY } : prev);
      // 通过 Tauri event 广播位置（throttle 16ms）
      throttledEmit('aether-file-drag-move', { x: e.screenX, y: e.screenY });
    };
    const onUp = (e: PointerEvent) => {
      // 找到指针下哪个窗口/元素接收
      finalize(e);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [state?.active]);

  // ...
}
```

**问题**：源窗口的 `pointermove` 一旦离开源窗口边界，源窗口收不到了。**这就是核心难题。**

#### 决策 2：用 Rust 端 NSEvent global monitor 解决"出窗口失联"

macOS 上可用 `CGEventTap` 或 `NSEvent.addGlobalMonitorForEvents` 监听全局鼠标。Rust 端在拖拽期间打开一个全局监听器，把指针位置实时广播给所有窗口。

```rust
// src-tauri/src/macos/pointer_monitor.rs
use objc2::rc::Retained;
use objc2_app_kit::{NSEvent, NSEventMask};
use objc2_foundation::MainThreadMarker;

pub struct PointerMonitor {
    handle: Option<Retained<objc2::runtime::AnyObject>>,
}

impl PointerMonitor {
    pub fn start<F>(callback: F) -> Self
    where
        F: Fn(f64, f64) + Send + 'static,
    {
        let mtm = MainThreadMarker::new().unwrap();
        let handler = block2::RcBlock::new(move |event: *mut NSEvent| {
            let event = unsafe { &*event };
            let location = event.locationInWindow();
            callback(location.x, location.y);
        });
        let handle = unsafe {
            NSEvent::addGlobalMonitorForEventsMatchingMask_handler(
                NSEventMask::MouseMoved | NSEventMask::LeftMouseUp,
                &handler,
            )
        };
        Self { handle }
    }

    pub fn stop(&mut self) {
        if let Some(h) = self.handle.take() {
            unsafe { NSEvent::removeMonitor(&h) };
        }
    }
}
```

**简化版**（不引 objc2，用 CGEventTap）：

```rust
// 用 core-graphics crate
use core_graphics::event::{CGEvent, CGEventTap, CGEventTapLocation};

// 启动时
let tap = CGEventTap::new(
    CGEventTapLocation::Session,
    CGEventTapPlacement::HeadInsertEventTap,
    CGEventTapOptions::ListenOnly,
    vec![CGEventType::MouseMoved, CGEventType::LeftMouseUp],
    |_proxy, event_type, event| {
        let loc = event.location();
        let _ = APP_HANDLE.emit("aether-global-pointer", (loc.x, loc.y, event_type));
        None
    },
)?;
```

**前置条件**：需要"输入监控"权限（macOS Sequoia+ 会弹授权框）。仅在拖拽开始时启用、结束立即停止，授权对话框只在第一次出现。

#### 决策 3：哪个窗口"接收"由 Rust 决定

每个窗口的位置/大小可通过 Tauri `WebviewWindow::outer_position()` + `outer_size()` 拿到。Rust 端维护"窗口边界表"，每次 pointermove 广播时附带"当前指针在哪个窗口内"：

```rust
#[derive(Serialize, Clone)]
struct DragPointerUpdate {
    x: f64,
    y: f64,
    over_window: Option<String>,  // window label
}

fn find_window_at(app: &tauri::AppHandle, x: f64, y: f64) -> Option<String> {
    let windows = app.webview_windows();
    // 按 z-order 倒序（最上面的窗口先匹配）— Tauri 不直接给 z-order，需要自维护
    for (label, win) in windows.iter() {
        if let (Ok(pos), Ok(size)) = (win.outer_position(), win.outer_size()) {
            let x0 = pos.x as f64;
            let y0 = pos.y as f64;
            let x1 = x0 + size.width as f64;
            let y1 = y0 + size.height as f64;
            if x >= x0 && x <= x1 && y >= y0 && y <= y1 {
                return Some(label.clone());
            }
        }
    }
    None
}
```

只把"指针在我窗口内"事件分派给对应窗口，其他窗口收到 "leave"。

#### 决策 4：放置目标的视觉反馈

目标窗口收到 `aether-file-drag-enter` 后，整个文件浏览区盖一层半透明覆盖："拖到这里复制到 `currentPath`"。指针下方如果落到一个具体文件夹卡片，那个卡片高亮。

```tsx
// src/components/ExplorerView.tsx
const [incomingDrag, setIncomingDrag] = useState<IncomingDragState | null>(null);

useEffect(() => {
  const unlistens: Array<() => void> = [];

  listen<DragPayload>('aether-file-drag-enter', ({ payload }) => {
    if (payload.sourceWindow === getCurrentWindow().label) return;
    setIncomingDrag({
      paths: payload.paths,
      sourceWindow: payload.sourceWindow,
      preview: payload.preview,
    });
  }).then(fn => unlistens.push(fn));

  listen('aether-file-drag-leave', () => setIncomingDrag(null)).then(fn => unlistens.push(fn));
  listen('aether-file-drag-end', () => setIncomingDrag(null)).then(fn => unlistens.push(fn));

  return () => unlistens.forEach(fn => fn());
}, []);

// 全局指针位置 → 找到指针下的文件夹
const [hoveredFolderPath, setHoveredFolderPath] = useState<string | null>(null);

useEffect(() => {
  if (!incomingDrag) return;
  const unlisten = listen<{ x: number; y: number }>('aether-global-pointer', ({ payload }) => {
    const el = document.elementFromPoint(payload.x - windowX, payload.y - windowY);
    const folderEl = el?.closest('[data-folder-path]') as HTMLElement | null;
    setHoveredFolderPath(folderEl?.dataset.folderPath ?? null);
  });
  return () => { unlisten.then(fn => fn()); };
}, [incomingDrag]);
```

#### 决策 5：mouseup 时确定操作语义

放置时：
- 默认：复制（与 Finder 跨卷一致）
- 按住 Option（macOS）：复制
- 按住 Cmd：移动
- 按住 Shift：创建替身

```ts
const finalize = async (e: PointerEvent) => {
  const op = e.metaKey ? 'move' : e.shiftKey ? 'alias' : 'copy';
  const target = hoveredFolderPath ?? currentPath;

  if (op === 'copy') await executeCopyFiles(makeFileItemsFromPaths(incomingDrag.paths), makeFolderItemFromPath(target), 'abort');
  if (op === 'move') await executeMoveFiles(makeFileItemsFromPaths(incomingDrag.paths), makeFolderItemFromPath(target), 'abort');
  if (op === 'alias') await Promise.all(incomingDrag.paths.map(p => makeAlias(p)));

  // 通知源窗口
  await emitTo(incomingDrag.sourceWindow, 'aether-file-drop-accepted', {
    paths: incomingDrag.paths,
    op,
    targetWindow: getCurrentWindow().label,
  });
};
```

#### 决策 6：源窗口的"拖拽预览"跟随指针

源窗口在 dragstart 时显示一个浮动 chip（"3 个文件"），由 Rust 全局 pointer 事件驱动它的位置 — 出窗口边界后用一个**临时透明无边框窗口**承载该 chip：

```rust
#[tauri::command]
async fn create_drag_preview_window(
    app: tauri::AppHandle,
    label: String,
    count: u32,
    icon_path: Option<String>,
) -> Result<(), String> {
    let window = WebviewWindowBuilder::new(&app, "drag-preview",
        WebviewUrl::App(format!("drag-preview.html?label={}&count={}", url_encode(&label), count).into()))
        .inner_size(120.0, 60.0)
        .decorations(false)
        .transparent(true)
        .always_on_top(true)
        .skip_taskbar(true)
        .focused(false)
        .visible(true)
        .build()
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
async fn move_drag_preview_window(app: tauri::AppHandle, x: f64, y: f64) -> Result<(), String> {
    if let Some(w) = app.get_webview_window("drag-preview") {
        w.set_position(tauri::Position::Physical(tauri::PhysicalPosition {
            x: (x + 12.0) as i32,
            y: (y + 12.0) as i32,
        })).map_err(|e| e.to_string())?;
    }
    Ok(())
}
```

这就是 Finder 拖拽时跟随鼠标的那个"小角标"的实现思路。

---

## 四、方案 A 的最小实现路径（MVP）

如果不想一上来就接 CGEventTap 和无边框预览窗口，可以分两步：

### MVP 阶段 1：保持 HTML5 拖拽 + 兜底机制（1-2 天）

**思路**：放弃"出窗口"的精确指针追踪，改成 **拖出窗口 0.5s 自动转新窗口 / 点击目标窗口完成传输**。

这正是你现在 `TopBar.tsx` 跨窗口"标签页拖拽"的策略 — 把它**复制到文件拖拽**：

1. 源窗口 dragstart：写 `FileDragState`、emit `aether-file-drag-start`、显示视觉指示
2. 源窗口 dragend，`dropEffect === 'none'`：弹出 toast "已就绪 — 切换到目标窗口点击放置区"
3. 目标窗口收到 `aether-file-drag-start`：整个 ExplorerView 区域出现"点击放置 N 个文件"半透明 banner
4. 目标窗口任意点击该 banner：调 `getFileDragPayload()` 拿数据，执行 copy/move
5. 5-7 秒超时自动清空 state

#### 改动文件清单（MVP 阶段 1）

```
src/components/ExplorerView.tsx
  - 新增 incomingDrag state + 监听 aether-file-drag-start
  - 渲染"点击放置区" overlay（在 file-list 容器外层）
  - 容器 onClick 时判断 incomingDrag 是否存在 → 执行 copy
  - 现有 handleDragEnd: 改为延迟 500ms 不清理 payload，等目标窗口接收

src-tauri/src/lib.rs
  - 已有 FileDragState，无需大改
  - 新增 set_file_drag_metadata 携带 sourceWindow / count / preview 信息
```

具体代码（最小补丁）：

```ts
// ExplorerView.tsx 顶部新增 state
const [incomingFileDrag, setIncomingFileDrag] = useState<{
  paths: string[];
  sourceWindow: string;
  count: number;
  previewName: string;
} | null>(null);

useEffect(() => {
  if (!isActive) return;
  const unlistens: Array<() => void> = [];
  let pendingTimer: number | null = null;

  listen<{ paths: string[]; sourceWindow: string; count: number; previewName: string }>(
    FILE_DRAG_START_EVENT,
    ({ payload }) => {
      if (payload.sourceWindow === getCurrentWindow().label) return;
      setIncomingFileDrag(payload);
      if (pendingTimer) clearTimeout(pendingTimer);
      pendingTimer = window.setTimeout(() => setIncomingFileDrag(null), 7000);
    },
  ).then(fn => unlistens.push(fn));

  listen(FILE_DRAG_END_EVENT, () => {
    setIncomingFileDrag(null);
    if (pendingTimer) clearTimeout(pendingTimer);
  }).then(fn => unlistens.push(fn));

  return () => {
    unlistens.forEach(fn => fn());
    if (pendingTimer) clearTimeout(pendingTimer);
  };
}, [isActive]);

const handleIncomingDrop = async (op: 'copy' | 'move') => {
  if (!incomingFileDrag) return;
  const items = makeFileItemsFromPaths(incomingFileDrag.paths);
  const targetFolder = makeFolderItemFromPath(currentPath);

  try {
    if (op === 'copy') {
      await executeCopyFiles(items, targetFolder, 'abort');
    } else {
      await executeMoveFiles(items, targetFolder, 'abort', { clearDragPayloadOnSuccess: true });
    }
    showFeedback(`已${op === 'copy' ? '复制' : '移动'} ${items.length} 项到当前目录`);
    await emitTo(incomingFileDrag.sourceWindow, 'aether-file-drop-accepted', {
      paths: incomingFileDrag.paths,
      op,
      targetWindow: getCurrentWindow().label,
    });
  } catch (e) {
    showFeedback(`接收文件失败：${String(e)}`);
  } finally {
    setIncomingFileDrag(null);
  }
};
```

```tsx
// 在 ExplorerView 主容器内（文件列表外层）渲染 banner
{incomingFileDrag && (
  <div className="absolute inset-0 z-40 pointer-events-auto bg-primary/15 backdrop-blur-md border-2 border-dashed border-primary rounded-2xl flex items-center justify-center"
       onClick={(e) => {
         e.stopPropagation();
         handleIncomingDrop(e.metaKey ? 'move' : 'copy');
       }}>
    <div className="bg-surface/95 rounded-2xl px-6 py-4 shadow-2xl text-center">
      <div className="text-on-surface font-bold text-base mb-1">
        来自其他窗口的 {incomingFileDrag.count} 个文件
      </div>
      <div className="text-on-surface/70 text-sm">
        点击放置到 <span className="text-primary font-semibold">{currentPath}</span>
      </div>
      <div className="text-on-surface/50 text-xs mt-2">
        按 ⌘ 点击 → 移动 · 普通点击 → 复制
      </div>
    </div>
  </div>
)}
```

```ts
// 在 writeDragPayload 增强 emit 数据
void setFileDragPayload(paths, true)
  .then(() => emit(FILE_DRAG_START_EVENT, {
    paths,
    sourceWindow: getCurrentWindow().label,
    count: paths.length,
    previewName: file.name,
  }))
  .catch(() => {});
```

```ts
// handleDragEnd 调整：延迟 1.5s 才清 payload，给用户时间切窗口
const handleDragEnd = () => {
  draggedFileIdRef.current = null;
  setDragPreview(null);
  if (dragOverFolderId !== null) setDragOverFolderId(null);
  finishSharedFileDrag(1500);  // 之前是 600
};
```

```ts
// 源窗口收到 drop-accepted 时清理本地
useEffect(() => {
  const unlisten = listen<{ paths: string[]; op: string; targetWindow: string }>(
    'aether-file-drop-accepted',
    ({ payload }) => {
      if (payload.op === 'move') {
        // 源目录的文件已经被移走，刷新本目录
        refreshCurrentDir();
        showFeedback(`已传输 ${payload.paths.length} 项到 ${payload.targetWindow}`);
      } else {
        showFeedback(`已复制 ${payload.paths.length} 项到其他窗口`);
      }
      finishSharedFileDrag(0);
    },
  );
  return () => { unlisten.then(fn => fn()); };
}, []);
```

**MVP 阶段 1 体感**：
- 用户从窗口 A 拖文件 → 拖出窗口边界
- 屏幕上没有指针跟随小角标（这是缺陷），但**窗口 B 立即出现"点击放置"提示**
- 用户切到窗口 B（点窗口任意位置就能切焦点）→ 点击 banner
- 文件被复制/移动到窗口 B 的当前目录

**已经能用**，体验比 Finder 差但不输给 ForkLift 在某些场景下的"暂存"逻辑。

### MVP 阶段 2：加上"指针跟随小角标"（再 2-3 天）

加 Rust CGEventTap + 无边框 always-on-top 预览窗口（决策 6）。让"小红圈跟着指针走"。

不必上 NSEvent global monitor — 用 Rust 端轮询 `CGEventGetLocation` 即可（30Hz 足够）：

```rust
use core_graphics::event::CGEvent;
use core_graphics::event_source::{CGEventSource, CGEventSourceStateID};

#[tauri::command]
async fn start_pointer_tracking(app: tauri::AppHandle) -> Result<(), String> {
    let app_clone = app.clone();
    tokio::spawn(async move {
        let source = CGEventSource::new(CGEventSourceStateID::HIDSystemState)
            .map_err(|_| "cannot create event source")?;
        loop {
            tokio::time::sleep(std::time::Duration::from_millis(33)).await;
            let location = CGEvent::new(source.clone())
                .ok()
                .and_then(|e| Some(e.location()));
            if let Some(loc) = location {
                let _ = app_clone.emit("aether-global-pointer", (loc.x, loc.y));
                if let Some(w) = app_clone.get_webview_window("drag-preview") {
                    let _ = w.set_position(tauri::Position::Physical(
                        tauri::PhysicalPosition { x: (loc.x + 12.0) as i32, y: (loc.y + 12.0) as i32 }
                    ));
                }
            }
            // 检查全局拖拽状态 — 拖拽结束就退出循环
        }
    });
    Ok(())
}
```

### MVP 阶段 3：放置时按区域决定目标目录（再 2 天）

不再只接受"当前目录"作为目标。指针落在哪个文件夹卡片上，就放入哪个文件夹：

```ts
useEffect(() => {
  if (!incomingFileDrag) return;
  const unlisten = listen<[number, number]>('aether-global-pointer', ({ payload: [x, y] }) => {
    // 转换屏幕坐标到当前窗口坐标
    const win = getCurrentWindow();
    win.outerPosition().then(({ x: wx, y: wy }) => {
      const el = document.elementFromPoint(x - wx, y - wy);
      const folderEl = el?.closest('[data-folder-path]') as HTMLElement | null;
      setIncomingHoveredFolder(folderEl?.dataset.folderPath ?? null);
    });
  });
  return () => { unlisten.then(fn => fn()); };
}, [incomingFileDrag]);
```

文件夹卡片上加 `data-folder-path={file.path}`。`incomingHoveredFolder` 不为空就高亮那个卡片。

---

## 五、方案 B：Aether → Finder / 其他 macOS 应用（长线）

### 5.1 难点

WebView 内 `dragstart` 设置 `text/plain` 或 `text/uri-list` 时，**系统拖拽板只会得到字符串文本**。要让 Finder 接收为"文件引用"，需要写 macOS 私有 pasteboard 类型：

- `public.file-url`：单个文件 URL（NSURL）
- `NSFilenamesPboardType`：文件路径数组（已废弃但仍工作）
- `public.url`：通用 URL

WKWebView 不暴露这些 API，所以**前端 JS 无法直接做到**。

### 5.2 解决路径

**拦截 NSDraggingSource**：

Tauri 没暴露 wkwebview 的 dragging delegate。需要：

1. 在 Rust 端通过 `objc2` 拿到 NSView（webview 容器）
2. 替换其 `draggingSourceOperationMaskForLocal:` 实现
3. 自实现 NSPasteboardWriter 协议，把 Aether 的拖拽数据转成 `public.file-url`

这是一个**1-2 周的纯 native 工作**，跟 Aether 主要业务无关。

**短期替代**：在 ExplorerView 加"导出到 Finder"按钮 — 调 `reveal_in_finder` 打开父目录并选中，让用户继续在 Finder 操作。不优雅但能用。

当前分支已验证该方向：真正系统拖出暂不做 native pasteboard；拖出 Aether 窗口且未被其它 Aether 窗口接收时，会明确提示用户改用"在 Finder 中显示"继续操作，避免静默失败。

---

## 六、方案 C：Finder → Aether（已部分工作，需完善）

### 6.1 当前状态

`ExplorerView.tsx:1563`：

```ts
if (getDragTypes(e.dataTransfer).includes('Files')) {
  await handleExternalDrop(e, targetFolder.path);
  return;
}
```

证明已经能识别系统拖入的 `Files` 类型。但只在拖到**具体文件夹卡片**才工作，拖到空白处不行。

### 6.2 修复

容器层（不只是文件夹卡片）加 `onDragOver` / `onDrop`，使空白区域也能接收：

```tsx
// 文件列表容器
<div
  className="..."
  onDragOver={(e) => {
    if (e.dataTransfer.types.includes('Files')) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      setShowExternalDropOverlay(true);
    }
  }}
  onDragLeave={(e) => {
    const related = e.relatedTarget as Node | null;
    if (!related || !e.currentTarget.contains(related)) {
      setShowExternalDropOverlay(false);
    }
  }}
  onDrop={async (e) => {
    if (!e.dataTransfer.types.includes('Files')) return;
    e.preventDefault();
    setShowExternalDropOverlay(false);
    await handleExternalDrop(e, currentPath);
  }}
>
  {/* 文件列表 */}
  {showExternalDropOverlay && (
    <div className="absolute inset-0 bg-primary/10 border-2 border-dashed border-primary rounded-2xl pointer-events-none flex items-center justify-center">
      <div className="bg-surface/95 px-6 py-4 rounded-2xl shadow-2xl">
        拖放到此处复制到 <span className="text-primary font-bold">{currentPath}</span>
      </div>
    </div>
  )}
</div>
```

### 6.3 Tauri v2 的 file-drop event 兜底

Tauri 自身有 `WebviewWindow::on_file_drop_event` API，在 webview 层失败时仍能拿到系统拖入：

```rust
.setup(|app| {
    let main_window = app.get_webview_window("main").unwrap();
    main_window.on_file_drop_event(|event| {
        match event {
            tauri::FileDropEvent::Hovered(paths) => { /* emit hover */ }
            tauri::FileDropEvent::Dropped(paths) => { /* emit drop */ }
            tauri::FileDropEvent::Cancelled => { /* emit cancel */ }
            _ => {}
        }
    });
    Ok(())
})
```

把这个事件广播到前端：

```rust
.on_window_event(|window, event| {
    if let tauri::WindowEvent::FileDrop(file_drop) = event {
        let _ = window.emit("tauri-file-drop", file_drop);
    }
})
```

前端监听 `tauri-file-drop`，拿到 paths 后 invoke `copy_files(paths, currentPath)`。这是**最可靠的 Finder→Aether 通道**，因为它绕过了 webview 拖拽板限制。

---

## 七、并发与边界情况

### 7.1 多源同时拖拽

用户从 A 窗口拖一组，还没释放又从 B 窗口拖一组到 C 窗口。当前 `FileDragState` 是单 Mutex<Option<>>，**第二次拖拽会覆盖第一次**。

**修复**：

```rust
struct FileDragState(Mutex<HashMap<String, FileTransferPayload>>);  // key 是 transferId
```

每次 dragstart 生成 `transferId`，event payload 带上，目标窗口处理时按 ID 查 — 多源并行成立。

### 7.2 拖拽过程中源文件被删除

用户拖出文件 → 同时另一个应用删了源文件 → 释放时 copy 失败。

**修复**：`executeCopyFiles` / `executeMoveFiles` 在 Rust 端先检查源存在性，失败时把哪些路径丢了告诉前端，UI 显示部分成功提示。已有 `MoveResult.failed` 字段支持。

### 7.3 取消拖拽

按 Esc 应该取消。

```ts
useEffect(() => {
  if (!isAppFileDragActive) return;
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      finishSharedFileDrag(0);
      void emit(FILE_DRAG_END_EVENT);
    }
  };
  window.addEventListener('keydown', onKey);
  return () => window.removeEventListener('keydown', onKey);
}, [isAppFileDragActive]);
```

### 7.4 跨设备拖拽时弹「复制 vs 移动」对话框

不同卷之间默认是复制，Finder 行为一致。Aether 已在 P1-9（PERF_PLAN）讨论了原子化跨设备移动，配套对话框：

```ts
const finalize = async (e: PointerEvent) => {
  const srcVolume = detectVolume(incomingFileDrag.paths[0]);
  const dstVolume = detectVolume(currentPath);
  let op: 'copy' | 'move' = 'copy';
  if (srcVolume === dstVolume) {
    op = e.altKey ? 'copy' : 'move';  // 同卷默认移动
  } else {
    op = e.metaKey ? 'move' : 'copy'; // 跨卷默认复制
  }
  // ...
};
```

### 7.5 大文件 / 大目录拖拽必须显示进度

直接调 `copyFiles` 会阻塞 UI。结合 `TransferModal`（Tier 8），改造 Rust 端 `copy_files` 为流式进度回调：

```rust
#[tauri::command]
async fn copy_files_with_progress(
    window: tauri::WebviewWindow,
    transfer_id: String,
    srcs: Vec<String>,
    dst_dir: String,
) -> Result<CopyResult, String> {
    let total = compute_total_bytes(&srcs);
    let mut copied_bytes = 0u64;
    // ... 每复制完 chunk 就 emit("transfer-progress", { transferId, copied, total })
}
```

UI 上 TransferModal 监听该事件渲染。

---

## 八、安全考量

跨窗口拖拽**继承所有路径攻击面**（详见 `RELEASE_AUDIT.md` P0-4）。务必：

1. **Rust 端入口校验**：`executeCopyFiles` 收到的 paths 必须 canonicalize，禁止 `..` 跳出
2. **拒绝指向 Aether 自身配置目录的源**：拖 `~/Library/Application Support/com.aether.explorer/` 进 `~/Downloads` 会泄露用户设置/收藏 — 应弹窗警告
3. **超大批量 throttle**：单次拖拽路径数 > 5000 → 警告并要求确认（防止 UI 卡死）
4. **transferId 防重放**：源窗口短时间内连续 dragstart 多次（拖回收等场景）必须每次新 ID

---

## 九、实施路线图

### Sprint 1（3-5 天）— MVP 可用

- [ ] 阶段 1：源端 emit + 目标端 banner + 点击放置（已在第四节给出完整代码）
- [ ] 完善 incomingFileDrag 状态、Esc 取消、超时清理
- [ ] 第六节：方案 C 容器层接收 Finder 拖入
- [ ] 集成测试：双窗口实拖 50 个文件

### Sprint 2（5-7 天）— 体验跃迁

- [ ] CGEventTap 全局指针位置广播
- [ ] 无边框 always-on-top 拖拽预览窗口
- [ ] 指针落在文件夹卡片时高亮 + 改放置目标
- [ ] 修饰键决定 copy/move/alias
- [ ] 多 transferId 并发支持

### Sprint 3（5-10 天）— 完善

- [ ] copy_files_with_progress 进度回调
- [ ] TransferModal 集成
- [ ] 大批量警告 + 路径白名单
- [ ] 跨设备复制策略 + 冲突对话框
- [ ] 取消正在进行的传输

### Sprint 4（长线，1-2 周）— 方案 B 探索

- [ ] objc2 实现 NSDraggingSource pasteboard writer
- [ ] Aether → Finder 真正系统拖出
- [ ] Aether → 邮件附件 / iMessage / 浏览器上传等场景

---

## 十、设计反思

跨窗口拖拽不是技术问题，是**交互范式问题**：

- Finder 跨窗口拖拽体验之所以丝滑，是因为它运行在系统进程内，能直接读 NSDragSession
- Aether 跑在 WebView 沙箱里，**任何"丝滑"都是用 Rust 后台广播 + 多窗口配合假装的**
- 用户对此无感知，但开发者必须有"沙箱越狱"的觉悟

**核心建议**：
1. **不要复制 Finder 的拖拽语义**。Aether 跨窗口拖拽应该坦然展示"中转状态"——例如显式的暂存夹板（IMPROVEMENT_PROPOSALS 9.1）作为补充。让用户拖出 → 暂存 → 在另一个窗口"粘贴自夹板"。
2. **MVP 先做 banner 方案，10% 工作量解决 80% 场景。** 指针跟随小角标是锦上添花。
3. **方案 B（Aether → Finder）暂不投入。** 现实是 99% 用户拖文件就是在 Aether 内做的，跟 Finder 互拖的场景极少。优先级远低于"暂存夹板""命令面板""SFTP"。

---

## 一句话总结

**跨窗口拖拽不是『写更多 onDrop 代码』能解决的问题，是『WebView 沙箱与系统拖拽 API 之间的协议工程』**。

Aether 目前已经把 `FileDragState` + event 的地基铺好了 80%，剩下 20% 是 UI 反馈和指针追踪。

**先用 3 天做出"点击放置 banner"版本上线**——既能验证用户是否真的需要这个功能（搞不好他们都习惯用复制粘贴了），又能为后续 CGEventTap 那套增量铺路。等真有人在 Discord/Issue 区问"为什么不能像 Finder 一样拖小角标"再去做 Sprint 2/3。
