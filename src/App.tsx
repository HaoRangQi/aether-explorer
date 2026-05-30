import { useCallback, useMemo, useState, useEffect, useRef, lazy, Suspense } from 'react';
import { motion, AnimatePresence, MotionConfig } from 'motion/react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, Keyboard, Terminal, X } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { emitTo, listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { load } from '@tauri-apps/plugin-store';
import Sidebar from './components/Sidebar';
import TopBar, { TabTransferPayload } from './components/TopBar';
import type { SettingsCategory } from './components/SettingsView';
import { ThemeSettings, ViewMode, TabData } from './types';
import {
  DEFAULT_THEME,
  FAVORITES_VIRTUAL_PATH,
  normalizeThemeSettings,
  loadThemeFromLocalStorage,
  redactThemeSecrets,
} from './lib/settings';
import { getPathLeaf, getInitialTabs as buildInitialTabs } from './lib/path-helpers';
import { normalizeAppError } from './lib/app-error';
import { resolveAppShortcut } from './lib/keyboard-shortcuts';
import { NATIVE_MENU_COMMAND_EVENT, type NativeMenuCommand } from './lib/native-menu';
import { isValidWallpaperUrl } from './lib/url-guard';
import {
  STARTUP_PANIC_LOG_SEEN_KEY,
  fingerprintPanicLog,
  shouldShowStartupPanicPrompt,
} from './lib/startup-diagnostics';

const MAX_RECENT_ITEMS = 100;
const LIQUID_GLASS_PRIMARY = '#ffffff';
const STARTUP_PERMISSION_PREFLIGHT_STATE_KEY = 'aether-startup-permission-preflight-state-v1';
const STARTUP_PERMISSION_PREFLIGHT_LOCK_KEY = 'aether-startup-permission-preflight-lock-v1';
const STARTUP_PERMISSION_PREFLIGHT_LOCK_TTL_MS = 15_000;
type ResolvedAppearance = 'light' | 'dark';
const LIQUID_GLASS_COLOR_VARS: Record<ResolvedAppearance, Record<string, string>> = {
  light: {
    '--color-icon': 'rgba(255, 255, 255, 0.92)',
    '--color-selected-fg': '#ffffff',
    '--color-selected-bg': 'rgba(255, 255, 255, 0.26)',
    '--color-hover-fg': '#ffffff',
    '--color-hover-bg': 'rgba(255, 255, 255, 0.18)',
    '--color-panel-bg': 'rgba(255, 255, 255, 0.12)',
    '--color-text-primary': '#ffffff',
    '--color-text-secondary': 'rgba(255, 255, 255, 0.70)',
    '--color-border': 'rgba(255, 255, 255, 0.24)',
    '--color-divider': 'rgba(255, 255, 255, 0.16)',
    '--color-shadow': 'rgba(0, 0, 0, 0.24)',
    '--color-active-icon-bg': 'rgba(255, 255, 255, 0.22)',
    '--color-tag-selected': '#ffffff',
    '--color-search-bg': 'rgba(255, 255, 255, 0.16)',
  },
  dark: {
    '--color-icon': 'rgba(255, 255, 255, 0.92)',
    '--color-selected-fg': '#ffffff',
    '--color-selected-bg': 'rgba(255, 255, 255, 0.20)',
    '--color-hover-fg': '#ffffff',
    '--color-hover-bg': 'rgba(255, 255, 255, 0.12)',
    '--color-panel-bg': 'rgba(255, 255, 255, 0.08)',
    '--color-text-primary': '#ffffff',
    '--color-text-secondary': 'rgba(255, 255, 255, 0.68)',
    '--color-border': 'rgba(255, 255, 255, 0.18)',
    '--color-divider': 'rgba(255, 255, 255, 0.12)',
    '--color-shadow': 'rgba(0, 0, 0, 0.40)',
    '--color-active-icon-bg': 'rgba(255, 255, 255, 0.18)',
    '--color-tag-selected': '#ffffff',
    '--color-search-bg': 'rgba(255, 255, 255, 0.10)',
  },
};

const SettingsView = lazy(() => import('./components/SettingsView'));
const StorageView = lazy(() => import('./components/StorageView'));
const TransferModal = lazy(() => import('./components/TransferModal'));
const ExplorerView = lazy(() => import('./components/ExplorerView'));

type NativeLiquidGlassStatus = {
  requested: boolean;
  supported: boolean;
  applied: boolean;
  reason?: string | null;
};

type PermissionPreflightResult = {
  path: string;
  ok: boolean;
  error?: string | null;
};

function resolveAppearance(mode: ThemeSettings['mode'], systemTheme: ResolvedAppearance): ResolvedAppearance {
  return mode === 'auto' ? systemTheme : mode;
}

function getInitialTabs(defaultHomePath: string): TabData[] {
  return buildInitialTabs(defaultHomePath, new URLSearchParams(window.location.search));
}

const STORE_OPTIONS = { autoSave: true, defaults: {} };

function loadSettingsStore() {
  return load('settings.json', STORE_OPTIONS);
}

function loadFavoritesFromLocalStorage(): string[] {
  try {
    const saved = localStorage.getItem('favorites');
    return saved ? JSON.parse(saved) : [];
  } catch {
    return [];
  }
}

function loadFileTagsFromLocalStorage(): Record<string, string[]> {
  try {
    const saved = localStorage.getItem('aether-file-tags');
    return saved ? JSON.parse(saved) : {};
  } catch {
    return {};
  }
}

function loadRecentItemsFromLocalStorage(): string[] {
  try {
    const saved = localStorage.getItem('aether-recent-items');
    return saved ? JSON.parse(saved) : [];
  } catch {
    return [];
  }
}

function normalizeTransferredTab(tab: TabData): TabData {
  const path = tab.currentPath || tab.initialPath;
  return {
    ...tab,
    id: `tab-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    initialPath: path,
    currentPath: path,
  };
}

type StartupPanicPrompt = {
  fingerprint: string;
  preview: string;
};

export default function App() {
  const { t, i18n } = useTranslation();
  const [theme, setTheme] = useState<ThemeSettings>(loadThemeFromLocalStorage);
  const initialTabs = useMemo(() => getInitialTabs(theme.defaultHomePath || FAVORITES_VIRTUAL_PATH), [theme.defaultHomePath]);
  const [tabs, setTabs] = useState<TabData[]>(initialTabs);
  const [view, setView] = useState<ViewMode>(initialTabs[0]?.id || 'home');
  const [selectedFileIds, setSelectedFileIds] = useState<string[]>([]);
  const [visibleItemCount, setVisibleItemCount] = useState(0);
  const [isTransferring, setIsTransferring] = useState(false);
  const [settingsInitialCategory, setSettingsInitialCategory] = useState<SettingsCategory>('appearance');
  const [startupPanicPrompt, setStartupPanicPrompt] = useState<StartupPanicPrompt | null>(null);
  const [startupPermissionPromptOpen, setStartupPermissionPromptOpen] = useState(false);
  const [startupPermissionPromptLoading, setStartupPermissionPromptLoading] = useState(false);
  const [shortcutHelpOpen, setShortcutHelpOpen] = useState(false);
  const [storeReady, setStoreReady] = useState(false);
  const [systemTheme, setSystemTheme] = useState<'light' | 'dark'>(
    window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  );

  const [favorites, setFavorites] = useState<string[]>(loadFavoritesFromLocalStorage);
  const [fileTags, setFileTags] = useState<Record<string, string[]>>(loadFileTagsFromLocalStorage);
  const [recentItems, setRecentItems] = useState<string[]>(loadRecentItemsFromLocalStorage);
  const activeTab = useMemo(() => tabs.find(tab => tab.id === view), [tabs, view]);
  const activeTabPath = activeTab?.currentPath || activeTab?.initialPath;

  const createLocalTab = useCallback((path?: string, label?: string) => {
    const targetPath = path || theme.defaultHomePath || FAVORITES_VIRTUAL_PATH;
    const labelTranslationKey =
      targetPath === FAVORITES_VIRTUAL_PATH ? 'tabs.favorites' :
      targetPath === 'aether://recent' ? 'tabs.recent' :
      'tabs.volume';
    const nextTab: TabData = {
      id: `tab-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      labelTranslationKey,
      label: label || (targetPath.startsWith('aether://') ? undefined : getPathLeaf(targetPath)),
      initialPath: targetPath,
      currentPath: targetPath,
    };
    setTabs(prev => [...prev, nextTab]);
    setView(nextTab.id as ViewMode);
  }, [theme.defaultHomePath]);

  useEffect(() => {
    setTabs(prev => prev.map(tab => {
      const defaultHomePath = theme.defaultHomePath || FAVORITES_VIRTUAL_PATH;
      // 首页标签页的 label 跟随当前默认首页内容：
      // - 虚拟路径 → 友好名（"我的收藏"/"最近使用"），用 labelTranslationKey 让 i18n 接管
      // - 真实路径 → 路径末段
      const homeTabLabelKey =
        defaultHomePath === FAVORITES_VIRTUAL_PATH ? 'tabs.favorites' :
        defaultHomePath === 'aether://recent' ? 'tabs.recent' :
        'tabs.home';
      const homeTabLabel = defaultHomePath.startsWith('aether://') ? undefined : getPathLeaf(defaultHomePath);
      if (tab.id === 'favorites-list') {
        return {
          ...tab,
          id: 'desktop',
          labelTranslationKey: homeTabLabelKey,
          label: homeTabLabel,
          initialPath: defaultHomePath,
          currentPath: defaultHomePath,
        };
      }
      if (tab.id !== 'desktop') return tab;
      // 用户改默认首页 = 把"首页"标签页跳到新位置（也包括点"恢复我的收藏"的场景）。
      // 不再保留原 currentPath；想去原位置请新建标签页。
      return {
        ...tab,
        labelTranslationKey: homeTabLabelKey,
        initialPath: defaultHomePath,
        currentPath: defaultHomePath,
        label: homeTabLabel,
      };
    }));
    setView(prev => prev === 'favorites-list' ? 'desktop' : prev);
  }, [theme.defaultHomePath]);

  useEffect(() => {
    const focusWindow = () => {
      void getCurrentWindow().setFocus().catch(() => {});
    };
    document.addEventListener('contextmenu', focusWindow, true);
    return () => document.removeEventListener('contextmenu', focusWindow, true);
  }, []);

  const resolveWindowTarget = useCallback((path?: string, label?: string) => {
    const fallbackPath = theme.defaultHomePath || FAVORITES_VIRTUAL_PATH;
    const resolvedPath = path || fallbackPath;
    const resolvedLabel = label || (resolvedPath && !resolvedPath.startsWith('aether://') ? getPathLeaf(resolvedPath) : undefined);
    return { path: resolvedPath, label: resolvedLabel };
  }, [theme.defaultHomePath]);

  const createStandaloneWindow = useCallback((path: string, label?: string) => {
    return invoke<string>('create_app_window', { initialPath: path, tabLabel: label }).catch(err => {
      console.error('创建新窗口失败:', normalizeAppError(err).userMessage);
      throw err;
    });
  }, []);

  const createNewWindow = useCallback((path?: string, label?: string, options?: { forceStandalone?: boolean }) => {
    // Cmd+N / 菜单默认遵循多窗口开关；工具栏按钮可用 forceStandalone 强制新建独立窗口。
    const target = resolveWindowTarget(path, label);
    if (!theme.enableMultiWindow && !options?.forceStandalone) {
      createLocalTab(target.path, target.label);
      return;
    }
    void createStandaloneWindow(target.path, target.label);
  }, [createLocalTab, createStandaloneWindow, resolveWindowTarget, theme.enableMultiWindow]);

  const removeTabAfterTransfer = useCallback((tabId: string) => {
    setTabs(prev => {
      const tabExists = prev.some(t => t.id === tabId);
      if (!tabExists) return prev;

      if (prev.length <= 1) {
        getCurrentWindow().close().catch(() => {});
        return prev;
      }
      const nextTabs = prev.filter(tab => tab.id !== tabId);
      setView(current => {
        if (current !== tabId) return current;
        return (nextTabs[nextTabs.length - 1]?.id || prev[0].id) as ViewMode;
      });
      return nextTabs;
    });
  }, []);

  const resolveTabWindowTarget = useCallback((tab: TabData) => {
    const path = tab.currentPath || tab.initialPath;
    return resolveWindowTarget(path, tab.label);
  }, [resolveWindowTarget]);

  const handleDetachTab = useCallback((tab: TabData) => {
    const { path, label } = resolveTabWindowTarget(tab);
    createStandaloneWindow(path, label)
      .then(() => removeTabAfterTransfer(tab.id))
      .catch(() => {});
  }, [createStandaloneWindow, removeTabAfterTransfer, resolveTabWindowTarget]);

  const handleAcceptDraggedTab = useCallback((payload: TabTransferPayload) => {
    const sourceWindow = payload.sourceWindowLabel;
    const currentWindow = getCurrentWindow().label;

    if (sourceWindow === currentWindow) {
      return;
    }

    const nextTab = normalizeTransferredTab(payload.tab);
    setTabs(prev => [...prev, nextTab]);
    setView(nextTab.id as ViewMode);

    emitTo(sourceWindow, 'aether-tab-transfer-accepted', {
      transferId: payload.transferId,
      tabId: payload.tab.id,
      targetWindow: currentWindow,
    }).then(() => {
      const timeoutKey = `detach-timeout-${payload.transferId}`;
      const detachTimeout = (window as any)[timeoutKey];
      if (detachTimeout) {
        clearTimeout(detachTimeout);
        delete (window as any)[timeoutKey];
      }
    }).catch((err) => {
      console.error('发送确认事件失败:', err);
    });
  }, []);

  // Initialize Tauri store and load persisted settings
  useEffect(() => {
    let mounted = true;

    async function initStore() {
      try {
        const s = await loadSettingsStore();
        if (!mounted) return;

        const savedTheme = await s.get<ThemeSettings>('theme');
        if (savedTheme && mounted) {
          setTheme(normalizeThemeSettings(savedTheme));
        }

        const savedFavorites = await s.get<string[]>('favorites');
        if (savedFavorites && mounted) {
          setFavorites(savedFavorites);
        }

        const savedFileTags = await s.get<Record<string, string[]>>('fileTags');
        if (savedFileTags && mounted) {
          setFileTags(savedFileTags);
        }

        const savedRecentItems = await s.get<string[]>('recentItems');
        if (savedRecentItems && mounted) {
          setRecentItems(savedRecentItems);
        }
      } catch {
        // Not running in Tauri — keep localStorage values
      }
      if (mounted) setStoreReady(true);
    }

    initStore();

    return () => { mounted = false; };
  }, []);

  // Save theme to Tauri store (with localStorage fallback)
  useEffect(() => {
    if (!storeReady) return;
    localStorage.setItem('theme-settings', JSON.stringify(redactThemeSecrets(theme)));

    loadSettingsStore().then(s => {
      s.set('theme', theme);
    }).catch(() => {});
  }, [theme, storeReady]);

  // Save favorites to Tauri store (with localStorage fallback)
  useEffect(() => {
    if (!storeReady) return;
    localStorage.setItem('favorites', JSON.stringify(favorites));

    loadSettingsStore().then(s => {
      s.set('favorites', favorites);
    }).catch(() => {});
  }, [favorites, storeReady]);

  useEffect(() => {
    if (!storeReady) return;
    localStorage.setItem('aether-file-tags', JSON.stringify(fileTags));

    loadSettingsStore().then(s => {
      s.set('fileTags', fileTags);
    }).catch(() => {});
  }, [fileTags, storeReady]);

  useEffect(() => {
    if (!storeReady) return;
    localStorage.setItem('aether-recent-items', JSON.stringify(recentItems));

    loadSettingsStore().then(s => {
      s.set('recentItems', recentItems);
    }).catch(() => {});
  }, [recentItems, storeReady]);

  const handleImportConfig = useCallback(({ theme: t, favorites: f, fileTags: ft, recentItems: r }: {
    theme?: ThemeSettings; favorites?: string[]; fileTags?: Record<string, string[]>; recentItems?: string[];
  }) => {
    if (t) setTheme(normalizeThemeSettings(t));
    if (f) setFavorites(f);
    if (ft) setFileTags(ft);
    if (r) setRecentItems(r);
  }, []);

  const handleResetAllSettingsData = useCallback(() => {
    setTheme(normalizeThemeSettings({}));
    setFavorites([]);
    setFileTags({});
    setRecentItems([]);
    setSelectedFileIds([]);
  }, []);

  const handleRecordRecent = useCallback((path: string) => {
    if (!path || path.startsWith('aether://')) return;
    setRecentItems(prev => [path, ...prev.filter(item => item !== path)].slice(0, MAX_RECENT_ITEMS));
  }, []);

  const markStartupPanicPromptSeen = useCallback((fingerprint: string) => {
    try {
      localStorage.setItem(STARTUP_PANIC_LOG_SEEN_KEY, fingerprint);
    } catch {
      // Best-effort only; the prompt should still close if storage is unavailable.
    }
    setStartupPanicPrompt(null);
  }, []);

  const openDiagnosticsSettings = useCallback((fingerprint: string) => {
    markStartupPanicPromptSeen(fingerprint);
    setSettingsInitialCategory('about');
    setView('settings');
  }, [markStartupPanicPromptSeen]);

  const markStartupPermissionPromptDone = useCallback(() => {
    try {
      localStorage.setItem(STARTUP_PERMISSION_PREFLIGHT_STATE_KEY, 'done');
      localStorage.removeItem(STARTUP_PERMISSION_PREFLIGHT_LOCK_KEY);
    } catch {
      // Ignore storage failures and just close prompt for this window.
    }
    setStartupPermissionPromptOpen(false);
    setStartupPermissionPromptLoading(false);
  }, []);

  const runStartupPermissionPreflight = useCallback(async () => {
    if (startupPermissionPromptLoading) return;
    setStartupPermissionPromptLoading(true);
    try {
      const results = await invoke<PermissionPreflightResult[]>('preflight_file_permissions');
      const denied = results.filter(result => !result.ok);
      if (denied.length > 0) {
        console.info('Permission preflight denied paths:', denied.map(result => result.path));
      }
      markStartupPermissionPromptDone();
    } catch (err) {
      console.warn('Permission preflight failed:', normalizeAppError(err).userMessage);
      setStartupPermissionPromptLoading(false);
    }
  }, [markStartupPermissionPromptDone, startupPermissionPromptLoading]);

  // Apply theme to document
  useEffect(() => {
    const root = window.document.documentElement;
    const liquidGlassEnabled = theme.enableLiquidGlass === true;
    const resolvedMode = resolveAppearance(theme.mode, systemTheme);
    root.classList.remove('light', 'dark', 'liquid-glass-theme', 'liquid-glass-light', 'liquid-glass-dark');

    if (liquidGlassEnabled) {
      root.classList.add(resolvedMode, 'liquid-glass-theme', `liquid-glass-${resolvedMode}`);
    } else {
      root.classList.add(resolvedMode);
    }

    root.style.setProperty('--primary', liquidGlassEnabled ? LIQUID_GLASS_PRIMARY : theme.accentColor);
    root.style.setProperty('--font-sans', theme.fontFamily || 'Inter');

    // 纯色背景（无壁纸时生效）
    const defaultBg = resolvedMode === 'dark' ? '#1E1E2E' : '#FCFCFD';
    root.style.setProperty('--app-bg', theme.colorAppBg || defaultBg);

    // 注入或移除颜色细化控制的 CSS 变量
    const colorVars: [string, string | undefined][] = [
      ['--color-icon', theme.colorIcon],
      ['--color-selected-fg', theme.colorSelectedFg],
      ['--color-selected-bg', theme.colorSelectedBg],
      ['--color-hover-fg', theme.colorHoverFg],
      ['--color-hover-bg', theme.colorHoverBg],
      ['--color-panel-bg', theme.colorPanelBg],
      ['--color-text-primary', theme.colorTextPrimary],
      ['--color-text-secondary', theme.colorTextSecondary],
      ['--color-border', theme.colorBorder],
      ['--color-divider', theme.colorDivider],
      ['--color-shadow', theme.colorShadow],
      ['--color-active-icon-bg', theme.colorActiveIconBg],
      ['--color-tag-selected', theme.colorTagSelected],
      ['--color-search-bg', theme.colorSearchBg],
    ];
    const liquidGlassColorVars = LIQUID_GLASS_COLOR_VARS[resolvedMode];
    for (const [prop, value] of colorVars) {
      const resolvedValue = liquidGlassEnabled ? liquidGlassColorVars[prop] : value;
      if (resolvedValue) {
        root.style.setProperty(prop, resolvedValue);
      } else {
        root.style.removeProperty(prop);
      }
    }
  }, [theme, systemTheme]);

  useEffect(() => {
    const systemLanguage = navigator.language.toLowerCase().startsWith('zh') ? 'zh' : 'en';
    const nextLanguage = theme.followSystemLanguage ? systemLanguage : (theme.language || 'zh');
    if (i18n.language !== nextLanguage) {
      i18n.changeLanguage(nextLanguage);
    }
  }, [theme.language, theme.followSystemLanguage, i18n]);

  useEffect(() => {
    let cancelled = false;
    const enabled = theme.enableLiquidGlass === true;
    const appearance = resolveAppearance(theme.mode, systemTheme);

    invoke<NativeLiquidGlassStatus>('set_native_liquid_glass_enabled', { enabled, appearance })
      .then((status) => {
        if (!cancelled && enabled && !status.applied) {
          setTheme(prev => prev.enableLiquidGlass ? { ...prev, enableLiquidGlass: false } : prev);
        }
      })
      .catch((err) => {
        console.warn('Failed to sync native Liquid Glass:', normalizeAppError(err).userMessage);
        if (!cancelled && enabled) {
          setTheme(prev => prev.enableLiquidGlass ? { ...prev, enableLiquidGlass: false } : prev);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [theme.enableLiquidGlass, theme.mode, systemTheme]);

  useEffect(() => {
    let cancelled = false;
    invoke<string | null>('read_last_panic_log')
      .then(log => {
        let seenFingerprint: string | null = null;
        try {
          seenFingerprint = localStorage.getItem(STARTUP_PANIC_LOG_SEEN_KEY);
        } catch {
          seenFingerprint = null;
        }
        if (cancelled || !shouldShowStartupPanicPrompt(log, seenFingerprint)) return;
        const panicLog = log || '';
        setStartupPanicPrompt({
          fingerprint: fingerprintPanicLog(panicLog),
          preview: panicLog.slice(-900).trim(),
        });
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    let timer: number | null = null;

    let shouldPrompt = false;
    try {
      const state = localStorage.getItem(STARTUP_PERMISSION_PREFLIGHT_STATE_KEY);
      if (state !== 'done') {
        const now = Date.now();
        const lockRaw = localStorage.getItem(STARTUP_PERMISSION_PREFLIGHT_LOCK_KEY);
        const lockAt = lockRaw ? Number(lockRaw) : 0;
        const lockValid = Number.isFinite(lockAt) && now - lockAt < STARTUP_PERMISSION_PREFLIGHT_LOCK_TTL_MS;
        if (!lockValid) {
          localStorage.setItem(STARTUP_PERMISSION_PREFLIGHT_LOCK_KEY, String(now));
          shouldPrompt = true;
        }
      }
    } catch {
      shouldPrompt = true;
    }

    if (shouldPrompt) {
      timer = window.setTimeout(() => {
        if (!cancelled) setStartupPermissionPromptOpen(true);
      }, 550);
    }

    const onStorage = (event: StorageEvent) => {
      if (event.key === STARTUP_PERMISSION_PREFLIGHT_STATE_KEY && event.newValue === 'done') {
        setStartupPermissionPromptOpen(false);
        setStartupPermissionPromptLoading(false);
      }
    };
    window.addEventListener('storage', onStorage);

    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  // DevTools 打开
  const handleOpenDevTools = useCallback(() => {
    invoke('open_devtools').catch(err => console.error('打开控制台失败:', normalizeAppError(err).userMessage));
  }, []);

  // Listen for system theme changes when in auto mode
  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = () => {
      setSystemTheme(mediaQuery.matches ? 'dark' : 'light');
    };
    setSystemTheme(mediaQuery.matches ? 'dark' : 'light');
    mediaQuery.addEventListener('change', handler);
    return () => mediaQuery.removeEventListener('change', handler);
  }, [theme.mode]);

  // 记录已处理的 transfer，防止重复处理
  const processedTransfersRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    let unlistenAccepted: (() => void) | undefined;

    listen<{ transferId: string; tabId: string; targetWindow: string }>('aether-tab-transfer-accepted', (event) => {
      const currentWindow = getCurrentWindow().label;

      if (processedTransfersRef.current.has(event.payload.transferId)) {
        return;
      }

      if (currentWindow !== event.payload.targetWindow) {
        processedTransfersRef.current.add(event.payload.transferId);

        const timeoutKey = `detach-timeout-${event.payload.transferId}`;
        const detachTimeout = (window as any)[timeoutKey];
        if (detachTimeout) {
          clearTimeout(detachTimeout);
          delete (window as any)[timeoutKey];
        }

        removeTabAfterTransfer(event.payload.tabId);
      }
    }).then(unlisten => {
      unlistenAccepted = unlisten;
    }).catch(() => {});

    return () => {
      unlistenAccepted?.();
    };
  }, [removeTabAfterTransfer]);

  const handleCloseTab = useCallback((id: string) => {
    setTabs(prev => {
      if (prev.length === 1) {
        getCurrentWindow().close().catch(() => {});
        return prev;
      }

      const nextTabs = prev.filter(tab => tab.id !== id);
      if (view === id) {
        setView((nextTabs[nextTabs.length - 1]?.id || prev[0].id) as ViewMode);
      }
      return nextTabs;
    });
  }, [view]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const isTyping = !!target?.closest('input, textarea, select, [contenteditable="true"]');
      if (isTyping) return;

      if (shortcutHelpOpen && event.key === 'Escape') {
        event.preventDefault();
        event.stopImmediatePropagation();
        setShortcutHelpOpen(false);
        return;
      }

      const action = resolveAppShortcut(event);
      if (!action) return;

      event.preventDefault();
      if (action === 'showShortcutHelp') {
        event.stopImmediatePropagation();
      }
      if (action === 'newWindow') {
        createNewWindow();
      } else if (action === 'closeTab') {
        handleCloseTab(view);
      } else if (action === 'showShortcutHelp') {
        setShortcutHelpOpen(true);
      }
    };
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [createNewWindow, handleCloseTab, shortcutHelpOpen, view]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    listen<NativeMenuCommand>(NATIVE_MENU_COMMAND_EVENT, event => {
      if (event.payload === 'open-settings') {
        setView('settings');
      }
    }).then(fn => {
      unlisten = fn;
    }).catch(() => {});

    return () => {
      unlisten?.();
    };
  }, []);

  const handleOpenTab = (id: string, labelTranslationKey: string, options?: { label?: string; initialPath?: string }) => {
    const uniqueId = `${id}-${Date.now()}`;
    const newTab = {
      id: uniqueId,
      labelTranslationKey,
      label: options?.label,
      initialPath: options?.initialPath,
      currentPath: options?.initialPath,
    };
    setTabs(prev => [...prev, newTab]);
    setView(uniqueId as ViewMode);
  };

  const handleTabTitleChange = useCallback((tabId: string, title: string) => {
    setTabs(prev => prev.map(tab => {
      if (tab.id !== tabId || tab.label === title) return tab;
      return { ...tab, label: title };
    }));
  }, []);

  const handleTabPathChange = useCallback((tabId: string, path: string) => {
    setTabs(prev => prev.map(tab => {
      if (tab.id !== tabId || tab.currentPath === path) return tab;
      return { ...tab, currentPath: path };
    }));
  }, []);

  const liquidGlassEnabled = theme.enableLiquidGlass === true;
  const resolvedThemeMode = resolveAppearance(theme.mode, systemTheme);

  const safeWallpaperUrl = !liquidGlassEnabled && theme.wallpaperUrl && isValidWallpaperUrl(theme.wallpaperUrl)
    ? theme.wallpaperUrl
    : undefined;
  const backgroundUrl = liquidGlassEnabled ? undefined : safeWallpaperUrl || (theme.enableGradient
    ? (resolvedThemeMode === 'light'
      ? "https://lh3.googleusercontent.com/aida-public/AB6AXuB9XaXmOrvTbEmkcGVQRTeI3kC1xcNNI9hs3iLUfwEmP9n4a8NBlhkuVjFfQQHJDbgc5-Hlu84crRzebo5m19DliX5ipgb9sdBh13reLuJDOlyYlkJo7pdUnYUTQbMfhTdIdErU6myMmdrUcyz1jC1_Zm6gK27RiLNAdjDNeAZHXpMzca9lHZFHKIvWwpSholpGfTPYSn3KLjl5aJg_IW4SpVHMDS7SLG8Vr1mGx7p0OKpvfUnm857Ege-iTZ6Oy3Lw1NgTOyJojb9O"
      : "https://lh3.googleusercontent.com/aida-public/AB6AXuB5rkbZYEmntgaSGeN7iqlRsjtR3W5ODpJVUMLqhdxav_8_-VdvCsdd4wypghvj96XDWyE48JagMP-B7V0x3U3asu3dsg1n034ddQ0OAmyCVv8dxrRxj95ASkdMKW9KSBHsY_j9nl5KvSSVu38q6ed-TvVStYA2QcFuskTmrbqbz9iT8CxblEDxGz3Xewr4wKDfnoxSxZz-ec7VLicJvF6p8Qpm7UhFoj4uZLTlrQE5-rihCK5xFZ66DT-bf92WmUxbngN82dckzps5")
    : undefined);
  const shortcutHelpSections = [
    {
      title: t('shortcutHelp.sections.window'),
      items: [
        ['?', t('shortcutHelp.items.showHelp')],
        ['Cmd+N', t('shortcutHelp.items.newWindow')],
        ['Cmd+W', t('shortcutHelp.items.closeTab')],
        ['Esc', t('shortcutHelp.items.dismiss')],
      ],
    },
    {
      title: t('shortcutHelp.sections.navigation'),
      items: [
        ['Cmd+[', t('shortcutHelp.items.back')],
        ['Cmd+]', t('shortcutHelp.items.forward')],
        ['Cmd+↑', t('shortcutHelp.items.parent')],
        ['Cmd+↓', t('shortcutHelp.items.openFolder')],
        ['Enter', t('shortcutHelp.items.openSelection')],
      ],
    },
    {
      title: t('shortcutHelp.sections.selection'),
      items: [
        ['↑ / ↓', t('shortcutHelp.items.moveSelection')],
        ['← / →', t('shortcutHelp.items.moveSelection')],
        ['Cmd+A', t('shortcutHelp.items.selectAll')],
        ['A-Z / 0-9', t('shortcutHelp.items.typeahead')],
        ['Esc', t('shortcutHelp.items.clearSelection')],
      ],
    },
    {
      title: t('shortcutHelp.sections.files'),
      items: [
        ['Cmd+C', t('shortcutHelp.items.copy')],
        ['Cmd+X', t('shortcutHelp.items.cut')],
        ['Cmd+V', t('shortcutHelp.items.paste')],
        ['Delete', t('shortcutHelp.items.delete')],
        ['Space', t('shortcutHelp.items.quickLook')],
      ],
    },
    {
      title: t('shortcutHelp.sections.view'),
      items: [
        ['Cmd+1', t('shortcutHelp.items.listView')],
        ['Cmd+2', t('shortcutHelp.items.gridView')],
        ['Cmd+3', t('shortcutHelp.items.columnView')],
        ['Cmd+Shift+.', t('shortcutHelp.items.hiddenFiles')],
        ['Cmd+R', t('shortcutHelp.items.refresh')],
      ],
    },
    {
      title: t('shortcutHelp.sections.tools'),
      items: [
        ['Cmd+I', t('shortcutHelp.items.info')],
        ['Cmd+Shift+R', t('shortcutHelp.items.aiRename')],
      ],
    },
  ];

  return (
    <MotionConfig reducedMotion="user">
    <div
      className={`h-screen w-screen overflow-hidden antialiased transition-all duration-700 flex rounded-[24px] ${liquidGlassEnabled ? 'liquid-glass-shell' : ''}`}
      style={{ fontFamily: theme.fontFamily || 'unset' }}
    >


      <div className="flex-1 relative overflow-hidden border border-transparent flex">
        {/* 壁纸层 */}
        {backgroundUrl && (
          <div
            className="absolute inset-0 z-0 transition-all duration-500"
            style={{
              backgroundImage: `url(${backgroundUrl})`,
              backgroundSize: 'cover',
              backgroundPosition: 'center',
              filter: theme.wallpaperBlur ? `blur(${theme.wallpaperBlur}px)` : undefined,
              transform: theme.wallpaperBlur ? 'scale(1.1)' : undefined,
            }}
          />
        )}

        <div
          className="flex flex-1 relative z-10 overflow-hidden"
          style={{ backdropFilter: backgroundUrl && theme.blurIntensity ? `blur(${theme.blurIntensity}px)` : undefined }}
        >
          <Sidebar currentView={view} currentPath={activeTabPath} onViewChange={setView} onOpenTab={handleOpenTab} theme={theme} tabs={tabs} />

          <main className="flex-1 flex flex-col h-full overflow-hidden">
            <TopBar
              currentView={view}
              onViewChange={setView}
              theme={theme}
              tabs={tabs}
              onCloseTab={handleCloseTab}
              onDetachTab={handleDetachTab}
              onAcceptDraggedTab={handleAcceptDraggedTab}
              onCreateWindow={() => createNewWindow()}
            />

          <div className="flex-1 relative overflow-hidden">
            <div className="relative h-full">
              <div className={`h-full ${view === 'settings' ? '' : 'hidden'}`}>
                <Suspense fallback={<div className="h-full flex items-center justify-center text-on-surface/40">加载设置中...</div>}>
                  <SettingsView
                    theme={theme}
                    onThemeChange={setTheme}
                    initialCategory={settingsInitialCategory}
                    favorites={favorites}
                    fileTags={fileTags}
                    recentItems={recentItems}
                    onImport={handleImportConfig}
                    onResetAllData={handleResetAllSettingsData}
                    onNavigateToHome={() => setView('desktop')}
                  />
                </Suspense>
              </div>
              <div className={`h-full ${view === 'storage' ? '' : 'hidden'}`}>
                <Suspense fallback={<div className="h-full flex items-center justify-center text-on-surface/40">加载存储页面中...</div>}>
                  <StorageView />
                </Suspense>
              </div>
              {/* Explorer views — keep mounted so tab-local state survives settings/storage screens */}
              <Suspense fallback={<div className="h-full flex items-center justify-center text-on-surface/45">正在加载文件视图...</div>}>
                {tabs.map(tab => (
                  <div key={tab.id} className={`h-full ${tab.id === view ? '' : 'hidden'}`}>
                    <ExplorerView
                      view={tab.id}
                      isActive={tab.id === view}
                      currentTabLabelKey={tab.labelTranslationKey}
                      initialPath={tab.initialPath}
                      theme={theme}
                      onThemeChange={setTheme}
                      onViewChange={setView}
                      selectedFileIds={tab.id === view ? selectedFileIds : []}
                      onSelectFiles={tab.id === view ? setSelectedFileIds : () => {}}
                      onSelectionCountChange={tab.id === view ? setVisibleItemCount : undefined}
                      onTitleChange={handleTabTitleChange}
                      onPathChange={handleTabPathChange}
                      onOpenTab={handleOpenTab}
                      onCreateWindow={(path, label) => createNewWindow(path, label, { forceStandalone: true })}
                      onStartTransfer={() => setIsTransferring(true)}
                      favorites={favorites}
                      onToggleFavorite={(id) => {
                        setFavorites(prev =>
                          prev.includes(id) ? prev.filter(f => f !== id) : [...prev, id]
                        );
                      }}
                      fileTags={fileTags}
                      onFileTagsChange={setFileTags}
                      recentItems={recentItems}
                      onRecordRecent={handleRecordRecent}
                      onClearRecent={() => setRecentItems([])}
                    />
                  </div>
                ))}
              </Suspense>
            </div>
          </div>

	          <footer className={`${liquidGlassEnabled ? 'liquid-footer' : 'border-divider bg-transparent'} h-9 border-t flex items-center justify-between px-6 text-secondary-custom text-[11px] font-medium shrink-0`}>
	            <div className="cursor-default tracking-wide flex items-center gap-4">
	               <div className="flex items-center gap-2">
	                 <span className="text-icon font-bold tabular-nums">{visibleItemCount}</span>
	                 <span>{t('footer.items', '个项目')}</span>
	               </div>
               <div className="w-px h-2.5 bg-divider" />
               <div className={`flex items-center gap-2 transition-all duration-300 ${selectedFileIds.length > 0 ? 'opacity-100' : 'opacity-0 translate-x-2'}`}>
                 <span className={selectedFileIds.length > 0 ? 'text-icon font-black' : ''}>{selectedFileIds.length}</span>
                 <span>{t('footer.itemsSelected', '项已选中')}</span>
               </div>
            </div>
            <div className="flex gap-4 items-center">
              {import.meta.env.DEV && (
                <span className="flex items-center gap-1.5 text-[9px] font-black uppercase tracking-widest text-amber-500/70 select-none">
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
                  DEV · {import.meta.env.MODE} · localhost:41873
                </span>
              )}
              {theme.enableDevTools && (
                <button
                  onClick={handleOpenDevTools}
                  className="hover:text-icon transition-colors flex items-center gap-1.5 uppercase tracking-widest text-[9px] font-black opacity-60 hover:opacity-100"
                  title="打开开发者控制台"
                >
                  <Terminal className="w-3 h-3 text-icon" /> 控制台
                </button>
              )}
            </div>
          </footer>
        </main>
        </div>
      </div>

      <AnimatePresence>
        {shortcutHelpOpen && (
          <motion.div
            className="fixed inset-0 z-[130] flex items-center justify-center bg-black/35 backdrop-blur-sm px-6"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onMouseDown={() => setShortcutHelpOpen(false)}
          >
            <motion.div
              initial={{ scale: 0.96, y: 12, opacity: 0 }}
              animate={{ scale: 1, y: 0, opacity: 1 }}
              exit={{ scale: 0.96, y: 12, opacity: 0 }}
              className={`${liquidGlassEnabled ? 'liquid-glass' : 'border border-primary/15 bg-surface/95'} w-full max-w-[780px] max-h-[82vh] overflow-hidden rounded-3xl shadow-2xl shadow-black/20`}
              onMouseDown={(event) => event.stopPropagation()}
            >
              <div className="flex items-start justify-between gap-4 p-6 border-b border-primary/10">
                <div className="flex items-start gap-4 min-w-0">
                  <div className="w-11 h-11 rounded-2xl bg-primary/10 flex items-center justify-center shrink-0">
                    <Keyboard className="w-5 h-5 text-primary" />
                  </div>
                  <div className="min-w-0">
                    <h3 className="text-[18px] font-black text-on-surface">{t('shortcutHelp.title')}</h3>
                    <p className="text-[13px] text-on-surface/55 mt-2 leading-relaxed">{t('shortcutHelp.description')}</p>
                  </div>
                </div>
                <button
                  onClick={() => setShortcutHelpOpen(false)}
                  className="p-2 rounded-xl hover:bg-primary/10 transition-colors shrink-0"
                  title={t('common.cancel')}
                >
                  <X className="w-4 h-4 text-on-surface/45" />
                </button>
              </div>
              <div className="max-h-[calc(82vh-104px)] overflow-auto p-6 grid grid-cols-1 md:grid-cols-2 gap-4">
                {shortcutHelpSections.map(section => (
                  <section key={section.title} className="rounded-2xl border border-primary/10 bg-primary/5 p-4">
                    <h4 className="text-[12px] font-black text-on-surface/45 uppercase tracking-widest mb-3">{section.title}</h4>
                    <div className="space-y-2">
                      {section.items.map(([keys, label]) => (
                        <div key={`${section.title}-${keys}`} className="flex items-center justify-between gap-4">
                          <span className="text-[13px] font-bold text-on-surface/70 leading-relaxed">{label}</span>
                          <kbd className="shrink-0 rounded-lg border border-on-surface/10 bg-on-surface/[0.04] px-2.5 py-1 text-[11px] font-black text-on-surface/65 shadow-sm">{keys}</kbd>
                        </div>
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            </motion.div>
          </motion.div>
        )}
        {startupPanicPrompt && (
          <motion.div
            className="fixed inset-0 z-[120] flex items-center justify-center bg-black/35 backdrop-blur-sm px-6"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <motion.div
              initial={{ scale: 0.96, y: 12, opacity: 0 }}
              animate={{ scale: 1, y: 0, opacity: 1 }}
              exit={{ scale: 0.96, y: 12, opacity: 0 }}
              className={`${liquidGlassEnabled ? 'liquid-glass' : 'border border-primary/15 bg-surface/95'} w-full max-w-[520px] rounded-3xl shadow-2xl shadow-black/20 overflow-hidden`}
            >
              <div className="flex items-start gap-4 p-6">
                <div className="w-11 h-11 rounded-2xl bg-amber-500/15 flex items-center justify-center shrink-0">
                  <AlertTriangle className="w-5 h-5 text-amber-500" />
                </div>
                <div className="min-w-0 flex-1">
                  <h3 className="text-[17px] font-black text-on-surface">{t('appDiagnostics.startupPanicTitle')}</h3>
                  <p className="text-[13px] text-on-surface/55 mt-2 leading-relaxed">
                    {t('appDiagnostics.startupPanicDescription')}
                  </p>
                </div>
                <button
                  onClick={() => markStartupPanicPromptSeen(startupPanicPrompt.fingerprint)}
                  className="p-2 rounded-xl hover:bg-primary/10 transition-colors shrink-0"
                  title={t('common.cancel')}
                >
                  <X className="w-4 h-4 text-on-surface/45" />
                </button>
              </div>
              {startupPanicPrompt.preview && (
                <pre className="mx-6 max-h-28 overflow-auto whitespace-pre-wrap break-words rounded-2xl bg-on-surface/[0.04] border border-primary/10 p-4 text-[11px] leading-relaxed text-on-surface/55 font-mono">
                  {startupPanicPrompt.preview}
                </pre>
              )}
              <div className="flex items-center justify-end gap-3 p-6">
                <button
                  onClick={() => markStartupPanicPromptSeen(startupPanicPrompt.fingerprint)}
                  className="px-5 py-3 rounded-2xl bg-primary/10 text-primary text-[12px] font-black hover:bg-primary/20 transition-colors"
                >
                  {t('appDiagnostics.dismiss')}
                </button>
                <button
                  onClick={() => openDiagnosticsSettings(startupPanicPrompt.fingerprint)}
                  className="px-5 py-3 rounded-2xl bg-primary text-on-primary text-[12px] font-black shadow-lg shadow-primary/20 hover:bg-primary/90 transition-colors"
                >
                  {t('appDiagnostics.viewDiagnostics')}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
        {startupPermissionPromptOpen && (
          <motion.div
            className="fixed inset-0 z-[119] flex items-center justify-center bg-black/35 backdrop-blur-sm px-6"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <motion.div
              initial={{ scale: 0.96, y: 12, opacity: 0 }}
              animate={{ scale: 1, y: 0, opacity: 1 }}
              exit={{ scale: 0.96, y: 12, opacity: 0 }}
              className={`${liquidGlassEnabled ? 'liquid-glass' : 'border border-primary/15 bg-surface/95'} w-full max-w-[560px] rounded-3xl shadow-2xl shadow-black/20 overflow-hidden`}
            >
              <div className="flex items-start gap-4 p-6">
                <div className="w-11 h-11 rounded-2xl bg-primary/15 flex items-center justify-center shrink-0">
                  <AlertTriangle className="w-5 h-5 text-primary" />
                </div>
                <div className="min-w-0 flex-1">
                  <h3 className="text-[17px] font-black text-on-surface">{t('appPermissions.startupTitle')}</h3>
                  <p className="text-[13px] text-on-surface/55 mt-2 leading-relaxed">
                    {t('appPermissions.startupDescription')}
                  </p>
                  <p className="text-[12px] text-on-surface/35 mt-3 leading-relaxed">
                    {t('appPermissions.systemBehaviorHint')}
                  </p>
                </div>
                <button
                  onClick={() => setStartupPermissionPromptOpen(false)}
                  disabled={startupPermissionPromptLoading}
                  className="p-2 rounded-xl hover:bg-primary/10 transition-colors shrink-0 disabled:opacity-50"
                  title={t('common.cancel')}
                >
                  <X className="w-4 h-4 text-on-surface/45" />
                </button>
              </div>
              <div className="flex items-center justify-end gap-3 p-6">
                <button
                  onClick={() => setStartupPermissionPromptOpen(false)}
                  disabled={startupPermissionPromptLoading}
                  className="px-5 py-3 rounded-2xl bg-primary/10 text-primary text-[12px] font-black hover:bg-primary/20 transition-colors disabled:opacity-50"
                >
                  {t('appPermissions.later')}
                </button>
                <button
                  onClick={runStartupPermissionPreflight}
                  disabled={startupPermissionPromptLoading}
                  className="px-5 py-3 rounded-2xl bg-primary text-on-primary text-[12px] font-black shadow-lg shadow-primary/20 hover:bg-primary/90 transition-colors disabled:opacity-60"
                >
                  {startupPermissionPromptLoading ? t('appPermissions.requesting') : t('appPermissions.continue')}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
        {isTransferring && (
          <Suspense fallback={null}>
            <TransferModal onClose={() => setIsTransferring(false)} theme={theme} />
          </Suspense>
        )}
      </AnimatePresence>
    </div>
    </MotionConfig>
  );
}
