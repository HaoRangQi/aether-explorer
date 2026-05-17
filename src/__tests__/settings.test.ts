import { describe, it, expect, beforeEach } from 'vitest';
import {
  normalizeThemeSettings,
  normalizeContextMenuExtensions,
  loadThemeFromLocalStorage,
  DEFAULT_THEME,
} from '../lib/settings';
import type { ContextMenuAction, ThemeSettings } from '../types';

describe('normalizeContextMenuExtensions', () => {
  it('returns defaults when given undefined', () => {
    const result = normalizeContextMenuExtensions(undefined);
    expect(result.length).toBeGreaterThan(0);
    expect(result.every(e => !!e.id)).toBe(true);
  });

  it('removes deprecated extension ids', () => {
    const input: ContextMenuAction[] = [
      { id: 'open', label: '旧', enabled: true } as ContextMenuAction,
      { id: 'rename', label: '旧', enabled: true } as ContextMenuAction,
      { id: 'custom-foo', label: '新', enabled: true } as ContextMenuAction,
    ];
    const result = normalizeContextMenuExtensions(input);
    expect(result.map(e => e.id)).toEqual(['custom-foo']);
  });

  it('removes isSystem entries', () => {
    const input: ContextMenuAction[] = [
      { id: 'sys-1', label: 'sys', enabled: true, isSystem: true } as ContextMenuAction,
      { id: 'user-1', label: 'user', enabled: true } as ContextMenuAction,
    ];
    expect(normalizeContextMenuExtensions(input).map(e => e.id)).toEqual(['user-1']);
  });

  it('fills missing fields', () => {
    const result = normalizeContextMenuExtensions([
      { id: 'x', label: 'X', enabled: true } as ContextMenuAction,
    ]);
    expect(result[0].actionType).toBe('placeholder');
    expect(result[0].workingDirectory).toBe('selection');
    expect(result[0].confirmExecution).toBe(true);
  });

  it('preserves existing fields', () => {
    const result = normalizeContextMenuExtensions([
      {
        id: 'x', label: 'X', enabled: true,
        actionType: 'terminal',
        workingDirectory: 'current',
        confirmExecution: false,
      } as ContextMenuAction,
    ]);
    expect(result[0].actionType).toBe('terminal');
    expect(result[0].workingDirectory).toBe('current');
    expect(result[0].confirmExecution).toBe(false);
  });
});

describe('normalizeThemeSettings', () => {
  it('fills defaults for empty input', () => {
    const result = normalizeThemeSettings({});
    expect(result.mode).toBe(DEFAULT_THEME.mode);
    expect(result.accentColor).toBe(DEFAULT_THEME.accentColor);
    expect(result.contextMenuExtensions).toBeDefined();
  });

  it('overrides defaults with provided values', () => {
    const result = normalizeThemeSettings({ mode: 'dark', blurIntensity: 50 });
    expect(result.mode).toBe('dark');
    expect(result.blurIntensity).toBe(50);
    expect(result.transparency).toBe(DEFAULT_THEME.transparency); // 其他保持默认
  });

  it('default blur is 32 (brand visual)', () => {
    const result = normalizeThemeSettings({});
    expect(result.blurIntensity).toBe(32);
  });

  it('default crossWindowDropDefault is copy', () => {
    const result = normalizeThemeSettings({});
    expect(result.crossWindowDropDefault).toBe('copy');
  });

  it('default enableSpacePreview is true', () => {
    const result = normalizeThemeSettings({});
    expect(result.enableSpacePreview).toBe(true);
  });
});

describe('loadThemeFromLocalStorage', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('returns DEFAULT_THEME when nothing saved', () => {
    const result = loadThemeFromLocalStorage();
    expect(result).toEqual(DEFAULT_THEME);
  });

  it('returns parsed and normalized theme', () => {
    const saved: Partial<ThemeSettings> = { mode: 'dark', blurIntensity: 42 };
    localStorage.setItem('theme-settings', JSON.stringify(saved));
    const result = loadThemeFromLocalStorage();
    expect(result.mode).toBe('dark');
    expect(result.blurIntensity).toBe(42);
  });

  it('returns DEFAULT_THEME on parse error', () => {
    localStorage.setItem('theme-settings', '{not valid json');
    expect(loadThemeFromLocalStorage()).toEqual(DEFAULT_THEME);
  });
});
