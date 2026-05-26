# Liquid Glass 液态玻璃实现原理研究

> **目标读者**：未来的 Claude（或工程师）。看完这份文档应当能在 0 依赖的情况下，从零复刻 Apple WWDC25 风格的"Liquid Glass"折射效果。
>
> **研究对象**：`liquid-glass/liquid-glass.js`（2D 圆角矩形版，292 行）与 `liquid-glass/liquid-diamond.js`（3D 金字塔光追版，1268 行）。
>
> **作者来源**：原作者 Shu Ding（<https://github.com/shuding/liquid-glass>），灵感来自其更早的 svg-shaders 项目。

---

## 0. TL;DR — 一句话原理

> **用一张 JS 实时绘制的"位移图"喂给 SVG `feDisplacementMap`，再通过 CSS `backdrop-filter` 把这个滤镜套到 DOM 元素上 ——「位移图」决定了元素背后每个像素的取样位置，于是平面背景看起来像被一块透明体折射了。**

整个项目**没有用 WebGL、没有用 Canvas2D 实时绘制背景、没有用 React**。仅 vanilla JS + SVG filter + 一点 CSS。

---

## 1. 核心机制：SVG 滤镜链如何"骗"出折射

### 1.1 SVG `feDisplacementMap` 的精确语义

```svg
<filter id="glass" filterUnits="userSpaceOnUse"
        color-interpolation-filters="sRGB"
        x="0" y="0" width="W" height="H">
  <feImage         result="map"  href="data:image/png;base64,..."  width="W" height="H"/>
  <feDisplacementMap in="SourceGraphic" in2="map"
                     xChannelSelector="R" yChannelSelector="G"
                     scale="S"/>
</filter>
```

**`feDisplacementMap` 的输出公式**（W3C 规范）：

```
P'(x, y) = P( x + scale * (Cx - 0.5),
              y + scale * (Cy - 0.5) )
```

其中 `Cx = R/255`、`Cy = G/255` 是 `in2` 那张位移图在 (x,y) 处的颜色值（已归一化到 [0,1]）。

含义：
- 颜色 `(127, 127, *, *)` → 不偏移（中性灰）
- R 越大向右偏，G 越大向下偏；反之亦然
- `scale` 控制最大偏移像素数

> ⚠️ **位移图的中性色 = (128, 128, 0, 255)**。项目里把所有偏移值压缩到 `[-maxScale, +maxScale]`，再线性映射到 `[0, 255]`，B 通道置 0、A=255。

### 1.2 `backdrop-filter` 让滤镜作用于"背景"

```css
.glass {
  backdrop-filter: url(#glass) blur(0.25px) contrast(1.2) brightness(1.05) saturate(1.1);
}
```

`backdrop-filter` 会把元素**身后的渲染结果**当作输入图像，喂给滤镜链。所以：

1. SVG `feImage` 提供位移图（JS 实时画的 canvas → dataURL）
2. `feDisplacementMap` 用位移图扭曲背景
3. 末尾的 `blur/contrast/brightness/saturate` 模拟玻璃的光学衰减（一点点磨砂、提对比、稍亮、提饱和）

**就是这三步。** 剩下所有代码都是为「如何画好那张位移图」服务的。

### 1.3 数据流

```
            ┌─────────────────────────┐
            │  fragment(uv) → (x, y)  │ ← JS shader 函数（每像素 1 次）
            └────────────┬────────────┘
                         ▼
        +-------+   两遍扫描   +---------------+
        | Float | ───────────▶| ImageData     |
        | 数组  | (求 maxScale)| R=dx,G=dy     |
        +-------+              +-------+-------+
                                       │
                                       ▼ canvas.toDataURL()
                              ┌────────────────────┐
                              │ feImage href="..." │
                              └────────┬───────────┘
                                       ▼
                              feDisplacementMap (scale=maxScale)
                                       ▼
                              backdrop-filter: url(#filter) blur contrast ...
                                       ▼
                              玻璃后面的页面元素被扭曲
```

### 1.4 为什么要"两遍扫描求 maxScale"

`feDisplacementMap` 的 `scale` 是一个标量。要把任意范围的 `dx/dy` 编码到 `[0,255]` 8 位通道里，必须先知道全体偏移的最大绝对值，把它当作 ±scale，再把每个值线性映射到 `[0,1]`：

```js
// liquid-glass.js:217-244 简化
let maxScale = 0;
const raw = [];
for (each pixel) {
  const pos = fragment(uv);
  const dx = pos.x * w - x;
  const dy = pos.y * h - y;
  maxScale = max(maxScale, |dx|, |dy|);
  raw.push(dx, dy);
}
maxScale *= 0.5;                       // 见 1.5 解释
for (each pixel) {
  R = raw[i]/maxScale + 0.5;           // → [0,1]
  G = raw[i+1]/maxScale + 0.5;
}
feDisplacementMap.scale = maxScale / canvasDPI;
```

### 1.5 `maxScale *= 0.5` 的玄机

把 `scale` 设为 `2 * |dxMax|` 而不是 `|dxMax|`，即 `R/255 - 0.5` 的有效范围是 `[-0.5, 0.5]` 而不是 `[-1, 1]`。
- `liquid-glass.js`：用 `maxScale *= 0.5`，再编码成 `raw / maxScale + 0.5`。
- `liquid-diamond.js`：相同思路写得更清楚 —— `r = raw / (maxScale * 2) + 0.5`，最后 `scale = maxScale * 2 / DPI`。

两种写法等价。**核心**：要保证 `(R-0.5) * scale = 真实 dx 像素数`，且 R 落在 `[0, 1]` 内不被钳。

### 1.6 `canvasDPI` 与 `scale` 的换算

位移图 canvas 是按物理像素画的（`canvas.width = width * DPI`），但 `feDisplacementMap.scale` 的单位是**用户空间像素**（CSS px）。所以最后要除回去：`scale = maxScale / DPI`。
- 2D 版 `canvasDPI = 1`（不放大）
- 3D 版 `CANVAS_DPI = 1.25`（更细位移图，更平滑的折射边缘）

---

## 2. 数学预备

只列项目里实际用到的、未来你会忘的部分。

### 2.1 SDF（有符号距离场）—— 圆角矩形

```js
// liquid-glass.js:23
function roundedRectSDF(x, y, w, h, r) {
  const qx = Math.abs(x) - w + r;
  const qy = Math.abs(y) - h + r;
  return Math.min(Math.max(qx, qy), 0)
       + length(Math.max(qx, 0), Math.max(qy, 0))
       - r;
}
```

返回值含义（约定原点在矩形中心）：
- 在矩形内 → 负数（离最近边的距离）
- 在矩形外 → 正数（到边的欧氏距离）
- 在边上 → 0

未来要换形状，直接把这函数换掉即可。常见 SDF 公式（来自 Inigo Quilez 的圣经页 <https://iquilezles.org/articles/distfunctions2d/>）：
- 圆形：`length(x,y) - r`
- 椭圆：稍复杂，按需查
- 任意凸多边形：边-点距离取最大

### 2.2 `smoothStep`（Hermite 平滑插值）

```js
function smoothStep(a, b, t) {
  t = clamp((t - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);          // S 曲线
}
```

- `smoothStep(0.8, 0, x)`：x 从 0.8 → 0 时，输出从 0 平滑过渡到 1（**注意 a > b 等价于反向**）
- 在 2D 版里用来把"距边缘的距离"转成"折射强度"

### 2.3 Snell 折射（向量形式）

```js
// liquid-diamond.js:324
function refractVector(I, N, eta) {
  // I = 入射方向，N = 法线（朝外），eta = n1/n2
  const cosθ = dot(N, I);          // 注意符号约定
  const k = 1 - eta*eta * (1 - cosθ*cosθ);
  if (k < 0) return null;          // 全反射，无折射光
  return normalize(I*eta - N*(eta*cosθ + sqrt(k)));
}
```

代码里的 `orientedNormal` 处理是为了无论法线朝里朝外、入射光朝里朝外都正确。`k < 0` 时返回 `null`，调用方走反射分支。

**IOR=1.18** 是项目调参后的值（玻璃≈1.5、水≈1.33）。1.18 偏弱，避免夸张畸变。

### 2.4 反射（Reflect）

```js
R = I - 2 * (N · I) * N
```

向量化即 `liquid-diamond.js:340` `reflectVector`。

### 2.5 Möller–Trumbore 三角形求交

`liquid-diamond.js:260` `intersectRayTriangle`。直接背公式：

```
edge1 = b - a;  edge2 = c - a;
pvec  = cross(D, edge2);
det   = dot(edge1, pvec);             // ≈0 → 平行无交
invDet= 1/det;
tvec  = O - a;
u     = dot(tvec, pvec) * invDet;     // 0..1
qvec  = cross(tvec, edge1);
v     = dot(D, qvec) * invDet;        // 0..1, u+v<=1
t     = dot(edge2, qvec) * invDet;    // 距离参数
```

`SURFACE_OFFSET = 0.008`：用 `t > SURFACE_OFFSET` 防止"自交"（光从面 A 出来又立刻被同一面捕获）。

### 2.6 凸包（Andrew's Monotone Chain）

`liquid-diamond.js:489` `convexHull`。把所有顶点按 (x,y) 排序，做下半凸包+上半凸包。复杂度 O(n log n)，5 个顶点的情况几乎瞬时完成。

用途：把 3D 金字塔投影到 2D 后，取外轮廓多边形作为 CSS `clip-path: polygon(...)`，这样玻璃只在多边形内可见。

### 2.7 弱透视投影

```js
// liquid-diamond.js:374
function projectPoint(P) {
  const depth  = CAMERA_Z - P.z;
  const factor = CAMERA_Z / depth;     // 越远越小
  return [P.x * factor, P.y * factor];
}
```

针孔相机模型的简化版（z 轴对齐相机）。

---

## 3. `liquid-glass.js` 逐模块拆解（2D 圆角矩形版）

### 3.1 文件骨架

```
IIFE
├─ 工具函数：smoothStep, length, roundedRectSDF, texture, generateId
├─ class Shader
│   ├─ constructor(options)
│   ├─ createElement()           ← DOM/SVG/canvas 一次性建好
│   ├─ constrainPosition()       ← 视口边界 clamp
│   ├─ setupEventListeners()     ← 拖拽
│   ├─ updateShader()            ← 重画位移图
│   ├─ appendTo() / destroy()
└─ createLiquidGlass()           ← 实例化 + 写 fragment
```

### 3.2 DOM 结构（`createElement`，`liquid-glass.js:56`）

```
<svg width=0 height=0>            ← 仅承载滤镜定义，不渲染
  <defs>
    <filter id="lg-xxx_filter" filterUnits="userSpaceOnUse"
            x=0 y=0 width=W height=H
            color-interpolation-filters="sRGB">
      <feImage  id="lg-xxx_map" width=W height=H/>
      <feDisplacementMap in="SourceGraphic" in2="lg-xxx_map"
                         xChannelSelector="R" yChannelSelector="G"/>
    </filter>
  </defs>
</svg>
<div class="container">           ← 实际可见的玻璃
  /* fixed 居中, 圆角, box-shadow（外阴影+内阴影）,
     backdrop-filter: url(#filter) blur(0.25px) contrast(1.2) brightness(1.05) saturate(1.1) */
</div>
<canvas style="display:none">     ← 离屏，仅用于生成位移图 dataURL
```

> 关键：`filterUnits="userSpaceOnUse"` 让 filter 的 x/y/w/h 用绝对像素，不是百分比；`color-interpolation-filters="sRGB"` 避免浏览器在线性空间做位移插值（位移值是几何量不是颜色）。

### 3.3 fragment 函数（`liquid-glass.js:265`）

```js
fragment: (uv, mouse) => {
  const ix = uv.x - 0.5;          // 中心化到 [-0.5, 0.5]
  const iy = uv.y - 0.5;
  const distanceToEdge = roundedRectSDF(ix, iy, 0.3, 0.2, 0.6);
  const displacement   = smoothStep(0.8, 0, distanceToEdge - 0.15);
  const scaled         = smoothStep(0, 1, displacement);
  return texture(ix * scaled + 0.5, iy * scaled + 0.5);
}
```

逐行：
1. UV 中心化 → 坐标系原点在玻璃中心
2. `roundedRectSDF(...0.3, 0.2, 0.6)`：以"半宽 0.3、半高 0.2、半径 0.6"定义形状（注意是 UV 坐标尺度）。**0.6 > 0.3 让矩形高度退化为类似柔性药丸**
3. `smoothStep(0.8, 0, d - 0.15)`：距边缘约 0.15 起开始有位移，0.8 处达到最大 → 中央 = 0，边缘 ≈ 1
4. `scaled` 再过一次 smoothStep → 更非线性的衰减
5. `ix * scaled + 0.5`：把当前点向中心收缩。`scaled=1` 时输出 0.5（中心）；`scaled=0` 时输出原 uv（无位移）

> **直觉**：边缘像素都被往中心挤 → 背景在玻璃边缘附近被压缩、放大 → 视觉上像凸透镜折射。
>
> 注意这**不是**真折射，只是"基于 SDF 的视觉欺骗"。但对扁平形状已经够好。

### 3.4 拖拽（`liquid-glass.js:140`）

经典 mousedown/mousemove/mouseup 状态机：
- `mousedown`：记录 `startX/Y` 与 `initialX/Y`，cursor → grabbing
- `mousemove`：`new = initial + (e.client - start)`，clamp 到视口，写到 `style.left/top` 并清掉 `transform`
- `mouseup`：恢复 cursor

`mouseUsed` 机制（`updateShader`）：用 `Proxy` 监听 fragment 是否真的访问了 `mouse.x/y`；只有访问过的 fragment 才在鼠标移动时触发重画，避免无意义计算。

### 3.5 关键设计决策

| 决策 | 原因 |
|---|---|
| `position: fixed` 浮在视口 | 让玻璃可以盖任何元素 |
| `z-index: 9999` 与 `9998` | 内容层与 SVG 各占一位，避免被业务遮挡 |
| `pointer-events: auto / none` | 玻璃可拖、SVG 不挡点击 |
| `box-shadow: 0 -10px 25px inset` | 顶部内阴影 → 暗化顶部 → 强化"凸起"错觉 |
| `border-radius: 150px` | 远大于实际尺寸 → 自动取最大 → 药丸形 |

---

## 4. `liquid-diamond.js` 逐模块拆解（3D 光追金字塔版）

### 4.1 升级矩阵

| 维度 | 2D 版 | 3D 版 |
|---|---|---|
| 形状 | SDF 圆角矩形 | 5 面金字塔（4 三角侧面 + 2 三角底面） |
| 折射 | SDF 边缘缩放（视觉欺骗） | 真光追 + Snell 定律 |
| 反射 | 无 | 全反射时内反弹最多 8 次 |
| 视角 | 静态 | θ/φ 双轴旋转，跟随拖拽 |
| 拖拽 | 硬 clamp | 弹性边界 + 速度阻尼 + 弹簧回弹 |
| 装饰层 | 单层 backdrop-filter | bloom + rim + face overlay + edge bulge |
| 性能 | Uint8ClampedArray | Float32Array 缓存 + ImageData 复用 + RAF 节流 |
| 形状裁剪 | `border-radius` | `clip-path: polygon(凸包)` |

### 4.2 几何定义（`liquid-diamond.js:165`）

```js
const BASE = {
  apex: [0, 1.18, 0],                  // 顶点
  base: [                              // 底面 4 顶点（顺时针/逆时针）
    [-1.04, -0.92, -1.04],
    [ 1.04, -0.92, -1.04],
    [ 1.04, -0.92,  1.04],
    [-1.04, -0.92,  1.04],
  ],
};
const VERTICES = scaleVertices(BASE, 0.9);
const INTERIOR = [0, -0.27, 0];        // 任意"明确在内部"的点

const PLANES = [/* 5 个平面，每个 = createPlane(a,b,c, INTERIOR) */];
const FACES  = [/* 6 个三角形 = 4 侧面 + 2 三角形拼成的方形底 */];
```

`createPlane(a,b,c,interior)` 用 `cross(b-a, c-a)` 求法线，然后用 `interior` 校正方向 —— **保证所有面法线朝外**。这是后续光追时正确判断进/出的前提。

### 4.3 旋转矩阵（直接展开，无矩阵库）

```js
// liquid-diamond.js:127
function rotatePointWithTransform(P, T) {
  // 1. 绕 Y 轴转 θ
  const yx = P.x * T.thetaCos + P.z * T.thetaSin;
  const yz = -P.x * T.thetaSin + P.z * T.thetaCos;
  // 2. 绕 X 轴转 φ
  return [
    yx,
    P.y * T.phiCos - yz * T.phiSin,
    P.y * T.phiSin + yz * T.phiCos,
  ];
}
```

`inverseRotatePointWithTransform` 是它的逆（先逆 X，再逆 Y）。

**优化技巧**：每帧只算一次 `cos/sin(θ,φ)` 缓存到 `transform` 对象里复用。

### 4.4 光追主流程（`tracePyramidRay`，`liquid-diamond.js:609`）

```
1. uv → 屏幕世界点  (uvToScreenPoint)        // [-VIEWPORT_SCALE, +VIEWPORT_SCALE]
2. 从 CAMERA 发出射线 D = normalize(屏幕点 - 相机)
3. 求与晶体所有面的最近交点 (intersectCrystalFaces，转到本地坐标后用 Möller–Trumbore)
   - 没交点 → 返回 null（不折射，原样输出）
4. entryPoint = 第一个交点；refract(进入，eta=1/IOR)
   - 全反射 → 反射方向，跳到 7
5. 循环最多 MAX_INTERNAL_BOUNCES=8 次：
   - 从 entryPoint 沿内部方向再求交（这次只能打中其它面）
   - 若 refract 成功（eta=IOR）→ 退出循环，得到 outsideDirection
   - 否则 reflect → 继续内反弹
6. 7. 用 outsideDirection 从 exitPoint 出发，traceToPlane(BACKGROUND_Z)
   - 在背景平面 z=-5.5 上得到一个点
   - 把这个点投影回 UV → displacedUv
8. 计算 (displacedUv - uv) 的偏移量，做软裁剪 (tanh) 防爆 → 返回
```

每一步的辅助：

- `stabilizeBackgroundDirection`（`:83`）：如果光线快要平行于背景平面，强制把 z 分量拉到至少 `-0.08`，否则 `traceToPlane` 会无穷远 → 数值爆炸。
- `softClampSigned(v, L) = L * tanh(v / L)`（`:76`）：超出 ±L 时平滑压回，避免 SDF 缝合不连续。

### 4.5 边缘膨胀 `applyEdgeBulge`（`liquid-diamond.js:680`）

光追结果在凸包边缘附近**额外**叠加一个朝中心的小偏移：

```js
edgeWeight = 1 - smoothStep(0, 20, 距凸包边的像素距离);
displacedUv += (中心 - uv) * edgeWeight * 0.04;
```

视觉上让晶体边缘看起来更像 "Apple 玻璃"——边缘有一圈轻微会聚高光区。

### 4.6 装饰层（4 层叠加）

`liquid-diamond.js` 在玻璃 host 内部叠了 4 层 div/svg，自下而上：

```
┌─────────────────────────────────┐
│ host (cursor:grab, pointer:auto)│
│  ┌───────────────────────────┐  │
│  │ bloom  (clip-path 凸包)   │  │ ← 4 个径向渐变模拟高光散射
│  │ rim    (clip-path 凸包)   │  │ ← 单一线性渐变 + drop-shadow 边光
│  │ edgeSvg (面线条 polygon)  │  │ ← 6 个三角面的轮廓+半透明填色
│  │ shell   (backdrop-filter) │  │ ← 真正的折射玻璃片，盖在最上
│  └───────────────────────────┘  │
└─────────────────────────────────┘
```

注意：**shell 在最顶层**，所以它的 backdrop 是它身后的所有层（bloom/rim/edgeSvg）+ 页面背景。这意味着 bloom 的高光也会被折射 —— 这是质感的关键之一。

#### Bloom 的渐变锚点（`updateTransform`，`:1061`）

bloom 用 4 个径向渐变叠加：
1. **顶点高光**（最亮，白→淡青）锚定 `bloomAnchors.top`（凸包 y 最小者）
2. **左下次级高光** 锚定 `bloomAnchors.lowerLeft`（最小化 x+y）
3. **右下次级高光** 锚定 `bloomAnchors.lowerRight`（最大化 x-y）
4. **中心柔光** 锚定凸包中心

这 4 个渐变随旋转角动态重算 → 看上去像物理高光在面上滑动。

#### Rim（边光）

```css
background: linear-gradient(145deg, rgba(255,255,255,0.72), ...);
filter: drop-shadow(0 0 6px ...) drop-shadow(0 0 14px ...);
```

`drop-shadow` 作用于 clip-path 多边形 → 多边形外缘出现一圈柔光。

#### Face Overlay

每个三角面投影后绘成 `<polygon>`，描边和填充透明度跟随**法线 vs 视线方向**变化（`facing = |normal · viewDir|`）：

```js
strokeOpacity = 0.09 + facing * 0.14;
fillOpacity   = 0.012 + facing * 0.028;
```

正对相机的面更亮、更明显 → 强化立体感。

### 4.7 物理拖拽（`liquid-diamond.js:1129`）

```
state: x, y (位置), vx, vy (速度), dragging
拖拽中：
  x = elasticPosition(dragOrigin + delta, minX, maxX)
       超出边界则 (value-bound)*0.16 ← 弹性
  vx = (clientX - lastX)/dt * 16   ← 持续记录速度
拖拽结束：
  每帧：
    x += vx;  vx *= 0.94 (阻尼)
    if (out of bounds) vx += (bound-x)*0.014; vx *= 0.82  ← 弹簧+额外阻尼
    if (|v| < 0.01) snap to bound → 停下
旋转：
  θ = 0.64 + x * 0.0125    ← 水平拖拽 → 绕 Y 轴
  φ = clamp(-0.42 - y * 0.01, ±1.35) ← 垂直拖拽 → 绕 X 轴
```

调参口诀：DRAG_ELASTIC（拖拽时超界软度）、VELOCITY_DAMPING（松手后摩擦）、BOUND_SPRING/BOUND_DAMPING（碰边弹簧软硬）。

### 4.8 性能优化

| 技巧 | 位置 | 效果 |
|---|---|---|
| `Float32Array` 缓存原始位移 | `:836` | 避免每帧 `push` 触发数组扩容 |
| `ImageData` 复用 | `:832` | 不要每帧 `new ImageData(w,h)` |
| `requestAnimationFrame` 节流 | `:879` | 多次 `setFragment` 合并成一帧 |
| 几何**预计算** | 模块顶部 | `PYRAMID_PLANES/FACES` 在加载时一次性算好，之后只对每帧的 transform 旋转 |
| 三角面相交在**本地坐标**做 | `:294` | 旋转一次 origin/direction，比旋转所有顶点便宜 |

---

## 5. 复用模板（Cookbook）

### 5.1 模板 A：任意 2D 形状的液态玻璃

**复制 `liquid-glass.js`，只改这 3 处：**

1. **替换 SDF 函数**（你的形状的有符号距离场）：
   ```js
   function myCircleSDF(x, y, r) { return length(x, y) - r; }
   ```
2. **fragment 改成你的 SDF**：
   ```js
   fragment: (uv) => {
     const ix = uv.x - 0.5, iy = uv.y - 0.5;
     const d = myCircleSDF(ix, iy, 0.4);
     const k = smoothStep(0.5, 0, d - 0.1);
     return texture(ix*k + 0.5, iy*k + 0.5);
   }
   ```
3. **container 的 `border-radius` / `clip-path`** 设成与 SDF 一致的形状，否则边角会露出未折射区域。

### 5.2 模板 B：任意凸 3D 多面体的液态晶体

**复制 `liquid-diamond.js`，只改这 4 处：**

1. **替换 `BASE_PYRAMID_VERTICES`**：给出 `apex` 和 `base[]`（或更通用：直接给所有顶点 + 拓扑）
2. **替换 `PYRAMID_PLANES`**：为每个面调 `createPlane(a, b, c, INTERIOR)`，注意 `INTERIOR` 必须真在内部
3. **替换 `PYRAMID_FACES`**：列出每个三角形（多边形面要先三角剖分）
4. **重新选 `bloomAnchors`** 的锚定策略（顶/左下/右下/中心）使其匹配你新形状的视觉重心

> 提示：如果你的形状不是凸的，光追内反射会反复进入凸包外的区域 —— 此时 `intersectCrystalFaces` 仍然会工作（因为它只看面交点），但 `convexHull` 当作 clip-path 会**漏掉凹处**，需要换成原始投影多边形（多个面分别 clip）。

### 5.3 调参手册

| 参数 | 增大效果 | 减小效果 | 建议范围 |
|---|---|---|---|
| `IOR` | 折射更夸张 | 接近无折射 | 1.05 ~ 1.5 |
| `MAX_INTERNAL_BOUNCES` | 内反射更复杂、更亮 | 内部光快速逃出 | 4 ~ 12 |
| `MAX_EFFECTIVE_UV_OFFSET` | 边缘可看到更远处 | 折射受限、稳但平 | 0.2 ~ 0.5 |
| `EDGE_BULGE_PX` / `STRENGTH` | 边缘"圆鼓"越强 | 平直 | (10~30, 0.02~0.08) |
| `backdrop-filter blur(...)` | 玻璃越磨砂 | 越透 | 0 ~ 1px |
| `contrast(...)` | 后景更分明 | 平淡 | 1.0 ~ 1.3 |
| `saturate(...)` | 颜色更艳 | 黯 | 1.0 ~ 1.2 |
| `CANVAS_DPI` | 位移图更细，无锯齿 | 性能高 | 1.0 ~ 2.0 |

---

## 6. 从零复刻：4 阶段路线图

> 强烈建议按顺序逐阶段验证。每一阶段都比上一阶段大约多 2-3 倍工作量。

### 阶段 1：纯 CSS 静态磨砂玻璃（10 行 CSS，30 秒）

```css
.glass {
  position: fixed; inset: 50% auto auto 50%;
  width: 300px; height: 200px;
  transform: translate(-50%,-50%);
  border-radius: 150px;
  backdrop-filter: blur(8px) saturate(1.2);
  background: rgba(255,255,255,0.1);
  box-shadow: 0 4px 8px rgba(0,0,0,.25), inset 0 -10px 25px rgba(0,0,0,.15);
}
```

✅ 验证：能看到背景磨砂。这是基线。

### 阶段 2：用静态 PNG 做位移图（验证 SVG 滤镜链）

1. 准备一张 300×200 PNG，**中间渐变**：左半 R 高、右半 R 低（或随便画）
2. 写最小 SVG：
   ```html
   <svg width=0 height=0><defs><filter id="f" filterUnits="userSpaceOnUse" x=0 y=0 width=300 height=200>
     <feImage href="map.png" result="m"/>
     <feDisplacementMap in="SourceGraphic" in2="m" xChannelSelector="R" yChannelSelector="G" scale="40"/>
   </filter></defs></svg>
   ```
3. 把 `.glass` 的 `backdrop-filter` 换成 `url(#f) blur(0.25px)`

✅ 验证：背景按 PNG 的颜色被扭曲。理解这一步等于理解全部"骗术"。

### 阶段 3：JS 动态生成位移图（圆角矩形版）

复刻 `liquid-glass.js`：
1. 用 canvas 实现两遍扫描（求 maxScale → 编码 RGBA）
2. fragment 用 `roundedRectSDF` + `smoothStep`
3. `feImage.href = canvas.toDataURL()`
4. `feDisplacementMap.scale = maxScale / DPI`

✅ 验证：玻璃边缘有透镜会聚，与 2D 版输出一致。

### 阶段 4：3D 光追晶体

复刻 `liquid-diamond.js`：
1. 数学库 + Möller–Trumbore（先单元测试一个三角面）
2. 单次折射进入晶体 → 直接打到背景平面（跳过内反射） → 验证光追主路径
3. 加内反射循环（最多 8 次）
4. 加旋转（θ/φ 跟拖拽）
5. 加凸包 + clip-path
6. 加 4 层装饰（bloom/rim/edgeSvg/shell）
7. 加弹性拖拽

✅ 每一步都视觉可见，逐步加。

---

## 7. 已知坑 & FAQ

### 7.1 浏览器兼容性

| 特性 | 兼容 |
|---|---|
| `backdrop-filter: url(#filter)` | ⚠️ Chrome/Edge 76+；Safari 18+；Firefox 默认禁用（layout.css.backdrop-filter.enabled） |
| `feDisplacementMap` | ✅ 全平台 |
| `clip-path: polygon(...)` | ✅ 全平台 |
| `setPointerCapture` | ✅ 全平台（IE 不算） |

> Safari 必须写 `-webkit-backdrop-filter`。3D 版已写：`shell.style.webkitBackdropFilter = ...`。

### 7.2 `feImage` 的 `href` vs `xlink:href`

- 旧规范用 `xlink:href`（带 namespace）
- 新规范 `href`（无 namespace）
- 2D 版用 `setAttributeNS('http://www.w3.org/1999/xlink', 'href', ...)`，3D 版用 `feImage.setAttribute('href', ...)`
- **现代 Chrome/Safari 两者都接受**，但要兼容老 Safari 建议两者都写

### 7.3 `color-interpolation-filters` 必须设 sRGB

```js
filter.setAttribute('color-interpolation-filters', 'sRGB');
```

否则浏览器在线性色彩空间插值，位移值（几何量）会被错误 gamma 校正 → 边缘不连续。

### 7.4 性能瓶颈

- 每帧像素数 = `W × H × DPI²`。300×200×1=60k pixels；220×220×1.5625≈75k pixels。每像素一次 fragment 调用。
- 3D 版每像素最多 8 次三角形求交（光追内反射）。在 Mac M1 上稳定 60fps，老机器或更大尺寸会掉。
- 优化方向：
  - 降 DPI
  - 限制 `MAX_INTERNAL_BOUNCES`
  - WebWorker（项目未做）
  - 改写成 GLSL 在 WebGL 里跑（最彻底）

### 7.5 `pointer-events` 陷阱

3D 版用 `mount.pointerEvents=none`、`interactionLayer.pointerEvents=none`、`host.pointerEvents=auto`。这种"父级 none + 子级 auto"的写法允许玻璃只在自己的多边形区域接收点击，外部区域照常穿透。

### 7.6 拖拽时光追每帧重算

3D 版每次旋转（即每次 `updateTransform`）都重画位移图。代价很高 —— 这是 60fps 上限的主要来源。如果只想"静态展示"，把光追结果缓存为 PNG 即可。

### 7.7 `feImage` 的延迟问题

`canvas.toDataURL()` 是同步的，但浏览器加载 dataURL 到 SVG `feImage` 是异步的。第一帧可能"裸奔"无折射 —— 项目里没专门处理，因为通常第二帧就跟上。如果你做精确截图测试要注意。

---

## 8. 文件定位速查

| 你想找... | 看这里 |
|---|---|
| 滤镜 DOM 怎么搭 | `liquid-glass.js:56-121` 或 `liquid-diamond.js:716-758` |
| 两遍扫描位移图 | `liquid-glass.js:200-245` 或 `liquid-diamond.js:824-877` |
| 圆角矩形 SDF | `liquid-glass.js:23` |
| Möller–Trumbore | `liquid-diamond.js:260` |
| Snell 折射 | `liquid-diamond.js:324` |
| 光追主流程 | `liquid-diamond.js:609-678` |
| 凸包 | `liquid-diamond.js:489-522` |
| Bloom 4 渐变 | `liquid-diamond.js:1061-1104` |
| 弹性拖拽物理 | `liquid-diamond.js:1129-1165` |
| θ/φ 与拖拽位置的映射 | `liquid-diamond.js:1047-1048` |

---

## 9. 一句话总结（再次强调）

> **液态玻璃 = SVG `feDisplacementMap` 用一张 JS 实时画的位移图扭曲 `backdrop-filter` 的背景采样。**
> 2D 版用 SDF 边缘缩放视觉欺骗折射；3D 版用真光追+内反射+旋转晶体得到真折射；剩下都是装饰与交互。

掌握这一句，剩下都是工程量。
