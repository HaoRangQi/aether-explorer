# 09 测试与发版安全基础设施 (Test-Release-Safety-Baseline)

**状态**: ✅  **首次落地**: [2026-05-17]  **最近更新**: [2026-05-17]  **域**: 自动化测试 + P0 安全红线修复 + CI gate

## 09.1 一句话总结

从"零自动化测试 + CSP null + 命令注入 + 路径裸用"一次性升级到「**Rust 35 + TS 41 = 76 个测试 + 严格 CSP + 白名单 / 校验 / canonicalize / 协议白名单 + CI test gate + DevTools 控制台自检**」的可发版基线。**写测试和修安全 P0 是一件事**——TDD 风格先写测试定型 API，再改代码。

## 09.2 决策与权衡

| 维度 | 选项 A | 选项 B | 决策 |
|---|---|---|---|
| 测试框架 | jest | vitest | **vitest** — Vite 项目原生，配置零成本，跟 vite.config.ts 共享 |
| TS 测试范围 | 全套 (组件 + e2e) | 纯函数 + jsdom | **纯函数** — 组件渲染 / 拖拽 e2e 维护成本高，ROI 低 |
| Rust 测试 | 独立 `tests/` 目录 | `#[cfg(test)] mod tests` 内联 | **内联** — 与代码同文件，重构跟着走 |
| 命令注入修复 | 字符串多次转义 | 白名单 + 元字符拒绝 + apple_quote 单点 | **白名单 + 拒绝** — 字符串转义太脆弱，多次踩坑 |
| CSP 严格度 | 完全开放 (csp:null) | `'unsafe-inline'` 双开 | **script-src 不放 unsafe-inline**，仅 style-src 放（Tailwind 内联 style） |
| Updater endpoint | 仅 `/latest/download/` | 双 endpoint 兜底（stable manifest + latest） | **双兜底** — 防 GitHub `latest` 别名误推 prerelease |
| CI test gate | 仅 release 跑 | 任何 push/PR 跑 | **任何 push** — 早暴露回归 |

**核心不变量**：
- `npm test` + `cargo test --lib` 任一失败 → release 阻断（`release.yml` `needs: test-gate` + `scripts/release.sh` 入口闸）
- 用户输入的命令片段必须经 `validate_shell_fragment` 才能进 AppleScript / shell
- 终端 app 名必须经 `is_allowed_terminal` 白名单（防 AppleScript 注入）
- 文件路径经 `safe_canonicalize` 后才能用作复制/移动目标（防 `..` 跳逃）
- `shell.open` URL 必须经 `safeShellOpen` 协议白名单

## 09.3 实现拓扑

```
┌─────────────────────────────────────────────────────────────────┐
│ 测试层 (Layer 1+2 — 76 测试，< 3 秒)                              │
├─────────────────────────────────────────────────────────────────┤
│ Rust: src-tauri/src/lib.rs #[cfg(test)] mod tests                │
│   ├─ format_size / format_kib / parse_df_line / parse_capacity   │
│   ├─ detect_mime / unique_destination / encode_query_component   │
│   ├─ shell_quote / apple_quote                                   │
│   ├─ validate_shell_fragment / is_allowed_terminal               │
│   └─ is_sensitive_for_preview                                    │
│                                                                  │
│ TS:   src/__tests__/                                             │
│   ├─ url-guard.test.ts   — isSafeShellOpenUrl / shellEscape /     │
│   │                        validateShellFragment /                │
│   │                        isValidWallpaperUrl                    │
│   ├─ path-helpers.test.ts — getPathLeaf / getInitialTabs /        │
│   │                         commonParent                          │
│   └─ settings.test.ts    — normalizeThemeSettings /                │
│                            normalizeContextMenuExtensions /        │
│                            loadThemeFromLocalStorage              │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│ Smoke 层 (Layer 3 — 人工 ≤ 5 分钟 + console 自检)                  │
├─────────────────────────────────────────────────────────────────┤
│ docs/SMOKE_TEST.md            — 30 条手工 checklist                │
│ src/lib/smoke.ts              — window.__aether.smoke() (仅 dev)   │
│   ├─ 15 项隐式断言（store 可读 / 命令注册 / DOM mount / ...）        │
│   └─ esbuild drop console 后生产构建消除                            │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│ Gate 层 (CI + 本地 release.sh)                                    │
├─────────────────────────────────────────────────────────────────┤
│ .github/workflows/test.yml   — push/PR → tsc + vitest + cargo +  │
│                                  vite build                       │
│ .github/workflows/release.yml — release job needs: test-gate     │
│ scripts/release.sh           — 本地发版前 npm test + cargo test    │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│ 安全层 (RELEASE_AUDIT P0-1..5)                                    │
├─────────────────────────────────────────────────────────────────┤
│ open_terminal_at:                                                │
│   user_cmd → validate_shell_fragment → shell_quote               │
│   app_name → is_allowed_terminal → apple_quote                   │
│ shell.open:                                                       │
│   url → safeShellOpen (isSafeShellOpenUrl 白名单)                  │
│ copy_files / move_files:                                          │
│   dst_dir → safe_canonicalize                                     │
│ read_text_preview:                                                │
│   path → is_sensitive_for_preview (.env / id_rsa 拦截)             │
│ tauri.conf.json:                                                  │
│   csp: 严格 default-src + script-src 无 'unsafe-inline'            │
└─────────────────────────────────────────────────────────────────┘
```

## 09.4 关键文件 & 行号

| 文件 | 行 | 角色 |
|---|---|---|
| `package.json` | 11-15 | `test` / `test:watch` / `test:rust` / `test:all` 脚本 |
| `vite.config.ts` | 29-32 | `test` 配置（jsdom + `src/**/__tests__/*.test.ts`） |
| `vite.config.ts` | 26-28 | `esbuild.drop: ['console', 'debugger']` (production) |
| `src/__tests__/url-guard.test.ts` | — | 26 个 URL/shell 安全测试 |
| `src/__tests__/path-helpers.test.ts` | — | 15 个路径辅助测试 |
| `src/__tests__/settings.test.ts` | — | 14 个 settings 规范化测试 |
| `src/lib/url-guard.ts` | 21-30 | `isSafeShellOpenUrl` — `http`/`https`/`mailto` 白名单 |
| `src/lib/url-guard.ts` | 38-50 | `isValidWallpaperUrl` — 拒 CSS url() 注入 + scheme 白名单 |
| `src/lib/url-guard.ts` | 60-62 | `shellEscape` — POSIX 单引号转义 |
| `src/lib/url-guard.ts` | 76-86 | `validateShellFragment` — 拒元字符 10 种 |
| `src/lib/url-guard.ts` | 93-98 | `safeShellOpen` — Tauri shell.open 安全包装 |
| `src/lib/smoke.ts` | 17-100 | 15 项 DevTools 自检 |
| `src/lib/smoke.ts` | 102-130 | `window.__aether.smoke()` 注入（仅 dev） |
| `src-tauri/src/lib.rs` | 1474-1488 | `validate_shell_fragment` Rust 端 + 元字符黑名单 |
| `src-tauri/src/lib.rs` | 1496-1498 | `is_allowed_terminal` 白名单 |
| `src-tauri/src/lib.rs` | 1511, 1525-1527 | `open_terminal_at` 串联白名单 + 校验 + apple_quote |
| `src-tauri/src/lib.rs` | 433-447 | `is_sensitive_for_preview` 黑名单（.env / id_rsa / ...） |
| `src-tauri/src/lib.rs` | 625-628 | `safe_canonicalize` 防 `..` 跳逃 |
| `src-tauri/src/lib.rs` | 815, 919 | `copy_files` / `move_files` 入口 canonicalize |
| `src-tauri/src/lib.rs` | 末尾 #[cfg(test)] | 35 个 Rust 单元测试 |
| `src-tauri/tauri.conf.json` | 30 | CSP 严格策略 |
| `src-tauri/tauri.conf.json` | 60-64 | Updater 双 endpoint 兜底 |
| `.github/workflows/test.yml` | — | push/PR 触发，tsc + vitest + cargo + vite build |
| `.github/workflows/release.yml` | 33-49 | `test-gate` job + release `needs: test-gate` |
| `.github/workflows/release.yml` | 154-168 | CHANGELOG.md 抽取 release notes |
| `scripts/release.sh` | 38-42 | 本地发版前 test 闸门 |
| `docs/SMOKE_TEST.md` | — | 5 分钟人工 + console 混合 checklist |
| `docs/TEST_PLAN.md` | — | 三层测试与回归保障计划 |
| `docs/RELEASE_AUDIT.md` | — | 34 项 P0~P3 风险审计 + 修复方案 |

## 09.5 数据契约

`window.__aether.smoke()` 返回（仅 dev）：
```ts
{
  ok: boolean;                                   // 所有断言通过
  total: number;                                 // 总断言数 (15)
  failed: Array<{ name: string; err: string }>;
  table: Array<{ check: string; ok: boolean; err?: string }>;
}
```

`AppError`（Rust → 前端 Result）—— 仍是 `String`，未升级为结构化枚举（IMPROVEMENT_PROPOSALS 2.1 长线工作）。

CSP 关键 directives：
```
default-src 'self' tauri: asset: http://localhost:* http://127.0.0.1:*;
img-src     'self' tauri: asset: http: https: data: blob:;
style-src   'self' 'unsafe-inline';   ← Tailwind 内联 style 需要
script-src  'self' tauri:;            ← 不放 'unsafe-inline' — Vite 是外链 bundle
connect-src 'self' tauri: ipc: http://ipc.localhost http: https: ws: wss:;
frame-src   'none';
object-src  'none';
```

## 09.7 失败模式与排查

| 现象 | 根因 | 修复 |
|---|---|---|
| `vitest: command not found` 但 main 工作区代码 OK | worktree 软链 node_modules 没装 vitest（feat 分支独立装） | 分身 / main 工作区跑 `npm ci`（commit `1edcadc` 合并前在 staging 复现） |
| 合并前 review 漏 `'unsafe-inline'` script-src | CSP 配置追求"最大兼容性"误开 inline-script | agent review 抓到（commit `9a62a05`），仅 style 保留 inline |
| `blurIntensity` 默认值变化让新用户首屏视觉断裂 | 性能优化 L6-C 想默认关 blur，但破坏品牌玻璃感 | 回滚到 32，性能差用户手动调降（commit `9a62a05`） |
| 用户改终端 app 名为含 AppleScript 注入字符 | `app_name` 原本进 osascript 字符串拼接 | `is_allowed_terminal` 白名单（commit `5388fe5`） |
| 扩展菜单命令含 `; rm -rf` | 用户配置的 `custom_command` 原本直接进 osascript | `validate_shell_fragment` 拒元字符（commit `5388fe5`） |
| 复制到含 `../../../etc` 的路径 | `dst_dir` 字符串直接 join | `safe_canonicalize` 拒（commit `5388fe5`） |
| 右键 `.env` 预览面板暴露密钥 | `read_text_preview` 读 8KB 不审名 | `is_sensitive_for_preview` 黑名单（commit `5388fe5`） |
| 扩展菜单 URL 配 `javascript:` 钓鱼 | `shell.open` 接受任意 URI scheme | `safeShellOpen` 协议白名单（commit `5388fe5`） |

## 09.8 SOP — 加新单元测试

**Rust 纯函数**：

1. 在 `src-tauri/src/lib.rs` 末尾的 `#[cfg(test)] mod tests` 内追加 `#[test] fn name() { ... }`
2. 跑 `npm run test:rust` 验证
3. CI `test.yml` 自动捕获

**TS 纯函数**：

1. 函数从组件抽到 `src/lib/<域名>.ts`（如 `src/lib/url-guard.ts`）
2. 在 `src/__tests__/<域名>.test.ts` 加 `describe / it`
3. 跑 `npm test`
4. **不要测**：依赖 React 渲染 / Tauri 命令 / 浏览器 DOM 行为 — 留给 Smoke

**绝对不要**：在测试中调真实文件系统（除 `std::env::temp_dir` 隔离场景，见 `unique_destination_appends_copy_suffix` 测试）。

## 09.9 经验教训

1. **测试和安全是同一件事**：写 `validate_shell_fragment` 的测试时，自然定型了"哪些字符不接受"的契约 — 后续修复 Rust 实现时 grep 测试用例就知道边界。TDD 不只是质量手段，是设计语言。

2. **CI gate 必须早建**：在 76 个测试存在之前，"我不敢改"是真实的心理负担。建好 gate 后改一处代码 5 秒跑完全套，**心理成本归零**。投入 1.5 天换永久解放。

3. **合并前要做独立 review + 分身验证**：commit `1edcadc` 之前 agent 抓到 2 个隐患（blur 视觉断裂 + CSP 'unsafe-inline'）。分身（staging 分支独立 npm ci + 全套验证）抓到 worktree 软链 node_modules 缺 vitest 的部署陷阱。**人脑 review 易漏，agent + 分身真验证是双保险**。

4. **回滚机制要顺手**：commit `8d99793` 是一次 revert（子菜单 fixed 定位太远）。`git revert --no-edit HEAD` + 跑测试 + push = 3 分钟。不要纠结"是不是我哪里没改对"，错了就 revert 重来。

5. **CSP `'unsafe-inline'` 不能滥放**：style 必须放（Tailwind / framer-motion 内联），但 script 一定不放。Vite 生产构建是外链 bundle，无 inline script 需求 — 放了等于自废 XSS 防护。

6. **测试不替代 Smoke checklist**：自动化测试覆盖纯逻辑，但"拖文件到另一个窗口看 banner"这类强交互依赖人手。`docs/SMOKE_TEST.md` 30 条 5 分钟跑完是必要补充。

## 09.10 未来扩展

- **React 组件测试**（@testing-library/react）— 等 `ExplorerView.tsx` 拆分后再做（当前 4000 行组件不可测）。可放弃直到 v0.5。
- **E2E**（Playwright / Tauri WebDriver）— 跨窗口拖拽 E2E 极脆弱，留长线。
- **Sentry 崩溃报告** — `IMPROVEMENT_PROPOSALS` 2.3 已规划，配合 `Rust panic hook` 一起做。
- **签名 + notarization**（P0-6/7） — 需 Apple Developer Program $99/年，等账号 ready 后做。
