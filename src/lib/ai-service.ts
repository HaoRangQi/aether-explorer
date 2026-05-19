import type { ThemeSettings, AIProviderConfig } from '../types';
import { fetch } from '@tauri-apps/plugin-http';

interface AIRenameRequest {
  fileNames: string[];
  instruction: string;
  directory: string;
}

interface AIRenameResult {
  newNames: string[];
  error?: string;
}

const SYSTEM_PROMPT = `你是一个文件批量重命名助手。用户会给你一组文件名和一个重命名意图描述。
你需要根据意图生成新的文件名列表。

规则：
1. 返回纯 JSON 数组，不要 markdown 包裹，不要解释
2. 数组长度必须与输入文件名数量完全一致
3. 保留原始文件扩展名，除非用户明确要求修改扩展名
4. 文件名不能包含 / \\ : * ? " < > | 等非法字符
5. 如果意图不明确，做最合理的推断

示例输入：
文件名: ["IMG_001.jpg", "IMG_002.jpg", "IMG_003.jpg"]
意图: "按序号重命名为 photo-1, photo-2..."

示例输出：
["photo-1.jpg", "photo-2.jpg", "photo-3.jpg"]`;

function buildUserPrompt(req: AIRenameRequest): string {
  return `文件所在目录: ${req.directory}
文件名: ${JSON.stringify(req.fileNames)}
意图: "${req.instruction}"`;
}

function sanitize(s: string): string {
  // trim + 移除控制字符(U+0000-U+001F, U+007F) + 常见不可见字符(U+00AD, U+200B-U+200D, U+FEFF)
  return s.trim().replace(/[\u0000-\u001f\u007f\u00ad\u200b\u200c\u200d\ufeff]/g, '');
}


const REQUEST_TIMEOUT_MS = 30000;

async function fetchWithTimeout(url: string, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (e) {
    if (controller.signal.aborted) throw new Error('请求超时（30s），请检查网络或 API 地址');
    throw e;
  } finally {
    clearTimeout(timer);
  }
}
async function callClaude(apiKey: string, model: string, systemPrompt: string, userPrompt: string, baseUrl?: string): Promise<string> {
  const url = baseUrl ? `${sanitize(baseUrl).replace(/\/$/, '')}/v1/messages` : 'https://api.anthropic.com/v1/messages';
  try { new URL(url); } catch { throw new Error(`无效的 API URL: ${url}`); }
  const resp = await fetchWithTimeout(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': sanitize(apiKey),
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: model || 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    }),
  });
  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`Claude API 错误 (${resp.status}): ${err}`);
  }
  const data = await resp.json();
  return data.content?.[0]?.text || '';
}

async function callOpenAI(apiKey: string, model: string, systemPrompt: string, userPrompt: string, baseUrl?: string): Promise<string> {
  const url = baseUrl ? `${sanitize(baseUrl).replace(/\/$/, '')}/v1/chat/completions` : 'https://api.openai.com/v1/chat/completions';
  try { new URL(url); } catch { throw new Error(`无效的 API URL: ${url}`); }
  const resp = await fetchWithTimeout(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${sanitize(apiKey)}`,
    },
    body: JSON.stringify({
      model: model || 'gpt-4o',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.2,
    }),
  });
  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`OpenAI API 错误 (${resp.status}): ${err}`);
  }
  const data = await resp.json();
  return data.choices?.[0]?.message?.content || '';
}

async function callOllama(endpoint: string, model: string, systemPrompt: string, userPrompt: string): Promise<string> {
  const url = `${sanitize(endpoint).replace(/\/$/, '')}/api/chat`;
  try { new URL(url); } catch { throw new Error(`无效的 Ollama URL: ${url}`); }
  const resp = await fetchWithTimeout(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: model || 'llama3',
      stream: false,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    }),
  });
  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`Ollama 错误 (${resp.status}): ${err}`);
  }
  const data = await resp.json();
  return data.message?.content || '';
}

function parseResponse(raw: string, expectedCount: number): string[] {
  const cleaned = raw.replace(/```json?\s*/g, '').replace(/```/g, '').trim();
  const match = cleaned.match(/\[[\s\S]*\]/);
  if (!match) throw new Error('AI 返回格式无法解析，未找到 JSON 数组');
  const arr = JSON.parse(match[0]);
  if (!Array.isArray(arr)) throw new Error('AI 返回不是数组');
  if (arr.length !== expectedCount) throw new Error(`AI 返回 ${arr.length} 个文件名，但需要 ${expectedCount} 个`);
  return arr.map(String);
}

function getActiveProvider(theme: ThemeSettings): { type: string; apiKey?: string; baseUrl?: string; model?: string } | null {
  // 优先用新的多 provider 配置
  if (theme.aiProviders?.length && theme.aiActiveProvider) {
    const p = theme.aiProviders.find(p => p.id === theme.aiActiveProvider && p.enabled);
    if (p) return { type: p.type, apiKey: p.apiKey, baseUrl: p.baseUrl, model: p.model };
  }
  // 兼容旧字段
  if (theme.aiProvider) {
    return {
      type: theme.aiProvider,
      apiKey: theme.aiApiKey,
      baseUrl: theme.aiProvider === 'ollama' ? (theme.aiOllamaEndpoint || 'http://localhost:11434') : undefined,
      model: theme.aiModel,
    };
  }
  return null;
}

export async function generateRenames(theme: ThemeSettings, req: AIRenameRequest): Promise<AIRenameResult> {
  const provider = getActiveProvider(theme);
  if (!provider) return { newNames: [], error: '请先在设置 → AI 服务中配置并启用一个提供商' };
  if (provider.type !== 'ollama' && !provider.apiKey) return { newNames: [], error: '请填写 API Key' };

  const userPrompt = buildUserPrompt(req);
  try {
    let raw: string;
    switch (provider.type) {
      case 'claude':
        raw = await callClaude(provider.apiKey!, provider.model || '', SYSTEM_PROMPT, userPrompt, provider.baseUrl);
        break;
      case 'openai':
        raw = await callOpenAI(provider.apiKey!, provider.model || '', SYSTEM_PROMPT, userPrompt, provider.baseUrl);
        break;
      case 'ollama':
        raw = await callOllama(provider.baseUrl || 'http://localhost:11434', provider.model || '', SYSTEM_PROMPT, userPrompt);
        break;
      default:
        return { newNames: [], error: '未知的 AI 提供商' };
    }
    const newNames = parseResponse(raw, req.fileNames.length);
    return { newNames };
  } catch (e) {
    return { newNames: [], error: String(e instanceof Error ? e.message : e) };
  }
}

export async function testAIConnection(theme: ThemeSettings): Promise<{ ok: boolean; error?: string }> {
  const result = await generateRenames(theme, {
    fileNames: ['test_file.txt'],
    instruction: '加上 hello 前缀',
    directory: '/tmp',
  });
  if (result.error) return { ok: false, error: result.error };
  if (result.newNames.length === 1) return { ok: true };
  return { ok: false, error: '返回结果异常' };
}

export async function testProviderConnection(provider: AIProviderConfig): Promise<{ ok: boolean; error?: string }> {
  const fakeTheme = {
    aiProviders: [provider],
    aiActiveProvider: provider.id,
  } as ThemeSettings;
  return testAIConnection(fakeTheme);
}

export function getProviderApiUrl(provider: AIProviderConfig): string {
  const base = sanitize(provider.baseUrl || '').replace(/\/$/, '');
  switch (provider.type) {
    case 'claude': return `${base || 'https://api.anthropic.com'}/v1/messages`;
    case 'openai': return `${base || 'https://api.openai.com'}/v1/chat/completions`;
    case 'ollama': return `${base || 'http://localhost:11434'}/api/chat`;
  }
}

export async function fetchModels(provider: AIProviderConfig): Promise<{ models: string[]; error?: string }> {
  try {
    const base = sanitize(provider.baseUrl || '').replace(/\/$/, '');
    let url: string;

    if (provider.type === 'claude') {
      url = `${base || 'https://api.anthropic.com'}/v1/models`;
      try { new URL(url); } catch { return { models: [], error: `无效的 URL: ${url}` }; }
      if (!provider.apiKey) return { models: [], error: '请先填写 API Key' };
      const resp = await fetchWithTimeout(url, {
        headers: {
          'x-api-key': sanitize(provider.apiKey),
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
      });
      if (!resp.ok) return { models: [], error: `${resp.status}: ${await resp.text()}` };
      const data = await resp.json();
      return { models: (data.data || []).map((m: any) => m.id).sort() };
    }
    if (provider.type === 'openai') {
      url = `${base || 'https://api.openai.com'}/v1/models`;
      try { new URL(url); } catch { return { models: [], error: `无效的 URL: ${url}` }; }
      if (!provider.apiKey) return { models: [], error: '请先填写 API Key' };
      const resp = await fetchWithTimeout(url, {
        headers: { 'Authorization': `Bearer ${sanitize(provider.apiKey)}` },
      });
      if (!resp.ok) return { models: [], error: `${resp.status}: ${await resp.text()}` };
      const data = await resp.json();
      return { models: (data.data || []).map((m: any) => m.id).sort() };
    }
    if (provider.type === 'ollama') {
      url = `${base || 'http://localhost:11434'}/api/tags`;
      try { new URL(url); } catch { return { models: [], error: `无效的 URL: ${url}` }; }
      const resp = await fetchWithTimeout(url);
      if (!resp.ok) return { models: [], error: `${resp.status}: ${await resp.text()}` };
      const data = await resp.json();
      return { models: (data.models || []).map((m: any) => m.name).sort() };
    }
    return { models: [] };
  } catch (e) {
    return { models: [], error: String(e instanceof Error ? e.message : e) };
  }
}

// ── AI 文件助手：通用操作 schema ──────────────────────────────────────────

export type AIFileOp =
  | { type: 'rename'; path: string; newName: string }
  | { type: 'mkdir'; parentDir: string; name: string }
  | { type: 'move'; path: string; targetDir: string }
  | { type: 'trash'; path: string }
  | { type: 'compress'; paths: string[]; outputName: string };

export interface AIFileOpsResult {
  ops: AIFileOp[];
  summary: string;
  error?: string;
}

interface AIFileOpsRequest {
  files: { name: string; path: string; isDir: boolean }[];
  instruction: string;
  currentDir: string;
}

const FILE_OPS_SYSTEM_PROMPT = `你是一个文件操作助手。用户会给你一组文件信息和操作意图，你需要生成一个操作计划。

支持的操作类型（严格按此 schema）：
- rename: { "type": "rename", "path": "<原始完整路径>", "newName": "<仅文件名，不含路径>" }
- mkdir:  { "type": "mkdir", "parentDir": "<父目录路径>", "name": "<新文件夹名>" }
- move:   { "type": "move", "path": "<原始完整路径>", "targetDir": "<目标目录完整路径>" }
- trash:  { "type": "trash", "path": "<原始完整路径>" }  // 仅移至系统废纸篓，可恢复，绝对禁止永久删除
- compress: { "type": "compress", "paths": ["<路径1>", ...], "outputName": "<压缩包文件名，含扩展名如.zip>" }

返回格式（纯 JSON，不要 markdown 包裹，不要解释）：
{
  "summary": "一句话描述操作计划",
  "ops": [ ...操作列表... ]
}

规则：
1. path 必须使用用户提供的原始完整路径，不要自己拼接
2. newName 只含文件名，不含路径分隔符
3. 文件名不能包含 / \\ : * ? " < > | 等非法字符
4. 如果意图不明确，做最合理的推断
5. mkdir 后如果需要 move，先 mkdir 再 move
6. 操作顺序很重要，依赖关系要正确
7. 严禁生成任何永久删除操作，trash 是唯一允许的"删除"方式，且文件可从废纸篓恢复`;

function buildFileOpsPrompt(req: AIFileOpsRequest): string {
  const fileList = req.files.map(f =>
    `- ${f.isDir ? '[目录]' : '[文件]'} ${f.name}  路径: ${f.path}`
  ).join('\n');
  return `当前目录: ${req.currentDir}
文件列表:
${fileList}
操作意图: "${req.instruction}"`;
}

export async function generateFileOps(theme: ThemeSettings, req: AIFileOpsRequest): Promise<AIFileOpsResult> {
  const provider = getActiveProvider(theme);
  if (!provider) return { ops: [], summary: '', error: '请先在设置 → AI 服务中配置并启用一个提供商' };
  if (provider.type !== 'ollama' && !provider.apiKey) return { ops: [], summary: '', error: '请填写 API Key' };

  try {
    let raw: string;
    const userPrompt = buildFileOpsPrompt(req);
    switch (provider.type) {
      case 'claude':
        raw = await callClaude(provider.apiKey!, provider.model || '', FILE_OPS_SYSTEM_PROMPT, userPrompt, provider.baseUrl);
        break;
      case 'openai':
        raw = await callOpenAI(provider.apiKey!, provider.model || '', FILE_OPS_SYSTEM_PROMPT, userPrompt, provider.baseUrl);
        break;
      case 'ollama':
        raw = await callOllama(provider.baseUrl || 'http://localhost:11434', provider.model || '', FILE_OPS_SYSTEM_PROMPT, userPrompt);
        break;
      default:
        return { ops: [], summary: '', error: '未知的 AI 提供商' };
    }
    return parseFileOpsResponse(raw);
  } catch (e) {
    return { ops: [], summary: '', error: String(e instanceof Error ? e.message : e) };
  }
}

function parseFileOpsResponse(raw: string): AIFileOpsResult {
  const cleaned = raw.replace(/```json?\s*/g, '').replace(/```/g, '').trim();
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('AI 返回格式无法解析');
  const data = JSON.parse(match[0]);
  if (!Array.isArray(data.ops)) throw new Error('AI 返回缺少 ops 数组');
  // 校验每个 op 的 type 合法
  const validTypes = new Set(['rename', 'mkdir', 'move', 'trash', 'compress']);
  for (const op of data.ops) {
    if (!validTypes.has(op.type)) throw new Error(`未知操作类型: ${op.type}`);
  }
  return { ops: data.ops as AIFileOp[], summary: data.summary || '' };
}
