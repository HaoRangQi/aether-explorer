# Requirements

拆分当前 3 个最大源码文件：ExplorerView.tsx、src-tauri/src/lib.rs、SettingsView.tsx。

边界：行为保持型重构；不改 Tauri command 名称；不改前端 API wrapper 对外契约；ExplorerView 和 SettingsView 保持原 default export，SettingsCategory 继续导出。

当前已完成：Explorer/Settings 多个 UI owner 模块已建立；Rust 已迁出 error/models/disk/terminal/window/native_menu。下一步继续缩薄 lib.rs，优先抽 transfer owner。
