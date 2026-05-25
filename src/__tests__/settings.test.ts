import { describe, it, expect, beforeEach } from 'vitest';
import {
  CURRENT_SETTINGS_BACKUP_SCHEMA_VERSION,
  CURRENT_SETTINGS_VERSION,
  buildSettingsBackup,
  normalizeThemeSettings,
  normalizeContextMenuExtensions,
  migrateThemeSettings,
  loadThemeFromLocalStorage,
  redactThemeSecrets,
  sanitizeImportedContextMenuExtensions,
  sanitizeImportedSettingsBackup,
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
    // deprecated ids 被过滤，系统扩展被补全
    expect(result.some(e => e.id === 'open')).toBe(false);
    expect(result.some(e => e.id === 'custom-foo')).toBe(true);
    expect(result.some(e => e.id === 'ai-assistant')).toBe(true);
    expect(result.some(e => e.id === 'ai-history')).toBe(true);
  });

  it('preserves isSystem entries and injects missing system extensions', () => {
    const input: ContextMenuAction[] = [
      { id: 'ai-assistant', label: 'AI 文件助手', enabled: false, isSystem: true } as ContextMenuAction,
      { id: 'user-1', label: 'user', enabled: true } as ContextMenuAction,
    ];
    const result = normalizeContextMenuExtensions(input);
    // isSystem 不再被过滤
    expect(result.some(e => e.id === 'ai-assistant')).toBe(true);
    expect(result.some(e => e.id === 'user-1')).toBe(true);
    // 缺失的 ai-history 被补全
    expect(result.some(e => e.id === 'ai-history')).toBe(true);
  });

  it('fills missing fields', () => {
    const result = normalizeContextMenuExtensions([
      { id: 'x', label: 'X', enabled: true } as ContextMenuAction,
      {
        id: 'invalid-working-directory',
        label: 'Invalid working directory',
        enabled: true,
        workingDirectory: 'downloads',
      } as unknown as ContextMenuAction,
    ]);
    expect(result[0].actionType).toBe('placeholder');
    expect(result[0].workingDirectory).toBe('selection');
    expect(result[0].confirmExecution).toBe(true);
    expect(result.find(ext => ext.id === 'invalid-working-directory')?.workingDirectory).toBe('selection');
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

  it('default enableMultiWindow is false', () => {
    const result = normalizeThemeSettings({});
    expect(result.enableMultiWindow).toBe(false);
  });

  it('falls back to favorites when default home path is blank', () => {
    expect(normalizeThemeSettings({ defaultHomePath: '' }).defaultHomePath).toBe('aether://favorites');
    expect(normalizeThemeSettings({ defaultHomePath: '   ' }).defaultHomePath).toBe('aether://favorites');
  });
});

describe('migrateThemeSettings', () => {
  it('migrates legacy terminalScripts string arrays', () => {
    const result = migrateThemeSettings({
      __version: 1,
      terminalScripts: ['npm run dev', 'npm test'] as unknown as ThemeSettings['terminalScripts'],
    });

    expect(CURRENT_SETTINGS_VERSION).toBe(3);
    expect(result.terminalScripts).toEqual([
      { script: 'npm run dev', enabled: true },
      { script: 'npm test', enabled: true },
    ]);
  });

  it('fills enableMultiWindow for legacy settings', () => {
    const result = migrateThemeSettings({
      __version: 2,
      mode: 'dark',
    });

    expect(result.enableMultiWindow).toBe(false);
  });

  it('preserves persisted enableMultiWindow through migration', () => {
    const result = migrateThemeSettings({
      __version: 3,
      enableMultiWindow: true,
    });

    expect(result.enableMultiWindow).toBe(true);
  });

  it('keeps persisted context menu extensions through migration', () => {
    const result = migrateThemeSettings({
      __version: 1,
      contextMenuExtensions: [
        {
          id: 'custom-terminal',
          label: 'Custom Terminal',
          enabled: true,
          actionType: 'terminal',
          terminalArgs: 'npm run dev',
          workingDirectory: 'current',
          confirmExecution: false,
        },
      ],
    });

    expect(result.contextMenuExtensions?.some(ext => ext.id === 'custom-terminal')).toBe(true);
    expect(result.contextMenuExtensions?.find(ext => ext.id === 'custom-terminal')?.confirmExecution).toBe(false);
  });
});

describe('redactThemeSecrets', () => {
  it('removes legacy and provider API keys before localStorage persistence', () => {
    const theme = normalizeThemeSettings({
      aiApiKey: 'legacy-secret',
      aiProviders: [
        {
          id: 'openai',
          name: 'OpenAI',
          type: 'openai',
          apiKey: 'provider-secret',
          model: 'gpt-4o',
          enabled: true,
        },
      ],
    });

    const result = redactThemeSecrets(theme);

    expect(result.aiApiKey).toBeUndefined();
    expect(result.aiProviders?.[0].apiKey).toBeUndefined();
    expect(result.aiProviders?.[0].model).toBe('gpt-4o');
  });
});

describe('sanitizeImportedSettingsBackup', () => {
  it('rejects non-object backups', () => {
    expect(() => sanitizeImportedSettingsBackup(null)).toThrow('配置文件格式无效');
    expect(() => sanitizeImportedSettingsBackup([])).toThrow('配置文件格式无效');
  });

  it('normalizes theme and redacts imported AI secrets', () => {
    const result = sanitizeImportedSettingsBackup({
      theme: {
        mode: 'invalid-mode',
        listDensity: 'tiny',
        crossWindowDropDefault: 'teleport',
        enableMultiWindow: true,
        unknownInjectedField: 'should-not-survive',
        aiApiKey: 'legacy-secret',
        aiProviders: [
          {
            id: 'openai',
            name: 'OpenAI',
            type: 'openai',
            apiKey: 'provider-secret',
            enabled: true,
          },
        ],
        contextMenuExtensions: 'not-an-array',
      },
    });

    expect(result.theme?.mode).toBe(DEFAULT_THEME.mode);
    expect(result.theme?.listDensity).toBe(DEFAULT_THEME.listDensity);
    expect(result.theme?.crossWindowDropDefault).toBe(DEFAULT_THEME.crossWindowDropDefault);
    expect(result.theme?.enableMultiWindow).toBe(true);
    expect((result.theme as ThemeSettings & { unknownInjectedField?: string })?.unknownInjectedField).toBeUndefined();
    expect(result.theme?.aiApiKey).toBeUndefined();
    expect(result.theme?.aiProviders?.[0].apiKey).toBeUndefined();
    expect(result.theme?.contextMenuExtensions?.some(ext => ext.id === 'ai-assistant')).toBe(true);
    expect(result.theme?.contextMenuExtensions?.some(ext => ext.id === 'ai-history')).toBe(true);
  });

  it('accepts current backup schema and maps legacy app version field', () => {
    const result = sanitizeImportedSettingsBackup({
      schemaVersion: CURRENT_SETTINGS_BACKUP_SCHEMA_VERSION,
      version: '0.3.11',
      exportedAt: '2026-05-25T00:00:00.000Z',
      favorites: ['/Users/example/Documents'],
    });

    expect(result.schemaVersion).toBe(CURRENT_SETTINGS_BACKUP_SCHEMA_VERSION);
    expect(result.appVersion).toBe('0.3.11');
    expect(result.exportedAt).toBe('2026-05-25T00:00:00.000Z');
    expect(result.favorites).toEqual(['/Users/example/Documents']);
  });

  it('rejects unsupported backup schema versions', () => {
    expect(() => sanitizeImportedSettingsBackup({
      schemaVersion: CURRENT_SETTINGS_BACKUP_SCHEMA_VERSION + 1,
      favorites: ['/a'],
    })).toThrow('不支持的配置备份版本');
  });

  it('filters unsafe URL extensions and forces confirmation for command extensions', () => {
    const result = sanitizeImportedSettingsBackup({
      theme: {
        contextMenuExtensions: [
          null,
          'bad-extension',
          {
            id: 'safe-url',
            label: 'Safe URL',
            enabled: true,
            actionType: 'url',
            urlTemplate: ' https://example.com?q={name} ',
          },
          {
            id: ' open ',
            label: 'Deprecated Open',
            enabled: true,
            actionType: 'terminal',
          },
          {
            id: 'blank-url',
            label: 'Blank URL',
            enabled: true,
            actionType: 'url',
            urlTemplate: '   ',
          },
          {
            id: 'unsafe-url',
            label: 'Unsafe URL',
            enabled: true,
            actionType: 'url',
            urlTemplate: 'javascript:alert(1)',
          },
          {
            id: ' terminal-no-confirm ',
            label: ' Terminal ',
            enabled: true,
            actionType: 'terminal',
            terminalArgs: 'npm run dev',
            confirmExecution: false,
          },
          {
            id: 'terminal-no-confirm',
            label: 'Duplicate Terminal',
            enabled: true,
            actionType: 'terminal',
            terminalArgs: 'npm run duplicate',
          },
          {
            id: 'unknown-action',
            label: 'Unknown',
            enabled: true,
            actionType: 'unknown-action',
            workingDirectory: 'downloads',
          },
        ],
      },
    });

    const extensions = result.theme?.contextMenuExtensions || [];
    expect(extensions.some(ext => ext.id === 'safe-url')).toBe(true);
    expect(extensions.find(ext => ext.id === 'safe-url')?.urlTemplate).toBe('https://example.com?q={name}');
    expect(extensions.some(ext => ext.id === 'blank-url')).toBe(false);
    expect(extensions.some(ext => ext.id === 'unsafe-url')).toBe(false);
    expect(extensions.some(ext => ext.id === 'bad-extension')).toBe(false);
    expect(extensions.some(ext => ext.id === 'open')).toBe(false);
    expect(extensions.find(ext => ext.id === 'terminal-no-confirm')?.confirmExecution).toBe(true);
    expect(extensions.find(ext => ext.id === 'terminal-no-confirm')?.label).toBe('Terminal');
    expect(extensions.filter(ext => ext.id === 'terminal-no-confirm')).toHaveLength(1);
    expect(extensions.find(ext => ext.id === 'unknown-action')?.actionType).toBe('placeholder');
    expect(extensions.find(ext => ext.id === 'unknown-action')?.workingDirectory).toBe('selection');

    const standalone = sanitizeImportedContextMenuExtensions([
      null,
      'bad-extension',
      {
        label: 'Missing ID',
        enabled: true,
        actionType: 'unknown-action',
      },
      {
        id: 'unsafe-url',
        label: 'Unsafe URL',
        enabled: true,
        actionType: 'url',
        urlTemplate: 'javascript:alert(1)',
      },
      {
        id: ' rename ',
        label: 'Deprecated Rename',
        enabled: true,
        actionType: 'terminal',
      },
      {
        id: 'blank-url',
        label: 'Blank URL',
        enabled: true,
        actionType: 'url',
        urlTemplate: '',
      },
      {
        id: ' shell-no-confirm ',
        label: ' Shell ',
        enabled: true,
        actionType: 'shell',
        command: 'npm test',
        confirmExecution: false,
      },
      {
        id: 'shell-no-confirm',
        label: 'Duplicate Shell',
        enabled: true,
        actionType: 'shell',
        command: 'npm run duplicate',
      },
    ], 12345);

    expect(standalone.some(ext => ext.id === 'unsafe-url')).toBe(false);
    expect(standalone.some(ext => ext.id === 'rename')).toBe(false);
    expect(standalone.some(ext => ext.id === 'blank-url')).toBe(false);
    expect(standalone.find(ext => ext.id === 'imported-12345-0')?.actionType).toBe('placeholder');
    expect(standalone.find(ext => ext.id === 'shell-no-confirm')?.confirmExecution).toBe(true);
    expect(standalone.find(ext => ext.id === 'shell-no-confirm')?.label).toBe('Shell');
    expect(standalone.filter(ext => ext.id === 'shell-no-confirm')).toHaveLength(1);
    expect(standalone.some(ext => ext.id === 'ai-assistant')).toBe(true);
    expect(standalone.some(ext => ext.id === 'ai-history')).toBe(true);
    expect(() => sanitizeImportedContextMenuExtensions({})).toThrow('文件格式不正确');
  });

  it('sanitizes favorites, recent items, and file tags', () => {
    const result = sanitizeImportedSettingsBackup({
      favorites: ['/a', ' /b ', '/a', '', 1],
      recentItems: ['/recent', '/recent', null],
      fileTags: {
        '/a': ['tag-red', '', 'tag-blue', 'tag-red'],
        '': ['tag-red'],
        '/bad': 'tag-red',
      },
    });

    expect(result.favorites).toEqual(['/a', '/b']);
    expect(result.recentItems).toEqual(['/recent']);
    expect(result.fileTags).toEqual({ '/a': ['tag-red', 'tag-blue'] });
  });

  it('throws when backup has no importable data', () => {
    expect(() => sanitizeImportedSettingsBackup({ theme: null, favorites: 'x' })).toThrow('配置文件不包含可导入的数据');
  });
});

describe('buildSettingsBackup', () => {
  it('exports a versioned backup and redacts secrets', () => {
    const theme = normalizeThemeSettings({
      mode: 'dark',
      aiApiKey: 'legacy-secret',
      aiProviders: [
        {
          id: 'openai',
          name: 'OpenAI',
          type: 'openai',
          apiKey: 'provider-secret',
          enabled: true,
        },
      ],
    });

    const result = buildSettingsBackup({
      theme,
      favorites: ['/a'],
      fileTags: { '/a': ['tag-red'] },
      recentItems: ['/b'],
      appVersion: '0.3.11',
      now: new Date('2026-05-25T00:00:00.000Z'),
    });

    expect(result.schemaVersion).toBe(CURRENT_SETTINGS_BACKUP_SCHEMA_VERSION);
    expect(result.exportedAt).toBe('2026-05-25T00:00:00.000Z');
    expect(result.appVersion).toBe('0.3.11');
    expect(result.theme.aiApiKey).toBeUndefined();
    expect(result.theme.aiProviders?.[0].apiKey).toBeUndefined();
    expect(result.favorites).toEqual(['/a']);
    expect(result.fileTags).toEqual({ '/a': ['tag-red'] });
    expect(result.recentItems).toEqual(['/b']);
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
