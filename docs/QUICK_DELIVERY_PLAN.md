# Aether Explorer 尽快交付版必做清单

> 日期：2026-05-25
> 分支：`codex-fix-review-findings`
> 目标：尽快交付一版公益 / 社区预览版，不扩大商业化、订阅、notarization、App Store 范围；macOS Full Disk Access 发版候选验收必须使用稳定签名身份，不能用未签名 / ad-hoc 构建替代。

## 一、当前结论

当前代码已经完成大部分发版红线收口，可以进入“只做必做”的交付模式。

整体完成度估算：约 85%。

剩余 15% 不再追求继续完善所有 review findings，只保留交付前必须验证或修正的事项：

- 自动化门禁必须全部通过。
- Smoke Test 文档和实际命令输出必须一致。
- README / Release Audit / TODO 不能出现与当前交付口径冲突的承诺。
- 不再主动大改 `ExplorerView` 拖拽、外部导入、键盘快捷键、刷新链路。
- 不再新增商业分发、公证、订阅相关目标；稳定签名身份只作为 Full Disk Access release evidence 的必要条件，不扩展为 App Store / 商业分发路线。

## 二、已完成且可作为交付基础的内容

### 1. Release / CI 门禁

- release workflow 已有 `test-gate`，覆盖 lint、README sync、i18n、CI gate、Vitest、Rust test、clippy 和 production build。
- 本地 `scripts/release.sh` 已包含 release 前清理、版本一致性校验、构建、SHA256SUMS 生成 / 验收。
- `scripts/check-ci-gates.mjs` 已防回退：
  - 8 个 test gates。
  - 8 个 release gates。
  - 8 个 local release gates。
  - 14 个 npm script 实现。
  - 3 个 dependency resolution checks。
  - 19 个 CI setup checks。
  - 3 个 timeout checks。
  - 6 个工作分支触发。
  - 1 个 PR 目标触发。
  - 6 个 release trigger checks。
  - 13 个 release security checks。
  - 11 个版本一致性检查。
  - release integrity checks。

### 2. 前端质量门禁

- `npm run lint` 已串联 TypeScript 和 ESLint。
- ESLint 已限制 browser `alert` / `prompt` / `confirm`。
- `react-hooks/exhaustive-deps` 和 `react-hooks/rules-of-hooks` 已升级为 `error`。
- `ExplorerView` 历史 hooks warning 已清零，不再为了“清 warning”继续触碰高风险交互链路。

### 3. i18n 和设置风险收口

- `lint:i18n` 已覆盖当前高风险用户可见文案范围。
- `SettingsView` 高风险文案、设置导入 / 重置 / 扩展删除确认已完成收口。
- browser confirm 已迁移到 Tauri dialog。

### 4. 测试与构建基线

- Vitest 当前基线：14 个测试文件、129 个用例。
- Rust 当前基线：81 个单元测试。
- Vite manualChunks 已拆包，主入口 chunk 当前约 258 KB，低于 500 KB warning 阈值。

### 5. 文档和社区基础

- README / README_EN 已有同步检查。
- `SECURITY.md`、`CONTRIBUTING.md`、GitHub issue templates 已补齐。
- `docs/PRIVACY.md` 已说明当前出网点。
- Release Audit、Smoke Test、Test Plan 已基本对齐当前公益 / 社区预览版口径。

## 三、交付前必做

### P0：必须完成，否则不交付

1. 跑完整自动化门禁：

```bash
npm run lint
npm run lint:readme
npm run lint:i18n
npm run lint:ci-gates
npm test
npm run test:rust
npm run lint:rust
npm run build
git diff --check
```

验收标准：全部通过。

2. 做一次人工 Smoke Test：

- 启动应用。
- 打开普通目录、空目录、无权限目录。
- 新建文件夹 / 新建文件。
- 重命名、复制、移动、移至废纸篓。
- Finder 外部文件导入。
- 多窗口 / 标签页基本切换。
- 跨窗口拖拽按当前 fallback 语义验证。
- `Enter` 打开、空格 Quick Look、`Escape` 关闭面板、`Cmd+R` 刷新。
- 设置页导入 / 导出 / 重置确认弹窗。
- `window.__aether.smoke()` 在 dev 模式下通过。

验收标准：无阻塞崩溃，无数据破坏，无与 README 承诺相反的行为。

3. 做一次文档一致性扫尾：

- `docs/SMOKE_TEST.md` 的命令说明与当前 `lint:i18n` / `lint:ci-gates` 输出一致。
- `docs/RELEASE_AUDIT.md` 不再把已完成项写成待修。
- `TODO.md` 不把暂缓项写成当前交付必做。
- README 明确未签名 / ad-hoc 构建只适合开发或高级用户风险测试，不包装成商业级签名应用，也不能作为稳定 Full Disk Access release evidence。

验收标准：无明显过期状态、无 notarization / App Store / 商业化承诺；签名相关表述必须与 FDA release evidence gate（`npm run validate:macos-permission-release`）一致。

4. 最终确认 Git 状态：

```bash
git status --short --branch
git diff --cached --stat
```

验收标准：

- 当前分支仍是 `codex-fix-review-findings`。
- 暂存区为空，除非用户明确要求 stage / commit。
- 不切换、不污染 `main`。

## 四、交付前不再做

以下事项不再进入“尽快交付版”范围，避免拖延交付或引入高风险回归：

- 不拆 `ExplorerView` 大组件。
- 不重写拖拽、外部导入、键盘快捷键、刷新链路。
- 不补完整组件级自动化测试。
- 不做 Tauri command 集成测试体系。
- 不引入覆盖率阈值。
- 不做 notarization、App Store 或商业分发路线扩展；稳定签名身份仍是 Full Disk Access 发版候选验收前置条件。
- 不做商业化、订阅、云同步、团队协作。
- 不做完整插件市场。

这些内容保留为 0.3.x 后续治理项。

## 五、剩余工作量估算

按“尽快交付一版”口径估算：

| 类别 | 剩余量 | 说明 |
|------|--------|------|
| 自动化门禁验证 | 1 轮 | 约 10-20 分钟，取决于 Rust / build 耗时 |
| 人工 Smoke Test | 1 轮 | 约 10-20 分钟 |
| 文档一致性扫尾 | 少量 | 主要是 `SMOKE_TEST.md` 的 gate 计数和交付口径 |
| 代码修复 | 原则上不新增 | 只有 P0 验证失败才修 |
| Release 包装 | 暂不执行 | 除非用户明确要求开始打包 / 发布 |

交付前剩余进度估算：约 15%。

如果 P0 验证全部通过，当前分支可以作为“公益 / 社区预览版候选”继续进入打包或 PR 准备。

## 六、风险说明

- 未签名 / ad-hoc 构建仍只能作为社区预览或开发测试路径，不能包装成正式签名应用，也不能作为稳定 Full Disk Access release evidence。
- `ExplorerView` 仍是大型组件，后续维护风险存在，但不作为本次交付阻塞项。
- 拖拽、跨窗口、Finder 外部导入属于系统集成路径，自动化覆盖有限，交付前必须人工 smoke。
- 当前 worktree 有大量未提交 WIP，任何 stage / commit 都必须只选明确文件，不能 `git add .`。
