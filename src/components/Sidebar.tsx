import { useEffect, useRef, useState } from 'react';
import type { MouseEvent, PointerEvent } from 'react';
import { motion } from 'motion/react';
import { useTranslation } from 'react-i18next';
import {
  Home,
  FileText,
  Download,
  Terminal,
  Clock,
  Cloud,
  ChevronDown,
  ChevronRight,
  HardDrive,
  RefreshCw,
  Upload,
  Wifi,
  Globe,
  Trash2,
  Circle,
  Settings
} from 'lucide-react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { invoke } from '@tauri-apps/api/core';
import { ViewMode, ThemeSettings, VolumeInfo, TabData } from '../types';

const FAVORITES_VIRTUAL_PATH = 'aether://favorites';
const RECENT_VIRTUAL_PATH = 'aether://recent';
const TAGS_VIRTUAL_PREFIX = 'aether://tags/';

interface DiskInfo {
  filesystem: string;
  size: string;
  used: string;
  available: string;
  capacity: string;
  capacity_value?: number;
  mount: string;
}

interface SidebarProps {
  currentView: ViewMode;
  currentPath?: string;
  onViewChange: (view: ViewMode) => void;
  onOpenTab: (id: string, labelKey: string, options?: { label?: string; initialPath?: string }) => void;
  theme: ThemeSettings;
  tabs: TabData[];
}

export default function Sidebar({ currentView, currentPath, onViewChange, onOpenTab, theme, tabs }: SidebarProps) {
  const { t } = useTranslation();
  const [diskInfo, setDiskInfo] = useState<DiskInfo | null>(null);
  const [volumes, setVolumes] = useState<VolumeInfo[]>([]);
  const [volumeMessage, setVolumeMessage] = useState('');
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>({});
  const [homeDir, setHomeDir] = useState('');
  const volumeMessageTimerRef = useRef<number | null>(null);
  const menuClickTimerRef = useRef<number | null>(null);

  const loadVolumes = () => {
    invoke<VolumeInfo[]>('list_volumes')
      .then(items => setVolumes(items.filter(item => item.is_external)))
      .catch(() => setVolumes([]));
  };

  const normalizeCapacity = (value?: string | number) => {
    if (typeof value === 'number') return `${Math.max(0, Math.min(100, Math.round(value)))}%`;
    const match = String(value || '').match(/\d+(?:\.\d+)?/);
    if (!match) return '0%';
    return `${Math.max(0, Math.min(100, Math.round(Number(match[0]))))}%`;
  };

  const getMenuPath = (id: string) => {
    if (id === 'favorites-list') return FAVORITES_VIRTUAL_PATH;
    if (id === 'recent') return RECENT_VIRTUAL_PATH;
    if (id.startsWith('tag-')) return `${TAGS_VIRTUAL_PREFIX}${id}`;
    if (!homeDir) return undefined;
    if (id === 'desktop' || id === 'home') return homeDir;
    const paths: Record<string, string> = {
      downloads: `${homeDir}/Downloads`,
      documents: `${homeDir}/Documents`,
      applications: '/Applications',
      icloud: `${homeDir}/Library/Mobile Documents/com~apple~CloudDocs`,
      macos: '/',
      network: '/Volumes',
      trash: `${homeDir}/.Trash`,
    };
    return paths[id];
  };

  useEffect(() => {
    let cancelled = false;
    invoke<DiskInfo>('get_disk_info', { path: '/' })
      .then(info => {
        if (!cancelled) setDiskInfo(info);
      })
      .catch(() => {
        if (!cancelled) setDiskInfo(null);
      });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    invoke<string>('get_home_dir')
      .then(path => {
        if (!cancelled) setHomeDir(path);
      })
      .catch(() => {
        if (!cancelled) setHomeDir('');
      });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      invoke<VolumeInfo[]>('list_volumes')
        .then(items => {
          if (!cancelled) setVolumes(items.filter(item => item.is_external));
        })
        .catch(() => {
          if (!cancelled) setVolumes([]);
        });
    };
    load();
    const interval = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        load();
      }
    }, 6000);
    const visibilityHandler = () => {
      if (document.visibilityState === 'visible') {
        load();
      }
    };
    document.addEventListener('visibilitychange', visibilityHandler);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', visibilityHandler);
      if (volumeMessageTimerRef.current) window.clearTimeout(volumeMessageTimerRef.current);
      if (menuClickTimerRef.current) window.clearTimeout(menuClickTimerRef.current);
    };
  }, []);

  const handleMenuClick = (id: string, labelKey: string) => {
    if (id === 'settings' || id === 'storage') {
      onViewChange(id as ViewMode);
      return;
    }
    if (menuClickTimerRef.current) window.clearTimeout(menuClickTimerRef.current);
    menuClickTimerRef.current = window.setTimeout(() => {
      menuClickTimerRef.current = null;
      openMenuTab(id, labelKey, false);
    }, 180);
  };

  const openMenuTab = (id: string, labelKey: string, forceNew: boolean) => {
    const initialPath = getMenuPath(id);
    const normalizeTabPath = (tab: TabData) => tab.currentPath || tab.initialPath;

    if (forceNew) {
      onOpenTab(id, labelKey, initialPath ? { initialPath } : undefined);
      return;
    }

    // 仅把当前路径仍然停在该导航根目录的 tab 视为“已存在”
    const matchingTabs = initialPath
      ? tabs.filter(tab => normalizeTabPath(tab) === initialPath)
      : tabs.filter(t => t.labelTranslationKey === labelKey);
    if (matchingTabs.length > 0) {
      // 当前标签页已是同类型，不做跳转
      if (matchingTabs.some(t => t.id === currentView)) return;
      // 否则定位到第一个同名标签页
      onViewChange(matchingTabs[0].id as ViewMode);
    } else {
      // 没有同名标签则新建
      onOpenTab(id, labelKey, initialPath ? { initialPath } : undefined);
    }
  };

  const handleMenuDoubleClick = (id: string, labelKey: string) => {
    if (id === 'settings' || id === 'storage') return;
    if (menuClickTimerRef.current) {
      window.clearTimeout(menuClickTimerRef.current);
      menuClickTimerRef.current = null;
    }
    // 双击：始终新建标签页
    openMenuTab(id, labelKey, true);
  };

  const toggleSection = (title: string) => {
    setCollapsedSections(prev => ({ ...prev, [title]: !prev[title] }));
  };

  const openVolume = (volume: VolumeInfo) => {
    onOpenTab(`volume-${volume.name.replace(/\s+/g, '-').toLowerCase()}`, 'tabs.volume', {
      label: volume.name,
      initialPath: volume.path,
    });
  };

  const ejectVolume = async (volume: VolumeInfo) => {
    try {
      await invoke('eject_volume', { path: volume.path });
      setVolumeMessage(t('messages.ejected', { name: volume.name }));
      loadVolumes();
    } catch (err) {
      setVolumeMessage(t('messages.ejectFailed', { error: String(err) }));
    }
    if (volumeMessageTimerRef.current) window.clearTimeout(volumeMessageTimerRef.current);
    volumeMessageTimerRef.current = window.setTimeout(() => setVolumeMessage(''), 2600);
  };

  const stopVolumeEjectEvent = (event: MouseEvent<HTMLButtonElement> | PointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
  };

  const handleDragStart = (e: MouseEvent) => {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (target.closest('button, input, a, [data-no-drag]')) return;
    getCurrentWindow().startDragging().catch(() => {
      invoke('start_window_drag').catch(() => {});
    });
  };

  const sections = [
    {
      title: 'sidebar.system',
      collapsible: false,
      items: [
        { id: 'settings', label: 'sidebar.settings', icon: Settings },
      ]
    },
    {
      title: 'sidebar.favorites',
      collapsible: true,
      items: [
        { id: 'favorites-list', label: 'sidebar.favoritesList', icon: () => <Circle className="w-3.5 h-3.5 fill-icon text-icon" /> },
        { id: 'applications', label: 'sidebar.applications', icon: Terminal },
        { id: 'desktop', label: 'sidebar.homeDirectory', icon: Home },
        { id: 'documents', label: 'sidebar.documents', icon: FileText },
        { id: 'downloads', label: 'sidebar.downloads', icon: Download },
        { id: 'recent', label: 'sidebar.recent', icon: Clock },
      ]
    },
      {
        title: 'sidebar.locations',
        collapsible: true,
        items: [
          { id: 'icloud', label: 'sidebar.icloud', icon: Cloud },
          { id: 'macos', label: 'sidebar.macos', icon: HardDrive },
          { id: 'network', label: 'sidebar.network', icon: Globe },
          { id: 'trash', label: 'sidebar.trash', icon: Trash2 },
        ]
      },
    {
      title: 'sidebar.tags',
      collapsible: true,
      items: [
        { id: 'tag-red', label: 'sidebar.red', icon: () => <div className="w-3 h-3 rounded-full bg-[#ff5f56]" /> },
        { id: 'tag-orange', label: 'sidebar.orange', icon: () => <div className="w-3 h-3 rounded-full bg-[#ffbd2e]" /> },
        { id: 'tag-yellow', label: 'sidebar.yellow', icon: () => <div className="w-3 h-3 rounded-full bg-[#fcd430]" /> },
        { id: 'tag-green', label: 'sidebar.green', icon: () => <div className="w-3 h-3 rounded-full bg-[#27c93f]" /> },
        { id: 'tag-blue', label: 'sidebar.blue', icon: () => <div className="w-3 h-3 rounded-full bg-[#007aff]" /> },
        { id: 'tag-purple', label: 'sidebar.purple', icon: () => <div className="w-3 h-3 rounded-full bg-[#bf5af2]" /> },
        { id: 'tag-gray', label: 'sidebar.gray', icon: () => <div className="w-3 h-3 rounded-full bg-[#8e8e93]" /> },
        { id: 'tag-all', label: 'sidebar.allTags', icon: () => <div className="w-3 h-3 rounded-full border-2 border-on-surface/40" /> },
      ]
    }
  ];

  return (
    <nav className="w-sidebar-width max-w-sidebar-width border-r border-transparent flex flex-col pt-4 pb-8 z-40 shrink-0 overflow-hidden group/sidebar">
      {/* Mac Window Controls */}
      <div className="flex items-center gap-2 px-5 mb-8" data-no-drag>
        <button
          onClick={() => getCurrentWindow().close()}
          className="w-3 h-3 rounded-full bg-[#ff5f56] border border-[#e0443e] hover:brightness-90 cursor-pointer"
          title={t('tooltips.close')}
        />
        <button
          onClick={() => getCurrentWindow().minimize()}
          className="w-3 h-3 rounded-full bg-[#ffbd2e] border border-[#dea123] hover:brightness-90 cursor-pointer"
          title={t('tooltips.minimize')}
        />
        <button
          onClick={() => getCurrentWindow().toggleMaximize()}
          className="w-3 h-3 rounded-full bg-[#27c93f] border border-[#1aab29] hover:brightness-90 cursor-pointer"
          title={t('tooltips.maximize')}
        />
        <div
          className="h-5 flex-1 cursor-grab active:cursor-grabbing"
          data-tauri-drag-region
          onMouseDown={handleDragStart}
          title={t('tooltips.dragWindow')}
        />
      </div>

      <div className="flex-1 min-w-0 overflow-y-auto overflow-x-hidden px-3 space-y-6 auto-scrollbar">
        {sections.map((section, idx) => (
          <div key={idx} className="space-y-1">
            {section.collapsible ? (
              <button
                onClick={() => toggleSection(section.title)}
              className="w-full px-3 flex items-center justify-between text-[11px] font-black text-on-surface/45 mb-2 hover:text-icon transition-colors min-w-0"
                title={collapsedSections[section.title] ? t('tooltips.expand') : t('tooltips.collapse')}
              >
                <span className="truncate">{t(section.title)}</span>
                <span className="opacity-0 group-hover/sidebar:opacity-100 transition-opacity shrink-0">
                  {collapsedSections[section.title] ? <ChevronRight className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                </span>
              </button>
            ) : (
              <h3 className="px-3 text-[11px] font-black text-on-surface/45 mb-2 truncate">{t(section.title)}</h3>
            )}
            {(!section.collapsible || !collapsedSections[section.title]) && section.items.map((item) => {
              const menuPath = getMenuPath(item.id);
              const isVirtualFavorites = currentPath === FAVORITES_VIRTUAL_PATH;
              const isVirtualRecent = currentPath === RECENT_VIRTUAL_PATH;
              const isVirtualTag = Boolean(currentPath?.startsWith(TAGS_VIRTUAL_PREFIX));
              const isActive = item.id === 'favorites-list'
                ? isVirtualFavorites
                : item.id === 'recent'
                  ? isVirtualRecent
                  : item.id.startsWith('tag-')
                    ? currentPath === `${TAGS_VIRTUAL_PREFIX}${item.id}`
                    : menuPath
                      ? currentPath === menuPath && !isVirtualFavorites && !isVirtualRecent && !isVirtualTag
                      : currentView === item.id || currentView.startsWith(item.id + '-');
              const Icon = item.icon;
              return (
                <button
                  key={item.id}
                  onClick={() => handleMenuClick(item.id, item.label)}
                  onDoubleClick={() => handleMenuDoubleClick(item.id, item.label)}
                  className={`w-full flex items-center px-3 py-1 rounded-lg transition-all duration-300 group relative cursor-pointer font-semibold
                    ${isActive ? 'text-on-surface font-black' : 'text-on-surface/75 hover:bg-on-surface/[0.04] hover:text-on-surface'}
                  `}
                >
                  {isActive && (
                    <motion.div
                      layoutId="sidebar-pill"
                      className="absolute inset-0 bg-panel-custom border border-custom rounded-lg z-0"
                      transition={{ type: 'spring', bounce: 0.2, duration: 0.6 }}
                    />
                  )}
                  <div className="flex items-center gap-2 relative z-10 w-full text-left">
                    <div className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 transition-all duration-300
                      ${isActive ? 'bg-active-icon text-on-primary shadow-md shadow-custom' : 'bg-panel-custom text-on-surface/40 group-hover:bg-hover-custom'}
                    `}>
                      {/* @ts-ignore */}
                      <Icon className="w-3.5 h-3.5" />
                    </div>
                    <span className="text-[13px] flex-1 truncate text-left tracking-tight font-semibold">{t(item.label)}</span>
                    {item.RightElement && <div className="shrink-0 scale-75 origin-right"><item.RightElement /></div>}
                  </div>
                </button>
              );
            })}
          </div>
        ))}

        <div className="space-y-1">
          <div className="w-full px-3 flex items-center justify-between text-[11px] font-black text-on-surface/45 mb-2 min-w-0">
            <button
              onClick={() => toggleSection('sidebar.externalDisks')}
              className="flex items-center gap-1 hover:text-icon transition-colors min-w-0"
              title={collapsedSections['sidebar.externalDisks'] ? '展开' : '收起'}
            >
              <span className="opacity-0 group-hover/sidebar:opacity-100 transition-opacity shrink-0">
                {collapsedSections['sidebar.externalDisks'] ? <ChevronRight className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
              </span>
              <span className="truncate">外置磁盘</span>
            </button>
            <button
              onClick={loadVolumes}
              className="p-0.5 rounded hover:bg-hover-custom hover:text-icon transition-all opacity-0 group-hover/sidebar:opacity-100 shrink-0"
              title={t('tooltips.refreshExternalDisks')}
            >
              <RefreshCw className="w-3 h-3" />
            </button>
          </div>
          {!collapsedSections['sidebar.externalDisks'] && (
            <div className="space-y-1">
              {volumes.length === 0 ? (
                  <div className="mx-3 max-w-full overflow-hidden px-2.5 py-2 rounded-lg bg-primary/5 border border-primary/10 text-[10.5px] text-on-surface/35 leading-snug break-words">
                  未检测到 USB 或外置磁盘
                </div>
              ) : volumes.map(volume => {
                const isActive = currentPath === volume.path;
                return (
                  <div key={volume.path} className="group relative">
                    <button
                      onClick={() => openVolume(volume)}
                      className={`w-full flex items-center px-3 py-1.5 rounded-lg transition-all duration-300 relative cursor-pointer font-semibold ${isActive ? 'text-on-surface font-black bg-panel-custom' : 'text-on-surface/75 hover:bg-on-surface/[0.04] hover:text-on-surface'}`}
                    >
                      <div className="flex items-center gap-2 relative z-10 w-full text-left min-w-0">
                        <div className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 transition-all duration-300 ${isActive ? 'bg-active-icon text-on-primary shadow-md shadow-custom' : 'bg-panel-custom text-on-surface/40 group-hover:bg-hover-custom'}`}>
                          <HardDrive className="w-3.5 h-3.5" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="text-[13px] truncate tracking-tight">{volume.name}</span>
                            <span className="text-[9px] text-icon font-black shrink-0">{volume.capacity}</span>
                          </div>
                          <div className="h-1 rounded-full bg-on-surface/10 overflow-hidden mt-1">
                            <div className="h-full rounded-full bg-primary" style={{ width: `${volume.capacity_value}%` }} />
                          </div>
                        </div>
                      </div>
                    </button>
                    {volume.is_ejectable && (
                      <button
                        type="button"
                        onMouseDown={stopVolumeEjectEvent}
                        onPointerDown={stopVolumeEjectEvent}
                        onDoubleClick={stopVolumeEjectEvent}
                        onClick={(e) => {
                          stopVolumeEjectEvent(e);
                          void ejectVolume(volume);
                        }}
                        className="absolute right-1 top-1.5 z-20 p-1.5 rounded-lg bg-panel-custom text-on-surface/35 opacity-0 group-hover:opacity-100 hover:text-icon hover:bg-hover-custom transition-all"
                        title={`弹出 ${volume.name}`}
                        aria-label={`弹出 ${volume.name}`}
                      >
                        <Upload className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          {volumeMessage && (
            <div className="mx-3 mt-2 px-3 py-2 rounded-lg bg-panel-custom text-[11px] text-icon font-bold">
              {volumeMessage}
            </div>
          )}
        </div>
      </div>

      {diskInfo && (
        <button
          onClick={() => handleMenuClick('storage', 'sidebar.storage')}
          className={`mx-3 mt-4 px-3 py-2 rounded-lg border text-left transition-all shrink-0 ${currentView === 'storage' ? 'bg-panel-custom border-custom text-on-surface' : 'bg-panel-custom border-custom hover:bg-hover-custom text-on-surface/70'}`}
        >
          <div className="flex items-center justify-between gap-2 mb-1.5">
            <div className="flex items-center gap-1.5 min-w-0">
              <HardDrive className="w-3.5 h-3.5 text-icon shrink-0" />
              <span className="text-[11px] font-bold truncate">{t('sidebar.storage')}</span>
            </div>
            <span className="text-[10px] font-black text-icon shrink-0 tabular-nums">{normalizeCapacity(diskInfo.capacity_value ?? diskInfo.capacity)}</span>
          </div>
          <div className="h-1.5 rounded-full bg-on-surface/10 overflow-hidden mb-1.5">
            <div className="h-full rounded-full bg-primary" style={{ width: normalizeCapacity(diskInfo.capacity_value ?? diskInfo.capacity) }} />
          </div>
          <div className="flex justify-between gap-2 text-[10px] text-on-surface/35 font-mono whitespace-nowrap leading-none">
            <span className="truncate min-w-0">{diskInfo.used} / {diskInfo.size}</span>
            <span className="shrink-0">余 {diskInfo.available}</span>
          </div>
        </button>
      )}
    </nav>
  );
}
