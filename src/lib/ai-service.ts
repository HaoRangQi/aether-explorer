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

async function callClaude(apiKey: string, model: string, req: AIRenameRequest, baseUrl?: string): Promise<string> {
  const url = baseUrl ? `${baseUrl.replace(/\/$/, '')}/v1/messages` : 'https://api.anthropic.com/v1/messages';
  try { new URL(url); } catch { throw new Error(`无效的 API URL: ${url}`); }
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: model || 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: buildUserPrompt(req) }],
    }),
  });
  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`Claude API 错误 (${resp.status}): ${err}`);
  }
  const data = await resp.json();
  return data.content?.[0]?.text || '';
}

async function callOpenAI(apiKey: string, model: string, req: AIRenameRequest, baseUrl?: string): Promise<string> {
  const url = baseUrl ? `${baseUrl.replace(/\/$/, '')}/v1/chat/completions` : 'https://api.openai.com/v1/chat/completions';
  try { new URL(url); } catch { throw new Error(`无效的 API URL: ${url}`); }
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: model || 'gpt-4o',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: buildUserPrompt(req) },
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

async function callOllama(endpoint: string, model: string, req: AIRenameRequest): Promise<string> {
  const url = `${endpoint.replace(/\/$/, '')}/api/chat`;
  try { new URL(url); } catch { throw new Error(`无效的 Ollama URL: ${url}`); }
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: model || 'llama3',
      stream: false,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: buildUserPrompt(req) },
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

  try {
    let raw: string;
    switch (provider.type) {
      case 'claude':
        raw = await callClaude(provider.apiKey!, provider.model || '', req, provider.baseUrl);
        break;
      case 'openai':
        raw = await callOpenAI(provider.apiKey!, provider.model || '', req, provider.baseUrl);
        break;
      case 'ollama':
        raw = await callOllama(provider.baseUrl || 'http://localhost:11434', provider.model || '', req);
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
  const base = (provider.baseUrl || '').replace(/\/$/, '');
  switch (provider.type) {
    case 'claude': return `${base || 'https://api.anthropic.com'}/v1/messages`;
    case 'openai': return `${base || 'https://api.openai.com'}/v1/chat/completions`;
    case 'ollama': return `${base || 'http://localhost:11434'}/api/chat`;
  }
}

export async function fetchModels(provider: AIProviderConfig): Promise<{ models: string[]; error?: string }> {
  try {
    const base = (provider.baseUrl || '').replace(/\/$/, '');
    let url: string;

    if (provider.type === 'claude') {
      url = `${base || 'https://api.anthropic.com'}/v1/models`;
      try { new URL(url); } catch { return { models: [], error: `无效的 URL: ${url}` }; }
      if (!provider.apiKey) return { models: [], error: '请先填写 API Key' };
      const resp = await fetch(url, {
        headers: {
          'x-api-key': provider.apiKey,
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
      const resp = await fetch(url, {
        headers: { 'Authorization': `Bearer ${provider.apiKey}` },
      });
      if (!resp.ok) return { models: [], error: `${resp.status}: ${await resp.text()}` };
      const data = await resp.json();
      return { models: (data.data || []).map((m: any) => m.id).sort() };
    }
    if (provider.type === 'ollama') {
      url = `${base || 'http://localhost:11434'}/api/tags`;
      try { new URL(url); } catch { return { models: [], error: `无效的 URL: ${url}` }; }
      const resp = await fetch(url);
      if (!resp.ok) return { models: [], error: `${resp.status}: ${await resp.text()}` };
      const data = await resp.json();
      return { models: (data.models || []).map((m: any) => m.name).sort() };
    }
    return { models: [] };
  } catch (e) {
    return { models: [], error: String(e instanceof Error ? e.message : e) };
  }
}
