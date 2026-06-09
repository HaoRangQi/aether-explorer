/**
 * 设置（ThemeSettings）规范化与迁移
 *
 * 从 App.tsx 抽出，使可独立测试。
 *
 * 规范化职责：
 * - 把存储中读出的数据（可能来自旧版本）映射到当前的字段集
 * - 填默认值；过滤已 deprecated 的 contextMenuExtensions
 * - 不修改未识别的字段（向前兼容）
 */

import type {
  ContextMenuAction,
  CustomColorPalettePreset,
  ThemeColorToken,
  ThemeSettings,
} from '../types';
import { ACCENT_COLORS } from '../constants';
import { isSafeShellOpenUrl } from './url-guard';
import {
  AI_OP_HISTORY_DEFAULT_RETENTION_DAYS,
  normalizeOpHistoryRetentionDays,
} from './operation-history';

export const FAVORITES_VIRTUAL_PATH = 'aether://favorites';
export const CURRENT_SETTINGS_VERSION = 3;
export const CURRENT_SETTINGS_BACKUP_SCHEMA_VERSION = 1;

export const DEFAULT_LIGHT_ACCENT = '#789262'; // 竹青
export const DEFAULT_DARK_ACCENT = '#425066';  // 黛蓝
export const DEFAULT_FONT_FAMILY = 'system-ui, sans-serif';

export const THEME_COLOR_TOKENS: ThemeColorToken[] = [
  'colorIcon',
  'colorSelectedFg',
  'colorSelectedBg',
  'colorHoverFg',
  'colorHoverBg',
  'colorPanelBg',
  'colorTextPrimary',
  'colorTextSecondary',
  'colorBorder',
  'colorDivider',
  'colorShadow',
  'colorActiveIconBg',
  'colorTagSelected',
  'colorSearchBg',
  'colorAppBg',
];

const THEME_COLOR_TOKEN_SET = new Set<string>(THEME_COLOR_TOKENS);

function isHexColor(value: unknown): value is string {
  return typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value.trim());
}

function normalizeHexColor(value: unknown): string | undefined {
  return isHexColor(value) ? value.trim() : undefined;
}

export function normalizeCustomColorPalettePresets(value: unknown): CustomColorPalettePreset[] {
  if (!Array.isArray(value)) return [];
  const presets: CustomColorPalettePreset[] = [];
  const seen = new Set<string>();

  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const record = item as Record<string, unknown>;
    const id = typeof record.id === 'string' ? record.id.trim() : '';
    const name = typeof record.name === 'string' ? record.name.trim() : '';
    const accentColor = normalizeHexColor(record.accentColor);
    if (!id || !name || !accentColor || seen.has(id)) continue;

    const colors: Partial<Record<ThemeColorToken, string>> = {};
    if (record.colors && typeof record.colors === 'object' && !Array.isArray(record.colors)) {
      for (const [key, color] of Object.entries(record.colors as Record<string, unknown>)) {
        if (!THEME_COLOR_TOKEN_SET.has(key)) continue;
        const normalizedColor = normalizeHexColor(color);
        if (normalizedColor) colors[key as ThemeColorToken] = normalizedColor;
      }
    }

    seen.add(id);
    presets.push({ id, name, accentColor, colors });
    if (presets.length >= 24) break;
  }

  return presets;
}

export function buildCustomColorPalettePreset({
  name,
  theme,
  now = Date.now(),
}: {
  name: string;
  theme: ThemeSettings;
  now?: number;
}): CustomColorPalettePreset {
  const colors: Partial<Record<ThemeColorToken, string>> = {};
  for (const key of THEME_COLOR_TOKENS) {
    const color = normalizeHexColor(theme[key]);
    if (color) colors[key] = color;
  }

  return {
    id: `custom-${now}`,
    name: name.trim() || 'Custom Palette',
    accentColor: normalizeHexColor(theme.accentColor) || DEFAULT_LIGHT_ACCENT,
    colors,
  };
}

export function applyCustomColorPalettePreset(
  theme: ThemeSettings,
  preset: CustomColorPalettePreset,
): ThemeSettings {
  const [normalizedPreset] = normalizeCustomColorPalettePresets([preset]);
  if (!normalizedPreset) return theme;

  const nextTheme: ThemeSettings = {
    ...theme,
    accentColor: normalizedPreset.accentColor,
  };

  for (const key of THEME_COLOR_TOKENS) {
    nextTheme[key] = normalizedPreset.colors[key];
  }

  return nextTheme;
}

export const DEPRECATED_CONTEXT_EXTENSION_IDS = new Set([
  'open', 'rename', 'copy', 'move', 'share', 'compress',
  'terminal', 'delete', 'tag', 'group', 'ai-scan',
]);

const CONTEXT_ACTION_TYPES = new Set([
  'terminal',
  'shell',
  'url',
  'placeholder',
  'ai-assistant',
  'ai-history',
  'calculate-hash',
]);

function normalizeContextActionType(actionType: unknown): NonNullable<ContextMenuAction['actionType']> {
  return typeof actionType === 'string' && CONTEXT_ACTION_TYPES.has(actionType)
    ? actionType as NonNullable<ContextMenuAction['actionType']>
    : 'placeholder';
}

function normalizeWorkingDirectory(workingDirectory: unknown): NonNullable<ContextMenuAction['workingDirectory']> {
  return workingDirectory === 'current' ? 'current' : 'selection';
}

export const DEFAULT_THEME: ThemeSettings = {
  mode: 'auto',
  accentColor: DEFAULT_LIGHT_ACCENT,
  // 保留品牌视觉的 32px 毛玻璃。性能差的设备可在设置面板里手动调小。
  // 如未来发现"新装用户首屏 GPU 卡顿"再考虑降默认值并加 onboarding 提示。
  blurIntensity: 32,
  transparency: 100,
  enableMica: true,
  enableLiquidGlass: false,
  fontFamily: DEFAULT_FONT_FAMILY,
  gridSize: 180,
  gridWidth: 180,
  gridHeight: 180,
  gridGap: 16,
  mediaGridWidth: 180,
  mediaGridHeight: 180,
  mediaGridLinked: true,
  columnWidth: 280,
  columnHeight: 60,
  showHiddenFiles: false,
  showPreviewPanel: false,
  enableDevTools: false,
  enableMultiWindow: false,
  enableSpacePreview: true,
  crossWindowDropDefault: 'copy',
  aiOpsHistoryRetentionDays: AI_OP_HISTORY_DEFAULT_RETENTION_DAYS,
  showFolderSizeInList: true,
  customColorPalettes: [],
  wallpaperBlur: 0,
  enableGradient: false,
  contextMenuExtensions: [
    {
      id: 'terminal-dev', label: '用终端打开并启动开发', enabled: true,
      actionType: 'terminal', terminalApp: 'Terminal',
      terminalArgs: 'npm run dev', workingDirectory: 'selection', confirmExecution: false,
    },
    {
      id: 'terminal-list', label: '终端列出详细信息', enabled: false,
      actionType: 'terminal', terminalApp: 'Terminal',
      terminalArgs: 'ls -la', workingDirectory: 'selection', confirmExecution: false,
    },
    {
      id: 'ai-assistant', label: 'AI 文件助手', enabled: true,
      actionType: 'ai-assistant', confirmExecution: false, isSystem: true,
    },
    {
      id: 'ai-history', label: '操作历史', enabled: true,
      actionType: 'ai-history', confirmExecution: false, isSystem: true,
    },
    {
      id: 'calculate-hash', label: '计算哈希值', enabled: true,
      actionType: 'calculate-hash', confirmExecution: false, isSystem: true,
    },
  ],
  terminalApp: 'Terminal',
  terminalArgs: '',
  defaultHomePath: FAVORITES_VIRTUAL_PATH,

  // 颜色细化控制默认值（undefined = 使用 CSS 原生变量）
  colorIcon: undefined,
  colorSelectedFg: undefined,
  colorSelectedBg: undefined,
  colorHoverFg: undefined,
  colorHoverBg: undefined,
  colorPanelBg: undefined,
  colorTextPrimary: undefined,
  colorTextSecondary: undefined,
  colorBorder: undefined,
  colorDivider: undefined,
  colorShadow: undefined,
  colorActiveIconBg: undefined,
  colorTagSelected: undefined,
  colorSearchBg: undefined,
  colorAppBg: undefined,

  aiProvider: undefined,
  aiApiKey: undefined,
  aiModel: undefined,
  aiOllamaEndpoint: 'http://localhost:11434',
};

export function normalizeContextMenuExtensions(
  extensions?: ContextMenuAction[],
): ContextMenuAction[] {
  const source = Array.isArray(extensions) ? extensions : [];
  const filtered = source
    .filter((ext): ext is ContextMenuAction => Boolean(ext) && typeof ext === 'object' && !Array.isArray(ext))
    .filter(ext => !DEPRECATED_CONTEXT_EXTENSION_IDS.has(ext.id))
    .map(ext => ({
      ...ext,
      actionType: normalizeContextActionType(ext.actionType),
      workingDirectory: normalizeWorkingDirectory(ext.workingDirectory),
      confirmExecution: ext.confirmExecution ?? true,
    }));

  // 确保系统扩展始终存在（用户可能是从旧版本升级的）
  const systemDefaults = DEFAULT_THEME.contextMenuExtensions!.filter(e => e.isSystem);
  for (const sys of systemDefaults) {
    if (!filtered.find(e => e.id === sys.id)) {
      filtered.push({ ...sys, actionType: sys.actionType || 'placeholder', workingDirectory: normalizeWorkingDirectory(sys.workingDirectory), confirmExecution: sys.confirmExecution ?? false });
    }
  }
  return filtered as ContextMenuAction[];
}

/**
 * defaultHomePath 兜底归一：空 / undefined / null → FAVORITES_VIRTUAL_PATH。
 *
 * 不主动改写用户手选的真实路径（包括他们故意选的 ~/Downloads）—
 * 那是 8.2 的"tagged union"重构才能根治的领域问题，本函数只做最小兜底。
 */
function normalizeDefaultHomePath(raw: string | undefined | null): string {
  if (!raw || typeof raw !== 'string') return FAVORITES_VIRTUAL_PATH;
  const trimmed = raw.trim();
  if (!trimmed) return FAVORITES_VIRTUAL_PATH;
  return trimmed;
}

export interface PersistedThemeSettings extends Partial<ThemeSettings> {
  __version?: number;
}

export function migrateThemeSettings(settings: PersistedThemeSettings): ThemeSettings {
  // 迁移旧版 terminalScripts: string[] → {script, enabled}[]
  let terminalScripts = settings.terminalScripts;
  if (Array.isArray(terminalScripts) && terminalScripts.length > 0 && typeof terminalScripts[0] === 'string') {
    terminalScripts = (terminalScripts as unknown as string[]).map(s => ({ script: s, enabled: true }));
  }
  return {
    ...DEFAULT_THEME,
    ...settings,
    terminalScripts,
    contextMenuExtensions: normalizeContextMenuExtensions(settings.contextMenuExtensions),
    customColorPalettes: normalizeCustomColorPalettePresets(settings.customColorPalettes),
    defaultHomePath: normalizeDefaultHomePath(settings.defaultHomePath),
    aiOpsHistoryRetentionDays: normalizeOpHistoryRetentionDays(settings.aiOpsHistoryRetentionDays),
  };
}

export function normalizeThemeSettings(settings: Partial<ThemeSettings>): ThemeSettings {
  return migrateThemeSettings(settings);
}

export function redactThemeSecrets(settings: ThemeSettings): ThemeSettings {
  return {
    ...settings,
    aiApiKey: undefined,
    aiProviders: settings.aiProviders?.map(provider => ({
      ...provider,
      apiKey: undefined,
    })),
  };
}

export interface ImportedSettingsBackup {
  schemaVersion?: number;
  exportedAt?: string;
  appVersion?: string;
  theme?: ThemeSettings;
  favorites?: string[];
  fileTags?: Record<string, string[]>;
  recentItems?: string[];
}

export interface ExportedSettingsBackup extends ImportedSettingsBackup {
  schemaVersion: typeof CURRENT_SETTINGS_BACKUP_SCHEMA_VERSION;
  exportedAt: string;
  appVersion: string;
}

const THEME_IMPORT_KEYS = new Set<keyof ThemeSettings>([
  'mode',
  'accentColor',
  'blurIntensity',
  'transparency',
  'enableMica',
  'enableLiquidGlass',
  'fontFamily',
  'gridSize',
  'gridWidth',
  'gridHeight',
  'gridGap',
  'mediaGridWidth',
  'mediaGridHeight',
  'mediaGridLinked',
  'columnWidth',
  'columnHeight',
  'showHiddenFiles',
  'showPreviewPanel',
  'enableSpacePreview',
  'enableDevTools',
  'enableMultiWindow',
  'useSystemContextMenu',
  'wallpaperUrl',
  'wallpaperBlur',
  'enableGradient',
  'listDensity',
  'contextMenuExtensions',
  'terminalApp',
  'terminalArgs',
  'terminalScripts',
  'customTerminalCommand',
  'defaultHomePath',
  'crossWindowDropDefault',
  'aiOpsHistoryRetentionDays',
  'showFolderSizeInList',
  'language',
  'followSystemLanguage',
  'languageOptions',
  'customColorPalettes',
  'colorIcon',
  'colorSelectedFg',
  'colorSelectedBg',
  'colorHoverFg',
  'colorHoverBg',
  'colorPanelBg',
  'colorTextPrimary',
  'colorTextSecondary',
  'colorBorder',
  'colorDivider',
  'colorShadow',
  'colorActiveIconBg',
  'colorTagSelected',
  'colorSearchBg',
  'colorAppBg',
  'aiProvider',
  'aiApiKey',
  'aiModel',
  'aiOllamaEndpoint',
  'aiProviders',
  'aiActiveProvider',
]);

const THEME_MODES = new Set(['light', 'dark', 'auto']);
const LIST_DENSITIES = new Set(['relaxed', 'normal', 'compact', 'ultra']);
const CROSS_WINDOW_DROP_DEFAULTS = new Set(['copy', 'move', 'ask']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function pickThemeImportFields(value: Record<string, unknown>): Partial<ThemeSettings> {
  const picked: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (THEME_IMPORT_KEYS.has(key as keyof ThemeSettings)) {
      picked[key] = item;
    }
  }
  return picked as Partial<ThemeSettings>;
}

function sanitizeThemeEnums(settings: Partial<ThemeSettings>): Partial<ThemeSettings> {
  const sanitized = { ...settings };
  if (sanitized.mode !== undefined && !THEME_MODES.has(sanitized.mode)) {
    delete sanitized.mode;
  }
  if (sanitized.listDensity !== undefined && !LIST_DENSITIES.has(sanitized.listDensity)) {
    delete sanitized.listDensity;
  }
  if (
    sanitized.crossWindowDropDefault !== undefined
    && !CROSS_WINDOW_DROP_DEFAULTS.has(sanitized.crossWindowDropDefault)
  ) {
    delete sanitized.crossWindowDropDefault;
  }
  if (sanitized.aiOpsHistoryRetentionDays !== undefined) {
    const raw = Number(sanitized.aiOpsHistoryRetentionDays);
    if (!Number.isFinite(raw)) {
      delete sanitized.aiOpsHistoryRetentionDays;
    } else {
      sanitized.aiOpsHistoryRetentionDays = normalizeOpHistoryRetentionDays(raw);
    }
  }
  return sanitized;
}

function sanitizePathList(value: unknown, limit: number): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string') continue;
    const path = item.trim();
    if (!path || seen.has(path)) continue;
    seen.add(path);
    result.push(path);
    if (result.length >= limit) break;
  }
  return result;
}

function sanitizeFileTags(value: unknown): Record<string, string[]> | undefined {
  if (!isRecord(value)) return undefined;
  const result: Record<string, string[]> = {};
  for (const [path, tags] of Object.entries(value)) {
    if (typeof path !== 'string' || !Array.isArray(tags)) continue;
    const cleanPath = path.trim();
    if (!cleanPath) continue;
    const cleanTags = sanitizePathList(tags, 32);
    if (cleanTags && cleanTags.length > 0) {
      result[cleanPath] = cleanTags;
    }
  }
  return result;
}

function sanitizeContextMenuExtension(ext: ContextMenuAction): ContextMenuAction | null {
  if (typeof ext.id !== 'string' || typeof ext.label !== 'string') return null;
  const id = ext.id.trim();
  const label = ext.label.trim();
  if (!id || !label) return null;
  if (DEPRECATED_CONTEXT_EXTENSION_IDS.has(id)) return null;
  const normalized = { ...ext, id, label };
  if (ext.actionType === 'url') {
    const urlTemplate = typeof ext.urlTemplate === 'string' ? ext.urlTemplate.trim() : '';
    if (!urlTemplate || !isSafeShellOpenUrl(urlTemplate)) return null;
    return { ...normalized, urlTemplate };
  }
  if ((ext.actionType === 'terminal' || ext.actionType === 'shell') && ext.confirmExecution === false) {
    return { ...normalized, confirmExecution: true };
  }
  return normalized;
}

function uniqueContextMenuExtensions(extensions: ContextMenuAction[]): ContextMenuAction[] {
  const seen = new Set<string>();
  return extensions.filter(ext => {
    if (seen.has(ext.id)) return false;
    seen.add(ext.id);
    return true;
  });
}

function sanitizeImportedTheme(value: unknown): ThemeSettings | undefined {
  if (!isRecord(value)) return undefined;
  const normalized = redactThemeSecrets(migrateThemeSettings(sanitizeThemeEnums(pickThemeImportFields(value))));
  return {
    ...normalized,
    contextMenuExtensions: uniqueContextMenuExtensions(
      normalizeContextMenuExtensions(normalized.contextMenuExtensions)
        .map(sanitizeContextMenuExtension)
        .filter((ext): ext is ContextMenuAction => Boolean(ext)),
    ),
  };
}

export function sanitizeImportedContextMenuExtensions(
  value: unknown,
  now = Date.now(),
): ContextMenuAction[] {
  if (!Array.isArray(value)) {
    throw new Error('文件格式不正确');
  }

  const prepared = value
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object' && !Array.isArray(item))
    .map((item, index) => ({
      ...item,
      id: typeof item.id === 'string' && item.id.trim() ? item.id.trim() : `imported-${now}-${index}`,
      enabled: item.enabled !== false,
    })) as ContextMenuAction[];

  return uniqueContextMenuExtensions(
    normalizeContextMenuExtensions(prepared)
      .map(sanitizeContextMenuExtension)
      .filter((ext): ext is ContextMenuAction => Boolean(ext)),
  );
}

export function sanitizeImportedSettingsBackup(value: unknown): ImportedSettingsBackup {
  if (!isRecord(value)) {
    throw new Error('配置文件格式无效');
  }

  const rawSchemaVersion = value.schemaVersion;
  if (
    rawSchemaVersion !== undefined
    && rawSchemaVersion !== CURRENT_SETTINGS_BACKUP_SCHEMA_VERSION
  ) {
    throw new Error(`不支持的配置备份版本：${String(rawSchemaVersion)}`);
  }

  const backup: ImportedSettingsBackup = {};
  backup.schemaVersion = CURRENT_SETTINGS_BACKUP_SCHEMA_VERSION;
  if (typeof value.exportedAt === 'string') backup.exportedAt = value.exportedAt;
  if (typeof value.appVersion === 'string') {
    backup.appVersion = value.appVersion;
  } else if (typeof value.version === 'string') {
    backup.appVersion = value.version;
  }
  const theme = sanitizeImportedTheme(value.theme);
  const favorites = sanitizePathList(value.favorites, 5000);
  const fileTags = sanitizeFileTags(value.fileTags);
  const recentItems = sanitizePathList(value.recentItems, 500);

  if (theme) backup.theme = theme;
  if (favorites) backup.favorites = favorites;
  if (fileTags) backup.fileTags = fileTags;
  if (recentItems) backup.recentItems = recentItems;

  if (!backup.theme && !backup.favorites && !backup.fileTags && !backup.recentItems) {
    throw new Error('配置文件不包含可导入的数据');
  }

  return backup;
}

export function buildSettingsBackup({
  theme,
  favorites,
  fileTags,
  recentItems,
  appVersion,
  now = new Date(),
}: {
  theme: ThemeSettings;
  favorites: string[];
  fileTags: Record<string, string[]>;
  recentItems: string[];
  appVersion: string;
  now?: Date;
}): ExportedSettingsBackup {
  return {
    schemaVersion: CURRENT_SETTINGS_BACKUP_SCHEMA_VERSION,
    exportedAt: now.toISOString(),
    appVersion,
    theme: redactThemeSecrets(theme),
    favorites,
    fileTags,
    recentItems,
  };
}

export function loadThemeFromLocalStorage(): ThemeSettings {
  try {
    const saved = typeof localStorage !== 'undefined' ? localStorage.getItem('theme-settings') : null;
    return saved ? migrateThemeSettings(JSON.parse(saved)) : DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
  }
}
