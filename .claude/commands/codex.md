---
description: 按 codex/README.md 的触发协议，把最近的功能 / 修复 / 复盘沉淀到项目法典
---

读 `codex/README.md`，**严格按照其中的「触发协议 — 给 AI 助手」6 阶段（解析 → 诊断 → 决策 → 撰写 → 校对 → 写入 → 报告）执行**。

主题：

$ARGUMENTS

如上方主题为空，按"阶段性复盘 / 近 7 天"处理：用 `git log --since="7 days ago"` 推断范围。

执行约束：
- 不要凭印象写经验。每条事实必须有 `path:line` / commit hash / SCRATCH 条目作为锚点。
- 阶段 5 校对不能跳。所有 `path:line` 引用都用 `Read` 或 `grep -n` 实证。
- 完成后用 2-3 句给出报告（写到哪、校验了多少处引用、有无值得关注的 SCRATCH）。
