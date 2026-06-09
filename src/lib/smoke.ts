/**
 * Runtime evidence helpers and dev-only smoke checks，挂在 window.__aether
 *
 * 在 DevTools 控制台调用 `window.__aether.smoke()` 可一键自检 10+ 隐式假设。
 * `window.__aether.permissionEvidence()` 可在发版候选中采集 FDA 验收证据。
 */

import type { ThemeSettings } from '../types';
import {
  collectFullDiskAccessAcceptanceEvidence,
  validateFullDiskAccessSmokeResult,
} from './full-disk-access-evidence';
export {
  collectFullDiskAccessAcceptanceEvidence,
  validateFullDiskAccessAcceptanceEvidence,
  validateFullDiskAccessSmokeResult,
} from './full-disk-access-evidence';

interface SmokeResult {
  ok: boolean;
  total: number;
  failed: Array<{ name: string; err: string }>;
  table: Array<{ check: string; ok: boolean; err?: string }>;
}

type Check = [name: string, fn: () => boolean | Promise<boolean>];

function setupAetherSmokeDevtools() {
  if (!import.meta.env.DEV) return;

  const checks: Check[] = [
    ['theme css var loaded', () =>
      !!document.documentElement.style.getPropertyValue('--primary')
      || !!getComputedStyle(document.documentElement).getPropertyValue('--primary'),
    ],
    ['document has lang attr', () => !!document.documentElement.lang],
    ['root element mounted', () => !!document.getElementById('root')?.children.length],

    ['settings.json store loadable', async () => {
      const { load } = await import('@tauri-apps/plugin-store');
      const s = await load('settings.json', { autoSave: true, defaults: {} });
      return !!s;
    }],

    ['get_home_dir works', async () => {
      const { invoke } = await import('@tauri-apps/api/core');
      const home = await invoke<string>('get_home_dir');
      return typeof home === 'string' && home.startsWith('/');
    }],

    ['full_disk_access_status returns status/probes', async () => {
      const { invoke } = await import('@tauri-apps/api/core');
      const result = await invoke<{ status: string; probes: unknown[] }>('full_disk_access_status');
      return validateFullDiskAccessSmokeResult(result);
    }],

    ['list_directory($HOME) returns array', async () => {
      const { invoke } = await import('@tauri-apps/api/core');
      const home = await invoke<string>('get_home_dir');
      const entries = await invoke<unknown[]>('list_directory', { dirPath: home, showHidden: false });
      return Array.isArray(entries);
    }],

    ['get_child_count works', async () => {
      const { invoke } = await import('@tauri-apps/api/core');
      const home = await invoke<string>('get_home_dir');
      const count = await invoke<number>('get_child_count', { path: home, showHidden: false });
      return typeof count === 'number' && count >= 0;
    }],

    ['list_volumes returns at least root', async () => {
      const { invoke } = await import('@tauri-apps/api/core');
      const volumes = await invoke<Array<{ path: string }>>('list_volumes');
      return Array.isArray(volumes) && volumes.some(v => v.path === '/');
    }],

    ['localStorage theme-settings is parseable', () => {
      const raw = localStorage.getItem('theme-settings');
      if (!raw) return true; // 没存过也算 ok
      try { JSON.parse(raw); return true; } catch { return false; }
    }],

    ['theme has expected required fields', () => {
      const raw = localStorage.getItem('theme-settings');
      if (!raw) return true;
      const t = JSON.parse(raw) as Partial<ThemeSettings>;
      return ['mode', 'accentColor', 'transparency'].every(k => k in t);
    }],

    ['url-guard rejects javascript:', async () => {
      const { isSafeShellOpenUrl } = await import('./url-guard');
      return !isSafeShellOpenUrl('javascript:alert(1)');
    }],

    ['url-guard accepts https', async () => {
      const { isSafeShellOpenUrl } = await import('./url-guard');
      return isSafeShellOpenUrl('https://example.com');
    }],

    ['shellEscape wraps content', async () => {
      const { shellEscape } = await import('./url-guard');
      return shellEscape("it's") === "'it'\\''s'";
    }],

    ['raise_window_at command registered', async () => {
      const { invoke } = await import('@tauri-apps/api/core');
      // 调一次随便的坐标，不命中也不应抛 unknown-command
      await invoke('raise_window_at', {
        screenX: -1000, screenY: -1000, exceptWindow: 'nonexistent',
      });
      return true;
    }],

    ['Tauri current window has a label', async () => {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      return !!getCurrentWindow().label;
    }],
  ];

  const smoke = async (): Promise<SmokeResult> => {
    const results = await Promise.all(checks.map(async ([name, fn]): Promise<[string, boolean, string?]> => {
      try {
        const ok = await fn();
        return [name, !!ok];
      } catch (e) {
        return [name, false, String(e)];
      }
    }));

    const failed = results
      .filter(r => !r[1])
      .map(r => ({ name: r[0], err: r[2] || '(falsy)' }));

    const table = results.map(r => ({
      check: r[0],
      ok: r[1],
      ...(r[2] ? { err: r[2] } : {}),
    }));

    const result = { ok: failed.length === 0, total: results.length, failed, table };

    console.group(`%cAether smoke ${result.ok ? '✅ PASS' : '❌ FAIL'}`,
      `color: ${result.ok ? '#27c93f' : '#ff5f56'}; font-weight: bold;`);
    console.table(table);
    if (failed.length) console.error('failed checks:', failed);
    console.groupEnd();

    return result;
  };

  const target = window as unknown as { __aether?: Record<string, unknown> };
  target.__aether = {
    ...(target.__aether ?? {}),
    smoke,
  };
  console.info('[aether] DevTools smoke ready — run `window.__aether.smoke()`. FDA evidence is available via `window.__aether.permissionEvidence()`.');
}

function setupAetherPermissionEvidence() {
  const target = window as unknown as { __aether?: Record<string, unknown> };
  target.__aether = {
    ...(target.__aether ?? {}),
    permissionEvidence: collectFullDiskAccessAcceptanceEvidence,
  };
}

setupAetherSmokeDevtools();
setupAetherPermissionEvidence();
