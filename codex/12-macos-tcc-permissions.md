# 12 macOS TCC 权限管理 (macOS-TCC-Permissions)

**状态**: ✅ 已落地  **首次落地**: [2026-05-20]  **最近更新**: [2026-05-21]  **域**: macOS TCC 弹框控制、Entitlements、Info.plist 配置

← 返回 [索引](./README.md)

---

## 12.1 一句话总结

非沙盒 Tauri 应用访问 macOS 受保护目录（下载、文稿、桌面等）时，TCC 会弹权限确认框；正确配置 `Info.plist` 的 `NS*UsageDescription` 可让系统记住授权，避免每次启动重复弹框。

---

## 12.2 决策与权衡

| 决策 | 选择 | 否决方案 | 原因 |
|---|---|---|---|
| 沙盒策略 | 关闭 App Sandbox | 开启沙盒 + bookmark | 文件管理器需要访问整个文件系统，沙盒会对每个目录单独弹框，体验极差 |
| TCC 描述 | 独立 `Info.plist` 文件 | `tauri.conf.json` 内联对象 | Tauri v2 的 `infoPlist` 字段只接受文件路径，不接受内联对象（`src-tauri/tauri.conf.json:56`） |
| 权限检查 | 手动触发按钮 | 组件挂载时自动检查 | 自动检查会在进入设置页时立即访问受保护目录，触发 TCC 弹框 |

不变量：
- `com.apple.security.app-sandbox` 必须为 `false`（`src-tauri/Entitlements.plist:5`）
- `Info.plist` 必须包含受保护目录的 `NS*UsageDescription`，否则 TCC 弹框文案和授权记录会退化
- `Info.plist` 不是稳定身份；正式 .dmg 必须有非 ad-hoc Apple app 代码签名、有效 `TeamIdentifier` 和 code-signing `Identifier=com.aether.explorer`，否则 TCC 可能把更新后的 app 当成新 client
- 无 Apple Developer 签名时，dev/release/ad-hoc 构建都只能作为本地或高级用户测试，不能作为 Full Disk Access 正式版可用证据

---

## 12.4 关键文件 & 行号

| 文件 | 职责 |
|---|---|
| `src-tauri/Entitlements.plist` | 关闭沙盒，声明文件读写权限 |
| `src-tauri/Info.plist` | NS*UsageDescription（桌面/文稿/下载/外部存储） |
| `src-tauri/tauri.conf.json:56` | `macOS.entitlements` + `macOS.infoPlist` 路径引用 |
| `src-tauri/capabilities/default.json:25` | `fs:default`、`fs:allow-read-text-file`、`fs:allow-write-text-file`、`dialog:allow-save` |
| `src-tauri/src/lib.rs` | `.plugin(tauri_plugin_fs::init())` 注册 |
| `src/components/SettingsView.tsx:2116` | 权限检查改为手动触发（`checkPermissions` + `permChecksLoaded`） |

---

## 12.7 失败模式与排查

| 现象 | 根因 | 修复 |
|---|---|---|
| 每次启动都弹权限框 | `Info.plist` 缺少 `NS*UsageDescription`，TCC 无法持久化授权 | 新建 `src-tauri/Info.plist`，加 5 个 UsageDescription，`tauri.conf.json` 引用 |
| `tauri.conf.json` 中 `infoPlist` 写成对象报错 | Tauri v2 schema 要求 `infoPlist` 是文件路径字符串，不接受内联 map | 改为 `"infoPlist": "Info.plist"` |
| 配置导出无文件生成 | `tauri-plugin-fs` 未注册 Rust 端，`writeTextFile` 静默失败 | `Cargo.toml` 加 `tauri-plugin-fs = "2.5.1"`，`lib.rs` 注册，`capabilities` 加权限 |
| 设置页进入时触发 TCC 弹框 | `useEffect` 在组件挂载时自动调 `list_directory` 访问受保护目录 | 改为手动触发按钮（`src/components/SettingsView.tsx:2116`） |
| `com.apple.security.files.all` 无效 | macOS 不存在此 entitlement key | 删除，只保留有效的 `files.user-selected.read-write` 和 `files.downloads.read-write` |

---

## 12.9 经验教训

1. **关闭沙盒 ≠ 绕过 TCC**：`app-sandbox: false` 只是不启用沙盒隔离，macOS TCC 对受保护目录（下载、文稿、桌面、联系人等）的保护独立于沙盒，仍然生效。

2. **`NS*UsageDescription` 是持久化授权的关键**：没有这些描述，TCC 每次都会重新弹框确认，即使用户已授权"完全磁盘访问"。有了描述后，系统会在第一次弹框后记住授权。

3. **不要在组件挂载时访问受保护目录**：任何 `useEffect` 里的 `list_directory` 调用，如果目标是 `~/Documents`、`~/Downloads` 等，都会触发 TCC。改为用户主动触发（点击按钮）。

4. **`tauri-plugin-fs` 前后端都要注册**：前端 `@tauri-apps/plugin-fs` 的 `writeTextFile` 调用，如果 Rust 端没有 `.plugin(tauri_plugin_fs::init())`，会静默失败（不报错，文件不生成）。同时 `capabilities/default.json` 也要加对应权限。
