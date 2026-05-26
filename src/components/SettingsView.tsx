import React, { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Sun, Moon, Zap, Sliders, Check, Image as ImageIcon, Languages, Upload, Type, Eye, EyeOff, Monitor, Palette, HardDrive, Shield, Puzzle, Layout, Trash2, Plus, Settings2, Sparkles, Wand2, ChevronRight, ChevronDown, Grid2X2, Columns, List, Terminal, Info, RefreshCw, DownloadCloud, BadgeCheck, ExternalLink, Code2, Pencil, FileUp, FileDown, Copy, Folder, X, Loader2, RotateCw, ArrowRightLeft, HelpCircle, File as FileIcon, Search, FileText, History } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { confirm as tauriConfirm, open, save } from '@tauri-apps/plugin-dialog';
import { invoke, convertFileSrc } from '@tauri-apps/api/core';
import { getVersion } from '@tauri-apps/api/app';
import { readTextFile, writeTextFile } from '@tauri-apps/plugin-fs';
import { isValidWallpaperUrl, safeShellOpen } from '../lib/url-guard';
import { normalizeAppError } from '../lib/app-error';
import { check } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';
import { ThemeSettings, ContextMenuAction, LanguageOption, AIProviderConfig } from '../types';
import { ACCENT_COLORS } from '../constants';
import {
  DEFAULT_THEME,
  DEFAULT_LIGHT_ACCENT,
  DEFAULT_DARK_ACCENT,
  buildSettingsBackup,
  sanitizeImportedContextMenuExtensions,
  sanitizeImportedSettingsBackup,
} from '../lib/settings';
import { testProviderConnection, fetchModels, getProviderApiUrl } from '../lib/ai-service';
import type { ImportedSettingsBackup } from '../lib/settings';

interface SettingsViewProps {
  theme: ThemeSettings;
  onThemeChange: (theme: ThemeSettings) => void;
  initialCategory?: SettingsCategory;
  favorites?: string[];
  fileTags?: Record<string, string[]>;
  recentItems?: string[];
  onImport?: (data: { theme?: ThemeSettings; favorites?: string[]; fileTags?: Record<string, string[]>; recentItems?: string[] }) => void;
  onResetAllData?: () => void;
  /** 用户在设置内点了"恢复我的收藏"后，App 把 view 切到首页 tab 给即时反馈 */
  onNavigateToHome?: () => void;
}

export type SettingsCategory = 'appearance' | 'files' | 'permissions' | 'extensions' | 'features' | 'ai' | 'about';

type NativeLiquidGlassStatus = {
  requested: boolean;
  supported: boolean;
  applied: boolean;
  reason?: string | null;
};

type ResolvedAppearance = 'light' | 'dark';

function resolveCurrentAppearance(mode: ThemeSettings['mode']): ResolvedAppearance {
  if (mode !== 'auto') return mode;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

const CURATED_PALETTES = [
  { name: 'Default', colors: ['#007aff', '#EBE0FF', '#FFD8E4', '#C2E7FF'] },
  { name: 'Aurora', colors: ['#5eead4', '#2dd4bf', '#0d9488', '#042f2e'] },
  { name: 'Sunset', colors: ['#fb923c', '#f97316', '#ea580c', '#7c2d12'] },
  { name: 'Lavender', colors: ['#a78bfa', '#8b5cf6', '#7c3aed', '#4c1d95'] },
  { name: 'Forest', colors: ['#4ade80', '#22c55e', '#16a34a', '#14532d'] },
  { name: 'Ocean', colors: ['#38bdf8', '#0ea5e9', '#0284c7', '#0c4a6e'] },
  { name: 'Midnight', colors: ['#6366f1', '#4f46e5', '#4338ca', '#312e81'] },
  { name: 'Ruby', colors: ['#fb7185', '#f43f5e', '#e11d48', '#881337'] },
];

const CHINESE_COLOR_PALETTES = [
  { name: '胭脂', colors: ['#C04851', '#E3A6A1', '#F2D7D5', '#7C1823'] },
  { name: '黛蓝', colors: ['#425066', '#2F4056', '#8AA4BE', '#D8E3E7'] },
  { name: '竹青', colors: ['#789262', '#A4CAB6', '#D8E8D1', '#2B5B45'] },
  { name: '缃叶', colors: ['#ECD452', '#F8E9A1', '#B9A449', '#5B4D16'] },
  { name: '霁青', colors: ['#63BBD0', '#B8E5E3', '#2E8A99', '#164C5A'] },
  { name: '紫棠', colors: ['#56004F', '#8B2671', '#C57BA3', '#F0D5E5'] },
  { name: '藕荷', colors: ['#A7535A', '#D6A0A6', '#F0D7DA', '#6E3338'] },
  { name: '秋香', colors: ['#D9B611', '#F1D86A', '#FFF4B8', '#7A5C00'] },
];

const BUILT_IN_LANGUAGES: LanguageOption[] = [
  { code: 'zh', label: '简体中文', nativeLabel: '简体中文', source: 'built-in', completeness: 100, enabled: true },
  { code: 'en', label: 'English', nativeLabel: 'English', source: 'built-in', completeness: 100, enabled: true },
];

const AVAILABLE_LANGUAGE_SLOTS: LanguageOption[] = [
  { code: 'ja', label: 'Japanese', nativeLabel: '日本語', source: 'available', completeness: 0, enabled: false },
  { code: 'ko', label: 'Korean', nativeLabel: '한국어', source: 'available', completeness: 0, enabled: false },
  { code: 'de', label: 'German', nativeLabel: 'Deutsch', source: 'available', completeness: 0, enabled: false },
];

const ISSUE_URL = 'https://github.com/HaoRangQi/aether-explorer/issues/new/choose';

const CORE_CONTEXT_ACTIONS = ['open', 'rename', 'copyTo', 'moveTo', 'compress', 'decompress', 'quickLook', 'revealInFinder', 'copyPath', 'openTerminal', 'trash'] as const;

const ACTION_TYPE_ICONS = {
  terminal: Terminal,
  shell: Code2,
  url: ExternalLink,
  placeholder: Sparkles,
  'ai-assistant': Sparkles,
  'ai-history': Sparkles,
} satisfies Record<NonNullable<ContextMenuAction['actionType']>, React.ComponentType<{ className?: string }>>;

type UpdateStatus = {
  state: 'idle' | 'checking' | 'current' | 'available' | 'downloading' | 'installing' | 'restarting' | 'error';
  currentVersion: string;
  latestVersion: string;
  releaseUrl?: string;
  notes?: string;
  pubDate?: string;
  downloaded: number;
  contentLength: number;
  message: string;
};

type DiagnosticsStatus = {
  loading: boolean;
  message: string;
  kind: 'idle' | 'ok' | 'error';
};

type BackupStatus = {
  loading: boolean;
  message: string;
  kind: 'idle' | 'ok' | 'error';
};

const DEFAULT_UPDATE_STATUS: UpdateStatus = {
  state: 'idle',
  currentVersion: '',
  latestVersion: '',
  releaseUrl: '',
  notes: '',
  pubDate: '',
  downloaded: 0,
  contentLength: 0,
  message: '尚未检查更新。',
};

const DEFAULT_DIAGNOSTICS_STATUS: DiagnosticsStatus = {
  loading: false,
  message: '',
  kind: 'idle',
};

const DEFAULT_BACKUP_STATUS: BackupStatus = {
  loading: false,
  message: '',
  kind: 'idle',
};

const AI_HISTORY_RETENTION_OPTIONS = [3, 7, 15, 30, 90];

function formatBytes(bytes: number): string {
  if (!bytes || bytes < 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value >= 100 || unit === 0 ? 0 : 1)} ${units[unit]}`;
}

function countFileTagEntries(fileTags?: Record<string, string[]>): number {
  return fileTags ? Object.keys(fileTags).length : 0;
}

export default function SettingsView({ theme, onThemeChange, initialCategory = 'appearance', favorites = [], fileTags = {}, recentItems = [], onImport, onResetAllData, onNavigateToHome }: SettingsViewProps) {
  const { t, i18n } = useTranslation();
  const [activeCategory, setActiveCategory] = useState<SettingsCategory>(initialCategory);
  const [availableFonts, setAvailableFonts] = useState<string[]>(['Inter', 'System Default', 'Arial', 'Segoe UI', 'Roboto', 'Times New Roman']);
  const [terminalApps, setTerminalApps] = useState<string[]>(['Terminal', 'iTerm']);
  const [newActionLabel, setNewActionLabel] = useState('');
  const [newActionType, setNewActionType] = useState<NonNullable<ContextMenuAction['actionType']>>('terminal');
  const [newTerminalApp, setNewTerminalApp] = useState(theme.terminalApp || 'Terminal');
  const [newTerminalArgs, setNewTerminalArgs] = useState('');
  const [newCommand, setNewCommand] = useState('');
  const [newUrlTemplate, setNewUrlTemplate] = useState('');
  const [newWorkingDirectory, setNewWorkingDirectory] = useState<'selection' | 'current'>('selection');
  const [editingExtensionId, setEditingExtensionId] = useState<string | null>(null);
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>(DEFAULT_UPDATE_STATUS);
  const [appVersion, setAppVersion] = useState(import.meta.env.VITE_APP_VERSION || '');
  const [showLanguageManager, setShowLanguageManager] = useState(false);
  const [showMediaGridControls, setShowMediaGridControls] = useState(false);
  const [cleanupStatus, setCleanupStatus] = useState<{ cleaning: boolean; message: string }>({ cleaning: false, message: '' });
  const [diagnosticsStatus, setDiagnosticsStatus] = useState<DiagnosticsStatus>(DEFAULT_DIAGNOSTICS_STATUS);
  const [backupStatus, setBackupStatus] = useState<BackupStatus>(DEFAULT_BACKUP_STATUS);
  const [lastPanicLog, setLastPanicLog] = useState<string | null>(null);
  const [wallpaperUrlError, setWallpaperUrlError] = useState('');
  const [wallpaperUrlDraft, setWallpaperUrlDraft] = useState(theme.wallpaperUrl || '');
  const [liquidGlassStatus, setLiquidGlassStatus] = useState<NativeLiquidGlassStatus | null>(null);
  const [liquidGlassMessage, setLiquidGlassMessage] = useState('');
  const [isTogglingLiquidGlass, setIsTogglingLiquidGlass] = useState(false);

  const getActionTypeMeta = useCallback((type: NonNullable<ContextMenuAction['actionType']>) => ({
    label: t(`settings.extensions.actionTypes.${type}.label`),
    description: t(`settings.extensions.actionTypes.${type}.description`),
    icon: ACTION_TYPE_ICONS[type],
  }), [t]);

  useEffect(() => {
    setActiveCategory(initialCategory);
  }, [initialCategory]);

  const buildImportConfirmMessage = useCallback((backup: ImportedSettingsBackup): string => {
    const lines: string[] = [];
    if (backup.theme) {
      lines.push(t('settings.importConfirm.theme'));
    }
    if (backup.favorites) {
      lines.push(t('settings.importConfirm.favorites', {
        imported: backup.favorites.length,
        current: favorites.length,
      }));
    }
    if (backup.fileTags) {
      lines.push(t('settings.importConfirm.fileTags', {
        imported: countFileTagEntries(backup.fileTags),
        current: countFileTagEntries(fileTags),
      }));
    }
    if (backup.recentItems) {
      lines.push(t('settings.importConfirm.recentItems', {
        imported: backup.recentItems.length,
        current: recentItems.length,
      }));
    }

    return [
      t('settings.importConfirm.title'),
      '',
      t('settings.importConfirm.intro'),
      ...lines.map(line => `- ${line}`),
      '',
      t('settings.importConfirm.warning'),
    ].join('\n');
  }, [favorites.length, fileTags, recentItems.length, t]);

  const handleExportSettingsBackup = useCallback(async () => {
    setBackupStatus({ loading: true, kind: 'idle', message: t('settings.backup.exporting') });
    try {
      const path = await save({
        defaultPath: `aether-backup-${new Date().toISOString().slice(0, 10)}.json`,
        filters: [{ name: 'JSON', extensions: ['json'] }],
      });
      if (!path) {
        setBackupStatus(DEFAULT_BACKUP_STATUS);
        return;
      }
      const data = buildSettingsBackup({
        theme,
        favorites,
        fileTags,
        recentItems,
        appVersion: appVersion || import.meta.env.VITE_APP_VERSION || '0.0.0',
      });
      await writeTextFile(path, JSON.stringify(data, null, 2));
      setBackupStatus({ loading: false, kind: 'ok', message: t('settings.backup.exported') });
    } catch (err) {
      setBackupStatus({
        loading: false,
        kind: 'error',
        message: t('settings.backup.exportFailed', { error: normalizeAppError(err).userMessage }),
      });
    }
  }, [appVersion, favorites, fileTags, recentItems, t, theme]);

  const handleImportSettingsBackup = useCallback(async () => {
    setBackupStatus({ loading: true, kind: 'idle', message: t('settings.backup.importing') });
    try {
      const path = await open({
        multiple: false,
        filters: [{ name: 'JSON', extensions: ['json'] }],
      });
      if (!path || typeof path !== 'string') {
        setBackupStatus(DEFAULT_BACKUP_STATUS);
        return;
      }
      const raw = await readTextFile(path);
      const data = JSON.parse(raw);
      const sanitized = sanitizeImportedSettingsBackup(data);
      const shouldImport = await tauriConfirm(buildImportConfirmMessage(sanitized), {
        title: t('settings.backup.import'),
        kind: 'warning',
      });
      if (!shouldImport) {
        setBackupStatus(DEFAULT_BACKUP_STATUS);
        return;
      }
      onImport?.(sanitized);
      setBackupStatus({ loading: false, kind: 'ok', message: t('settings.backup.imported') });
    } catch (err) {
      setBackupStatus({
        loading: false,
        kind: 'error',
        message: t('settings.backup.importFailed', { error: normalizeAppError(err).userMessage }),
      });
    }
  }, [buildImportConfirmMessage, onImport, t]);

  const handleResetAllSettingsData = useCallback(async () => {
    const ok = await tauriConfirm(t('settings.backup.resetConfirm'), {
      title: t('settings.backup.resetAll'),
      kind: 'warning',
    });
    if (!ok) return;
    try {
      onResetAllData?.();
      setBackupStatus({ loading: false, kind: 'ok', message: t('settings.backup.resetDone') });
    } catch (err) {
      setBackupStatus({
        loading: false,
        kind: 'error',
        message: t('settings.backup.resetFailed', { error: normalizeAppError(err).userMessage }),
      });
    }
  }, [onResetAllData, t]);

  useEffect(() => {
    setWallpaperUrlDraft(theme.wallpaperUrl || '');
  }, [theme.wallpaperUrl]);

  useEffect(() => {
    setActiveCategory(initialCategory);
  }, [initialCategory]);

  useEffect(() => {
    let cancelled = false;
    getVersion()
      .then(version => {
        if (!cancelled) setAppVersion(version || import.meta.env.VITE_APP_VERSION || '');
      })
      .catch(() => {
        if (!cancelled) setAppVersion(import.meta.env.VITE_APP_VERSION || '');
      });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    invoke<string[]>('list_fonts').then(fonts => {
      if (!cancelled) setAvailableFonts(['Inter', 'System Default', ...fonts]);
    }).catch(() => {
      if (!cancelled) setAvailableFonts(['Inter', 'System Default', 'Arial', 'Helvetica', 'Times New Roman', 'Courier']);
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    invoke<string[]>('list_terminal_apps')
      .then(apps => {
        if (!cancelled) setTerminalApps(apps.length ? apps : ['Terminal', 'iTerm']);
      })
      .catch(() => {
        if (!cancelled) setTerminalApps(['Terminal', 'iTerm']);
      });
    return () => { cancelled = true; };
  }, []);

  const handleFileUpload = async () => {
    const selected = await open({
      multiple: false,
      filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "gif", "webp", "bmp"] }]
    });
    if (selected && typeof selected === "string") {
      onThemeChange({
        ...theme,
        wallpaperUrl: convertFileSrc(selected),
        wallpaperBlur: 0,
        blurIntensity: 0
      });
    }
  };

  const handleWallpaperUrlChange = (url: string) => {
    setWallpaperUrlDraft(url);
    const trimmedUrl = url.trim();
    if (!trimmedUrl) {
      setWallpaperUrlError('');
      onThemeChange({ ...theme, wallpaperUrl: undefined });
      return;
    }
    if (!isValidWallpaperUrl(trimmedUrl)) {
      setWallpaperUrlError(t('settings.wallpaperUrlInvalid'));
      return;
    }
    setWallpaperUrlError('');
    if (trimmedUrl) {
      onThemeChange({
        ...theme,
        wallpaperUrl: trimmedUrl,
        wallpaperBlur: 0,
        blurIntensity: 0
      });
    } else {
      onThemeChange({ ...theme, wallpaperUrl: undefined });
    }
  };

  const handlePickDefaultHome = async () => {
    const selected = await open({ multiple: false, directory: true });
    if (selected && typeof selected === 'string') {
      onThemeChange({ ...theme, defaultHomePath: selected });
    }
  };

  const handleResetDefaultHome = () => {
    onThemeChange({ ...theme, defaultHomePath: 'aether://favorites' });
    // 立即切到首页 tab，给用户即时视觉反馈
    onNavigateToHome?.();
  };

  const resetActionForm = () => {
    setEditingExtensionId(null);
    setNewActionLabel('');
    setNewActionType('terminal');
    setNewTerminalApp(theme.terminalApp || 'Terminal');
    setNewTerminalArgs('');
    setNewCommand('');
    setNewUrlTemplate('');
    setNewWorkingDirectory('selection');
  };

  const populateActionForm = (ext: ContextMenuAction) => {
    setEditingExtensionId(ext.id);
    setNewActionLabel(ext.label);
    setNewActionType(ext.actionType || 'placeholder');
    setNewTerminalApp(ext.terminalApp || theme.terminalApp || 'Terminal');
    setNewTerminalArgs(ext.terminalArgs || '');
    setNewCommand(ext.command || '');
    setNewUrlTemplate(ext.urlTemplate || '');
    setNewWorkingDirectory(ext.workingDirectory || 'selection');
  };

  const toggleExtension = (id: string) => {
    const extensions = theme.contextMenuExtensions || [];
    onThemeChange({
      ...theme,
      contextMenuExtensions: extensions.map(ext => 
        ext.id === id ? { ...ext, enabled: !ext.enabled } : ext
      )
    });
  };

  const updateExtension = () => {
    if (!editingExtensionId || !isNewActionValid()) return;
    const extensions = theme.contextMenuExtensions || [];
    const nextExtensions = extensions.map(ext => {
      if (ext.id !== editingExtensionId) return ext;
      const updated: ContextMenuAction = {
        ...ext,
        label: newActionLabel.trim(),
        actionType: newActionType,
        workingDirectory: newWorkingDirectory,
        confirmExecution: ext.confirmExecution ?? true,
      };
      delete updated.terminalApp;
      delete updated.terminalArgs;
      delete updated.command;
      delete updated.urlTemplate;
      if (newActionType === 'terminal') {
        updated.terminalApp = newTerminalApp || theme.terminalApp || 'Terminal';
        updated.terminalArgs = newTerminalArgs.trim();
      }
      if (newActionType === 'shell') {
        updated.terminalApp = newTerminalApp || theme.terminalApp || 'Terminal';
        updated.command = newCommand.trim();
      }
      if (newActionType === 'url') {
        updated.urlTemplate = newUrlTemplate.trim();
      }
      return updated;
    });
    onThemeChange({ ...theme, contextMenuExtensions: nextExtensions });
    resetActionForm();
  };

  const isNewActionValid = () => {
    if (!newActionLabel.trim()) return false;
    if (newActionType === 'shell') return Boolean(newCommand.trim());
    if (newActionType === 'url') return Boolean(newUrlTemplate.trim());
    return true;
  };

  const addExtension = () => {
    if (editingExtensionId) {
      updateExtension();
      return;
    }
    if (!isNewActionValid()) return;
    const extensions = theme.contextMenuExtensions || [];
    const label = newActionLabel.trim();
    const newExt: ContextMenuAction = {
      id: `custom-${Date.now()}`,
      label,
      enabled: true,
      actionType: newActionType,
      workingDirectory: newWorkingDirectory,
    };
    if (newActionType === 'terminal') {
      newExt.terminalApp = newTerminalApp || theme.terminalApp || 'Terminal';
      newExt.terminalArgs = newTerminalArgs.trim();
    }
    if (newActionType === 'shell') {
      newExt.terminalApp = newTerminalApp || theme.terminalApp || 'Terminal';
      newExt.command = newCommand.trim();
    }
    if (newActionType === 'url') {
      newExt.urlTemplate = newUrlTemplate.trim();
    }
    onThemeChange({
      ...theme,
      contextMenuExtensions: [...extensions, newExt]
    });
    resetActionForm();
  };

  const deleteExtension = (id: string) => {
    const extensions = theme.contextMenuExtensions || [];
    onThemeChange({
      ...theme,
      contextMenuExtensions: extensions.filter(ext => ext.id !== id)
    });
  };

  const handleExportExtensions = async () => {
    const path = await save({ defaultPath: 'aether-context-menu.json', filters: [{ name: 'JSON', extensions: ['json'] }] });
    if (!path) return;
    const payload = JSON.stringify(theme.contextMenuExtensions || [], null, 2);
    try {
      await writeTextFile(path, payload);
    } catch (err) {
      console.error('导出失败', err);
    }
  };

  const handleImportExtensions = async () => {
    const selected = await open({ multiple: false, filters: [{ name: 'JSON', extensions: ['json'] }] });
    if (!selected || typeof selected !== 'string') return;
    try {
      const content = await readTextFile(selected);
      const parsed = JSON.parse(content);
      const normalized = sanitizeImportedContextMenuExtensions(parsed);
      onThemeChange({ ...theme, contextMenuExtensions: normalized });
    } catch (err) {
      console.error('导入失败', err);
    }
  };

  const handleDeleteExtension = async (id: string, label: string) => {
    const ok = await tauriConfirm(t('dialogs.deleteConfirm', { label }), {
      title: t('settings.extensions.deleteAction'),
      kind: 'warning',
    });
    if (!ok) return;
    deleteExtension(id);
  };

  const handleCheckUpdates = async () => {
    setUpdateStatus({
      ...DEFAULT_UPDATE_STATUS,
      state: 'checking',
      message: t('settings.update.checking'),
    });
    try {
      const currentVersion = (await getVersion().catch(() => '')) || '0.1.0';
      const update = await check();
      if (!update) {
        setUpdateStatus({
          ...DEFAULT_UPDATE_STATUS,
          state: 'current',
          currentVersion,
          latestVersion: currentVersion,
          message: t('settings.update.alreadyLatest', { version: currentVersion }),
        });
        return;
      }
      const latestVersion = update.version || '';
      const releaseUrl = `https://github.com/HaoRangQi/aether-explorer/releases/tag/v${latestVersion}`;
      setUpdateStatus({
        ...DEFAULT_UPDATE_STATUS,
        state: 'available',
        currentVersion: update.currentVersion || currentVersion,
        latestVersion,
        releaseUrl,
        notes: update.body || '',
        pubDate: update.date || '',
        message: t('settings.update.foundNew', { version: latestVersion }),
      });
    } catch (err) {
      setUpdateStatus({
        ...DEFAULT_UPDATE_STATUS,
        state: 'error',
        message: t('settings.update.checkFailed', { error: normalizeAppError(err).userMessage }),
      });
    }
  };

  const handleDownloadUpdate = async () => {
    try {
      const update = await check();
      if (!update) {
        setUpdateStatus(prev => ({
          ...prev,
          state: 'current',
          message: t('settings.update.noUpdateOnDownload'),
        }));
        return;
      }
      setUpdateStatus(prev => ({
        ...prev,
        state: 'downloading',
        downloaded: 0,
        contentLength: 0,
        message: t('settings.update.preparing'),
      }));
      let downloaded = 0;
      let contentLength = 0;
      await update.downloadAndInstall(event => {
        switch (event.event) {
          case 'Started':
            contentLength = event.data.contentLength ?? 0;
            setUpdateStatus(prev => ({
              ...prev,
              state: 'downloading',
              downloaded: 0,
              contentLength,
              message: t('settings.update.downloading'),
            }));
            break;
          case 'Progress':
            downloaded += event.data.chunkLength ?? 0;
            setUpdateStatus(prev => ({
              ...prev,
              state: 'downloading',
              downloaded,
              message: t('settings.update.downloading'),
            }));
            break;
          case 'Finished':
            setUpdateStatus(prev => ({
              ...prev,
              state: 'installing',
              downloaded: prev.contentLength || downloaded,
              message: t('settings.update.installing'),
            }));
            break;
        }
      });
      setUpdateStatus(prev => ({
        ...prev,
        state: 'restarting',
        message: t('settings.update.restarting'),
      }));
      await relaunch();
    } catch (err) {
      setUpdateStatus(prev => ({
        ...prev,
        state: 'error',
        message: t('settings.update.installFailed', { error: normalizeAppError(err).userMessage }),
      }));
    }
  };

  const handleCleanup = async () => {
    setCleanupStatus({ cleaning: true, message: t('settings.cleanup.cleaning') });

    try {
      // 清理 localStorage 中的临时数据
      const keysToRemove: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && (key.startsWith('aether-dragging-') || key.includes('-cache-') || key.includes('-temp-'))) {
          keysToRemove.push(key);
        }
      }
      keysToRemove.forEach(key => localStorage.removeItem(key));

      // 清理 sessionStorage
      sessionStorage.clear();

      // 调用后端清理缓存目录（如果有的话）
      try {
        await invoke('clear_app_cache');
      } catch {
        // 后端可能没有实现此命令，忽略错误
      }

      setCleanupStatus({
        cleaning: false,
        message: t('settings.cleanup.done', { count: keysToRemove.length })
      });

      // 3秒后清除消息
      setTimeout(() => {
        setCleanupStatus({ cleaning: false, message: '' });
      }, 3000);
    } catch (err) {
      setCleanupStatus({
        cleaning: false,
        message: t('settings.cleanup.failed', { error: normalizeAppError(err).userMessage })
      });
    }
  };

  const categories = [
    { id: 'appearance', label: t('settings.appearanceHeader'), icon: Palette },
    { id: 'files', label: t('settings.filesHeader'), icon: HardDrive },
    { id: 'permissions', label: t('settings.privacyHeader'), icon: Shield },
    { id: 'extensions', label: t('settings.extensionsHeader'), icon: Puzzle },
    { id: 'features', label: t('settings.featuresHeader'), icon: Monitor },
    { id: 'ai', label: t('settings.aiHeader'), icon: Sparkles },
    { id: 'about', label: t('settings.aboutHeader'), icon: Info },
  ];

  const selectedLanguage = theme.language || i18n.language || 'zh';
  const languageOptions = theme.languageOptions || BUILT_IN_LANGUAGES;
  const visibleLanguages = [...languageOptions, ...AVAILABLE_LANGUAGE_SLOTS.filter(slot => !languageOptions.some(lang => lang.code === slot.code))];
  const systemLanguage = navigator.language.toLowerCase().startsWith('zh') ? 'zh' : 'en';

  const buildDiagnosticsReport = useCallback(async () => {
    const logsDir = await invoke<string>('get_logs_dir').catch(() => t('settings.diagnostics.unavailable'));
    const configDir = await invoke<string>('get_config_dir').catch(() => t('settings.diagnostics.unavailable'));
    const payload = {
      app: 'Aether Explorer',
      version: appVersion || import.meta.env.VITE_APP_VERSION || '0.0.0',
      platform: navigator.platform,
      userAgent: navigator.userAgent,
      language: selectedLanguage,
      systemLanguage: navigator.language,
      logsDir,
      configDir,
      settings: {
        mode: theme.mode,
        accentColor: theme.accentColor,
        showHiddenFiles: Boolean(theme.showHiddenFiles),
        showPreviewPanel: Boolean(theme.showPreviewPanel),
        enableMultiWindow: Boolean(theme.enableMultiWindow),
        crossWindowDropDefault: theme.crossWindowDropDefault || 'copy',
        terminalApp: theme.terminalApp || 'Terminal',
        contextMenuExtensions: theme.contextMenuExtensions?.length || 0,
        aiProviders: theme.aiProviders?.map(provider => ({
          id: provider.id,
          name: provider.name,
          type: provider.type,
          enabled: provider.enabled,
          hasApiKey: Boolean(provider.apiKey),
          active: theme.aiActiveProvider === provider.id,
        })) || [],
      },
    };
    return JSON.stringify(payload, null, 2);
  }, [appVersion, selectedLanguage, t, theme]);

  const copyTextToClipboard = useCallback(async (text: string) => {
    await navigator.clipboard.writeText(text);
  }, []);

  const handleCopyDiagnostics = useCallback(async () => {
    setDiagnosticsStatus({ loading: true, kind: 'idle', message: t('settings.diagnostics.collecting') });
    try {
      await copyTextToClipboard(await buildDiagnosticsReport());
      setDiagnosticsStatus({ loading: false, kind: 'ok', message: t('settings.diagnostics.copied') });
    } catch (err) {
      setDiagnosticsStatus({
        loading: false,
        kind: 'error',
        message: t('settings.diagnostics.copyFailed', { error: normalizeAppError(err).userMessage }),
      });
    }
  }, [buildDiagnosticsReport, copyTextToClipboard, t]);

  const handleOpenLogsDir = useCallback(async () => {
    setDiagnosticsStatus({ loading: true, kind: 'idle', message: t('settings.diagnostics.openingLogs') });
    try {
      await invoke('open_logs_dir');
      setDiagnosticsStatus({ loading: false, kind: 'ok', message: t('settings.diagnostics.logsOpened') });
    } catch (err) {
      setDiagnosticsStatus({
        loading: false,
        kind: 'error',
        message: t('settings.diagnostics.openLogsFailed', { error: normalizeAppError(err).userMessage }),
      });
    }
  }, [t]);

  const handleOpenConfigDir = useCallback(async () => {
    setDiagnosticsStatus({ loading: true, kind: 'idle', message: t('settings.diagnostics.openingConfig') });
    try {
      await invoke('open_config_dir');
      setDiagnosticsStatus({ loading: false, kind: 'ok', message: t('settings.diagnostics.configOpened') });
    } catch (err) {
      setDiagnosticsStatus({
        loading: false,
        kind: 'error',
        message: t('settings.diagnostics.openConfigFailed', { error: normalizeAppError(err).userMessage }),
      });
    }
  }, [t]);

  const handleReadLastPanicLog = useCallback(async () => {
    setDiagnosticsStatus({ loading: true, kind: 'idle', message: t('settings.diagnostics.readingPanicLog') });
    try {
      const log = await invoke<string | null>('read_last_panic_log');
      setLastPanicLog(log);
      setDiagnosticsStatus({
        loading: false,
        kind: log ? 'ok' : 'idle',
        message: log ? t('settings.diagnostics.panicLogLoaded') : t('settings.diagnostics.noPanicLog'),
      });
    } catch (err) {
      setDiagnosticsStatus({
        loading: false,
        kind: 'error',
        message: t('settings.diagnostics.readPanicLogFailed', { error: normalizeAppError(err).userMessage }),
      });
    }
  }, [t]);

  const handleCopyPanicLog = useCallback(async () => {
    if (!lastPanicLog) return;
    try {
      await copyTextToClipboard(lastPanicLog);
      setDiagnosticsStatus({ loading: false, kind: 'ok', message: t('settings.diagnostics.panicLogCopied') });
    } catch (err) {
      setDiagnosticsStatus({
        loading: false,
        kind: 'error',
        message: t('settings.diagnostics.copyFailed', { error: normalizeAppError(err).userMessage }),
      });
    }
  }, [copyTextToClipboard, lastPanicLog, t]);

  const applyLanguage = (code: string) => {
    i18n.changeLanguage(code);
    onThemeChange({ ...theme, language: code, followSystemLanguage: false, languageOptions });
  };

  const toggleFollowSystemLanguage = () => {
    const nextFollow = !theme.followSystemLanguage;
    const nextLanguage = nextFollow ? systemLanguage : selectedLanguage;
    i18n.changeLanguage(nextLanguage);
    onThemeChange({ ...theme, followSystemLanguage: nextFollow, language: nextLanguage, languageOptions });
  };

  const handleLiquidGlassToggle = async () => {
    const nextEnabled = theme.enableLiquidGlass !== true;
    const appearance = resolveCurrentAppearance(theme.mode);
    setIsTogglingLiquidGlass(true);
    setLiquidGlassMessage('');

    try {
      const status = await invoke<NativeLiquidGlassStatus>('set_native_liquid_glass_enabled', {
        enabled: nextEnabled,
        appearance,
      });
      setLiquidGlassStatus(status);

      if (nextEnabled && !status.applied) {
        setLiquidGlassMessage(status.reason || t('settings.liquidGlassUnsupported', '当前系统不支持原生 Liquid Glass，需要 macOS 26 或更新版本。'));
        onThemeChange({ ...theme, enableLiquidGlass: false });
        return;
      }

      setLiquidGlassMessage(nextEnabled
        ? t('settings.liquidGlassApplied', '原生 Liquid Glass 已启用。')
        : t('settings.liquidGlassDisabled', '原生 Liquid Glass 已关闭。'));
      onThemeChange({ ...theme, enableLiquidGlass: nextEnabled });
    } catch (err) {
      setLiquidGlassMessage(t('settings.liquidGlassToggleFailed', {
        error: normalizeAppError(err).userMessage,
        defaultValue: '切换原生 Liquid Glass 失败：{{error}}',
      }));
      if (nextEnabled) {
        onThemeChange({ ...theme, enableLiquidGlass: false });
      }
    } finally {
      setIsTogglingLiquidGlass(false);
    }
  };

  const renderAppearanceCategory = () => (
    <div className="space-y-12 animate-in fade-in slide-in-from-bottom-4 duration-500 pb-12">
      <section className="bg-primary/5 rounded-[32px] p-8 border border-primary/10 space-y-6">
        <div className="flex items-center justify-between gap-6">
          <div className="min-w-0 space-y-2">
            <h3 className="text-[20px] font-black text-on-surface flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-primary" />
              {t('settings.liquidGlassTheme', '液态玻璃主题')}
            </h3>
            <p className="text-[13px] text-on-surface/45 leading-relaxed max-w-2xl">
              {t('settings.liquidGlassThemeDesc', '开启后调用 macOS 原生 Liquid Glass；浅色、深色、自动仍会决定玻璃明暗。')}
            </p>
          </div>
          <button
            type="button"
            onClick={handleLiquidGlassToggle}
            disabled={isTogglingLiquidGlass}
            className={`relative w-14 h-8 rounded-full transition-colors duration-200 shrink-0 ${theme.enableLiquidGlass ? 'bg-primary' : 'bg-on-surface/20'} ${isTogglingLiquidGlass ? 'opacity-60 cursor-wait' : ''}`}
            aria-pressed={theme.enableLiquidGlass === true}
          >
            <span className={`absolute top-1 left-1 w-6 h-6 rounded-full bg-white shadow transition-transform duration-200 ${theme.enableLiquidGlass ? 'translate-x-6' : 'translate-x-0'}`} />
          </button>
        </div>
        {(theme.enableLiquidGlass || liquidGlassMessage) && (
          <div className={`rounded-2xl border px-5 py-4 text-[12px] font-bold leading-relaxed ${
            liquidGlassStatus && !liquidGlassStatus.applied && liquidGlassStatus.requested
              ? 'border-red-500/20 bg-red-500/10 text-red-700'
              : 'border-primary/15 bg-primary/5 text-on-surface/55'
          }`}>
            {liquidGlassMessage || t('settings.liquidGlassThemeActiveHint', '原生 Liquid Glass 已接管窗口材质；浅色、深色、自动会切换玻璃明暗。应用内壁纸与渐变背景会暂停渲染。')}
          </div>
        )}
      </section>

      {/* Mode & materials */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        <section className="bg-primary/5 rounded-3xl p-8 border border-primary/10 space-y-6">
          <h3 className="text-[17px] font-bold text-on-surface flex items-center gap-2">
            <Sun className="w-4 h-4 text-primary" /> {t('settings.appearanceMode', '色彩基调')}
          </h3>
          <div className="bg-primary/5 p-1.5 rounded-2xl flex gap-1.5">
            {[
              { id: 'light', label: t('settings.light'), icon: Sun },
              { id: 'dark', label: t('settings.dark'), icon: Moon },
              { id: 'auto', label: t('settings.auto'), icon: Zap },
            ].map((mode) => {
              const isActive = theme.mode === mode.id;
              return (
                <button
                  key={mode.id}
                  type="button"
                  onClick={() => {
                    const nextMode = mode.id as ThemeSettings['mode'];
                    const nextAppearance = resolveCurrentAppearance(nextMode);
                    onThemeChange({
                      ...theme,
                      mode: nextMode,
                      accentColor: nextAppearance === 'dark' ? DEFAULT_DARK_ACCENT : DEFAULT_LIGHT_ACCENT,
                    });
                  }}
                  className={`flex-1 py-4 rounded-xl flex items-center justify-center gap-2 text-[13px] font-bold transition-all relative
                    ${theme.enableLiquidGlass
                      ? isActive ? 'text-on-surface' : 'text-on-surface/45 hover:text-on-surface hover:bg-white/10'
                      : isActive ? 'text-on-primary' : 'text-on-surface/40 hover:text-on-surface/80 hover:bg-primary/10'}
                  `}
                >
                  {isActive && (
                    <motion.div
                      layoutId="active-mode-pill"
                      className={`absolute inset-0 rounded-xl z-0 shadow-lg ${
                        theme.enableLiquidGlass
                          ? 'bg-white/20 border border-white/20 shadow-black/10'
                          : 'bg-primary shadow-primary/20'
                      }`}
                    />
                  )}
                  <mode.icon className="w-4 h-4 relative z-10" />
                  <span className="relative z-10">{mode.label}</span>
                </button>
              );
            })}
          </div>
        </section>

        <section className="bg-primary/5 rounded-3xl p-8 border border-primary/10 space-y-8">
          <h3 className="text-[17px] font-bold text-on-surface flex items-center gap-2">
            <Sliders className="w-4 h-4 text-primary" /> {t('settings.materialEffects', '毛玻璃质感')}
          </h3>
          <div className="space-y-6">
            <div className="flex justify-between items-center">
              <label className="text-[13px] font-bold text-on-surface/60 uppercase tracking-wider">{t('settings.blurIntensity')}</label>
              <span className="text-[13px] font-black text-primary bg-primary/10 px-2 py-0.5 rounded-md">{theme.blurIntensity}px</span>
            </div>
            <input 
              type="range" min="0" max="64" value={theme.blurIntensity}
              onChange={(e) => onThemeChange({ ...theme, blurIntensity: parseInt(e.target.value) })}
              className="w-full h-1.5 bg-primary/10 rounded-full appearance-none cursor-pointer accent-primary"
            />
          </div>
        </section>
      </div>

      <section className="bg-primary/5 rounded-[32px] p-8 border border-primary/10 overflow-hidden space-y-8">
        <header className="text-left">
          <h3 className="text-[22px] font-black text-on-surface tracking-tight mb-2">{t('settings.accentColor', '品牌强调色')}</h3>
          <p className="text-[13px] text-on-surface/40 leading-relaxed max-w-2xl">
            系统核心视觉标识。选择一个最具代表性的色彩，它将作为 UI 全局的主基调。
          </p>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-[1.15fr_0.85fr] gap-5">
          <div className="rounded-3xl bg-primary/5 border border-primary/10 p-5 space-y-4">
            <label className="text-[11px] font-black text-primary uppercase tracking-[0.18em]">{t('settings.swatches', '常用色样')}</label>
            <div className="flex flex-wrap gap-3 items-center">
              {ACCENT_COLORS.map((color) => {
                const isActive = theme.accentColor === color;
                return (
                  <button
                    key={color}
                    onClick={() => onThemeChange({ ...theme, accentColor: color })}
                    style={{ backgroundColor: color }}
                    className={`relative w-10 h-10 rounded-xl shadow-md transition-all duration-300 hover:scale-105 active:scale-95 flex items-center justify-center
                      ${isActive ? 'ring-3 ring-primary/40 scale-105 z-10 shadow-lg' : 'opacity-85 hover:opacity-100'}
                    `}
                    title={color}
                  >
                    {isActive && <Check className="w-5 h-5 text-white drop-shadow-lg z-20" />}
                    <div className="absolute inset-0 rounded-xl border border-white/20 pointer-events-none" />
                  </button>
                );
              })}
              <div className="flex gap-2 items-center bg-primary/5 p-1.5 rounded-2xl border border-primary/20 hover:border-primary/40 transition-all">
                <div className="relative w-9 h-9 rounded-xl overflow-hidden shadow-inner border border-white/10 shrink-0">
                  <input
                    type="color"
                    value={theme.accentColor}
                    onChange={(e) => onThemeChange({ ...theme, accentColor: e.target.value })}
                    className="absolute -inset-4 w-[200%] h-[200%] cursor-pointer border-none bg-transparent"
                  />
                </div>
                <input
                  type="text"
                  value={theme.accentColor}
                  onChange={(e) => onThemeChange({ ...theme, accentColor: e.target.value.startsWith('#') ? e.target.value : `#${e.target.value}` })}
                  className="w-20 bg-transparent border-none text-[12px] font-black font-mono outline-none uppercase text-on-surface/80 focus:text-primary transition-colors"
                  placeholder="#HEX"
                />
              </div>
            </div>
          </div>

          <div className="rounded-3xl bg-primary/5 border border-primary/10 p-5 flex items-center gap-4 min-w-0">
            <div className="w-16 h-16 rounded-2xl shrink-0 shadow-xl border border-white/10 flex items-center justify-center" style={{ backgroundColor: theme.accentColor }}>
              <div className="w-8 h-8 rounded-full bg-white/30 blur-xl" />
            </div>
            <div className="min-w-0 space-y-2">
              <p className="text-[11px] font-black text-primary uppercase tracking-[0.18em]">当前强调色</p>
              <p className="text-[20px] font-black text-on-surface font-mono uppercase leading-none truncate">{theme.accentColor}</p>
              <p className="text-[12px] text-on-surface/45 leading-relaxed">选定的强调色将直接影响全局变量。</p>
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <label className="text-[11px] font-black text-on-surface/35 uppercase tracking-[0.18em]">{t('settings.palettes', '精品调色盘推荐')}</label>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {CURATED_PALETTES.map(p => (
              <button
                key={p.name}
                onClick={() => onThemeChange({ ...theme, accentColor: p.colors[0] })}
                className="flex items-center justify-between gap-3 p-3 bg-primary/5 rounded-2xl hover:bg-primary/10 transition-all border border-transparent hover:border-primary/20 group/pal min-w-0"
              >
                <div className="flex shrink-0">
                  {p.colors.map((c, i) => (
                    <div key={i} className="w-6 h-6 rounded-full -ml-1.5 first:ml-0 border-2 border-on-surface/10 shadow-sm" style={{ backgroundColor: c, zIndex: 10 - i }} />
                  ))}
                </div>
                <span className="text-[12px] font-bold text-on-surface/60 group-hover/pal:text-primary transition-colors truncate">{p.name}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-4">
          <label className="text-[11px] font-black text-on-surface/35 uppercase tracking-[0.18em]">中国传统色 调色盘推荐</label>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {CHINESE_COLOR_PALETTES.map(p => (
              <button
                key={p.name}
                onClick={() => onThemeChange({ ...theme, accentColor: p.colors[0] })}
                className="p-3 rounded-2xl bg-primary/5 border border-transparent hover:border-primary/20 hover:bg-primary/10 transition-all text-left group/cn min-w-0"
              >
                <div className="grid grid-cols-4 gap-1 mb-3">
                  {p.colors.map(color => (
                    <div key={color} className="h-7 rounded-lg border border-white/10 shadow-sm" style={{ backgroundColor: color }} />
                  ))}
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[13px] font-black text-on-surface/70 group-hover/cn:text-primary transition-colors truncate">{p.name}</span>
                  <span className="text-[10px] font-mono text-on-surface/30 uppercase truncate">{p.colors[0]}</span>
                </div>
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* 颜色细化控制 */}
      <section className="bg-primary/5 rounded-[32px] p-10 border border-primary/10 space-y-8">
        <header className="text-left">
          <h3 className="text-[22px] font-black text-on-surface tracking-tight mb-2 flex items-center gap-2">
            <Palette className="w-5 h-5 text-primary" />
            颜色细化控制
          </h3>
          <p className="text-[13px] text-on-surface/40 leading-relaxed max-w-2xl">
            点击色块修改颜色，右键重置为默认。
          </p>
        </header>

        <div className="grid grid-cols-4 sm:grid-cols-7 gap-6">
          {([
            { key: 'colorIcon', label: '图标' },
            { key: 'colorSelectedFg', label: '选中前景' },
            { key: 'colorSelectedBg', label: '选中背景' },
            { key: 'colorHoverFg', label: '悬浮前景' },
            { key: 'colorHoverBg', label: '悬浮背景' },
            { key: 'colorPanelBg', label: '面板底色' },
            { key: 'colorTextPrimary', label: '主文字' },
            { key: 'colorTextSecondary', label: '次文字' },
            { key: 'colorBorder', label: '边框' },
            { key: 'colorDivider', label: '分隔线' },
            { key: 'colorShadow', label: '阴影' },
            { key: 'colorActiveIconBg', label: '激活图标' },
            { key: 'colorTagSelected', label: '标签选中' },
            { key: 'colorSearchBg', label: '搜索框' },
            { key: 'colorAppBg', label: '主背景色' },
          ] as { key: keyof ThemeSettings; label: string }[]).map(({ key, label }) => (
            <div key={key} className="flex flex-col items-center gap-2">
              <label className="relative group">
                <input
                  type="color"
                  value={(theme[key] as string) || theme.accentColor}
                  onChange={(e) => onThemeChange({ ...theme, [key]: e.target.value })}
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                />
                <div
                  className={`w-10 h-10 rounded-full border-2 transition-all group-hover:scale-110 group-hover:shadow-lg ${theme[key] ? 'border-on-surface/20 shadow-md' : 'border-dashed border-on-surface/20'}`}
                  style={{ backgroundColor: (theme[key] as string) || undefined }}
                />
                {!theme[key] && (
                  <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                    <div className="w-5 h-5 rounded-full bg-primary/30" />
                  </div>
                )}
              </label>
              <span className="text-[10px] font-bold text-on-surface/50 text-center leading-tight">{label}</span>
              {theme[key] && (
                <button
                  onClick={() => onThemeChange({ ...theme, [key]: undefined })}
                  className="text-[9px] text-on-surface/30 hover:text-primary transition-colors"
                >
                  重置
                </button>
              )}
            </div>
          ))}
        </div>

        {/* 全部重置按钮 */}
        <div className="pt-6 border-t border-primary/10">
          <button
            onClick={() => onThemeChange({
              ...theme,
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
            })}
            className="px-6 py-3 rounded-2xl bg-primary/10 text-primary text-[13px] font-bold hover:bg-primary/20 transition-colors flex items-center gap-2"
          >
            <RotateCw className="w-4 h-4" />
            全部重置为默认配色
          </button>
        </div>

        {/* 实时预览 */}
        <div className="pt-6 border-t border-primary/10 space-y-4">
          <h4 className="text-[13px] font-black text-on-surface/40 uppercase tracking-widest flex items-center gap-2">
            <Eye className="w-3.5 h-3.5" /> 实时预览
          </h4>
          <div className="rounded-2xl border-2 border-custom overflow-hidden bg-panel-custom">
            {/* 模拟侧边栏 + 文件区 */}
            <div className="flex min-h-[220px]">
              {/* 侧边栏 */}
              <div className="w-40 shrink-0 border-r border-custom p-3 space-y-1">
                <div className="flex items-center gap-2 px-2 py-1.5 rounded-lg bg-selected">
                  <div className="w-5 h-5 rounded-full bg-active-icon flex items-center justify-center">
                    <Folder className="w-3 h-3 text-on-primary" />
                  </div>
                  <span className="text-[11px] font-bold text-selected">下载</span>
                </div>
                <div className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-hover-custom transition-colors">
                  <div className="w-5 h-5 rounded-full bg-panel-custom flex items-center justify-center">
                    <FileIcon className="w-3 h-3 text-icon" />
                  </div>
                  <span className="text-[11px] text-primary-custom">文稿</span>
                </div>
                <div className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-hover-custom transition-colors">
                  <div className="w-5 h-5 rounded-full bg-panel-custom flex items-center justify-center">
                    <ImageIcon className="w-3 h-3 text-icon" />
                  </div>
                  <span className="text-[11px] text-primary-custom">图片</span>
                </div>
                <div className="my-2 h-px bg-divider" />
                <div className="px-2 text-[9px] font-bold text-secondary-custom uppercase tracking-wider">标签</div>
                <div className="flex items-center gap-2 px-2 py-1">
                  <div className="w-2.5 h-2.5 rounded-full bg-tag-selected" />
                  <span className="text-[10px] text-secondary-custom">重要</span>
                </div>
              </div>
              {/* 文件区 */}
              <div className="flex-1 p-3 space-y-1.5">
                {/* 搜索框 */}
                <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-search-custom border border-custom mb-3">
                  <Search className="w-3 h-3 text-icon" />
                  <span className="text-[11px] text-secondary-custom">搜索文件...</span>
                </div>
                {/* 文件项 - 选中 */}
                <div className="flex items-center gap-3 px-3 py-2 rounded-lg bg-selected border border-custom shadow-custom">
                  <Folder className="w-4 h-4 text-icon" />
                  <div className="flex-1 min-w-0">
                    <p className="text-[11px] font-bold text-selected truncate">Design Assets</p>
                    <p className="text-[9px] text-secondary-custom">12 项 · 昨天</p>
                  </div>
                </div>
                {/* 文件项 - 普通 */}
                <div className="flex items-center gap-3 px-3 py-2 rounded-lg bg-panel-custom border border-transparent hover:bg-hover-custom hover:border-custom transition-all">
                  <FileIcon className="w-4 h-4 text-icon" />
                  <div className="flex-1 min-w-0">
                    <p className="text-[11px] font-bold text-primary-custom truncate">报告_2024.pdf</p>
                    <p className="text-[9px] text-secondary-custom">2.1 MB · 周一</p>
                  </div>
                </div>
                <div className="flex items-center gap-3 px-3 py-2 rounded-lg bg-panel-custom border border-transparent hover:bg-hover-custom hover:border-custom transition-all">
                  <ImageIcon className="w-4 h-4 text-icon" />
                  <div className="flex-1 min-w-0">
                    <p className="text-[11px] font-bold text-primary-custom truncate">封面_final.png</p>
                    <p className="text-[9px] text-secondary-custom">4.5 MB · 今天</p>
                  </div>
                </div>
                {/* 底部状态栏 */}
                <div className="flex items-center gap-3 mt-3 pt-2 border-t border-custom">
                  <span className="text-[9px] text-icon font-bold">3</span>
                  <span className="text-[9px] text-secondary-custom">个项目</span>
                  <div className="w-px h-2 bg-divider" />
                  <span className="text-[9px] text-icon font-bold">1</span>
                  <span className="text-[9px] text-secondary-custom">项已选中</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Wallpaper & Blur */}
      <section className="bg-primary/5 rounded-[32px] p-10 border border-primary/10 space-y-10">
        <h3 className="text-[17px] font-bold text-on-surface flex items-center gap-2">
          <Monitor className="w-4 h-4 text-primary" /> {t('settings.wallpaperHeader', '动态壁纸与视差')}
        </h3>

        {/* 色彩渐变背景开关 */}
        <div className="flex items-center justify-between py-3 border-b border-primary/10">
          <div className="space-y-1">
            <p className="text-[13px] font-bold text-on-surface">{t('settings.enableGradient', '色彩渐变背景')}</p>
            <p className="text-[11px] text-on-surface/40">{t('settings.enableGradientDesc', '关闭后使用纯色背景（浅色 #FCFCFD / 深色 #1E1E2E）')}</p>
          </div>
          <button
            onClick={() => onThemeChange({ ...theme, enableGradient: !theme.enableGradient })}
            className={`relative w-11 h-6 rounded-full transition-colors duration-200 ${theme.enableGradient ? 'bg-primary' : 'bg-on-surface/20'}`}
          >
            <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform duration-200 ${theme.enableGradient ? 'translate-x-5' : 'translate-x-0'}`} />
          </button>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-16">
          <div className="space-y-8">
            <div className="space-y-6">
              <label className="text-[11px] font-black text-on-surface/30 uppercase tracking-[0.2em]">{t('settings.customWallpaper', '链接导入')}</label>
              <div className="flex gap-3">
                <input
                  type="text"
                  value={wallpaperUrlDraft}
                  onChange={(e) => handleWallpaperUrlChange(e.target.value)}
                  placeholder="https://images.unsplash.com/..."
                  className={`flex-1 bg-primary/5 border rounded-2xl px-5 py-4 text-[13px] outline-none focus:ring-4 focus:ring-primary/10 transition-all font-medium ${
                    wallpaperUrlError ? 'border-red-400/70 focus:border-red-400' : 'border-primary/20 focus:border-primary'
                  }`}
                />
                <button
                  onClick={() => {
                    setWallpaperUrlError('');
                    setWallpaperUrlDraft('');
                    onThemeChange({ ...theme, wallpaperUrl: undefined });
                  }}
                  className="px-5 bg-primary/10 rounded-2xl text-[13px] font-bold hover:bg-primary/20 transition-all"
                >
                  {t('common.reset')}
                </button>
              </div>
              {wallpaperUrlError && (
                <p className="text-[11px] text-red-400 font-bold">{wallpaperUrlError}</p>
              )}
            </div>
            <div className="relative">
              <button
                onClick={handleFileUpload}
                className="w-full flex items-center justify-center gap-3 px-8 py-5 bg-primary rounded-[24px] shadow-xl shadow-primary/30 hover:scale-[1.02] active:scale-95 transition-all text-on-primary font-black text-[15px] uppercase tracking-widest"
              >
                <Upload className="w-5 h-5" />
                {t('settings.uploadWallpaper', '上传本地壁纸')}
              </button>
            </div>
          </div>
          
          <div className="space-y-8">
            <div className="space-y-6">
              <div className="flex justify-between items-center">
                <label className="text-[11px] font-black text-on-surface/30 uppercase tracking-[0.2em]">{t('settings.wallpaperBlur')}</label>
                <span className="text-[14px] font-black text-primary bg-primary/10 px-2.5 py-1 rounded-lg">{theme.wallpaperBlur || 0}px</span>
              </div>
              <input 
                type="range" min="0" max="100" step="1"
                value={theme.wallpaperBlur || 0}
                onChange={(e) => onThemeChange({ ...theme, wallpaperBlur: parseInt(e.target.value) })}
                className="w-full h-1.5 bg-primary/10 rounded-full appearance-none cursor-pointer accent-primary"
              />
            </div>
            
            <div className="p-6 bg-primary/5 rounded-[24px] border border-primary/10">
               <h4 className="text-[13px] font-bold text-on-surface mb-2 flex items-center gap-2">
                  <Wand2 className="w-4 h-4 text-primary" /> 智能优化
               </h4>
               <p className="text-[11px] text-on-surface/50 leading-relaxed">启用后，系统会根据壁纸的主色调自动调整 UI 文字的反对比度，并为背景注入微妙的模糊效果，提升层级感。</p>
            </div>
          </div>
        </div>
      </section>

      {/* Layout Parameters */}
      <section className="bg-primary/5 rounded-[32px] p-10 border border-primary/10 space-y-12">
         <h3 className="text-[17px] font-bold text-on-surface flex items-center gap-2">
           <Layout className="w-4 h-4 text-primary" /> {t('settings.layoutControls', '布局精算调整')}
         </h3>
         <div className="grid grid-cols-1 lg:grid-cols-2 gap-16">
            <div className="space-y-10">
              <div className="flex items-center gap-4">
                 <div className="w-10 h-10 rounded-2xl bg-primary/10 flex items-center justify-center text-primary">
                    <Grid2X2 className="w-5 h-5" />
                 </div>
                 <h4 className="text-[15px] font-black text-on-surface uppercase tracking-widest">{t('views.grid')}</h4>
              </div>
              
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-8">
                <div className="space-y-4">
                  <div className="flex justify-between items-center">
                    <label className="text-[12px] font-bold text-on-surface/60">{t('settings.gridWidth', '项目宽度')}</label>
                    <span className="text-[13px] font-black text-primary">{theme.gridWidth || 180}px</span>
                  </div>
                  <input type="range" min="100" max="400" value={theme.gridWidth || 180} onChange={(e) => {
                    const gridWidth = parseInt(e.target.value);
                    onThemeChange({ ...theme, gridWidth, mediaGridWidth: theme.mediaGridLinked === false ? theme.mediaGridWidth : gridWidth });
                  }} className="w-full appearance-none h-1.5 bg-primary/10 rounded-full accent-primary" />
                </div>

                <div className="space-y-4">
                  <div className="flex justify-between items-center">
                    <label className="text-[12px] font-bold text-on-surface/60">{t('settings.gridHeight', '项目高度')}</label>
                    <span className="text-[13px] font-black text-primary">{theme.gridHeight || 180}px</span>
                  </div>
                  <input type="range" min="100" max="400" value={theme.gridHeight || 180} onChange={(e) => {
                    const gridHeight = parseInt(e.target.value);
                    onThemeChange({ ...theme, gridHeight, mediaGridHeight: theme.mediaGridLinked === false ? theme.mediaGridHeight : gridHeight });
                  }} className="w-full appearance-none h-1.5 bg-primary/10 rounded-full accent-primary" />
                </div>

                <div className="space-y-4 sm:col-span-2">
                  <div className="flex justify-between items-center">
                    <label className="text-[12px] font-bold text-on-surface/60">{t('settings.gridGap', '网格间距')}</label>
                    <span className="text-[13px] font-black text-primary">{theme.gridGap || 16}px</span>
                  </div>
                  <input type="range" min="4" max="64" step="4" value={theme.gridGap || 16} onChange={(e) => onThemeChange({ ...theme, gridGap: parseInt(e.target.value) })} className="w-full appearance-none h-1.5 bg-primary/10 rounded-full accent-primary" />
                </div>

                <div className="space-y-4 sm:col-span-2 rounded-2xl border border-primary/10 bg-primary/5 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-[12px] font-black text-on-surface">{t('settings.mediaGridItems', '多媒体项目')}</p>
                      <p className="text-[11px] text-on-surface/50 mt-1">
                        {theme.mediaGridLinked === false ? t('settings.mediaGridCustomDesc', '使用独立宽高') : t('settings.mediaGridLinkedDesc', '默认跟随普通网格大小')}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          const shouldLink = theme.mediaGridLinked === false;
                          onThemeChange({
                            ...theme,
                            mediaGridLinked: shouldLink,
                            mediaGridWidth: shouldLink ? (theme.gridWidth || 180) : (theme.mediaGridWidth || theme.gridWidth || 180),
                            mediaGridHeight: shouldLink ? (theme.gridHeight || 180) : (theme.mediaGridHeight || theme.gridHeight || 180),
                          });
                        }}
                        className={`px-3 py-1.5 rounded-xl text-[11px] font-black border transition-colors ${theme.mediaGridLinked === false ? 'bg-transparent border-primary/15 text-on-surface/50' : 'bg-primary text-on-primary border-primary'}`}
                      >
                        {t('settings.mediaGridSync', '同步调整')}
                      </button>
                      <button
                        type="button"
                        onClick={() => setShowMediaGridControls(prev => !prev)}
                        className="px-3 py-1.5 rounded-xl text-[11px] font-black text-primary bg-primary/10 hover:bg-primary/15 transition-colors inline-flex items-center gap-1.5"
                      >
                        {t('settings.more', '更多')} {showMediaGridControls ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                  </div>

                  <AnimatePresence initial={false}>
                    {showMediaGridControls && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        className="overflow-hidden"
                      >
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-8 pt-5">
                          <div className="space-y-4">
                            <div className="flex justify-between items-center">
                              <label className="text-[12px] font-bold text-on-surface/60">{t('settings.mediaGridWidth', '多媒体项目宽度')}</label>
                              <span className="text-[13px] font-black text-primary">{theme.mediaGridLinked === false ? (theme.mediaGridWidth || theme.gridWidth || 180) : (theme.gridWidth || 180)}px</span>
                            </div>
                            <input
                              type="range"
                              min="100"
                              max="800"
                              value={theme.mediaGridLinked === false ? (theme.mediaGridWidth || theme.gridWidth || 180) : (theme.gridWidth || 180)}
                              onChange={(e) => onThemeChange({ ...theme, mediaGridLinked: false, mediaGridWidth: parseInt(e.target.value) })}
                              className="w-full appearance-none h-1.5 bg-primary/10 rounded-full accent-primary"
                            />
                          </div>

                          <div className="space-y-4">
                            <div className="flex justify-between items-center">
                              <label className="text-[12px] font-bold text-on-surface/60">{t('settings.mediaGridHeight', '多媒体项目高度')}</label>
                              <span className="text-[13px] font-black text-primary">{theme.mediaGridLinked === false ? (theme.mediaGridHeight || theme.gridHeight || 180) : (theme.gridHeight || 180)}px</span>
                            </div>
                            <input
                              type="range"
                              min="100"
                              max="800"
                              value={theme.mediaGridLinked === false ? (theme.mediaGridHeight || theme.gridHeight || 180) : (theme.gridHeight || 180)}
                              onChange={(e) => onThemeChange({ ...theme, mediaGridLinked: false, mediaGridHeight: parseInt(e.target.value) })}
                              className="w-full appearance-none h-1.5 bg-primary/10 rounded-full accent-primary"
                            />
                          </div>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </div>
            </div>

            <div className="space-y-10">
               <div className="flex items-center gap-4">
                 <div className="w-10 h-10 rounded-2xl bg-secondary/10 flex items-center justify-center text-secondary">
                    <Columns className="w-5 h-5" />
                 </div>
                 <h4 className="text-[15px] font-black text-on-surface uppercase tracking-widest">{t('views.column')}</h4>
               </div>
               
               <div className="grid grid-cols-1 sm:grid-cols-2 gap-8">
                 <div className="space-y-4">
                   <div className="flex justify-between items-center">
                     <label className="text-[12px] font-bold text-on-surface/60">{t('settings.columnWidth', '列宽度')}</label>
                     <span className="text-[13px] font-black text-primary">{theme.columnWidth || 280}px</span>
                   </div>
                   <input type="range" min="200" max="600" value={theme.columnWidth || 280} onChange={(e) => onThemeChange({ ...theme, columnWidth: parseInt(e.target.value) })} className="w-full appearance-none h-1.5 bg-primary/10 rounded-full accent-primary" />
                 </div>

                 <div className="space-y-4">
                   <div className="flex justify-between items-center">
                     <label className="text-[12px] font-bold text-on-surface/60">{t('settings.columnHeight', '项目高度')}</label>
                     <span className="text-[13px] font-black text-primary">{theme.columnHeight || 60}px</span>
                   </div>
                   <input type="range" min="40" max="120" value={theme.columnHeight || 60} onChange={(e) => onThemeChange({ ...theme, columnHeight: parseInt(e.target.value) })} className="w-full appearance-none h-1.5 bg-primary/10 rounded-full accent-primary" />
                 </div>
               </div>

               <div className="space-y-6 pt-4">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-xl bg-primary/10 flex items-center justify-center text-primary">
                       <List className="w-4 h-4" />
                    </div>
                    <label className="text-[12px] font-black text-on-surface uppercase tracking-widest">{t('settings.listDensity', '列表模式密度')}</label>
                  </div>
                  <div className="bg-primary/5 p-1.5 rounded-2xl flex gap-1.5">
                    {[
                      { id: 'relaxed', label: t('settings.relaxed', '宽松'), scale: '100%' },
                      { id: 'normal', label: t('settings.normal', '标准'), scale: '90%' },
                      { id: 'compact', label: t('settings.compact', '紧凑'), scale: '80%' },
                      { id: 'ultra', label: t('settings.ultra', '极致'), scale: '70%' },
                    ].map((d) => {
                      const isActive = (theme.listDensity || 'normal') === d.id;
                      return (
                        <button
                          key={d.id}
                          onClick={() => onThemeChange({ ...theme, listDensity: d.id as any })}
                          className={`flex-1 py-3 rounded-xl flex flex-col items-center justify-center gap-1 transition-all relative
                            ${isActive ? 'text-on-primary' : 'text-on-surface/40 hover:text-on-surface/80 hover:bg-primary/10'}
                          `}
                        >
                          {isActive && (
                            <motion.div
                              layoutId="active-density-pill"
                              className="absolute inset-0 bg-primary rounded-xl z-0 shadow-lg shadow-primary/20"
                            />
                          )}
                          <span className="relative z-10 text-[12px] font-black">{d.label}</span>
                          <span className={`relative z-10 text-[9px] font-bold ${isActive ? 'text-on-primary/60' : 'text-on-surface/30'}`}>{d.scale}</span>
                        </button>
                      );
                    })}
                  </div>
                  <p className="text-[11px] text-on-surface/40 px-2 leading-relaxed">
                    调整列表视图中的项目间距与缩放比例。高密度设置会自动缩小图标及文字尺寸，以提升信息呈现效率。
                  </p>
               </div>
            </div>
         </div>
      </section>

      {/* Font & Language */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        <section className="bg-primary/5 rounded-3xl p-8 border border-primary/10 space-y-6">
          <h3 className="text-[17px] font-bold text-on-surface flex items-center gap-2">
            <Type className="w-4 h-4 text-primary" /> {t('settings.fontFamily')}
          </h3>
          <div className="relative">
            <select
              value={theme.fontFamily || 'Inter'}
              onChange={(e) => onThemeChange({ ...theme, fontFamily: e.target.value })}
              className="w-full bg-primary/5 border-2 border-primary/10 rounded-2xl px-5 py-4 text-[14px] text-on-surface font-bold appearance-none outline-none focus:ring-4 focus:ring-primary/10 focus:border-primary transition-all"
            >
              {availableFonts.map(font => (
                <option key={font} value={font === 'System Default' ? 'system-ui, sans-serif' : font} style={{ fontFamily: font }}>
                  {font}
                </option>
              ))}
            </select>
            <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none opacity-40">
               <ChevronRight className="w-4 h-4 rotate-90" />
            </div>
          </div>
        </section>

        <section className="bg-primary/5 rounded-3xl p-8 border border-primary/10 space-y-6">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1">
              <h3 className="text-[17px] font-bold text-on-surface flex items-center gap-2">
                <Languages className="w-4 h-4 text-primary" /> {t('settings.language')}
              </h3>
              <p className="text-[11px] text-on-surface/40 leading-relaxed">保留常用语言快速切换，更多语言通过管理面板扩展。</p>
            </div>
            <button
              onClick={() => setShowLanguageManager(true)}
              className="px-3 py-1.5 rounded-full bg-primary/10 text-primary text-[11px] font-black hover:bg-primary/20 transition-colors whitespace-nowrap"
            >
              管理语言
            </button>
          </div>
          <div className="flex gap-2 bg-primary/5 p-2 rounded-2xl items-center border border-primary/10">
            <button onClick={() => applyLanguage('zh')} className={`flex-1 py-4 rounded-xl text-[13px] font-black transition-all relative ${selectedLanguage === 'zh' && !theme.followSystemLanguage ? 'text-on-primary' : 'text-on-surface/40 hover:text-on-surface'}`}>
               {selectedLanguage === 'zh' && !theme.followSystemLanguage && <motion.div layoutId="nav-lang" className="absolute inset-0 bg-primary rounded-xl z-0 shadow-lg shadow-primary/20" />}
               <span className="relative z-10 uppercase tracking-widest">中文 (CN)</span>
            </button>
            <button onClick={() => applyLanguage('en')} className={`flex-1 py-4 rounded-xl text-[13px] font-black transition-all relative ${selectedLanguage === 'en' && !theme.followSystemLanguage ? 'text-on-primary' : 'text-on-surface/40 hover:text-on-surface'}`}>
               {selectedLanguage === 'en' && !theme.followSystemLanguage && <motion.div layoutId="nav-lang" className="absolute inset-0 bg-primary rounded-xl z-0 shadow-lg shadow-primary/20" />}
               <span className="relative z-10 uppercase tracking-widest">English</span>
            </button>
          </div>
          <button
            onClick={toggleFollowSystemLanguage}
            className="w-full flex items-center justify-between gap-4 px-4 py-3 rounded-2xl bg-primary/5 border border-primary/10 hover:border-primary/20 transition-all"
          >
            <div className="text-left">
              <p className="text-[13px] font-bold text-on-surface">跟随系统语言</p>
              <p className="text-[11px] text-on-surface/35 mt-0.5">当前系统建议：{systemLanguage === 'zh' ? '简体中文' : 'English'}</p>
            </div>
            <div className={`w-12 h-7 rounded-full p-1 transition-colors flex items-center ${theme.followSystemLanguage ? 'bg-primary' : 'bg-on-surface/[0.12]'}`}>
              <motion.div animate={{ x: theme.followSystemLanguage ? 20 : 0 }} className="w-5 h-5 rounded-full bg-white shadow-lg" />
            </div>
          </button>
        </section>
      </div>

      <AnimatePresence>
        {showLanguageManager && (
          <div className="fixed inset-0 z-[140] flex items-center justify-center p-8">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowLanguageManager(false)}
              className="absolute inset-0 bg-black/50 backdrop-blur-md"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.94, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.94, y: 20 }}
              className="relative w-full max-w-2xl rounded-[32px] bg-surface-container-high/95 border border-primary/20 shadow-2xl overflow-hidden"
            >
              <header className="px-8 py-6 border-b border-primary/10 flex items-center justify-between">
                <div>
                  <h3 className="text-[20px] font-black text-on-surface">语言管理</h3>
                  <p className="text-[12px] text-on-surface/40 mt-1">内置语言可立即切换，第三方语言包后续从这里导入和校验。</p>
                </div>
                <button onClick={() => setShowLanguageManager(false)} className="px-4 py-2 rounded-full bg-primary/10 text-primary text-[11px] font-black hover:bg-primary/20 transition-colors">完成</button>
              </header>

              <div className="p-8 space-y-4 max-h-[62vh] overflow-y-auto custom-scrollbar">
                {visibleLanguages.map(lang => {
                  const isCurrent = !theme.followSystemLanguage && selectedLanguage === lang.code;
                  const isAvailable = lang.source !== 'available';
                  return (
                    <button
                      key={lang.code}
                      onClick={() => isAvailable && applyLanguage(lang.code)}
                      disabled={!isAvailable}
                      className={`w-full rounded-2xl border px-5 py-4 flex items-center gap-4 text-left transition-all ${isCurrent ? 'bg-primary/10 border-primary/30' : 'bg-primary/5 border-primary/10 hover:border-primary/20'} ${!isAvailable ? 'opacity-55 cursor-not-allowed' : ''}`}
                    >
                      <div className={`w-11 h-11 rounded-xl flex items-center justify-center text-[12px] font-black ${isCurrent ? 'bg-primary text-on-primary' : 'bg-primary/10 text-primary'}`}>
                        {lang.code.toUpperCase()}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <p className="text-[14px] font-black text-on-surface truncate">{lang.nativeLabel}</p>
                          <span className="text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full bg-on-surface/10 text-on-surface/45">
                            {lang.source === 'built-in' ? '内置' : lang.source === 'imported' ? '已导入' : '可扩展'}
                          </span>
                        </div>
                        <p className="text-[11px] text-on-surface/35 mt-1">{lang.label} · 翻译完整度 {lang.completeness}%</p>
                      </div>
                      {isCurrent && <Check className="w-5 h-5 text-primary shrink-0" />}
                    </button>
                  );
                })}
              </div>

              <footer className="px-8 py-6 border-t border-primary/10 flex items-center justify-between gap-4">
                <div className="text-[11px] text-on-surface/35 leading-relaxed">
                  语言包接口已预留：`registerLanguagePack(code, translation)`。
                </div>
                <button className="px-5 py-3 rounded-2xl bg-primary text-on-primary text-[12px] font-black opacity-70 cursor-not-allowed" title={t('tooltips.nextLangPackImport')}>
                  导入语言包
                </button>
              </footer>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Live Preview Card — at bottom */}
      <section className="bg-primary/5 rounded-[40px] p-8 m3-card flex flex-col items-center justify-center relative overflow-hidden group border border-primary/20">
         <h3 className="text-[17px] font-black text-primary uppercase tracking-widest flex items-center gap-2 mb-8">
            <Sparkles className="w-4 h-4" /> 实时预览
         </h3>
         <div className="w-full max-w-[340px] bg-primary/20 border-2 border-primary/30 rounded-[32px] p-8 shadow-2xl backdrop-blur-3xl transition-all duration-700 hover:scale-[1.02] relative z-10">
            <div className="flex items-center gap-2 mb-8">
              <div className="w-3 h-3 rounded-full bg-primary/60" />
              <div className="w-3 h-3 rounded-full bg-primary/40" />
              <div className="w-3 h-3 rounded-full bg-primary/20" />
            </div>
            <div className="flex gap-4 mb-8">
              <div className="w-14 h-14 rounded-2xl flex items-center justify-center shadow-lg" style={{ backgroundColor: theme.accentColor }}>
                <ImageIcon className="w-7 h-7 text-on-surface mix-blend-difference" />
              </div>
              <div className="flex-1 space-y-4 py-2">
                <div className="h-4 bg-primary/40 rounded-full w-5/6" />
                <div className="h-3 bg-primary/20 rounded-full w-1/2" />
              </div>
            </div>
            <div className="space-y-4">
               <div className="h-12 rounded-2xl bg-primary/10 border border-primary/20 flex items-center px-4">
                  <div className="w-1/2 h-1.5 bg-primary/30 rounded-full" />
               </div>
               <div className="h-12 rounded-2xl bg-primary text-on-primary flex items-center justify-center text-[13px] font-black shadow-lg shadow-primary/30 uppercase tracking-widest">
                  Preview Content
               </div>
            </div>
         </div>
      </section>
    </div>
  );

  const renderFeaturesCategory = () => (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <section className="bg-primary/5 rounded-[32px] p-10 border border-primary/10 space-y-8">
        <h3 className="text-[18px] font-black text-on-surface flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-2xl bg-primary/10 flex items-center justify-center">
            <Monitor className="w-5 h-5 text-primary" />
          </div>
          窗口与标签页
        </h3>

        <div className="space-y-2">
          <div className="flex items-center justify-between p-6 bg-primary/5 rounded-2xl border border-transparent hover:border-primary/20 transition-all group">
            <div className="space-y-1">
              <h4 className="text-[15px] font-bold text-on-surface">Cmd+N 新建独立窗口</h4>
              <p className="text-[12px] text-on-surface/50">开启后 Cmd+N / 加号会新建独立窗口；关闭时默认新建标签页。拖出标签页始终会分离成窗口。</p>
            </div>
            <button
              onClick={() => onThemeChange({ ...theme, enableMultiWindow: !theme.enableMultiWindow })}
              className={`w-14 h-8 rounded-full p-1.5 transition-colors duration-300 flex items-center ${theme.enableMultiWindow ? 'bg-primary' : 'bg-on-surface/[0.1]'}`}
            >
              <motion.div animate={{ x: theme.enableMultiWindow ? 24 : 0 }} className="w-5 h-5 rounded-full shadow-lg bg-white" />
            </button>
          </div>

          <div className="flex items-center justify-between p-6 bg-primary/5 rounded-2xl border border-transparent hover:border-primary/20 transition-all group">
            <div className="space-y-1">
              <h4 className="text-[15px] font-bold text-on-surface">使用系统右键菜单</h4>
              <p className="text-[12px] text-on-surface/50">关闭应用内自定义右键菜单，交给 WebView / macOS 默认菜单；文件操作仍可通过工具栏、快捷键和预览面板完成。</p>
            </div>
            <button
              onClick={() => onThemeChange({ ...theme, useSystemContextMenu: !theme.useSystemContextMenu })}
              className={`w-14 h-8 rounded-full p-1.5 transition-colors duration-300 flex items-center ${theme.useSystemContextMenu ? 'bg-primary' : 'bg-on-surface/[0.1]'}`}
            >
              <motion.div animate={{ x: theme.useSystemContextMenu ? 24 : 0 }} className="w-5 h-5 rounded-full shadow-lg bg-white" />
            </button>
          </div>

          <div className="flex items-center justify-between p-6 bg-primary/5 rounded-2xl border border-transparent hover:border-primary/20 transition-all group">
            <div className="space-y-1">
              <h4 className="text-[15px] font-bold text-on-surface">空格键预览</h4>
              <p className="text-[12px] text-on-surface/50">按空格键调用 macOS Quick Look 快速预览选中文件。</p>
            </div>
            <button
              onClick={() => onThemeChange({ ...theme, enableSpacePreview: theme.enableSpacePreview === false })}
              className={`w-14 h-8 rounded-full p-1.5 transition-colors duration-300 flex items-center ${theme.enableSpacePreview !== false ? 'bg-primary' : 'bg-on-surface/[0.1]'}`}
            >
              <motion.div animate={{ x: theme.enableSpacePreview !== false ? 24 : 0 }} className={`w-5 h-5 rounded-full shadow-lg ${theme.enableSpacePreview !== false ? 'bg-on-primary' : 'bg-on-surface/30'}`} />
            </button>
          </div>

          <div className="flex items-center justify-between p-6 bg-primary/5 rounded-2xl border border-transparent hover:border-primary/20 transition-all group">
            <div className="space-y-1">
              <h4 className="text-[15px] font-bold text-on-surface">开发者控制台</h4>
              <p className="text-[12px] text-on-surface/50">开启后在底部状态栏右下角显示「控制台」按钮，点击即可打开 WebView 开发者工具。正式版本中也能使用。</p>
            </div>
            <button
              onClick={() => onThemeChange({ ...theme, enableDevTools: !theme.enableDevTools })}
              className={`w-14 h-8 rounded-full p-1.5 transition-colors duration-300 flex items-center ${theme.enableDevTools ? 'bg-primary' : 'bg-on-surface/[0.1]'}`}
            >
              <motion.div animate={{ x: theme.enableDevTools ? 24 : 0 }} className="w-5 h-5 rounded-full shadow-lg bg-white" />
            </button>
          </div>
        </div>
      </section>

      <section className="bg-primary/5 rounded-[32px] p-10 border border-primary/10 space-y-6">
        <h3 className="text-[18px] font-black text-on-surface">快捷键参考</h3>
        <div className="grid grid-cols-2 gap-3 text-[13px]">
          {[
            ['Cmd+A', '全选'],
            ['Cmd+C', '复制到文件剪贴板'],
            ['Cmd+N', '新建窗口（需开启多窗口）'],
            ['Cmd+W', '关闭标签'],
            ['Delete', '移至废纸篓'],
            ['Enter', '打开文件'],
            ['Space', 'Quick Look'],
            ['Cmd+I', '文件简介'],
            ['Cmd+Shift+R', 'AI 批量重命名'],
          ].map(([key, desc]) => (
            <div key={key} className="flex items-center gap-3 px-4 py-3 bg-primary/5 rounded-xl">
              <kbd className="px-2 py-1 bg-primary/10 border border-primary/20 rounded-md text-[11px] font-mono font-bold text-primary whitespace-nowrap">{key}</kbd>
              <span className="text-on-surface/60">{desc}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="bg-primary/5 rounded-[32px] p-10 border border-primary/10 space-y-6">
        <h3 className="text-[18px] font-black text-on-surface flex items-center gap-3">
          <Terminal className="w-5 h-5 text-primary" /> 终端偏好
        </h3>
        <label className="space-y-2 block">
          <span className="text-[12px] font-black text-on-surface/50 uppercase tracking-wider">默认终端</span>
          <div className="flex gap-2">
            <select
              value={theme.terminalApp || 'Terminal'}
              onChange={(e) => onThemeChange({ ...theme, terminalApp: e.target.value })}
              className="flex-1 bg-primary/5 border border-primary/20 rounded-2xl px-5 py-4 text-[14px] text-on-surface font-bold outline-none focus:border-primary"
            >
              {terminalApps.map(app => <option key={app} value={app}>{app}</option>)}
            </select>
            <button
              onClick={() => {
                invoke<string[]>('list_terminal_apps').then(apps => setTerminalApps(apps.length ? apps : ['Terminal', 'iTerm']));
              }}
              className="px-4 bg-primary/10 hover:bg-primary/20 rounded-2xl text-[12px] font-bold text-primary transition-colors"
              title={t('tooltips.refreshTerminalList')}
            >
              <RefreshCw className="w-4 h-4" />
            </button>
            <button
              onClick={async () => {
                try {
                  const result = await open({ multiple: false, directory: false, filters: [{ name: '应用', extensions: ['app'] }] });
                  if (result && typeof result === 'string') {
                    const appName = result.split('/').pop()?.replace('.app', '') || result;
                    if (!terminalApps.includes(appName)) {
                      const newApps = [...terminalApps, appName];
                      setTerminalApps(newApps);
                      onThemeChange({ ...theme, terminalApp: appName });
                    } else {
                      onThemeChange({ ...theme, terminalApp: appName });
                    }
                  }
                } catch {}
              }}
              className="px-4 bg-primary/10 hover:bg-primary/20 rounded-2xl text-[12px] font-bold text-primary transition-colors"
              title={t('tooltips.selectTerminalApp')}
            >
              <Upload className="w-4 h-4" />
            </button>
          </div>
        </label>

        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-[12px] font-black text-on-surface/50 uppercase tracking-wider">启动后执行脚本</span>
            <button
              onClick={() => {
                const scripts = [...(theme.terminalScripts || []), { script: '', enabled: true }];
                onThemeChange({ ...theme, terminalScripts: scripts });
              }}
              className="px-3 py-1.5 bg-primary/10 hover:bg-primary/20 rounded-xl text-[11px] font-bold text-primary transition-colors flex items-center gap-1.5"
            >
              <Plus className="w-3.5 h-3.5" /> 添加行
            </button>
          </div>
          {(theme.terminalScripts || []).length === 0 ? (
            <p className="text-[12px] text-on-surface/30 py-3">未配置脚本。点击"添加行"开始。</p>
          ) : (
            (theme.terminalScripts || []).map((item, idx) => (
              <div key={idx} className="flex gap-2 items-center">
                <input
                  type="checkbox"
                  checked={item.enabled}
                  onChange={() => {
                    const scripts = [...(theme.terminalScripts || [])];
                    scripts[idx] = { ...scripts[idx], enabled: !scripts[idx].enabled };
                    onThemeChange({ ...theme, terminalScripts: scripts });
                  }}
                  className="w-3.5 h-3.5 accent-primary cursor-pointer shrink-0"
                />
                <input
                  value={item.script}
                  onChange={(e) => {
                    const scripts = [...(theme.terminalScripts || [])];
                    scripts[idx] = { ...scripts[idx], script: e.target.value };
                    onThemeChange({ ...theme, terminalScripts: scripts });
                  }}
                  placeholder={`第 ${idx + 1} 行：例如 npm run dev`}
                  className={`flex-1 bg-primary/5 border border-primary/20 rounded-xl px-4 py-3 text-[13px] font-mono outline-none focus:border-primary ${item.enabled ? 'text-on-surface' : 'text-on-surface/30 line-through'}`}
                />
                <button
                  onClick={async () => {
                    try {
                      const result = await open({ multiple: false, directory: false, filters: [{ name: '脚本', extensions: ['sh', 'bash', 'zsh', 'command', 'py', 'js', 'ts'] }] });
                      if (result && typeof result === 'string') {
                        const scripts = [...(theme.terminalScripts || [])];
                        scripts[idx] = { ...scripts[idx], script: result };
                        onThemeChange({ ...theme, terminalScripts: scripts });
                      }
                    } catch {}
                  }}
                  className="p-2.5 bg-primary/10 hover:bg-primary/20 rounded-xl text-primary transition-colors shrink-0"
                  title={t('tooltips.selectScriptFile')}
                >
                  <Folder className="w-4 h-4" />
                </button>
                <button
                  onClick={() => {
                    const scripts = (theme.terminalScripts || []).filter((_, i) => i !== idx);
                    onThemeChange({ ...theme, terminalScripts: scripts.length ? scripts : undefined });
                  }}
                  className="p-2.5 hover:bg-red-500/10 rounded-xl text-on-surface/40 hover:text-red-500 transition-colors shrink-0"
                  title={t('tooltips.deleteThisLine')}
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            ))
          )}
          {((theme.terminalScripts || []).length > 0) && (
            <p className="text-[11px] text-on-surface/30">每行按顺序依次执行。勾选框控制启用/禁用。</p>
          )}
        </div>

        <label className="space-y-2 block">
          <span className="text-[12px] font-black text-on-surface/50 uppercase tracking-wider">自定义命令（高级，可选）</span>
          <input
            value={theme.customTerminalCommand || ''}
            onChange={(e) => onThemeChange({ ...theme, customTerminalCommand: e.target.value })}
            placeholder={t('placeholders.beforeEnterDir')}
            className="w-full bg-primary/5 border border-primary/20 rounded-2xl px-5 py-4 text-[13px] text-on-surface font-mono outline-none focus:border-primary"
          />
        </label>
      </section>
    </div>
  );

  const [aiTestStatus, setAiTestStatus] = useState<Record<string, 'idle' | 'testing' | 'ok' | 'fail'>>({});
  const [aiTestError, setAiTestError] = useState<Record<string, string>>({});
  const [aiModels, setAiModels] = useState<Record<string, string[]>>({});
  const [aiModelLoading, setAiModelLoading] = useState<Record<string, boolean>>({});
  const [aiModelDropdown, setAiModelDropdown] = useState<string | null>(null);
  const [aiModelSearch, setAiModelSearch] = useState('');

  const aiProviders = theme.aiProviders || [];
  const updateProviders = (providers: AIProviderConfig[]) => onThemeChange({ ...theme, aiProviders: providers });

  const addProvider = (type: 'claude' | 'openai' | 'ollama') => {
    const defaults: Record<string, Partial<AIProviderConfig>> = {
      claude: { name: 'Claude', baseUrl: 'https://api.anthropic.com', model: 'claude-sonnet-4-20250514' },
      openai: { name: 'OpenAI', baseUrl: 'https://api.openai.com', model: 'gpt-4o' },
      ollama: { name: 'Ollama (本地)', baseUrl: 'http://localhost:11434', model: 'llama3' },
    };
    const d = defaults[type]!;
    const id = `${type}-${Date.now()}`;
    const newProvider: AIProviderConfig = { id, type, enabled: true, name: d.name!, baseUrl: d.baseUrl, model: d.model };
    const updated = [...aiProviders, newProvider];
    onThemeChange({ ...theme, aiProviders: updated, aiActiveProvider: theme.aiActiveProvider || id });
  };

  const handleTestProvider = async (provider: AIProviderConfig) => {
    setAiTestStatus(s => ({ ...s, [provider.id]: 'testing' }));
    const result = await testProviderConnection(provider);
    setAiTestStatus(s => ({ ...s, [provider.id]: result.ok ? 'ok' : 'fail' }));
    if (result.error) setAiTestError(s => ({ ...s, [provider.id]: result.error! }));
  };

  const handleFetchModels = async (provider: AIProviderConfig) => {
    setAiModelLoading(s => ({ ...s, [provider.id]: true }));
    const result = await fetchModels(provider);
    setAiModelLoading(s => ({ ...s, [provider.id]: false }));
    if (result.error) {
      setAiTestError(s => ({ ...s, [provider.id]: result.error! }));
    } else {
      setAiModels(s => ({ ...s, [provider.id]: result.models }));
    }
  };

  const renderAICategory = () => (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* 添加服务商 */}
      <div className="flex items-center gap-3">
        <span className="text-[12px] font-black text-on-surface/40 uppercase tracking-wider">添加服务商</span>
        <div className="flex gap-2">
          {[
            { type: 'claude' as const, label: 'Claude' },
            { type: 'openai' as const, label: 'OpenAI / 中转站' },
            { type: 'ollama' as const, label: 'Ollama 本地' },
          ].map(item => (
            <button
              key={item.type}
              onClick={() => addProvider(item.type)}
              className="px-4 py-2 bg-primary/10 hover:bg-primary/20 rounded-xl text-[12px] font-bold text-primary transition-colors"
            >
              + {item.label}
            </button>
          ))}
        </div>
      </div>

      {aiProviders.length === 0 && (
        <div className="text-center py-16 text-on-surface/25">
          <Sparkles className="w-10 h-10 mx-auto mb-4 opacity-30" />
          <p className="text-[14px] font-medium">尚未配置 AI 服务</p>
          <p className="text-[12px] mt-2">点击上方按钮添加一个服务商，用于 AI 批量重命名等智能功能</p>
        </div>
      )}

      {/* Provider 列表 */}
      {aiProviders.map((provider, idx) => (
        <section key={provider.id} className={`rounded-[28px] p-8 border space-y-5 transition-all ${theme.aiActiveProvider === provider.id ? 'bg-primary/10 border-primary/30' : 'bg-primary/5 border-primary/10'}`}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <button
                onClick={() => onThemeChange({ ...theme, aiActiveProvider: provider.id })}
                className={`w-4 h-4 rounded-full border-2 transition-colors ${theme.aiActiveProvider === provider.id ? 'border-primary bg-primary' : 'border-on-surface/20 hover:border-primary/50'}`}
              >
                {theme.aiActiveProvider === provider.id && <div className="w-1.5 h-1.5 rounded-full bg-white mx-auto mt-[3px]" />}
              </button>
              <input
                value={provider.name}
                onChange={e => { const p = [...aiProviders]; p[idx] = { ...p[idx], name: e.target.value }; updateProviders(p); }}
                className="text-[15px] font-black text-on-surface bg-transparent outline-none border-b border-transparent focus:border-primary/30 w-48"
              />
              <span className="text-[10px] font-bold text-on-surface/30 uppercase bg-primary/5 px-2 py-0.5 rounded">{provider.type}</span>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => { const p = [...aiProviders]; p[idx] = { ...p[idx], enabled: !p[idx].enabled }; updateProviders(p); }}
                className={`w-9 h-5 rounded-full p-0.5 transition-colors ${provider.enabled ? 'bg-primary' : 'bg-on-surface/15'}`}
              >
                <motion.div animate={{ x: provider.enabled ? 16 : 0 }} className="w-4 h-4 rounded-full bg-white shadow" />
              </button>
              <button
                onClick={() => updateProviders(aiProviders.filter((_, i) => i !== idx))}
                className="p-1.5 hover:bg-red-500/10 rounded-lg text-on-surface/30 hover:text-red-500 transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          <div className="space-y-6">
            {provider.type !== 'ollama' && (
              <label className="space-y-2 block">
                <span className="text-[11px] font-black text-on-surface/30 uppercase tracking-[0.2em]">API Key</span>
                <input
                  type="password"
                  value={provider.apiKey || ''}
                  onChange={e => { const p = [...aiProviders]; p[idx] = { ...p[idx], apiKey: e.target.value || undefined }; updateProviders(p); }}
                  placeholder={provider.type === 'claude' ? 'sk-ant-...' : 'sk-...'}
                  className="w-full bg-primary/5 border border-primary/20 rounded-2xl px-5 py-4 text-[13px] font-mono outline-none focus:border-primary focus:ring-4 focus:ring-primary/10 transition-all"
                />
              </label>
            )}
            <label className="space-y-2 block">
              <span className="text-[11px] font-black text-on-surface/30 uppercase tracking-[0.2em]">Base URL</span>
              <input
                value={provider.baseUrl || ''}
                onChange={e => { const p = [...aiProviders]; p[idx] = { ...p[idx], baseUrl: e.target.value }; updateProviders(p); }}
                placeholder={provider.type === 'ollama' ? 'http://localhost:11434' : provider.type === 'claude' ? 'https://api.anthropic.com' : 'https://api.openai.com'}
                className="w-full bg-primary/5 border border-primary/20 rounded-2xl px-5 py-4 text-[13px] font-mono outline-none focus:border-primary focus:ring-4 focus:ring-primary/10 transition-all"
              />
              <p className="text-[11px] text-on-surface/25 font-mono mt-1.5 pl-1">→ {getProviderApiUrl(provider)}</p>
            </label>

            <div className="space-y-2">
              <span className="text-[11px] font-black text-on-surface/30 uppercase tracking-[0.2em]">模型</span>
              <div className="flex gap-3">
                <div className="flex-1 relative">
                  <button
                    onClick={() => { setAiModelDropdown(aiModelDropdown === provider.id ? null : provider.id); setAiModelSearch(''); }}
                    className="w-full bg-primary/5 border border-primary/20 rounded-2xl px-5 py-4 text-[13px] text-on-surface font-bold outline-none text-left flex items-center justify-between transition-all hover:border-primary/40"
                  >
                    <span className={provider.model ? 'text-on-surface' : 'text-on-surface/30'}>{provider.model || '选择模型...'}</span>
                    <ChevronDown className={`w-4 h-4 text-on-surface/30 transition-transform ${aiModelDropdown === provider.id ? 'rotate-180' : ''}`} />
                  </button>
                  {aiModelDropdown === provider.id && (
                    <div className="absolute top-full left-0 right-0 mt-2 z-50 bg-surface/95 backdrop-blur-3xl border border-primary/20 rounded-2xl shadow-2xl overflow-hidden">
                      <div className="p-3 border-b border-primary/10">
                        <input
                          value={aiModelSearch}
                          onChange={e => setAiModelSearch(e.target.value)}
                          placeholder="搜索模型..."
                          autoFocus
                          className="w-full bg-primary/5 border border-primary/10 rounded-xl px-4 py-2.5 text-[12px] outline-none focus:border-primary"
                        />
                      </div>
                      <div className="max-h-[240px] overflow-y-auto p-2 space-y-0.5">
                        {(aiModels[provider.id] || [])
                          .filter(m => !aiModelSearch || m.toLowerCase().includes(aiModelSearch.toLowerCase()))
                          .map(m => (
                            <button
                              key={m}
                              onClick={() => { const p = [...aiProviders]; p[idx] = { ...p[idx], model: m }; updateProviders(p); setAiModelDropdown(null); }}
                              className={`w-full text-left px-4 py-2.5 rounded-xl text-[12px] font-mono transition-colors ${provider.model === m ? 'bg-primary/20 text-primary font-bold' : 'text-on-surface/70 hover:bg-primary/10'}`}
                            >
                              {m}
                            </button>
                          ))}
                        {(aiModels[provider.id] || []).filter(m => !aiModelSearch || m.toLowerCase().includes(aiModelSearch.toLowerCase())).length === 0 && (
                          <p className="text-[12px] text-on-surface/30 text-center py-4">
                            {(aiModels[provider.id] || []).length === 0 ? '点击「获取模型」拉取列表' : '无匹配结果'}
                          </p>
                        )}
                      </div>
                    </div>
                  )}
                </div>
                <button
                  onClick={() => handleFetchModels(provider)}
                  disabled={aiModelLoading[provider.id]}
                  className="px-5 bg-primary/10 hover:bg-primary/20 rounded-2xl text-[13px] font-bold text-primary transition-all flex items-center gap-2 disabled:opacity-50 shrink-0"
                >
                  {aiModelLoading[provider.id] ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                  获取模型
                </button>
              </div>
            </div>

            <div className="flex items-center gap-4 pt-2">
              <button
                onClick={() => handleTestProvider(provider)}
                disabled={aiTestStatus[provider.id] === 'testing'}
                className="px-5 py-3 bg-primary/10 hover:bg-primary/20 rounded-2xl text-[13px] font-bold text-primary transition-all flex items-center gap-2 disabled:opacity-50"
              >
                {aiTestStatus[provider.id] === 'testing' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                测试连接
              </button>
              {aiTestStatus[provider.id] === 'ok' && <span className="text-[12px] text-green-500 font-bold">✓ 连接成功</span>}
              {aiTestStatus[provider.id] === 'fail' && (
                <p className="text-[12px] text-red-500 font-medium leading-relaxed break-all flex-1">{aiTestError[provider.id]}</p>
              )}
            </div>
          </div>
        </section>
      ))}

      {/* 使用说明 */}
      <div className="rounded-2xl bg-primary/5 border border-primary/10 p-6 space-y-3">
        <h4 className="text-[13px] font-black text-on-surface/50">使用说明</h4>
        <ul className="text-[12px] text-on-surface/40 space-y-1.5 list-disc list-inside">
          <li>选中多个文件后按 <kbd className="px-1.5 py-0.5 bg-primary/10 rounded text-primary font-mono text-[10px]">⌘⇧R</kbd> 触发 AI 批量重命名</li>
          <li>也可通过右键菜单或工具栏「更多」菜单触发</li>
          <li>中转站：选择 OpenAI 类型，将 Base URL 改为中转站地址即可</li>
          <li>本地模型：确保 Ollama 已启动，填入正确的地址和模型名</li>
          <li>圆点标记 = 当前激活的服务商，AI 功能将使用该服务商</li>
        </ul>
      </div>
    </div>
  );

  const renderAboutCategory = () => (
    <div className="-mt-8 space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <section className="bg-primary/5 rounded-[32px] p-10 border border-primary/10 space-y-8">
        <div className="flex items-start justify-between gap-8">
          <div className="flex items-center gap-5">
            <div className="w-16 h-16 rounded-2xl bg-primary text-on-primary flex items-center justify-center shadow-xl shadow-primary/20">
              <span className="text-[20px] font-black">AE</span>
            </div>
            <div>
              <h3 className="text-[24px] font-black text-on-surface tracking-tight">Aether Explorer</h3>
              <p className="text-[13px] text-on-surface/45 mt-1">macOS 文件管理器 · Tauri v2 / React / Rust</p>
            </div>
          </div>
          <span className="px-4 py-2 rounded-full bg-primary/10 text-primary text-[11px] font-black uppercase tracking-widest">v{appVersion || '0.0.0'}</span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[
            ['构建渠道', 'Developer Preview'],
            ['更新策略', 'GitHub Release'],
            ['运行环境', 'macOS Desktop'],
          ].map(([label, value]) => (
            <div key={label} className="rounded-2xl bg-primary/5 border border-primary/10 px-5 py-4">
              <p className="text-[11px] font-black text-on-surface/35 uppercase tracking-wider">{label}</p>
              <p className="text-[15px] font-black text-on-surface mt-2">{value}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="bg-primary/5 rounded-[32px] p-10 border border-primary/10 space-y-6">
        <div className="flex items-start justify-between gap-6">
          <div className="flex items-center gap-4 min-w-0">
            <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center shrink-0">
              <FileText className="w-6 h-6 text-primary" />
            </div>
            <div className="min-w-0">
              <h3 className="text-[18px] font-black text-on-surface">{t('settings.diagnostics.title')}</h3>
              <p className="text-[12px] text-on-surface/45 mt-1 leading-relaxed">{t('settings.diagnostics.description')}</p>
            </div>
          </div>
          {diagnosticsStatus.loading && <Loader2 className="w-5 h-5 text-primary animate-spin shrink-0" />}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <button
            onClick={handleCopyDiagnostics}
            disabled={diagnosticsStatus.loading}
            className="px-5 py-4 rounded-2xl bg-primary/10 text-primary text-[12px] font-black flex items-center justify-center gap-2 hover:bg-primary/20 transition-colors disabled:opacity-60"
          >
            <Copy className="w-4 h-4" />
            {t('settings.diagnostics.copyInfo')}
          </button>
          <button
            onClick={handleOpenLogsDir}
            disabled={diagnosticsStatus.loading}
            className="px-5 py-4 rounded-2xl bg-primary/10 text-primary text-[12px] font-black flex items-center justify-center gap-2 hover:bg-primary/20 transition-colors disabled:opacity-60"
          >
            <Folder className="w-4 h-4" />
            {t('settings.diagnostics.openLogs')}
          </button>
          <button
            onClick={handleOpenConfigDir}
            disabled={diagnosticsStatus.loading}
            className="px-5 py-4 rounded-2xl bg-primary/10 text-primary text-[12px] font-black flex items-center justify-center gap-2 hover:bg-primary/20 transition-colors disabled:opacity-60"
          >
            <Folder className="w-4 h-4" />
            {t('settings.diagnostics.openConfig')}
          </button>
          <button
            onClick={handleReadLastPanicLog}
            disabled={diagnosticsStatus.loading}
            className="px-5 py-4 rounded-2xl bg-primary/10 text-primary text-[12px] font-black flex items-center justify-center gap-2 hover:bg-primary/20 transition-colors disabled:opacity-60"
          >
            <FileText className="w-4 h-4" />
            {t('settings.diagnostics.loadPanicLog')}
          </button>
          <button
            onClick={() => safeShellOpen(ISSUE_URL).catch(() => {})}
            className="px-5 py-4 rounded-2xl bg-primary text-on-primary text-[12px] font-black flex items-center justify-center gap-2 shadow-lg shadow-primary/20 hover:bg-primary/90 transition-colors"
          >
            <ExternalLink className="w-4 h-4" />
            {t('settings.diagnostics.openIssue')}
          </button>
        </div>

        {diagnosticsStatus.message && (
          <div className={`rounded-2xl border px-5 py-4 flex items-center gap-3 ${
            diagnosticsStatus.kind === 'error'
              ? 'bg-red-500/10 border-red-500/20 text-red-500'
              : 'bg-primary/5 border-primary/10 text-on-surface/70'
          }`}>
            {diagnosticsStatus.kind === 'error' ? <X className="w-5 h-5 shrink-0" /> : <BadgeCheck className="w-5 h-5 text-primary shrink-0" />}
            <span className="text-[13px] font-bold leading-relaxed">{diagnosticsStatus.message}</span>
          </div>
        )}

        {lastPanicLog !== null && (
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <h4 className="text-[12px] font-black text-on-surface/45 uppercase tracking-widest">{t('settings.diagnostics.lastPanicLog')}</h4>
              {lastPanicLog && (
                <button
                  onClick={handleCopyPanicLog}
                  className="px-3 py-2 rounded-xl bg-primary/10 text-primary text-[11px] font-black flex items-center gap-1.5 hover:bg-primary/20 transition-colors"
                >
                  <Copy className="w-3.5 h-3.5" />
                  {t('settings.diagnostics.copyPanicLog')}
                </button>
              )}
            </div>
            <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-words rounded-2xl bg-on-surface/[0.04] border border-primary/10 p-4 text-[11px] leading-relaxed text-on-surface/65 font-mono">
              {lastPanicLog || t('settings.diagnostics.noPanicLog')}
            </pre>
          </div>
        )}
      </section>

      <section className="bg-primary/5 rounded-[32px] p-10 border border-primary/10 space-y-6">
        <div className="flex items-center justify-between gap-6">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center">
              <DownloadCloud className="w-6 h-6 text-primary" />
            </div>
            <div>
              <h3 className="text-[18px] font-black text-on-surface">{t('settings.update.title')}</h3>
              <p className="text-[12px] text-on-surface/45 mt-1">{t('settings.update.description')}</p>
            </div>
          </div>
          <button
            onClick={handleCheckUpdates}
            disabled={['checking', 'downloading', 'installing', 'restarting'].includes(updateStatus.state)}
            className="px-5 py-3 rounded-2xl bg-primary text-on-primary text-[12px] font-black flex items-center gap-2 shadow-xl shadow-primary/20 disabled:opacity-60 whitespace-nowrap shrink-0"
          >
            <RefreshCw className={`w-4 h-4 ${updateStatus.state === 'checking' ? 'animate-spin' : ''}`} />
            {updateStatus.state === 'checking' ? t('settings.update.checkingButton') : t('settings.update.checkButton')}
          </button>
        </div>

        <div className="rounded-2xl bg-primary/5 border border-primary/10 px-5 py-4 flex items-center gap-3">
          {(['checking', 'downloading', 'installing', 'restarting'] as const).includes(updateStatus.state as any) ? (
            <Loader2 className="w-5 h-5 text-primary animate-spin shrink-0" />
          ) : updateStatus.state === 'error' ? (
            <X className="w-5 h-5 text-red-500 shrink-0" />
          ) : (
            <BadgeCheck className="w-5 h-5 text-primary shrink-0" />
          )}
          <span className="text-[13px] font-bold text-on-surface/70">
            {updateStatus.state === 'idle' ? t('settings.update.idleHint') : updateStatus.message}
          </span>
        </div>

        <AnimatePresence mode="wait">
          {(updateStatus.state === 'downloading' || updateStatus.state === 'installing' || updateStatus.state === 'restarting') && (
            <motion.div
              key="progress"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              className="space-y-3"
            >
              <div className="flex items-center justify-between text-[11px] font-black text-on-surface/55 uppercase tracking-widest">
                <span>
                  {updateStatus.state === 'downloading'
                    ? t('settings.update.downloading')
                    : updateStatus.state === 'installing'
                    ? t('settings.update.installing')
                    : t('settings.update.restarting')}
                </span>
                <span className="text-on-surface tabular-nums">
                  {(() => {
                    const total = updateStatus.contentLength;
                    const done = updateStatus.downloaded;
                    if (updateStatus.state === 'installing' || updateStatus.state === 'restarting') return '100%';
                    if (total > 0) return `${Math.min(100, Math.round((done / total) * 100))}%`;
                    return formatBytes(done);
                  })()}
                </span>
              </div>
              <div className="relative h-2 rounded-full bg-primary/10 overflow-hidden">
                <motion.div
                  className="absolute inset-y-0 left-0 bg-primary rounded-full"
                  initial={{ width: '0%' }}
                  animate={{
                    width:
                      updateStatus.state === 'installing' || updateStatus.state === 'restarting'
                        ? '100%'
                        : updateStatus.contentLength > 0
                        ? `${Math.min(100, (updateStatus.downloaded / updateStatus.contentLength) * 100)}%`
                        : '20%',
                  }}
                  transition={{ duration: updateStatus.state === 'downloading' && updateStatus.contentLength === 0 ? 1.2 : 0.4, ease: 'easeOut', repeat: updateStatus.state === 'downloading' && updateStatus.contentLength === 0 ? Infinity : 0, repeatType: 'reverse' }}
                />
              </div>
              {updateStatus.state === 'downloading' && updateStatus.contentLength > 0 && (
                <p className="text-[11px] text-on-surface/45 tabular-nums">
                  {formatBytes(updateStatus.downloaded)} / {formatBytes(updateStatus.contentLength)}
                </p>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        {updateStatus.state === 'available' && (
          <>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="rounded-2xl bg-primary/5 border border-primary/10 px-4 py-3">
              <p className="text-[11px] font-black text-on-surface/35 uppercase tracking-widest">{t('settings.update.currentVersion')}</p>
              <p className="text-[13px] font-black text-on-surface mt-1 truncate">{updateStatus.currentVersion || t('settings.update.unknown')}</p>
            </div>
            <div className="rounded-2xl bg-primary/5 border border-primary/10 px-4 py-3">
              <p className="text-[11px] font-black text-on-surface/35 uppercase tracking-widest">{t('settings.update.latestVersion')}</p>
              <p className="text-[13px] font-black text-on-surface mt-1 truncate">{updateStatus.latestVersion || t('settings.update.unknown')}</p>
            </div>
          </div>
          {updateStatus.notes && (
            <div className="rounded-2xl bg-primary/5 border border-primary/10 px-4 py-3 max-h-40 overflow-y-auto">
              <p className="text-[11px] font-black text-on-surface/35 uppercase tracking-widest mb-2">{t('settings.update.releaseNotes')}</p>
              <p className="text-[12px] text-on-surface/75 whitespace-pre-wrap leading-relaxed">{updateStatus.notes}</p>
            </div>
          )}
          <div className="flex gap-3">
            <button
              onClick={handleDownloadUpdate}
              className="flex-1 py-3 rounded-2xl bg-green-500 text-white text-[13px] font-black flex items-center justify-center gap-2 shadow-lg shadow-green-500/20 hover:bg-green-400 transition-colors"
            >
              <DownloadCloud className="w-4 h-4" /> {t('settings.update.downloadAndInstall')}
            </button>
            <button
              onClick={() => updateStatus.releaseUrl && safeShellOpen(updateStatus.releaseUrl).catch(() => {})}
              className="flex-1 py-3 rounded-2xl bg-primary text-on-primary text-[13px] font-black flex items-center justify-center gap-2 shadow-lg shadow-primary/20 hover:bg-primary/80 transition-colors"
            >
              <ExternalLink className="w-4 h-4" /> {t('settings.update.viewRelease')}
            </button>
          </div>
          </>
        )}

        {updateStatus.state === 'restarting' && (
          <div className="flex items-center justify-center gap-2 py-3 text-[12px] font-black text-primary">
            <RotateCw className="w-4 h-4 animate-spin" />
            {t('settings.update.restartingHint')}
          </div>
        )}
      </section>

      <section className="bg-primary/5 rounded-[32px] p-10 border border-primary/10 space-y-6">
        <div className="flex items-center justify-between gap-6">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center">
              <Trash2 className="w-6 h-6 text-primary" />
            </div>
            <div>
              <h3 className="text-[18px] font-black text-on-surface">清理缓存</h3>
              <p className="text-[12px] text-on-surface/45 mt-1">清理应用产生的临时文件、缓存数据和拖拽传输记录，释放存储空间。</p>
            </div>
          </div>
          <button
            onClick={handleCleanup}
            disabled={cleanupStatus.cleaning}
            className="px-5 py-3 rounded-2xl bg-primary text-on-primary text-[12px] font-black flex items-center gap-2 shadow-xl shadow-primary/20 disabled:opacity-60 whitespace-nowrap shrink-0"
          >
            <Trash2 className={`w-4 h-4 ${cleanupStatus.cleaning ? 'animate-pulse' : ''}`} />
            {cleanupStatus.cleaning ? '清理中' : '立即清理'}
          </button>
        </div>
        {cleanupStatus.message && (
          <div className="rounded-2xl bg-primary/5 border border-primary/10 px-5 py-4 flex items-center gap-3">
            <BadgeCheck className="w-5 h-5 text-primary" />
            <span className="text-[13px] font-bold text-on-surface/70">
              {cleanupStatus.message}
            </span>
          </div>
        )}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="rounded-2xl bg-primary/5 border border-primary/10 px-4 py-3">
            <p className="text-[11px] font-black text-on-surface/35 uppercase tracking-widest">缓存类型</p>
            <p className="text-[13px] font-black text-on-surface mt-1">拖拽传输 · 临时数据</p>
          </div>
          <div className="rounded-2xl bg-primary/5 border border-primary/10 px-4 py-3">
            <p className="text-[11px] font-black text-on-surface/35 uppercase tracking-widest">存储位置</p>
            <p className="text-[13px] font-black text-on-surface mt-1">LocalStorage · SessionStorage</p>
          </div>
          <div className="rounded-2xl bg-primary/5 border border-primary/10 px-4 py-3">
            <p className="text-[11px] font-black text-on-surface/35 uppercase tracking-widest">清理策略</p>
            <p className="text-[13px] font-black text-on-surface mt-1">保留设置 · 清理缓存</p>
          </div>
        </div>
      </section>
    </div>
  );

  const renderFilesCategory = () => (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <section className="bg-primary/5 rounded-[32px] p-10 border border-primary/10 space-y-8">
        <h3 className="text-[18px] font-black text-on-surface flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-2xl bg-primary/10 flex items-center justify-center">
            <HardDrive className="w-5 h-5 text-primary" />
          </div>
          {t('settings.filesHeader')}
        </h3>
        
        <div className="space-y-2">
          <div className="flex items-center justify-between p-6 bg-primary/5 rounded-2xl border border-transparent hover:border-primary/20 transition-all group gap-6">
            <div className="space-y-1 min-w-0">
              <h4 className="text-[15px] font-bold text-on-surface flex items-center gap-2">
                <Folder className="w-4 h-4 text-primary" />
                {t('settings.defaultHomePath', '默认首页')}
              </h4>
              <p className="text-[12px] font-mono text-on-surface/50 truncate">
                {(() => {
                  const v = theme.defaultHomePath || 'aether://favorites';
                  if (v === 'aether://favorites') return t('settings.defaultHomeFavorites', '我的收藏');
                  if (v === 'aether://recent') return t('settings.defaultHomeRecent', '最近使用');
                  return v;
                })()}
              </p>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              <button
                onClick={handleResetDefaultHome}
                className="px-4 py-2 rounded-2xl bg-primary/10 text-primary text-[12px] font-black hover:bg-primary/20 transition-colors"
              >
                {t('settings.resetDefaultHome', '恢复我的收藏')}
              </button>
              <button
                onClick={handlePickDefaultHome}
                className="px-4 py-2 rounded-2xl bg-primary text-on-primary text-[12px] font-black hover:bg-primary/90 transition-colors"
              >
                {t('settings.chooseDefaultHome', '选择目录')}
              </button>
            </div>
          </div>

          {/* 跨窗口拖拽默认动作 */}
          <div className="flex items-center justify-between p-6 bg-primary/5 rounded-2xl border border-transparent hover:border-primary/20 transition-all group gap-6">
            <div className="space-y-1 min-w-0">
              <h4 className="text-[15px] font-bold text-on-surface flex items-center gap-2">
                <ArrowRightLeft className="w-4 h-4 text-primary" />
                {t('settings.crossWindowDrop', '跨窗口拖拽默认动作')}
              </h4>
              <p className="text-[12px] text-on-surface/50">
                {t('settings.crossWindowDropDesc', '把文件从一个 Aether 窗口拖到另一个窗口时的默认行为；修饰键随时可临时覆盖（⌘ 切换、⌥ 强制复制、⇧ 强制移动）。')}
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0 p-1 bg-primary/5 rounded-2xl border border-primary/10">
              {(['copy', 'move', 'ask'] as const).map((mode) => {
                const active = (theme.crossWindowDropDefault || 'copy') === mode;
                const icon = mode === 'copy' ? <Copy className="w-3.5 h-3.5" />
                  : mode === 'move' ? <ArrowRightLeft className="w-3.5 h-3.5" />
                  : <HelpCircle className="w-3.5 h-3.5" />;
                const label = mode === 'copy' ? t('settings.crossWindowDropCopy', '复制')
                  : mode === 'move' ? t('settings.crossWindowDropMove', '移动')
                  : t('settings.crossWindowDropAsk', '每次询问');
                return (
                  <button
                    key={mode}
                    onClick={() => onThemeChange({ ...theme, crossWindowDropDefault: mode })}
                    className={`px-3 py-1.5 rounded-xl text-[12px] font-black flex items-center gap-1.5 transition-all ${
                      active
                        ? 'bg-primary text-on-primary shadow-md shadow-primary/20'
                        : 'text-on-surface/60 hover:text-on-surface hover:bg-primary/10'
                    }`}
                    title={label}
                  >
                    {icon}
                    {label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex items-center justify-between p-6 bg-primary/5 rounded-2xl border border-transparent hover:border-primary/20 transition-all group gap-6">
            <div className="space-y-1 min-w-0">
              <h4 className="text-[15px] font-bold text-on-surface flex items-center gap-2">
                <History className="w-4 h-4 text-primary" />
                {t('settings.aiHistoryRetention', 'AI 操作历史保留时长')}
              </h4>
              <p className="text-[12px] text-on-surface/50">
                {t('settings.aiHistoryRetentionDesc', '用于控制本地 AI 操作历史保存周期。默认 7 天，最长 90 天。')}
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0 p-1 bg-primary/5 rounded-2xl border border-primary/10">
              {AI_HISTORY_RETENTION_OPTIONS.map(days => {
                const active = (theme.aiOpsHistoryRetentionDays || 7) === days;
                return (
                  <button
                    key={days}
                    onClick={() => onThemeChange({ ...theme, aiOpsHistoryRetentionDays: days })}
                    className={`px-3 py-1.5 rounded-xl text-[12px] font-black transition-all ${
                      active
                        ? 'bg-primary text-on-primary shadow-md shadow-primary/20'
                        : 'text-on-surface/60 hover:text-on-surface hover:bg-primary/10'
                    }`}
                  >
                    {days} 天
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex items-center justify-between p-6 bg-primary/5 rounded-2xl border border-transparent hover:border-primary/20 transition-all group">
            <div className="space-y-1">
              <h4 className="text-[15px] font-bold text-on-surface flex items-center gap-2">
                {theme.showHiddenFiles ? <Eye className="w-4 h-4 text-primary" /> : <EyeOff className="w-4 h-4 text-on-surface/40" />}
                {t('settings.showHiddenFiles', '显示隐藏项')}
              </h4>
              <p className="text-[12px] text-on-surface/50">在文件浏览器中显示以点(.)开头的文件或系统受限项目。</p>
            </div>
            <button
              onClick={() => onThemeChange({ ...theme, showHiddenFiles: !theme.showHiddenFiles })}
              className={`w-14 h-8 rounded-full p-1.5 transition-colors duration-300 flex items-center ${theme.showHiddenFiles ? 'bg-primary' : 'bg-on-surface/[0.1]'}`}
            >
              <motion.div animate={{ x: theme.showHiddenFiles ? 24 : 0 }} className={`w-5 h-5 rounded-full shadow-lg ${theme.showHiddenFiles ? 'bg-on-primary' : 'bg-on-surface/30'}`} />
            </button>
          </div>

          <div className="flex items-center justify-between p-6 bg-primary/5 rounded-2xl border border-transparent hover:border-primary/20 transition-all group">
            <div className="space-y-1">
              <h4 className="text-[15px] font-bold text-on-surface flex items-center gap-2">
                <Layout className="w-4 h-4 text-primary" />
                {t('settings.showPreviewPanel', '侧边预览面板')}
              </h4>
              <p className="text-[12px] text-on-surface/50">点击文件时自动展开右侧多媒体预览与属性分析面板。</p>
            </div>
            <button 
              onClick={() => onThemeChange({ ...theme, showPreviewPanel: !theme.showPreviewPanel })}
              className={`w-14 h-8 rounded-full p-1.5 transition-colors duration-300 flex items-center ${theme.showPreviewPanel ? 'bg-primary' : 'bg-on-surface/[0.1]'}`}
            >
              <motion.div animate={{ x: theme.showPreviewPanel ? 24 : 0 }} className={`w-5 h-5 rounded-full shadow-lg ${theme.showPreviewPanel ? 'bg-on-primary' : 'bg-on-surface/30'}`} />
            </button>
          </div>
        </div>
      </section>

      {/* 数据导出/导入 */}
      <section className="bg-primary/5 rounded-[32px] p-10 border border-primary/10 space-y-8">
        <h3 className="text-[17px] font-bold text-on-surface flex items-center gap-2">
          <ArrowRightLeft className="w-4 h-4 text-primary" /> {t('settings.backup.title')}
        </h3>
        <p className="text-[13px] text-on-surface/40 leading-relaxed">
          {t('settings.backup.description')}
        </p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <button
            onClick={handleExportSettingsBackup}
            disabled={backupStatus.loading}
            className="flex items-center justify-center gap-3 px-6 py-5 bg-primary/10 hover:bg-primary/20 rounded-2xl text-[14px] font-bold text-primary transition-all disabled:opacity-60"
          >
            <FileDown className="w-5 h-5" />
            {t('settings.backup.export')}
          </button>
          <button
            onClick={handleImportSettingsBackup}
            disabled={backupStatus.loading}
            className="flex items-center justify-center gap-3 px-6 py-5 bg-primary/10 hover:bg-primary/20 rounded-2xl text-[14px] font-bold text-primary transition-all disabled:opacity-60"
          >
            <FileUp className="w-5 h-5" />
            {t('settings.backup.import')}
          </button>
          <button
            onClick={handleResetAllSettingsData}
            disabled={backupStatus.loading}
            className="flex items-center justify-center gap-3 px-6 py-5 bg-red-500/10 hover:bg-red-500/15 rounded-2xl text-[14px] font-bold text-red-500 transition-all disabled:opacity-60"
          >
            <RotateCw className="w-5 h-5" />
            {t('settings.backup.resetAll')}
          </button>
        </div>
        {backupStatus.message && (
          <div className={`rounded-2xl border px-5 py-4 flex items-center gap-3 ${
            backupStatus.kind === 'error'
              ? 'bg-red-500/10 border-red-500/20 text-red-500'
              : 'bg-primary/5 border-primary/10 text-on-surface/70'
          }`}>
            {backupStatus.loading ? <Loader2 className="w-5 h-5 text-primary animate-spin shrink-0" /> : backupStatus.kind === 'error' ? <X className="w-5 h-5 shrink-0" /> : <BadgeCheck className="w-5 h-5 text-primary shrink-0" />}
            <span className="text-[13px] font-bold leading-relaxed">{backupStatus.message}</span>
          </div>
        )}
        <p className="text-[11px] text-on-surface/25">{t('settings.backup.warning')}</p>
      </section>
    </div>
  );

  const [permChecks, setPermChecks] = useState<{path: string; label: string; ok: boolean | null}[]>([]);

  const [permChecksLoaded, setPermChecksLoaded] = useState(false);

  const checkPermissions = useCallback(async () => {
    try {
      const home = await invoke<string>('get_home_dir');
      const dirs = [
        { path: `${home}/Documents`, label: t('settings.permissions.documents') },
        { path: `${home}/Desktop`, label: t('settings.permissions.desktop') },
        { path: `${home}/Downloads`, label: t('settings.permissions.downloads') },
        { path: `${home}/.Trash`, label: t('settings.permissions.trash') },
        { path: '/Applications', label: t('settings.permissions.applications') },
      ];
      const results = await Promise.all(dirs.map(async d => {
        try {
          await invoke('list_directory', { dirPath: d.path, showHidden: false });
          return { ...d, ok: true };
        } catch {
          return { ...d, ok: false };
        }
      }));
      setPermChecks(results);
      setPermChecksLoaded(true);
    } catch {
      setPermChecks([]);
      setPermChecksLoaded(true);
    }
  }, [t]);

  const renderPermissionsCategory = () => (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <section className="bg-primary/5 rounded-[32px] p-10 border border-primary/10 space-y-8">
        <div className="flex items-center justify-between p-8 bg-primary/5 rounded-[40px] border-2 border-primary/10">
          <div className="space-y-2">
            <h3 className="text-[18px] font-black text-on-surface flex items-center gap-4">
              <div className="w-12 h-12 rounded-full bg-primary/20 flex items-center justify-center shadow-xl shadow-primary/10">
                <Shield className="w-6 h-6 text-primary" />
              </div>
              {t('settings.permissions.fullDiskTitle')}
            </h3>
            <p className="text-[14px] text-on-surface/50 max-w-md">{t('settings.permissions.fullDiskDescription')}</p>
          </div>
          <button
            onClick={() => invoke('open_system_settings').catch(() => {})}
            className="px-6 py-3 bg-primary text-on-primary font-black rounded-2xl text-[13px] whitespace-nowrap shrink-0 shadow-lg shadow-primary/20 hover:scale-[1.02] active:scale-95 transition-all uppercase tracking-widest"
          >
            {t('settings.permissions.openSystemSettings')}
          </button>
        </div>

        {/* Permission check results */}
        <div className="space-y-3">
          <div className="flex items-center justify-between px-2">
            <h4 className="text-[13px] font-bold text-on-surface/40 uppercase tracking-wider">{t('settings.permissions.accessStatus')}</h4>
            <button
              onClick={checkPermissions}
              className="px-4 py-2 bg-primary/10 hover:bg-primary/20 rounded-xl text-[12px] font-bold text-primary transition-colors"
            >
              {permChecksLoaded ? t('settings.permissions.recheck') : t('settings.permissions.check')}
            </button>
          </div>
          {!permChecksLoaded ? (
            <p className="text-[13px] text-on-surface/30 px-2">{t('settings.permissions.checkHint')}</p>
          ) : (
            permChecks.map(p => (
              <div key={p.path} className="flex items-center justify-between px-6 py-4 bg-primary/5 rounded-2xl border border-transparent">
                <div className="space-y-1">
                  <span className="text-[14px] font-bold text-on-surface">{p.label}</span>
                  <p className="text-[11px] text-on-surface/30 font-mono">{p.path}</p>
                </div>
                {p.ok ? (
                  <span className="text-[11px] font-black text-green-400 bg-green-400/10 px-4 py-1 rounded-full">{t('settings.permissions.accessible')}</span>
                ) : p.ok === false ? (
                  <span className="text-[11px] font-black text-red-400 bg-red-400/10 px-4 py-1 rounded-full">{t('settings.permissions.denied')}</span>
                ) : (
                  <span className="text-[11px] font-black text-on-surface/20 bg-on-surface/5 px-4 py-1 rounded-full">{t('settings.permissions.checking')}</span>
                )}
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  );

  const renderExtensionsCategory = () => {
    const extensions = theme.contextMenuExtensions || [];
    const currentActionMeta = getActionTypeMeta(newActionType);
    const CurrentActionIcon = currentActionMeta.icon;

    return (
      <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
        <section className="bg-primary/5 rounded-[32px] p-10 border border-primary/10 space-y-10">
          <header className="flex items-start justify-between gap-6">
            <div className="space-y-2">
              <h3 className="text-[20px] font-black text-on-surface flex items-center gap-4">
                <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center">
                  <Puzzle className="w-6 h-6 text-primary" />
                </div>
                {t('settings.contextMenuExt', '右键菜单扩展')}
              </h3>
              <p className="text-[13px] text-on-surface/55 font-bold max-w-2xl leading-relaxed">{t('settings.extensions.description')}</p>
            </div>
            <div className="bg-primary/10 px-4 py-2 rounded-2xl flex items-center gap-2 shrink-0">
              <div className="w-2 h-2 rounded-full bg-primary" />
              <span className="text-[11px] font-black text-primary uppercase tracking-widest">{t('settings.extensions.enabledCount', { count: extensions.filter(ext => ext.enabled).length })}</span>
            </div>
          </header>

          <div className="flex flex-wrap gap-3">
            <button onClick={handleImportExtensions} className="px-4 py-2 rounded-2xl bg-primary/10 text-primary text-[11px] font-black flex items-center gap-2 hover:bg-primary/20 transition-colors">
              <FileUp className="w-4 h-4" /> {t('settings.extensions.importJson')}
            </button>
            <button onClick={handleExportExtensions} className="px-4 py-2 rounded-2xl bg-primary/10 text-primary text-[11px] font-black flex items-center gap-2 hover:bg-primary/20 transition-colors">
              <FileDown className="w-4 h-4" /> {t('settings.extensions.exportJson')}
            </button>
            <button onClick={() => navigator.clipboard.writeText(JSON.stringify(extensions, null, 2)).catch(() => {})} className="px-4 py-2 rounded-2xl bg-primary/10 text-primary text-[11px] font-black flex items-center gap-2 hover:bg-primary/20 transition-colors">
              <Copy className="w-4 h-4" /> {t('settings.extensions.copyConfig')}
            </button>
            <button onClick={resetActionForm} className="px-4 py-2 rounded-2xl bg-primary/5 text-on-surface text-[11px] font-black flex items-center gap-2 hover:bg-primary/10 transition-colors">
              {t('settings.extensions.cancelEdit')}
            </button>
          </div>

          <div className="rounded-[28px] bg-surface/40 border border-primary/10 p-6 space-y-5">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-2xl bg-primary/10 flex items-center justify-center text-primary">
                <Settings2 className="w-5 h-5" />
              </div>
              <div>
                <h4 className="text-[15px] font-black text-on-surface">{t('settings.extensions.coreActionsTitle')}</h4>
                <p className="text-[12px] text-on-surface/45 mt-1">{t('settings.extensions.coreActionsDescription')}</p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {CORE_CONTEXT_ACTIONS.map(action => (
                <span key={action} className="px-3 py-2 rounded-xl bg-primary/5 border border-primary/10 text-[12px] font-black text-on-surface/65">{t(`settings.extensions.coreActions.${action}`)}</span>
              ))}
            </div>
          </div>

          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h4 className="text-[15px] font-black text-on-surface">{t('settings.extensions.customActionsTitle')}</h4>
              <span className="text-[11px] font-black text-on-surface/35 uppercase tracking-widest">{t('settings.extensions.templateVariables')}: {'{path}'} {'{dir}'} {'{name}'} {'{currentPath}'}</span>
            </div>
            {extensions.length === 0 ? (
              <div className="rounded-[24px] bg-primary/5 border border-dashed border-primary/20 px-8 py-10 text-center">
                <p className="text-[13px] font-bold text-on-surface/45">{t('settings.extensions.emptyCustomActions')}</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-4">
                {extensions.map((ext) => {
                  const actionType = ext.actionType || 'placeholder';
                  const meta = getActionTypeMeta(actionType);
                  const Icon = meta.icon;
                  const detail = actionType === 'terminal'
                    ? `${ext.terminalApp || theme.terminalApp || 'Terminal'} · ${ext.workingDirectory === 'current' ? t('settings.extensions.workingDirectoryCurrent') : t('settings.extensions.workingDirectorySelection')} · ${ext.terminalArgs || t('settings.extensions.openDirectoryOnly')}`
                    : actionType === 'shell'
                      ? `${ext.terminalApp || theme.terminalApp || 'Terminal'} · ${ext.command || t('settings.extensions.commandMissing')}`
                      : actionType === 'url'
                        ? ext.urlTemplate || t('settings.extensions.urlTemplateMissing')
                        : meta.description;
                  return (
                    <div
                      key={ext.id}
                      className={`flex items-center justify-between gap-6 px-6 py-5 rounded-[24px] border transition-all duration-300 group ${ext.enabled ? 'bg-primary/10 border-primary/20' : 'bg-primary/5 border-transparent opacity-65'}`}
                    >
                      <div className="flex items-center gap-5 min-w-0">
                        <div className={`w-12 h-12 rounded-xl flex items-center justify-center transition-all shadow-sm shrink-0 ${ext.enabled ? 'bg-primary text-on-primary' : 'bg-primary/20 text-on-surface'}`}>
                          <Icon className="w-5 h-5" />
                        </div>
                        <div className="space-y-1 min-w-0">
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="text-[15px] font-black text-on-surface truncate">{ext.label}</span>
                            <span className="text-[9px] font-black bg-on-surface/10 text-on-surface/60 px-2 py-0.5 rounded-full uppercase tracking-widest shrink-0">{meta.label}</span>
                          </div>
                          <p className="text-[11px] text-on-surface/50 font-bold truncate">{detail}</p>
                        </div>
                      </div>

                      <div className="flex items-center gap-4 shrink-0">
                        {!ext.isSystem && (
                          <button
                            onClick={() => populateActionForm(ext)}
                            className="p-3 text-on-surface/25 hover:text-primary hover:bg-primary/10 rounded-xl transition-all opacity-0 group-hover:opacity-100"
                            aria-label={t('settings.extensions.editAction', { label: ext.label })}
                          >
                            <Pencil className="w-5 h-5" />
                          </button>
                        )}
                        {!ext.isSystem && (
                          <button
                            onClick={() => handleDeleteExtension(ext.id, ext.label)}
                            className="p-3 text-on-surface/25 hover:text-red-500 hover:bg-red-500/10 rounded-xl transition-all opacity-0 group-hover:opacity-100"
                            aria-label={t('settings.extensions.deleteAction', { label: ext.label })}
                          >
                            <Trash2 className="w-5 h-5" />
                          </button>
                        )}
                        {ext.isSystem && (
                          <span className="text-[9px] font-black text-on-surface/25 uppercase tracking-widest px-2 py-1 bg-on-surface/5 rounded-lg">{t('settings.extensions.systemBuiltIn')}</span>
                        )}
                        <button
                          onClick={() => toggleExtension(ext.id)}
                          className={`w-14 h-8 rounded-full p-1.5 transition-colors duration-300 flex items-center ${ext.enabled ? 'bg-primary' : 'bg-on-surface/[0.2]'}`}
                          aria-label={ext.enabled ? t('settings.extensions.disableAction', { label: ext.label }) : t('settings.extensions.enableAction', { label: ext.label })}
                        >
                          <motion.div animate={{ x: ext.enabled ? 24 : 0 }} className={`w-5 h-5 rounded-full shadow-lg ${ext.enabled ? 'bg-on-primary' : 'bg-on-surface/40'}`} />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="p-8 bg-primary/5 rounded-[32px] border-2 border-dashed border-primary/20 space-y-7">
            <div className="flex items-start gap-5">
              <div className="w-14 h-14 rounded-2xl bg-primary/15 flex items-center justify-center text-primary shrink-0">
                <Plus className="w-7 h-7" />
              </div>
              <div>
                <h4 className="text-[16px] font-black text-on-surface">{t('settings.extensions.addCustomAction')}</h4>
                <p className="text-[12px] text-on-surface/45 mt-1 leading-relaxed">{t('settings.extensions.addCustomActionDescription')}</p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <label className="space-y-2">
                <span className="text-[11px] font-black text-on-surface/45 uppercase tracking-wider">{t('settings.extensions.menuLabel')}</span>
                <input
                  type="text"
                  value={newActionLabel}
                  onChange={(e) => setNewActionLabel(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && addExtension()}
                  placeholder={t('placeholders.terminalScriptExample1')}
                  className="w-full bg-white/5 border border-primary/20 rounded-2xl px-5 py-4 text-[13px] font-bold outline-none focus:ring-4 focus:ring-primary/10 transition-all"
                />
              </label>
              <label className="space-y-2">
                <span className="text-[11px] font-black text-on-surface/45 uppercase tracking-wider">{t('settings.extensions.actionType')}</span>
                <select
                  value={newActionType}
                  onChange={(e) => setNewActionType(e.target.value as NonNullable<ContextMenuAction['actionType']>)}
                  className="w-full bg-white/5 border border-primary/20 rounded-2xl px-5 py-4 text-[13px] font-bold text-on-surface outline-none focus:ring-4 focus:ring-primary/10 transition-all"
                >
                  {Object.keys(ACTION_TYPE_ICONS).filter((type) => !type.startsWith('ai-')).map((type) => <option key={type} value={type}>{getActionTypeMeta(type as NonNullable<ContextMenuAction['actionType']>).label}</option>)}
                </select>
              </label>
            </div>

            <div className="rounded-[24px] bg-surface/40 border border-primary/10 p-5 space-y-5">
              <div className="flex items-start gap-4">
                <div className="w-11 h-11 rounded-2xl bg-primary/10 text-primary flex items-center justify-center shrink-0">
                  <CurrentActionIcon className="w-5 h-5" />
                </div>
                <div>
                  <h5 className="text-[13px] font-black text-on-surface">{currentActionMeta.label}</h5>
                  <p className="text-[12px] text-on-surface/45 mt-1 leading-relaxed">{currentActionMeta.description}</p>
                </div>
              </div>

              {(newActionType === 'terminal' || newActionType === 'shell') && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                  <label className="space-y-2">
                    <span className="text-[11px] font-black text-on-surface/45 uppercase tracking-wider">{t('settings.extensions.terminalApp')}</span>
                    <select
                      value={newTerminalApp}
                      onChange={(e) => setNewTerminalApp(e.target.value)}
                      className="w-full bg-white/5 border border-primary/20 rounded-2xl px-5 py-4 text-[13px] font-bold text-on-surface outline-none focus:ring-4 focus:ring-primary/10 transition-all"
                    >
                      {terminalApps.map(app => <option key={app} value={app}>{app}</option>)}
                    </select>
                  </label>
                  <label className="space-y-2">
                    <span className="text-[11px] font-black text-on-surface/45 uppercase tracking-wider">{t('settings.extensions.workingDirectory')}</span>
                    <select
                      value={newWorkingDirectory}
                      onChange={(e) => setNewWorkingDirectory(e.target.value as 'selection' | 'current')}
                      className="w-full bg-white/5 border border-primary/20 rounded-2xl px-5 py-4 text-[13px] font-bold text-on-surface outline-none focus:ring-4 focus:ring-primary/10 transition-all"
                    >
                      <option value="selection">{t('settings.extensions.workingDirectorySelection')}</option>
                      <option value="current">{t('settings.extensions.workingDirectoryCurrent')}</option>
                    </select>
                  </label>
                </div>
              )}

              {newActionType === 'terminal' && (
                <label className="space-y-2 block">
                  <span className="text-[11px] font-black text-on-surface/45 uppercase tracking-wider">{t('settings.extensions.terminalArgs')}</span>
                  <input
                    value={newTerminalArgs}
                    onChange={(e) => setNewTerminalArgs(e.target.value)}
                    placeholder={t('placeholders.terminalScriptExample2')}
                    className="w-full bg-white/5 border border-primary/20 rounded-2xl px-5 py-4 text-[13px] font-mono text-on-surface outline-none focus:ring-4 focus:ring-primary/10 transition-all"
                  />
                </label>
              )}

              {newActionType === 'shell' && (
                <label className="space-y-2 block">
                  <span className="text-[11px] font-black text-on-surface/45 uppercase tracking-wider">{t('settings.extensions.commandTemplate')}</span>
                  <input
                    value={newCommand}
                    onChange={(e) => setNewCommand(e.target.value)}
                    placeholder={t('placeholders.terminalScriptExample3')}
                    className="w-full bg-white/5 border border-primary/20 rounded-2xl px-5 py-4 text-[13px] font-mono text-on-surface outline-none focus:ring-4 focus:ring-primary/10 transition-all"
                  />
                </label>
              )}

              {newActionType === 'url' && (
                <label className="space-y-2 block">
                  <span className="text-[11px] font-black text-on-surface/45 uppercase tracking-wider">{t('settings.extensions.urlTemplate')}</span>
                  <input
                    value={newUrlTemplate}
                    onChange={(e) => setNewUrlTemplate(e.target.value)}
                    placeholder={t('placeholders.searchUrlExample')}
                    className="w-full bg-white/5 border border-primary/20 rounded-2xl px-5 py-4 text-[13px] font-mono text-on-surface outline-none focus:ring-4 focus:ring-primary/10 transition-all"
                  />
                </label>
              )}

              <div className="rounded-2xl bg-primary/5 border border-primary/10 px-5 py-4">
                <p className="text-[11px] font-bold text-on-surface/45 leading-relaxed">{t('settings.extensions.availableVariables')}: <span className="font-mono text-primary">{'{path}'}</span> {t('settings.extensions.variablePath')}, <span className="font-mono text-primary">{'{dir}'}</span> {t('settings.extensions.variableDir')}, <span className="font-mono text-primary">{'{name}'}</span> {t('settings.extensions.variableName')}, <span className="font-mono text-primary">{'{currentPath}'}</span> {t('settings.extensions.variableCurrentPath')}.</p>
                <p className="mt-2 text-[11px] font-bold text-on-surface/40 leading-relaxed">{t('settings.extensions.escapeHint')}</p>
              </div>
            </div>

            <div className="flex justify-end">
              <button
                onClick={addExtension}
                disabled={!isNewActionValid()}
                className="px-8 py-4 bg-primary text-on-primary font-black rounded-2xl shadow-xl shadow-primary/20 disabled:opacity-50 disabled:shadow-none transition-all uppercase tracking-widest text-[12px]"
              >
                {editingExtensionId ? t('settings.extensions.saveChanges') : t('settings.extensions.addAction')}
              </button>
            </div>
          </div>
        </section>
      </div>
    );
  };

  return (
    <div className="h-full flex overflow-hidden bg-primary/[0.01]">
      {/* Category Sidebar */}
      <aside className="w-48 border-r border-primary/5 flex flex-col pt-16 pb-8 px-4 space-y-6 shrink-0 bg-primary/[0.02]">
        <div className="px-4 mb-2">
            <h2 className="text-[11px] font-black text-primary uppercase tracking-[0.3em] mb-8 opacity-60">{t('settings.sidebarTitle')}</h2>
            <nav className="space-y-3">
              {categories.map((cat) => {
                const isActive = activeCategory === cat.id;
                return (
                  <button
                    key={cat.id}
                    onClick={() => setActiveCategory(cat.id as SettingsCategory)}
                    className={`w-full flex items-center gap-3 px-3 py-3 rounded-[18px] transition-all duration-300 relative group whitespace-nowrap
                      ${isActive ? 'text-on-surface font-black shadow-lg shadow-primary/5' : 'text-on-surface/40 font-bold hover:bg-primary/5 hover:text-primary'}
                    `}
                  >
                    {isActive && (
                      <motion.div
                        layoutId="active-cat-bg"
                        className="absolute inset-0 bg-primary/10 border border-primary/20 rounded-[22px] z-0"
                      />
                    )}
                    <cat.icon className={`w-5 h-5 relative z-10 transition-colors ${isActive ? 'text-primary' : 'group-hover:text-primary/70'}`} />
                    <span className="text-[14px] relative z-10 tracking-tight">{cat.label}</span>
                    {isActive && <ChevronRight className="w-4 h-4 ml-auto relative z-10 text-primary" />}
                  </button>
                );
              })}
            </nav>
        </div>
      </aside>

      {/* Content Area */}
      <div className="flex-1 overflow-y-auto p-10 custom-scrollbar">
        <div className="max-w-4xl mx-auto">
          <header className="mb-20 space-y-6">
            <div className="inline-flex items-center gap-2 px-4 py-1.5 bg-primary/10 rounded-full border border-primary/20">
                <div className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
                <span className="text-[9px] font-black text-primary uppercase tracking-[0.2em]">{t('settings.configurationBadge', { category: categories.find(c => c.id === activeCategory)?.label })}</span>
            </div>
            <h1 className="text-[48px] font-black text-on-surface tracking-tighter leading-[0.9] flex items-center gap-4">
              {categories.find(c => c.id === activeCategory)?.label}
              <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} className="w-2 h-2 rounded-full bg-primary mt-4" />
            </h1>
            <p className="text-on-surface/40 text-[18px] max-w-xl font-medium antialiased">
              {t(`settings.categoryDescriptions.${activeCategory}`, { defaultValue: t('settings.categoryDescriptions.default') })}
            </p>
          </header>

          <AnimatePresence mode="wait">
            <motion.div
              key={activeCategory}
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.4, ease: "circOut" }}
            >
              {activeCategory === 'appearance' && renderAppearanceCategory()}
              {activeCategory === 'files' && renderFilesCategory()}
              {activeCategory === 'permissions' && renderPermissionsCategory()}
              {activeCategory === 'extensions' && renderExtensionsCategory()}
              {activeCategory === 'features' && renderFeaturesCategory()}
              {activeCategory === 'ai' && renderAICategory()}
              {activeCategory === 'about' && renderAboutCategory()}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
