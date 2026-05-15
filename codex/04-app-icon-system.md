# 04 应用图标系统重构 (App-Icon-System)

**状态**: ✅  **首次落地**: [2026-05-15]  **最近更新**: [2026-05-15]  **域**: 用单一 SVG 源统一生成全平台图标，视觉风格从玻璃炫光改为 Material 极简语义

← 返回 [索引](./README.md)

## 04.1 一句话总结

将应用图标重构为 Material 风格（圆角底板 + 文件夹 + 探索指针），并以 `design/icons/aether-explorer-icon.svg` 作为唯一源，通过 Tauri CLI 一次性生成 macOS / Windows / iOS / Android 全部尺寸图标。

## 04.2 决策与权衡

| 决策点 | 方案 | 选择 |
|---|---|---|
| 图标源文件 | 直接改多份 PNG / ICNS / ICO | ❌ 不可维护 |
|  | 维护单一 SVG，再自动导出 | ✅ |
| 视觉风格 | 继续玻璃 + 发光 + 复杂元素 | ❌ 小尺寸识别差，风格噪音高 |
|  | Material 极简语义图形 | ✅ |
| 生成方式 | 手工导出每个平台资源 | ❌ 易漏尺寸 |
|  | `npx @tauri-apps/cli icon` 统一生成 | ✅ |

**不变量：**

1. `src-tauri/tauri.conf.json` 中 `bundle.icon` 仍是应用入口图标源清单（`src-tauri/tauri.conf.json:47`）。
2. 图标修改必须先改 SVG 源，再批量生成，禁止直接手改派生 PNG。
3. 视觉层必须保证 `32x32` 仍可辨识主要语义（文件夹 + 探索）。

## 04.4 关键文件 & 行号

| 文件 | 锚点 | 说明 |
|---|---|---|
| `design/icons/aether-explorer-icon.svg` | `:1` | 新图标唯一源文件 |
| `design/icons/aether-explorer-icon.svg` | `:43` | 文件夹主体图层 |
| `design/icons/aether-explorer-icon.svg` | `:49` | 探索指针语义图层 |
| `design/icons/aether-explorer-icon-preview.png` | — | 预览图 |
| `src-tauri/tauri.conf.json` | `:47` | 打包入口图标清单 |
| `src-tauri/icons/icon.png` | — | 主 PNG 产物（512） |
| `src-tauri/icons/icon.icns` | — | macOS 图标包 |
| `src-tauri/icons/icon.ico` | — | Windows 图标包 |

## 04.8 SOP

```bash
# 1) 编辑源 SVG
$EDITOR design/icons/aether-explorer-icon.svg

# 2) 生成预览（可选）
sips -s format png design/icons/aether-explorer-icon.svg --out design/icons/aether-explorer-icon-preview.png

# 3) 批量生成平台图标
npx @tauri-apps/cli icon design/icons/aether-explorer-icon.svg
```

## 04.9 经验教训

1. 应用图标是“系统资源”，不应走一次性视觉稿流程，必须有可重复的生成链。
2. 小尺寸可读性比大图细节更重要。把语义压缩到 2~3 个主形体，远比叠滤镜稳定。
3. 当项目同时覆盖多平台时，CLI 批量生成比手工导图可靠，且能避免忘更 `icns` / `ico` 的发布事故。
