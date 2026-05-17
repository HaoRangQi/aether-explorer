import { useCallback, useMemo, useState, useEffect, useRef, lazy, Suspense } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { useTranslation } from 'react-i18next';
import { Terminal } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { emitTo, listen } from '@tauri-apps/api/event';
import { Menu, MenuItem, PredefinedMenuItem, Submenu } from '@tauri-apps/api/menu';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { load } from '@tauri-apps/plugin-store';
import Sidebar from './components/Sidebar';
import TopBar, { TabTransferPayload } from './components/TopBar';
import ExplorerView from './components/ExplorerView';
import { ThemeSettings, ViewMode, TabData } from './types';
import {
  DEFAULT_THEME,
  FAVORITES_VIRTUAL_PATH,
  normalizeThemeSettings,
  loadThemeFromLocalStorage,
} from './lib/settings';
import { getPathLeaf, getInitialTabs as buildInitialTabs } from './lib/path-helpers';

const MAX_RECENT_ITEMS = 100;

const SettingsView = lazy(() => import('./components/SettingsView'));
const StorageView = lazy(() => import('./components/StorageView'));
const TransferModal = lazy(() => import('./components/TransferModal'));

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

export default function App() {
  const { t, i18n } = useTranslation();
  const [theme, setTheme] = useState<ThemeSettings>(loadThemeFromLocalStorage);
  const initialTabs = useMemo(() => getInitialTabs(theme.defaultHomePath || FAVORITES_VIRTUAL_PATH), [theme.defaultHomePath]);
  const [tabs, setTabs] = useState<TabData[]>(initialTabs);
  const [view, setView] = useState<ViewMode>(initialTabs[0]?.id || 'home');
  const [selectedFileIds, setSelectedFileIds] = useState<string[]>([]);
  const [visibleItemCount, setVisibleItemCount] = useState(0);
  const [isTransferring, setIsTransferring] = useState(false);
  const [storeReady, setStoreReady] = useState(false);
  const [systemTheme, setSystemTheme] = useState<'light' | 'dark'>(
    window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  );

  const [favorites, setFavorites] = useState<string[]>(loadFavoritesFromLocalStorage);
  const [fileTags, setFileTags] = useState<Record<string, string[]>>(loadFileTagsFromLocalStorage);
  const [recentItems, setRecentItems] = useState<string[]>(loadRecentItemsFromLocalStorage);
  const activeTab = useMemo(() => tabs.find(tab => tab.id === view), [tabs, view]);
  const activeTabPath = activeTab?.currentPath || activeTab?.initialPath;

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

  const createNewWindow = useCallback((tab?: TabData) => {
    // 关键：不传 tab 时（Cmd+N / 菜单 / 加号），把当前的默认首页带给新窗口，
    // 否则新窗口的 ExplorerView 会因 initialPath 为空而走 fallback。
    const fallbackPath = theme.defaultHomePath || FAVORITES_VIRTUAL_PATH;
    const path = tab?.currentPath || tab?.initialPath || fallbackPath;
    const label = tab?.label || (path && !path.startsWith('aether://') ? getPathLeaf(path) : undefined);
    invoke<string>('create_app_window', { initialPath: path, tabLabel: label }).catch(err => {
      console.error('创建新窗口失败:', err);
    });
  }, [theme.defaultHomePath]);

  const removeTabAfterTransfer = useCallback((tabId: string) => {
    console.log('=== removeTabAfterTransfer 被调用 ===');
    console.log('要删除的 tabId:', tabId);
    setTabs(prev => {
      console.log('当前标签页列表:', prev);
      console.log('当前标签页 IDs:', prev.map(t => t.id));
      console.log('标签页数量:', prev.length);

      // 检查 tabId 是否存在
      const tabExists = prev.some(t => t.id === tabId);
      console.log('要删除的标签页是否存在:', tabExists);

      if (prev.length <= 1) {
        console.log('只剩一个标签页，关闭窗口');
        // 最后一个标签页被拖走，关闭窗口
        getCurrentWindow().close().catch(() => {});
        return prev;
      }
      console.log('还有多个标签页，只删除被拖走的标签页');
      const nextTabs = prev.filter(tab => {
        const shouldKeep = tab.id !== tabId;
        console.log(`标签页 ${tab.id}: ${shouldKeep ? '保留' : '删除'}`);
        return shouldKeep;
      });
      console.log('删除后的标签页列表:', nextTabs);
      console.log('删除后的标签页 IDs:', nextTabs.map(t => t.id));
      console.log('删除后的标签页数量:', nextTabs.length);
      setView(current => {
        if (current !== tabId) return current;
        return (nextTabs[nextTabs.length - 1]?.id || prev[0].id) as ViewMode;
      });
      return nextTabs;
    });
  }, []);

  const handleDetachTab = useCallback((tab: TabData) => {
    createNewWindow(tab);
    removeTabAfterTransfer(tab.id);
  }, [createNewWindow, removeTabAfterTransfer]);

  const handleAcceptDraggedTab = useCallback((payload: TabTransferPayload) => {
    console.log('=== App.handleAcceptDraggedTab 被调用 ===');
    console.log('payload:', payload);
    const sourceWindow = payload.sourceWindowLabel;
    const currentWindow = getCurrentWindow().label;
    console.log('sourceWindow:', sourceWindow, 'currentWindow:', currentWindow);

    if (sourceWindow === currentWindow) {
      console.log('同窗口，忽略');
      return;
    }

    const nextTab = normalizeTransferredTab(payload.tab);
    console.log('准备添加标签页:', nextTab);
    setTabs(prev => {
      console.log('当前标签页:', prev);
      const newTabs = [...prev, nextTab];
      console.log('新标签页列表:', newTabs);
      return newTabs;
    });
    setView(nextTab.id as ViewMode);

    console.log('发送接受确认事件到源窗口:', sourceWindow);
    console.log('确认事件 payload:', {
      transferId: payload.transferId,
      tabId: payload.tab.id,
      targetWindow: currentWindow,
    });
    emitTo(sourceWindow, 'aether-tab-transfer-accepted', {
      transferId: payload.transferId,
      tabId: payload.tab.id,
      targetWindow: currentWindow, // 添加目标窗口标识
    }).then(() => {
      console.log('确认事件发送成功');
      // 取消源窗口的 detach timeout
      const timeoutKey = `detach-timeout-${payload.transferId}`;
      const detachTimeout = (window as any)[timeoutKey];
      if (detachTimeout) {
        console.log('取消源窗口的 detach timeout');
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
    localStorage.setItem('theme-settings', JSON.stringify(theme));

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
    localStorage.setItem('aether-file-tags', JSON.stringify(fileTags));

    if (!storeReady) return;
    loadSettingsStore().then(s => {
      s.set('fileTags', fileTags);
    }).catch(() => {});
  }, [fileTags, storeReady]);

  useEffect(() => {
    localStorage.setItem('aether-recent-items', JSON.stringify(recentItems));

    if (!storeReady) return;
    loadSettingsStore().then(s => {
      s.set('recentItems', recentItems);
    }).catch(() => {});
  }, [recentItems, storeReady]);

  const handleRecordRecent = useCallback((path: string) => {
    if (!path || path.startsWith('aether://')) return;
    setRecentItems(prev => [path, ...prev.filter(item => item !== path)].slice(0, MAX_RECENT_ITEMS));
  }, []);

  // Apply theme to document
  useEffect(() => {
    const root = window.document.documentElement;
    root.classList.remove('light', 'dark');

    if (theme.mode === 'auto') {
      root.classList.add(systemTheme);
    } else {
      root.classList.add(theme.mode);
    }

    root.style.setProperty('--primary', theme.accentColor);
    root.style.setProperty('--font-sans', theme.fontFamily || 'Inter');
  }, [theme, systemTheme]);

  useEffect(() => {
    const systemLanguage = navigator.language.toLowerCase().startsWith('zh') ? 'zh' : 'en';
    const nextLanguage = theme.followSystemLanguage ? systemLanguage : (theme.language || 'zh');
    if (i18n.language !== nextLanguage) {
      i18n.changeLanguage(nextLanguage);
    }
  }, [theme.language, theme.followSystemLanguage, i18n]);

  // DevTools 打开
  const handleOpenDevTools = useCallback(() => {
    invoke('open_devtools').catch(err => console.error('打开控制台失败:', err));
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
      console.log('=== 收到标签页接受确认事件 ===');
      console.log('event.payload:', event.payload);
      const currentWindow = getCurrentWindow().label;
      console.log('当前窗口:', currentWindow);
      console.log('目标窗口:', event.payload.targetWindow);
      console.log('transferId:', event.payload.transferId);

      // 防止重复处理同一个 transfer
      if (processedTransfersRef.current.has(event.payload.transferId)) {
        console.log('该 transfer 已处理过，忽略');
        return;
      }

      // 只有当前窗口不是目标窗口时，才删除标签页
      // 目标窗口刚刚添加了标签页，不应该删除
      if (currentWindow !== event.payload.targetWindow) {
        console.log('当前窗口是源窗口，删除标签页');
        processedTransfersRef.current.add(event.payload.transferId);

        // 取消 detach timeout（如果有的话）
        const timeoutKey = `detach-timeout-${event.payload.transferId}`;
        const detachTimeout = (window as any)[timeoutKey];
        if (detachTimeout) {
          console.log('取消 detach timeout');
          clearTimeout(detachTimeout);
          delete (window as any)[timeoutKey];
        }

        removeTabAfterTransfer(event.payload.tabId);
      } else {
        console.log('当前窗口是目标窗口，不删除标签页');
      }
    }).then(unlisten => {
      unlistenAccepted = unlisten;
    }).catch(() => {});

    return () => {
      unlistenAccepted?.();
    };
  }, [removeTabAfterTransfer]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      const isCmd = event.metaKey && !event.shiftKey && !event.altKey && !event.ctrlKey;
      if (!isCmd) return;

      if (key === 'n') {
        event.preventDefault();
        createNewWindow();
      } else if (key === 'w') {
        event.preventDefault();
        handleCloseTab(view);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [tabs.length, view]); // 需要感知 tabs 变化

  useEffect(() => {
    let disposed = false;

    async function setupAppMenu() {
      try {
        const appMenu = await Menu.new({
          items: [
            await Submenu.new({
              text: '文件',
              items: [
                await MenuItem.new({
                  text: '新建窗口',
                  accelerator: 'CmdOrCtrl+N',
                  action: () => createNewWindow(),
                }),
                await MenuItem.new({
                  text: '关闭标签页',
                  accelerator: 'CmdOrCtrl+W',
                  action: () => { handleCloseTab(view); },
                }),
                await PredefinedMenuItem.new({ item: 'Separator' }),
                await PredefinedMenuItem.new({ text: '关闭窗口', item: 'CloseWindow' }),
              ],
            }),
            await Submenu.new({
              text: '编辑',
              items: [
                await PredefinedMenuItem.new({ item: 'Undo' }),
                await PredefinedMenuItem.new({ item: 'Redo' }),
                await PredefinedMenuItem.new({ item: 'Separator' }),
                await PredefinedMenuItem.new({ item: 'Cut' }),
                await PredefinedMenuItem.new({ item: 'Copy' }),
                await PredefinedMenuItem.new({ item: 'Paste' }),
                await PredefinedMenuItem.new({ item: 'SelectAll' }),
              ],
            }),
            await Submenu.new({
              text: '窗口',
              items: [
                await PredefinedMenuItem.new({ item: 'Minimize' }),
                await PredefinedMenuItem.new({ item: 'Fullscreen' }),
                await PredefinedMenuItem.new({ item: 'BringAllToFront' }),
              ],
            }),
          ],
        });

        if (!disposed) await appMenu.setAsAppMenu();
      } catch {
        // Browser/dev-server preview does not expose the native menu API.
      }
    }

    setupAppMenu();
    return () => { disposed = true; };
  }, []); // createNewWindow 是稳定的，不需要作为依赖

  const handleCloseTab = (id: string) => {
    if (tabs.length === 1) {
      getCurrentWindow().close().catch(() => {});
      return;
    }

    setTabs(prev => {
      const nextTabs = prev.filter(tab => tab.id !== id);
      if (view === id) {
        setView((nextTabs[nextTabs.length - 1]?.id || prev[0].id) as ViewMode);
      }
      return nextTabs;
    });
  };

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

  const resolvedThemeMode = theme.mode === 'auto' ? systemTheme : theme.mode;

  const backgroundUrl = theme.wallpaperUrl || (resolvedThemeMode === 'light'
    ? "https://lh3.googleusercontent.com/aida-public/AB6AXuB9XaXmOrvTbEmkcGVQRTeI3kC1xcNNI9hs3iLUfwEmP9n4a8NBlhkuVjFfQQHJDbgc5-Hlu84crRzebo5m19DliX5ipgb9sdBh13reLuJDOlyYlkJo7pdUnYUTQbMfhTdIdErU6myMmdrUcyz1jC1_Zm6gK27RiLNAdjDNeAZHXpMzca9lHZFHKIvWwpSholpGfTPYSn3KLjl5aJg_IW4SpVHMDS7SLG8Vr1mGx7p0OKpvfUnm857Ege-iTZ6Oy3Lw1NgTOyJojb9O"
    : "https://lh3.googleusercontent.com/aida-public/AB6AXuB5rkbZYEmntgaSGeN7iqlRsjtR3W5ODpJVUMLqhdxav_8_-VdvCsdd4wypghvj96XDWyE48JagMP-B7V0x3U3asu3dsg1n034ddQ0OAmyCVv8dxrRxj95ASkdMKW9KSBHsY_j9nl5KvSSVu38q6ed-TvVStYA2QcFuskTmrbqbz9iT8CxblEDxGz3Xewr4wKDfnoxSxZz-ec7VLicJvF6p8Qpm7UhFoj4uZLTlrQE5-rihCK5xFZ66DT-bf92WmUxbngN82dckzps5");

  return (
    <div
      className="h-screen w-screen overflow-hidden antialiased transition-all duration-700 flex rounded-[24px]"
      style={{ fontFamily: theme.fontFamily || 'unset' }}
    >


      <div className="flex-1 relative overflow-hidden border border-transparent flex">
        {/* Background layers: wallpaper + blur */}
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
          className="absolute inset-0 z-[1] pointer-events-none transition-all duration-500"
          style={{
            backgroundColor: resolvedThemeMode === 'dark' ? `rgba(20, 19, 23, ${theme.transparency / 100})` : `rgba(253, 248, 253, ${theme.transparency / 100})`,
            backdropFilter: `blur(${theme.blurIntensity}px)`
          }}
        />

        <div className="flex flex-1 relative z-10 overflow-hidden">
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
            </div>
          </div>

	          <footer className="h-9 border-t border-on-surface/[0.03] bg-transparent flex items-center justify-between px-6 text-on-surface/40 text-[11px] font-medium shrink-0">
	            <div className="cursor-default tracking-wide flex items-center gap-4">
	               <div className="flex items-center gap-2">
	                 <span className="text-primary/70 font-bold tabular-nums">{visibleItemCount}</span>
	                 <span>{t('footer.items', '个项目')}</span>
	               </div>
               <div className="w-px h-2.5 bg-on-surface/10" />
               <div className={`flex items-center gap-2 transition-all duration-300 ${selectedFileIds.length > 0 ? 'opacity-100' : 'opacity-0 translate-x-2'}`}>
                 <span className={selectedFileIds.length > 0 ? 'text-primary font-black' : ''}>{selectedFileIds.length}</span>
                 <span>{t('footer.itemsSelected', '项已选中')}</span>
               </div>
            </div>
            <div className="flex gap-4 items-center">
              {theme.enableDevTools && (
                <button
                  onClick={handleOpenDevTools}
                  className="hover:text-primary transition-colors flex items-center gap-1.5 uppercase tracking-widest text-[9px] font-black opacity-60 hover:opacity-100"
                  title="打开开发者控制台"
                >
                  <Terminal className="w-3 h-3 text-primary" /> 控制台
                </button>
              )}
            </div>
          </footer>
        </main>
        </div>
      </div>

      <AnimatePresence>
        {isTransferring && (
          <Suspense fallback={null}>
            <TransferModal onClose={() => setIsTransferring(false)} theme={theme} />
          </Suspense>
        )}
      </AnimatePresence>
    </div>
  );
}
