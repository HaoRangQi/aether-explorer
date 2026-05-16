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

import type { ContextMenuAction, ThemeSettings } from '../types';
import { ACCENT_COLORS } from '../constants';

export const FAVORITES_VIRTUAL_PATH = 'aether://favorites';

export const DEPRECATED_CONTEXT_EXTENSION_IDS = new Set([
  'open', 'rename', 'copy', 'move', 'share', 'compress',
  'terminal', 'delete', 'tag', 'group',
]);

export const DEFAULT_THEME: ThemeSettings = {
  mode: 'auto',
  accentColor: ACCENT_COLORS[0],
  blurIntensity: 0,
  transparency: 100,
  enableMica: true,
  fontFamily: 'Inter',
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
  enableSpacePreview: true,
  crossWindowDropDefault: 'copy',
  wallpaperBlur: 0,
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
      id: 'ai-scan', label: 'AI 智能扫描', enabled: false,
      actionType: 'placeholder', confirmExecution: false,
    },
  ],
  terminalApp: 'Terminal',
  terminalArgs: '',
  defaultHomePath: FAVORITES_VIRTUAL_PATH,
};

export function normalizeContextMenuExtensions(
  extensions?: ContextMenuAction[],
): ContextMenuAction[] {
  return (extensions || DEFAULT_THEME.contextMenuExtensions || [])
    .filter(ext => !ext.isSystem && !DEPRECATED_CONTEXT_EXTENSION_IDS.has(ext.id))
    .map(ext => ({
      ...ext,
      actionType: ext.actionType || 'placeholder',
      workingDirectory: ext.workingDirectory || 'selection',
      confirmExecution: ext.confirmExecution ?? true,
    }));
}

export function normalizeThemeSettings(settings: Partial<ThemeSettings>): ThemeSettings {
  return {
    ...DEFAULT_THEME,
    ...settings,
    contextMenuExtensions: normalizeContextMenuExtensions(settings.contextMenuExtensions),
  };
}

export function loadThemeFromLocalStorage(): ThemeSettings {
  try {
    const saved = typeof localStorage !== 'undefined' ? localStorage.getItem('theme-settings') : null;
    return saved ? normalizeThemeSettings(JSON.parse(saved)) : DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
  }
}
