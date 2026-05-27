# 初始基线快照

日期：2026-05-27

## 当前与“操作历史 / 撤销”直接相关的基线

1. AI 历史已经存在独立持久化模型：
   - `src/lib/ai-ops-log.ts`
   - 具备索引、分页、搜索、保留期清理
   - 每条 session 支持 `canRollback`

2. AI 历史已经存在有限回滚能力：
   - `src/types.ts`
   - `src/components/AIOpsHistory.tsx`
   - `reverseOp` 按逆序执行
   - 当前可自动回滚的范围有限

3. 传输管理当前只是进度与结果展示：
   - `src/components/TransferModal.tsx`
   - `src-tauri/src/lib.rs`
   - `TransferTaskSnapshot` 没有 reverse effect / undo token / rollbackable 字段

4. 顶部菜单存在系统 `Undo / Redo`：
   - `src-tauri/src/lib.rs`
   - 当前未接文件操作业务撤销链路

## 当前 owner 压力

- `src/components/ExplorerView.tsx`：6442 行
- `src-tauri/src/lib.rs`：5935 行

结论：

- 不适合把“统一操作历史 / 通用撤销执行器”继续堆进以上两个文件。
- 该能力需要新 owner，而不是原地加分支。
