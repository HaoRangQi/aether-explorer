# 11 AI 文件助手系统 (AI-File-Assistant)

**状态**: ✅ 已落地  **首次落地**: [2026-05-20]  **最近更新**: [2026-05-21]  **域**: AI 驱动的文件操作规划与执行，含多 provider 管理、操作历史与回滚

← 返回 [索引](./README.md)

---

## 11.1 一句话总结

用户用自然语言描述意图，AI 生成结构化操作计划（rename/mkdir/move/trash/compress），用户预览确认后执行，每次操作自动写入历史日志并支持一键回滚。

---

## 11.2 决策与权衡

| 决策 | 选择 | 否决方案 | 原因 |
|---|---|---|---|
| AI 操作 schema | 结构化 JSON（5 种 op 类型） | 生成 shell 脚本 | shell 脚本有注入风险，结构化 op 可严格校验 |
| 多 provider 管理 | `aiProviders[]` 数组 + `aiActiveProvider` | 单 provider 全局配置 | 用户可能同时有官方 API、中转站、本地模型 |
| HTTP 请求 | `tauri-plugin-http` 的 `fetch` | 浏览器原生 `fetch` | WebView 的 `new Request()` 对 header 值有严格校验，含不可见字符时抛 `The string did not match the expected pattern` |
| 操作历史存储 | 独立 `ai-ops.json`（Tauri Store） | 合并进 `settings.json` | 操作日志与配置生命周期不同，独立文件便于清理 |
| 回滚机制 | 前端推导反向 op，逐步执行 | 快照/备份 | 文件系统快照成本高；反向 op 对 rename/move/mkdir 足够，trash 无法自动还原已明确告知 |

不变量：
- `trash` 是唯一允许的"删除"方式，schema 校验拦截任何 `delete` 类型
- AI prompt 明确禁止永久删除（`src/lib/ai-service.ts:283`）
- `validTypes` 白名单：`rename | mkdir | move | trash | compress`（`src/lib/ai-service.ts:356`）

---

## 11.3 实现拓扑

```
用户输入意图
    │
    ▼
generateFileOps()          src/lib/ai-service.ts:322
    │  构造 FILE_OPS_SYSTEM_PROMPT + 文件列表
    │
    ├─ callClaude()         :59
    ├─ callOpenAI()         :85
    └─ callOllama()         :111
         │  fetchWithTimeout() 30s 超时
         ▼
    parseFileOpsResponse()  :350  校验 op 类型白名单
         │
         ▼
AIRenamePanel 预览         src/components/AIRenamePanel.tsx
    │  用户确认
    ▼
handleExecute()
    │  逐步执行 op，记录 resultPath
    │  buildReverseOp()     src/lib/ai-ops-log.ts:35
    ▼
saveOpSession()            src/lib/ai-ops-log.ts:12
    │  写入 ai-ops.json（最多 50 条）
    ▼
AIOpsHistory 面板          src/components/AIOpsHistory.tsx
    │  一键回滚：反向顺序执行 reverseOp
```

---

## 11.4 关键文件 & 行号

| 文件 | 职责 | 关键符号 |
|---|---|---|
| `src/lib/ai-service.ts:38` | 输入清洗（trim + 移除不可见字符） | `sanitize()` |
| `src/lib/ai-service.ts:44` | 30s 超时包装 | `fetchWithTimeout()` |
| `src/lib/ai-service.ts:208` | Base URL 预览拼接 | `getProviderApiUrl()` |
| `src/lib/ai-service.ts:217` | 从 API 拉取模型列表 | `fetchModels()` |
| `src/lib/ai-service.ts:264` | 操作类型定义 | `AIFileOp` union type |
| `src/lib/ai-service.ts:283` | AI system prompt（含禁止永久删除规则） | `FILE_OPS_SYSTEM_PROMPT` |
| `src/lib/ai-service.ts:322` | 通用操作生成入口 | `generateFileOps()` |
| `src/lib/ai-ops-log.ts:12` | 写入操作日志 | `saveOpSession()` |
| `src/lib/ai-ops-log.ts:35` | 推导反向操作 | `buildReverseOp()` |
| `src/components/AIRenamePanel.tsx` | 操作预览 + 执行 UI | — |
| `src/components/AIOpsHistory.tsx` | 历史查询 + 回滚 UI | — |
| `src/types.ts:128` | 多 provider 配置类型 | `AIProviderConfig` |
| `src/lib/settings.ts:62` | 系统内置 AI 扩展（不可删除） | `ai-assistant / ai-history` |

---

## 11.5 数据契约

### AIFileOp schema
```typescript
type AIFileOp =
  | { type: 'rename'; path: string; newName: string }
  | { type: 'mkdir'; parentDir: string; name: string }
  | { type: 'move'; path: string; targetDir: string }
  | { type: 'trash'; path: string }
  | { type: 'compress'; paths: string[]; outputName: string }
```

### AI 返回格式
```json
{
  "summary": "一句话描述操作计划",
  "ops": [ ...AIFileOp[] ]
}
```

### AIOpSession（ai-ops.json）
```typescript
interface AIOpSession {
  id: string;           // ai-{timestamp}
  timestamp: number;
  instruction: string;  // 用户输入
  summary: string;      // AI 生成的计划描述
  ops: AIExecutedOp[];
  canRollback: boolean; // 含 trash 时为 false
}
```

---

## 11.7 失败模式与排查

| 现象 | 根因 | 修复 |
|---|---|---|
| `The string did not match the expected pattern` | `tauri-plugin-http` 内部用 `new Request()` 构造请求，header 值含不可见字符（零宽空格、BOM 等）时 WebKit 抛错 | `sanitize()` 清理 API Key 和 Base URL（`src/lib/ai-service.ts:38`） |
| `Maximum call stack size exceeded` | `fetchWithTimeout` 内部调用自身（Bash 脚本替换时把内部 `fetch` 也替换了） | 内部改回调用导入的 `fetch`（`src/lib/ai-service.ts:50`） |
| 请求卡死无响应 | 无超时机制 | `AbortController` + 30s `setTimeout`（`src/lib/ai-service.ts:44`） |
| 获取模型列表无反应 | 同上，无超时 | 同上 |
| 操作历史写入失败 | `tauri-plugin-fs` 未注册 Rust 端 | `src-tauri/src/lib.rs` 加 `.plugin(tauri_plugin_fs::init())`，capabilities 加 `fs:default` |

---

## 11.9 经验教训

1. **`tauri-plugin-http` 不是透明代理**：它内部先用浏览器 `new Request()` 构造请求对象，再通过 Rust 发送。任何不符合 WebKit `RequestInit` 规范的值（含不可见字符的 header）都会在 JS 层抛错，不会到达 Rust。调试时要在 JS 层加 `sanitize`，不要只看 Rust 日志。

2. **Bash 脚本批量替换要验证**：用 `node -e` 替换 `fetch` → `fetchWithTimeout` 时，把函数内部的 `fetch` 调用也替换了，导致无限递归。替换后必须 `grep -n fetchWithTimeout` 验证内部调用没有被误替换。

3. **系统内置扩展要防删**：`ai-assistant` 和 `ai-history` 作为 `isSystem: true` 的扩展，`normalizeContextMenuExtensions` 会在升级时自动补全缺失的系统扩展（`src/lib/settings.ts:110`），设置页隐藏编辑/删除按钮。

4. **AI prompt 的安全边界要写进 system prompt**：仅靠前端 schema 校验不够，AI 可能返回意外的 op 类型。`FILE_OPS_SYSTEM_PROMPT` 第 7 条规则明确"严禁生成任何永久删除操作"，双重保险。

5. **trash 回滚无法自动化**：macOS 没有公开 API 从废纸篓还原指定文件。含 `trash` op 的 session `canRollback = false`，UI 明确提示"需手动从废纸篓恢复"。
