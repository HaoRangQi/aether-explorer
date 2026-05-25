/**
 * URL/Shell 安全校验工具
 *
 * 用于 RELEASE_AUDIT.md P0-2 的修复：
 * - shell.open 调用前必须经过协议白名单
 * - 壁纸 URL / 用户输入的链接同样过白名单
 * - 自定义扩展中的 {path}/{name} 等模板插值后，进入 shell 命令的部分必须 shell-escape
 *
 * 这是一个纯函数模块，不依赖 Tauri，便于单测。
 */

import { open as tauriShellOpen } from '@tauri-apps/plugin-shell';

const SAFE_SHELL_OPEN_SCHEMES = new Set(['http:', 'https:', 'mailto:']);

/**
 * 判断 URL 是否可安全通过 `shell.open` 打开。
 *
 * 拒绝：
 * - `javascript:` `data:` `file:` `about:` `vbscript:`：可被注入执行
 * - macOS 私有 scheme `x-apple-*`：会绕过用户预期
 * - 任意非常见 scheme（"custom-protocol://"）
 *
 * 接受：http / https / mailto。
 */
export function isSafeShellOpenUrl(raw: string): boolean {
  if (!raw || typeof raw !== 'string') return false;
  if (/\s|[\u0000-\u001F\u007F]/u.test(raw)) return false;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  return SAFE_SHELL_OPEN_SCHEMES.has(url.protocol);
}

/**
 * 判断壁纸 URL 是否合法。
 *
 * 接受：http/https 远程 URL、`asset://` 本地（Tauri 转换后）、空字符串（即清除壁纸）
 * 拒绝：`javascript:` / `data:` / 含 `url()` 注入字符
 */
export function isValidWallpaperUrl(raw: string): boolean {
  if (typeof raw !== 'string') return false;
  if (!raw) return true; // 空字符串 = 清除壁纸
  if (/\s|[\u0000-\u001F\u007F]/u.test(raw)) return false;
  // 阻止 CSS url() 闭合注入（`)`、换行）
  if (/[)\n\r;]/.test(raw)) return false;
  try {
    const url = new URL(raw);
    return url.protocol === 'http:' || url.protocol === 'https:' || url.protocol === 'asset:';
  } catch {
    return false;
  }
}

/**
 * POSIX shell 单引号转义。
 *
 * 用法：`cd ${shellEscape(path)} && ${userCmd}`
 * 含单引号的字符串正确转义为：`'it'\''s'`
 *
 * 与 Rust 端 `shell_quote` 行为一致 — 用同样的算法在前端做一次预处理，
 * 让 {path} 这类用户控制的占位符即使含恶意字符也不会逃出引号。
 */
export function shellEscape(value: string): string {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

export type TemplateInterpolationMode = 'raw' | 'shell' | 'url';

export interface FileActionTemplateValues {
  path: string;
  dir: string;
  name: string;
  currentPath: string;
}

const TEMPLATE_TOKENS: Record<keyof FileActionTemplateValues, string> = {
  path: '{path}',
  dir: '{dir}',
  name: '{name}',
  currentPath: '{currentPath}',
};

function encodeTemplateValue(value: string, mode: TemplateInterpolationMode): string {
  if (mode === 'shell') return shellEscape(value);
  if (mode === 'url') return encodeURIComponent(value);
  return value;
}

export function interpolateFileActionTemplate(
  template: string,
  values: FileActionTemplateValues,
  mode: TemplateInterpolationMode,
): string {
  let result = String(template);
  for (const key of Object.keys(TEMPLATE_TOKENS) as Array<keyof FileActionTemplateValues>) {
    result = result.replaceAll(TEMPLATE_TOKENS[key], encodeTemplateValue(values[key], mode));
  }
  return result;
}

/**
 * 用户命令片段安全校验。
 *
 * 拒绝列表（必须返 null）：
 * - 命令分隔符：`;` `|` `&` `&&` `||` `\n` `\r`
 * - 命令替换：`$(` `` ` ``
 * - 重定向：`>` `<`（保守起见）
 *
 * 返回值：合法 → trim 后的字符串；非法 → null（前端可以提示用户）。
 *
 * 注意：这是"严格"模式 — 用于自动化路径（无确认即执行）。
 * 用户在设置面板手敲的"高级命令"应走 `confirmExecution` 流程，绕过本检查。
 */
export function validateShellFragment(raw: string): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const forbidden = ['$(', '`', '&&', '||', ';', '|', '&', '>', '<', '\n', '\r'];
  for (const token of forbidden) {
    if (trimmed.includes(token)) return null;
  }
  return trimmed;
}

/**
 * 安全包装 Tauri shell.open：协议不在白名单内则抛错。
 *
 * 调用方应该 try/catch，把错误转化为用户可见的 toast。
 */
export async function safeShellOpen(raw: string): Promise<void> {
  if (!isSafeShellOpenUrl(raw)) {
    throw new Error(`不允许的链接协议：${raw}`);
  }
  await tauriShellOpen(raw);
}
