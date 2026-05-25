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

- [ ] 若上次存在新的 Rust 崩溃日志，启动后应弹出“上次异常退出”提示；点“查看诊断”进入设置 → 关于 → 诊断与反馈。

---

## 1. 窗口外壳（30 秒）

- [ ] 默认 1200×800 启动，圆角 + 毛玻璃显示正常
- [ ] 拖动顶栏可移动窗口
- [ ] 右上角红/黄/绿按钮可关闭/最小化/全屏
- [ ] `Cmd+N` 新建窗口
- [ ] `Cmd+W` 关闭标签页；只有一个标签页时关闭窗口
- [ ] 按 `?` 打开快捷键列表；按 `Esc` 或关闭按钮收起；光标在搜索框 / 重命名输入框内时不触发
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
- [ ] 移动到同一目录 → 源文件不变、目标无新增，提示为同目录而不是同名冲突跳过
- [ ] 冲突弹窗选择「跳过」→ 同名目标保持原内容，非冲突项继续处理，传输管理器显示同名跳过计数
- [ ] 大文件复制中打开传输管理器 → 取消任务 → 目标目录不出现完整目标文件，已有同名旧文件内容不变
- [ ] 目录内放一个指向外部目录 / 父目录的 symlink → 复制后目标仍是 symlink，且没有展开复制链接目标内容
- [ ] 右键 → 移至废纸篓 → 文件消失
- [ ] 双击 `.txt` 用系统默认应用打开
- [ ] 重命名（F2 / 双击文件名）
- [ ] 用 AI 文件助手执行一次操作后打开 AI 操作历史，可看到新记录
- [ ] AI 操作历史支持按文件名关键词搜索、按日期筛选（今天 / 近 7 天 / 自定义）和分页翻页

## 4. 拖拽（1 分钟）

- [ ] **同窗口**：拖文件到子文件夹，文件夹高亮 → 松手移入
- [ ] **跨窗口**：A 拖文件出去，B 出现 "松开鼠标即可复制到此" overlay；松手在 B 内 → 复制
- [ ] **跨窗口移动**：Cmd + 松手 → A 中文件消失（按设置）
- [ ] **跨窗口冲突跳过**：移动到已含同名文件的目录，选择「跳过」后只跳过冲突项，非冲突项继续处理
- [ ] **跨窗口取消**：跨窗口复制 / 移动触发传输后取消，B 不留下半复制文件；移动取消后 A 源文件仍在
- [ ] **跨窗口 symlink**：拖拽复制含 symlink 的目录后，目标保留 symlink 本身而不是展开目标内容
- [ ] **设置 → 跨窗口拖拽默认动作**：切到"移动"，普通松手 = 移动；切到"每次询问"暂只走 copy（安全兜底）
- [ ] **Finder → Aether**：从 Finder 拖文件入 Aether 文件区 → overlay → 松手复制
- [ ] **拖到桌面 / Finder**：拖出 Aether 窗口外，松手 → 显示“暂不支持直接拖到 Finder”，引导使用“在 Finder 中显示”

## 5. 设置（1 分钟）

- [ ] 主题切换（浅色/深色/自动）即时生效
- [ ] 强调色选择 6 种预设 → 文字 / 高亮颜色实时变
- [ ] 模糊强度滑块默认 **0**（性能优先；> 0 时 GPU 占用上升）
- [ ] 字体下拉换字体生效
- [ ] **空格键预览**开关：开 → 选文件按空格 → Quick Look 弹出；关 → 不弹（其他入口仍可用）
- [ ] **跨窗口拖拽默认动作**：三段开关清晰可切
- [ ] **AI 操作历史保留期**：设置项可切换（3/7/15/30/90 天），关闭重开后配置保持
- [ ] 设置 → 文件与存储 → 配置备份与恢复：导出 JSON 含 `schemaVersion`；导入无效 JSON 在页面内显示错误；重置全部配置需要二次确认
- [ ] 设置 → 关于 → 诊断与反馈：可复制诊断信息、打开日志目录、打开配置文件夹、读取最近崩溃日志

## 6. 安全 / 边界（30 秒，开发者关注）

- [ ] 控制台试 `await window.__TAURI__.shell.open('javascript:alert(1)')` → 应被 Tauri capability 拒绝；用 `safeShellOpen` 也拒绝
- [ ] 设置 → 添加自定义扩展，命令含 `; rm` → 执行应失败（提示受限字符）
- [ ] 右键 `.env` 文件 → 预览面板提示"不在预览面板展示（含敏感信息）"
- [ ] macOS 开启“减少动态效果”后：网格 hover 不上浮，`?` 快捷键弹窗 / 传输弹窗不做位移缩放，加载指示器不持续旋转

## 7. 自动化测试（10 秒）

```bash
npm run lint          # TypeScript + ESLint
npm run lint:eslint   # 前端 console / browser dialog / Hooks 风险门禁
npm run lint:readme   # 中英文 README 标题同步，当前 22 个 tracked headings
npm run lint:i18n     # 高风险文案 i18n 覆盖，当前 79 个 locale key、26 处 ExplorerView 用法、12 处 AIRenamePanel 用法、4 处 app diagnostics 用法、7 处 settings diagnostics 用法、15 处 settings backup 用法、29 处 SettingsView 高风险用法、10 处 shortcut help 用法
npm run lint:ci-gates # CI / release 关键门禁覆盖，当前 8 test gates / 8 release gates / 8 local release gates / 10 script implementations / 3 dependency resolution checks / 19 CI setup checks / 3 timeout checks / 6 work branch triggers / 1 pull request target / 6 release trigger checks / 13 release security checks / 11 version checks / release integrity checks
npm run lint:rust     # Rust clippy，按 warning 即失败
npm test              # vitest，当前 14 个测试文件 / 129 个用例
npm run test:rust     # cargo test --lib，当前 81 个 Rust 单元测试
npm run build         # production build smoke
```

上述前端、Rust、文档、i18n、CI gate 和 production build 检查都通过，才算可以合并 / 发版。

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

- 跨窗口拖拽底层窗口不能可靠置顶 — 见 `BUG.md` 与 `docs/CROSS_WINDOW_DRAG.md`；如要根治需评估 CGEventTap 路线
- 大文件复制无进度 — 已接入 TransferModal + Rust 字节进度；回归时确认取消不留半成品
- 网格视图 hover 上浮已改 CSS（之前 framer-motion whileHover）；开启 reduced-motion 后应完全不上浮
