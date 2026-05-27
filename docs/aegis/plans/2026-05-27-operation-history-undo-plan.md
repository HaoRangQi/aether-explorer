# Goal

把现有分裂的 AI 操作历史与普通文件操作结果，收敛为一个统一的 `操作历史` 体系；支持查看、筛选、展开明细，并对安全可逆的 session 执行自动撤销。

# Architecture

本计划采用 **前端统一历史 owner + Rust 传输结果桥接** 的最小稳定路径：

1. 前端新增统一 `operation-history` store，负责：
   - session / effect 类型
   - 持久化、索引、搜索、分页、保留期裁剪
   - 撤销 preflight 与逆序执行
   - 操作历史面板 UI
   - 把 undo result 写回原 session，而不是再生新的顶层 undo session

2. Rust 不承担完整历史持久化，也不承担完整撤销执行器，只新增：
   - 后台 `copy / move` 任务完成后的 effect outcome 明细桥接
   - 供前端消费的一次性 outcome 读取命令

3. `TransferModal` 继续只负责短期进度展示；`OperationHistoryPanel` 负责长期历史与撤销。

4. `OperationHistoryPanel` 的产品边界固定为：
   - retention 窗口内的 session **全量可看**
   - 只有安全可逆 session 出现 `撤销`
   - 不可自动撤销项明确展示原因
   - Phase 1 不做 `redo / 再执行 / 编辑历史`

5. 记录与撤销阈值固定为：
   - 默认保留 `7` 天
   - 默认最多保留 `500` 条 session
   - 硬上限 `1000` 条 session，超出按时间裁剪最旧项
   - 单个 session 超过 `2000` 个 effect：仍记录，但 `canUndo = false`

6. Phase 1 仅支持安全可逆操作：
   - `rename`
   - `move`
   - `copy`
   - `mkdir`
   - `create file`
   - `compress`
   - `duplicate`（创建副本）

7. Phase 1 仅记录、不自动撤销：
   - `trash`
   - `decompress`
   - 覆盖替换
   - 超大批量 session

# Tech Stack

- Frontend: React 19, TypeScript, Vitest, `@tauri-apps/plugin-store`
- Backend: Rust, Tauri 2
- Existing owners to reuse carefully:
  - `src/lib/ai-ops-log.ts`
  - `src/components/AIOpsHistory.tsx`
  - `src/components/TransferModal.tsx`
  - `src/components/ExplorerView.tsx`
  - `src-tauri/src/lib.rs`

# Baseline/Authority Refs

- Approved design spec:
  - `docs/aegis/specs/2026-05-27-operation-history-undo-design.md`
- Baseline snapshot:
  - `docs/aegis/baseline/2026-05-27-initial-baseline.md`
- Current AI history persistence:
  - `src/lib/ai-ops-log.ts`
- Current AI rollback UI:
  - `src/components/AIOpsHistory.tsx`
- Current transfer task snapshots:
  - `src/components/TransferModal.tsx`
  - `src-tauri/src/lib.rs`

# Compatibility Boundary

- 本次不做旧版本历史数据迁移。
- 现有 `ai-ops.json` 视为退役数据，不做跨版本兼容读取。
- 设置层先**保留**内部字段 `aiOpsHistoryRetentionDays` 作为短期 carrier，避免额外迁移工作；UI 文案改成通用“操作历史保留时长”。
- 不接系统菜单 `Undo`，只在新面板里做显式撤销。

# Verification

最小必跑命令：

```bash
npx vitest run src/__tests__/operation-history.test.ts
npx vitest run src/__tests__/settings.test.ts
cargo test --lib operation_history
npm run lint:ts
npm test
npm run test:rust
```

手动验证：

1. 触发 `rename / create file / create folder / compress / duplicate / move / copy`
2. 打开统一 `操作历史`
3. 检查列表、筛选、展开明细
4. 对可逆 session 执行撤销
5. 检查全部成功 / 部分成功 / 不可撤销说明

## Plan Basis

### Facts

- 当前 AI 历史已经有 session 索引、分页、搜索、保留期清理。
- 当前 AI 回滚是前端逆序执行 `reverseOp`。
- 当前后台 `copy / move` 任务只有计数摘要，没有 effect 明细。
- `ExplorerView.tsx` 和 `src-tauri/src/lib.rs` 都已经过大，不适合继续无边界堆逻辑。

### Assumptions

- 用户已确认：AI 历史并入统一 `操作历史` 面板。
- 用户未要求当前 turn 直接实现，而是先进入 implementation plan。
- 背景任务 outcome 通过 Rust 一次性读取接口桥接到前端即可，不需要把完整历史持久化搬到 Rust。

### Unknowns

- `executeCopyFiles` 的所有成功 / 部分成功分支是否已经足够集中，能否一次接入统一日志。
- `duplicateAsAlias` 的结果路径是否前端需要额外返回以便写入 reverse effect。

## Files

### Create

- `src/lib/operation-history.ts`
- `src/lib/operation-history-undo.ts`
- `src/components/OperationHistoryPanel.tsx`
- `src/__tests__/operation-history.test.ts`
- `docs/aegis/plans/2026-05-27-operation-history-undo-plan.md`

### Modify

- `src/types.ts`
- `src/lib/settings.ts`
- `src/components/SettingsView.tsx`
- `src/i18n/locales/zh.ts`
- `src/i18n/locales/en.ts`
- `src/components/ExplorerView.tsx`
- `src/components/AIRenamePanel.tsx`
- `src/components/TransferModal.tsx`
- `src/api/filesystem.ts`
- `src-tauri/src/lib.rs`
- `src/__tests__/settings.test.ts`

### Retire

- `src/lib/ai-ops-log.ts`
- `src/components/AIOpsHistory.tsx`

## Plan Pressure Test

- Owner / contract / retirement:
  - Proceed
  - Canonical owner 定为前端 `operation-history` store
  - Rust 只保留 transfer outcome bridge
  - AI-only owner 明确退役
- Verification scope:
  - Proceed
  - 前端 store / UI / settings + Rust transfer outcome 命令均有可测路径
- Task executability:
  - Proceed
  - 可拆成前端 foundation、面板切换、前台操作 logging、后台任务桥接、撤销执行五段
- Pressure result:
  - proceed

## Plan-Time Complexity Check

- Target files:
  - `src/components/ExplorerView.tsx`
  - `src-tauri/src/lib.rs`
  - `src/lib/settings.ts`
- Existing size / shape signals:
  - `ExplorerView.tsx` 6442 行
  - `src-tauri/src/lib.rs` 5935 行
  - 两者都已承担过多职责
- Owner fit:
  - 新历史模型不应继续塞进 `ExplorerView`
  - 后台 transfer outcome 仍可临时落在 `lib.rs`，但必须压缩为桥接命令，不扩成完整历史系统
- Add-in-place risk:
  - 高
- Better file boundary:
  - 前端新 owner：`operation-history.ts` / `operation-history-undo.ts` / `OperationHistoryPanel.tsx`
- Recommendation:
  - add owner file

## Risks

- 风险 1：用户误以为“撤销 = 必然恢复原样”
  - 缓解：统一用“自动撤销”，明确部分撤销与失败说明
- 风险 2：后台任务没有逐文件 outcome，导致无法准确建历史
  - 缓解：新增一次性 `take_transfer_task_outcome` 桥接命令
- 风险 3：在 `ExplorerView` 里四处散写日志，未来不可维护
  - 缓解：把前台记录收口到统一 helper
- 风险 4：把设置字段一起重命名会引入迁移噪音
  - 缓解：先保留 `aiOpsHistoryRetentionDays` 作为 carrier，文案改通用

## Retirement

- 退役对象：
  - `src/lib/ai-ops-log.ts`
  - `src/components/AIOpsHistory.tsx`
- 保留边界：
  - `aiOpsHistoryRetentionDays` 仅短期保留为设置 carrier
- Future trigger：
  - 当统一操作历史上线并稳定后，再做设置字段正式改名与存储迁移

---

## Task 1 — 前端统一历史 foundation

**Files**

- Create: `src/lib/operation-history.ts`
- Create: `src/lib/operation-history-undo.ts`
- Create: `src/__tests__/operation-history.test.ts`
- Modify: `src/types.ts`

**Why**

先建立统一 session / effect / retention / page 模型，后续 UI、AI、前台手工操作、后台任务桥接都能共用，避免重复造型。

**Impact / Compatibility**

- 引入新 canonical owner
- 不读取旧 `ai-ops.json`
- 暂时不碰 UI
- retention 约束直接落成常量：
  - 默认 `7` 天
  - 默认 `500` 条 session
  - 硬上限 `1000` 条
  - `> 2000 effect` 自动标记不可撤销

**Verification**

```bash
npx vitest run src/__tests__/operation-history.test.ts
npm run lint:ts
```

**Repair Track**

- repaired object: 历史模型 owner 分裂（AI-only）
- action: 建立统一 `OperationSession / OperationEffect / UndoEffect`
- impact: 所有来源共用一套 session 模型
- verification: `src/__tests__/operation-history.test.ts`

**Retirement Track**

- retired object: `AIOpSession` 作为唯一历史模型
- action: 保留 `AIOpSession` 直到 Task 2 完成 UI 切换
- retained boundary: 仅短期兼容当前 AI 面板调用点
- future trigger: `OperationHistoryPanel` 接管后删除

### Steps

- [ ] **Write test**  
  在 `src/__tests__/operation-history.test.ts` 写以下行为测试：
  1. `saveOperationSession` 按时间倒序写 index
  2. `loadOperationSessionsPage` 支持 `source` 筛选
  3. 超过 `7` 天 retention 的 session 被裁剪
  4. 超过默认 `500` 条 session 时按策略裁剪，且绝不超过硬上限 `1000`
  5. `buildUndoableSessionSummary` 对 `trash` / `> 2000 effect` session 返回不可撤销原因

- [ ] **Verify RED**  
  运行：
  ```bash
  npx vitest run src/__tests__/operation-history.test.ts
  ```
  预期：测试失败，报缺少 `operation-history` 实现或导出。

- [ ] **Minimal code**  
  实现以下最小 API：
  - `saveOperationSession(session, options?)`
  - `loadOperationSessionsPage(options?)`
  - `deleteOperationSession(id)`
  - `pruneOperationSessions(retentionDays?)`
  - `buildUndoability(session)`
  类型最少补到：
  - `OperationSession`
  - `OperationEffect`
  - `UndoEffect`
  - `OperationSource`
  - `OperationSessionStatus`
  - `OperationEffectStatus`

- [ ] **Verify GREEN**  
  运行：
  ```bash
  npx vitest run src/__tests__/operation-history.test.ts
  npm run lint:ts
  ```
  预期：通过。

- [ ] **Commit**  
  ```bash
  git add src/lib/operation-history.ts src/lib/operation-history-undo.ts src/types.ts src/__tests__/operation-history.test.ts
  git commit -m "feat: 建立统一操作历史基础模型"
  ```

---

## Task 2 — 统一历史面板替换 AI-only 面板

**Files**

- Create: `src/components/OperationHistoryPanel.tsx`
- Modify: `src/components/ExplorerView.tsx`
- Modify: `src/i18n/locales/zh.ts`
- Modify: `src/i18n/locales/en.ts`
- Retire: `src/components/AIOpsHistory.tsx`

**Why**

先把 UI 入口统一，用户才能真正看到“操作历史”而不是仍停留在“AI 操作历史”。

**Impact / Compatibility**

- `ExplorerView` 的历史入口改成统一 `操作历史`
- AI-only 面板退役
- 先保留 `showAIHistory` state 名称不重命名也可以，但推荐直接改成 `showOperationHistory`
- UI 是“全量审计列表 + 有边界的行级撤销”，不是多动作控制台

**Verification**

```bash
npx vitest run src/__tests__/operation-history.test.ts
npm run lint:ts
```

**Repair Track**

- repaired object: 用户入口分裂
- action: 用 `OperationHistoryPanel` 替换 `AIOpsHistory`
- impact: 一个面板统一展示 `manual / ai`
- verification: 面板能打开，默认 `全部` 可见

**Retirement Track**

- retired object: `src/components/AIOpsHistory.tsx`
- action: 删除文件与引用
- retained boundary: 无
- future trigger: 本任务完成即删除

### Steps

- [ ] **Write test**  
  在 `src/__tests__/operation-history.test.ts` 增加纯函数测试：
  - `group / filter / status badge label` 的来源过滤逻辑
  - 默认 tab 为 `all`
  不新增脆弱 DOM 测试。

- [ ] **Verify RED**  
  ```bash
  npx vitest run src/__tests__/operation-history.test.ts
  ```
  预期：新增过滤逻辑测试失败。

- [ ] **Minimal code**  
  1. 新建 `OperationHistoryPanel.tsx`
  2. 支持过滤：
     - `all`
     - `manual`（UI 文案：`文件操作`）
     - `ai`（UI 文案：`AI 操作`）
  3. 列表字段：
     - 时间
     - 来源
     - 摘要
     - 项目数
     - 状态
     - `撤销 / 不可自动撤销`
  4. 明确约束：
     - 所有 session 都出现在列表里
     - 不可撤销项展示原因，不隐藏
     - Phase 1 不提供 `redo / 再执行 / 删除历史`
  5. 在 `ExplorerView.tsx`：
     - 把 `showAIHistory` 改为 `showOperationHistory`
     - 菜单文案改为 `操作历史`
     - 用 `OperationHistoryPanel` 替换 `AIOpsHistory`
  6. 删除 `src/components/AIOpsHistory.tsx`

- [ ] **Verify GREEN**  
  ```bash
  npm run lint:ts
  npm test
  ```
  预期：通过。

- [ ] **Commit**  
  ```bash
  git add src/components/OperationHistoryPanel.tsx src/components/ExplorerView.tsx src/i18n/locales/zh.ts src/i18n/locales/en.ts src/__tests__/operation-history.test.ts
  git rm src/components/AIOpsHistory.tsx
  git commit -m "feat: 接入统一操作历史面板"
  ```

---

## Task 3 — AI 与前台直接操作写入统一历史

**Files**

- Modify: `src/components/AIRenamePanel.tsx`
- Modify: `src/components/ExplorerView.tsx`
- Modify: `src/lib/operation-history.ts`
- Retire: `src/lib/ai-ops-log.ts`

**Why**

把当前能同步拿到结果的前台动作，先全部写入统一历史，建立第一批真实数据。

**Impact / Compatibility**

- AI 操作不再写 `ai-ops.json`
- `rename / create file / create folder / compress / duplicate / trash` 成为统一历史数据源
- `trash` 只记录，不自动撤销

**Verification**

```bash
npx vitest run src/__tests__/operation-history.test.ts
npm run lint:ts
```

**Repair Track**

- repaired object: AI 与手动操作使用不同落盘路径
- action: 前台同步操作全部走统一 `saveOperationSession`
- impact: 用户第一次能在同一列表里看到 AI 与手动操作
- verification: 触发任一手动操作后历史可见

**Retirement Track**

- retired object: `src/lib/ai-ops-log.ts`
- action: 删除文件与所有引用
- retained boundary: 无
- future trigger: 本任务完成即删除

### Steps

- [ ] **Write test**  
  在 `src/__tests__/operation-history.test.ts` 增加：
  - `buildSessionFromForegroundSuccess` 为 `rename / mkdir / create-file / compress / duplicate / trash` 生成正确 effect
  - `trash` session `canUndo = false`

- [ ] **Verify RED**  
  ```bash
  npx vitest run src/__tests__/operation-history.test.ts
  ```
  预期：会因缺少 foreground session builder 而失败。

- [ ] **Minimal code**  
  1. 在 `operation-history.ts` 新增 builder：
     - `buildRenameSession`
     - `buildCreateFileSession`
     - `buildCreateFolderSession`
     - `buildCompressSession`
     - `buildDuplicateSession`
     - `buildTrashSession`
  2. `AIRenamePanel.tsx`：
     - 把 `saveOpSession` / `buildReverseOp` 切到统一 store/helper
     - source 记为 `ai`
  3. `ExplorerView.tsx`：
     - 在 `handleRenameSubmit`
     - `handleDeleteFile`
     - `handleNewFile`
     - `handleNewFolder`
     - `handleCompress`
     - `handleAlias`
     成功分支统一调用 `saveOperationSession`
  4. 删除 `src/lib/ai-ops-log.ts`

- [ ] **Verify GREEN**  
  ```bash
  npm run lint:ts
  npm test
  ```
  预期：通过。

- [ ] **Commit**  
  ```bash
  git add src/components/AIRenamePanel.tsx src/components/ExplorerView.tsx src/lib/operation-history.ts src/__tests__/operation-history.test.ts
  git rm src/lib/ai-ops-log.ts
  git commit -m "feat: 前台操作接入统一历史"
  ```

---

## Task 4 — 后台 copy / move 任务产出一次性 outcome 桥接

**Files**

- Modify: `src-tauri/src/lib.rs`
- Modify: `src/api/filesystem.ts`
- Modify: `src/components/ExplorerView.tsx`
- Modify: `src/components/TransferModal.tsx`

**Why**

后台 `copy / move` 是高价值误操作来源。如果没有逐文件 outcome，统一历史就会永远缺半边。

**Impact / Compatibility**

- `TransferTaskSnapshot` 继续做进度摘要
- 新增一次性 outcome 读取命令，不把长期历史逻辑塞进 Rust
- 前端在任务终态时读取 outcome，立即写入统一历史
- 同卷 `move` 可生成 reverse
- `copiedCrossDevice` 与 mixed cross-device move 只记录，不进入自动撤销范围

**Verification**

```bash
cargo test --lib operation_history
npm run lint:ts
```

**Repair Track**

- repaired object: transfer task 只有计数摘要，没有 effect 明细
- action: 新增 `take_transfer_task_outcome(taskId)` 桥接
- impact: copy / move session 能进入统一历史
- verification: copy / move 完成后历史里可见 effect 明细

**Retirement Track**

- retired object: “只依赖 `TransferTaskSnapshot` 计数值推断历史”的思路
- action: 明确不采用
- retained boundary: `TransferTaskSnapshot` 仍保留进度 UI 责任
- future trigger: 本任务完成后固定为桥接架构

### Steps

- [ ] **Write test**  
  在 Rust 单测中新增：
  1. `copy_files` 完成后生成 outcome effect，包含：
     - `copied` 目标路径
     - `reverse` 为删除新副本
  2. 同卷 `move_files` 完成后生成 outcome effect，包含：
     - `moved`
     - `reverse` 为移回原目录
  3. 跨卷 `move_files` 若产出 `copiedCrossDevice`，对应 effect 必须：
     - 只记录目标路径
     - 明确标记 `canUndo = false` 或 `reasonNotUndoable`
     - 不生成自动 reverse
  4. `take_transfer_task_outcome` 读取后会消费掉 outcome，第二次返回空

- [ ] **Verify RED**  
  ```bash
  cargo test --lib operation_history
  ```
  预期：缺少 outcome 结构或命令。

- [ ] **Minimal code**  
  1. 在 Rust 增加 `TransferTaskOutcome` 与 effect draft 结构
  2. `finish_copy_transfer_task` / `finish_move_transfer_task` 写入 outcome
     - `moved` 写可逆 draft
     - `copiedCrossDevice` 写只读 draft，不附带自动 reverse
  3. 新增 Tauri 命令：
     - `take_transfer_task_outcome`
  4. `src/api/filesystem.ts` 加对应调用
  5. `ExplorerView.tsx` 的：
     - `waitForTransferTask`
     - `waitForCrossWindowTask`
     在终态后读取 outcome，并调用 `saveOperationSession`
  6. `TransferModal.tsx` 不改 owner，只按现状继续轮询 snapshot

- [ ] **Verify GREEN**  
  ```bash
  cargo test --lib operation_history
  npm run lint:ts
  ```
  预期：通过。

- [ ] **Commit**  
  ```bash
  git add src-tauri/src/lib.rs src/api/filesystem.ts src/components/ExplorerView.tsx src/components/TransferModal.tsx
  git commit -m "feat: 传输任务结果桥接到操作历史"
  ```

---

## Task 5 — 撤销 preflight、逆序执行、状态回写

**Files**

- Modify: `src/lib/operation-history-undo.ts`
- Modify: `src/lib/operation-history.ts`
- Modify: `src/components/OperationHistoryPanel.tsx`
- Modify: `src/api/filesystem.ts`

**Why**

只有“能看不能撤”不够。Phase 1 需要把可逆 session 真正变成可操作能力。

**Impact / Compatibility**

- 只对安全可逆 session 启用撤销
- `trash / decompress / override / huge session` 保持不可自动撤销
- 结果状态要写回 session，而不是只弹 toast
- 撤销结果写回原 session，不新增顶层 undo session

**Verification**

```bash
npx vitest run src/__tests__/operation-history.test.ts
npm run lint:ts
```

**Repair Track**

- repaired object: 历史只能展示，不能统一撤销
- action: 新增 preflight + reverse execute + result writeback
- impact: session 具备真实恢复入口
- verification: 手动验证 `rename / create / duplicate / compress / copy / same-volume move`

**Retirement Track**

- retired object: AI-only rollback implementation
- action: 撤销逻辑统一迁入 `operation-history-undo.ts`
- retained boundary: 无
- future trigger: 本任务完成后所有撤销走统一 helper

### Steps

- [ ] **Write test**  
  在 `src/__tests__/operation-history.test.ts` 增加纯函数测试：
  1. effect 逆序执行顺序正确
  2. `trash` / 超大批量 / 缺少 reverse effect 时不可撤销
  3. preflight 对“目标已不存在 / 目标已漂移 / 同名冲突”返回可见失败原因

- [ ] **Verify RED**  
  ```bash
  npx vitest run src/__tests__/operation-history.test.ts
  ```
  预期：缺少 undo executor / preflight helper。

- [ ] **Minimal code**  
  1. `operation-history-undo.ts` 实现：
     - `getUndoability(session)`
     - `runUndoSession(session, fsApi)`
     - `preflightUndoEffect(effect)`
  2. `OperationHistoryPanel.tsx`：
     - 点击 `撤销`
     - 确认框
     - 运行 undo
     - 写回 session 状态：
       - `undone`
       - `undo_partial`
       - `undo_failed`
     - 撤销明细追加到原 session detail，不新增顶层 undo session
  3. 将旧 AI rollback UI 全部删掉，统一走新 helper

- [ ] **Verify GREEN**  
  ```bash
  npm run lint:ts
  npm test
  ```
  预期：通过。

- [ ] **Commit**  
  ```bash
  git add src/lib/operation-history-undo.ts src/lib/operation-history.ts src/components/OperationHistoryPanel.tsx src/__tests__/operation-history.test.ts
  git commit -m "feat: 接入统一操作撤销执行器"
  ```

---

## Task 6 — 设置、文案、全量验证与收尾

**Files**

- Modify: `src/components/SettingsView.tsx`
- Modify: `src/lib/settings.ts`
- Modify: `src/types.ts`
- Modify: `src/i18n/locales/zh.ts`
- Modify: `src/i18n/locales/en.ts`
- Modify: `src/__tests__/settings.test.ts`
- Modify: `docs/aegis/INDEX.md`

**Why**

把用户能看到的语言与当前真实产品形态对齐，并完成最终质量收口。

**Impact / Compatibility**

- UI 改成“操作历史保留时长”
- 内部先保留 `aiOpsHistoryRetentionDays` 作为 carrier，不做存储迁移
- release note / docs 不在本任务内扩散，避免 scope creep

**Verification**

```bash
npx vitest run src/__tests__/settings.test.ts
npm run lint:ts
npm test
npm run test:rust
```

**Repair Track**

- repaired object: 设置与产品文案仍是 AI-only
- action: 改 UI 文案，保留内部 carrier
- impact: 用户认知统一
- verification: 设置面、菜单、面板文案一致

**Retirement Track**

- retired object: AI-only 文案
- action: 替换为 unified history 文案
- retained boundary: 内部设置字段暂保留
- future trigger: 下一个设置迁移任务正式改内部字段

### Steps

- [ ] **Write test**  
  在 `src/__tests__/settings.test.ts` 增加断言：
  - `aiOpsHistoryRetentionDays` 仍被规范化
  - 默认值仍为 7
  - 新文案不会影响设置序列化

- [ ] **Verify RED**  
  ```bash
  npx vitest run src/__tests__/settings.test.ts
  ```
  预期：新增断言先失败。

- [ ] **Minimal code**  
  1. `SettingsView.tsx` 文案改成“操作历史保留时长”
  2. `zh.ts` / `en.ts` 替换 AI-only 历史相关可见文案
  3. `settings.ts` / `types.ts` 暂不改存储字段名，只补注释说明它是 temporary carrier
  4. 运行全量测试并修正类型 / 文案遗漏

- [ ] **Verify GREEN**  
  ```bash
  npx vitest run src/__tests__/settings.test.ts
  npm run lint:ts
  npm test
  npm run test:rust
  ```
  预期：全部通过。

- [ ] **Commit**  
  ```bash
  git add src/components/SettingsView.tsx src/lib/settings.ts src/types.ts src/i18n/locales/zh.ts src/i18n/locales/en.ts src/__tests__/settings.test.ts
  git commit -m "refactor: 完成统一操作历史收尾"
  ```

## Self-Review Checklist

- Spec coverage:
  - 已覆盖统一面板、session 撤销、保留期、前台操作、后台任务桥接、设置文案
- Placeholder scan:
  - 无 `TODO / TBD`
- Type consistency:
  - 所有新增类型都集中在 Task 1
- Compatibility:
  - 明确不迁移旧历史；保留 `aiOpsHistoryRetentionDays` 作为短期 carrier
- Verification:
  - 每个任务都有 RED / GREEN / commit 命令
- Dual-track:
  - AI-only owner 退役
  - 设置字段仅保留短期 carrier
