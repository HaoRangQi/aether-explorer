# 草稿池 SCRATCH

← 返回 [索引](./README.md)

> 新经验先入这里。满足 [§ 晋升标准](./README.md#晋升标准) 后整章迁出为 `NN-<域名>.md`。
>
> 条目格式（见 [§ 触发协议 阶段 4](./README.md#阶段-4--撰写)）：
>
> ```markdown
> ### [YYYY-MM-DD] <一句话主题>
> - **现象**: ...
> - **当前判断**: ...
> - **遗留疑问**: ...
> ```

---

### [2026-05-14] 拖拽移动功能前端无反应

- **现象**: 手工测试拖拽文件到文件夹，前端没有响应、高亮不出现、drop 不触发，即使后端接口已实现
- **当前判断**: 可能是 handlers 没有正确绑定、dataTransfer 获取失败、或者某个中间层阻止了默认行为。前端代码已改，但需诊断为什么 DragStart/DragOver/Drop 序列中断了
- **遗留疑问**: 是前端某个 handler 没挂上、还是样式遮挡了拖拽区域、还是 ExplorerView 本身的容器设置不对。需加日志重新追踪事件流

### [2026-05-17] 跨窗口拖拽底层窗口置顶不可靠

- **现象**: 两个 Aether 窗口堆叠，从顶层窗口拖文件出去，底层窗口收到 banner 提示了，但底层窗口本身没有自动浮到前台。鼠标进入底层窗口可视区后才偶尔 raise，跨窗口边界的瞬间不可靠
- **当前判断**: macOS WebKit 在鼠标离开源 webview 可视区后**停止派发 `drag` 事件**（系统接管拖拽），导致前端 `document.addEventListener('drag')` 节流广播屏幕坐标的方案在边界瞬间失效。`onDragEnter` 在跨窗口 HTML5 拖拽场景下也不稳定。当前 commit `ae5a46d` 的 `raise_window_at` Rust 命令是对的，但前端触发频率不足
- **遗留疑问**: 根治方案 = Rust 端 `core-graphics` `CGEventTap` 全局监听 mouseMoved，30Hz 轮询屏幕坐标，但需要"输入监控"权限弹框（macOS Sequoia+），需先决策是否引入这层权限。窗口不重叠场景当前实现已可用，重叠场景需手动 `Cmd+~` 切窗口。详见 `docs/CROSS_WINDOW_DRAG.md` 决策点

### [2026-05-17] 虚拟滚动只渲染前 23 项后看不见

- **现象**: 大目录（百+文件）切到列表视图，滚动条能动但只看到前 23/18 项，再滚也看不到后面文件
- **当前判断**: 项目里有**两套** `displayMode === 'list'` 渲染代码块（`ExplorerView.tsx:3661` condensed + `3707` table-header），两套都挂 `scrollContainerRef` 但 ref 会被第二个覆盖；最早 `onScroll` 还误挂在外层 `containerRef`（不滚动的 wrapper），导致 `scrollTop` state 永远 0，`visibleRange.start=0, end=23` 永久不更新。已在 commit `4ebe106` / `d0ff36a` 修复（onScroll 挂到内层 scrollContainerRef）
- **遗留疑问**: 两套 list 视图代码长期共存是 ExplorerView 4000 行的副作用 — 共享 ref 容易踩坑。等 `IMPROVEMENT_PROPOSALS` P3-23（拆分 ExplorerView）做完时合并成一套

### [2026-05-17] 父子菜单 backdrop-filter 嵌套失效

- **现象**: 打开方式子菜单浮在父右键菜单旁边，用同样的 `bg-primary/10 + backdrop-blur-3xl` 配方但显得透明，能看清底下文件区文字。换成 `bg-surface` 实色变成纯白色不搭。换 `fixed` 定位 + 真模糊后位置算错距父菜单老远（commit `58c1414` → revert `8d99793`）
- **当前判断**: WebKit 不嵌套 `backdrop-filter` — 子菜单的 backdrop 是父菜单（半透明），再 blur 几乎无效。父菜单的"不透明"来自 blur 整个杂乱文件区的视觉感受，子菜单 blur 半透明父级没东西可糊。当前 commit `7d969c2` 的折中方案是 `color-mix(in srgb, var(--primary) 8%, var(--surface) 100%)` 实色，主题感弱但可读
- **遗留疑问**: 想保留玻璃感的最稳办法是子菜单 portal 到 body 根（脱离父 stacking context），用 fixed + JS 算坐标。简易版尝试失败（坐标偏移），需要 `getBoundingClientRect` + viewport edge 自适应翻折。等 `IMPROVEMENT_PROPOSALS` 第七节命令面板 Cmd+K 做的时候顺手抽一个 `<FloatingMenu>` 公共组件解决
