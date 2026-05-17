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
  // 保留品牌视觉的 32px 毛玻璃。性能差的设备可在设置面板里手动调小。
  // 如未来发现"新装用户首屏 GPU 卡顿"再考虑降默认值并加 onboarding 提示。
  blurIntensity: 32,
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

export function normalizeThemeSettings(settings: Partial<ThemeSettings>): ThemeSettings {
  return {
    ...DEFAULT_THEME,
    ...settings,
    contextMenuExtensions: normalizeContextMenuExtensions(settings.contextMenuExtensions),
    defaultHomePath: normalizeDefaultHomePath(settings.defaultHomePath),
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
