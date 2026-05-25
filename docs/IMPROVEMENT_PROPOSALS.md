# Aether Explorer 持续提升建议（第三波）

> 起草日期：2026-05-16
> 已有文档：`RELEASE_AUDIT.md`（安全/发版红线）、`PERF_PLAN.md`（性能六链路）
> 本文档：**前两份没覆盖**的提升维度 — 从产品力、可维护性、可观测性到长线工程文化

---

## 一、状态管理与数据建模

### 1.1 当前问题：50+ useState 散落在单组件

`ExplorerView.tsx` 含 50+ `useState`，关联状态（如 `loading / loadError / showPermissionDialog`、`renamingFile / renameInput`、`backStack / forwardStack / currentPath / columnPaths`）散在不同 hook 里，每次 setState 都可能踩中其他 effect 的依赖，引发难以预测的级联渲染。

### 建议：引入 reducer + state machine

文件浏览本质就是一个状态机：

```
idle → loading → success | error → idle
                       → permissionDenied → 引导授权 → loading
```

```ts
// src/state/explorer-machine.ts
type ExplorerState =
  | { tag: 'idle' }
  | { tag: 'loading'; path: string }
  | { tag: 'success'; path: string; files: FileItem[] }
  | { tag: 'error'; path: string; error: string; kind: 'permission' | 'notFound' | 'unknown' };

type ExplorerEvent =
  | { type: 'NAVIGATE'; path: string }
  | { type: 'LOAD_SUCCESS'; files: FileItem[] }
  | { type: 'LOAD_ERROR'; error: string; kind: ExplorerState['kind'] }
  | { type: 'PERMISSION_GRANTED' };

function reduce(state: ExplorerState, event: ExplorerEvent): ExplorerState {
  // ... 显式转移
}
```

收益：
- 不可能出现 "loading=true 但 files 也有数据" 的中间态
- 测试只测 reducer 纯函数
- DevTools 时间线清晰

### 1.2 路径栈用错数据结构

`backStack / forwardStack` 是两个 array，每次 navigate 都要 `setBackStack(prev => [...prev, currentPath])`。频繁导航时这是 O(n) 复制。

**改成 cursor 模式**：
```ts
interface History {
  entries: string[];   // append-only
  cursor: number;      // 当前位置
}

function navigate(h: History, path: string): History {
  // 截断 cursor 之后的（forward 失效）
  const entries = h.entries.slice(0, h.cursor + 1).concat(path);
  return { entries, cursor: entries.length - 1 };
}
function back(h: History): History {
  return { ...h, cursor: Math.max(0, h.cursor - 1) };
}
```

整个历史用一个对象表示，O(1) 前进/后退。

### 1.3 文件路径作为 ID 不稳定

`FileItem.id = item.path`（见 `src/api/filesystem.ts` 的文件项构造链路）。重命名后 path 变 → React key 变 → 整个 motion 子树重新挂载 → 跳动+触发动画。

**改成 inode 或稳定 hash**：
```rust
// Rust 端补 ino (inode number)
use std::os::unix::fs::MetadataExt;
let ino = metadata.ino();
```

```ts
interface FileItem {
  id: string;       // = `${ino}-${path}` 或 nanoid 临时分配
  path: string;     // 仍然保留
  inode?: number;
}
```

重命名通过 `inode` 找回原节点，UI 保持位置。

---

## 二、错误处理与韧性

### 2.1 当前：错误是字符串模板，前端只能 toString 显示

```rust
.map_err(|e| format!("无法读取目录: {}", e))?
```

```ts
catch (e) { showFeedback(`复制失败：${String(e)}`); }
```

用户看到的是 `复制失败：Permission denied (os error 13)` — 既不可读，也无法分类处理。

### 建议：结构化错误类型

```rust
// src-tauri/src/error.rs (新建)
#[derive(Debug, serde::Serialize, thiserror::Error)]
#[serde(tag = "kind", content = "detail")]
pub enum AppError {
    #[error("权限不足: {path}")]
    PermissionDenied { path: String },

    #[error("路径不存在: {path}")]
    NotFound { path: String },

    #[error("磁盘已满")]
    DiskFull,

    #[error("文件被占用: {path}")]
    Busy { path: String },

    #[error("跨设备移动失败: {reason}")]
    CrossDevice { reason: String },

    #[error("非法路径: {path}")]
    InvalidPath { path: String },

    #[error("操作被取消")]
    Cancelled,

    #[error("内部错误: {0}")]
    Internal(String),
}

impl From<std::io::Error> for AppError {
    fn from(e: std::io::Error) -> Self {
        match e.kind() {
            std::io::ErrorKind::PermissionDenied => Self::PermissionDenied { path: "?".into() },
            std::io::ErrorKind::NotFound => Self::NotFound { path: "?".into() },
            std::io::ErrorKind::StorageFull => Self::DiskFull,
            _ => Self::Internal(e.to_string()),
        }
    }
}

pub type AppResult<T> = Result<T, AppError>;
```

```ts
// src/api/filesystem.ts
export interface AppError {
  kind: 'PermissionDenied' | 'NotFound' | 'DiskFull' | 'Busy' | 'CrossDevice' | 'InvalidPath' | 'Cancelled' | 'Internal';
  detail: Record<string, string>;
}

export async function listDirectory(path: string, showHidden: boolean): Promise<FileItem[]> {
  try {
    const entries = await invoke<RawFileEntry[]>('list_directory', { dirPath: path, showHidden });
    return entries.map(mapEntry);
  } catch (e) {
    throw normalizeError(e);
  }
}
```

前端按 `error.kind` 分支：
- `PermissionDenied` → 弹出"打开系统设置授权"对话框
- `NotFound` → 检查路径是否被删除，刷新父目录
- `DiskFull` → 标红警告 + 引导清理
- `Cancelled` → 静默忽略（用户主动）

### 2.2 大量"吞错"模式

```ts
loadSettingsStore().then(s => s.set('theme', theme)).catch(() => {});
emit('aether-tab-drag-end').catch(() => {});
getCurrentWindow().setFocus().catch(() => {});
```

整代码 30+ 处 `.catch(() => {})`。开发期方便，**生产期遇到真问题完全黑盒**。

### 建议：分级日志 + 错误上报

```ts
// src/lib/log.ts
export const log = {
  silent(err: unknown, context: string) {
    if (import.meta.env.DEV) console.warn('[silent]', context, err);
    reportError({ level: 'warn', context, err });   // 可选 → 本地日志或 Sentry
  },
};

// 使用
loadSettingsStore()
  .then(s => s.set('theme', theme))
  .catch(err => log.silent(err, 'persist theme'));
```

至少在本地写一份滚动日志（Tauri log plugin 已经引入），出 bug 时让用户附日志比让用户回忆"我点了啥然后白屏了"友好 100 倍。

### 2.3 Rust panic 捕获后续完善

Rust 端已经注册 panic hook，并把崩溃日志落盘到 `~/Library/Logs/Aether Explorer/`。设置页“关于”中已提供诊断与反馈入口，可打开日志目录、读取最近崩溃日志、复制本地诊断信息。启动后也会检查最近崩溃日志：若发现新的 panic log，会弹出“上次异常退出”提示，引导用户打开诊断页查看。

```rust
// lib.rs setup
std::panic::set_hook(Box::new(|info| {
    let payload = info.payload();
    let msg = if let Some(s) = payload.downcast_ref::<&str>() { s.to_string() }
              else if let Some(s) = payload.downcast_ref::<String>() { s.clone() }
              else { "unknown panic".into() };
    log::error!("RUST PANIC: {} at {:?}", msg, info.location());
    // 落盘到 ~/Library/Logs/Aether Explorer/panic.log
    let _ = write_panic_to_disk(&msg);
}));
```

当前项目按公益和本地优先维护，不默认接入远程崩溃上报。后续若继续增强，可把日志预览和 issue 模板进一步串联，但仍应保持用户主动复制 / 主动反馈。

---

## 三、文件系统监听 — 解决"刷新滞后"

### 当前：每次操作完都 `refreshCurrentDir()`，外部变化看不见

ExplorerView 里 15+ 处 `refreshCurrentDir()`。问题：
- Finder 在同一目录下创建文件，Aether 不会知道
- Time Machine 备份完成，磁盘空间数据是旧的
- `/Volumes` 外接盘插入/拔出，需要重启应用

### 建议：FSEvents / notify 监听

```toml
# Cargo.toml
notify = "6"
notify-debouncer-mini = "0.4"
```

```rust
use notify_debouncer_mini::{new_debouncer, DebouncedEvent};
use std::sync::Mutex;
use std::collections::HashMap;
use std::path::PathBuf;

struct FsWatcherState {
    watchers: Mutex<HashMap<String, notify_debouncer_mini::Debouncer<notify::FsEventWatcher>>>,
}

#[tauri::command]
fn watch_directory(
    window: tauri::WebviewWindow,
    state: tauri::State<FsWatcherState>,
    path: String,
) -> Result<(), String> {
    let window_clone = window.clone();
    let path_clone = path.clone();
    let mut debouncer = new_debouncer(
        std::time::Duration::from_millis(300),
        move |res: Result<Vec<DebouncedEvent>, _>| {
            if let Ok(events) = res {
                let _ = window_clone.emit("fs-changed", (&path_clone, events.len()));
            }
        },
    ).map_err(|e| e.to_string())?;

    debouncer.watcher().watch(PathBuf::from(&path).as_path(), notify::RecursiveMode::NonRecursive)
        .map_err(|e| e.to_string())?;

    state.watchers.lock().unwrap().insert(path, debouncer);
    Ok(())
}

#[tauri::command]
fn unwatch_directory(state: tauri::State<FsWatcherState>, path: String) -> Result<(), String> {
    state.watchers.lock().unwrap().remove(&path);
    Ok(())
}
```

前端：
```ts
useEffect(() => {
  invoke('watch_directory', { path: currentPath });
  const unlisten = listen<[string, number]>('fs-changed', ({ payload: [path] }) => {
    if (path === currentPath) refreshCurrentDir();
  });
  return () => {
    invoke('unwatch_directory', { path: currentPath });
    unlisten.then(fn => fn());
  };
}, [currentPath]);
```

注意点：
- macOS 上 FSEvents API 默认对 `/Volumes` 也工作，可统一监听 `/Volumes` 实现外接盘热插拔
- 监听数量要有上限（10-20 个 path，LRU 淘汰）
- 高频事件做 300ms debounce（otherwise IDE 保存项目时事件风暴）

---

## 四、Bundle / 加载速度

### 当前 bundle 数据
- 主入口 `index-*.js`：约 **258KB**（未 gzip）— 已低于 Vite 500KB warning 阈值
- `vendor-react-bi2_g7yP.js`：约 194KB
- `vendor-T4qKPao8.js`：约 129KB
- `SettingsView-D9dVBofl.js`：约 107KB（已 lazy）
- `index-U521V8fE.css`：约 85KB

主 chunk 已通过 manualChunks 拆出 React、Tauri、lucide-react、i18n 和通用 vendor，当前主要剩余 ExplorerView + Sidebar + TopBar 等首屏业务代码。

### 建议 4.1：vite manualChunks 拆包 — 已完成

```ts
// vite.config.ts
build: {
  rollupOptions: {
    output: {
      manualChunks: {
        'react-vendor': ['react', 'react-dom'],
        'motion-vendor': ['motion'],
        'i18n-vendor': ['i18next', 'react-i18next'],
        'icons-vendor': ['lucide-react'],
        'tauri-vendor': [
          '@tauri-apps/api',
          '@tauri-apps/plugin-dialog',
          '@tauri-apps/plugin-fs',
          '@tauri-apps/plugin-shell',
          '@tauri-apps/plugin-store',
          '@tauri-apps/plugin-updater',
          '@tauri-apps/plugin-process',
        ],
      },
    },
  },
  target: 'es2022',
  cssCodeSplit: true,
  minify: 'esbuild',
  sourcemap: false,  // 桌面应用不需要外暴 sourcemap
},
```

当前实现使用函数式 `manualChunks(id)`，避免把 Tauri 子包和 vendor 依赖拆漏；`motion` 并入通用 vendor，避免循环 chunk 提示。

### 建议 4.2：lucide-react 按需引入

```ts
// 当前
import { Plus, X, ChevronRight, Terminal, ... } from 'lucide-react';

// lucide-react 已支持 tree-shaking，但要确认 webpack/rollup 配置正确
// 验证：build 后 grep 'Wallet\|Coffee\|Plane' dist/assets/*.js
// 不该出现你没用到的图标
```

如果 tree-shaking 没生效，改为 `lucide-react/icons/Plus` 显式按文件引入。

### 建议 4.3：i18n 按语言分包

`src/i18n/locales/en.ts + zh.ts` 当前打包进主 chunk。改成动态加载：

```ts
// src/i18n/index.ts
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

i18n.use(initReactI18next).init({
  fallbackLng: 'zh',
  resources: {},
  interpolation: { escapeValue: false },
});

export async function loadLanguage(lang: string) {
  if (i18n.hasResourceBundle(lang, 'translation')) return;
  const mod = await import(`./locales/${lang}.ts`);
  i18n.addResourceBundle(lang, 'translation', mod.default);
  await i18n.changeLanguage(lang);
}
```

App 启动时只加载当前语言。bundle 主 chunk 应能减 50-100KB。

### 建议 4.4：Tailwind purge 检查

`index-BlKQ8M5F.css` 73KB 对于一个无文档应用偏大。确认 Tailwind 4 config 的 content 路径精准：

```js
// tailwind.config.js (或 vite plugin 配置)
export default {
  content: [
    './index.html',
    './src/**/*.{ts,tsx}',
    // 不要写 ./node_modules/**
  ],
};
```

---

## 五、可访问性（A11y） — 当前几乎为零

### 证据：整 ExplorerView 中 `aria-` / `role=` / `tabIndex` 仅 5 处

不能用 VoiceOver 浏览文件列表，键盘 Tab 行为混乱（很多 div 没 tabIndex），右键菜单 Esc 关闭可能丢焦。

### 建议 5.1：file-item 加语义

```tsx
<div
  role="listitem"           // 或 row（grid 视图用 row + gridcell）
  aria-selected={isSelected}
  aria-label={`${file.name}，${getFileTypeLabel(file.type)}，${file.size}，修改于 ${file.modified}`}
  tabIndex={isSelected ? 0 : -1}
  onKeyDown={handleKeyboardNav}
>
```

容器：
```tsx
<div
  role="list"               // 或 grid
  aria-label="文件列表"
  aria-multiselectable="true"
>
```

### 建议 5.2：键盘导航完整实现

当前只有 typeahead（首字母跳转），缺：
- ↑↓ 移动选中
- ←→ 在分栏视图切列
- Enter 打开
- F2 重命名
- Cmd+↑ 父目录
- Cmd+↓ 进入
- Cmd+Backspace 移废纸篓
- Cmd+R 刷新（已有）

```ts
const handleKeyboardNav = (e: KeyboardEvent) => {
  if (renamingFile) return;
  const idx = currentLevelFiles.findIndex(f => f.id === selectedFileIds[selectedFileIds.length - 1]);
  switch (e.key) {
    case 'ArrowDown': {
      e.preventDefault();
      const next = currentLevelFiles[Math.min(idx + 1, currentLevelFiles.length - 1)];
      onSelectFiles(e.shiftKey ? [...selectedFileIds, next.id] : [next.id]);
      break;
    }
    case 'ArrowUp': /* ... */
    case 'Enter': {
      const file = currentLevelFiles[idx];
      if (file) handleDoubleClick(file);
      break;
    }
    case 'F2': handleRenameStart(currentLevelFiles[idx]); break;
    // ...
  }
};
```

并把焦点管理统一到 `useFocusManager` hook，确保单一活跃元素。

### 建议 5.3：动画尊重 `prefers-reduced-motion`

很多用户（包括前庭功能障碍者）开启了系统级"减少动态效果"。

已完成第一轮收口：`src/index.css` 在 `prefers-reduced-motion: reduce` 下禁用网格 hover 上浮并压低 CSS animation / transition 时长；App 根组件通过 `MotionConfig reducedMotion="user"` 让 motion/react 遵从系统设置；`Loader`、传输进度和存储圆环在减少动态效果下改为静态 / 即时更新。

```ts
// src/lib/motion.ts
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export const motionConfig = {
  enabled: !reduceMotion,
  duration: reduceMotion ? 0 : 0.26,
};
```

在 framer-motion 包装层判断是否禁用动画。

---

## 六、Rust 端架构

### 6.1 约 4357 行单 `lib.rs` 与前端 ExplorerView 异曲同工

Rust 后端所有命令、所有数据结构、所有 helper、所有 osascript 调用全在 `lib.rs`。建议拆模块：

```
src-tauri/src/
├── main.rs
├── lib.rs                  // 仅 run() + handler 注册
├── commands/
│   ├── mod.rs
│   ├── fs.rs               // list_directory, file_info, copy/move/...
│   ├── terminal.rs         // open_terminal_at, list_terminal_apps
│   ├── clipboard.rs        // file clipboard + drag payload
│   ├── window.rs           // create_app_window, start_drag
│   ├── volume.rs           // list_volumes, get_disk_info, eject
│   └── preview.rs          // read_text_preview, quick_look, thumbnail
├── domain/
│   ├── file_entry.rs       // FileEntry, DiskInfo, VolumeInfo
│   └── transfer.rs         // FileTransferPayload, MoveResult, CopyResult
├── error.rs                // AppError, AppResult
├── macos/
│   ├── mod.rs
│   ├── icon.rs             // app icon export, sips conversion
│   ├── mdls.rs             // Spotlight metadata
│   └── applescript.rs      // 安全 osascript 包装
└── util/
    ├── path.rs             // canonicalize, safe join
    └── format.rs           // format_size, format_kib
```

收益：
- 单元测试可针对 `commands/fs.rs` 独立测
- `macos/applescript.rs` 集中 AppleScript 拼接逻辑，安全审计有唯一入口
- 新增功能时清楚去哪个文件

### 6.2 缺少 Cargo workspace / feature flag

未来要做 Windows / Linux 版（README 没说不做，那就是默认要做）。`#[cfg(target_os = "macos")]` 散落各处，**没有 feature gate 控制能力开关**。

```toml
# Cargo.toml
[features]
default = ["macos-native"]
macos-native = ["dep:objc2"]
mock-fs = []   # 测试时用 in-memory fs，避免动磁盘
```

```rust
#[cfg(feature = "mock-fs")]
mod mock_fs;

#[cfg(not(feature = "mock-fs"))]
use std::fs;
#[cfg(feature = "mock-fs")]
use mock_fs as fs;
```

测试就能完全不碰真实磁盘。

### 6.3 `tauri::async_runtime::spawn` 没有 task tracker

`src-tauri/src/lib.rs` 中的后台任务入口直接 `spawn` 后丢弃 JoinHandle。任务失败不会被记录、应用退出时任务可能还在跑。

建议用 `tokio::task::JoinSet` 或 `tokio_util::task::TaskTracker` 统一管理：

```rust
use tokio_util::task::TaskTracker;

struct BackgroundTasks(TaskTracker);

// spawn 时
tasks.0.spawn(async move {
    if let Err(e) = create_app_window(...).await {
        log::error!("create_app_window failed: {e}");
    }
});

// 应用退出时
tasks.0.close();
tasks.0.wait().await;  // 等所有后台任务完成
```

---

## 七、命令面板 / Quick Action

文件管理器没有命令面板就是缺一只眼。

### 建议：Cmd+K 全局命令面板

```tsx
// src/components/CommandPalette.tsx
const commands: Command[] = [
  { id: 'nav.home',     title: '前往主目录',   shortcut: 'Cmd+Shift+H', run: () => navigate('~') },
  { id: 'nav.apps',     title: '前往应用程序', shortcut: 'Cmd+Shift+A', run: () => navigate('/Applications') },
  { id: 'nav.downloads',title: '前往下载',     shortcut: 'Cmd+Shift+L', run: () => navigate('~/Downloads') },
  { id: 'view.list',    title: '切换列表视图', run: () => setDisplayMode('list') },
  { id: 'view.grid',    title: '切换网格视图', run: () => setDisplayMode('grid') },
  { id: 'op.new-folder',title: '新建文件夹',   shortcut: 'Cmd+Shift+N', run: () => createFolder() },
  // ...
  // 动态注入：扩展菜单里所有 enabled 的项
  ...extensions.map(ext => ({ id: ext.id, title: ext.label, run: () => handleExtensionAction(...) })),
];
```

用 fuzzy match（如 `fuse.js` 或简单 LCS）做匹配。

收益：
- 没有快捷键的功能也可触达
- 退化键盘党用户的核心交互入口
- 替代很多右键菜单层级，降低 UI 复杂度

---

## 八、配置 / Settings 改进

### 8.1 Settings 导入/导出后续完善

设置导入/导出已经在 UI 中实现，覆盖主题、收藏夹、文件标签和最近使用。剩余问题是重置、迁移版本化、导入错误 UI，以及用更明确的 schema 保护未来字段演进。

已完成本轮收口：导出文件现在带 `schemaVersion`、`exportedAt`、`appVersion`，并通过 `buildSettingsBackup` 统一脱敏；导入会校验备份 schema、继续兼容旧 `version` 字段；导入 / 导出 / 重置都改为设置页内状态反馈，不再用 `alert`；重置全部配置需要二次确认，并清空主题、收藏、文件标签和最近使用。

```ts
// 一键导出
async function exportSettings() {
  const s = await loadSettingsStore();
  const all = {
    theme: await s.get('theme'),
    favorites: await s.get('favorites'),
    fileTags: await s.get('fileTags'),
    __version: CURRENT_SETTINGS_VERSION,
    __exported_at: new Date().toISOString(),
  };
  const blob = new Blob([JSON.stringify(all, null, 2)], { type: 'application/json' });
  // 用 dialog.save 让用户挑路径
  const target = await save({ defaultPath: 'aether-settings.json' });
  if (target) await writeTextFile(target, JSON.stringify(all, null, 2));
}
```

后续如继续演进，可把备份 schema migrator 独立成 `settings-store` 深 Module，并支持跨 schema 多版本迁移。

### 8.2 `defaultHomePath` 用 `aether://favorites` 作哨兵字符串

`src/App.tsx` 中 `FAVORITES_VIRTUAL_PATH = 'aether://favorites'`。这种把虚拟路径混进真实路径字段的做法，**任何接收 path 的函数都要先判断是不是 `aether://`**，散弹枪式 if-else 已经在 App 和 Explorer 路径解析链路中出现。

**改成 tagged union**：
```ts
type HomeTarget =
  | { kind: 'path'; path: string }
  | { kind: 'virtual'; id: 'favorites' | 'recents' | 'tags' };

interface ThemeSettings {
  defaultHome: HomeTarget;
  // ...
}
```

虚拟和真实路径在类型上分开，编译器强制处理两种 case。

### 8.3 Setting 表单字段太多，缺分组

`SettingsView.tsx` 当前约 2917 行 = 把所有设置全堆一面板。建议：

- 外观（主题/字体/动画/壁纸）
- 文件浏览（隐藏文件/默认视图/排序记忆）
- 行为（默认主页/双击行为/键盘）
- 扩展（右键菜单/终端命令）
- 高级（隐私/数据/重置）
- 关于（版本/更新/许可）

左侧分类导航 + 右侧 panel，每个 panel 独立组件 < 300 行。

---

## 九、产品力差异化

### 9.1 "标签夹板"（Stack）

DEF-29 提到 Aether 没有单点突破。可以做这个：

**Stack 概念**：用户右键选 N 个文件 → "加入暂存夹板" → 任何窗口/标签的侧栏出现一个浮动 stack → 在另一个目录右键空白 → "从夹板粘贴所有" / "从夹板移动所有"。

Finder 的"标签"是分类，Path Finder 的"Drop Stack"是这种暂存。**90% 用户拷文件痛点是"两个窗口拖来拖去"**，stack 解决这个。

实现：
- Tauri State 存 `stack: FileItem[]`
- 跨窗口通过 event 同步
- 侧栏底部固定区域显示数量 + 缩略

### 9.2 "智能文件夹"（保存搜索）

```
~/Projects 下所有 30 天内修改过的 .ts 文件
```

保存为虚拟侧栏入口。Spotlight 已经支持，但 Finder 的智能文件夹 UX 极烂。

实现走 `mdfind`：
```rust
#[tauri::command]
fn run_smart_query(query: String, scope: Option<String>) -> Result<Vec<String>, String> {
    let mut cmd = std::process::Command::new("mdfind");
    if let Some(s) = scope { cmd.args(["-onlyin", &s]); }
    let output = cmd.arg(&query).output().map_err(|e| e.to_string())?;
    Ok(String::from_utf8_lossy(&output.stdout).lines().map(String::from).collect())
}
```

### 9.3 双窗格模式

Commander One / Total Commander / ForkLift 的双窗格是核心卖点。Aether 已经有标签页/多窗口基础，加一个"在当前窗口左右分屏显示两个目录"非常自然：

```ts
type ViewLayout =
  | { kind: 'single'; tab: TabId }
  | { kind: 'split'; left: TabId; right: TabId };
```

用户右键标签 → "在右侧打开" → 触发 split 模式。

---

## 十、开发体验 / 文化

### 10.1 缺 Storybook / 组件预览

`ExplorerView` 套那么多状态，调一个细节都要进入完整应用 + 准备特定文件夹。建议引入 Storybook（或 Ladle，更轻量）：

```bash
npm install -D @ladle/react
```

```tsx
// src/components/ExplorerView.stories.tsx
export const EmptyDirectory = () => <ExplorerView {...mockProps({ files: [] })} />;
export const LargeDirectory = () => <ExplorerView {...mockProps({ files: makeFiles(2000) })} />;
export const PermissionDenied = () => <ExplorerView {...mockProps({ error: 'PermissionDenied' })} />;
export const Loading = () => <ExplorerView {...mockProps({ loading: true })} />;
```

UI 病例固化，截图回归。

### 10.2 没有 PR 模板 / Issue 模板

`.github/` 只有 workflow 一个 yml。建议加：
- `.github/PULL_REQUEST_TEMPLATE.md`：变更类型、影响范围、测试方式
- `.github/ISSUE_TEMPLATE/bug.yml`：让 issue 自带版本、macOS 版本、复现步骤字段
- `.github/ISSUE_TEMPLATE/feature.yml`：让需求带"为什么/谁/什么场景"

### 10.3 没有 codeowners

未来如果有人贡献代码，Rust 端改动应该走 review，前端动画改动应该走另一个 review。`CODEOWNERS` 写明文件 → owner 映射。

### 10.4 没有 conventional commits 强校验

commit 消息 `feat: 完成默认主页可配置...` 风格不错，但**没有 commitlint** 阻止散漫提交。建议：

```bash
npm install -D @commitlint/cli @commitlint/config-conventional husky
npx husky add .husky/commit-msg 'npx --no -- commitlint --edit ${1}'
```

### 10.5 一个固定的 `dev` 入口体验糟

`scripts/dev.mjs` 写个临时 config + spawn tauri 是聪明的解法，但**新人 clone 仓库后 `npm run dev` 启动报错时不知道错在哪**（脚本是黑盒）。建议：
- 启动前打印实际占用的 port / config 路径
- 失败时输出"如何排查"链接

---

## 十一、构建产物完整性

### 11.1 dist/ 被提交到工作区目录

仓库本身没 commit `dist/`（gitignore 有），但本地有遗留。已新增 `npm run clean:release`，release workflow 和本地 `scripts/release.sh` 在打包前都会清理 `dist`、`src-tauri/target/release/bundle` 与 `src-tauri/target/universal-apple-darwin/release/bundle`，避免上次失败的产物被混入。

### 11.2 产物清单与完整性

发版 release 已补齐：
- `SHA256SUMS`：覆盖 `.dmg`、`.app.tar.gz`、`.sig` 和 `latest.json`，上传到 versioned release，并在上传后远程比对。

后续仍可继续补：
- SBOM（CycloneDX 或 SPDX）— 用户/企业要知道你打包了哪些依赖
- License 清单（`THIRD_PARTY_LICENSES.txt`）— 你用了 trash crate、zip crate 等，按 license 要求需要附录

```yaml
# release.yml 新增 step
- name: Generate checksums
  run: |
    cd "$STAGING_DIR"
    shasum -a 256 *.dmg *.tar.gz *.sig > SHA256SUMS

- name: Generate SBOM
  run: |
    npm install -g @cyclonedx/cyclonedx-npm
    cyclonedx-npm --output-format JSON --output-file sbom-npm.json
    cd src-tauri && cargo install cargo-cyclonedx && cargo cyclonedx -f json

- name: License notice
  run: |
    npx license-checker --production --summary > THIRD_PARTY_LICENSES.txt
    cargo install cargo-about
    cd src-tauri && cargo about generate about.hbs > ../THIRD_PARTY_RUST.txt
```

---

## 十二、用户教育与新手引导

### 12.1 第一次启动空白

用户装好 Aether 打开，看到的是当前目录文件列表。没有 onboarding，不知道有什么独特功能。

建议首次启动：
- 显示 3-page 的功能介绍（分栏视图、扩展菜单、Quick Look）
- 5 秒不点击自动跳过
- 用 `Tauri Store` 标记 `__onboarded = true`

### 12.2 没有"新功能提示"

每次更新后，用户怎么知道 0.3 加了什么？现在的 updater 只显示版本号。

```ts
// 启动时检查上次记录的版本
const lastSeenVersion = await store.get<string>('lastSeenVersion');
const current = APP_VERSION;
if (lastSeenVersion && semver.lt(lastSeenVersion, current)) {
  showWhatsNewModal(lastSeenVersion, current);
}
await store.set('lastSeenVersion', current);
```

What's New 内容从 `CHANGELOG.md` 解析即可。

### 12.3 没有快捷键 cheatsheet

按 `?` 弹出快捷键列表，对键盘用户极友好。可与 Cmd+K 命令面板共用数据源。

已完成第一版：App 级 `?` 打开快捷键列表，覆盖窗口、导航、选择、文件操作、视图和工具类快捷键；输入框、重命名和路径编辑状态不会触发。后续接入 Cmd+K 时可把当前列表抽成共享 command registry。

---

## 十三、隐私与本地化数据

### 13.1 用户配置都在 `settings.json`，但没有"打开配置文件位置"按钮

调试时让用户"找到 ~/Library/Application Support/com.aether.explorer/settings.json" 是不友好的。

已在设置 → 关于 → 诊断与反馈中补齐“打开配置文件夹”：后端通过 Tauri `app_data_dir` 定位 `settings.json` 所在目录，前端诊断报告也会带上 `configDir`，方便社区排查配置问题。

```tsx
<button onClick={() => invoke('reveal_in_finder', { path: settingsPath })}>
  打开配置文件夹
</button>
```

### 13.2 没有"清除所有数据"

用户卸载时残留：
- `~/Library/Application Support/com.aether.explorer/`
- `~/Library/Caches/Aether Explorer/`（图标缓存）
- `~/Library/Preferences/com.aether.explorer.plist`
- `~/Library/Logs/Aether Explorer/`

提供"在设置中清除所有数据"按钮（含二次确认），并在 README 里写卸载步骤。

### 13.3 收藏 / 标签的数据没有跨设备能力，也没有同步路径

FEATURES Tier 9.7 标了"❌ 设置同步：本期不做"。可以接受，但需要：

- 至少把数据放在 `~/Library/Application Support/...` 而不是仅仅 localStorage（已经做了）
- 文档说明"配置文件在哪、可以手动复制到另一台 Mac"

---

## 十四、长线方向

### 14.1 插件机制

`contextMenuExtensions` 已经是萌芽形态。下一步：

```ts
// 一个最小插件协议
interface AetherPlugin {
  manifest: {
    id: string;
    name: string;
    version: string;
    permissions: ('read-fs' | 'execute' | 'network')[];
  };
  activate(api: AetherAPI): void;
}

interface AetherAPI {
  registerContextAction(action: ContextAction): void;
  registerSidebarItem(item: SidebarItem): void;
  registerCommand(cmd: Command): void;
  registerThumbnailProvider(mimeRegex: string, fn: (path: string) => Promise<string>): void;
}
```

插件用 JS 写，跑在 sandboxed iframe 里（postMessage 通信）。比 VSCode 那套 worker 简单 10 倍。

### 14.2 网络协议支持（SSH/SFTP/WebDAV）

ForkLift / Cyberduck 卖钱靠这个。Aether 现已支持 SMB（系统挂载到 /Volumes），但**应用内直接连 SFTP**会是巨大差异化点。

可以用 `russh` (Rust SSH) 实现。功能不必复杂，能列目录、上传、下载即可。

### 14.3 多版本配置 + 工作区

像 IDE 那样支持"在不同项目下记忆不同的视图/排序/侧栏"：

```
~/Code/project-a/.aether.json
  - 默认列表视图 + 按修改时间排序
  - 排除 node_modules
```

切目录时检测该目录的 `.aether.json` 自动应用。

### 14.4 文件比较 / 同步工具

`diff` 两个文件夹（Beyond Compare 的核心功能），右键两个文件夹 → "比较内容"。

---

## 十五、ROI 矩阵 / 推荐路线图

按"用户感知 ÷ 工作量"排序：

### 🏆 立即做（高 ROI，1-3 天）

| 优先级 | 项目 | 状态 | 工时 | 用户感知 |
|--------|------|------|------|----------|
| P0 | 8.1 设置导入/导出 | 已完成本轮收口：schema 导出、导入错误 UI、二次确认重置 | 2h | 重装/换机用户的救命稻草 |
| P0 | 5.3 prefers-reduced-motion | 已完成第一轮：CSS + motion/react 全局收口 + Loader/进度静态化 | 1h | 老人 / 前庭患者立即可用 |
| P0 | 11.1 dist 清理 / SHA256 校验和 | 已完成：release 前清理旧产物、生成并上传 `SHA256SUMS`、远程验收、`lint:ci-gates` 防回退 | 2h | 用户验证下载完整性 |
| P0 | 12.3 `?` 快捷键 cheatsheet | 已完成：App 级帮助弹窗 + i18n + 测试 | 4h | 键盘党 onboarding |
| P0 | 13.1 "打开配置文件夹" | 已完成：诊断页可打开配置目录并复制 `configDir` | 0.5h | 调试友好 |
| P0 | 2.3 Rust panic hook | 已完成：落盘、设置页诊断、启动后提示 | 2h | 崩溃可恢复 |

### 💪 v0.3（高 ROI，1-2 周）

| # | 项目 | 工时 | 用户感知 |
|---|------|------|----------|
| ⭐ | 7 命令面板 Cmd+K | 3d | **杀手锏功能** |
| ⭐ | 9.1 文件 Stack（暂存夹板） | 2d | **差异化卖点** |
| ⭐ | 3 文件系统监听 | 2d | "刷新滞后"消失 |
| ⭐ | 2.1 结构化错误 | 2d | 错误对话框真正有用 |
| ⭐ | 4 i18n 动态加载 + Explorer 业务拆分 | 1d | 首次启动继续减负 |
| ⭐ | 1.3 inode-based ID | 1d | 重命名不再跳动 |

### 🎯 v0.4 - v0.5（中 ROI，3-6 周）

| # | 项目 | 工时 |
|---|------|------|
| 5 完整 A11y（aria + 键盘） | 1w |
| 6.1 Rust 拆模块 | 3d |
| 9.2 智能文件夹 | 4d |
| 9.3 双窗格视图 | 5d |
| 12 onboarding + What's New | 3d |
| 14.3 工作区配置 | 5d |

### 🚀 v1.0（长线，3-6 月）

| # | 项目 |
|---|------|
| 14.1 插件机制 |
| 14.2 SFTP/WebDAV |
| 14.4 文件夹比较 |
| Windows / Linux 移植 |

---

## 十六、一句话总结

Aether 当前的状态：**"原型完成度 90%，产品力 30%"**。

- `RELEASE_AUDIT.md` 把"会爆"的修掉
- `PERF_PLAN.md` 把"卡"的修掉
- 本文档把"不亮"的点亮

三份文档全部落地后，Aether 才从"我的副业 demo"变成"我可以推荐给朋友用的工具"。再往后想做到 ForkLift 级的专业体验，靠的就是**插件 / SFTP / 双窗格 / 工作区** 这一类长线投入。

但每一个"让用户尖叫"的瞬间，都来自看似不起眼的小修：默认关 blur 让滚动顺了、aria-label 让 VoiceOver 用户能用了、Cmd+K 让键盘党不再恨你了。**这些事比"美化主题"重要 100 倍。**
