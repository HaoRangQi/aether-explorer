# 操作历史与撤销设计

状态：Draft
日期：2026-05-27
主题：统一文件操作历史、可控撤销、复杂度边界

## 1. 问题定义

当前产品已经有两类相邻但割裂的能力：

1. AI 操作历史：
   - 能看
   - 能搜索 / 分页 / 按日期过滤
   - 部分操作能回滚

2. 普通文件操作与传输管理：
   - 能看进度
   - 能看结果摘要
   - 不能统一查看历史
   - 不能统一撤销

用户真实需求不是“AI 历史更强”，而是：

- 我做过什么，之后能回看；
- 误操作时，能撤销；
- 不是假撤销，要有明确边界；
- 不能因为做撤销，把系统做成一个复杂、脆弱、不可解释的大栈机。

## 2. 第一性原理

### First Principle

撤销能力的本质不是“像编辑器一样无限回退”，而是降低文件系统误操作的恢复成本。

### Non-negotiables

- 不能对用户宣称超出真实能力的“全量撤销”
- 撤销必须按 effect 逆序执行
- 撤销前必须验证当前文件系统状态，避免误伤
- 不是所有操作都必须自动撤销
- 历史首先是审计记录，其次才是撤销入口

### Historical Assumptions to Delete

- “有 Undo 菜单就等于支持撤销”
- “传输管理记录了结果，就等于能撤销”
- “所有文件操作都可以安全自动回退”

### Smallest Sufficient Path

做一个统一的“操作历史”模型，先覆盖高价值、可安全回滚的文件操作，并复用现有 AI session / reverseOp 思路。

### Escalation Signal

如果方案开始要求：

- 无限撤销栈
- 任意历史重做
- 覆盖文件精确恢复
- 废纸篓自动还原
- 大批量跨卷混合操作强保证回滚

就说明复杂度已经越界，需要单独拆题，而不是塞进当前功能。

## 3. 目标与非目标

### 3.1 目标

本次设计目标：

1. 提供统一操作历史
2. 支持查看、搜索、筛选、展开明细
3. 对安全可逆的 session 提供撤销
4. 明确历史保留策略、可撤销上限、失败降级策略

### 3.2 非目标

本次明确不做：

1. 无限 Undo / Redo 栈
2. 单个 effect 的任意手工改写与重排
3. 废纸篓精确自动恢复
4. 覆盖替换文件的原样恢复
5. 解压操作的自动回滚
6. 所有超大批量操作的自动撤销承诺

## 4. 当前基线与复用点

### 4.1 可直接复用

现有 AI 历史已经有适合复用的形状：

- session 索引 + session 明细分离
- retention 清理
- 分页 / 搜索 / 日期过滤
- `canRollback`
- `reverseOp`

这意味着新的通用能力不该从零开始，而应该把 AI 历史提升为更通用的操作历史模型。

### 4.2 不能直接复用的部分

传输管理 `TransferTaskSnapshot` 只适合做“进行中 / 刚完成”的瞬时任务展示，不适合直接承接长期历史：

- 没有 effect 明细
- 没有 reverse 信息
- 生命周期偏短
- 设计目标是进度反馈，不是审计与恢复

结论：

- 传输管理继续保留为 transient progress UI
- 操作历史是独立 owner
- 传输完成后，把最终结果写入操作历史

## 5. 方案选型

### Option A：仅支持最近一次撤销

优点：

- 实现最快
- UI 成本最低

缺点：

- 不能回看
- 多步操作后价值迅速归零
- 和用户“操作列表 + 可撤销”的真实需求不匹配

结论：不采用

### Option B：统一操作历史 + 按 session 撤销

优点：

- 复杂度受控
- 用户价值高
- 与现有 AI 历史模型连续
- 容易设置 retention 与能力边界

缺点：

- 需要新增统一日志 owner
- 需要把普通文件操作改成产出 effect 明细

结论：推荐采用

### Option C：完整事件溯源 / 无限撤销

优点：

- 理论能力最强

缺点：

- 文件系统语义太脏，可靠性很难成立
- 覆盖、外部程序修改、跨卷、废纸篓都会使其代价失控
- 会显著扩大 owner 和测试面

结论：当前阶段不采用

## 6. 推荐方案

采用 **Option B：统一操作历史 + 按 session 撤销**。

### 6.1 产品形态

新增统一面板：`操作历史`

推荐默认结构：

- 顶部筛选：`全部 / 文件操作 / AI 操作`
- 列表项展示：
  - 时间
  - 来源：手动 / AI
  - 操作摘要
  - 影响项目数
  - 状态：成功 / 部分成功 / 失败 / 已撤销 / 部分撤销
  - 是否可撤销
- 展开后显示 effect 明细与撤销结果

### 6.1.1 全量可看，有限可操作

这里的最佳实践不是“只有最近一次能撤销”，也不是“把历史列表做成万能操作台”，而是：

1. **整张历史列表都可看**
   - 在 retention 窗口内，所有 session 都应该进入统一 `操作历史`
   - 包括可撤销与不可撤销项

2. **只有安全可逆 session 可操作**
   - 行级主操作只保留一个：`撤销`
   - 不能自动撤销的项，不隐藏，而是明确展示原因
   - Phase 1 不做“重做 / 再执行 / 编辑历史 / 删除历史后果”这类会扩复杂度的动作

3. **撤销结果写回原 session**
   - 撤销成功后，把原 session 状态改成 `undone`
   - 部分撤销改成 `undo_partial`
   - 撤销失败改成 `undo_failed`
   - 撤销执行明细挂在原 session 下

4. **Phase 1 不把撤销再生成为新的顶层 session**
   - 否则列表会很快变成“操作、撤销操作、撤销的撤销”的递归结构
   - 用户真正关心的是“那次操作现在是否已经被撤销”，而不是额外多出一条技术性事件

结论：

- `操作历史` 是**全量审计列表**
- `撤销` 是**受限的行级动作**
- 这样能满足“既能看也能操作”，但不会演化成高复杂度的事件控制台

### 6.2 撤销粒度

撤销粒度是 **session**，不是单个散落动作。

一个 session 的定义：

- 一次重命名
- 一次批量复制
- 一次批量移动
- 一次压缩
- 一次 AI 批量操作

原因：

- 用户认知上是一组动作
- 撤销时也必须按原批次逆序执行
- 这样能避免列表爆炸

### 6.3 数据模型

建议新增通用 owner，例如：

- 前端：`src/lib/operation-history.ts`
- 前端类型：`src/types.ts` 扩展通用 session / effect 类型
- Rust：独立 operation log / undo executor owner

核心模型建议：

```ts
OperationSession {
  id: string
  source: 'manual' | 'ai'
  category: 'rename' | 'copy' | 'move' | 'create' | 'compress' | 'trash' | ...
  timestamp: number
  summary: string
  status: 'completed' | 'partial' | 'failed' | 'undone' | 'undo_partial' | 'undo_failed'
  canUndo: boolean
  reasonNotUndoable?: string
  itemCount: number
  effects: OperationEffect[]
}
```

```ts
OperationEffect {
  id: string
  kind: 'rename' | 'copy-created' | 'move' | 'mkdir' | 'create-file' | 'compress-output' | 'trash'
  status: 'ok' | 'fail' | 'skipped'
  targetPath: string
  reverse?: UndoEffect
  note?: string
}
```

```ts
UndoEffect {
  kind: 'rename' | 'move' | 'trash-created-copy' | 'trash-created-folder' | ...
  preconditions: ...
}
```

关键点：

- **不要直接把 AIFileOp 当作唯一通用协议**
- AI 可以映射到通用 effect
- 普通文件操作也写入同一个 effect 模型

## 7. 第一阶段支持范围

### 7.1 支持自动撤销

第一阶段只支持以下安全度较高的场景：

1. `rename`
2. `move`
3. `copy`
   - 撤销 = 删除本次新创建的副本
   - 必须校验目标文件仍是本次生成的目标
4. `mkdir`
   - 撤销 = 把本次创建的空目录移至废纸篓
5. `create file`
   - 撤销 = 把本次创建的文件移至废纸篓
6. `compress`
   - 撤销 = 删除压缩产物

### 7.2 只记录、不自动撤销

第一阶段记录但不自动撤销：

1. `trash`
   - 仅提示“请从废纸篓恢复”
2. 覆盖替换
3. 解压
4. 跨卷 mixed move/copy
5. 用户在操作后又手动修改过目标文件的场景

### 7.3 超大批量降级

建议增加可撤销上限：

- 单个 session 超过 `2000` 个 effect：**仍记录，但 `canUndo = false`**
- 原因说明：`批量操作过大，已记录历史，但不提供自动撤销`

原因：

- 这是用户保护，不是功能缺失
- 超大批量回退一旦判断失误，破坏面过大
- 当前项目已有 `5000` 级别大批量阈值认知，但撤销应更保守

## 8. 撤销执行规则

### 8.1 顺序

必须按 session effect 的**逆序**执行。

### 8.2 预检查

每个 effect 撤销前做 preflight：

1. 目标路径是否仍存在
2. 当前路径是否仍与 session 记录一致
3. 是否发生同名冲突
4. 是否已被外部修改到无法安全确认

### 8.3 结果策略

允许以下结果：

- 全部撤销成功
- 部分撤销成功
- 全部撤销失败

必须把每个 effect 的结果记回 session，不能只报一个总状态。

### 8.4 不承诺强一致

文件系统不是事务数据库。

因此产品文案必须表达为：

- “自动撤销”
- “可撤销”
- “部分撤销”

而不是“保证恢复到原样”。

## 9. 保留策略

### 9.1 默认策略

建议默认：

- 保留天数：`7` 天
- 最大 session 数：`500`

补充规则：

- **可见窗口**与**可撤销窗口**在 Phase 1 先保持一致
- 也就是说，用户只能对仍在保留期内、且未被裁剪的 session 进行撤销
- 不做“历史已不可见但仍可从别处撤销”的双轨机制

### 9.2 硬上限

建议硬上限：

- 最多保留 `1000` 条 session
- 超出时按时间裁剪最旧项

### 9.3 存储结构

沿用现有 AI 历史思路：

- 轻量 index：用于列表、搜索、筛选
- session detail：按 id 单独存

这样可以避免每次都把所有明细整包读进来。

同时要求：

- index 必须足够支撑“列表即审计面板”的读取性能
- undo result 追加到对应 session detail，而不是再写出一条新的顶层 undo session

## 10. 与现有模块的关系

### 10.1 AI 历史

推荐升级为统一 `操作历史`，而不是保留两个平行面板。

AI 历史作为 `source = 'ai'` 的一种来源保留。

这样可以：

- 避免两个历史入口
- 统一撤销交互
- 统一 retention / 搜索 / 分页策略

### 10.2 传输管理

传输管理继续负责：

- 进行中的进度
- 刚完成的结果回执
- 自动关闭、取消、清空

不负责长期历史与撤销。

完成时，如果产生了文件系统 effect，再追加一条操作历史 session。

### 10.3 顶部 Undo 菜单

第一阶段不建议直接接“最近一条历史撤销”。

原因：

- 用户未必理解当前会撤销哪一条
- 多窗口 / 多来源下，最近一条定义容易歧义

更稳的路线：

- Phase 1：先做历史面板里的显式撤销
- Phase 2：若需要，再把菜单 `Undo` 接到“当前窗口最近可撤销 session”

## 11. UI 行为建议

### 11.1 主列表

每条 session 一行，默认收起。

字段建议：

- 时间
- 来源
- 摘要
- 项目数
- 状态
- 操作按钮：`撤销` / `不可自动撤销`

### 11.2 明细展开

展开后展示：

- effect 列表
- 每个 effect 的路径
- 执行结果
- 撤销失败原因 / 跳过原因

### 11.3 撤销确认

对可撤销 session，点击 `撤销` 时弹确认：

- 展示影响项目数
- 展示不可逆风险提示
- 说明“若文件已在之后被修改，可能只能部分撤销”

## 12. 实现边界与 owner 建议

### 12.1 前端 owner

不要继续把逻辑堆进：

- `src/components/ExplorerView.tsx`

建议拆出：

- `OperationHistoryPanel`
- `operation-history.ts`
- `operation-history-types.ts` 或并入 `src/types.ts`

### 12.2 Rust owner

不要继续把通用撤销执行器无边界堆进：

- `src-tauri/src/lib.rs`

建议拆出：

- operation log state
- undo executor
- effect serialization / validation helper

## 13. 验收标准

### Phase 1 验收

1. 用户能打开统一操作历史面板
2. 普通文件操作与 AI 操作都能出现在同一历史体系里
3. 可撤销 session 能显式撤销
4. 撤销结果能落回历史状态
5. 不可自动撤销的 session 会明确展示原因
6. retention 与数量裁剪有硬限制

## 14. 风险与缓解

### 风险 1：用户误以为撤销是绝对恢复

缓解：

- 用语统一成“自动撤销”
- 展示部分撤销与失败原因

### 风险 2：超大批量撤销破坏面大

缓解：

- 超阈值仅记录，不提供自动撤销

### 风险 3：继续堆进现有超大 owner

缓解：

- 新建 owner，不在 `ExplorerView` / `src-tauri/src/lib.rs` 里继续膨胀

## 15. Decision Needed

待确认 1 个产品决策：

- **AI 历史是否直接升级并并入统一“操作历史”面板**

本设计的推荐答案：

- **是，统一一个面板**

原因：

- 用户只关心“我做过什么”，不关心实现来源
- 可减少入口分裂
- 可统一 retention / 搜索 / 撤销策略

## 16. TaskIntentDraft

- Outcome：统一操作历史 + 有边界的自动撤销
- Success evidence：用户可查看、可筛选、可对可逆 session 执行撤销
- Stop condition：设计与边界被确认，可以进入实现计划
- Non-goals：无限 Undo、废纸篓自动恢复、覆盖恢复、复杂跨卷强保证回退
- Scope：文件操作历史、AI 操作历史、可逆 effect、retention、UI 交互
- Risks：错误承诺、owner 膨胀、超大批量误回滚

## 17. BaselineReadSetHint

- `src/lib/ai-ops-log.ts`
- `src/components/AIOpsHistory.tsx`
- `src/components/TransferModal.tsx`
- `src/types.ts`
- `src-tauri/src/lib.rs`

## 18. ImpactStatementDraft

- Affected layers：前端历史 UI、前端 session store、Rust 文件操作结果落盘、撤销执行器
- Owners：新 operation-history owner + 新 undo executor owner
- Invariants：逆序撤销、preflight 校验、部分撤销可见、retention 有硬限制
- Compatibility：本次不考虑旧版本兼容
- Non-goals：不把传输管理直接改造成长期历史系统
