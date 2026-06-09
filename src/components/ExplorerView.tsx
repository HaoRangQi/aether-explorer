import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { Search, Folder, Palette, Image as ImageIcon, ChevronRight, ChevronLeft, Grid2X2, List, Columns, Info, Edit3, Copy, FolderArchive, Trash2, Edit2, Upload, Tag, MoreHorizontal, Star, Layers3, Check, Eye, EyeOff, PanelRight, PanelRightClose, ChevronsUp, ChevronsDown, Shield, X, RefreshCw, History, AppWindowMac } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { confirm } from '@tauri-apps/plugin-dialog';
import { getHomeDir, getFileInfo, getAppIcon, estimateDirsSizeFast, previewMoveFileConflicts, startMoveFilesTask, moveFile, moveFiles, getFileClipboard, clearFileClipboard, hasClipboardText } from '../api/filesystem';
import type { MoveConflictStrategy, TransferTaskSnapshot } from '../api/filesystem';
import { ViewMode, ThemeSettings, FileItem, DisplayMode, GroupBy, OperationEffect } from '../types';
import { QUICK_ACCESS } from '../constants';
import AIRenamePanel from './AIRenamePanel';
import OperationHistoryPanel from './OperationHistoryPanel';
import Tooltip from './Tooltip';
import CrossWindowDropBanner from './CrossWindowDropBanner';
import FileTypeIcon from './FileTypeIcon';
import ColumnView from './explorer/ColumnView';
import ContextMenu, { type ExplorerContextMenuState } from './explorer/ContextMenu';
import ExplorerShell from './explorer/ExplorerShell';
import ExplorerOverlays from './explorer/ExplorerOverlays';
import FileItemRenderer from './explorer/FileItemRenderer';
import FileListView from './explorer/FileListView';
import GridView from './explorer/GridView';
import PreviewPanel from './explorer/PreviewPanel';
import useExplorerCreateEntries from './explorer/useExplorerCreateEntries';
import useExplorerContextMenu from './explorer/useExplorerContextMenu';
import useExplorerDragDrop from './explorer/useExplorerDragDrop';
import useExplorerFileOperations from './explorer/useExplorerFileOperations';
import useExplorerInspector from './explorer/useExplorerInspector';
import useExplorerDirectoryData from './explorer/useExplorerDirectoryData';
import useExplorerKeyboard from './explorer/useExplorerKeyboard';
import useExplorerSelection from './explorer/useExplorerSelection';
import useExplorerTransferWorkflow from './explorer/useExplorerTransferWorkflow';
import useExplorerState from './explorer/useExplorerState';
import {
  EMPTY_NAVIGATION_HISTORY,
  goBack,
  goForward,
  navigateHistory,
  type NavigationHistory,
} from '../lib/navigation-history';
import {
  resolveColumnActionDirectory,
  resolveColumnPaneDirectory,
  resolveColumnPathsAfterFolderSelection,
} from '../lib/column-navigation';
import { buildRemotePath, isRemotePath, isVirtualPath, parseRemotePath } from '../lib/path-helpers';
import {
  NATIVE_MENU_COMMAND_EVENT,
  resolveNativeMenuDisplayMode,
  type NativeMenuCommand,
} from '../lib/native-menu';
import { getCachedAssetUrl } from '../lib/asset-url-cache';
import { formatMediaDuration } from '../lib/media-metadata';
import { saveOperationSession } from '../lib/operation-history';
import { formatOperationPermissionError } from '../lib/operation-permission-error';
import { currentWindowLabel, safeCurrentWindow, safeEmitTo, safeInvoke, safeListen } from '../lib/tauri-runtime';
import {
  buildMoveEffects,
  buildMoveRefreshPaths,
  buildMoveTaskDedupeKey,
  buildTemplateValues,
  canUndoTransferMove,
  formatAppError,
  getPdfPreviewSrc,
  makeFileItemsFromPaths,
  makeFolderItemFromPath,
  resolveOperationStatusByEffects,
  resolveTransferTaskOperationStatus,
  resolveTransferTaskVolumeHint,
} from './explorer/explorer-utils';
import {
  APP_ICON_CACHE_LIMIT,
  FAVORITES_VIRTUAL_PATH,
  FEEDBACK_VISIBLE_MS,
  FILE_DRAG_END_AT_EVENT,
  FILE_DRAG_END_EVENT,
  FILE_DRAG_START_EVENT,
  FILE_DROP_ACCEPTED_EVENT,
  FILE_DROP_STARTED_EVENT,
  FOLDER_SIZE_ESTIMATE_BATCH_SIZE,
  FOLDER_SIZE_ESTIMATE_CACHE_TTL_MS,
  FOLDER_SIZE_ESTIMATE_DEBOUNCE_MS,
  INCOMING_DRAG_VISIBLE_MS,
  LARGE_BATCH_OPERATION_THRESHOLD,
  MOVE_TASK_DEDUPE_WINDOW_MS,
  OPEN_WITH_APPS,
  OPEN_WITH_SELECT_OTHER,
  OPEN_WITH_SELECT_PLACEHOLDER,
  RECENT_VIRTUAL_PATH,
  SORT_DEFAULT_DIRECTION,
  TAGS_VIRTUAL_PREFIX,
  TAG_COLORS,
  TAURI_DRAG_DROP_EVENT,
  TAURI_DRAG_ENTER_EVENT,
  TAURI_DRAG_LEAVE_EVENT,
} from './explorer/explorer-constants';
import type {
  ExistingOutputChoice,
  ExistingOutputDialogState,
  ExplorerViewProps,
  FileDragBroadcastPayload,
  FileDragEndAtPayload,
  FileDropAcceptedPayload,
  FileDropStartedPayload,
  FileOperationOptions,
  IncomingFileDrag,
  ManualHistoryRecordInput,
  MoveConflictDialogState,
  MoveExecutionSummary,
  ProtectedRootInfo,
  TauriDragDropPayload,
} from './explorer/explorer-types';
import type { HashDialogState } from './explorer/preview-panel-types';
import { LIST_MODIFIED_COL_BY_DENSITY } from './explorer/view-constants';

const dragDebugBuffer: string[] = [];
let dragDebugSequence = 0;

const describeDebugPaths = (paths: string[]) => (paths.length ? paths.join('|') : '(none)');

const logDragDebug = (message: string) => {
  const entry = `seq=${++dragDebugSequence} ${message}`;
  dragDebugBuffer.push(entry);
  if (dragDebugBuffer.length > 300) {
    dragDebugBuffer.splice(0, dragDebugBuffer.length - 300);
  }
  if (typeof window !== 'undefined') {
    (window as Window & { __aetherDragDebug?: string[] }).__aetherDragDebug = dragDebugBuffer;
    console.info('[AetherDrag]', entry);
  }
  safeInvoke('debug_log', { message: entry }).catch(() => {});
};

export default function ExplorerView({ view, isActive = false, currentTabLabelKey, initialPath, remoteConnections = [], theme, selectedFileIds, onSelectFiles, onSelectionCountChange, onStartTransfer, onOpenTab, onCreateWindow, favorites, onToggleFavorite, fileTags, onFileTagsChange, recentItems, onRecordRecent, onClearRecent, onThemeChange, onViewChange, onTitleChange, onPathChange }: ExplorerViewProps) {
  const { t } = useTranslation();
  const liquidGlassEnabled = theme.enableLiquidGlass === true;
  const [contextMenu, setContextMenu] = useState<ExplorerContextMenuState | null>(null);
  const [displayMode, setDisplayMode] = useState<DisplayMode>('list');
  const [currentPath, setCurrentPath] = useState<string>('');
  const [navigationHistory, setNavigationHistory] = useState<NavigationHistory>(EMPTY_NAVIGATION_HISTORY);
  const [columnPaths, setColumnPaths] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [isEditingPath, setIsEditingPath] = useState(false);
  const [pathInput, setPathInput] = useState('');
  const [sortConfig, setSortConfig] = useState<{ key: string, direction: 'asc' | 'desc' } | null>(null);
  const [activeDropdown, setActiveDropdown] = useState<string | null>(null);
  const [groupBy, setGroupBy] = useState<GroupBy>('none');
  const [showCheckboxCol, setShowCheckboxCol] = useState(false);
  const [showSortCol, setShowSortCol] = useState(false);
  const [showAIRename, setShowAIRename] = useState(false);
  const [showOperationHistory, setShowOperationHistory] = useState(false);
  const [appIconMap, setAppIconMap] = useState<Record<string, string>>({});
  const [mediaDurationMap, setMediaDurationMap] = useState<Record<string, string>>({});
  const [folderSizeEstimateMap, setFolderSizeEstimateMap] = useState<Record<string, string>>({});
  const [homeDir, setHomeDir] = useState('');
  const [renamingFile, setRenamingFile] = useState<FileItem | null>(null);
  const [renameInput, setRenameInput] = useState('');
  const [textPreview, setTextPreview] = useState('');
  const [textPreviewLoading, setTextPreviewLoading] = useState(false);
  const [imagePreviewFailed, setImagePreviewFailed] = useState(false);
  const [pdfPreviewLoading, setPdfPreviewLoading] = useState(false);
  const [pdfPreviewFailed, setPdfPreviewFailed] = useState(false);
  const [operationMessage, setOperationMessage] = useState('');
  const [contextSubmenu, setContextSubmenu] = useState<string | null>(null);
  const [moveConflictDialog, setMoveConflictDialog] = useState<MoveConflictDialogState | null>(null);
  const [existingOutputDialog, setExistingOutputDialog] = useState<ExistingOutputDialogState | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);
  const pathScrollRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const feedbackTimerRef = useRef<number | null>(null);
  const [typeaheadQuery, setTypeaheadQuery] = useState('');
  const createEntryClickTimerRef = useRef<number | null>(null);
  const createEntryWindowLockRef = useRef(false);
  const createEntryWindowLockTimerRef = useRef<number | null>(null);
  const [hasFileClipboard, setHasFileClipboard] = useState(false);
  const [hasTextClipboard, setHasTextClipboard] = useState(false);
  const [incomingFileDrag, setIncomingFileDrag] = useState<IncomingFileDrag | null>(null);
  const [isReceivingExternalDrag, setIsReceivingExternalDrag] = useState(false);
  const submenuCloseTimerRef = useRef<number | null>(null);
  const activeTransferRef = useRef<{ transferId: string; paths: string[] } | null>(null);
  const incomingDragTimerRef = useRef<number | null>(null);
  const recentExternalDropRef = useRef<Set<string>>(new Set());
  const recentMoveTaskStartsRef = useRef<Map<string, number>>(new Map());
  const pendingMoveTaskStartsRef = useRef<Set<string>>(new Set());
  // 让事件 listener 能拿到最新 theme / incomingFileDrag / acceptIncomingFileDrag。
  // 事件 listener 创建时闭包冻结，但 dragEnd 时 theme 可能已变化。
  const themeRef = useRef(theme);
  const incomingFileDragRef = useRef<IncomingFileDrag | null>(null);
  const acceptIncomingFileDragRef = useRef<((op: 'copy' | 'move') => Promise<void>) | null>(null);
  const clearDragPreviewRef = useRef<() => void>(() => {});
  const clearExternalDragFallbackRef = useRef<() => void>(() => {});
  const finishSharedFileDragRef = useRef<(delayMs?: number) => void>(() => {});
  const getActiveTransferRef = useRef<() => { transferId: string; paths: string[] } | null>(() => null);
  const isRecentExternalDropRef = useRef<(path: string) => boolean>(() => false);
  const markRecentExternalDropRef = useRef<(path: string) => void>(() => {});
  const findFileByIdRef = useRef<(id: string) => FileItem | undefined>(() => undefined);
  const moveDraggedFilesRef = useRef<(draggedFileId: string, targetFolderId: string) => Promise<void>>(async () => {});
  const executeMoveFilesRef = useRef<(filesToMove: FileItem[], targetFolder: FileItem, conflictStrategy: MoveConflictStrategy, options?: FileOperationOptions) => Promise<MoveExecutionSummary>>(async () => ({
    started: false,
    moved: 0,
    copiedCrossDevice: 0,
    failed: 0,
    conflicts: 0,
    skipped: 0,
  }));
  const startMoveTaskFromDialogRef = useRef<(filesToMove: FileItem[], targetFolder: FileItem, conflictStrategy: MoveConflictStrategy, options?: FileOperationOptions) => Promise<boolean>>(async () => false);
  const refreshCurrentDirRef = useRef<(fullRefresh?: boolean, targetPath?: string) => Promise<FileItem[]>>(async () => []);
  const showFeedbackRef = useRef<(message: string) => void>(() => {});
  const importExternalPathsRef = useRef<(paths: string[], targetPath?: string) => Promise<boolean>>(async () => false);
  const navigateToPathRef = useRef<(path: string, options?: { replace?: boolean }) => void>(() => {});
  const onThemeChangeRef = useRef(onThemeChange);
  const focusFileByPrefixRef = useRef<(prefix: string) => void>(() => {});
  const handleCopyToClipboardRef = useRef<(items?: FileItem[]) => Promise<void>>(async () => {});
  const handleCutToClipboardRef = useRef<(items?: FileItem[]) => Promise<void>>(async () => {});
  const handlePasteFromClipboardRef = useRef<(targetPath?: string) => Promise<void>>(async () => {});
  const handleOpenFileRef = useRef<(file: FileItem) => void>(() => {});
  const handleDeleteFileRef = useRef<(file: FileItem) => Promise<void>>(async () => {});
  const handleQuickLookRef = useRef<(file?: FileItem) => Promise<void>>(async () => {});
  const selectedFileIdsRef = useRef<string[]>(selectedFileIds);
  const windowLabelRef = useRef(currentWindowLabel());
  const directoryLoadScopes = useMemo(() => {
    const prefix = `${windowLabelRef.current}:${view}`;
    return {
      main: `${prefix}:main`,
      column: `${prefix}:column`,
    };
  }, [view]);
  onThemeChangeRef.current = onThemeChange;
  selectedFileIdsRef.current = selectedFileIds;
  const pendingAppIconPathsRef = useRef<Set<string>>(new Set());
  const failedAppIconPathsRef = useRef<Set<string>>(new Set());
  const folderSizeEstimateMetaRef = useRef<Map<string, { formatted: string; ts: number }>>(new Map());
  const pendingFolderEstimatePathsRef = useRef<Set<string>>(new Set<string>());
  const folderSizeEstimateTimerRef = useRef<number | null>(null);
  // 批量 setAppIconMap 缓冲：每个图标到达不立即 setState，80ms 内合并一次
  // 避免 200 app 触发 200 次 setState → 200 次派生链全量重算
  const pendingIconUpdatesRef = useRef<Record<string, string>>({});
  const iconFlushTimerRef = useRef<number | null>(null);
  const [contextMenuSize, setContextMenuSize] = useState<{ key: string; width: number; height: number } | null>(null);

  const [hashDialog, setHashDialog] = useState<HashDialogState | null>(null);

  const patchOpenWithInCollection = useCallback((items: FileItem[], targetPath: string, openWith: string) => {
    let changed = false;
    const next = items.map(item => {
      if (item.path !== targetPath || item.openWith === openWith) return item;
      changed = true;
      return { ...item, openWith };
    });
    return changed ? next : items;
  }, []);

  const activeDirectoryPath = useMemo(() => (
    resolveColumnActionDirectory(currentPath, displayMode, columnPaths)
  ), [currentPath, displayMode, columnPaths]);

  const getActionDirectory = useCallback((preferredPath?: string) => {
    if (preferredPath && !isVirtualPath(preferredPath)) return preferredPath;
    return activeDirectoryPath;
  }, [activeDirectoryPath]);

  const isLocalFilesystemPath = useCallback((path?: string | null) => (
    Boolean(path) && !isVirtualPath(path) && !isRemotePath(path)
  ), []);

  const confirmLargeBatchOperation = useCallback(async (count: number) => {
    if (count <= LARGE_BATCH_OPERATION_THRESHOLD) return true;
    return confirm(
      t('dialogs.largeBatchOperation', {
        count,
        threshold: LARGE_BATCH_OPERATION_THRESHOLD,
        defaultValue: '本次操作包含 {{count}} 个项目，可能需要较长时间并占用较多系统资源。确定继续吗？',
      }),
      {
        title: t('dialogs.largeBatchOperationTitle', {
          defaultValue: '大量项目操作',
        }),
        kind: 'warning',
      },
    );
  }, [t]);

  const resolveFavoriteItems = useCallback(async (paths: string[]) => {
    const uniquePaths = Array.from(new Set(paths.filter(Boolean)));
    const results = await Promise.allSettled(uniquePaths.map(path => getFileInfo(path)));
    return results
      .filter((result): result is PromiseFulfilledResult<FileItem> => result.status === 'fulfilled')
      .map(result => result.value);
  }, []);

  const getTagLabel = useCallback((tagId: string) => {
    const key = tagId.replace('tag-', '');
    const labelKey = tagId === 'tag-all' ? 'sidebar.allTags' : `sidebar.${key}`;
    return t(labelKey, key);
  }, [t]);

  const getFileTypeLabel = useCallback((type: FileItem['type']) => {
    switch (type) {
      case 'folder': return t('explorer.folder', '文件夹');
      case 'application': return t('explorer.application', '应用程序');
      case 'image': return t('explorer.image', '图片');
      case 'video': return t('explorer.video', '视频');
      case 'audio': return t('explorer.audio', '音频');
      case 'pdf': return 'PDF';
      case 'archive': return t('explorer.archive', '压缩包');
      case 'code': return t('explorer.code', '代码');
      case 'text': return t('explorer.text', '文本');
      case 'remote-unknown': return t('explorer.remoteItem', '远程项目');
      default: return t('explorer.file', '文件');
    }
  }, [t]);

  const getTagVirtualPath = (tagId: string) => `${TAGS_VIRTUAL_PREFIX}${tagId}`;

  const protectedRoots = useMemo<ProtectedRootInfo[]>(() => {
    if (!homeDir) return [];
    return [
      { path: `${homeDir}/Downloads`, label: '下载' },
      { path: `${homeDir}/Documents`, label: '文稿' },
      { path: `${homeDir}/Desktop`, label: '桌面' },
      { path: `${homeDir}/Library/Mobile Documents`, label: 'iCloud Drive' },
      { path: `${homeDir}/.Trash`, label: '废纸篓' },
    ];
  }, [homeDir]);

  const getProtectedRootForPath = useCallback((path: string) => {
    if (!path) return null;
    return protectedRoots.find(root => path === root.path || path.startsWith(`${root.path}/`)) || null;
  }, [protectedRoots]);

  const resolveTaggedItems = useCallback(async (tagId: string, tagMap: Record<string, string[]>) => {
    const paths = Object.entries(tagMap)
      .filter(([, tags]) => tagId === 'tag-all' ? tags.length > 0 : tags.includes(tagId))
      .map(([path]) => path);
    const items = await resolveFavoriteItems(paths);
    return items.map(item => ({ ...item, tags: tagMap[item.path] || item.tags }));
  }, [resolveFavoriteItems]);

  const trimAppIconCache = useCallback((cache: Record<string, string>, visibleAppPaths: string[]) => {
    const entries = Object.entries(cache);
    if (entries.length <= APP_ICON_CACHE_LIMIT) return cache;

    const visible = new Set(visibleAppPaths);
    const kept: Record<string, string> = {};
    let keptCount = 0;
    for (const path of visibleAppPaths) {
      if (cache[path] && !kept[path]) {
        kept[path] = cache[path];
        keptCount += 1;
      }
    }

    for (let i = entries.length - 1; i >= 0 && keptCount < APP_ICON_CACHE_LIMIT; i -= 1) {
      const [path, url] = entries[i];
      if (!visible.has(path) && !kept[path]) {
        kept[path] = url;
        keptCount += 1;
      }
    }
    return kept;
  }, []);

  const hydrateAppIcons = useCallback((items: FileItem[]) => {
    const visibleAppPaths = items
      .filter(item => item.type === 'application')
      .map(item => item.path);
    const appPaths = Array.from(new Set(
      items
        .filter(item => (
          item.type === 'application'
          && !item.thumbnail
          && !appIconMap[item.path]
          && !pendingAppIconPathsRef.current.has(item.path)
          && !failedAppIconPathsRef.current.has(item.path)
        ))
        .map(item => item.path)
    ));
    if (appPaths.length === 0) return;

    const queue = [...appPaths];
    appPaths.forEach(path => pendingAppIconPathsRef.current.add(path));

    const scheduleFlush = () => {
      if (iconFlushTimerRef.current) return;
      iconFlushTimerRef.current = window.setTimeout(() => {
        iconFlushTimerRef.current = null;
        const pending = pendingIconUpdatesRef.current;
        if (Object.keys(pending).length === 0) return;
        pendingIconUpdatesRef.current = {};
        setAppIconMap(prev => trimAppIconCache({ ...prev, ...pending }, visibleAppPaths));
      }, 80);
    };

    const runNext = () => {
      const path = queue.shift();
      if (!path) return;

      getAppIcon(path)
        .then(iconUrl => {
          if (!iconUrl) {
            failedAppIconPathsRef.current.add(path);
            return;
          }
          pendingIconUpdatesRef.current[path] = iconUrl;
          scheduleFlush();
        })
        .catch(() => {
          failedAppIconPathsRef.current.add(path);
        })
        .finally(() => {
          pendingAppIconPathsRef.current.delete(path);
          runNext();
        });
    };

    Array.from({ length: Math.min(4, queue.length) }).forEach(runNext);
  }, [appIconMap, trimAppIconCache]);

  const refreshFileClipboardState = async () => {
    try {
      const payload = await getFileClipboard();
      setHasFileClipboard(Boolean(payload?.paths.length));
      return payload;
    } catch {
      setHasFileClipboard(false);
      return null;
    }
  };

  const refreshTextClipboardState = async () => {
    try {
      const hasText = await hasClipboardText();
      setHasTextClipboard(hasText);
      return hasText;
    } catch {
      setHasTextClipboard(false);
      return false;
    }
  };

  const clearFileClipboardState = async () => {
    try {
      await clearFileClipboard();
    } catch {
      // ignore clear failures; UI should still drop paste affordance
    }
    setHasFileClipboard(false);
  };

  const focusCurrentWindow = async () => {
    const currentWindow = safeCurrentWindow();
    try {
      await currentWindow.show();
      await currentWindow.unminimize();
      await currentWindow.setFocus();
      window.setTimeout(() => {
        void currentWindow.setFocus().catch(() => {});
      }, 0);
    } catch {
      // Focus is best-effort; the context menu should still open.
    }
  };
  const [lastActivatedFileId, setLastActivatedFileId] = useState<string | null>(null);
  const [pulseFileId, setPulseFileId] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Sidebar view → real path mapping
  const baseView = view.replace(/-\d{13}$/, '');
  const activeTagId = currentPath.startsWith(TAGS_VIRTUAL_PREFIX)
    ? currentPath.slice(TAGS_VIRTUAL_PREFIX.length)
    : '';
  const isFavoritesRoot = currentPath === FAVORITES_VIRTUAL_PATH;
  const isRecentRoot = currentPath === RECENT_VIRTUAL_PATH;
  const isTagRoot = currentPath.startsWith(TAGS_VIRTUAL_PREFIX);
  const isVirtualRoot = isFavoritesRoot || isRecentRoot || isTagRoot;
  const remotePathParts = useMemo(() => parseRemotePath(currentPath), [currentPath]);
  const isRemoteRoot = Boolean(remotePathParts);
  const remoteConnectionDisplayName = remotePathParts
    ? remoteConnections.find(connection => connection.id === remotePathParts.connectionId)?.name || remotePathParts.connectionId
    : '';
  const loadingRemoteConnectionName = remoteConnectionDisplayName;
  const virtualRootLabel = isFavoritesRoot
    ? t('sidebar.favoritesList', '我的收藏')
    : isRecentRoot
      ? t('sidebar.recent', '最近使用')
    : isTagRoot
      ? getTagLabel(activeTagId)
      : '';

  const showFeedback = useCallback((message: string) => {
    setOperationMessage(message);
    if (feedbackTimerRef.current) window.clearTimeout(feedbackTimerRef.current);
    feedbackTimerRef.current = window.setTimeout(() => setOperationMessage(''), FEEDBACK_VISIBLE_MS);
  }, []);
  showFeedbackRef.current = showFeedback;

  const {
    columnFilesCache,
    columnLoadErrors,
    directoryErrorKind,
    favoriteFiles,
    files,
    loadError,
    loading,
    recentFiles,
    refreshCurrentDir: refreshDirectoryData,
    resetColumnState,
    retryProtectedPath,
    setColumnFilesCache,
    setFavoriteFiles,
    setFiles,
    setRecentFiles,
    setTaggedFiles,
    taggedFiles,
    loadColumnFiles,
  } = useExplorerDirectoryData({
    baseView,
    currentPath,
    directoryLoadScopes,
    favorites,
    fileTags,
    getProtectedRootForPath,
    isActive,
    isLocalFilesystemPath,
    isRemoteRoot,
    isTagRoot,
    isVirtualRoot,
    recentItems,
    resolveFavoriteItems,
    resolveTaggedItems,
    setColumnPaths,
    showFeedback,
    t,
    themeShowHiddenFiles: theme.showHiddenFiles,
  });

  const syncFileOpenWithCollections = useCallback((targetPath: string, openWith: string) => {
    setFiles(prev => patchOpenWithInCollection(prev, targetPath, openWith));
    setFavoriteFiles(prev => patchOpenWithInCollection(prev, targetPath, openWith));
    setRecentFiles(prev => patchOpenWithInCollection(prev, targetPath, openWith));
    setTaggedFiles(prev => patchOpenWithInCollection(prev, targetPath, openWith));
    setColumnFilesCache(prev => {
      let changed = false;
      const next: Record<string, FileItem[]> = {};
      Object.entries(prev).forEach(([key, items]) => {
        const patched = patchOpenWithInCollection(items, targetPath, openWith);
        if (patched !== items) changed = true;
        next[key] = patched;
      });
      return changed ? next : prev;
    });
  }, [patchOpenWithInCollection, setColumnFilesCache, setFavoriteFiles, setFiles, setRecentFiles, setTaggedFiles]);

  const {
    currentLevelFiles,
    displayedFiles,
    enabledContextExtensions,
    fileListOffset,
    fileListRef,
    folderSizeEstimateEnabled,
    getGroupKey,
    groupOptions,
    groupedFiles,
    handleContainerScroll,
    isAdminContextMenuEmpty,
    lastSelectedFile,
    listItemHeight,
    selectedFiles,
    setFileListOffset,
    setScrollTop,
    showBlockingLoading,
    visibleRange,
  } = useExplorerState({
    appIconMap,
    columnFilesCache,
    currentPath,
    displayMode,
    favoriteFiles,
    files,
    folderSizeEstimateMap,
    groupBy,
    isFavoritesRoot,
    isRecentRoot,
    isRemoteRoot,
    isTagRoot,
    isVirtualRoot,
    loading,
    mediaDurationMap,
    recentFiles,
    scrollContainerRef,
    searchQuery,
    selectedFileIds,
    sortConfig,
    taggedFiles,
    theme,
    t,
    getFileTypeLabel,
    getTagLabel,
  });

  // 首页 tab 的 id 历史上叫 'desktop'（与 sidebar 的"桌面"项命名冲突）。
  // 在新产品决策下，"首页"指 theme.defaultHomePath（默认我的收藏），不是 ~/。
  // 这里映射跟随用户的默认首页设置；如果是 aether:// 虚拟路径就原样返回。
  const homeTabPath = theme.defaultHomePath || FAVORITES_VIRTUAL_PATH;

  const viewPathMap = useMemo<Record<string, string>>(() => ({
    downloads: `${homeDir}/Downloads`,
    documents: `${homeDir}/Documents`,
    desktop: homeTabPath,
    applications: '/Applications',
    home: homeDir,
    recent: RECENT_VIRTUAL_PATH,
    icloud: `${homeDir}/Library/Mobile Documents/com~apple~CloudDocs`,
    macos: '/',
    airdrop: '/',
    network: '/Volumes',
    trash: `${homeDir}/.Trash`,
    'favorites-list': FAVORITES_VIRTUAL_PATH,
    'tag-red': getTagVirtualPath('tag-red'),
    'tag-orange': getTagVirtualPath('tag-orange'),
    'tag-yellow': getTagVirtualPath('tag-yellow'),
    'tag-green': getTagVirtualPath('tag-green'),
    'tag-blue': getTagVirtualPath('tag-blue'),
    'tag-purple': getTagVirtualPath('tag-purple'),
    'tag-gray': getTagVirtualPath('tag-gray'),
    'tag-all': getTagVirtualPath('tag-all'),
  }), [homeDir, homeTabPath]);

  const recordManualOperationHistory = useCallback(async (input: ManualHistoryRecordInput) => {
    const effects = input.effects ?? [];
    const hasReverse = effects.some(effect => effect.status === 'ok' && Boolean(effect.reverseOp));
    const canUndo = input.canUndo ?? hasReverse;
    const status = input.status ?? resolveOperationStatusByEffects(effects);
    const itemCount = input.itemCount ?? effects.length;
    try {
      await saveOperationSession({
        id: `op-manual-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        timestamp: Date.now(),
        source: 'manual',
        category: input.category,
        status,
        canUndo,
        reasonNotUndoable: canUndo ? undefined : (input.reasonNotUndoable || '该操作不可安全撤销'),
        itemCount: Math.max(1, itemCount),
        title: input.title,
        summary: input.summary,
        effects,
        sourceMeta: {
          manualMeta: {
            action: input.category,
            primaryPath: input.primaryPath,
            targetPath: input.targetPath,
            conflictStrategy: input.conflictStrategy,
            volumeHint: input.volumeHint,
          },
        },
      }, {
        retentionDays: theme.aiOpsHistoryRetentionDays,
      });
    } catch {
      // 操作历史写入失败时不影响主流程
    }
  }, [theme.aiOpsHistoryRetentionDays]);

  const clearContextSubmenuCloseTimer = () => {
    if (!submenuCloseTimerRef.current) return;
    window.clearTimeout(submenuCloseTimerRef.current);
    submenuCloseTimerRef.current = null;
  };

  const requestExistingOutputChoice = useCallback((state: Omit<ExistingOutputDialogState, 'onResolve'>) => (
    new Promise<'replace' | 'keepBoth' | 'cancel'>(resolve => {
      setExistingOutputDialog({
        ...state,
        onResolve: resolve,
      });
    })
  ), []);

  const handleExistingOutputChoice = (choice: ExistingOutputChoice) => {
    const dialog = existingOutputDialog;
    setExistingOutputDialog(null);
    dialog?.onResolve(choice);
  };

  useEffect(() => {
    if (!isActive) return;
    void refreshFileClipboardState();
    void refreshTextClipboardState();
    const handleFocus = () => {
      void refreshFileClipboardState();
      void refreshTextClipboardState();
    };
    window.addEventListener('focus', handleFocus);
    return () => window.removeEventListener('focus', handleFocus);
  }, [isActive]);

  const resetDirectoryScrollState = useCallback(() => {
    setFileListOffset(0);
    setScrollTop(0);
    containerRef.current?.scrollTo({ top: 0, left: 0, behavior: 'auto' });
    scrollContainerRef.current?.scrollTo({ top: 0, left: 0, behavior: 'auto' });
  }, [setFileListOffset, setScrollTop]);

  const navigateToPath = useCallback((path: string, options?: { replace?: boolean }) => {
    const result = navigateHistory(currentPath, path, navigationHistory, options);
    if (!result.changed) return;
    resetDirectoryScrollState();
    setNavigationHistory(result.history);
    setCurrentPath(result.path);
    resetColumnState();
    setSearchQuery('');
    onSelectFiles([]);
  }, [currentPath, navigationHistory, onSelectFiles, resetColumnState, resetDirectoryScrollState]);
  navigateToPathRef.current = navigateToPath;
  const {
    handleContainerMouseDown,
    handleContainerMouseMove,
    handleContainerMouseUp,
    handleGlobalMouseUp,
    handleSelectFile,
    isMarqueeDragging,
    resetSelectionInteraction,
    selectionBox,
  } = useExplorerSelection({
    containerRef,
    currentLevelFiles,
    displayMode,
    navigateToPath,
    onSelectFiles,
    selectedFileIds,
    setColumnPaths,
    setContextMenu,
  });
  const currentPathRef = useRef(currentPath);
  currentPathRef.current = currentPath;

  const restoreHistoryPath = useCallback((path: string) => {
    resetDirectoryScrollState();
    setCurrentPath(path);
    resetColumnState();
    setSearchQuery('');
    onSelectFiles([]);
  }, [onSelectFiles, resetColumnState, resetDirectoryScrollState]);

  const resetTabTransientState = useCallback(() => {
    setSearchQuery('');
    setSortConfig(null);
    setGroupBy('none');
    resetColumnState();
    setNavigationHistory(EMPTY_NAVIGATION_HISTORY);
    setActiveDropdown(null);
    clearContextSubmenuCloseTimer();
    setContextMenu(null);
    setContextSubmenu(null);
    resetSelectionInteraction();
    setTypeaheadQuery('');
    setLastActivatedFileId(null);
    setPulseFileId(null);
    setRenamingFile(null);
    setRenameInput('');
    resetDirectoryScrollState();
    onSelectFiles([]);
  }, [onSelectFiles, resetColumnState, resetDirectoryScrollState, resetSelectionInteraction]);

  const refreshCurrentDir = useCallback(async (fullRefresh = false, targetPath?: string) => {
    if (fullRefresh && (!targetPath || targetPath === currentPath)) {
      resetTabTransientState();
    }
    return refreshDirectoryData(fullRefresh, targetPath);
  }, [currentPath, refreshDirectoryData, resetTabTransientState]);
  refreshCurrentDirRef.current = refreshCurrentDir;

  const navigateBack = useCallback(() => {
    const result = goBack(currentPath, navigationHistory);
    if (!result) return;
    setNavigationHistory(result.history);
    restoreHistoryPath(result.path);
  }, [currentPath, navigationHistory, restoreHistoryPath]);

  const navigateForward = useCallback(() => {
    const result = goForward(currentPath, navigationHistory);
    if (!result) return;
    setNavigationHistory(result.history);
    restoreHistoryPath(result.path);
  }, [currentPath, navigationHistory, restoreHistoryPath]);

  // Init: get home directory, then load default path
  useEffect(() => {
    let cancelled = false;
    getHomeDir().then(home => {
      if (cancelled) return;
      setHomeDir(home);
      // initialPath 缺失时默认进"我的收藏"虚拟根目录，与 DEFAULT_THEME.defaultHomePath 一致。
      // 历史上 fallback 到 ${home}/Downloads，是 v0.2 之前留下的硬编码，
      // 与新的"默认首页 = 我的收藏"产品决策不一致。
      setCurrentPath(initialPath || FAVORITES_VIRTUAL_PATH);
    }).catch(() => {
      if (cancelled) return;
      setCurrentPath(initialPath || FAVORITES_VIRTUAL_PATH);
    });
    return () => { cancelled = true; };
  }, [initialPath]);

  useEffect(() => () => {
    if (feedbackTimerRef.current) {
      window.clearTimeout(feedbackTimerRef.current);
      feedbackTimerRef.current = null;
    }
    if (createEntryClickTimerRef.current) {
      window.clearTimeout(createEntryClickTimerRef.current);
      createEntryClickTimerRef.current = null;
    }
    if (createEntryWindowLockTimerRef.current) {
      window.clearTimeout(createEntryWindowLockTimerRef.current);
      createEntryWindowLockTimerRef.current = null;
    }
    if (submenuCloseTimerRef.current) {
      window.clearTimeout(submenuCloseTimerRef.current);
      submenuCloseTimerRef.current = null;
    }
  }, []);

  // Resolve view ID to path — strip timestamp suffix from tab IDs
  const resolveViewPath = useCallback((viewId: string): string | undefined => {
    if (viewPathMap[viewId]) return viewPathMap[viewId];
    if (initialPath) return initialPath;
    // Strip -timestamp suffix (e.g. "documents-1712345678900" → "documents")
    const base = viewId.replace(/-\d{13}$/, '');
    return viewPathMap[base];
  }, [initialPath, viewPathMap]);

  // When sidebar view changes, navigate to mapped path
  React.useEffect(() => {
    if (!homeDir && baseView !== 'favorites-list' && baseView !== 'recent' && !baseView.startsWith('tag-')) return;
    const mappedPath = resolveViewPath(view);
    if (mappedPath && mappedPath !== currentPathRef.current) {
      navigateToPathRef.current(mappedPath, { replace: true });
    }
  }, [baseView, homeDir, resolveViewPath, view]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setActiveDropdown(null);
      }
      if (contextMenuRef.current && !contextMenuRef.current.contains(event.target as Node)) {
        setContextMenu(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    const handleWindowMouseUp = () => {
      handleGlobalMouseUp();
      clearDragPreviewRef.current();
    };
    window.addEventListener('mouseup', handleWindowMouseUp);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      window.removeEventListener('mouseup', handleWindowMouseUp);
    };
  }, [handleGlobalMouseUp]);

  React.useEffect(() => {
    setSearchQuery('');
    onSelectFiles([]);
    resetColumnState();
  }, [view, onSelectFiles, resetColumnState]);
  
  useEffect(() => {
    hydrateAppIcons(displayedFiles);
  }, [displayedFiles, hydrateAppIcons]);

  useEffect(() => {
    if (!folderSizeEstimateEnabled || displayMode !== 'list' || displayedFiles.length === 0) return;
    if (isVirtualRoot || isRemoteRoot) return;

    const now = Date.now();
    const pending = pendingFolderEstimatePathsRef.current;

    for (const file of displayedFiles) {
      if (file.type !== 'folder') continue;
      if (!isLocalFilesystemPath(file.path)) continue;
      if (pending.has(file.path)) continue;
      const cached = folderSizeEstimateMetaRef.current.get(file.path);
      if (cached && now - cached.ts < FOLDER_SIZE_ESTIMATE_CACHE_TTL_MS) continue;
      pending.add(file.path);
    }

    if (folderSizeEstimateTimerRef.current || pending.size === 0) return;

    const flushEstimates = async () => {
      folderSizeEstimateTimerRef.current = null;
      const queue = pendingFolderEstimatePathsRef.current as Set<string>;
      if (queue.size === 0) return;

      const batch: string[] = [];
      for (const path of queue) {
        batch.push(path);
        if (batch.length >= FOLDER_SIZE_ESTIMATE_BATCH_SIZE) break;
      }
      batch.forEach(path => queue.delete(path));

      try {
        const results = await estimateDirsSizeFast(batch);
        if (results.length > 0) {
          const ts = Date.now();
          const updates: Record<string, string> = {};
          for (const item of results) {
            if (!item?.path || !item.formatted) continue;
            folderSizeEstimateMetaRef.current.set(item.path, {
              formatted: item.formatted,
              ts,
            });
            updates[item.path] = item.formatted;
          }
          if (Object.keys(updates).length > 0) {
            setFolderSizeEstimateMap(prev => ({ ...prev, ...updates }));
          }
        }
      } catch {
        // 粗略估算是增强能力，失败时静默降级为 "--"。
      } finally {
        if (pendingFolderEstimatePathsRef.current.size > 0) {
          folderSizeEstimateTimerRef.current = window.setTimeout(flushEstimates, FOLDER_SIZE_ESTIMATE_DEBOUNCE_MS);
        }
      }
    };

    folderSizeEstimateTimerRef.current = window.setTimeout(flushEstimates, FOLDER_SIZE_ESTIMATE_DEBOUNCE_MS);
  }, [displayMode, displayedFiles, folderSizeEstimateEnabled, isLocalFilesystemPath, isRemoteRoot, isVirtualRoot]);

  useEffect(() => {
    if (folderSizeEstimateEnabled) return;
    folderSizeEstimateMetaRef.current.clear();
    pendingFolderEstimatePathsRef.current.clear();
    if (folderSizeEstimateTimerRef.current) {
      window.clearTimeout(folderSizeEstimateTimerRef.current);
      folderSizeEstimateTimerRef.current = null;
    }
    setFolderSizeEstimateMap({});
  }, [folderSizeEstimateEnabled]);

  useEffect(() => () => {
    if (folderSizeEstimateTimerRef.current) {
      window.clearTimeout(folderSizeEstimateTimerRef.current);
      folderSizeEstimateTimerRef.current = null;
    }
  }, []);

  // 卸载时刷掉未处理的 icon 缓冲 + 清 timer
  useEffect(() => () => {
    if (iconFlushTimerRef.current) {
      window.clearTimeout(iconFlushTimerRef.current);
      iconFlushTimerRef.current = null;
    }
  }, []);

  // 同步 ref，让 Tauri event listener 闭包能拿到最新值
  useEffect(() => { themeRef.current = theme; }, [theme]);
  useEffect(() => { incomingFileDragRef.current = incomingFileDrag; }, [incomingFileDrag]);

  // ── 跨窗口拖拽接收（Aether↔Aether + Finder→Aether 兜底） ──
  useEffect(() => {
    if (!isActive) return;
    const unlistens: Array<() => void> = [];
    let cancelled = false;

    const clearIncomingTimer = () => {
      if (incomingDragTimerRef.current) {
        window.clearTimeout(incomingDragTimerRef.current);
        incomingDragTimerRef.current = null;
      }
    };

    safeListen<FileDragBroadcastPayload>(FILE_DRAG_START_EVENT, ({ payload }) => {
      if (cancelled) return;
      if (payload.sourceWindow === currentWindowLabel()) return;
      if (!payload.paths || payload.paths.length === 0) return;
      clearIncomingTimer();
      setIncomingFileDrag({
        paths: payload.paths,
        sourceWindow: payload.sourceWindow,
        transferId: payload.transferId,
        previewName: payload.previewName || `${payload.paths.length} 个项目`,
        count: payload.count ?? payload.paths.length,
        cut: payload.cut ?? false,
        shownAt: Date.now(),
      });
      incomingDragTimerRef.current = window.setTimeout(() => {
        if (cancelled) return;
        setIncomingFileDrag(null);
        incomingDragTimerRef.current = null;
      }, INCOMING_DRAG_VISIBLE_MS);
    }).then(fn => unlistens.push(fn)).catch(() => {});

    // 源端 dragEnd 只是“这次拖拽已经结束”的信号。
    // 真正命中本窗口时，accept 逻辑会立刻清掉 banner；
    // 没命中或事件丢失时，这里做一个短延迟兜底，避免提示挂到超时。
    safeListen(FILE_DRAG_END_EVENT, () => {
      if (cancelled) return;

      const current = incomingFileDragRef.current;
      if (!current) return;

      clearIncomingTimer();
      const transferId = current.transferId;
      incomingDragTimerRef.current = window.setTimeout(() => {
        if (cancelled) return;
        if (incomingFileDragRef.current?.transferId !== transferId) return;
        setIncomingFileDrag(null);
        incomingDragTimerRef.current = null;
      }, 240);
    }).then(fn => unlistens.push(fn)).catch(() => {});

    // ⭐ 关键：松手即处理 — 收到源端 dragEnd 携带的屏幕坐标，
    // 若坐标落在本窗口范围内，立即执行 copy/move，无需用户点 banner。
    safeListen<FileDragEndAtPayload>(FILE_DRAG_END_AT_EVENT, async ({ payload }) => {
      if (cancelled) return;
      if (payload.sourceWindow === currentWindowLabel()) return;

      const win = safeCurrentWindow();
      try {
        const [pos, size, factor] = await Promise.all([
          win.outerPosition(),
          win.outerSize(),
          win.scaleFactor(),
        ]);
        // Tauri 返回 PhysicalPosition/Size（物理像素），React screenX/Y 是逻辑像素
        const x0 = pos.x / factor;
        const y0 = pos.y / factor;
        const x1 = x0 + size.width / factor;
        const y1 = y0 + size.height / factor;
        const inside = payload.screenX >= x0
          && payload.screenX <= x1
          && payload.screenY >= y0
          && payload.screenY <= y1;

        if (!inside) {
          // 不在本窗口范围内 — 静默关闭 banner，不做任何操作
          setIncomingFileDrag(null);
          if (incomingDragTimerRef.current) {
            window.clearTimeout(incomingDragTimerRef.current);
            incomingDragTimerRef.current = null;
          }
          return;
        }

        // 落在本窗口内 → 计算 op 并执行
        const defaultMode = (themeRef.current.crossWindowDropDefault || 'copy');
        let op: 'copy' | 'move';
        if (payload.altKey) op = 'copy';        // ⌥ 强制复制
        else if (payload.shiftKey) op = 'move'; // ⇧ 强制移动
        else if (defaultMode === 'ask') op = 'copy'; // ask 模式下没显式选择 → 复制（最安全）
        else if (payload.metaKey) op = defaultMode === 'copy' ? 'move' : 'copy';
        else op = defaultMode === 'move' ? 'move' : 'copy';

        const current = incomingFileDragRef.current;
        if (!current || current.transferId !== payload.transferId) return;
        await acceptIncomingFileDragRef.current?.(op);
      } catch (err) {
        logDragDebug(`dragEndAt error=${formatAppError(err)}`);
      }
    }).then(fn => unlistens.push(fn)).catch(() => {});

    safeListen<FileDropAcceptedPayload>(FILE_DROP_ACCEPTED_EVENT, ({ payload }) => {
      if (cancelled) return;
      const active = getActiveTransferRef.current();
      if (!active || active.transferId !== payload.transferId) return;
      clearExternalDragFallbackRef.current();
      activeTransferRef.current = null;
      finishSharedFileDragRef.current(0);
      if (payload.op === 'move') {
        void refreshCurrentDirRef.current();
        showFeedbackRef.current(t('messages.crossWindowMoved', {
          count: payload.moved ?? payload.paths.length,
          defaultValue: '已移动 {{count}} 项到另一窗口',
        }));
      } else if (payload.op === 'mixed') {
        if ((payload.moved ?? 0) > 0) {
          void refreshCurrentDirRef.current();
        }
        showFeedbackRef.current(t('messages.crossWindowMixedMoveCopy', {
          moved: payload.moved ?? 0,
          copied: payload.copiedCrossDevice ?? 0,
          defaultValue: '已移动 {{moved}} 项，跨设备复制 {{copied}} 项到另一窗口（源文件保留）',
        }));
      } else if ((payload.copiedCrossDevice ?? 0) > 0) {
        showFeedbackRef.current(t('messages.crossWindowCopiedCrossDevice', {
          count: payload.copiedCrossDevice ?? payload.paths.length,
          defaultValue: '已复制 {{count}} 项到另一窗口（跨设备，源文件保留）',
        }));
      } else {
        showFeedbackRef.current(t('messages.crossWindowCopied', {
          count: payload.paths.length,
          defaultValue: '已复制 {{count}} 项到另一窗口',
        }));
      }
    }).then(fn => unlistens.push(fn)).catch(() => {});

    safeListen<FileDropStartedPayload>(FILE_DROP_STARTED_EVENT, ({ payload }) => {
      if (cancelled) return;
      const active = getActiveTransferRef.current();
      if (!active || active.transferId !== payload.transferId) return;
      clearExternalDragFallbackRef.current();
    }).then(fn => unlistens.push(fn)).catch(() => {});

    return () => {
      cancelled = true;
      clearIncomingTimer();
      unlistens.forEach(fn => fn());
    };
  }, [isActive, t]);
  const {
    executeCopyFiles,
    handleMoveConflictChoice,
    importExternalPaths,
    moveDraggedFiles,
    showMoveTaskCompletedFeedback,
    startCrossWindowCopyTask,
    startCrossWindowMoveTask,
    waitForTransferTask,
  } = useExplorerTransferWorkflow({
    clearFileClipboardState,
    confirmLargeBatchOperation,
    executeMoveFilesRef,
    finishSharedFileDrag: (...args) => finishSharedFileDragRef.current(...args),
    getActionDirectory,
    getProtectedRootForPath,
    logDragDebug,
    moveConflictDialog,
    onStartTransfer,
    recordManualOperationHistory,
    refreshCurrentDirRef,
    setMoveConflictDialog,
    showFeedback,
    startMoveTaskFromDialogRef,
    t,
  });

  // Aether↔Aether 跨窗口接收：执行 copy/move 到当前可写的真实目录。
  // 来源可能是 ① banner 上的显式按钮点击 ② 源端 dragEnd 携带坐标命中本窗口
  const acceptIncomingFileDrag = async (op: 'copy' | 'move') => {
    const drag = incomingFileDragRef.current;
    if (!drag) return;
    const targetDir = getActionDirectory();
    if (!targetDir) {
      showFeedback(t('messages.crossWindowNoTarget', {
        defaultValue: '当前没有可作为目标的真实目录',
      }));
      return;
    }
    setIncomingFileDrag(null);
    if (incomingDragTimerRef.current) {
      window.clearTimeout(incomingDragTimerRef.current);
      incomingDragTimerRef.current = null;
    }

    const targetFolder = makeFolderItemFromPath(targetDir);

    try {
      let acceptedOp: FileDropAcceptedPayload['op'] = op;
      let moved = 0;
      let copiedCrossDevice = 0;
      const notifyStarted = () => safeEmitTo(drag.sourceWindow, FILE_DROP_STARTED_EVENT, {
        transferId: drag.transferId,
      } satisfies FileDropStartedPayload);
      await notifyStarted();
      if (op === 'move') {
        const task = await startCrossWindowMoveTask(drag.paths, targetFolder);
        if (!task) return;
        moved = task.moved;
        copiedCrossDevice = task.copiedCrossDevice;
        if (copiedCrossDevice > 0 && moved === 0) {
          acceptedOp = 'copy';
        } else if (copiedCrossDevice > 0 && moved > 0) {
          acceptedOp = 'mixed';
        }
      } else {
        const task = await startCrossWindowCopyTask(drag.paths, targetFolder);
        if (!task) return;
        copiedCrossDevice = task.copiedCrossDevice;
      }
      await safeEmitTo(drag.sourceWindow, FILE_DROP_ACCEPTED_EVENT, {
        transferId: drag.transferId,
        paths: drag.paths,
        op: acceptedOp,
        targetWindow: currentWindowLabel(),
        moved,
        copiedCrossDevice,
      } satisfies FileDropAcceptedPayload);
    } catch (err) {
      const error = await formatOperationPermissionError({
        error: err,
        getProtectedRootForPath,
        pathHints: [getActionDirectory(), ...drag.paths],
        t,
      });
      showFeedback(t('messages.crossWindowReceiveFailed', {
        error,
        defaultValue: '接收跨窗口文件失败：{{error}}',
      }));
    }
  };
  // 把最新版本的 accept 函数挂到 ref 上供 Tauri event listener 调用
  acceptIncomingFileDragRef.current = acceptIncomingFileDrag;
  importExternalPathsRef.current = importExternalPaths;

  const startMoveTaskFromDialog = async (
    filesToMove: FileItem[],
    targetFolder: FileItem,
    conflictStrategy: MoveConflictStrategy,
    options: FileOperationOptions = {},
  ) => {
    const paths = filesToMove.map(file => file.path);
    logDragDebug([
      'moveTaskDialog enter',
      `count=${filesToMove.length}`,
      `targetFolderId=${targetFolder.id}`,
      `targetPath=${targetFolder.path}`,
      `conflictStrategy=${conflictStrategy}`,
      `skipLargeBatchConfirm=${options.skipLargeBatchConfirm ? 'yes' : 'no'}`,
      `clearClipboardOnSuccess=${options.clearClipboardOnSuccess ? 'yes' : 'no'}`,
      `clearDragPayloadOnSuccess=${options.clearDragPayloadOnSuccess ? 'yes' : 'no'}`,
      `paths=${describeDebugPaths(paths)}`,
    ].join(' '));
    if (filesToMove.some(file => isRemotePath(file.path)) || isRemotePath(targetFolder.path)) {
      logDragDebug(`moveTaskDialog abort=remote targetPath=${targetFolder.path} paths=${describeDebugPaths(paths)}`);
      showFeedback(t('messages.remoteReadOnly', { defaultValue: '远程访问第一版仅支持浏览。' }));
      return false;
    }
    if (!options.skipLargeBatchConfirm) {
      logDragDebug(`moveTaskDialog largeBatchConfirm count=${filesToMove.length}`);
      const shouldContinue = await confirmLargeBatchOperation(filesToMove.length);
      logDragDebug(`moveTaskDialog largeBatchConfirm result=${shouldContinue ? 'continue' : 'cancel'} count=${filesToMove.length}`);
      if (!shouldContinue) {
        logDragDebug(`moveTaskDialog abort=large-batch-cancel count=${filesToMove.length}`);
        return false;
      }
    }

    const moveRefreshPaths = buildMoveRefreshPaths(paths, targetFolder.path);
    const moveTaskKey = buildMoveTaskDedupeKey(paths, targetFolder.path, conflictStrategy);
    logDragDebug(`moveTaskDialog prepared key=${moveTaskKey} refreshPaths=${describeDebugPaths(moveRefreshPaths)}`);
    const now = Date.now();
    const recentStarts = recentMoveTaskStartsRef.current;
    for (const [key, startedAt] of recentStarts.entries()) {
      if (now - startedAt > MOVE_TASK_DEDUPE_WINDOW_MS) {
        recentStarts.delete(key);
      }
    }
    if (pendingMoveTaskStartsRef.current.has(moveTaskKey)) {
      logDragDebug(`moveTaskDeduped reason=pending key=${moveTaskKey}`);
      return true;
    }
    const recentStartedAt = recentStarts.get(moveTaskKey);
    if (typeof recentStartedAt === 'number' && now - recentStartedAt <= MOVE_TASK_DEDUPE_WINDOW_MS) {
      logDragDebug(`moveTaskDeduped reason=recent key=${moveTaskKey}`);
      return true;
    }

    pendingMoveTaskStartsRef.current.add(moveTaskKey);
    logDragDebug(`moveTaskPendingAdded key=${moveTaskKey} pendingCount=${pendingMoveTaskStartsRef.current.size}`);
    try {
      if (conflictStrategy === 'abort') {
        logDragDebug(`moveTaskConflictPreview start targetPath=${targetFolder.path} paths=${describeDebugPaths(paths)}`);
        const conflicts = await previewMoveFileConflicts(paths, targetFolder.path);
        logDragDebug(`moveTaskConflictPreview result count=${conflicts.length} targetPath=${targetFolder.path}`);
        if (conflicts.length > 0) {
          logDragDebug(`moveTaskConflictDialog open count=${conflicts.length} targetPath=${targetFolder.path} paths=${describeDebugPaths(paths)}`);
          setMoveConflictDialog({
            filesToMove,
            targetFolder,
            conflicts,
            operation: 'move',
            clearClipboardOnSuccess: options.clearClipboardOnSuccess,
            clearDragPayloadOnSuccess: options.clearDragPayloadOnSuccess,
            useTransferTaskOnResolve: true,
          });
          return true;
        }
      }

      logDragDebug(`moveTaskStartInvoke targetPath=${targetFolder.path} count=${paths.length} conflictStrategy=${conflictStrategy} paths=${describeDebugPaths(paths)}`);
      const taskId = await startMoveFilesTask(paths, targetFolder.path, conflictStrategy);
      recentStarts.set(moveTaskKey, Date.now());
      // 避免 map 长期增长，保留最新一批即可。
      while (recentStarts.size > 256) {
        const oldestKey = recentStarts.keys().next().value;
        if (!oldestKey) break;
        recentStarts.delete(oldestKey);
      }
      logDragDebug(`moveTaskStarted taskId=${taskId} count=${paths.length} conflictStrategy=${conflictStrategy}`);
      onStartTransfer();
      showFeedback(t('messages.moveStarted', { count: paths.length }));
      void waitForTransferTask(taskId, paths.length, {
        success: 'messages.moveCompleted',
        failed: 'messages.moveFailed',
        failedDefaultValue: '移动失败：{{error}}',
        failurePathHints: [targetFolder.path, ...paths],
        onCompleted: async task => {
          logDragDebug(`moveTaskOnCompleted taskId=${task?.id ?? '(none)'} moved=${task?.moved ?? 0} copiedCrossDevice=${task?.copiedCrossDevice ?? 0} failed=${task?.failed ?? 0} clearClipboard=${options.clearClipboardOnSuccess ? 'yes' : 'no'} clearDrag=${options.clearDragPayloadOnSuccess ? 'yes' : 'no'}`);
          if (task && task.failed === 0) {
            const completed = task.moved + task.copiedCrossDevice;
            if (options.clearClipboardOnSuccess) {
              logDragDebug(`moveTaskOnCompleted clearClipboard taskId=${task.id}`);
              await clearFileClipboardState();
            }
            if (options.clearDragPayloadOnSuccess && completed > 0) {
              logDragDebug(`moveTaskOnCompleted clearDragPayload taskId=${task.id} completed=${completed}`);
              finishSharedFileDrag();
            }
          }
          showMoveTaskCompletedFeedback(task, paths.length);
        },
        onFinished: task => {
          logDragDebug(`moveTaskOnFinished taskId=${task.id} status=${task.status} moved=${task.moved} copiedCrossDevice=${task.copiedCrossDevice} failed=${task.failed} conflicts=${task.conflicts} skipped=${task.skipped}`);
          if (task.status === 'cancelled' && options.clearDragPayloadOnSuccess) {
            finishSharedFileDrag();
          }
          if (task.status === 'failed' && (task.moved > 0 || task.copiedCrossDevice > 0 || task.skipped > 0)) {
            showMoveTaskCompletedFeedback(task, paths.length);
            return true;
          }
          return false;
        },
        onSettled: async task => {
          logDragDebug(`moveTaskSettledRefresh start taskId=${task.id} status=${task.status} refreshPaths=${describeDebugPaths(moveRefreshPaths)}`);
          await Promise.all(moveRefreshPaths.map(path => refreshCurrentDirRef.current(false, path)));
          const undoable = canUndoTransferMove(task, paths.length);
          logDragDebug(`moveTaskSettledRefresh done taskId=${task.id} status=${task.status} undoable=${undoable ? 'yes' : 'no'} refreshPaths=${describeDebugPaths(moveRefreshPaths)}`);
          await recordManualOperationHistory({
            category: 'move',
            title: '移动',
            summary: `移动 ${paths.length} 个项目`,
            effects: undoable ? buildMoveEffects(paths, targetFolder.path, true) : undefined,
            itemCount: paths.length,
            status: resolveTransferTaskOperationStatus(task),
            canUndo: undoable,
            reasonNotUndoable: undoable ? undefined : '仅同卷且全成功的移动支持撤销',
            primaryPath: paths[0],
            targetPath: targetFolder.path,
            conflictStrategy,
            volumeHint: resolveTransferTaskVolumeHint(task),
          });
        },
      });
    } catch (error) {
      logDragDebug(`moveTaskDialog error key=${moveTaskKey} targetPath=${targetFolder.path} error=${formatAppError(error)}`);
      throw error;
    } finally {
      pendingMoveTaskStartsRef.current.delete(moveTaskKey);
      logDragDebug(`moveTaskPendingRemoved key=${moveTaskKey} pendingCount=${pendingMoveTaskStartsRef.current.size}`);
    }
    return true;
  };
  startMoveTaskFromDialogRef.current = startMoveTaskFromDialog;

  // Finder→Aether 全局兜底：Tauri 已经把系统拖入自动 emit 给当前 webview
  useEffect(() => {
    if (!isActive) return;
    const unlistens: Array<() => void> = [];
    let cancelled = false;

    safeListen<TauriDragDropPayload>(TAURI_DRAG_ENTER_EVENT, ({ payload }) => {
      if (cancelled) return;
      // 仅当包含真实路径时才认为是 Finder 类系统拖入
      if (!Array.isArray(payload?.paths) || payload.paths.length === 0) return;
      setIsReceivingExternalDrag(true);
    }).then(fn => unlistens.push(fn)).catch(() => {});

    safeListen(TAURI_DRAG_LEAVE_EVENT, () => {
      if (cancelled) return;
      setIsReceivingExternalDrag(false);
    }).then(fn => unlistens.push(fn)).catch(() => {});

    safeListen<TauriDragDropPayload>(TAURI_DRAG_DROP_EVENT, async ({ payload }) => {
      if (cancelled) return;
      setIsReceivingExternalDrag(false);
      const paths = Array.isArray(payload?.paths) ? payload.paths.filter(Boolean) : [];
      if (paths.length === 0) return;
      const targetDir = getActionDirectory();
      if (!targetDir) return;
      // 系统拖入和 HTML5 拖入可能同时触发；用 surface 元素 onDrop 也会收到 e.dataTransfer.files。
      // 这里只处理"webview onDrop 没拿到"的兜底场景：检查 paths 是否已被处理过。
      if (isRecentExternalDropRef.current(paths[0])) return;
      if (isRemotePath(targetDir)) {
        showFeedback(t('messages.remoteReadOnly', { defaultValue: '远程访问第一版仅支持浏览。' }));
        return;
      }
      markRecentExternalDropRef.current(paths[0]);

      await importExternalPathsRef.current(paths, targetDir);
    }).then(fn => unlistens.push(fn)).catch(() => {});

    return () => {
      cancelled = true;
      unlistens.forEach(fn => fn());
    };
  }, [getActionDirectory, isActive, showFeedback, t]);

  useEffect(() => {
    if (!isActive) return;
    onSelectionCountChange?.(currentLevelFiles.length);
  }, [currentLevelFiles.length, onSelectionCountChange, isActive]);

  useEffect(() => {
    if (!isActive || !onTitleChange) return;
    if (isVirtualRoot) {
      onTitleChange(view, virtualRootLabel);
      return;
    }
    if (remotePathParts) {
      const leaf = remotePathParts.remotePath.split('/').filter(Boolean).pop();
      const title = leaf || remoteConnectionDisplayName || (currentTabLabelKey ? t(currentTabLabelKey) : 'Remote');
      onTitleChange(view, title);
      return;
    }
    const leaf = currentPath.split('/').filter(Boolean).pop();
    const title = leaf || (currentPath === '/' ? '/' : currentTabLabelKey ? t(currentTabLabelKey) : t('explorer.localStorage', '本地存储'));
    onTitleChange(view, title);
  }, [isActive, currentPath, currentTabLabelKey, view, t, onTitleChange, isVirtualRoot, virtualRootLabel, remotePathParts, remoteConnectionDisplayName]);

  useEffect(() => {
    if (!currentPath || !onPathChange) return;
    onPathChange(view, currentPath);
  }, [currentPath, onPathChange, view]);


  const getTagsForItem = (item: FileItem) => fileTags[item.path] || item.tags || [];

  const areAllTagged = (items: FileItem[], tagId: string) => (
    items.length > 0 && items.every(item => getTagsForItem(item).includes(tagId))
  );

  const toggleTagForItems = (tagId: string, items: FileItem[] = selectedFiles) => {
    if (items.length === 0) return;
    const uniqueItems = Array.from(new Map<string, FileItem>(items.map(item => [item.path, item])).values());
    const shouldRemove = areAllTagged(uniqueItems, tagId);
    onFileTagsChange(prev => {
      const next = { ...prev };
      uniqueItems.forEach(item => {
        const existing = new Set(next[item.path] || item.tags || []);
        if (shouldRemove) existing.delete(tagId);
        else existing.add(tagId);
        const values = Array.from(existing);
        if (values.length === 0) delete next[item.path];
        else next[item.path] = values;
      });
      return next;
    });
    showFeedback(t(shouldRemove ? 'messages.colorTagRemoved' : 'messages.colorTagAdded', {
      count: uniqueItems.length,
      tag: getTagLabel(tagId),
    }));
    setActiveDropdown(null);
    setContextMenu(null);
  };

  moveDraggedFilesRef.current = (draggedFileId, targetFolderId) =>
    moveDraggedFiles(draggedFileId, targetFolderId, selectedFileIdsRef.current, findFileByIdRef.current);

  const executeMoveFiles = async (
    filesToMove: FileItem[],
    targetFolder: FileItem,
    conflictStrategy: MoveConflictStrategy,
    options: FileOperationOptions = {},
  ): Promise<MoveExecutionSummary> => {
    const emptySummary: MoveExecutionSummary = {
      started: false,
      moved: 0,
      copiedCrossDevice: 0,
      failed: 0,
      conflicts: 0,
      skipped: 0,
    };
    try {
      if (filesToMove.some(file => isRemotePath(file.path)) || isRemotePath(targetFolder.path)) {
        showFeedback(t('messages.remoteReadOnly', { defaultValue: '远程访问第一版仅支持浏览。' }));
        return emptySummary;
      }
      if (!options.skipLargeBatchConfirm) {
        const shouldContinue = await confirmLargeBatchOperation(filesToMove.length);
        if (!shouldContinue) return emptySummary;
      }
      if (options.useTransferTask) {
        const started = await startMoveTaskFromDialog(filesToMove, targetFolder, conflictStrategy, {
          ...options,
          skipLargeBatchConfirm: true,
        });
        return { ...emptySummary, started };
      }
      // Keep this synchronous path only for call sites that need an immediate
      // MoveResult summary. User-facing bulk move flows should pass
      // useTransferTask so they get progress, cancellation, and task history.
      const result = await moveFiles(filesToMove.map(f => f.path), targetFolder.path, conflictStrategy);
      const skipped = result.skippedSameDir + result.skippedConflicts;
      const summary: MoveExecutionSummary = {
        started: true,
        moved: result.moved.length,
        copiedCrossDevice: result.copiedCrossDevice.length,
        failed: result.failed.length,
        conflicts: result.conflicts.length,
        skipped,
      };
      const completed = result.moved.length + result.copiedCrossDevice.length;
      const hasCrossDeviceCopies = result.copiedCrossDevice.length > 0;
      logDragDebug(`moveResult moved=${result.moved.length} copiedCrossDevice=${result.copiedCrossDevice.length} failed=${result.failed.length} conflicts=${result.conflicts.length} skippedSameDir=${result.skippedSameDir} skippedConflicts=${result.skippedConflicts} firstError=${result.failed[0]?.error ?? ''}`);

      if (result.conflicts.length > 0) {
        setMoveConflictDialog({ filesToMove, targetFolder, conflicts: result.conflicts, operation: 'move', ...options });
        return summary;
      }

      if (result.failed.length === 0) {
        if (options.clearClipboardOnSuccess) {
          await clearFileClipboardState();
        }
        if (options.clearDragPayloadOnSuccess) {
          finishSharedFileDrag();
        }
      }

      onSelectFiles([]);
      refreshCurrentDir();
      void Promise.all(buildMoveRefreshPaths(filesToMove.map(file => file.path), targetFolder.path)
        .map(path => refreshCurrentDir(false, path)));

      if (result.failed.length === 0 && skipped === 0 && result.moved.length > 0 && !hasCrossDeviceCopies) {
        showFeedback(t('messages.movedToFolder', { count: result.moved.length, folder: targetFolder.name }));
      } else if (result.failed.length === 0 && skipped === 0 && result.moved.length === 0 && hasCrossDeviceCopies) {
        showFeedback(t('messages.crossDeviceCopied', { count: result.copiedCrossDevice.length }));
      } else if (result.failed.length === 0 && skipped === 0 && result.moved.length > 0 && hasCrossDeviceCopies) {
        showFeedback(t('messages.movedWithCrossDeviceCopies', {
          moved: result.moved.length,
          copied: result.copiedCrossDevice.length,
        }));
      } else if (result.moved.length === 0 && result.skippedSameDir > 0 && result.skippedConflicts === 0 && result.failed.length === 0) {
        showFeedback(t('messages.sameDirectory'));
      } else if (completed === 0 && result.skippedConflicts > 0 && result.failed.length === 0) {
        showFeedback(t('messages.skippedConflicts', { count: result.skippedConflicts }));
      } else if (result.failed.length === 0 && result.skippedConflicts > 0) {
        showFeedback(t('messages.movedWithSkips', { ok: completed, skipped: result.skippedConflicts }));
      } else if (result.failed.length > 0 && completed === 0) {
        showFeedback(t('messages.moveFailed', { error: result.failed[0].error }));
      } else {
        showFeedback(
          t('messages.partialMove', {
            ok: completed,
            skipped,
            failed: result.failed.length,
            error: result.failed[0]?.error ?? '',
          })
        );
      }
      return summary;
    } catch (err) {
      logDragDebug(`moveError error=${formatAppError(err)}`);
      const error = await formatOperationPermissionError({
        error: err,
        getProtectedRootForPath,
        pathHints: [targetFolder.path, ...filesToMove.map(file => file.path)],
        t,
      });
      showFeedback(t('messages.moveFailed', { error }));
    }
    return { ...emptySummary, started: true, failed: filesToMove.length };
  };
  executeMoveFilesRef.current = executeMoveFiles;

  const handleSort = (key: string) => {
    setSortConfig(current => {
      if (current?.key === key) {
        if (key === 'modified' || key === 'size') {
          return { key, direction: current.direction === 'desc' ? 'asc' : 'desc' };
        }
        if (current.direction === 'desc') return null; // Reset sort
        return { key, direction: 'desc' };
      }
      return { key, direction: SORT_DEFAULT_DIRECTION[key] || 'asc' };
    });
  };

  const handleVideoMetadataLoaded = (file: FileItem, duration: number) => {
    const formatted = formatMediaDuration(duration);
    if (!formatted) return;
    setMediaDurationMap(prev => (prev[file.path] === formatted ? prev : { ...prev, [file.path]: formatted }));
  };

  const scrollToTop = () => {
    const scrollContainer = scrollContainerRef.current || containerRef.current?.closest('.overflow-y-auto');
    if (scrollContainer) {
      scrollContainer.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  const scrollToBottom = () => {
    const scrollContainer = scrollContainerRef.current || containerRef.current?.closest('.overflow-y-auto');
    if (scrollContainer) {
      scrollContainer.scrollTo({ top: scrollContainer.scrollHeight, behavior: 'smooth' });
    }
  };

  const getFileIcon = (target: FileItem | FileItem['type'], thumbnailOverride?: string) => {
    if (typeof target === 'string') {
      return <FileTypeIcon type={target} thumbnailOverride={thumbnailOverride} className="h-full w-full" />;
    }
    return <FileTypeIcon file={target} thumbnailOverride={thumbnailOverride} className="h-full w-full" />;
  };

  const activeListDensity = (theme.listDensity || 'normal') as keyof typeof LIST_MODIFIED_COL_BY_DENSITY;
  const listModifiedColClass = LIST_MODIFIED_COL_BY_DENSITY[activeListDensity] || LIST_MODIFIED_COL_BY_DENSITY.normal;

  const renderFileItem = (file: FileItem, isColumnItem = false, sortIndex?: number, sourceColumnIndex?: number) => (
    <React.Fragment key={file.id}>
      <FileItemRenderer
        columnPaths={columnPaths}
        displayMode={displayMode}
        dragOverFolderId={dragOverFolderId}
        file={file}
        fileTags={fileTags}
        formatFileMeta={formatFileMeta}
        getFileIcon={getFileIcon}
        getFileTypeLabel={getFileTypeLabel}
        handleContextMenu={handleContextMenu}
        handleDoubleClick={handleDoubleClick}
        handleDragEnd={handleDragEnd}
        handleDragLeave={handleDragLeave}
        handleDragOver={handleDragOver}
        handleDragStart={handleDragStart}
        handleDrop={handleDrop}
        handleFileMouseDown={handleFileMouseDown}
        handleRenameCancel={handleRenameCancel}
        handleRenameSubmit={handleRenameSubmit}
        handleSelectFile={handleSelectFile}
        handleVideoMetadataLoaded={handleVideoMetadataLoaded}
        isColumnItem={isColumnItem}
        onSelectFiles={onSelectFiles}
        openFileActionsMenu={openFileActionsMenu}
        pulseFileId={pulseFileId}
        renameInput={renameInput}
        renamingFile={renamingFile}
        selectedFileIds={selectedFileIds}
        setRenameInput={setRenameInput}
        showCheckboxCol={showCheckboxCol}
        showSortCol={showSortCol}
        sortIndex={sortIndex}
        sourceColumnIndex={sourceColumnIndex}
        t={t}
        tagColors={TAG_COLORS}
        theme={theme}
      />
    </React.Fragment>
  );

  const findFileById = (id: string) => {
    const currentFile = displayedFiles.find(file => file.id === id);
    if (currentFile) return currentFile;

    const cachedColumns: FileItem[][] = Object.values(columnFilesCache);
    for (const columnFiles of cachedColumns) {
      const columnFile = columnFiles.find(file => file.id === id);
      if (columnFile) return columnFile;
    }

    return undefined;
  };
  findFileByIdRef.current = findFileById;

  useEffect(() => {
    if (displayMode !== 'column') return;
    columnPaths.forEach(path => loadColumnFiles(path));
  }, [columnPaths, displayMode, loadColumnFiles]);

  const getColumnFiles = useCallback((parentPath: string | undefined) => {
    if (!parentPath) return currentLevelFiles;
    return columnFilesCache[parentPath] || [];
  }, [columnFilesCache, currentLevelFiles]);

  const getDirectoryEntries = useCallback((targetPath: string) => {
    if (!targetPath) return [] as FileItem[];
    if (targetPath === currentPath && !isVirtualRoot) return files;
    return columnFilesCache[targetPath] || [];
  }, [columnFilesCache, currentPath, files, isVirtualRoot]);

  const formatFileMeta = (file: FileItem) => {
    if (file.type === 'folder' && typeof file.childCount === 'number') {
      return t('explorer.folderItemsCount', { count: file.childCount, defaultValue: `${file.childCount} 个项目` });
    }
    const parts = [file.size && file.size !== '--' ? file.size : '', file.modified].filter(Boolean);
    return parts.length > 0 ? parts.join(' • ') : '--';
  };

  // Load text preview for text/code/md files
  useEffect(() => {
    const f = lastSelectedFile;
    let cancelled = false;
    setImagePreviewFailed(false);
    setPdfPreviewFailed(false);
    const isRemoteFile = Boolean(f && isRemotePath(f.path));
    setPdfPreviewLoading(Boolean(f && f.type === 'pdf' && !isRemoteFile));
    if (isRemoteFile) {
      setTextPreview('');
      setTextPreviewLoading(false);
      return () => { cancelled = true; };
    }
    if (f && (f.type === 'text' || f.type === 'code')) {
      setTextPreviewLoading(true);
      safeInvoke<string>('read_text_preview', { path: f.path })
        .then(text => {
          if (!cancelled) setTextPreview(text);
        })
        .catch(() => {
          if (!cancelled) setTextPreview('');
        })
        .finally(() => {
          if (!cancelled) setTextPreviewLoading(false);
        });
    } else {
      setTextPreview('');
      setTextPreviewLoading(false);
    }
    return () => { cancelled = true; };
  }, [lastSelectedFile]);

  const pathSegments = useMemo(() => {
    if (!currentPath) return [];
    if (remotePathParts) return remotePathParts.remotePath.split('/').filter(Boolean);
    return currentPath.split('/').filter(Boolean);
  }, [currentPath, remotePathParts]);

  const breadcrumbSegments = useMemo(() => {
    const homeName = homeDir?.split('/').filter(Boolean).pop();
    return pathSegments
      .map((segment, index) => ({
        segment,
        index,
        path: remotePathParts
          ? buildRemotePath(remotePathParts.connectionId, `/${pathSegments.slice(0, index + 1).join('/')}`)
          : `/${pathSegments.slice(0, index + 1).join('/')}`,
      }))
      .filter(item => item.segment !== 'Users' && item.segment !== homeName);
  }, [homeDir, pathSegments, remotePathParts]);

  const currentDisplayTitle = isVirtualRoot
    ? virtualRootLabel
    : remotePathParts
      ? (pathSegments[pathSegments.length - 1] || remoteConnectionDisplayName || 'Remote')
    : pathSegments.length > 0
      ? pathSegments[pathSegments.length - 1]
      : t('tabs.downloads', 'Downloads');

  useEffect(() => {
    const el = pathScrollRef.current;
    if (!el) return;
    const frame = window.requestAnimationFrame(() => {
      el.scrollLeft = el.scrollWidth;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [currentPath, isEditingPath, pathSegments.length]);

  useEffect(() => {
    if (!isActive) return;
    let unlisten: (() => void) | undefined;

    safeListen<NativeMenuCommand>(NATIVE_MENU_COMMAND_EVENT, event => {
      const command = event.payload;
      if (command === 'refresh') {
        void refreshCurrentDir(true);
      } else if (command === 'toggle-hidden-files') {
        resetColumnState();
        onThemeChange({ ...theme, showHiddenFiles: !theme.showHiddenFiles });
      } else if (command === 'toggle-inspector') {
        onThemeChange({ ...theme, showPreviewPanel: !theme.showPreviewPanel });
      } else {
        const nextDisplayMode = resolveNativeMenuDisplayMode(command);
        if (nextDisplayMode) {
          setDisplayMode(nextDisplayMode);
          if (nextDisplayMode === 'column') {
            resetColumnState();
          }
        }
      }
    }).then(fn => {
      unlisten = fn;
    }).catch(() => {});

    return () => {
      unlisten?.();
    };
  }, [isActive, onThemeChange, refreshCurrentDir, resetColumnState, theme]);

  const resolvePasteTargetDirectory = useCallback((targetPath?: string) => (
    getActionDirectory(targetPath || contextMenu?.targetDir)
  ), [contextMenu?.targetDir, getActionDirectory]);
  const {
    handleAlias,
    areAllFavorites,
    getActionFiles,
    getExtensionIcon,
    handleCalculateHash,
    handleCopyFile,
    handleCopyHashValue,
    handleCopyNames,
    handleCopyPaths,
    handleCopyToClipboard,
    handleCompress,
    handleCutToClipboard,
    handleDecompress,
    handleDeleteFile,
    handleExtensionAction,
    handleImportFiles,
    handleMoveFile,
    handleOpenFile,
    handleOpenTerminal,
    handleOpenWith,
    handleOpenWithOther,
    handlePasteFromClipboard,
    handleQuickLook,
    handleRenameCancel,
    handleRenameStart,
    handleRenameSubmit,
    handleRevealInFinder,
    handleToggleFavoriteForItems,
  } = useExplorerFileOperations({
    currentPath,
    executeCopyFiles,
    executeMoveFiles,
    favorites,
    files,
    getActionDirectory,
    getProtectedRootForPath,
    hashDialog,
    homeDir,
    importExternalPaths,
    isRemoteRoot,
    lastSelectedFile,
    onSelectFiles,
    selectedFileIds,
    selectedFiles,
    theme,
    t,
    clearContextSubmenuCloseTimer,
    navigateToPath,
    onRecordRecent,
    onToggleFavorite,
    refreshFileClipboardState,
    recordManualOperationHistory,
    refreshCurrentDir,
    resolvePasteTargetDirectory,
    renameInput,
    renamingFile,
    requestExistingOutputChoice,
    setActiveDropdown,
    setContextMenu,
    setContextSubmenu,
    setHasFileClipboard,
    setHashDialog,
    setRenameInput,
    setRenamingFile,
    setShowAIRename,
    setShowOperationHistory,
    showFeedback,
    startMoveTaskFromDialog,
  });
  handleCopyToClipboardRef.current = handleCopyToClipboard;
  handleCutToClipboardRef.current = handleCutToClipboard;
  handleOpenFileRef.current = handleOpenFile;
  handlePasteFromClipboardRef.current = handlePasteFromClipboard;
  handleQuickLookRef.current = handleQuickLook;
  handleDeleteFileRef.current = handleDeleteFile;
  const {
    handleDoubleClick,
  } = useExplorerKeyboard({
    containerRef,
    currentLevelFiles,
    currentPath,
    displayMode,
    fileListOffset,
    getActionDirectory,
    groupBy,
    handleCopyToClipboard,
    handleCutToClipboard,
    handleDeleteFile,
    handleOpenFile,
    handlePasteFromClipboard,
    handleQuickLook,
    isActive,
    isRemoteRoot,
    lastActivatedFileId,
    lastSelectedFile,
    listItemHeight,
    navigateBack,
    navigateForward,
    navigateToPath,
    onSelectFiles,
    onThemeChange,
    refreshCurrentDirRef,
    renamingFileId: renamingFile?.id || null,
    resetColumnState,
    scrollContainerRef,
    selectedFileIds,
    selectedFileIdsRef,
    selectedFiles,
    setActiveDropdown,
    setColumnPaths,
    setContextMenu: value => setContextMenu(value),
    setContextSubmenu,
    setDisplayMode,
    setLastActivatedFileId,
    setPulseFileId,
    setShowAIRename,
    setTypeaheadQuery,
    showFeedback,
    t,
    theme,
    typeaheadQuery,
  });

  const copyPayloadPathsToDirectory = useCallback(async (paths: string[], targetDir: string) => {
    logDragDebug(`copyPayloadPathsToDirectory targetDir=${targetDir} paths=${paths.join('|') || '(none)'}`);
    await executeCopyFiles(makeFileItemsFromPaths(paths), makeFolderItemFromPath(targetDir), 'abort');
  }, [executeCopyFiles]);

  const copyPayloadPathsToFolder = useCallback(async (paths: string[], targetFolder: FileItem) => {
    logDragDebug(`copyPayloadPathsToFolder targetFolderId=${targetFolder.id} targetPath=${targetFolder.path} paths=${paths.join('|') || '(none)'}`);
    await executeCopyFiles(makeFileItemsFromPaths(paths), targetFolder, 'abort');
  }, [executeCopyFiles]);

  const movePayloadPathsToDirectory = useCallback(async (paths: string[], targetDir: string) => {
    logDragDebug(`movePayloadPathsToDirectory targetDir=${targetDir} paths=${paths.join('|') || '(none)'}`);
    await executeMoveFilesRef.current(makeFileItemsFromPaths(paths), makeFolderItemFromPath(targetDir), 'abort', {
      useTransferTask: true,
    });
  }, []);

  const movePayloadPathsToFolder = useCallback(async (paths: string[], targetFolder: FileItem) => {
    logDragDebug(`movePayloadPathsToFolder targetFolderId=${targetFolder.id} targetPath=${targetFolder.path} paths=${paths.join('|') || '(none)'}`);
    await executeMoveFilesRef.current(makeFileItemsFromPaths(paths), targetFolder, 'abort', {
      useTransferTask: true,
    });
  }, []);

  const {
    clearDragPreview,
    clearExternalDragFallback,
    dragOverFolderId,
    dragPreview,
    finishSharedFileDrag,
    getActiveTransfer,
    handleDragEnd,
    handleDragLeave,
    handleDragOver,
    handleDragStart,
    handleDrop,
    handleFileMouseDown,
    handleSurfaceDragOver,
    handleSurfaceDrop,
    isRecentExternalDrop,
    markRecentExternalDrop,
  } = useExplorerDragDrop({
    activeTransferRef,
    findFileById: id => findFileByIdRef.current(id),
    focusCurrentWindow,
    getActionDirectory,
    importExternalPaths: (...args) => importExternalPathsRef.current(...args),
    isRemotePath,
    logDragDebug,
    moveDraggedFiles: (...args) => moveDraggedFilesRef.current(...args),
    movePayloadPathsToDirectory,
    movePayloadPathsToFolder,
    copyPayloadPathsToDirectory,
    copyPayloadPathsToFolder,
    recentExternalDropRef,
    selectedFileIds,
    selectedFiles,
    showFeedback,
    t,
  });
  clearDragPreviewRef.current = clearDragPreview;
  clearExternalDragFallbackRef.current = clearExternalDragFallback;
  finishSharedFileDragRef.current = finishSharedFileDrag;
  getActiveTransferRef.current = getActiveTransfer;
  isRecentExternalDropRef.current = isRecentExternalDrop;
  markRecentExternalDropRef.current = markRecentExternalDrop;
  const {
    handleNewFile,
    handleNewFolder,
    handlePasteAsTextFile,
    handleQuickCreateClick,
    handleSetCurrentAsHome,
    openCurrentInNewTab,
    openCurrentInNewWindow,
  } = useExplorerCreateEntries({
    contextMenuTargetDir: contextMenu?.targetDir,
    createEntryClickTimerRef,
    createEntryWindowLockRef,
    createEntryWindowLockTimerRef,
    currentPath,
    getActionDirectory,
    getDirectoryEntries,
    isRemoteRoot,
    listItemHeight,
    onCreateWindow,
    onOpenTab,
    onSelectFiles,
    onThemeChange,
    recordManualOperationHistory,
    refreshCurrentDir,
    scrollContainerRef,
    setActiveDropdown,
    setContextMenu,
    setRenameInput,
    setRenamingFile,
    showFeedback,
    t,
    theme,
  });
  const allColumns = displayMode === 'column'
    ? [undefined, ...columnPaths]
    : [];
  const {
    closeInspector,
    dirSizeError,
    dirSizeLoading,
    handleInspectorOpenWithChange,
    handleShowInspector,
    inspectorDetailsLoading,
    inspectorDefaultOpenWith,
    inspectorFile,
    inspectorFileType,
    inspectorIsFavorite,
    inspectorOpenWithDisabled,
    inspectorOpenWithPlaceholder,
    inspectorOpenWithValue,
    inspectorOverride,
    inspectorSizeInfo,
    inspectorSizePending,
    inspectorSizeStatusText,
    inspectorSupportsOpenWith,
    inspectorTags,
    inspectorVisible,
    openWithOptions,
  } = useExplorerInspector({
    clearContextMenu: () => setContextMenu(null),
    currentPath,
    favorites,
    getFileTypeLabel,
    getProtectedRootForPath,
    getTagsForItem,
    isLocalFilesystemPath,
    lastSelectedFile,
    onSelectFiles,
    onSyncFileOpenWith: syncFileOpenWithCollections,
    showFeedback,
    showPreviewPanel: theme.showPreviewPanel,
    t,
  });
  const {
    contextMenuPosition,
    handleContextMenu,
    openContextSubmenu,
    openFileActionsMenu,
    scheduleContextSubmenuClose,
  } = useExplorerContextMenu({
    areAllFavorites,
    areAllTagged,
    clearContextSubmenuCloseTimer,
    contextMenu,
    contextMenuRef,
    contextMenuSize,
    currentPath,
    enabledContextExtensions,
    findFileById,
    focusCurrentWindow,
    getActionDirectory,
    getActionFiles,
    getTagLabel,
    handleAlias,
    handleCompress,
    handleCopyNames,
    handleCopyPaths,
    handleCopyToClipboard,
    handleCutToClipboard,
    handleDecompress,
    handleDeleteFile,
    handleExtensionAction,
    handleNewFile,
    handleNewFolder,
    handleOpenFile,
    handleOpenInNewTab: openCurrentInNewTab,
    handleOpenInNewWindow: openCurrentInNewWindow,
    handleOpenTerminal,
    handleOpenWith,
    handleOpenWithOther,
    handlePasteAsTextFile,
    handlePasteFromClipboard,
    handleQuickLook,
    handleRenameStart,
    handleRevealInFinder,
    handleSetCurrentAsHome,
    handleShowInspector,
    handleSort,
    handleToggleFavoriteForItems,
    isRemoteRoot,
    onSelectFiles,
    refreshCurrentDir,
    refreshFileClipboardState,
    refreshTextClipboardState,
    selectedFileIds,
    setContextMenu,
    setContextMenuSize,
    setContextSubmenu,
    setShowAIRename,
    setShowOperationHistory,
    showFeedback,
    submenuCloseTimerRef,
    t,
    theme,
    toggleTagForItems,
  });

  return (
    <div className="h-full flex overflow-hidden">
      <ExplorerShell
        activeDropdown={activeDropdown}
        allColumns={allColumns}
        areAllTagged={areAllTagged}
        baseView={baseView}
        breadcrumbSegments={breadcrumbSegments}
        clearContextMenu={() => setContextMenu(null)}
        closeInspector={closeInspector}
        columnFilesCache={columnFilesCache}
        columnLoadErrors={columnLoadErrors}
        containerRef={containerRef}
        currentDisplayTitle={currentDisplayTitle}
        currentLevelFiles={currentLevelFiles}
        currentPath={currentPath}
        directoryErrorKind={directoryErrorKind}
        displayMode={displayMode}
        displayedFiles={displayedFiles}
        dropdownRef={dropdownRef}
        favorites={favorites}
        fileListRef={fileListRef}
        focusCurrentWindow={focusCurrentWindow}
        getActionDirectory={getActionDirectory}
        getActionFiles={getActionFiles}
        getColumnFiles={getColumnFiles}
        getGroupKey={getGroupKey}
        getTagLabel={getTagLabel}
        groupBy={groupBy}
        groupOptions={groupOptions}
        groupedFiles={groupedFiles}
        handleContainerMouseDown={handleContainerMouseDown}
        handleContainerMouseMove={handleContainerMouseMove}
        handleContainerMouseUp={handleContainerMouseUp}
        handleContainerScroll={handleContainerScroll}
        handleContextMenu={handleContextMenu}
        handleCopyPaths={handleCopyPaths}
        handleImportFiles={handleImportFiles}
        handleNewFile={handleNewFile}
        handleNewFolder={handleNewFolder}
        handleOpenTerminal={handleOpenTerminal}
        handleQuickCreateClick={handleQuickCreateClick}
        handleQuickLook={handleQuickLook}
        handleSort={handleSort}
        handleSurfaceDragOver={handleSurfaceDragOver}
        handleSurfaceDrop={handleSurfaceDrop}
        hasIncomingFileDrag={() => Boolean(incomingFileDragRef.current)}
        homeDir={homeDir}
        importExternalPaths={importExternalPaths}
        incomingDragVisibleMs={INCOMING_DRAG_VISIBLE_MS}
        incomingFileDrag={incomingFileDrag}
        inspectorOverride={inspectorOverride}
        isEditingPath={isEditingPath}
        isFavoritesRoot={isFavoritesRoot}
        isMarqueeDragging={isMarqueeDragging}
        isReceivingExternalDrag={isReceivingExternalDrag}
        isRecentRoot={isRecentRoot}
        isRemoteRoot={isRemoteRoot}
        isTagRoot={isTagRoot}
        isVirtualRoot={isVirtualRoot}
        lastSelectedFile={lastSelectedFile}
        liquidGlassEnabled={liquidGlassEnabled}
        listItemHeight={listItemHeight}
        listModifiedColClass={listModifiedColClass}
        loadError={loadError}
        loadingRemoteConnectionName={loadingRemoteConnectionName}
        navigateBack={navigateBack}
        navigateForward={navigateForward}
        navigateToPath={navigateToPath}
        navigationHistory={navigationHistory}
        onClearRecent={onClearRecent}
        onSelectFiles={onSelectFiles}
        onStartTransfer={onStartTransfer}
        onThemeChange={onThemeChange}
        onToggleFavorite={onToggleFavorite}
        openCurrentInNewTab={openCurrentInNewTab}
        pathInput={pathInput}
        pathScrollRef={pathScrollRef}
        recentItems={recentItems}
        refreshCurrentDir={refreshCurrentDir}
        remotePathParts={remotePathParts}
        renderFileItem={renderFileItem}
        resetColumnState={resetColumnState}
        retryProtectedPath={retryProtectedPath}
        scrollContainerRef={scrollContainerRef}
        scrollToBottom={scrollToBottom}
        scrollToTop={scrollToTop}
        searchQuery={searchQuery}
        selectedFileIds={selectedFileIds}
        selectedFiles={selectedFiles}
        selectionBox={selectionBox}
        setActiveDropdown={setActiveDropdown}
        setDisplayMode={setDisplayMode}
        setGroupBy={setGroupBy}
        setIsEditingPath={setIsEditingPath}
        setPathInput={setPathInput}
        setSearchQuery={setSearchQuery}
        setShowAIRename={setShowAIRename}
        setShowCheckboxCol={setShowCheckboxCol}
        setShowOperationHistory={setShowOperationHistory}
        setShowSortCol={setShowSortCol}
        showBlockingLoading={showBlockingLoading}
        showCheckboxCol={showCheckboxCol}
        showFeedback={showFeedback}
        showSortCol={showSortCol}
        sortConfig={sortConfig}
        t={t}
        tagColors={TAG_COLORS}
        theme={theme}
        toggleTagForItems={toggleTagForItems}
        view={view}
        virtualRootLabel={virtualRootLabel}
        visibleRange={visibleRange}
      />

      <PreviewPanel
        closeInspector={closeInspector}
        currentPath={currentPath}
        dirSizeError={dirSizeError}
        dirSizeLoading={dirSizeLoading}
        getFileIcon={getFileIcon}
        getTagLabel={getTagLabel}
        handleCopyFile={handleCopyFile}
        handleCopyHashValue={handleCopyHashValue}
        handleDeleteFile={handleDeleteFile}
        handleInspectorOpenWithChange={handleInspectorOpenWithChange}
        handleOpenTerminal={handleOpenTerminal}
        handleQuickLook={handleQuickLook}
        handleRenameStart={handleRenameStart}
        handleRevealInFinder={handleRevealInFinder}
        handleToggleFavoriteForItems={handleToggleFavoriteForItems}
        handleVideoMetadataLoaded={handleVideoMetadataLoaded}
        hashDialog={hashDialog}
        imagePreviewFailed={imagePreviewFailed}
        inspectorDefaultOpenWith={inspectorDefaultOpenWith}
        inspectorFile={inspectorFile}
        inspectorFileType={inspectorFileType}
        inspectorIsFavorite={inspectorIsFavorite}
        inspectorOpenWithDisabled={inspectorOpenWithDisabled}
        inspectorOpenWithPlaceholder={inspectorOpenWithPlaceholder}
        inspectorOpenWithValue={inspectorOpenWithValue}
        inspectorOverride={inspectorOverride}
        inspectorSizeInfo={inspectorSizeInfo}
        inspectorSizePending={inspectorSizePending}
        inspectorSizeStatusText={inspectorSizeStatusText}
        inspectorSupportsOpenWith={inspectorSupportsOpenWith}
        inspectorTags={inspectorTags}
        inspectorVisible={inspectorVisible}
        isRemotePath={isRemotePath}
        lastSelectedFile={lastSelectedFile}
        liquidGlassEnabled={liquidGlassEnabled}
        onCloseHashDialog={() => setHashDialog(null)}
        openWithOptions={openWithOptions}
        openWithSelectOther={OPEN_WITH_SELECT_OTHER}
        openWithSelectPlaceholder={OPEN_WITH_SELECT_PLACEHOLDER}
        pdfPreviewFailed={pdfPreviewFailed}
        pdfPreviewLoading={pdfPreviewLoading}
        selectedFileIds={selectedFileIds}
        setImagePreviewFailed={setImagePreviewFailed}
        setPdfPreviewFailed={setPdfPreviewFailed}
        setPdfPreviewLoading={setPdfPreviewLoading}
        t={t}
        tagColors={TAG_COLORS}
        textPreview={textPreview}
        textPreviewLoading={textPreviewLoading}
        theme={theme}
        toggleTagForItems={toggleTagForItems}
      />

      {contextMenu && (
        <ContextMenu
          areAllFavorites={areAllFavorites}
          areAllTagged={areAllTagged}
          contextMenu={contextMenu}
          contextMenuPosition={contextMenuPosition}
          contextMenuRef={contextMenuRef}
          contextSubmenu={contextSubmenu}
          currentPath={currentPath}
          defaultHomePath={theme.defaultHomePath || FAVORITES_VIRTUAL_PATH}
          enabledContextExtensions={enabledContextExtensions}
          findFileById={findFileById}
          getActionFiles={getActionFiles}
          getExtensionIcon={getExtensionIcon}
          getTagLabel={getTagLabel}
          handleAlias={handleAlias}
          handleCompress={handleCompress}
          handleCopyNames={handleCopyNames}
          handleCopyPaths={handleCopyPaths}
          handleCopyToClipboard={handleCopyToClipboard}
          handleCutToClipboard={handleCutToClipboard}
          handleDecompress={handleDecompress}
          handleDeleteFile={handleDeleteFile}
          handleExtensionAction={handleExtensionAction}
          handleNewFile={handleNewFile}
          handleNewFolder={handleNewFolder}
          handleOpenFile={handleOpenFile}
          handleOpenInNewTab={openCurrentInNewTab}
          handleOpenInNewWindow={openCurrentInNewWindow}
          handleOpenTerminal={handleOpenTerminal}
          handleOpenWith={handleOpenWith}
          handleOpenWithOther={handleOpenWithOther}
          handlePasteAsTextFile={handlePasteAsTextFile}
          handlePasteFromClipboard={handlePasteFromClipboard}
          handleQuickLook={handleQuickLook}
          handleRenameStart={handleRenameStart}
          handleRevealInFinder={handleRevealInFinder}
          handleSetCurrentAsHome={handleSetCurrentAsHome}
          handleShowInspector={handleShowInspector}
          handleSort={handleSort}
          handleToggleFavoriteForItems={handleToggleFavoriteForItems}
          hasFileClipboard={hasFileClipboard}
          hasTextClipboard={hasTextClipboard}
          isAdminContextMenuEmpty={isAdminContextMenuEmpty}
          liquidGlassEnabled={liquidGlassEnabled}
          onShowAiAssistant={() => {
            if (isRemoteRoot) {
              showFeedback(t('messages.remoteReadOnly', { defaultValue: '远程访问第一版仅支持浏览。' }));
              setContextMenu(null);
              return;
            }
            setShowAIRename(true);
            setContextMenu(null);
          }}
          onShowOperationHistory={() => {
            setShowOperationHistory(true);
            setContextMenu(null);
          }}
          onViewChange={onViewChange}
          openContextSubmenu={openContextSubmenu}
          openWithApps={OPEN_WITH_APPS}
          refreshCurrentDir={refreshCurrentDir}
          scheduleContextSubmenuClose={scheduleContextSubmenuClose}
          t={t}
          tagColors={TAG_COLORS}
          theme={theme}
          toggleTagForItems={toggleTagForItems}
        />
      )}

      <ExplorerOverlays
        dragOverFolderId={dragOverFolderId}
        dragPreview={dragPreview}
        existingOutputDialog={existingOutputDialog}
        findFileById={findFileById}
        getFileIcon={getFileIcon}
        handleExistingOutputChoice={handleExistingOutputChoice}
        handleMoveConflictChoice={handleMoveConflictChoice}
        moveConflictDialog={moveConflictDialog}
        operationMessage={operationMessage}
        t={t}
      />

      {showAIRename && (
        <AIRenamePanel
          files={(selectedFiles.length > 0 ? selectedFiles : currentLevelFiles).filter(file => !isRemotePath(file.path))}
          currentDir={isRemoteRoot ? '' : currentPath}
          theme={theme}
          onClose={() => setShowAIRename(false)}
          onComplete={() => { setShowAIRename(false); refreshCurrentDir(); }}
        />
      )}

      {showOperationHistory && (
        <OperationHistoryPanel
          onClose={() => setShowOperationHistory(false)}
          onOperationComplete={() => { void refreshCurrentDir(); }}
          retentionDays={theme.aiOpsHistoryRetentionDays}
          liquidGlassEnabled={liquidGlassEnabled}
        />
      )}

    </div>
  );
}
