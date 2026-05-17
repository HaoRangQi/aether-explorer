# Aether Explorer Smoke Test

> 每次合并 / 发版前过一遍。预计耗时：5 分钟。
> 配套 `window.__aether.smoke()` 控制台脚本可自动完成约一半检查。

---

## 0. 启动 / 控制台自检（30 秒）

```bash
cd /Users/macos/Downloads/Projects/aether-explorer
npx tauri dev
```

启动后打开 DevTools（设置 → 启用开发者控制台 → 状态栏 ⚡），控制台输入：
```js
window.__aether.smoke()
```

期望输出 `ok: true`，所有 check 列表全绿。

---

## 1. 窗口外壳（30 秒）

- [ ] 默认 1200×800 启动，圆角 + 毛玻璃显示正常
- [ ] 拖动顶栏可移动窗口
- [ ] 右上角红/黄/绿按钮可关闭/最小化/全屏
- [ ] `Cmd+N` 新建窗口
- [ ] `Cmd+W` 关闭标签页；只有一个标签页时关闭窗口
- [ ] `Cmd+,` （如已绑定）进入设置

## 2. 文件浏览（1 分钟）

- [ ] 进入主页加载 < 1 秒
- [ ] 切换 列表 / 网格 / 分栏 三种视图
- [ ] 双击文件夹进入；← 返回上级；→ 前进
- [ ] 面包屑可点跳转、可点编辑路径
- [ ] 隐藏文件开关切换有效（看 `.DS_Store` / `.git` 等）

## 3. 文件操作（1 分钟）

- [ ] 单击选中、`Cmd+点击` 追加、`Shift+点击` 范围选
- [ ] `Cmd+A` 全选
- [ ] `Cmd+C` / `Cmd+V` 在同一目录粘贴会自动 " copy" 命名
- [ ] 右键 → 「复制到」/「移动到」弹出**目录选择对话框**（不再是 prompt!）
- [ ] 右键 → 移至废纸篓 → 文件消失
- [ ] 双击 `.txt` 用系统默认应用打开
- [ ] 重命名（F2 / 双击文件名）

## 4. 拖拽（1 分钟）

- [ ] **同窗口**：拖文件到子文件夹，文件夹高亮 → 松手移入
- [ ] **跨窗口**：A 拖文件出去，B 出现 "松开鼠标即可复制到此" overlay；松手在 B 内 → 复制
- [ ] **跨窗口移动**：Cmd + 松手 → A 中文件消失（按设置）
- [ ] **设置 → 跨窗口拖拽默认动作**：切到"移动"，普通松手 = 移动；切到"每次询问"暂只走 copy（安全兜底）
- [ ] **Finder → Aether**：从 Finder 拖文件入 Aether 文件区 → overlay → 松手复制
- [ ] **拖到桌面**：拖出 Aether 窗口外，松手 → 静默取消，无任何操作

## 5. 设置（1 分钟）

- [ ] 主题切换（浅色/深色/自动）即时生效
- [ ] 强调色选择 6 种预设 → 文字 / 高亮颜色实时变
- [ ] 模糊强度滑块默认 **0**（性能优先；> 0 时 GPU 占用上升）
- [ ] 字体下拉换字体生效
- [ ] **空格键预览**开关：开 → 选文件按空格 → Quick Look 弹出；关 → 不弹（其他入口仍可用）
- [ ] **跨窗口拖拽默认动作**：三段开关清晰可切

## 6. 安全 / 边界（30 秒，开发者关注）

- [ ] 控制台试 `await window.__TAURI__.shell.open('javascript:alert(1)')` → 应被 Tauri capability 拒绝；用 `safeShellOpen` 也拒绝
- [ ] 设置 → 添加自定义扩展，命令含 `; rm` → 执行应失败（提示受限字符）
- [ ] 右键 `.env` 文件 → 预览面板提示"不在预览面板展示（含敏感信息）"

## 7. 自动化测试（10 秒）

```bash
npm test            # vitest 41 个 / ~2 秒
npm run test:rust   # cargo test --lib 39 个 / < 1 秒
```

两层都通过才算可以合并 / 发版。

---

## 失败后的处置

| 失败项 | 可能原因 | 第一步 |
|--------|---------|-------|
| smoke 第 N 项报 unknown command | Rust 端命令未注册 | 检查 `invoke_handler!` 列表 |
| `list_directory` 不返回数组 | 权限被拒 / 路径不存在 | 看 macOS 系统设置 → 完全磁盘访问 |
| 跨窗口拖拽 banner 不显示 | event 注册失败 | DevTools 看 console 是否有 `aether-file-drag-start` log |
| Quick Look 不弹 | enableSpacePreview 关了 / qlmanage 不在 PATH | 重新打开开关 / 试 `which qlmanage` |
| 颜色 / 主题不切换 | localStorage 损坏 | 控制台 `localStorage.removeItem('theme-settings')` 后刷新 |

---

## 历史问题清单（已知不复现即可）

- 跨窗口拖拽底层窗口不能可靠置顶 — 已记 `TODO.md` 第一节，需要 CGEventTap 才能根治
- 大文件复制无进度 — 已有 TransferModal 骨架，对接 Rust 进度回调待做
- 网格视图 hover 上浮已改 CSS（之前 framer-motion whileHover）
