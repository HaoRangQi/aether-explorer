# Aether Explorer 全栈测试报告

> 日期：2026-05-30  
> 范围：Aether Explorer 当前工作树，Tauri v2 + React 19 + TypeScript + Rust。  
> 目标：按功能理解、测试计划、测试用例、可执行测试、静态审查、执行模拟完成一轮全项目测试闭环。

## 步骤 1：理解与分析

### 项目定位

Aether Explorer 是一个 macOS 本地优先文件工作台。核心价值是增强 Finder 的文件浏览、批量操作、预览、传输、多窗口、标签和个性化能力，而不是替换系统默认文件管理器。

### 功能点梳理

| 模块 | 功能点 | 关键路径 |
|---|---|---|
| 应用外壳 | Tauri 桌面应用、无边框窗口、毛玻璃、主题、字体、壁纸、多窗口 | 启动、窗口拖拽、窗口创建、主题同步 |
| 文件浏览 | 目录读取、元数据、隐藏文件、面包屑、导航历史、列表 / 网格 / 分栏 | `list_directory`、`get_directory_signature`、前端三视图渲染 |
| 文件交互 | 单选、多选、Shift 范围选择、框选、右键菜单、拖拽、排序、分组、搜索 | `ExplorerView` 选择状态、上下文菜单、拖放事件 |
| 文件操作 | 打开、复制、移动、重命名、废纸篓、新建、压缩、解压、替身、哈希 | Rust 文件命令、冲突策略、操作历史 |
| 预览面板 | 图片、视频、PDF、文本、Quick Look、属性、标签 | `read_text_preview`、`quick_look`、`get_file_info` |
| 侧边栏 | 收藏、最近、iCloud、废纸篓、网络卷、标签筛选、存储空间 | 虚拟路径、卷列表、标签映射 |
| 传输管理 | 后台复制 / 移动任务、进度、取消、冲突摘要、跨设备移动降级 | `start_copy_files_task`、`start_move_files_task`、`cancel_transfer_task` |
| 设置系统 | 外观、文件、权限、扩展菜单、终端、AI provider、备份恢复 | Tauri Store、localStorage、导入清洗、密钥脱敏 |
| macOS 集成 | Quick Look、Finder reveal、终端打开、卷弹出、默认打开方式 | `qlmanage`、`open`、`diskutil`、AppleScript |
| 发布与诊断 | 崩溃日志、诊断信息、更新检查、README / i18n / CI gate | panic log、release gate scripts |

### 核心领域模型

| 模型 | 含义 | 测试关注 |
|---|---|---|
| `FileItem` | 前端统一文件 / 文件夹 / 媒体 / 应用模型 | `path` 同时作为 ID，重命名 / 移动后状态同步 |
| `ThemeSettings` | UI、终端、AI provider、跨窗口策略、默认首页等配置 | 迁移、持久化、密钥脱敏、导入清洗 |
| `OperationSession` | AI / 手工操作历史与 undo 信息 | 可撤销判定、逆序回滚、部分失败 |
| `TransferTaskSnapshot` | 后台复制 / 移动任务状态 | 进度、取消、冲突、跨设备移动统计 |
| `MoveConflictStrategy` | `abort` / `replace` / `keepBoth` / `skip` | 数据覆盖、冲突预览、跳过计数 |
| `TabData` | 多标签与跨窗口标签传输 | 拖拽分离、关闭保护、路径同步 |
| `AppError` | Rust 到前端的结构化错误 | 权限、NotFound、冲突、取消、外置卷废纸篓 |

### 关键业务流程

| 流程 | 步骤 | 风险 |
|---|---|---|
| 启动 | 加载 localStorage / Tauri Store → 初始化标签 → 权限预检 → 同步主题和语言 | 配置损坏、权限错误、默认首页无效 |
| 浏览目录 | 用户打开路径 → 前端调用 `listDirectory` → Rust 读取目录 → 前端排序 / 过滤 / 分组 | 大目录性能、隐藏文件过滤、取消旧请求 |
| 文件复制 | 选中文件 → 选择目标 → 预览冲突 → 执行 copy task → 刷新目录 / 记录历史 | 覆盖、symlink 展开、取消残留 |
| 文件移动 | 选中文件 → 目标目录 → 同目录 / 冲突 / 跨设备分支 → 任务完成 | 源文件误删、跨设备降级、undo 可用性 |
| 解压 | 选择 zip → 输出目录 → 预扫描 entry → 写入文件 | Zip Slip、重复 entry、覆盖现有文件 |
| Undo | 加载操作历史 → 验证 reverse op 前置条件 → 逆序执行 | 目标已存在、部分失败、状态回写 |
| 跨窗口拖拽 | 源窗口写 payload → 目标窗口读取 → copy / move / ask → 传输任务 | WebKit 事件丢失、重复触发、冲突弹窗 |
| 设置导入 | 读取 JSON → schema 校验 → 清洗 theme / favorites / tags → 确认导入 | 恶意 URL、自动命令、密钥导入 |

### 潜在风险与复杂逻辑

| 风险级别 | 风险点 | 说明 |
|---|---|---|
| P0 | 文件覆盖 / 删除 | 文件管理器的最高风险，尤其是 `replace`、trash、跨设备 move |
| P0 | 解压安全 | 必须防 Zip Slip、覆盖和重复目标路径 |
| P0 | 命令执行注入 | 终端扩展、shell 模板、AppleScript 均需双层防护 |
| P0 | 敏感信息 | AI API Key、`.env` / SSH key 预览、诊断日志 |
| P1 | 跨窗口拖拽 | macOS WebKit 拖拽事件不稳定，状态同步复杂 |
| P1 | 分栏深层预览 | 已知子分栏选择与预览绑定不同步 |
| P1 | 大目录性能 | 列表渲染、目录大小、缩略图、签名轮询都可能放大 |
| P2 | UI 一致性 | 毛玻璃、主题、缩放、reduced-motion、i18n 文案 |

## 步骤 2：测试计划制定

### 测试类型

| 类型 | 覆盖目标 | 工具 |
|---|---|---|
| 单元测试 | 纯函数、数据清洗、错误归一、路径和安全规则 | Vitest、Rust `cargo test` |
| 集成测试 | 前端 API wrapper 与 Tauri command 契约、文件操作组合 | Vitest mock、Rust 内联测试 |
| E2E 测试 | 用户真实流程、窗口、拖拽、快捷键、右键菜单 | 后续 Playwright / Tauri driver，当前以 smoke checklist 为主 |
| UI 测试 | 三视图渲染、空状态、加载、弹窗、主题 | 手工 smoke，后续截图回归 |
| API / 命令测试 | Tauri command 输入输出和错误类型 | Rust 单测 |
| 安全测试 | Zip Slip、shell 注入、URL scheme、敏感文件预览 | Vitest、Rust 单测、`npm audit` |
| 性能测试 | 大目录、传输、目录大小、缩略图缓存 | 手工基准 + 后续脚本 |
| 兼容性测试 | macOS 版本、AppleScript、外置卷、iCloud、网络卷 | 手工矩阵 |
| 静态测试 | TS、ESLint、Rust clippy、i18n、README、CI gate | npm scripts、cargo clippy |

### 模块策略

| 模块 | 策略 |
|---|---|
| 文件浏览 | 目录读取、隐藏文件、排序、分组用单元 / 集成测；视图切换用 E2E |
| 文件操作 | Rust 层先覆盖数据安全不变式；前端层覆盖确认弹窗和操作历史 |
| 传输 | Rust 层覆盖进度和取消清理；UI 层覆盖任务显示、取消、自动关闭 |
| 设置 | 纯函数覆盖导入清洗、迁移、脱敏；UI 层覆盖配置持久化 |
| 扩展菜单 | 前后端分别覆盖 URL / shell 插值、防注入、确认策略 |
| AI | mock HTTP，覆盖 provider 切换、超时、格式错误、文件名非法 |
| macOS 集成 | 命令参数用单测，真实系统行为用手工 smoke |
| 发布 | 每次合并跑 lint、test、build、CI gate |

## 步骤 3：详细测试用例

### P0 用例

| ID | 模块 | 场景 | 类型 | 输入 | 预期 |
|---|---|---|---|---|---|
| P0-001 | 文件操作 | 移至外置卷废纸篓失败 | 安全 / 集成 | `/Volumes/USB/a.txt` trash 失败 | 返回 `TrashUnsupported`，不永久删除 |
| P0-002 | 文件操作 | move 到同一目录 | 集成 | 源和目标目录相同 | 源不变，目标无新增，计数为 same-dir skipped |
| P0-003 | 文件操作 | copy 冲突选择 `skip` | 集成 | 目标已有同名文件 | 原目标内容不变，非冲突项继续 |
| P0-004 | 文件操作 | copy 冲突选择 `replace` 中途失败 | 集成 | 备份旧目标后复制失败 | 旧目标恢复，不留下 backup |
| P0-005 | 传输 | 大文件 copy 取消 | 集成 / E2E | 运行中取消 task | 临时 staged 文件清理，旧目标不变 |
| P0-006 | 传输 | 目录 copy 取消 | 集成 | 嵌套目录复制中取消 | staged 目录清理 |
| P0-007 | symlink | 复制目录内 symlink | 集成 | symlink 指向外部 / 父目录 | 复制 symlink 本身，不展开目标 |
| P0-008 | 解压 | Zip Slip entry | 安全 | `../evil.txt` | 拒绝，目标外无写入 |
| P0-009 | 解压 | 重复目标 entry | 安全 | `same.txt` + `./same.txt` | 拒绝，目标文件不落盘 |
| P0-010 | 解压 | 目标文件已存在 | 安全 | zip 内 `same.txt`，输出已有 `same.txt` | 拒绝，旧内容保持 |
| P0-011 | 扩展菜单 | shell 注入字符 | 安全 | `rm -rf /; echo ok` | 自动执行路径拒绝 |
| P0-012 | 扩展菜单 | URL 协议注入 | 安全 | `javascript:alert(1)` | 拒绝 shell.open |
| P0-013 | 设置 | 导入含 API Key 的备份 | 安全 | `aiApiKey` / provider key | 导入和导出均脱敏 |
| P0-014 | 预览 | `.env` / SSH key 文本预览 | 安全 | `.env`、`id_rsa` | 预览拒绝，用户可显式打开 |
| P0-015 | Undo | 目标名已存在 | 单元 | reverse rename 目标已存在 | 不执行 rename，状态 `undo_failed` |
| P0-016 | Undo | 多步回滚部分失败 | 单元 | 第二步失败 | 继续剩余步骤，状态 `undo_partial` |

### P1 用例

| ID | 模块 | 场景 | 类型 | 输入 | 预期 |
|---|---|---|---|---|---|
| P1-001 | 文件浏览 | 大目录加载取消旧请求 | 集成 | 快速切换目录 | 旧请求取消，不覆盖新目录 |
| P1-002 | 文件浏览 | 隐藏文件开关 | 单元 / E2E | `.hidden` 文件 | 开关关闭不显示，开启显示 |
| P1-003 | 文件浏览 | 目录签名轮询 | 单元 | 新增 / 修改可见文件 | fingerprint 变化并触发刷新 |
| P1-004 | 三视图 | 列表 / 网格 / 分栏切换 | UI / E2E | 同一目录 | 选择和路径状态不丢失 |
| P1-005 | 分栏 | 子分栏文件预览 | E2E | 第二级目录选中文件 | 预览绑定正确文件 |
| P1-006 | 选择 | Cmd / Shift / 框选 | 单元 / E2E | 多文件 | 顺序和范围符合 Finder 预期 |
| P1-007 | 跨窗口拖拽 | copy 到目标窗口 | E2E | A → B | B 有 overlay，目标生成副本 |
| P1-008 | 跨窗口拖拽 | move 到目标窗口 | E2E | Cmd + drop | 源消失，目标存在 |
| P1-009 | 跨窗口拖拽 | 重叠窗口 | E2E | 顶层拖到底层 | banner 显示；置顶不可靠需记录 |
| P1-010 | 设置 | 备份导入无效 JSON | UI | 非 JSON 文件 | 页面提示错误，不修改现有配置 |
| P1-011 | AI | AI 返回数量不匹配 | 单元 | 3 个输入，2 个输出 | 返回错误，不执行重命名 |
| P1-012 | Quick Look | 空格预览开关 | E2E | 开 / 关切换 | 开启调用 Quick Look，关闭不调用 |
| P1-013 | 终端 | 启动脚本 | 手工 | 设置脚本后打开终端 | 安全命令执行，危险命令拒绝 |
| P1-014 | 卷 | 弹出非 `/Volumes` 路径 | 单元 | `/` | 返回 `InvalidPath` |

### P2 用例

| ID | 模块 | 场景 | 类型 | 输入 | 预期 |
|---|---|---|---|---|---|
| P2-001 | 外观 | 浅色 / 深色 / 自动 | UI | 切换主题 | CSS 变量更新 |
| P2-002 | 外观 | 自定义壁纸 URL | 单元 / UI | http / https / asset | 合法显示，非法拒绝 |
| P2-003 | 动画 | reduced-motion | UI | 系统减少动态效果 | hover / modal 动画降级 |
| P2-004 | i18n | 中文 / 英文切换 | 静态 / UI | 语言切换 | 高风险文案已翻译 |
| P2-005 | 空状态 | 空目录 / 无搜索结果 | UI | 空目录 / 搜索无结果 | 显示明确状态 |
| P2-006 | 诊断 | 读取 panic log | 单元 / UI | 大 panic.log | 限制读取大小，显示最近内容 |
| P2-007 | 更新 | 检查更新失败 | UI | 网络失败 | 错误可见且不崩溃 |

## 步骤 4：可执行测试代码

### 本轮新增测试

| 文件 | 覆盖点 |
|---|---|
| `src/__tests__/operation-history-undo.test.ts` | 缺失 session、可撤销判定、目标冲突阻断、逆序撤销、部分失败 |
| `src-tauri/src/lib.rs` | `decompress_file` 拒绝 Zip Slip、拒绝重复目标 entry、写入前失败 |

### 推荐后续新增测试代码

| 文件 / 方向 | 建议 |
|---|---|
| `src/__tests__/ai-service.test.ts` | mock HTTP，覆盖 timeout、JSON 解析、数量不匹配、非法文件名 |
| `src/__tests__/filesystem-api.test.ts` | mock `invoke`，覆盖 command 名称和错误归一 |
| `e2e/*.spec.ts` | 引入 Playwright / Tauri driver，覆盖启动、三视图、文件操作、拖拽 |
| Rust 集成测试 | 使用临时目录覆盖完整 copy / move / compress / decompress 链路 |

## 步骤 5：代码审查与静态测试

### 安全审查

| 类别 | 观察 | 风险 |
|---|---|---|
| OWASP A01 Broken Access Control | Tauri capability 包含 `fs:default`、HTTP 通配、asset `$HOME/**` | 权限面偏宽，建议细化 scope |
| OWASP A03 Injection | 终端命令和 shell 模板已做前后端校验 | 高级命令仍需明确确认与审计日志 |
| OWASP A05 Security Misconfiguration | CSP 允许 `http:` / `https:` 图片和连接 | 需要确认 AI / 更新 / 壁纸需求后最小化 |
| OWASP A06 Vulnerable Components | `npm audit` 0 漏洞；Rust 未安装 `cargo-audit` | Rust advisory 扫描缺证据 |
| OWASP A09 Logging | panic log 和诊断信息存在 | 需避免写入 API Key / 绝对敏感路径 |
| Sensitive Data Exposure | localStorage 写入 theme 前脱敏；Tauri Store 仍保存完整 theme | AI Key 应考虑 Keychain 或单独加密存储 |
| Zip Slip | 已新增自动化测试 | 保持为 P0 回归 |

### 代码质量审查

| 位置 | 问题 | 建议 |
|---|---|---|
| `ExplorerView.tsx` | 单文件承载大量状态、拖拽、传输、预览、右键菜单逻辑 | 抽出 transfer / drag / inspector hooks 和纯 helper |
| 文件操作历史 | undo 已有前置校验，但真实文件状态可能瞬变 | 对失败原因做 UI 展示和重试入口 |
| Tauri commands | 部分命令依赖系统工具 `open`、`qlmanage`、`diskutil`、`mdfind` | 增加平台能力检测和更明确错误 |
| 设置导入 | 已清洗字段和密钥 | 增加 schema migration 文档和 fixture |

## 步骤 6：测试执行模拟

### 自动执行方式

```bash
npm test
npm run test:rust
npm run lint
npm run lint:rust
npm run lint:readme
npm run lint:i18n
npm run lint:ci-gates
npm run build
npm audit --audit-level=moderate
```

### 本轮实际执行结果

| 命令 | 结果 |
|---|---|
| `npm test` | 19 个测试文件、165 个用例通过 |
| `npm run test:rust` | 103 个 Rust 单元测试通过 |
| `npm run lint` | TypeScript + ESLint 通过 |
| `npm run lint:rust` | Rust clippy `-D warnings` 通过 |
| `npm run lint:readme` | 通过 |
| `npm run lint:i18n` | 通过 |
| `npm run lint:ci-gates` | 通过 |
| `npm run build` | Vite production build 通过 |
| `npm audit --audit-level=moderate` | found 0 vulnerabilities |
| `cargo audit --version` | 本机未安装 `cargo-audit`，未执行 Rust advisory 扫描 |

### 手工执行方式

```bash
npx tauri dev
```

启动后按 `docs/SMOKE_TEST.md` 执行窗口外壳、文件浏览、文件操作、拖拽、设置、安全边界和自动化测试清单。

### 输入模拟

| 输入 / 操作 | 预期输出 | 实际可能问题 |
|---|---|---|
| 解压含 `../evil.txt` 的 zip | `InvalidPath`，输出目录为空，目标外无 `evil.txt` | UI 可能只显示泛化错误 |
| 解压含 `same.txt` 与 `./same.txt` 的 zip | `Conflict`，不写入 `same.txt` | 错误路径可能包含 `./`，需 UI 规范化 |
| 撤销重命名但原名称已存在 | 返回 `undo_failed`，不调用 `renameFile` | 用户需要明确知道阻断原因 |
| 两步 undo 第一项失败 | 返回 `undo_partial`，继续执行剩余 reverse op | 局部回滚后的用户引导需补 |
| 右键扩展命令 `cat x | grep y` | 自动执行路径拒绝 | 高级确认路径仍需手工验证 |
| 拖拽文件到重叠目标窗口 | 目标显示 overlay，允许 drop | 已知底层窗口置顶不可靠 |

## 整体测试报告总结

当前项目已经具备较完整的基础自动化回归网：前端 Vitest、Rust 单元测试、TypeScript、ESLint、Rust clippy、README / i18n / CI gate、production build、npm audit 均已跑通。  
本轮新增了 P0 安全和数据一致性测试，重点补强了解压安全和操作历史 undo。

仍未完全自动化的是 macOS 桌面真实交互，包括多窗口拖拽、Quick Look、Finder 交互、AppleScript 终端脚本、外置卷和视觉回归。这些应作为下一轮 E2E / 手工 smoke 的重点。

## 高优先级风险清单

| 优先级 | 风险 | 建议 |
|---|---|---|
| P0 | 文件覆盖、删除、移动失败导致数据损坏 | 持续扩大 Rust 文件操作测试和 E2E 临时目录测试 |
| P0 | 解压归档安全 | 保持 Zip Slip、覆盖、重复 entry 为必跑测试 |
| P0 | Tauri 权限面偏宽 | 收窄 capabilities 和 CSP，增加配置快照测试 |
| P0 | AI API Key 存储 | 迁移到 Keychain 或独立加密存储 |
| P1 | 跨窗口拖拽不稳定 | 引入 Tauri E2E 或保留强制手工 smoke |
| P1 | 分栏预览已知缺陷 | 建立回归用例后修复 |
| P1 | Rust 依赖 advisory 缺少扫描 | 安装并纳入 `cargo audit` 或等价工具 |

## 建议改进点

1. 引入 Tauri E2E / Playwright smoke，覆盖启动、三视图、文件操作、拖拽、设置。
2. 拆分 `ExplorerView.tsx` 中的传输、拖拽、预览和右键菜单逻辑，提升可测试性。
3. 为 Tauri capability、CSP 和 updater endpoint 建立快照测试。
4. 为 AI provider 增加 HTTP mock 测试，覆盖超时、格式错误、数量不匹配和无效 provider。
5. 将 `cargo audit` 或等价 Rust 依赖扫描加入本地和 CI gate。
6. 将 `docs/SMOKE_TEST.md` 的手工项转成可记录结果的 checklist 或 UAT 表。
