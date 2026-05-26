# Tauri 透明窗口 + 桌面折射 · 可行性研究

> **场景**：Tauri 窗口本体透明、内容空白，看到桌面壁纸/其它应用，并对其做液态玻璃式真折射。
>
> **目标读者**：未来的 Claude 或工程师。看完此文档应当能在不重新调研的情况下做出选型决策、避开已知坑。
>
> **配套文档**：[`docs/liquid-glass-research.md`](./liquid-glass-research.md)（上游：Web 内液态玻璃的数学与代码原理）。

---

## 0. TL;DR

1. **能做。但不要尝试用 Web 内的 `backdrop-filter + SVG 滤镜` 去扭曲桌面 —— 这条路被引擎层钉死了。**
2. **真折射桌面的两条出路**：
   - **A. 调系统私有 API `NSGlassEffectView`**（macOS 26+，半天落地，但 App Store 审核不友好）
   - **B. 自写 Metal/GPU 着色器，原生层做合成**（工程量 2~4 周，但能上架，效果天花板最高）
3. **现成轮子已经有**：`tauri-plugin-liquid-glass`、`window-vibrancy v0.7+`、`LiquidGlassKit`、`electron-liquid-glass`，可以直接用或参考。
4. **跨平台真折射** 目前没有干净方案，Linux 完全无解（取决于桌面合成器）。

---

## 1. 关键认知：为什么 WebView 内做不了"折射桌面"

这条结论被 Electron 官方在多个 issue 里反复确认（同样适用于 Tauri，因为两者都是把 Web 引擎跑在原生窗口里）：

> **"The blur filter only applies to the web page, so there is no way to apply blur effect to the content below the window."** —— [electron/electron#30412](https://github.com/electron/electron/issues/30412)

### 1.1 为什么是这样？

- `backdrop-filter` 的"backdrop"指的是 **WebView 渲染树里、当前元素之后的内容**。
- 透明窗口透出的桌面像素，是 **OS 合成器（macOS WindowServer / Windows DWM / Linux Compositor）** 在更上层把多个窗口合成的产物。Web 引擎根本看不到这一层。
- 即便能看到，浏览器出于安全考虑也不会让网页采样跨进程像素（防截屏窃取）。

### 1.2 已踩过的雷（Electron 社区的一手经验）

| 现象 | issue |
|---|---|
| `backdrop-filter` 在 Electron 透明窗口里渲染异常（伪光晕） | [#30077](https://github.com/electron/electron/issues/30077) |
| Vibrancy 与 `backdrop-filter` 混用渲染怪异 | [#39529](https://github.com/electron/electron/issues/39529) · [#44720](https://github.com/electron/electron/issues/44720) |
| `desktopCapturer` 抓透明窗口得到全黑 | [#24346](https://github.com/electron/electron/issues/24346) |
| 老需求："请支持 backdrop-filter 实现 Acrylic" | [#30412](https://github.com/electron/electron/issues/30412)（多年未解） |

**所以**：在 Web 内对桌面像素做任意几何变换（折射），目前不可能，**未来也大概率不行**（除非引擎+OS 共同开放新 API）。

---

## 2. 五条可行路线（含权衡）

| # | 路线 | 真折射桌面 | App Store | 跨平台 | 工程量 | 推荐度 |
|---|---|---|---|---|---|---|
| **A** | Tauri + [`tauri-plugin-liquid-glass`](https://github.com/hkandala/tauri-plugin-liquid-glass) | ✅ 系统给的真折射 | ❌ 私有 API | ❌ macOS 26+ | **半天** | ⭐⭐⭐⭐⭐ 演示/自分发首选 |
| **B** | Tauri + 官方 [`window-vibrancy`](https://github.com/tauri-apps/window-vibrancy) v0.7+（`apply_liquid_glass`） | ✅ | ⚠️ 同样调私有 API | ❌ macOS 26+ | 半天，注意圆角 bug | ⭐⭐⭐⭐ |
| **C** | Tauri + `window-vibrancy` 经典 vibrancy（NSVisualEffect / Acrylic / Mica） | ❌ 仅磨砂模糊 | ✅ 公开 API | ⚠️ macOS+Win，Linux 无 | 半天 | ⭐⭐⭐ 上架且不要折射时唯一选 |
| **D** | 自研：Metal/Direct2D shader 做原生层 + 嵌入 Tauri | ✅ 真折射，可调 IOR/色散 | ✅ | ❌ 单平台为主 | **2~4 周** | ⭐⭐⭐⭐ 商业级最佳 |
| **E** | Rust 端 ScreenCaptureKit 抓桌面 → 推 WebView → SVG 滤镜扭曲 | ✅（伪桌面） | ⚠️ 屏幕录制权限弹窗 | ⚠️ 抓屏 API 各平台不同 | 1~2 周 | ⭐ 不推荐 |

### 2.1 路线 A 详解

**`tauri-plugin-liquid-glass`** by [hkandala](https://github.com/hkandala/tauri-plugin-liquid-glass)

- 调用 macOS 26 的私有类 **`NSGlassEffectView`**，原生窗口直接长出真 Liquid Glass
- macOS < 26 自动降级到 `NSVisualEffectView`（仅模糊）；非 macOS 平台变为安全 no-op
- 配置项：`enabled` / `corner_radius` / `tint_color` / `variant`（如 `Sidebar`）
- 提供 `is_supported()` 检查 + `set_effect()` 主线程调度

**最小落地步骤**（不亲自跑，仅作记录，未来核对官方 README）：

```jsonc
// tauri.conf.json
{
  "tauri": {
    "macOSPrivateApi": true,
    "windows": [{ "transparent": true, "decorations": false }]
  }
}
```

```rust
// src-tauri/src/lib.rs
use tauri_plugin_liquid_glass::{LiquidGlassConfig, GlassMaterialVariant};

tauri::Builder::default()
    .plugin(tauri_plugin_liquid_glass::init())
    .setup(|app| {
        let win = app.get_window("main").unwrap();
        tauri_plugin_liquid_glass::set_effect(&win, LiquidGlassConfig {
            enabled: true,
            corner_radius: 24.0,
            tint_color: Some("#ffffff20".into()),
            variant: GlassMaterialVariant::Sidebar,
        })?;
        Ok(())
    });
```

**风险**：
- App Store 审核大概率拒绝（Apple 对私有 API 检测严格）
- macOS 11~25 上只能用经典 Vibrancy，无折射
- 私有 API 在未来 macOS 升级中可能变更或失效

### 2.2 路线 B 详解

**官方 `window-vibrancy` v0.7+** ([PR #191](https://github.com/tauri-apps/window-vibrancy/releases))

- 加入了 `apply_liquid_glass` / `clear_liquid_glass`
- 仍走 `NSGlassEffectView`，**与路线 A 是同一套底层**，只是 API 风格更"官方"
- **已知 bug**（[#198](https://github.com/tauri-apps/window-vibrancy/issues/198)）：focus 时窗口圆角与窗口边缘错位。除 `Clear` 变体外都受影响。**短期不要在生产用**。

### 2.3 路线 C 详解：最稳但仅模糊

| 平台 | 调用 | 效果 |
|---|---|---|
| macOS | `apply_vibrancy(..., NSVisualEffectMaterial::HudWindow, ...)` | 半透磨砂 |
| Windows 10/11 | `apply_blur` / `apply_acrylic` / `apply_mica` | 模糊/亚克力/Mica |
| Linux | ❌ | 不支持（取决于桌面合成器） |

如果"看起来像玻璃但不需要真折射"，路线 C 是**唯一上架友好的跨平台方案**。可以再叠一层 WebView 内的 SVG 滤镜（用我们上一份研究里的 `liquid-glass.js`）做**装饰性高光**，进一步像 Apple Vibrancy。

### 2.4 路线 D 详解：自研 Metal 着色器

**唯一既上架又真折射的方案**，但工程量大。参考实现：

[**DnV1eX/LiquidGlassKit**](https://github.com/DnV1eX/LiquidGlassKit)（iOS 13–18 反向移植 + iOS 26+ 增强版）

它的 Metal 渲染管线包含：
- **真折射**（可配 IOR）
- **色散**（边缘 RGB 三色分离）
- **菲涅尔反射**（边缘高光随视角变化）
- **眩光**（响应表面法线的方向性高光）
- **形状合并**（多个玻璃片融合）

**关键技巧**：为绕开私有 `CABackdropLayer`，它用"渲染 root view 到一个 off-screen texture"作为玻璃后面的"背景"，CPU 重一些但**完全公开 API、可上架**。

> **与上一份研究的复用关系**：`docs/liquid-glass-research.md` 第 4 章的 `liquid-diamond.js` 数学（光追 / Möller–Trumbore / Snell / 全反射 / Fresnel）**就是 LiquidGlassKit 这套 Metal shader 在做的事**。如果走路线 D，那份文档的数学部分可以直接翻译成 MSL/HLSL。

**Tauri 集成思路**（macOS）：
1. 在 `src-tauri` 中用 `cocoa` / `objc2` crate 创建一个 `MTKView` 或自定义 `NSView`
2. 用 `tauri::WindowExt::ns_window()` 取到原生 NSWindow，把 Metal 视图加到 contentView 之上、WebView 之下
3. WebView body 设透明，让 Metal 视图透过来；或反过来，Metal 视图盖在最上方但只在玻璃 polygon 内可见
4. 抓背景：用 `[NSWindow contentView] cacheDisplayInRect:toBitmapImageRep:` 把窗口下层渲染到纹理（公开 API）

> ⚠️ "抓窗口下层 = 桌面像素" 仍要面对 OS 限制：透明窗口后面的桌面同样不在 NSWindow 渲染树里。所以路线 D **仍可能需要 ScreenCaptureKit**（路线 E 的混合）才能真正吃到桌面像素。最终能否纯靠 NSWindow API 取到桌面，**未实测，建议在动工前做 1~2 天 spike**。

### 2.5 路线 E 详解：抓屏推流（不推荐）

| 平台 | 抓屏 API |
|---|---|
| macOS | [ScreenCaptureKit](https://developer.apple.com/documentation/screencapturekit) |
| Windows | DXGI Desktop Duplication |
| Linux | PipeWire (`xdg-desktop-portal`) |

**坑**：
1. **权限**：macOS 弹窗强制用户授权屏幕录制
2. **性能**：60fps 抓屏 + IPC + WebView 重画 + SVG 滤镜，端到端延迟 30~50ms，CPU 占用高
3. **递归套娃**：玻璃下面如果是自己的窗口会无限折射，必须 ScreenCaptureKit 排除自身（API 支持）
4. **延迟可见**：玻璃下方有动画/视频时能感到滞后

**为什么还列出来**：少数极端场景（如壁纸引擎、全屏锁定动画）可能必须自抓屏，记录方案备查。

---

## 3. 已有开源项目速查表

| 项目 | 平台 | 用途 | 含金量 |
|---|---|---|---|
| [hkandala/tauri-plugin-liquid-glass](https://github.com/hkandala/tauri-plugin-liquid-glass) · [crates.io](https://crates.io/crates/tauri-plugin-liquid-glass) | macOS | Tauri v2 私有 API 直通 | ⭐⭐⭐⭐⭐ |
| [tauri-apps/window-vibrancy](https://github.com/tauri-apps/window-vibrancy) | macOS/Win | 官方 vibrancy + `apply_liquid_glass` | ⭐⭐⭐⭐ |
| [Meridius-Labs/electron-liquid-glass](https://www.npmjs.com/package/electron-liquid-glass)（被 hkandala 致谢为灵感源） | macOS | Electron 版同思路 | ⭐⭐⭐ |
| [DnV1eX/LiquidGlassKit](https://github.com/DnV1eX/LiquidGlassKit) | iOS（思路可移 macOS） | Metal shader 真折射，参考价值最高 | ⭐⭐⭐⭐⭐ |
| [terraphim/terraphim-liquid-glass-terminal](https://github.com/terraphim/terraphim-liquid-glass-terminal) | Tauri/Rust | 终端模拟器，真实落地项目 | ⭐⭐⭐⭐ |
| [conorluddy/LiquidGlassReference](https://github.com/conorluddy/LiquidGlassReference) | iOS/SwiftUI | "给 AI 看的"参考文档 | ⭐⭐⭐ |
| [shuding/liquid-glass](https://github.com/shuding/liquid-glass) | Web | 本项目本体（SVG 滤镜版） | ⭐⭐⭐⭐ |

---

## 4. 给不同目标的决策树

```
你的目标是什么？
├─ 演示 / 内部工具 / 自分发
│   └─ macOS 26+ ?
│       ├─ 是 → 【路线 A】tauri-plugin-liquid-glass        ← 半天上手
│       └─ 否 → 【路线 C】window-vibrancy 经典 vibrancy
│
├─ 上 App Store + 真折射
│   └─ 【路线 D】自写 Metal shader（参考 LiquidGlassKit）
│       预算 2~4 周；先 spike 1~2 天验证 NSWindow 能否取桌面像素
│
├─ 上 App Store + 不要真折射
│   └─ 【路线 C】window-vibrancy + 装饰性 SVG 高光层
│
├─ 跨平台（macOS + Windows + Linux）
│   ├─ 真折射 → 不可能（Linux 无解；Win 至多 Mica；macOS 私有 API）
│   └─ 仅模糊 → 【路线 C】+ Linux 降级为半透色块
│
└─ 极端：必须抓桌面动态像素（如壁纸引擎效果）
    └─ 【路线 E】ScreenCaptureKit + WebView 假桌面，接受延迟与权限弹窗
```

---

## 5. 容易被忽视的细节

### 5.1 透明窗口在各平台的小坑

| 平台 | 注意 |
|---|---|
| macOS | 透明窗口**不会有原生阴影**；DevTools 打开时透明会失效 |
| Windows | DWM 关闭时透明无效；Win 7/8 不支持新 vibrancy |
| Linux | 需 `--enable-transparent-visuals --disable-gpu`，旧 NVidia 驱动 alpha 通道有 bug |

### 5.2 macOS 26（Tahoe）私有 API 的合规边界

- `tauri.conf.json` 必须显式开启 `macOSPrivateApi: true`
- 二进制扫描会发现对 `_NSGlassEffectView` 的符号引用 → App Store 自动拒
- 企业内部分发 / 直接下载 / Homebrew Cask 不受影响
- 越狱级稳定性：Apple 可能在小版本里改类名或字段，**生产前必须做版本探测和 fallback**

### 5.3 `tauri-plugin-liquid-glass` 的设计要点

- 自动 dispatch 到主线程（AppKit 要求）
- 每窗口状态独立，重复调用 `set_effect` 等于"更新"而非"再加一层"
- 有 `is_supported()` 用于运行时探测

### 5.4 `window-vibrancy` v0.7.1 的圆角 bug ([#198](https://github.com/tauri-apps/window-vibrancy/issues/198))

聚焦时窗口圆角错位，所有 `NSGlassEffectViewStyle` 变体（除 `Clear`）都受影响。临时绕：
- 用 `Clear` 变体
- 或暂用路线 A 的 `tauri-plugin-liquid-glass`（实测圆角更稳）
- 跟踪官方修复

### 5.5 Apple 自己的官方建议

[Apple HIG · Applying Liquid Glass to custom views](https://developer.apple.com/documentation/swiftui/applying-liquid-glass-to-custom-views)：

> Liquid Glass is best reserved for the navigation layer that floats above the content of your app.

适合：导航栏、工具栏、tab bar、悬浮按钮、sheet、popover、菜单
**不适合**：列表/表格/媒体内容、全屏背景、可滚动内容、玻璃叠玻璃

---

## 6. 与 `liquid-glass-research.md` 的关系

| 维度 | `liquid-glass-research.md` | 本文档 |
|---|---|---|
| 层级 | Web 内（DOM 内部） | OS 窗口/原生 |
| 技术栈 | SVG 滤镜 + JS canvas | Cocoa/Metal/Win32/Tauri |
| 折射对象 | WebView 内的元素 | 桌面像素（理论上） |
| 数学 | SDF / 光追 / Snell / Fresnel | 同样的数学，但跑在 GPU shader 里 |

**结论**：第一份研究的数学是路线 D 的"算法图谱"，可直接 1:1 翻译到 Metal Shading Language（MSL）。所以"两份文档一起看 + 选好路线"就能开始动工。

---

## 7. 未做 / 留给未来的 Spike

1. **NSWindow `cacheDisplayInRect:` 能否吃到桌面像素？**（路线 D 的关键不确定性，需 1 天实测）
2. **`tauri-plugin-liquid-glass` 在 macOS 26.x 实际效果**（特别是 vs `window-vibrancy` v0.7.1 的圆角 bug）
3. **ScreenCaptureKit 推到 WebView 的最低延迟**（路线 E 是否值得，需要实测帧率）
4. **Windows 11 Mica + 自绘高光是否够"像 Liquid Glass"**（跨平台时的视觉一致性）

---

## 8. 一句话决策

> **想要"Tauri 透明窗口 + 真折射桌面壁纸"** ——
> macOS 26+ 自分发：直接上 [`tauri-plugin-liquid-glass`](https://github.com/hkandala/tauri-plugin-liquid-glass)，半天搞定。
> 要上架或追求天花板效果：写 Metal shader（参考 [LiquidGlassKit](https://github.com/DnV1eX/LiquidGlassKit) + 本仓库 `liquid-diamond.js` 的数学）。
> 跨平台（含 Linux）+ 真折射：**目前没有**。

---

## 附录：所有引用源

### 官方文档与项目
- [Tauri Window Customization](https://v2.tauri.app/learn/window-customization/)
- [Tauri Discussion #13610 — Liquid Glass support](https://github.com/tauri-apps/tauri/discussions/13610)
- [Tauri Issue #14207 — Liquid Glass icons for macOS 26](https://github.com/tauri-apps/tauri/issues/14207)
- [Apple Developer — Applying Liquid Glass to custom views](https://developer.apple.com/documentation/swiftui/applying-liquid-glass-to-custom-views)
- [Apple Developer — Landmarks: Building an app with Liquid Glass](https://developer.apple.com/documentation/SwiftUI/Landmarks-Building-an-app-with-Liquid-Glass)

### Tauri / Electron 生态
- [hkandala/tauri-plugin-liquid-glass](https://github.com/hkandala/tauri-plugin-liquid-glass) · [crates.io](https://crates.io/crates/tauri-plugin-liquid-glass)
- [tauri-apps/window-vibrancy](https://github.com/tauri-apps/window-vibrancy) · [#182](https://github.com/tauri-apps/window-vibrancy/issues/182) · [#198](https://github.com/tauri-apps/window-vibrancy/issues/198)
- [terraphim/terraphim-liquid-glass-terminal](https://github.com/terraphim/terraphim-liquid-glass-terminal)
- [Electron #30412](https://github.com/electron/electron/issues/30412) · [#30077](https://github.com/electron/electron/issues/30077) · [#39529](https://github.com/electron/electron/issues/39529) · [#44720](https://github.com/electron/electron/issues/44720) · [#24346](https://github.com/electron/electron/issues/24346)
- [electron-acrylic-window (npm)](https://www.npmjs.com/package/electron-acrylic-window)

### iOS / Swift 参考实现
- [DnV1eX/LiquidGlassKit](https://github.com/DnV1eX/LiquidGlassKit)
- [conorluddy/LiquidGlassReference](https://github.com/conorluddy/LiquidGlassReference)
- [mertozseven/LiquidGlassSwiftUI](https://github.com/mertozseven/LiquidGlassSwiftUI)

### 本项目上游
- [shuding/liquid-glass](https://github.com/shuding/liquid-glass)
