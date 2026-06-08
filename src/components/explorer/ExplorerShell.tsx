import React from 'react';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import type { TFunction } from 'i18next';
import {
  AppWindowMac,
  Check,
  ChevronLeft,
  ChevronRight,
  Columns,
  Copy,
  Edit2,
  ExternalLink,
  Eye,
  EyeOff,
  Folder,
  Grid2X2,
  History,
  Image as ImageIcon,
  Layers3,
  List,
  MoreHorizontal,
  Palette,
  PanelRight,
  PanelRightClose,
  RefreshCw,
  Search,
  Shield,
  Sparkles,
  Star,
  Tag,
  Terminal,
  Upload,
  X,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { QUICK_ACCESS } from '../../constants';
import type { NavigationHistory } from '../../lib/navigation-history';
import { isRemotePath } from '../../lib/path-helpers';
import { safeInvoke } from '../../lib/tauri-runtime';
import type { DisplayMode, FileItem, GroupBy, ThemeSettings, ViewMode } from '../../types';
import CrossWindowDropBanner, { type IncomingFileDragView } from '../CrossWindowDropBanner';
import Tooltip from '../Tooltip';
import ColumnView from './ColumnView';
import FileListView from './FileListView';
import GridView from './GridView';

type BreadcrumbSegment = {
  segment: string;
  path: string;
};

type DirectoryErrorKind = 'permission' | 'notFound' | 'generic';

type ProtectedRootInfo = {
  path: string;
  label: string;
};

type SelectionBox = {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
};

type SortConfig = {
  key: string;
  direction: 'asc' | 'desc';
} | null;

type VisibleRange = {
  start: number;
  end: number;
  totalHeight: number;
  offsetTop: number;
};

type ExplorerShellProps = {
  activeDropdown: string | null;
  allColumns: Array<string | undefined>;
  approveProtectedRoot: () => void;
  areAllTagged: (items: FileItem[], tagId: string) => boolean;
  baseView: string;
  breadcrumbSegments: BreadcrumbSegment[];
  clearContextMenu: () => void;
  closeInspector: () => void;
  columnFilesCache: Record<string, FileItem[]>;
  columnLoadErrors: Record<string, string>;
  containerRef: React.RefObject<HTMLDivElement | null>;
  currentDisplayTitle: string;
  currentLevelFiles: FileItem[];
  currentPath: string;
  directoryErrorKind: DirectoryErrorKind | null;
  displayMode: DisplayMode;
  displayedFiles: FileItem[];
  dropdownRef: React.RefObject<HTMLDivElement | null>;
  favorites: string[];
  favoritesVirtualPath: string;
  fileListRef: React.RefObject<HTMLDivElement | null>;
  focusCurrentWindow: () => void | Promise<void>;
  getActionDirectory: (preferredPath?: string) => string;
  getActionFiles: (file?: FileItem) => FileItem[];
  getColumnFiles: (parentPath: string | undefined) => FileItem[];
  getGroupKey: (file: FileItem, groupBy: GroupBy) => string;
  getTagLabel: (tagId: string) => string;
  groupBy: GroupBy;
  groupOptions: Array<{ id: GroupBy; label: string }>;
  groupedFiles: Record<string, FileItem[]>;
  handleContainerMouseDown: (event: React.MouseEvent) => void;
  handleContainerMouseMove: (event: React.MouseEvent) => void;
  handleContainerMouseUp: (event: React.MouseEvent) => void;
  handleContainerScroll: () => void;
  handleContextMenu: (event: React.MouseEvent, fileIds: string[], isBlank?: boolean, targetDir?: string) => void | Promise<void>;
  handleCopyPaths: (items?: FileItem[]) => void | Promise<void>;
  handleImportFiles: () => void | Promise<void>;
  handleNewFile: (targetPath?: string) => void | Promise<void>;
  handleNewFolder: (targetPath?: string) => void | Promise<void>;
  handleOpenTerminal: (file?: FileItem | null) => void | Promise<void>;
  handleQuickCreateClick: (event: React.MouseEvent<HTMLButtonElement>) => void;
  handleQuickLook: (file?: FileItem) => void | Promise<void>;
  handleSort: (key: string) => void;
  handleSurfaceDragOver: (event: React.DragEvent) => void;
  handleSurfaceDrop: (event: React.DragEvent) => void | Promise<void>;
  hasIncomingFileDrag: () => boolean;
  homeDir: string;
  importExternalPaths: (paths: string[], targetPath?: string) => Promise<boolean>;
  incomingDragVisibleMs: number;
  incomingFileDrag: IncomingFileDragView | null;
  inspectorOverride: boolean;
  isEditingPath: boolean;
  isFavoritesRoot: boolean;
  isMarqueeDragging: boolean;
  isReceivingExternalDrag: boolean;
  isRecentRoot: boolean;
  isRemoteRoot: boolean;
  isTagRoot: boolean;
  isVirtualRoot: boolean;
  lastSelectedFile: FileItem | null;
  liquidGlassEnabled: boolean;
  listItemHeight: number;
  listModifiedColClass: string;
  loadError: string;
  loadingRemoteConnectionName: string;
  navigateBack: () => void;
  navigateForward: () => void;
  navigateToPath: (path: string, options?: { replace?: boolean }) => void;
  navigationHistory: NavigationHistory;
  needsProtectedPathConsent: boolean;
  onClearRecent: () => void;
  onSelectFiles: (ids: string[]) => void;
  onStartTransfer: () => void;
  onThemeChange: (theme: ThemeSettings) => void;
  onToggleFavorite: (path: string) => void;
  openCurrentInNewTab: (file?: FileItem | null) => void;
  pathInput: string;
  pathScrollRef: React.RefObject<HTMLDivElement | null>;
  protectedRoot: ProtectedRootInfo | null;
  recentItems: string[];
  refreshCurrentDir: (fullRefresh?: boolean, targetPath?: string) => Promise<FileItem[]>;
  remotePathParts: { remotePath?: string } | null;
  renderFileItem: (file: FileItem, isColumnItem?: boolean, sortIndex?: number, sourceColumnIndex?: number) => React.ReactNode;
  resetColumnState: () => void;
  retryProtectedPath: () => void;
  scrollContainerRef: React.RefObject<HTMLDivElement | null>;
  scrollToBottom: () => void;
  scrollToTop: () => void;
  searchQuery: string;
  selectedFileIds: string[];
  selectedFiles: FileItem[];
  selectionBox: SelectionBox | null;
  setActiveDropdown: React.Dispatch<React.SetStateAction<string | null>>;
  setDisplayMode: React.Dispatch<React.SetStateAction<DisplayMode>>;
  setGroupBy: React.Dispatch<React.SetStateAction<GroupBy>>;
  setIsEditingPath: React.Dispatch<React.SetStateAction<boolean>>;
  setPathInput: React.Dispatch<React.SetStateAction<string>>;
  setSearchQuery: React.Dispatch<React.SetStateAction<string>>;
  setShowAIRename: React.Dispatch<React.SetStateAction<boolean>>;
  setShowCheckboxCol: React.Dispatch<React.SetStateAction<boolean>>;
  setShowOperationHistory: React.Dispatch<React.SetStateAction<boolean>>;
  setShowSortCol: React.Dispatch<React.SetStateAction<boolean>>;
  showBlockingLoading: boolean;
  showCheckboxCol: boolean;
  showFeedback: (message: string) => void;
  showSortCol: boolean;
  sortConfig: SortConfig;
  t: TFunction;
  tagColors: Record<string, string>;
  theme: ThemeSettings;
  toggleTagForItems: (tagId: string, items?: FileItem[]) => void;
  view: ViewMode;
  virtualRootLabel: string;
  visibleRange: VisibleRange | null;
};

export default function ExplorerShell({
  activeDropdown,
  allColumns,
  approveProtectedRoot,
  areAllTagged,
  baseView,
  breadcrumbSegments,
  clearContextMenu,
  closeInspector,
  columnFilesCache,
  columnLoadErrors,
  containerRef,
  currentDisplayTitle,
  currentLevelFiles,
  currentPath,
  directoryErrorKind,
  displayMode,
  displayedFiles,
  dropdownRef,
  favorites,
  favoritesVirtualPath,
  fileListRef,
  focusCurrentWindow,
  getActionDirectory,
  getActionFiles,
  getColumnFiles,
  getGroupKey,
  getTagLabel,
  groupBy,
  groupOptions,
  groupedFiles,
  handleContainerMouseDown,
  handleContainerMouseMove,
  handleContainerMouseUp,
  handleContainerScroll,
  handleContextMenu,
  handleCopyPaths,
  handleImportFiles,
  handleNewFile,
  handleNewFolder,
  handleOpenTerminal,
  handleQuickCreateClick,
  handleQuickLook,
  handleSort,
  handleSurfaceDragOver,
  handleSurfaceDrop,
  hasIncomingFileDrag,
  homeDir,
  importExternalPaths,
  incomingDragVisibleMs,
  incomingFileDrag,
  inspectorOverride,
  isEditingPath,
  isFavoritesRoot,
  isMarqueeDragging,
  isReceivingExternalDrag,
  isRecentRoot,
  isRemoteRoot,
  isTagRoot,
  isVirtualRoot,
  lastSelectedFile,
  liquidGlassEnabled,
  listItemHeight,
  listModifiedColClass,
  loadError,
  loadingRemoteConnectionName,
  navigateBack,
  navigateForward,
  navigateToPath,
  navigationHistory,
  needsProtectedPathConsent,
  onClearRecent,
  onSelectFiles,
  onStartTransfer,
  onThemeChange,
  onToggleFavorite,
  openCurrentInNewTab,
  pathInput,
  pathScrollRef,
  protectedRoot,
  recentItems,
  refreshCurrentDir,
  remotePathParts,
  renderFileItem,
  resetColumnState,
  retryProtectedPath,
  scrollContainerRef,
  scrollToBottom,
  scrollToTop,
  searchQuery,
  selectedFileIds,
  selectedFiles,
  selectionBox,
  setActiveDropdown,
  setDisplayMode,
  setGroupBy,
  setIsEditingPath,
  setPathInput,
  setSearchQuery,
  setShowAIRename,
  setShowCheckboxCol,
  setShowOperationHistory,
  setShowSortCol,
  showBlockingLoading,
  showCheckboxCol,
  showFeedback,
  showSortCol,
  sortConfig,
  t,
  tagColors,
  theme,
  toggleTagForItems,
  view,
  virtualRootLabel,
  visibleRange,
}: ExplorerShellProps) {
  return (
    <div className="flex-1 flex flex-col overflow-hidden" onClick={() => {
      if (!isMarqueeDragging) {
        clearContextMenu();
        onSelectFiles([]);
      }
    }} onContextMenu={(event) => {
      if (event.target === event.currentTarget || (event.target as HTMLElement).closest('[data-explorer-surface]')) {
        void handleContextMenu(event, [], true, getActionDirectory());
      }
    }}>
      <div className="flex-1 overflow-hidden px-8 py-4 min-h-0">
        <div className={`${displayMode === 'column' ? 'w-full h-full' : 'max-w-7xl mx-auto w-full'} h-full min-h-0 flex flex-col space-y-4`}>
          <div className="flex items-center justify-between gap-3 shrink-0">
            <div className="flex items-center gap-1 mr-1">
              <button
                onClick={navigateBack}
                disabled={navigationHistory.backStack.length === 0}
                className={`p-1.5 rounded-lg transition-colors ${navigationHistory.backStack.length > 0 ? 'hover:bg-hover-custom text-on-surface/50 hover:text-on-surface' : 'text-on-surface/20 cursor-not-allowed'}`}
                title={t('tooltips.back')}
              >
                <ChevronLeft className="w-5 h-5" />
              </button>
              <button
                onClick={navigateForward}
                disabled={navigationHistory.forwardStack.length === 0}
                className={`p-1.5 rounded-lg transition-colors ${navigationHistory.forwardStack.length > 0 ? 'hover:bg-hover-custom text-on-surface/50 hover:text-on-surface' : 'text-on-surface/20 cursor-not-allowed'}`}
                title={t('tooltips.forward')}
              >
                <ChevronRight className="w-5 h-5" />
              </button>
            </div>
            <div className="flex-1 flex items-center bg-search-custom rounded-xl px-3 py-1.5 border border-transparent h-10 shrink-0 overflow-hidden transition-all duration-300 hover:border-custom hover:shadow-custom">
              {!isVirtualRoot && (
                <button
                  onClick={async () => {
                    await navigator.clipboard.writeText(currentPath);
                  }}
                  className="p-1.5 hover:bg-primary/10 rounded-md transition-colors text-on-surface/50 hover:text-on-surface mr-2 shrink-0"
                  title="Copy Path"
                >
                  <Copy className="w-4 h-4" />
                </button>
              )}

              {isVirtualRoot ? (
                <div className="flex items-center gap-2 flex-1 px-1 overflow-hidden text-[13px] text-on-surface/80 min-w-0">
                  {isFavoritesRoot ? (
                    <Star className="w-4 h-4 shrink-0 text-icon fill-current" />
                  ) : (
                    <span className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: tagColors[baseView] || '#8e8e93' }} />
                  )}
                  <span className="truncate font-bold">{virtualRootLabel}</span>
                </div>
              ) : isEditingPath ? (
                <input
                  type="text"
                  value={pathInput}
                  onChange={(event) => setPathInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      navigateToPath(pathInput);
                      setIsEditingPath(false);
                    }
                    if (event.key === 'Escape') {
                      setIsEditingPath(false);
                    }
                  }}
                  onBlur={() => setIsEditingPath(false)}
                  autoFocus
                  className="flex-1 bg-transparent px-2 text-[13px] text-on-surface outline-none border-none min-w-0"
                />
              ) : (
                <div ref={pathScrollRef} className="flex items-center gap-1.5 flex-1 px-1 overflow-x-auto scrollbar-hide text-[13px] text-on-surface/80 min-w-0">
                  <button
                    onClick={() => onToggleFavorite(currentPath)}
                    className={`p-1.5 mr-1 hover:bg-primary/20 rounded-full transition-colors ${favorites.includes(currentPath) ? 'text-primary' : 'text-on-surface/30'}`}
                  >
                    <Star className={`w-4 h-4 ${favorites.includes(currentPath) ? 'fill-current' : ''}`} />
                  </button>
                  <Folder className="w-4 h-4 shrink-0 text-on-surface/50" />
                  <button
                    onClick={() => navigateToPath(homeDir)}
                    className="shrink-0 hover:text-primary hover:underline transition-colors cursor-pointer"
                  >
                    {homeDir ? homeDir.split('/').pop() : t('explorer.localStorage')}
                  </button>

                  {breadcrumbSegments.map(({ segment, path }) => (
                    <React.Fragment key={path}>
                      <ChevronRight className="w-3.5 h-3.5 shrink-0 text-on-surface/30" />
                      <button
                        onClick={() => navigateToPath(path)}
                        className={`shrink-0 hover:text-primary hover:underline transition-colors cursor-pointer ${path === currentPath ? 'font-bold text-on-surface cursor-default hover:no-underline' : ''}`}
                        disabled={path === currentPath}
                      >
                        {segment}
                      </button>
                    </React.Fragment>
                  ))}
                </div>
              )}

              <button
                onClick={() => {
                  setPathInput(currentPath);
                  setIsEditingPath(true);
                }}
                className="p-1.5 hover:bg-primary/20 rounded-md transition-colors text-on-surface/50 hover:text-on-surface ml-2 shrink-0"
                title="Edit Path"
              >
                <Edit2 className="w-4 h-4" />
              </button>
            </div>

            <div className="w-56 relative shrink-0 group">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-on-surface/40 group-hover:text-icon transition-colors" />
              <input
                type="text"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder={t('topbar.searchPlaceholder') || '搜索文件...'}
                className="w-full bg-search-custom border border-custom rounded-xl py-2 pl-10 pr-9 text-[13px] text-primary-custom placeholder:text-secondary-custom focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary focus:bg-hover-custom transition-all h-10 hover:border-custom shadow-custom"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-1 text-on-surface/45 hover:bg-primary/15 hover:text-on-surface transition-colors"
                  title={t('common.clear', '清空')}
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>

          {displayMode !== 'column' && !currentPath && view !== 'downloads' && (
            <section>
              <h2 className="text-[17px] font-bold text-on-surface mb-6">{t('explorer.quickAccess')}</h2>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                {QUICK_ACCESS.map((folder) => (
                  <motion.div
                    key={folder.id}
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    className="bg-primary/20 rounded-2xl p-4 flex items-center gap-4 cursor-pointer border border-transparent hover:bg-primary/30 transition-all group"
                  >
                    <div className={`w-12 h-12 rounded-full flex items-center justify-center shrink-0
                      ${folder.color === 'primary' ? 'bg-primary/20 text-primary'
                        : folder.color === 'secondary' ? 'bg-secondary/20 text-secondary' : 'bg-tertiary/20 text-tertiary'}
                    `}>
                      {folder.icon === 'folder' && <Folder className="w-6 h-6 fill-current" />}
                      {folder.icon === 'palette' && <Palette className="w-6 h-6 fill-current" />}
                      {folder.icon === 'image' && <ImageIcon className="w-6 h-6 fill-current" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <h3 className="text-[15px] font-medium text-on-surface truncate group-hover:text-primary transition-colors">{folder.name}</h3>
                      <p className="text-[11px] text-on-surface/40">{folder.items} {t('explorer.items')} • {t('explorer.modifiedAt')} {folder.modified}</p>
                    </div>
                  </motion.div>
                ))}
              </div>
            </section>
          )}

          <section className="flex-1 flex flex-col min-h-0 relative">
            <div className="flex justify-between items-center mb-3 shrink-0">
              <div className="min-w-0 flex-1 pr-4">
                <h2
                  className="max-w-[22rem] truncate text-[17px] font-bold text-on-surface"
                  title={currentDisplayTitle}
                >
                  {currentDisplayTitle}
                </h2>
              </div>
              <div className="flex items-center gap-4">
                {!isVirtualRoot && view !== 'downloads' && null}
                {isRecentRoot && recentItems.length > 0 && (
                  <button
                    onClick={() => {
                      onClearRecent();
                      showFeedback(t('messages.recentCleared', '已清空最近使用'));
                    }}
                    className="text-[12px] text-on-surface/55 font-semibold hover:text-primary hover:underline"
                  >
                    {t('explorer.clearRecent', '清空')}
                  </button>
                )}

                <div className="flex items-center bg-panel-custom p-1 rounded-xl border border-transparent mr-2 relative" ref={dropdownRef} onMouseDown={(event) => event.stopPropagation()} onClick={(event) => event.stopPropagation()}>
                  <Tooltip label={t('tooltips.import', '导入文件')}>
                    <button
                      onClick={() => setActiveDropdown(activeDropdown === 'upload' ? null : 'upload')}
                      className={`p-1.5 hover:bg-hover-custom rounded-lg hover:text-on-surface transition-all active:scale-95 ${activeDropdown === 'upload' ? 'bg-hover-custom text-icon' : 'text-on-surface/60'}`}
                    >
                      <Upload className="w-4 h-4" />
                    </button>
                  </Tooltip>
                  <Tooltip label={t('tooltips.transferManager', '传输管理器')}>
                    <button
                      onClick={onStartTransfer}
                      className="p-1.5 hover:bg-hover-custom rounded-lg hover:text-on-surface transition-all active:scale-95 text-on-surface/60"
                    >
                      <ExternalLink className="w-4 h-4" />
                    </button>
                  </Tooltip>
                  <Tooltip label={t('tooltips.openInTerminal', '在终端打开')}>
                    <button
                      onClick={() => handleOpenTerminal(lastSelectedFile)}
                      className="p-1.5 hover:bg-hover-custom rounded-lg hover:text-on-surface transition-all active:scale-95 text-on-surface/60"
                    >
                      <Terminal className="w-4 h-4" />
                    </button>
                  </Tooltip>
                  <Tooltip label={t('tooltips.tags', '标签')}>
                    <button
                      onClick={() => setActiveDropdown(activeDropdown === 'tag' ? null : 'tag')}
                      className={`p-1.5 hover:bg-hover-custom rounded-lg hover:text-on-surface transition-all active:scale-95 ${activeDropdown === 'tag' ? 'bg-hover-custom text-icon' : 'text-on-surface/60'}`}
                    >
                      <Tag className="w-4 h-4" />
                    </button>
                  </Tooltip>
                  <Tooltip label={t('explorer.groupBy', '分组')}>
                    <button
                      onClick={() => setActiveDropdown(activeDropdown === 'group' ? null : 'group')}
                      className={`p-1.5 hover:bg-primary/10 rounded-lg hover:text-on-surface transition-all active:scale-95 ${activeDropdown === 'group' ? 'bg-primary/20 text-primary' : 'text-on-surface/60'}`}
                    >
                      <Layers3 className="w-4 h-4" />
                    </button>
                  </Tooltip>
                  <Tooltip label={theme.showPreviewPanel ? t('tooltips.hideInspector', '隐藏简介') : t('tooltips.showInspector', '显示简介')}>
                    <button
                      onClick={() => onThemeChange({ ...theme, showPreviewPanel: !theme.showPreviewPanel })}
                      className={`p-1.5 hover:bg-primary/10 rounded-lg hover:text-on-surface transition-all active:scale-95 ${theme.showPreviewPanel ? 'bg-primary/20 text-primary' : 'text-on-surface/60'}`}
                    >
                      {theme.showPreviewPanel ? <PanelRightClose className="w-4 h-4" /> : <PanelRight className="w-4 h-4" />}
                    </button>
                  </Tooltip>
                  <Tooltip label={theme.showHiddenFiles ? t('tooltips.hideHiddenFiles', '隐藏隐藏文件') : t('tooltips.showHiddenFiles', '显示隐藏文件')}>
                    <button
                      onClick={() => onThemeChange({ ...theme, showHiddenFiles: !theme.showHiddenFiles })}
                      className={`p-1.5 hover:bg-primary/10 rounded-lg hover:text-on-surface transition-all active:scale-95 ${theme.showHiddenFiles ? 'bg-primary/20 text-primary' : 'text-on-surface/60'}`}
                    >
                      {theme.showHiddenFiles ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </Tooltip>
                  <Tooltip label={t('tooltips.createTabDoubleClickWindow', '双击新建窗口')}>
                    <button
                      onClick={handleQuickCreateClick}
                      className="p-1.5 hover:bg-primary/10 rounded-lg hover:text-on-surface transition-all active:scale-95 text-on-surface/60"
                    >
                      <AppWindowMac className="w-4 h-4" />
                    </button>
                  </Tooltip>
                  <Tooltip label={t('tooltips.refresh', '刷新')}>
                    <button
                      onClick={() => refreshCurrentDir(true)}
                      className="p-1.5 hover:bg-primary/10 rounded-lg hover:text-on-surface transition-all active:scale-95 text-on-surface/60"
                    >
                      <RefreshCw className="w-4 h-4" />
                    </button>
                  </Tooltip>
                  <Tooltip label="更多">
                    <button
                      onClick={() => setActiveDropdown(activeDropdown === 'more' ? null : 'more')}
                      className={`p-1.5 hover:bg-primary/10 rounded-lg hover:text-on-surface transition-all active:scale-95 ${activeDropdown === 'more' ? 'bg-primary/20 text-primary' : 'text-on-surface/60'}`}
                    >
                      <MoreHorizontal className="w-4 h-4" />
                    </button>
                  </Tooltip>

                  <AnimatePresence>
                    {activeDropdown && (
                      <motion.div
                        initial={{ opacity: 0, y: 10, scale: 0.95 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: 10, scale: 0.95 }}
                        className="absolute top-full mt-2 right-0 w-56 bg-primary/10 border border-primary/20 rounded-2xl shadow-2xl z-[60] overflow-hidden p-1 backdrop-blur-3xl"
                      >
                        {activeDropdown === 'upload' && (
                          <div className="p-2 space-y-1">
                            <button onClick={handleImportFiles} className="w-full text-left px-3 py-1.5 rounded-lg hover:bg-primary/20 text-[13px]">{t('transfer.uploadFile', 'Upload File')}</button>
                            <button onClick={async () => {
                              const selected = await openDialog({ multiple: true, directory: true });
                              const paths = Array.isArray(selected) ? selected : selected ? [selected] : [];
                              if (paths.length > 0) {
                                await importExternalPaths(paths, getActionDirectory());
                              }
                              setActiveDropdown(null);
                            }} className="w-full text-left px-3 py-1.5 rounded-lg hover:bg-primary/20 text-[13px]">{t('transfer.uploadFolder', 'Upload Folder')}</button>
                          </div>
                        )}
                        {activeDropdown === 'tag' && (
                          <div className="p-2 grid grid-cols-4 gap-2">
                            {Object.entries(tagColors).map(([tag, color]) => (
                              <button
                                key={tag}
                                onClick={() => toggleTagForItems(tag)}
                                className={`relative w-8 h-8 rounded-full border transition-transform hover:scale-110 ${
                                  areAllTagged(selectedFiles, tag) ? 'border-on-surface shadow-[0_0_0_2px_rgba(var(--primary-rgb),0.35)]' : 'border-white/10'
                                }`}
                                style={{ backgroundColor: color }}
                                title={getTagLabel(tag)}
                              >
                                {areAllTagged(selectedFiles, tag) && <Check className="absolute inset-0 m-auto w-4 h-4 text-white drop-shadow" />}
                              </button>
                            ))}
                          </div>
                        )}
                        {activeDropdown === 'group' && (
                          <div className="p-2 space-y-1">
                            {groupOptions.map(item => (
                              <button
                                key={item.id}
                                onClick={() => { setGroupBy(item.id); setActiveDropdown(null); }}
                                className={`w-full flex items-center justify-between px-3 py-1.5 rounded-lg hover:bg-primary/20 text-[13px] ${groupBy === item.id ? 'bg-primary text-on-primary' : 'text-on-surface'}`}
                              >
                                {item.label}
                                {groupBy === item.id && <Check className="w-3.5 h-3.5" />}
                              </button>
                            ))}
                          </div>
                        )}
                        {activeDropdown === 'more' && (
                          <div className="p-2 space-y-1">
                            <button onClick={() => handleNewFolder()} className="w-full text-left px-3 py-1.5 rounded-lg hover:bg-primary/20 text-[13px]">{t('explorer.newFolder', '新建文件夹')}</button>
                            <button onClick={() => handleNewFile()} className="w-full text-left px-3 py-1.5 rounded-lg hover:bg-primary/20 text-[13px]">{t('explorer.newFile', '新建文件')}</button>
                            <button onClick={() => openCurrentInNewTab(lastSelectedFile)} className="w-full text-left px-3 py-1.5 rounded-lg hover:bg-primary/20 text-[13px]">{t('explorer.openInNewTab', '在新标签页中打开')}</button>
                            <div className="my-1 h-px bg-primary/10" />
                            <button onClick={() => { onThemeChange({ ...theme, showPreviewPanel: true }); setActiveDropdown(null); }} className="w-full text-left px-3 py-1.5 rounded-lg hover:bg-primary/20 text-[13px]">{t('explorer.showInspector', '显示检查器')}</button>
                            <button onClick={() => handleQuickLook(lastSelectedFile ?? undefined)} className="w-full text-left px-3 py-1.5 rounded-lg hover:bg-primary/20 text-[13px]">{t('explorer.quickLook', 'Quick Look')}</button>
                            <button onClick={() => handleOpenTerminal(lastSelectedFile)} className="w-full text-left px-3 py-1.5 rounded-lg hover:bg-primary/20 text-[13px]">{t('explorer.openInTerminal', '在终端打开')}</button>
                            <button onClick={() => handleCopyPaths(lastSelectedFile ? getActionFiles(lastSelectedFile) : [])} className="w-full text-left px-3 py-1.5 rounded-lg hover:bg-primary/20 text-[13px]">{t('explorer.copyPath', '拷贝为路径名')}</button>
                            <div className="my-1 h-px bg-primary/10" />
                            <button onClick={() => {
                              if (isRemoteRoot || selectedFiles.some(file => isRemotePath(file.path))) {
                                showFeedback(t('messages.remoteReadOnly', { defaultValue: '远程访问第一版仅支持浏览。' }));
                                setActiveDropdown(null);
                                return;
                              }
                              setShowAIRename(true);
                              setActiveDropdown(null);
                            }} className="w-full text-left px-3 py-1.5 rounded-lg hover:bg-primary/20 text-[13px] flex items-center gap-2">
                              <Sparkles className="w-3.5 h-3.5 text-primary" /> {t('explorer.aiAssistant', 'AI 文件助手')}
                            </button>
                            <button onClick={() => { setShowOperationHistory(true); setActiveDropdown(null); }} className="w-full text-left px-3 py-1.5 rounded-lg hover:bg-primary/20 text-[13px] flex items-center gap-2">
                              <History className="w-3.5 h-3.5 text-on-surface/50" /> {t('explorer.operationHistory', '操作历史')}
                            </button>
                            <div className="my-1 h-px bg-primary/10" />
                            <button onClick={() => { handleSort('name'); setActiveDropdown(null); }} className="w-full text-left px-3 py-1.5 rounded-lg hover:bg-primary/20 text-[13px]">{t('explorer.sortByName', '按名称排序')}</button>
                            <button onClick={() => { handleSort('modified'); setActiveDropdown(null); }} className="w-full text-left px-3 py-1.5 rounded-lg hover:bg-primary/20 text-[13px]">{t('explorer.sortByModified', '按修改时间排序')}</button>
                            <button onClick={() => { setGroupBy(groupBy === 'none' ? 'kind' : 'none'); setActiveDropdown(null); }} className="w-full text-left px-3 py-1.5 rounded-lg hover:bg-primary/20 text-[13px]">{groupBy === 'none' ? t('explorer.useGroups', '启用分组') : t('explorer.disableGroups', '取消分组')}</button>
                            <div className="my-1 h-px bg-primary/10" />
                            <p className="px-3 py-1 text-[10px] font-black text-on-surface/30 uppercase tracking-widest">显示</p>
                            <button onClick={() => setShowCheckboxCol(value => !value)} className="w-full flex items-center justify-between px-3 py-1.5 rounded-lg hover:bg-primary/20 text-[13px]">
                              <span>显示勾选框</span>
                              {showCheckboxCol && <Check className="w-3.5 h-3.5 text-primary" />}
                            </button>
                            <button onClick={() => setShowSortCol(value => !value)} className="w-full flex items-center justify-between px-3 py-1.5 rounded-lg hover:bg-primary/20 text-[13px]">
                              <span>显示排序</span>
                              {showSortCol && <Check className="w-3.5 h-3.5 text-primary" />}
                            </button>
                          </div>
                        )}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>

                <div className="flex p-1 bg-panel-custom rounded-lg border border-transparent">
                  <button
                    onClick={() => setDisplayMode('list')}
                    className={`p-1 rounded-sm transition-colors ${displayMode === 'list' ? 'bg-hover-custom text-icon' : 'text-on-surface/40 hover:text-on-surface'}`}
                  >
                    <List className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => setDisplayMode('grid')}
                    className={`p-1 rounded-sm transition-colors ${displayMode === 'grid' ? 'bg-hover-custom text-icon' : 'text-on-surface/40 hover:text-on-surface'}`}
                  >
                    <Grid2X2 className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => { setDisplayMode('column'); resetColumnState(); }}
                    className={`p-1 rounded-sm transition-colors ${displayMode === 'column' ? 'bg-hover-custom text-icon' : 'text-on-surface/40 hover:text-on-surface'}`}
                  >
                    <Columns className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>

            <div
              ref={containerRef}
              data-explorer-surface="true"
              onClick={() => {
                if (inspectorOverride) closeInspector();
              }}
              onContextMenu={(event) => {
                if ((event.target as HTMLElement).closest('.file-item')) return;
                void handleContextMenu(event, [], true);
              }}
              onScroll={handleContainerScroll}
              onMouseDownCapture={(event) => {
                if (event.button === 2) void focusCurrentWindow();
              }}
              onMouseDown={handleContainerMouseDown}
              onMouseMove={handleContainerMouseMove}
              onMouseUp={handleContainerMouseUp}
              onMouseLeave={handleContainerMouseUp}
              onDragEnter={(event) => {
                if (hasIncomingFileDrag()) {
                  void focusCurrentWindow();
                }
                if (event.dataTransfer.types.includes('Files')) {
                  void focusCurrentWindow();
                }
              }}
              onDragOver={handleSurfaceDragOver}
              onDrop={handleSurfaceDrop}
              className="relative flex-1 min-h-0 flex flex-col overflow-hidden"
            >
              {incomingFileDrag && (
                <CrossWindowDropBanner
                  drag={incomingFileDrag}
                  currentPath={currentPath}
                  defaultMode={theme.crossWindowDropDefault || 'copy'}
                  visibleMs={incomingDragVisibleMs}
                  liquidGlassEnabled={liquidGlassEnabled}
                  t={t}
                />
              )}
              {isReceivingExternalDrag && !incomingFileDrag && (
                <div className="absolute inset-0 z-30 flex items-center justify-center bg-primary/10 backdrop-blur-sm border-2 border-dashed border-primary/60 rounded-2xl m-2 pointer-events-none">
                  <div className="bg-surface/95 rounded-2xl px-6 py-4 shadow-xl text-center">
                    <div className="text-on-surface font-bold text-sm">
                      {t('crossWindow.externalDropHint', {
                        path: currentPath || '当前目录',
                        defaultValue: '松手即可复制到 {{path}}',
                      })}
                    </div>
                  </div>
                </div>
              )}
              {showBlockingLoading && (
                <div className="flex-1 min-h-0 flex items-center justify-center px-6">
                  {isRemoteRoot ? (
                    <div className="flex max-w-lg flex-col items-center gap-3 text-center">
                      <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
                        <RefreshCw className="w-5 h-5 animate-spin text-primary" />
                      </div>
                      <div>
                        <p className="text-[14px] font-black text-on-surface/70">
                          {t('explorer.remoteLoadingTitle', '正在连接远程服务器')}
                        </p>
                        <p className="mt-1 break-all text-[12px] font-semibold text-on-surface/35">
                          {loadingRemoteConnectionName}
                          {remotePathParts?.remotePath ? ` · ${remotePathParts.remotePath}` : ''}
                        </p>
                      </div>
                    </div>
                  ) : (
                    <div className="text-on-surface/40 text-sm">{t('explorer.loading')}</div>
                  )}
                </div>
              )}
              {!showBlockingLoading && !loadError && needsProtectedPathConsent && protectedRoot && (
                <div className="flex-1 min-h-0 flex flex-col items-center justify-center gap-6">
                  <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center">
                    <Shield className="w-8 h-8 text-primary" />
                  </div>
                  <p className="text-on-surface/60 text-sm font-bold">
                    {t('dialogs.protectedPathTitle', '这个位置可能触发 macOS 权限弹框')}
                  </p>
                  <p className="text-on-surface/35 text-xs max-w-md text-center px-4 leading-relaxed">
                    {t('dialogs.protectedPathDescription', {
                      root: protectedRoot.label,
                      defaultValue: `当前目录位于“${protectedRoot.label}”下。为了避免应用一启动就连续弹系统权限框，Aether 会先等你明确继续，再去请求系统访问。`,
                    })}
                  </p>
                  <div className="flex gap-3">
                    <button
                      onClick={approveProtectedRoot}
                      className="px-6 py-3 bg-primary text-on-primary font-black rounded-2xl text-[13px] shadow-lg shadow-primary/20 hover:scale-[1.02] transition-all"
                    >
                      {t('dialogs.continueAccess', '继续访问')}
                    </button>
                    <button
                      onClick={() => navigateToPath(favoritesVirtualPath, { replace: true })}
                      className="px-6 py-3 bg-primary/10 text-on-surface font-bold rounded-2xl text-[13px] hover:bg-primary/20 transition-all"
                    >
                      {t('dialogs.backHome', '先回首页')}
                    </button>
                  </div>
                </div>
              )}
              {!showBlockingLoading && loadError && (
                <div className="flex-1 min-h-0 flex flex-col items-center justify-center gap-6">
                  <div className="w-16 h-16 rounded-full bg-red-400/10 flex items-center justify-center">
                    <Shield className="w-8 h-8 text-red-400" />
                  </div>
                  <p className="text-on-surface/50 text-sm font-bold">
                    {isRemoteRoot
                      ? t('explorer.remoteLoadFailedTitle', '远程目录加载失败')
                      : directoryErrorKind === 'permission'
                        ? t('dialogs.permissionDeniedTitle', '无权访问此目录')
                        : directoryErrorKind === 'notFound'
                          ? t('dialogs.notFoundTitle', '目录不存在或暂不可用')
                          : t('dialogs.readFailedTitle', '目录读取失败')}
                  </p>
                  <p className="text-on-surface/30 text-xs max-w-md text-center px-4 whitespace-pre-line">
                    {isRemoteRoot
                      ? t('explorer.remoteLoadFailedDescription', '请检查服务器地址、端口、账号凭据和起始路径，然后重试。')
                      : directoryErrorKind === 'permission'
                        ? t('dialogs.permissionDeniedDescription', '此目录被 macOS 隐私策略保护，或当前运行实例没有继承到已授权的稳定应用身份。若你明明在系统设置里开过权限，但每次启动还是反复弹框，通常不是你不会配，而是当前构建没有用稳定签名身份启动，系统把它当成了新的 app。')
                        : directoryErrorKind === 'notFound'
                          ? t('dialogs.notFoundDescription', '这个路径当前不存在，或者对应位置还没挂载完成。先确认目录、磁盘或 iCloud 位置还在。')
                          : t('dialogs.readFailedDescription', '这次读取没成功，但不一定是权限问题。可以先重试；如果只有受保护目录失败，再去系统设置里检查授权。')}
                  </p>
                  <div className="flex gap-3">
                    {directoryErrorKind === 'permission' && (
                      <button
                        onClick={() => safeInvoke('open_system_settings').catch(() => {})}
                        className="px-6 py-3 bg-primary text-on-primary font-black rounded-2xl text-[13px] shadow-lg shadow-primary/20 hover:scale-[1.02] transition-all"
                      >
                        {t('dialogs.openSystemSettings', '打开系统设置')}
                      </button>
                    )}
                    <button
                      onClick={retryProtectedPath}
                      className="px-6 py-3 bg-primary/10 text-on-surface font-bold rounded-2xl text-[13px] hover:bg-primary/20 transition-all"
                    >
                      {t('dialogs.retry', '重试')}
                    </button>
                  </div>
                  {directoryErrorKind === 'permission' && (
                    <p className="text-on-surface/20 text-[11px] max-w-sm text-center leading-relaxed">
                      {t('dialogs.permissionSteps', '操作步骤：点击“打开系统设置” → 隐私与安全性 → 完全磁盘访问权限 → 打开 Aether Explorer 开关 → 回到此页面点击“重试”。')}
                    </p>
                  )}
                  <p className="text-on-surface/15 text-[11px] max-w-lg text-center break-all px-4">
                    {loadError}
                  </p>
                </div>
              )}
              {!showBlockingLoading && !loadError && currentLevelFiles.length === 0 && displayedFiles.length > 0 && (
                <div className="flex-1 min-h-0 flex items-center justify-center text-on-surface/30 text-sm">{t('explorer.noResults', '没有匹配结果')}</div>
              )}
              {!showBlockingLoading && !loadError && displayedFiles.length === 0 && (
                <div className="flex-1 min-h-0 flex items-center justify-center text-on-surface/30 text-sm">
                  {isFavoritesRoot
                    ? t('explorer.emptyFavorites', '暂无收藏')
                    : isRecentRoot
                      ? t('explorer.emptyRecent', '暂无最近使用')
                      : isTagRoot
                        ? t('explorer.emptyTag', '暂无此颜色标签的项目')
                        : t('explorer.emptyFolder', '此文件夹为空')}
                </div>
              )}
              {selectionBox && (
                <div
                  className="absolute z-50 border border-primary bg-primary/20 pointer-events-none rounded-sm"
                  style={{
                    left: Math.min(selectionBox.x1, selectionBox.x2),
                    top: Math.min(selectionBox.y1, selectionBox.y2),
                    width: Math.abs(selectionBox.x2 - selectionBox.x1),
                    height: Math.abs(selectionBox.y2 - selectionBox.y1),
                  }}
                />
              )}
              {displayMode === 'grid' && (
                <GridView
                  currentLevelFiles={currentLevelFiles}
                  groupBy={groupBy}
                  groupedFiles={groupedFiles}
                  handleContainerScroll={handleContainerScroll}
                  renderFileItem={renderFileItem}
                  scrollContainerRef={scrollContainerRef}
                  scrollToBottom={scrollToBottom}
                  scrollToTop={scrollToTop}
                  t={t}
                  theme={theme}
                />
              )}

              {displayMode === 'list' && (
                <FileListView
                  currentLevelFiles={currentLevelFiles}
                  fileListRef={fileListRef}
                  groupBy={groupBy}
                  groupedFiles={groupedFiles}
                  handleContainerScroll={handleContainerScroll}
                  handleSort={handleSort}
                  listItemHeight={listItemHeight}
                  listModifiedColClass={listModifiedColClass}
                  onSelectFiles={onSelectFiles}
                  renderFileItem={renderFileItem}
                  scrollContainerRef={scrollContainerRef}
                  scrollToBottom={scrollToBottom}
                  scrollToTop={scrollToTop}
                  selectedFileIds={selectedFileIds}
                  showCheckboxCol={showCheckboxCol}
                  showSortCol={showSortCol}
                  sortConfig={sortConfig}
                  t={t}
                  visibleRange={visibleRange}
                />
              )}

              {displayMode === 'column' && (
                <ColumnView
                  allColumns={allColumns}
                  columnFilesCache={columnFilesCache}
                  columnLoadErrors={columnLoadErrors}
                  currentLevelFiles={currentLevelFiles}
                  currentPath={currentPath}
                  getColumnFiles={getColumnFiles}
                  getGroupKey={getGroupKey}
                  groupBy={groupBy}
                  handleContextMenu={handleContextMenu}
                  renderFileItem={renderFileItem}
                  scrollContainerRef={scrollContainerRef}
                  t={t}
                  theme={theme}
                />
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
