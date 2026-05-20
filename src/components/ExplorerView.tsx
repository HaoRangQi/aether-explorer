import React, { useState, useMemo, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Search, Folder, Palette, Image as ImageIcon, ChevronRight, ChevronLeft, Grid2X2, List, Columns, MoreVertical, FileText, Video, Archive, FileIcon, ExternalLink, Info, Edit3, Copy, FolderArchive, Trash2, Edit2, Upload, Tag, MoreHorizontal, Star, Layers3, Check, Eye, EyeOff, PanelRight, PanelRightClose, Puzzle, Sparkles, ChevronsUp, ChevronsDown, Shield, Terminal, Code2, X, RefreshCw, History } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { safeShellOpen } from '../lib/url-guard';
import { confirm } from '@tauri-apps/plugin-dialog';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { Menu, MenuItem, PredefinedMenuItem, Submenu } from '@tauri-apps/api/menu';
import { PhysicalPosition } from '@tauri-apps/api/dpi';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { invoke, convertFileSrc } from '@tauri-apps/api/core';
import { emit, emitTo, listen } from '@tauri-apps/api/event';
import { listDirectory, getHomeDir, getFileInfo, getAppIcon, copyFile, copyFiles, moveFile, moveFiles, renameFile, deleteToTrash, createFile, createFolder, compressFiles, decompressFile, makeAlias, setFileClipboard, getFileClipboard, clearFileClipboard, setFileDragPayload, getFileDragPayload, clearFileDragPayload } from '../api/filesystem';
import type { FileTransferPayload, MoveConflict, MoveConflictStrategy } from '../api/filesystem';
import { ViewMode, ThemeSettings, FileItem, DisplayMode, GroupBy, ContextMenuAction } from '../types';
import { QUICK_ACCESS } from '../constants';
import AIRenamePanel from './AIRenamePanel';
import AIOpsHistory from './AIOpsHistory';
import CrossWindowDropBanner from './CrossWindowDropBanner';

const TAG_COLORS: Record<string, string> = {
  'tag-red': '#ff5f56',
  'tag-orange': '#ffbd2e',
  'tag-yellow': '#fcd430',
  'tag-green': '#27c93f',
  'tag-blue': '#007aff',
  'tag-purple': '#bf5af2',
  'tag-gray': '#8e8e93',
};

const LIST_COLS = {
  checkbox: 'w-6',
  sortNum: 'w-8',
  modified: 'w-56',
  size: 'w-24',
  type: 'w-24',
  actions: 'w-8',
};

// 将 "YYYY-MM-DD HH:mm" 转为相对时间标签，超出 7 天返回空字符串
function getRelativeTimeLabel(modified: string): string {
  if (!modified || modified === '未知') return '';
  const date = new Date(modified.replace(' ', 'T'));
  if (isNaN(date.getTime())) return '';
  const diffMs = Date.now() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return '刚刚';
  if (diffMin <= 10) return `${diffMin} 分钟前`;
  if (diffMin < 30) return '半小时内';
  if (diffMin < 60) return '1 小时内';
  const diffDays = Math.floor(diffMs / 86400000);
  if (diffDays < 1) return '今天';
  if (diffDays < 2) return '昨天';
  if (diffDays <= 7) return `${diffDays} 天前`;
  return '';
}

const INTERNAL_FILE_DRAG_MIME = 'application/x-aether-file-paths';
const FILE_DRAG_START_EVENT = 'aether-file-drag-start';
const FILE_DRAG_END_EVENT = 'aether-file-drag-end';
const FILE_DRAG_END_AT_EVENT = 'aether-file-drag-end-at';
const FILE_DROP_ACCEPTED_EVENT = 'aether-file-drop-accepted';
const TAURI_DRAG_DROP_EVENT = 'tauri://drag-drop';
const TAURI_DRAG_ENTER_EVENT = 'tauri://drag-enter';
const TAURI_DRAG_LEAVE_EVENT = 'tauri://drag-leave';
// banner 视觉提示的兜底超时（正常情况源端 dragEnd 会立即终结）
const INCOMING_DRAG_VISIBLE_MS = 12000;
const FAVORITES_VIRTUAL_PATH = 'aether://favorites';
const RECENT_VIRTUAL_PATH = 'aether://recent';
const TAGS_VIRTUAL_PREFIX = 'aether://tags/';
const OPEN_WITH_APPS = ['Finder', 'Preview', 'TextEdit', 'Safari', 'Google Chrome', 'Visual Studio Code'];
const logDragDebug = (message: string) => {
  invoke('debug_log', { message }).catch(() => {});
};

interface InternalDragState {
  id: string;
  startX: number;
  startY: number;
  active: boolean;
}

interface MoveConflictDialogState {
  filesToMove: FileItem[];
  targetFolder: FileItem;
  conflicts: MoveConflict[];
  operation: 'move' | 'copy';
  clearClipboardOnSuccess?: boolean;
  clearDragPayloadOnSuccess?: boolean;
}

interface IncomingFileDrag {
  paths: string[];
  sourceWindow: string;
  transferId: string;
  previewName: string;
  count: number;
  cut: boolean;
  /** banner 出现时间戳，用于驱动倒计时进度条 */
  shownAt: number;
}

interface FileDragBroadcastPayload {
  paths: string[];
  sourceWindow: string;
  transferId: string;
  previewName: string;
  count: number;
  cut: boolean;
}

interface FileDropAcceptedPayload {
  transferId: string;
  paths: string[];
  op: 'copy' | 'move';
  targetWindow: string;
}

interface FileDragEndAtPayload {
  transferId: string;
  /** 屏幕坐标（含多显示器情况） */
  screenX: number;
  screenY: number;
  /** 用户松手时按下的修饰键，跨设备策略 + 强制 copy/move 用 */
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  sourceWindow: string;
}

interface TauriDragDropPayload {
  paths: string[];
  position: { x: number; y: number };
}

interface ExplorerViewProps {
  view: ViewMode;
  isActive?: boolean;
  currentTabLabelKey?: string;
  initialPath?: string;
  theme: ThemeSettings;
  selectedFileIds: string[];
  onSelectFiles: (ids: string[]) => void;
  onSelectionCountChange?: (count: number) => void;
  onStartTransfer: () => void;
  onOpenTab?: (id: string, labelKey: string, options?: { label?: string; initialPath?: string }) => void;
  favorites: string[];
  onToggleFavorite: (id: string) => void;
  fileTags: Record<string, string[]>;
  onFileTagsChange: React.Dispatch<React.SetStateAction<Record<string, string[]>>>;
  recentItems: string[];
  onRecordRecent: (path: string) => void;
  onClearRecent: () => void;
  onThemeChange: (theme: ThemeSettings) => void;
  onViewChange: (view: ViewMode) => void;
  onTitleChange?: (tabId: string, title: string) => void;
  onPathChange?: (tabId: string, path: string) => void;
}

export default function ExplorerView({ view, isActive = false, currentTabLabelKey, initialPath, theme, selectedFileIds, onSelectFiles, onSelectionCountChange, onStartTransfer, onOpenTab, favorites, onToggleFavorite, fileTags, onFileTagsChange, recentItems, onRecordRecent, onClearRecent, onThemeChange, onViewChange, onTitleChange, onPathChange }: ExplorerViewProps) {
  const { t } = useTranslation();
  const [contextMenu, setContextMenu] = useState<{ x: number, y: number, fileIds: string[], isBlank?: boolean } | null>(null);
  const [displayMode, setDisplayMode] = useState<DisplayMode>('list');
  const [currentPath, setCurrentPath] = useState<string>('');
  const [backStack, setBackStack] = useState<string[]>([]);
  const [forwardStack, setForwardStack] = useState<string[]>([]);
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
  const [showAIHistory, setShowAIHistory] = useState(false);
  const [files, setFiles] = useState<FileItem[]>([]);
  const [favoriteFiles, setFavoriteFiles] = useState<FileItem[]>([]);
  const [recentFiles, setRecentFiles] = useState<FileItem[]>([]);
  const [taggedFiles, setTaggedFiles] = useState<FileItem[]>([]);
  const [appIconMap, setAppIconMap] = useState<Record<string, string>>({});
  const [columnFilesCache, setColumnFilesCache] = useState<Record<string, FileItem[]>>({});
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [showPermissionDialog, setShowPermissionDialog] = useState(false);
  const [homeDir, setHomeDir] = useState('');
  const [renamingFile, setRenamingFile] = useState<FileItem | null>(null);
  const [renameInput, setRenameInput] = useState('');
  const [textPreview, setTextPreview] = useState('');
  const [textPreviewLoading, setTextPreviewLoading] = useState(false);
  const [imagePreviewFailed, setImagePreviewFailed] = useState(false);
  const [pdfPreviewFailed, setPdfPreviewFailed] = useState(false);
  const [operationMessage, setOperationMessage] = useState('');
  const [dragOverFolderId, setDragOverFolderId] = useState<string | null>(null);
  const [dragPreview, setDragPreview] = useState<{
    x: number;
    y: number;
    fileId: string;
    count: number;
    active: boolean;
  } | null>(null);
  const [contextSubmenu, setContextSubmenu] = useState<string | null>(null);
  const [moveConflictDialog, setMoveConflictDialog] = useState<MoveConflictDialogState | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);
  const pathScrollRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const feedbackTimerRef = useRef<number | null>(null);
  const marqueeResetTimerRef = useRef<number | null>(null);
  const [selectionBox, setSelectionBox] = useState<{ x1: number, y1: number, x2: number, y2: number } | null>(null);
  const [isMarqueeDragging, setIsMarqueeDragging] = useState(false);
  const [typeaheadQuery, setTypeaheadQuery] = useState('');
  const typeaheadTimerRef = useRef<number | null>(null);
  const [hasFileClipboard, setHasFileClipboard] = useState(false);
  const [isAppFileDragActive, setIsAppFileDragActive] = useState(false);
  const [incomingFileDrag, setIncomingFileDrag] = useState<IncomingFileDrag | null>(null);
  const [isReceivingExternalDrag, setIsReceivingExternalDrag] = useState(false);
  const fileDragActivityTimerRef = useRef<number | null>(null);
  const fileDragClearTimerRef = useRef<number | null>(null);
  const draggedFileIdRef = useRef<string | null>(null);
  const activeTransferRef = useRef<{ transferId: string; paths: string[] } | null>(null);
  const incomingDragTimerRef = useRef<number | null>(null);
  const recentExternalDropRef = useRef<Set<string>>(new Set());
  // 拖拽期间监听光标位置，请求 Rust 把光标下的非源窗口 raise 到前台
  const dragCursorHandlerRef = useRef<((e: DragEvent) => void) | null>(null);
  const lastRaiseAtRef = useRef(0);
  const lastRaisedLabelRef = useRef<string | null>(null);
  // 让事件 listener 能拿到最新 theme / incomingFileDrag / acceptIncomingFileDrag。
  // 事件 listener 创建时闭包冻结，但 dragEnd 时 theme 可能已变化。
  const themeRef = useRef(theme);
  const incomingFileDragRef = useRef<IncomingFileDrag | null>(null);
  const acceptIncomingFileDragRef = useRef<((op: 'copy' | 'move') => Promise<void>) | null>(null);
  const internalDragRef = useRef<InternalDragState | null>(null);
  const loadRequestSeqRef = useRef(0);
  const pendingAppIconPathsRef = useRef<Set<string>>(new Set());
  const failedAppIconPathsRef = useRef<Set<string>>(new Set());
  // 批量 setAppIconMap 缓冲：每个图标到达不立即 setState，80ms 内合并一次
  // 避免 200 app 触发 200 次 setState → 200 次派生链全量重算
  const pendingIconUpdatesRef = useRef<Record<string, string>>({});
  const iconFlushTimerRef = useRef<number | null>(null);
  const [contextMenuSize, setContextMenuSize] = useState<{ key: string; width: number; height: number } | null>(null);

  const [dirSize, setDirSize] = useState<{ bytes: number; formatted: string; file_count: number } | null>(null);
  const [dirSizeLoading, setDirSizeLoading] = useState(false);
  const [inspectorOverride, setInspectorOverride] = useState(false); // 一次性弹出

  // 关闭面板（手动关闭或选中文件时）
  const closeInspector = () => {
    setInspectorOverride(false);
    // 如果自动预览开关也是关的，清掉 dirSize
    if (!theme.showPreviewPanel) {
      setDirSize(null);
      setDirSizeLoading(false);
    }
  };

  const getNameFromPath = (path: string) => {
    const parts = path.split('/').filter(Boolean);
    return parts[parts.length - 1] || path || '/';
  };

  const makeFileItemsFromPaths = (paths: string[]): FileItem[] => (
    paths.map(path => ({
      id: path,
      name: getNameFromPath(path),
      type: 'file',
      size: '--',
      modified: '',
      path,
    }))
  );

  const makeFolderItemFromPath = (path: string): FileItem => ({
    id: path,
    name: getNameFromPath(path),
    type: 'folder',
    size: '--',
    modified: '',
    path,
  });

  const resolveFavoriteItems = async (paths: string[]) => {
    const uniquePaths = Array.from(new Set(paths.filter(Boolean)));
    const results = await Promise.allSettled(uniquePaths.map(path => getFileInfo(path)));
    return results
      .filter((result): result is PromiseFulfilledResult<FileItem> => result.status === 'fulfilled')
      .map(result => result.value);
  };

  const getTagLabel = (tagId: string) => {
    const key = tagId.replace('tag-', '');
    const labelKey = tagId === 'tag-all' ? 'sidebar.allTags' : `sidebar.${key}`;
    return t(labelKey, key);
  };

  const getTagVirtualPath = (tagId: string) => `${TAGS_VIRTUAL_PREFIX}${tagId}`;

  const resolveTaggedItems = async (tagId: string, tagMap: Record<string, string[]>) => {
    const paths = Object.entries(tagMap)
      .filter(([, tags]) => tagId === 'tag-all' ? tags.length > 0 : tags.includes(tagId))
      .map(([path]) => path);
    const items = await resolveFavoriteItems(paths);
    return items.map(item => ({ ...item, tags: tagMap[item.path] || item.tags }));
  };

  const hydrateAppIcons = (items: FileItem[]) => {
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
        setAppIconMap(prev => ({ ...prev, ...pending }));
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
  };

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

  const getTransferPathsForFile = (file: FileItem) => {
    const items = selectedFileIds.includes(file.id) && selectedFiles.length > 0 ? selectedFiles : [file];
    return items.map(item => item.path);
  };

  const markAppFileDragActive = () => {
    setIsAppFileDragActive(true);
    if (fileDragActivityTimerRef.current) window.clearTimeout(fileDragActivityTimerRef.current);
    fileDragActivityTimerRef.current = window.setTimeout(() => {
      setIsAppFileDragActive(false);
      fileDragActivityTimerRef.current = null;
    }, 7000);
  };

  const clearAppFileDragActive = () => {
    if (fileDragActivityTimerRef.current) {
      window.clearTimeout(fileDragActivityTimerRef.current);
      fileDragActivityTimerRef.current = null;
    }
    setIsAppFileDragActive(false);
  };

  const finishSharedFileDrag = (delayMs = 0) => {
    if (fileDragClearTimerRef.current) window.clearTimeout(fileDragClearTimerRef.current);
    const finish = () => {
      fileDragClearTimerRef.current = null;
      clearAppFileDragActive();
      void clearFileDragPayload();
      void emit(FILE_DRAG_END_EVENT);
    };
    if (delayMs > 0) {
      fileDragClearTimerRef.current = window.setTimeout(finish, delayMs);
    } else {
      finish();
    }
  };

  const focusCurrentWindow = async () => {
    const currentWindow = getCurrentWindow();
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

  // ── 拖拽期间的"光标下窗口自动置顶" ──
  // HTML5 dragenter 跨窗口在 macOS 上不稳定；改由源窗口持续轮询 cursor 坐标，
  // 请求 Rust 端把光标下的非源窗口 raise。50ms 节流避免轰炸。
  const startCursorRaiseTracking = () => {
    if (dragCursorHandlerRef.current) return;
    const sourceLabel = getCurrentWindow().label;
    const handler = (e: DragEvent) => {
      const now = Date.now();
      if (now - lastRaiseAtRef.current < 50) return;
      // screenX/Y 在 drag 期间 0,0 是 Webkit 旧 bug，在 Tauri/wkwebview 上 Safari 17+ 已修
      if (e.screenX === 0 && e.screenY === 0) return;
      lastRaiseAtRef.current = now;
      invoke<string | null>('raise_window_at', {
        screenX: e.screenX,
        screenY: e.screenY,
        exceptWindow: sourceLabel,
      })
        .then(label => {
          if (label && label !== lastRaisedLabelRef.current) {
            lastRaisedLabelRef.current = label;
            logDragDebug(`raised window=${label} at=${e.screenX},${e.screenY}`);
          }
        })
        .catch(() => {});
    };
    document.addEventListener('drag', handler, true);
    dragCursorHandlerRef.current = handler;
  };

  const stopCursorRaiseTracking = () => {
    if (dragCursorHandlerRef.current) {
      document.removeEventListener('drag', dragCursorHandlerRef.current, true);
      dragCursorHandlerRef.current = null;
    }
    lastRaisedLabelRef.current = null;
    lastRaiseAtRef.current = 0;
  };

  const writeDragPayload = (file: FileItem) => {
    const paths = getTransferPathsForFile(file);
    const sourceWindow = getCurrentWindow().label;
    const transferId = `xfer-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const previewName = paths.length === 1 ? file.name : `${file.name} 等 ${paths.length} 项`;
    if (fileDragClearTimerRef.current) {
      window.clearTimeout(fileDragClearTimerRef.current);
      fileDragClearTimerRef.current = null;
    }
    activeTransferRef.current = { transferId, paths };
    markAppFileDragActive();
    void setFileDragPayload(paths, true, {
      sourceWindow,
      transferId,
      previewName,
      count: paths.length,
    })
      .then(() => emit(FILE_DRAG_START_EVENT, {
        paths,
        sourceWindow,
        transferId,
        previewName,
        count: paths.length,
        cut: true,
      } satisfies FileDragBroadcastPayload))
      .catch(() => {});
    return paths;
  };

  const readTransferPayload = async (dataTransfer?: DataTransfer): Promise<FileTransferPayload | null> => {
    const raw = dataTransfer?.getData(INTERNAL_FILE_DRAG_MIME);
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as FileTransferPayload;
        if (Array.isArray(parsed.paths) && parsed.paths.length > 0) return parsed;
      } catch {
        logDragDebug('payloadParseFailed');
      }
    }

    try {
      const payload = await getFileDragPayload();
      return payload?.paths.length ? payload : null;
    } catch {
      return null;
    }
  };

  const getDragTypes = (dataTransfer: DataTransfer) => Array.from(dataTransfer.types);

  const isFileTransferDrag = (dataTransfer: DataTransfer) => {
    const types = getDragTypes(dataTransfer);
    return types.includes('Files') || types.includes(INTERNAL_FILE_DRAG_MIME) || isAppFileDragActive;
  };

  const handleCopyToClipboard = async (items = selectedFiles) => {
    if (items.length === 0) return;
    await setFileClipboard(items.map(f => f.path), false);
    setHasFileClipboard(true);
    showFeedback(t('messages.copied', { count: items.length }));
    setContextMenu(null);
  };

  const handleCutToClipboard = async (items = selectedFiles) => {
    if (items.length === 0) return;
    await setFileClipboard(items.map(f => f.path), true);
    setHasFileClipboard(true);
    showFeedback(t('messages.cut', { count: items.length }));
    setContextMenu(null);
  };

  const handlePasteFromClipboard = async () => {
    const payload = await refreshFileClipboardState();
    const paths = payload?.paths ?? [];
    if (paths.length === 0) {
      showFeedback(t('messages.clipboardEmpty'));
      return;
    }
    setContextMenu(null);
    try {
      if (payload?.cut) {
        await executeMoveFiles(makeFileItemsFromPaths(paths), makeFolderItemFromPath(currentPath), 'abort', {
          clearClipboardOnSuccess: true,
        });
      } else {
        await executeCopyFiles(makeFileItemsFromPaths(paths), makeFolderItemFromPath(currentPath), 'abort');
      }
    } catch (e) {
      showFeedback(t('messages.operationFailed', { error: String(e) }));
    }
  };

  const handleShowInspector = (useCurrentDir = false) => {
    const calcAndOpen = () => {
      setInspectorOverride(true);
      setContextMenu(null);
      const target = useCurrentDir ? null : lastSelectedFile;
      if (target) {
        if (target.type === 'folder') {
          setDirSizeLoading(true);
          setDirSize(null);
          invoke<{ bytes: number; formatted: string; file_count: number }>('get_dir_size', { path: target.path })
            .then(result => { setDirSize(result); setDirSizeLoading(false); })
            .catch(() => { setDirSizeLoading(false); });
        } else {
          setDirSizeLoading(false);
          setDirSize(null);
        }
      } else {
        setDirSizeLoading(true);
        setDirSize(null);
        invoke<{ bytes: number; formatted: string; file_count: number }>('get_dir_size', { path: currentPath })
          .then(result => { setDirSize(result); setDirSizeLoading(false); })
          .catch(() => { setDirSizeLoading(false); });
      }
    };
    // 空白调用且面板已开：先关再开（强制刷新内容）
    if (useCurrentDir && inspectorOverride) {
      setInspectorOverride(false);
      setTimeout(calcAndOpen, 150);
      return;
    }
    calcAndOpen();
  };
  const [lastActivatedFileId, setLastActivatedFileId] = useState<string | null>(null);
  const [pulseFileId, setPulseFileId] = useState<string | null>(null);
  const pulseTimerRef = useRef<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const rafRef = useRef<number | null>(null);

  const contextMenuKey = contextMenu
    ? `${contextMenu.isBlank ? 'blank' : 'file'}:${contextMenu.fileIds.join('|')}`
    : '';

  const contextMenuPosition = useMemo(() => {
    if (!contextMenu || typeof window === 'undefined') return null;
    const margin = 12;
    const measuredSize = contextMenuSize?.key === contextMenuKey ? contextMenuSize : null;
    const menuWidth = measuredSize?.width || 224;
    const menuHeight = measuredSize?.height || (contextMenu.isBlank ? 220 : Math.min(420, window.innerHeight * 0.5));
    const maxHeight = Math.max(180, window.innerHeight - margin * 2);
    const overflowX = contextMenu.x + menuWidth + margin - window.innerWidth;
    const overflowY = contextMenu.y + menuHeight + margin - window.innerHeight;
    const left = overflowX > 0
      ? Math.max(margin, contextMenu.x - menuWidth)
      : Math.max(margin, contextMenu.x);
    const top = overflowY > 0
      ? Math.max(margin, contextMenu.y - menuHeight)
      : Math.max(margin, contextMenu.y);

    return {
      left,
      top,
      maxHeight,
    };
  }, [contextMenu, contextMenuKey, contextMenuSize]);

  // Sidebar view → real path mapping
  const baseView = view.replace(/-\d{13}$/, '');
  const activeTagId = currentPath.startsWith(TAGS_VIRTUAL_PREFIX)
    ? currentPath.slice(TAGS_VIRTUAL_PREFIX.length)
    : '';
  const isFavoritesRoot = currentPath === FAVORITES_VIRTUAL_PATH;
  const isRecentRoot = currentPath === RECENT_VIRTUAL_PATH;
  const isTagRoot = currentPath.startsWith(TAGS_VIRTUAL_PREFIX);
  const isVirtualRoot = isFavoritesRoot || isRecentRoot || isTagRoot;
  const virtualRootLabel = isFavoritesRoot
    ? t('sidebar.favoritesList', '我的收藏')
    : isRecentRoot
      ? t('sidebar.recent', '最近使用')
    : isTagRoot
      ? getTagLabel(activeTagId)
      : '';

  // 首页 tab 的 id 历史上叫 'desktop'（与 sidebar 的"桌面"项命名冲突）。
  // 在新产品决策下，"首页"指 theme.defaultHomePath（默认我的收藏），不是 ~/。
  // 这里映射跟随用户的默认首页设置；如果是 aether:// 虚拟路径就原样返回。
  const homeTabPath = theme.defaultHomePath || FAVORITES_VIRTUAL_PATH;

  const viewPathMap: Record<string, string> = {
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
  };

  const showFeedback = (message: string) => {
    setOperationMessage(message);
    if (feedbackTimerRef.current) window.clearTimeout(feedbackTimerRef.current);
    feedbackTimerRef.current = window.setTimeout(() => setOperationMessage(''), 300);
  };

  useEffect(() => {
    const startListener = listen<FileTransferPayload>(FILE_DRAG_START_EVENT, (event) => {
      if (event.payload?.paths.length) markAppFileDragActive();
    });
    const endListener = listen(FILE_DRAG_END_EVENT, () => {
      clearAppFileDragActive();
    });

    return () => {
      startListener.then(unlisten => unlisten());
      endListener.then(unlisten => unlisten());
      if (fileDragActivityTimerRef.current) window.clearTimeout(fileDragActivityTimerRef.current);
      if (fileDragClearTimerRef.current) window.clearTimeout(fileDragClearTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (!isActive) return;
    void refreshFileClipboardState();
    const handleFocus = () => { void refreshFileClipboardState(); };
    window.addEventListener('focus', handleFocus);
    return () => window.removeEventListener('focus', handleFocus);
  }, [isActive]);

  useEffect(() => {
    if (!contextMenu) {
      setContextMenuSize(null);
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      const rect = contextMenuRef.current?.getBoundingClientRect();
      if (!rect) return;
      setContextMenuSize({
        key: contextMenuKey,
        width: Math.ceil(rect.width),
        height: Math.ceil(rect.height),
      });
    });

    return () => window.cancelAnimationFrame(frame);
  }, [contextMenu, contextMenuKey]);

  const navigateToPath = (path: string, options?: { replace?: boolean }) => {
    const nextPath = path.trim();
    if (!nextPath || nextPath === currentPath) return;
    if (!options?.replace && currentPath) {
      setBackStack(prev => [...prev, currentPath]);
      setForwardStack([]);
    }
    setCurrentPath(nextPath);
    setColumnPaths([]);
    setSearchQuery('');
    onSelectFiles([]);
  };

  const restoreHistoryPath = (path: string) => {
    setCurrentPath(path);
    setColumnPaths([]);
    setSearchQuery('');
    onSelectFiles([]);
  };

  const resetTabTransientState = () => {
    setSearchQuery('');
    setSortConfig(null);
    setGroupBy('none');
    setColumnPaths([]);
    setColumnFilesCache({});
    setBackStack([]);
    setForwardStack([]);
    setActiveDropdown(null);
    setContextMenu(null);
    setContextSubmenu(null);
    setSelectionBox(null);
    setIsMarqueeDragging(false);
    setTypeaheadQuery('');
    setLastActivatedFileId(null);
    setPulseFileId(null);
    setRenamingFile(null);
    setRenameInput('');
    setFileListOffset(0);
    onSelectFiles([]);
    containerRef.current?.scrollTo({ top: 0, left: 0, behavior: 'auto' });
    scrollContainerRef.current?.scrollTo({ top: 0, left: 0, behavior: 'auto' });
    setScrollTop(0);
  };

  const navigateBack = () => {
    if (backStack.length === 0 || !currentPath) return;
    const previousPath = backStack[backStack.length - 1];
    setBackStack(prev => prev.slice(0, -1));
    setForwardStack(prev => [currentPath, ...prev]);
    restoreHistoryPath(previousPath);
  };

  const navigateForward = () => {
    if (forwardStack.length === 0 || !currentPath) return;
    const nextPath = forwardStack[0];
    setForwardStack(prev => prev.slice(1));
    setBackStack(prev => [...prev, currentPath]);
    restoreHistoryPath(nextPath);
  };

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
    if (feedbackTimerRef.current) window.clearTimeout(feedbackTimerRef.current);
    if (marqueeResetTimerRef.current) window.clearTimeout(marqueeResetTimerRef.current);
    if (typeaheadTimerRef.current) window.clearTimeout(typeaheadTimerRef.current);
  }, []);

  // Resolve view ID to path — strip timestamp suffix from tab IDs
  const resolveViewPath = (viewId: string): string | undefined => {
    if (viewPathMap[viewId]) return viewPathMap[viewId];
    if (initialPath) return initialPath;
    // Strip -timestamp suffix (e.g. "documents-1712345678900" → "documents")
    const base = viewId.replace(/-\d{13}$/, '');
    return viewPathMap[base];
  };

  // When sidebar view changes, navigate to mapped path
  React.useEffect(() => {
    if (!homeDir && baseView !== 'favorites-list' && baseView !== 'recent' && !baseView.startsWith('tag-')) return;
    const mappedPath = resolveViewPath(view);
    if (mappedPath && mappedPath !== currentPath) {
      navigateToPath(mappedPath, { replace: true });
    }
  }, [view, homeDir, baseView]);

  // Load directory when path changes
  useEffect(() => {
    let cancelled = false;
    if (!currentPath || isVirtualRoot) return;
    const requestId = ++loadRequestSeqRef.current;
    setLoading(true);
    setLoadError('');
    setShowPermissionDialog(false);
    listDirectory(currentPath, theme.showHiddenFiles)
      .then(f => {
        if (cancelled || requestId !== loadRequestSeqRef.current) return;
        setFiles(f);
        setLoadError('');
      })
      .catch(err => {
        if (cancelled || requestId !== loadRequestSeqRef.current) return;
        const msg = String(err);
        setFiles([]);
        setLoadError(msg);
        // Permission denied → show dialog
        if (msg.includes('PermissionDenied') || msg.includes('NotSupported') || msg.includes('无法读取')) {
          setShowPermissionDialog(true);
        }
      })
      .finally(() => {
        if (!cancelled && requestId === loadRequestSeqRef.current) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [currentPath, theme.showHiddenFiles, isVirtualRoot]);

  useEffect(() => {
    if (!isFavoritesRoot) return;
    const requestId = ++loadRequestSeqRef.current;
    let cancelled = false;
    setLoading(true);
    setLoadError('');
    setShowPermissionDialog(false);

    resolveFavoriteItems(favorites)
      .then(items => {
        if (cancelled || requestId !== loadRequestSeqRef.current) return;
        setFavoriteFiles(items);
      })
      .catch(err => {
        if (cancelled || requestId !== loadRequestSeqRef.current) return;
        setFavoriteFiles([]);
        setLoadError(String(err));
      })
      .finally(() => {
        if (!cancelled && requestId === loadRequestSeqRef.current) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [favorites, isFavoritesRoot]);

  useEffect(() => {
    if (!isRecentRoot) return;
    const requestId = ++loadRequestSeqRef.current;
    let cancelled = false;
    setLoading(true);
    setLoadError('');
    setShowPermissionDialog(false);

    resolveFavoriteItems(recentItems)
      .then(items => {
        if (cancelled || requestId !== loadRequestSeqRef.current) return;
        setRecentFiles(items);
      })
      .catch(err => {
        if (cancelled || requestId !== loadRequestSeqRef.current) return;
        setRecentFiles([]);
        setLoadError(String(err));
      })
      .finally(() => {
        if (!cancelled && requestId === loadRequestSeqRef.current) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [recentItems, isRecentRoot]);

  useEffect(() => {
    if (!isTagRoot) return;
    const requestId = ++loadRequestSeqRef.current;
    let cancelled = false;
    setLoading(true);
    setLoadError('');
    setShowPermissionDialog(false);

    resolveTaggedItems(baseView, fileTags)
      .then(items => {
        if (cancelled || requestId !== loadRequestSeqRef.current) return;
        setTaggedFiles(items);
      })
      .catch(err => {
        if (cancelled || requestId !== loadRequestSeqRef.current) return;
        setTaggedFiles([]);
        setLoadError(String(err));
      })
      .finally(() => {
        if (!cancelled && requestId === loadRequestSeqRef.current) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [activeTagId, fileTags, isTagRoot]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setActiveDropdown(null);
      }
      if (contextMenuRef.current && !contextMenuRef.current.contains(event.target as Node)) {
        setContextMenu(null);
      }
    };
    const handleGlobalMouseUp = (e: MouseEvent) => {
      setSelectionBox(null);
      setDragPreview(null);
      if (marqueeResetTimerRef.current) window.clearTimeout(marqueeResetTimerRef.current);
      marqueeResetTimerRef.current = window.setTimeout(() => setIsMarqueeDragging(false), 50);
    };
    document.addEventListener('mousedown', handleClickOutside);
    window.addEventListener('mouseup', handleGlobalMouseUp);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      window.removeEventListener('mouseup', handleGlobalMouseUp);
    };
  }, []);

  useEffect(() => {
    const handleInternalMouseMove = (event: MouseEvent) => {
      const dragState = internalDragRef.current;
      if (!dragState) return;

      if (!dragState.active) {
        const deltaX = Math.abs(event.clientX - dragState.startX);
        const deltaY = Math.abs(event.clientY - dragState.startY);
        if (deltaX < 4 && deltaY < 4) return;
        dragState.active = true;
        setDragPreview({
          x: event.clientX,
          y: event.clientY,
          fileId: dragState.id,
          count: selectedFileIds.includes(dragState.id) ? Math.max(1, selectedFileIds.length) : 1,
          active: true,
        });
        const sourceFile = findFileById(dragState.id);
        if (sourceFile) writeDragPayload(sourceFile);
        logDragDebug(`mouseDragStart id=${dragState.id}`);
      } else {
        setDragPreview(prev => prev ? { ...prev, x: event.clientX, y: event.clientY } : prev);
      }

      const folderId = getFolderIdFromPoint(event.clientX, event.clientY, dragState.id);
      if (folderId !== dragOverFolderId) {
        logDragDebug(`mouseDragOver folderId=${folderId ?? ''}`);
        setDragOverFolderId(folderId);
      }
    };

    const handleInternalMouseUp = async (event: MouseEvent) => {
      const dragState = internalDragRef.current;
      if (!dragState) return;

      internalDragRef.current = null;
      setDragOverFolderId(null);
      setDragPreview(null);

      if (!dragState.active) {
        finishSharedFileDrag();
        return;
      }

      const folderId = getFolderIdFromPoint(event.clientX, event.clientY, dragState.id);
      logDragDebug(`mouseDrop draggedId=${dragState.id} folderId=${folderId ?? ''}`);
      if (folderId) {
        await moveDraggedFiles(dragState.id, folderId);
      }
      finishSharedFileDrag();
    };

    window.addEventListener('mousemove', handleInternalMouseMove);
    window.addEventListener('mouseup', handleInternalMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleInternalMouseMove);
      window.removeEventListener('mouseup', handleInternalMouseUp);
    };
  }, [dragOverFolderId, files, columnFilesCache, selectedFileIds]);

  React.useEffect(() => {
    setSearchQuery('');
    onSelectFiles([]);
    setColumnPaths([]);
  }, [view]);
  
  const displayedFiles = isFavoritesRoot ? favoriteFiles : isRecentRoot ? recentFiles : isTagRoot ? taggedFiles : files;
  const filesWithAppIcons = useMemo(() => displayedFiles.map(file => (
    file.type === 'application' && appIconMap[file.path]
      ? { ...file, thumbnail: appIconMap[file.path] }
      : file
  )), [displayedFiles, appIconMap]);

  useEffect(() => {
    hydrateAppIcons(displayedFiles);
  }, [displayedFiles, appIconMap]);

  const selectedFiles = useMemo(() => filesWithAppIcons.filter(f => selectedFileIds.includes(f.id)), [selectedFileIds, filesWithAppIcons]);
  const lastSelectedFile = useMemo(() => filesWithAppIcons.find(f => f.id === selectedFileIds[selectedFileIds.length - 1]), [selectedFileIds, filesWithAppIcons]);
  const isAdminContextMenuEmpty = useMemo(() => !(theme.contextMenuExtensions || []).some(ext => ext.enabled), [theme.contextMenuExtensions]);
  const enabledContextExtensions = useMemo(() => (theme.contextMenuExtensions || []).filter(ext => ext.enabled), [theme.contextMenuExtensions]);

  const currentLevelFiles = useMemo(() => {
    let filtered = filesWithAppIcons.filter(file => {
      if (isVirtualRoot) {
        return file.name.toLowerCase().includes(searchQuery.toLowerCase());
      }
      return file.name.toLowerCase().includes(searchQuery.toLowerCase());
    });

    if (sortConfig) {
      filtered = [...filtered].sort((a, b) => {
        const valA = (a as any)[sortConfig.key] || '';
        const valB = (b as any)[sortConfig.key] || '';
        if (valA < valB) return sortConfig.direction === 'asc' ? -1 : 1;
        if (valA > valB) return sortConfig.direction === 'asc' ? 1 : -1;
        return 0;
      });
    }

    return filtered;
  }, [filesWithAppIcons, searchQuery, sortConfig, isVirtualRoot]);

  // 虚拟滚动：仅渲染列表视图的可见项（>50 文件时启用）
  const densityHeights: Record<string, number> = { ultra: 28, compact: 36, normal: 44, relaxed: 60 };
  const listItemGap = 8;
  const listItemHeight = (densityHeights[theme.listDensity || 'normal'] || 44) + listItemGap;
  const listOverScan = 10;
  const fileListRef = useRef<HTMLDivElement>(null);
  const [fileListOffset, setFileListOffset] = useState(0);
  useEffect(() => {
    // 用真正的滚动容器（scrollContainerRef）来计算列表相对它的偏移；
    // 之前用 containerRef.scrollTop 永远是 0，导致 visibleRange 起点不准。
    const scrollEl = scrollContainerRef.current;
    if (fileListRef.current && scrollEl) {
      const listTop = fileListRef.current.getBoundingClientRect().top;
      const scrollTop2 = scrollEl.getBoundingClientRect().top;
      setFileListOffset(listTop - scrollTop2 + scrollEl.scrollTop);
    }
  }, [currentPath]);

  // 虚拟滚动门槛：列表视图 > 80 项时启用；分组模式暂不虚拟化
  const VIRTUAL_LIST_THRESHOLD = 80;
  const visibleRange = useMemo(() => {
    if (displayMode !== 'list') return null;
    if (groupBy !== 'none') return null;
    if (currentLevelFiles.length < VIRTUAL_LIST_THRESHOLD) return null;
    const containerH = scrollContainerRef.current?.clientHeight || 600;
    const adjustedTop = Math.max(0, scrollTop - fileListOffset);
    const start = Math.max(0, Math.floor(adjustedTop / listItemHeight) - listOverScan);
    const end = Math.min(currentLevelFiles.length, Math.ceil((adjustedTop + containerH) / listItemHeight) + listOverScan);
    if (start >= end) return null;
    return { start, end, totalHeight: currentLevelFiles.length * listItemHeight, offsetTop: start * listItemHeight };
  }, [scrollTop, currentLevelFiles.length, listItemHeight, displayMode, groupBy, fileListOffset]);

  const handleContainerScroll = () => {
    if (displayMode !== 'list') return;
    if (rafRef.current) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      // 真正滚动的是内层 scrollContainerRef（overflow-y-auto）；
      // containerRef 是外层 wrapper（无 overflow），scrollTop 永远 0。
      const el = scrollContainerRef.current;
      if (el) setScrollTop(el.scrollTop);
    });
  };
  useEffect(() => () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); }, []);

  // 卸载时确保 cursor raise 监听摘掉，避免泄漏 / 重复触发
  useEffect(() => () => { stopCursorRaiseTracking(); }, []);

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

    listen<FileDragBroadcastPayload>(FILE_DRAG_START_EVENT, ({ payload }) => {
      if (cancelled) return;
      if (payload.sourceWindow === getCurrentWindow().label) return;
      if (!payload.paths || payload.paths.length === 0) return;
      clearIncomingTimer();
      setIncomingFileDrag({
        paths: payload.paths,
        sourceWindow: payload.sourceWindow,
        transferId: payload.transferId,
        previewName: payload.previewName || `${payload.paths.length} 个项目`,
        count: payload.count ?? payload.paths.length,
        cut: payload.cut ?? true,
        shownAt: Date.now(),
      });
      incomingDragTimerRef.current = window.setTimeout(() => {
        if (cancelled) return;
        setIncomingFileDrag(null);
        incomingDragTimerRef.current = null;
      }, INCOMING_DRAG_VISIBLE_MS);
    }).then(fn => unlistens.push(fn)).catch(() => {});

    // 注意：故意不监听 FILE_DRAG_END_EVENT 关闭 banner。
    // 源端 dragEnd 后会发 END 事件，但目标窗口的 banner 此时刚出现，
    // 用户还没看清/操作，立即清掉会变成"一闪而过"。
    // banner 只在以下情况关闭：① 用户点击执行 ② 用户右键 / ESC 取消 ③ VISIBLE_MS 超时

    // ⭐ 关键：松手即处理 — 收到源端 dragEnd 携带的屏幕坐标，
    // 若坐标落在本窗口范围内，立即执行 copy/move，无需用户点 banner。
    listen<FileDragEndAtPayload>(FILE_DRAG_END_AT_EVENT, async ({ payload }) => {
      if (cancelled) return;
      if (payload.sourceWindow === getCurrentWindow().label) return;

      const win = getCurrentWindow();
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
        logDragDebug(`dragEndAt error=${String(err)}`);
      }
    }).then(fn => unlistens.push(fn)).catch(() => {});

    listen<FileDropAcceptedPayload>(FILE_DROP_ACCEPTED_EVENT, ({ payload }) => {
      if (cancelled) return;
      const active = activeTransferRef.current;
      if (!active || active.transferId !== payload.transferId) return;
      activeTransferRef.current = null;
      finishSharedFileDrag(0);
      if (payload.op === 'move') {
        void refreshCurrentDir();
        showFeedback(t('messages.crossWindowMoved', {
          count: payload.paths.length,
          defaultValue: '已移动 {{count}} 项到另一窗口',
        }));
      } else {
        showFeedback(t('messages.crossWindowCopied', {
          count: payload.paths.length,
          defaultValue: '已复制 {{count}} 项到另一窗口',
        }));
      }
    }).then(fn => unlistens.push(fn)).catch(() => {});

    return () => {
      cancelled = true;
      clearIncomingTimer();
      unlistens.forEach(fn => fn());
    };
  }, [isActive, t]);

  // Aether↔Aether 跨窗口接收：执行 copy/move 到 currentPath
  // 来源可能是 ① banner 上的显式按钮点击 ② 源端 dragEnd 携带坐标命中本窗口
  const acceptIncomingFileDrag = async (op: 'copy' | 'move') => {
    const drag = incomingFileDragRef.current;
    if (!drag) return;
    if (!currentPath) {
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

    const targetFolder = makeFolderItemFromPath(currentPath);
    const items = makeFileItemsFromPaths(drag.paths);

    try {
      if (op === 'move') {
        await executeMoveFiles(items, targetFolder, 'abort');
      } else {
        await executeCopyFiles(items, targetFolder, 'abort');
      }
      await emitTo(drag.sourceWindow, FILE_DROP_ACCEPTED_EVENT, {
        transferId: drag.transferId,
        paths: drag.paths,
        op,
        targetWindow: getCurrentWindow().label,
      } satisfies FileDropAcceptedPayload);
    } catch (err) {
      showFeedback(t('messages.crossWindowReceiveFailed', {
        error: String(err),
        defaultValue: '接收跨窗口文件失败：{{error}}',
      }));
    }
  };
  // 把最新版本的 accept 函数挂到 ref 上供 Tauri event listener 调用
  acceptIncomingFileDragRef.current = acceptIncomingFileDrag;

  // Finder→Aether 全局兜底：Tauri 已经把系统拖入自动 emit 给当前 webview
  useEffect(() => {
    if (!isActive) return;
    const unlistens: Array<() => void> = [];
    let cancelled = false;

    listen<TauriDragDropPayload>(TAURI_DRAG_ENTER_EVENT, ({ payload }) => {
      if (cancelled) return;
      // 仅当包含真实路径时才认为是 Finder 类系统拖入
      if (!Array.isArray(payload?.paths) || payload.paths.length === 0) return;
      setIsReceivingExternalDrag(true);
    }).then(fn => unlistens.push(fn)).catch(() => {});

    listen(TAURI_DRAG_LEAVE_EVENT, () => {
      if (cancelled) return;
      setIsReceivingExternalDrag(false);
    }).then(fn => unlistens.push(fn)).catch(() => {});

    listen<TauriDragDropPayload>(TAURI_DRAG_DROP_EVENT, async ({ payload }) => {
      if (cancelled) return;
      setIsReceivingExternalDrag(false);
      const paths = Array.isArray(payload?.paths) ? payload.paths.filter(Boolean) : [];
      if (paths.length === 0) return;
      if (!currentPath) return;
      // 系统拖入和 HTML5 拖入可能同时触发；用 surface 元素 onDrop 也会收到 e.dataTransfer.files。
      // 这里只处理"webview onDrop 没拿到"的兜底场景：检查 paths 是否已被处理过。
      if (recentExternalDropRef.current.has(paths[0])) return;
      recentExternalDropRef.current.add(paths[0]);
      window.setTimeout(() => recentExternalDropRef.current.delete(paths[0]), 1500);

      try {
        const result = await copyFiles(paths, currentPath, 'abort');
        if (result.conflicts.length > 0) {
          setMoveConflictDialog({
            filesToMove: makeFileItemsFromPaths(paths),
            targetFolder: makeFolderItemFromPath(currentPath),
            conflicts: result.conflicts,
            operation: 'copy',
          });
          return;
        }
        await refreshCurrentDir();
        if (result.failed.length === 0 && result.copied.length > 0) {
          showFeedback(t('messages.importedFromFinder', { count: result.copied.length }));
        } else if (result.failed.length > 0) {
          showFeedback(t('messages.finderImportFailed', {
            error: result.failed[0].error,
            defaultValue: '导入失败：{{error}}',
          }));
        }
      } catch (err) {
        showFeedback(t('messages.finderImportFailed', {
          error: String(err),
          defaultValue: '导入失败：{{error}}',
        }));
      }
    }).then(fn => unlistens.push(fn)).catch(() => {});

    return () => {
      cancelled = true;
      unlistens.forEach(fn => fn());
    };
  }, [isActive, currentPath, t]);

  useEffect(() => {
    if (!isActive) return;
    onSelectionCountChange?.(currentLevelFiles.length);
  }, [currentLevelFiles.length, onSelectionCountChange, isActive]);

  const focusFileByPrefix = (prefix: string) => {
    if (!prefix || currentLevelFiles.length === 0) return;
    const lower = prefix.toLowerCase();
    const currentIndex = selectedFileIds.length
      ? currentLevelFiles.findIndex(file => file.id === selectedFileIds[selectedFileIds.length - 1])
      : lastActivatedFileId
        ? currentLevelFiles.findIndex(file => file.id === lastActivatedFileId)
        : -1;
    const startIndex = currentIndex >= 0 ? (currentIndex + 1) % currentLevelFiles.length : 0;
    const matches = currentLevelFiles.filter(file => file.name.toLowerCase().startsWith(lower));
    if (matches.length === 0) return;
    const ordered = [
      ...currentLevelFiles.slice(startIndex),
      ...currentLevelFiles.slice(0, startIndex),
    ];
    const next = ordered.find(file => file.name.toLowerCase().startsWith(lower)) || matches[0];
    if (!next) return;
    onSelectFiles([next.id]);
    setLastActivatedFileId(next.id);
    setPulseFileId(next.id);
    if (pulseTimerRef.current) window.clearTimeout(pulseTimerRef.current);
    pulseTimerRef.current = window.setTimeout(() => setPulseFileId(null), 260);
    if (next.type === 'folder') {
      if (displayMode === 'column') {
        const parent = next.path.substring(0, next.path.lastIndexOf('/'));
        const parentIndex = columnPaths.indexOf(parent);
        const newPaths = parentIndex >= 0
          ? columnPaths.slice(0, parentIndex + 1)
          : columnPaths;
        setColumnPaths([...newPaths, next.path]);
      }
    }
    scrollFileIntoView(next.id);
    if (typeaheadTimerRef.current) window.clearTimeout(typeaheadTimerRef.current);
    typeaheadTimerRef.current = window.setTimeout(() => setTypeaheadQuery(''), 700);
  };

  const scrollFileIntoView = (fileId: string) => {
    window.requestAnimationFrame(() => {
      const surface = containerRef.current;
      if (!surface) return;
      const target = Array.from(surface.querySelectorAll('.file-item') as NodeListOf<HTMLElement>)
        .find(element => element.dataset.id === fileId);
      if (!target) return;

      const scrollParent = displayMode === 'column'
        ? target.closest<HTMLElement>('.custom-scrollbar')
        : scrollContainerRef.current;
      if (!scrollParent) return;

      const targetRect = target.getBoundingClientRect();
      const parentRect = scrollParent.getBoundingClientRect();

      if (displayMode === 'column') {
        const nextTop = scrollParent.scrollTop + targetRect.top - parentRect.top - (parentRect.height / 2) + (targetRect.height / 2);
        scrollParent.scrollTo({ top: Math.max(0, nextTop), behavior: 'smooth' });
        target.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
        return;
      }

      const nextTop = scrollParent.scrollTop + targetRect.top - parentRect.top - (parentRect.height / 2) + (targetRect.height / 2);
      scrollParent.scrollTo({ top: Math.max(0, nextTop), behavior: 'smooth' });
    });
  };

  useEffect(() => {
    if (!isActive || !onTitleChange) return;
    if (isVirtualRoot) {
      onTitleChange(view, virtualRootLabel);
      return;
    }
    const leaf = currentPath.split('/').filter(Boolean).pop();
    const title = leaf || (currentPath === '/' ? '/' : currentTabLabelKey ? t(currentTabLabelKey) : t('explorer.localStorage', '本地存储'));
    onTitleChange(view, title);
  }, [isActive, currentPath, currentTabLabelKey, view, t, onTitleChange, isVirtualRoot, virtualRootLabel]);

  useEffect(() => {
    if (!currentPath || !onPathChange) return;
    onPathChange(view, currentPath);
  }, [currentPath, onPathChange, view]);

  useEffect(() => {
    if (!isActive) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const isTyping = !!target?.closest('input, textarea, select, [contenteditable="true"]');
      if (isTyping) return;

      // Cmd+Shift+R: AI 文件助手
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'r') {
        e.preventDefault();
        setShowAIRename(true);
        return;
      }

      // Cmd+A: 全选
      if ((e.metaKey || e.ctrlKey) && e.key === 'a') {
        e.preventDefault();
        onSelectFiles(currentLevelFiles.map(f => f.id));
        return;
      }
      // Cmd+C: 复制文件，支持跨窗口粘贴
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'c' && selectedFiles.length > 0) {
        e.preventDefault();
        void handleCopyToClipboard();
        return;
      }
      // Cmd+X: 剪切文件，支持跨窗口移动
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'x' && selectedFiles.length > 0) {
        e.preventDefault();
        void handleCutToClipboard();
        return;
      }
      // Cmd+V: 粘贴 app 内文件剪贴板，支持跨窗口
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'v') {
        e.preventDefault();
        void handlePasteFromClipboard();
        return;
      }
      // Cmd+I: 显示简介/预览面板
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'i' && lastSelectedFile) {
        e.preventDefault();
        onThemeChange({ ...theme, showPreviewPanel: true });
        return;
      }
      // Cmd+[: 后退
      if ((e.metaKey || e.ctrlKey) && e.key === '[') {
        e.preventDefault();
        navigateBack();
        return;
      }
      // Cmd+]: 前进
      if ((e.metaKey || e.ctrlKey) && e.key === ']') {
        e.preventDefault();
        navigateForward();
        return;
      }
      // Backspace (无选中文件时): 返回上一级
      if (e.key === 'Backspace' && selectedFiles.length === 0) {
        e.preventDefault();
        navigateBack();
        return;
      }
      // Delete 或 Backspace (有选中文件时): 移至废纸篓
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedFiles.length > 0) {
        e.preventDefault();
        handleDeleteFile(selectedFiles[0]);
        return;
      }
      // Enter: 打开文件/文件夹
      if (e.key === 'Enter' && lastSelectedFile) {
        e.preventDefault();
        handleOpenFile(lastSelectedFile);
        return;
      }
      // Space: Quick Look 预览（可在设置中关闭）
      if (e.key === ' ' && lastSelectedFile && theme.enableSpacePreview !== false) {
        e.preventDefault();
        handleQuickLook(lastSelectedFile);
        return;
      }
      // Cmd+Up: 返回上一级目录
      if ((e.metaKey || e.ctrlKey) && e.key === 'ArrowUp') {
        e.preventDefault();
        const parent = currentPath.split('/').slice(0, -1).join('/') || '/';
        if (parent !== currentPath) navigateToPath(parent);
        return;
      }
      // Cmd+Down: 进入选中的文件夹
      if ((e.metaKey || e.ctrlKey) && e.key === 'ArrowDown' && lastSelectedFile?.type === 'folder') {
        e.preventDefault();
        handleOpenFile(lastSelectedFile);
        return;
      }
      // 字母/数字: 快速定位
      if (e.key.length === 1 && /^[\p{L}\p{N}]$/u.test(e.key)) {
        const nextQuery = typeaheadQuery === e.key ? e.key : `${typeaheadQuery}${e.key}`;
        setTypeaheadQuery(nextQuery);
        focusFileByPrefix(nextQuery);
        return;
      }
      // 箭头上下: 选择上一个/下一个文件
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        if (currentLevelFiles.length === 0) return;
        const currentIndex = selectedFileIds.length
          ? currentLevelFiles.findIndex(file => file.id === selectedFileIds[selectedFileIds.length - 1])
          : -1;
        let nextIndex: number;
        if (currentIndex === -1) {
          nextIndex = e.key === 'ArrowDown' ? 0 : currentLevelFiles.length - 1;
        } else {
          nextIndex = e.key === 'ArrowDown'
            ? Math.min(currentIndex + 1, currentLevelFiles.length - 1)
            : Math.max(currentIndex - 1, 0);
        }
        const nextFile = currentLevelFiles[nextIndex];
        if (nextFile) {
          onSelectFiles([nextFile.id]);
          // 滚动到可见区域
          const el = document.querySelector(`[data-id="${nextFile.id}"]`);
          el?.scrollIntoView({ block: 'nearest' });
        }
        return;
      }
      // Escape: 取消选择/关闭菜单
      if (e.key === 'Escape') {
        setContextMenu(null);
        onSelectFiles([]);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isActive, currentLevelFiles, onSelectFiles, selectedFiles, lastSelectedFile, theme, typeaheadQuery, lastActivatedFileId, displayMode, columnPaths, currentPath, navigateBack, navigateForward]);

  useEffect(() => () => {
    if (pulseTimerRef.current) window.clearTimeout(pulseTimerRef.current);
  }, []);

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

  const handleSelectFile = (file: FileItem, e?: React.MouseEvent | React.KeyboardEvent) => {
    if (e) {
      const isCmd = e.metaKey || e.ctrlKey;
      const isShift = e.shiftKey;

      if (isShift && selectedFileIds.length > 0) {
        // Range selection
        const lastId = selectedFileIds[selectedFileIds.length - 1];
        const allFiles = currentLevelFiles;
        const startIndex = allFiles.findIndex(f => f.id === lastId);
        const endIndex = allFiles.findIndex(f => f.id === file.id);
        
        if (startIndex !== -1 && endIndex !== -1) {
          const range = allFiles.slice(Math.min(startIndex, endIndex), Math.max(startIndex, endIndex) + 1).map(f => f.id);
          const newSelection = Array.from(new Set([...selectedFileIds, ...range]));
          onSelectFiles(newSelection);
        }
      } else if (isCmd) {
        // Toggle selection
        if (selectedFileIds.includes(file.id)) {
          onSelectFiles(selectedFileIds.filter(id => id !== file.id));
        } else {
          onSelectFiles([...selectedFileIds, file.id]);
        }
      } else {
        // Single selection
        onSelectFiles([file.id]);
      }
    } else {
      // Direct call (double click or simple logic)
      onSelectFiles([file.id]);
    }

    if (displayMode === 'column') {
      if (file.type === 'folder') {
        // 找到这个文件夹所在列：父目录是 currentPath（第一列）还是 columnPaths 里的某一项。
        // 之前实现错把"file.path 是否在 columnPaths"当判断，导致每次新点都清空 → 永远只有 2 列。
        const parent = file.path.substring(0, file.path.lastIndexOf('/'));
        const parentIndex = columnPaths.indexOf(parent);
        const newPaths = parentIndex >= 0
          ? columnPaths.slice(0, parentIndex + 1)
          : columnPaths;
        setColumnPaths([...newPaths, file.path]);
      }
    }
  };

  const handleContainerMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (target.closest('.file-item')) return;
    
    setContextMenu(null);
    setIsMarqueeDragging(false);

    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;

    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    setSelectionBox({ x1: x, y1: y, x2: x, y2: y });
  };

  const handleContainerMouseMove = (e: React.MouseEvent) => {
    if (!selectionBox || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
    const y = Math.max(0, Math.min(e.clientY - rect.top, rect.height));
    
    if (!isMarqueeDragging && (Math.abs(x - selectionBox.x1) > 5 || Math.abs(y - selectionBox.y1) > 5)) {
      setIsMarqueeDragging(true);
      if (!e.metaKey && !e.ctrlKey) {
        onSelectFiles([]);
      }
    }

    if (isMarqueeDragging) {
      const newBox = { ...selectionBox, x2: x, y2: y };
      setSelectionBox(newBox);

      // Calculate collisions
      const boxRect = {
        left: Math.min(newBox.x1, newBox.x2) + rect.left,
        top: Math.min(newBox.y1, newBox.y2) + rect.top,
        right: Math.max(newBox.x1, newBox.x2) + rect.left,
        bottom: Math.max(newBox.y1, newBox.y2) + rect.top,
      };

      const collidedIds: string[] = [];
      const fileElements = containerRef.current.querySelectorAll('.file-item');
      fileElements.forEach((el) => {
        const elRect = el.getBoundingClientRect();
        const isColliding = !(
          elRect.right < boxRect.left || 
          elRect.left > boxRect.right || 
          elRect.bottom < boxRect.top || 
          elRect.top > boxRect.bottom
        );
        if (isColliding) {
          collidedIds.push((el as HTMLElement).dataset.id!);
        }
      });

      if (e.metaKey || e.ctrlKey) {
        const combined = Array.from(new Set([...selectedFileIds, ...collidedIds]));
        onSelectFiles(combined);
      } else {
        onSelectFiles(collidedIds);
      }
    }
  };

  const handleContainerMouseUp = (e: React.MouseEvent) => {
    // Selection box clearing handled by global listener
  };

  const handleFileMouseDown = (e: React.MouseEvent, file: FileItem) => {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (target.closest('button, input, textarea, select, [data-no-drag]')) return;

    internalDragRef.current = {
      id: file.id,
      startX: e.clientX,
      startY: e.clientY,
      active: false,
    };
    draggedFileIdRef.current = file.id;
    setDragPreview({
      x: e.clientX,
      y: e.clientY,
      fileId: file.id,
      count: selectedFileIds.includes(file.id) ? Math.max(1, selectedFileIds.length) : 1,
      active: false,
    });
  };

  const handleExternalDrop = async (e: React.DragEvent, targetPath = currentPath) => {
    const rawFiles = Array.from(e.dataTransfer.files || []);
    const paths = rawFiles
      .map(file => (file as File & { path?: string }).path)
      .filter((path): path is string => Boolean(path));
    if (paths.length === 0) return;
    e.preventDefault();
    try {
      await Promise.all(paths.map(path => copyFile(path, targetPath)));
      refreshCurrentDir();
      showFeedback(t('messages.importedFromFinder', { count: paths.length }));
    } catch (err) {
      showFeedback(t('messages.finderImportFailed', { error: String(err) }));
    }
  };

  const getFolderIdFromDragEvent = (e: React.DragEvent) => {
    const target = e.target as HTMLElement | null;
    const item = target?.closest<HTMLElement>('.file-item');
    const id = item?.dataset.id;
    if (!id) return null;

    const file = findFileById(id);
    return file?.type === 'folder' ? id : null;
  };

  const getFolderIdFromPoint = (clientX: number, clientY: number, draggedFileId?: string) => {
    const element = document.elementFromPoint(clientX, clientY) as HTMLElement | null;
    const item = element?.closest<HTMLElement>('.file-item');
    const id = item?.dataset.id;
    if (!id || id === draggedFileId) return null;

    const file = findFileById(id);
    return file?.type === 'folder' ? id : null;
  };

  const handleSurfaceDragOver = (e: React.DragEvent) => {
    if (!isFileTransferDrag(e.dataTransfer)) return;
    void focusCurrentWindow();

    const folderId = getFolderIdFromDragEvent(e);
    if (folderId) {
      handleDragOver(e, folderId);
      return;
    }

    if (dragOverFolderId !== null) setDragOverFolderId(null);
    const types = getDragTypes(e.dataTransfer);
    e.preventDefault();
    e.dataTransfer.dropEffect = types.includes('Files') ? 'copy' : 'move';
  };

  const handleSurfaceDrop = async (e: React.DragEvent) => {
    if (!isFileTransferDrag(e.dataTransfer)) return;
    void focusCurrentWindow();

    const folderId = getFolderIdFromDragEvent(e);
    if (folderId) {
      await handleDrop(e, folderId);
      return;
    }

    const payload = await readTransferPayload(e.dataTransfer);
    if (payload?.paths.length) {
      e.preventDefault();
      await executeMoveFiles(makeFileItemsFromPaths(payload.paths), makeFolderItemFromPath(currentPath), 'abort', {
        clearDragPayloadOnSuccess: true,
      });
      return;
    }

    await handleExternalDrop(e);
  };

  const moveDraggedFiles = async (draggedFileId: string, targetFolderId: string) => {
    if (!draggedFileId || draggedFileId === targetFolderId) {
      logDragDebug(`moveAbort reason=${!draggedFileId ? 'missing-dragged-id' : 'same-target'}`);
      return;
    }

    const targetFolder = findFileById(targetFolderId);
    if (targetFolder?.type !== 'folder') {
      logDragDebug(`moveAbort reason=target-not-folder targetExists=${Boolean(targetFolder)} targetType=${targetFolder?.type ?? ''}`);
      return;
    }

    const idsToMove = selectedFileIds.includes(draggedFileId) ? selectedFileIds : [draggedFileId];
    const filesToMove = idsToMove
      .map(id => findFileById(id))
      .filter((file): file is FileItem => Boolean(file));
    logDragDebug(`moveResolve targetPath=${targetFolder.path} ids=${idsToMove.join('|')} files=${filesToMove.map(file => file.path).join('|')}`);
    if (filesToMove.length === 0) {
      logDragDebug('moveAbort reason=no-files-to-move');
      return;
    }

    if (filesToMove.some(f => targetFolder.path === f.path || targetFolder.path.startsWith(`${f.path}/`))) {
      logDragDebug('moveAbort reason=move-into-self');
      showFeedback(t('messages.cannotMoveToSelf'));
      return;
    }

    await executeMoveFiles(filesToMove, targetFolder, 'abort');
  };

  const executeMoveFiles = async (
    filesToMove: FileItem[],
    targetFolder: FileItem,
    conflictStrategy: MoveConflictStrategy,
    options: { clearClipboardOnSuccess?: boolean; clearDragPayloadOnSuccess?: boolean } = {},
  ) => {
    try {
      const result = await moveFiles(filesToMove.map(f => f.path), targetFolder.path, conflictStrategy);
      logDragDebug(`moveResult moved=${result.moved.length} failed=${result.failed.length} conflicts=${result.conflicts.length} skipped=${result.skippedSameDir} firstError=${result.failed[0]?.error ?? ''}`);

      if (result.conflicts.length > 0) {
        setMoveConflictDialog({ filesToMove, targetFolder, conflicts: result.conflicts, operation: 'move', ...options });
        return;
      }

      if (result.failed.length === 0) {
        if (options.clearClipboardOnSuccess && result.moved.length > 0) {
          await clearFileClipboard();
          setHasFileClipboard(false);
        }
        if (options.clearDragPayloadOnSuccess) {
          finishSharedFileDrag();
        }
      }

      onSelectFiles([]);
      refreshCurrentDir();

      if (result.failed.length === 0 && result.skippedSameDir === 0 && result.moved.length > 0) {
        showFeedback(t('messages.movedToFolder', { count: result.moved.length, folder: targetFolder.name }));
      } else if (result.moved.length === 0 && result.skippedSameDir > 0 && result.failed.length === 0) {
        showFeedback(t('messages.sameDirectory'));
      } else if (result.failed.length > 0 && result.moved.length === 0) {
        showFeedback(t('messages.moveFailed', { error: result.failed[0].error }));
      } else {
        showFeedback(
          t('messages.partialMove', {
            ok: result.moved.length,
            failed: result.failed.length,
            error: result.failed[0]?.error ?? '',
          })
        );
      }
    } catch (err) {
      logDragDebug(`moveError error=${String(err)}`);
      showFeedback(t('messages.moveFailed', { error: String(err) }));
    }
  };

  const executeCopyFiles = async (
    filesToCopy: FileItem[],
    targetFolder: FileItem,
    conflictStrategy: MoveConflictStrategy,
  ) => {
    try {
      const result = await copyFiles(filesToCopy.map(f => f.path), targetFolder.path, conflictStrategy);
      logDragDebug(`copyResult copied=${result.copied.length} failed=${result.failed.length} conflicts=${result.conflicts.length} firstError=${result.failed[0]?.error ?? ''}`);

      if (result.conflicts.length > 0) {
        setMoveConflictDialog({ filesToMove: filesToCopy, targetFolder, conflicts: result.conflicts, operation: 'copy' });
        return;
      }

      refreshCurrentDir();

      if (result.failed.length === 0 && result.copied.length > 0) {
        showFeedback(t('messages.pasted', { count: result.copied.length }));
      } else if (result.failed.length > 0 && result.copied.length === 0) {
        showFeedback(t('messages.operationFailed', { error: result.failed[0].error }));
      } else {
        showFeedback(
          t('messages.partialMove', {
            ok: result.copied.length,
            failed: result.failed.length,
            error: result.failed[0]?.error ?? '',
          })
        );
      }
    } catch (err) {
      logDragDebug(`copyError error=${String(err)}`);
      showFeedback(t('messages.operationFailed', { error: String(err) }));
    }
  };

  const handleMoveConflictChoice = async (strategy: MoveConflictStrategy | 'cancel') => {
    const dialog = moveConflictDialog;
    setMoveConflictDialog(null);
    if (!dialog) return;
    if (strategy === 'cancel') {
      if (dialog.clearDragPayloadOnSuccess) finishSharedFileDrag();
      return;
    }

    if (dialog.operation === 'copy') {
      await executeCopyFiles(dialog.filesToMove, dialog.targetFolder, strategy);
      return;
    }

    await executeMoveFiles(dialog.filesToMove, dialog.targetFolder, strategy, {
      clearClipboardOnSuccess: dialog.clearClipboardOnSuccess,
      clearDragPayloadOnSuccess: dialog.clearDragPayloadOnSuccess,
    });
  };

  const handleDragStart = (e: React.DragEvent, file: FileItem) => {
    draggedFileIdRef.current = file.id;
    const paths = writeDragPayload(file);
    const payload: FileTransferPayload = { paths, cut: true };
    const serialized = JSON.stringify(payload);
    e.dataTransfer.setData(INTERNAL_FILE_DRAG_MIME, serialized);
    e.dataTransfer.effectAllowed = 'move';
    setDragPreview({
      x: e.clientX,
      y: e.clientY,
      fileId: file.id,
      count: paths.length,
      active: true,
    });

    // 拖拽期间持续判定光标下窗口并 raise（让底层窗口自动上浮）
    startCursorRaiseTracking();

    logDragDebug(`dragStart id=${file.id} name=${file.name} type=${file.type} paths=${paths.join('|')}`);
  };

  const handleDragOver = (e: React.DragEvent, fileId: string) => {
    if (!isFileTransferDrag(e.dataTransfer)) return;
    void focusCurrentWindow();

    e.preventDefault();
    e.stopPropagation();
    const types = getDragTypes(e.dataTransfer);
    e.dataTransfer.dropEffect = types.includes('Files') ? 'copy' : 'move';
    if (dragOverFolderId !== fileId) {
      logDragDebug(`dragOver folderId=${fileId} dataTypes=${types.join('|')}`);
      setDragOverFolderId(fileId);
    }
  };

  const handleDragLeave = (e: React.DragEvent, fileId: string) => {
    // 只在真离开盒子时清，避免子元素 leave 触发误清
    const related = e.relatedTarget as Node | null;
    if (related && e.currentTarget.contains(related)) return;
    logDragDebug(`dragLeave folderId=${fileId}`);
    if (dragOverFolderId === fileId) setDragOverFolderId(null);
  };

  const handleDragEnd = (e: React.DragEvent) => {
    logDragDebug(`dragEnd activeId=${draggedFileIdRef.current ?? ''} screenX=${e.screenX} screenY=${e.screenY} meta=${e.metaKey} alt=${e.altKey} shift=${e.shiftKey}`);

    stopCursorRaiseTracking();

    // 松手即触发：广播屏幕坐标 + 修饰键到所有窗口。
    // 目标窗口收到后判定坐标是否落在自己范围内，落入则立刻执行 copy/move。
    const active = activeTransferRef.current;
    if (active) {
      void emit(FILE_DRAG_END_AT_EVENT, {
        transferId: active.transferId,
        screenX: e.screenX,
        screenY: e.screenY,
        metaKey: e.metaKey,
        altKey: e.altKey,
        shiftKey: e.shiftKey,
        sourceWindow: getCurrentWindow().label,
      } satisfies FileDragEndAtPayload);
    }

    draggedFileIdRef.current = null;
    setDragPreview(null);
    if (dragOverFolderId !== null) setDragOverFolderId(null);
    // 松手后立刻清理本地状态。目标窗口若接收，会反向 emit drop-accepted。
    // 给一个短暂宽限期等 drop-accepted 回来再发 END（避免目标窗口 listener 还没就绪）。
    finishSharedFileDrag(400);
  };

  const handleDrop = async (e: React.DragEvent, targetFolderId: string) => {
    if (!isFileTransferDrag(e.dataTransfer)) return;
    void focusCurrentWindow();

    e.preventDefault();
    e.stopPropagation();
    setDragOverFolderId(null);

    const payload = await readTransferPayload(e.dataTransfer);
    const fallbackDraggedId = draggedFileIdRef.current;
    logDragDebug(`drop targetFolderId=${targetFolderId} payloadPaths=${payload?.paths.join('|') ?? ''} ref=${fallbackDraggedId ?? ''} dataTypes=${Array.from(e.dataTransfer.types).join('|')}`);
    draggedFileIdRef.current = null;
    const targetFolder = findFileById(targetFolderId);
    if (!targetFolder || targetFolder.type !== 'folder') {
      finishSharedFileDrag();
      return;
    }
    if (payload?.paths.length) {
      await executeMoveFiles(makeFileItemsFromPaths(payload.paths), targetFolder, 'abort', {
        clearDragPayloadOnSuccess: true,
      });
      return;
    }
    if (getDragTypes(e.dataTransfer).includes('Files')) {
      await handleExternalDrop(e, targetFolder.path);
      return;
    }
    await moveDraggedFiles(fallbackDraggedId || '', targetFolderId);
  };

  const handleSort = (key: string) => {
    setSortConfig(current => {
      if (current?.key === key) {
        if (current.direction === 'desc') return null; // Reset sort
        return { key, direction: 'desc' };
      }
      return { key, direction: 'asc' };
    });
  };

  const handleDoubleClick = (file: FileItem) => {
    setLastActivatedFileId(file.id);
    setPulseFileId(file.id);
    if (pulseTimerRef.current) window.clearTimeout(pulseTimerRef.current);
    pulseTimerRef.current = window.setTimeout(() => setPulseFileId(null), 260);
    if (file.type === 'folder' && displayMode !== 'column') {
      navigateToPath(file.path);
    } else if (file.type !== 'folder') {
      handleOpenFile(file);
    }
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

  const getFileIcon = (type: FileItem['type'], thumbnail?: string) => {
    if (type === 'application' && thumbnail) {
      return <img src={thumbnail} alt="" className="w-full h-full object-contain drop-shadow-sm" draggable={false} />;
    }

    switch (type) {
      case 'image': return <ImageIcon className="w-5 h-5 text-icon" />;
      case 'video': return <Video className="w-5 h-5 text-secondary" />;
      case 'pdf': return <FileText className="w-5 h-5 text-red-400" />;
      case 'archive': return <Archive className="w-5 h-5 text-yellow-400" />;
      case 'folder': return <Folder className="w-5 h-5 text-icon fill-current opacity-80" />;
      case 'application': return <Archive className="w-5 h-5 text-icon" />;
      default: return <FileIcon className="w-5 h-5 text-secondary-custom" />;
    }
  };

  const getFileTypeLabel = (type: FileItem['type']) => {
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
      default: return t('explorer.file', '文件');
    }
  };

  const renderDragPreview = () => {
    if (!dragPreview?.active) return null;

    const file = findFileById(dragPreview.fileId);
    if (!file) return null;

    const targetFolder = dragOverFolderId ? findFileById(dragOverFolderId) : null;
    const label = dragPreview.count > 1
      ? t('explorer.items', { count: dragPreview.count, defaultValue: `${dragPreview.count} items` })
      : file.name;

    return (
      <motion.div
        initial={{ opacity: 0, scale: 0.94 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.94 }}
        transition={{ duration: 0.12 }}
        className="fixed z-[130] pointer-events-none flex max-w-[320px] items-center gap-3 rounded-xl border border-primary/35 bg-surface/95 px-3 py-2 shadow-2xl shadow-black/25 backdrop-blur-xl"
        style={{
          left: dragPreview.x + 14,
          top: dragPreview.y + 14,
        }}
      >
        <div className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/15">
          {getFileIcon(file.type, file.thumbnail)}
          {dragPreview.count > 1 && (
            <span className="absolute -right-2 -top-2 min-w-5 rounded-full bg-primary px-1.5 py-0.5 text-center text-[10px] font-black text-on-primary shadow-lg">
              {dragPreview.count}
            </span>
          )}
        </div>
        <div className="min-w-0">
          <div className="truncate text-[13px] font-black text-on-surface">{label}</div>
          <div className="truncate text-[11px] font-bold text-on-surface/55">
            {targetFolder?.type === 'folder' ? targetFolder.name : t('explorer.folder', '文件夹')}
          </div>
        </div>
      </motion.div>
    );
  };

  const formatFileName = (name: string) => {
    if (name.length <= 40) return name;
    const lastDotIndex = name.lastIndexOf('.');
    if (lastDotIndex === -1 || name.length - lastDotIndex > 10) {
      // No extension or extension too long
      return `${name.substring(0, 20)}...${name.substring(name.length - 15)}`;
    }
    const ext = name.substring(lastDotIndex);
    const base = name.substring(0, lastDotIndex);
    return `${base.substring(0, 25)}...${ext}`;
  };

  const renderFileItem = (file: FileItem, isColumnItem = false, sortIndex?: number) => {
    const isSelected = selectedFileIds.includes(file.id) || (isColumnItem && columnPaths.includes(file.id));
    const isPulsing = pulseFileId === file.id;
    const isDropTarget = dragOverFolderId === file.id && file.type === 'folder';
    const formattedName = formatFileName(file.name);
    const isLongName = file.name !== formattedName;
    const tags = fileTags[file.path] || file.tags || [];
    const isHiddenFile = file.name.startsWith('.');
    const fileNameClass = isHiddenFile ? 'text-on-surface/45 group-hover:text-on-surface/60' : 'text-primary-custom group-hover:text-hover-custom';
    const fileMetaClass = isHiddenFile ? 'text-on-surface/35' : 'text-primary-custom';
    const mediaNameClass = isHiddenFile ? 'text-white/55' : 'text-white';
    const mediaMetaClass = isHiddenFile ? 'text-white/45' : 'text-white/90';
    
    if (displayMode === 'list' && !isColumnItem) {
      const density = theme.listDensity || 'normal';
      
      const config = {
        relaxed: { py: 'py-4', gap: 'gap-4', icon: 'w-10 h-10', text: 'text-[15px]', subText: 'text-[12px]', scale: 'scale-100' },
        normal: { py: 'py-2', gap: 'gap-4', icon: 'w-8 h-8', text: 'text-[14px]', subText: 'text-[12px]', scale: 'scale-90' },
        compact: { py: 'py-1', gap: 'gap-3', icon: 'w-7 h-7', text: 'text-[13px]', subText: 'text-[11px]', scale: 'scale-75' },
        ultra: { py: 'py-0.5', gap: 'gap-2', icon: 'w-6 h-6', text: 'text-[12px]', subText: 'text-[10px]', scale: 'scale-60' }
      }[density];

      return (
        <motion.div
          key={file.id}
          data-id={file.id}
          draggable
          onMouseDown={(e) => handleFileMouseDown(e, file)}
          onDragStart={(e) => handleDragStart(e, file)}
          onDragOver={file.type === 'folder' ? (e) => handleDragOver(e, file.id) : undefined}
          onDragLeave={file.type === 'folder' ? (e) => handleDragLeave(e, file.id) : undefined}
          onDragEnd={handleDragEnd}
          onDrop={file.type === 'folder' ? (e) => handleDrop(e, file.id) : undefined}
          onClick={(e) => { e.stopPropagation(); handleSelectFile(file, e); }}
          onDoubleClick={() => handleDoubleClick(file)}
          title={isLongName ? file.name : undefined}
          onContextMenu={(e) => { void handleContextMenu(e, [file.id]); }}
          animate={isPulsing ? { scale: [1, 0.985, 1.01, 1] } : undefined}
          transition={isPulsing ? { duration: 0.26 } : undefined}
          className={`file-item select-none flex items-center transition-all duration-200 group border px-4 cursor-pointer
            ${config.py} ${config.gap}
            ${isPulsing ? 'ring-2 ring-primary/35' : ''}
            ${isDropTarget ? 'ring-4 ring-primary outline-none scale-[1.01] z-20' : ''}
            ${isSelected ? 'bg-selected border-custom shadow-custom rounded-xl z-10' : 'bg-panel-custom border-transparent hover:bg-hover-custom hover:border-custom shadow-sm rounded-lg'}
          `}
        >
          {showCheckboxCol && (
            <div
              className={`${LIST_COLS.checkbox} shrink-0 mr-2 flex items-center justify-center`}
              onMouseDown={e => e.stopPropagation()}
              onClick={e => e.stopPropagation()}
            >
              <input
                type="checkbox"
                checked={isSelected}
                onChange={e => {
                  const next = selectedFileIds.includes(file.id)
                    ? selectedFileIds.filter(id => id !== file.id)
                    : [...selectedFileIds, file.id];
                  onSelectFiles(next);
                }}
                className="w-3.5 h-3.5 accent-primary cursor-pointer"
              />
            </div>
          )}
          {showSortCol && (
            <div className={`${LIST_COLS.sortNum} shrink-0 text-[10px] font-black text-on-surface/25 tabular-nums pl-1`}>{sortIndex ?? ''}</div>
          )}
          <div className={`flex items-center flex-1 min-w-0 ${config.gap}`}>
            <div className={`${config.icon} rounded-lg flex items-center justify-center shrink-0 shadow-sm border border-on-surface/5 transition-colors ${isSelected ? 'bg-hover-custom' : 'bg-panel-custom'}`}>
               <div className={`w-full h-full flex items-center justify-center transition-transform ${config.scale}`}>
                 {getFileIcon(file.type, file.thumbnail)}
               </div>
            </div>
            {renamingFile?.id === file.id ? (
              <input value={renameInput} onChange={e => setRenameInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleRenameSubmit(); if (e.key === 'Escape') handleRenameCancel(); }}
                onBlur={handleRenameSubmit} autoFocus onClick={e => e.stopPropagation()}
                className={`${config.text} font-black text-on-surface bg-primary/20 border border-primary rounded-md px-2 py-0.5 outline-none min-w-0 flex-1`} />
            ) : (
            <span className={`${config.text} select-none font-black ${fileNameClass} truncate pr-4 transition-all duration-300`}>{formattedName}</span>
            )}
            {tags.length > 0 && (
              <div className="flex gap-1 shrink-0">
                {tags.slice(0, 3).map(tag => <span key={tag} className="w-2 h-2 rounded-full" style={{ backgroundColor: TAG_COLORS[tag] || '#8e8e93' }} />)}
              </div>
            )}
          </div>
          <div className={`${LIST_COLS.modified} shrink-0 pl-2 flex items-center gap-1.5 transition-all duration-300 min-w-0`}>
            <span className={`${config.subText} ${fileMetaClass} font-black truncate shrink-0`}>{file.modified}</span>
            {getRelativeTimeLabel(file.modified) && (
              <span className="text-[10px] font-medium text-on-surface/35 shrink-0">{getRelativeTimeLabel(file.modified)}</span>
            )}
          </div>
          <div className={`${LIST_COLS.size} shrink-0 ${config.subText} ${fileMetaClass} font-mono font-black pl-2 text-right tabular-nums transition-all duration-300`}>{file.size || '--'}</div>
          <div className={`${LIST_COLS.type} shrink-0 ${config.subText} ${fileMetaClass} truncate font-black tracking-tight pl-2 text-right opacity-70 transition-all duration-300`}>{getFileTypeLabel(file.type)}</div>
          <div className={`${LIST_COLS.actions} shrink-0 flex justify-end overflow-visible`}>
             <button
               onClick={(e) => openFileActionsMenu(e, file)}
               className="p-1 -mr-1 rounded opacity-0 group-hover:opacity-100 text-on-surface hover:bg-primary/20 transition-all"
               title={t('tooltips.moreActions')}
             >
                <MoreVertical className="w-4 h-4" />
             </button>
          </div>
        </motion.div>
      );
    }

    if (displayMode === 'column' || isColumnItem) {
      return (
        <motion.div
          key={file.id}
          data-id={file.id}
          draggable
          onMouseDown={(e) => handleFileMouseDown(e, file)}
          onDragStart={(e) => handleDragStart(e, file)}
          onDragOver={file.type === 'folder' ? (e) => handleDragOver(e, file.id) : undefined}
          onDragLeave={file.type === 'folder' ? (e) => handleDragLeave(e, file.id) : undefined}
          onDragEnd={handleDragEnd}
          onDrop={file.type === 'folder' ? (e) => handleDrop(e, file.id) : undefined}
          title={isLongName ? file.name : undefined}
          onClick={(e) => { e.stopPropagation(); handleSelectFile(file, e); }}
          onDoubleClick={() => handleDoubleClick(file)}
          onContextMenu={(e) => { void handleContextMenu(e, [file.id]); }}
          animate={isPulsing ? { scale: [1, 0.985, 1.01, 1] } : undefined}
          transition={isPulsing ? { duration: 0.26 } : undefined}
          className={`file-item select-none flex items-center gap-3 px-3 rounded-xl cursor-pointer transition-all duration-300 group border
            ${isPulsing ? 'ring-2 ring-primary/35' : ''}
            ${isDropTarget ? 'ring-4 ring-primary outline-none scale-[1.01] z-20' : ''}
            ${isSelected ? 'bg-selected border-custom shadow-custom' : 'bg-panel-custom border-transparent hover:bg-hover-custom hover:border-custom shadow-sm'}
          `}
          style={{
            height: `${theme.columnHeight || 60}px`,
            width: '100%',
            marginBottom: '8px'
          }}
        >
          <div className="w-10 h-10 rounded-xl flex items-center justify-center bg-panel-custom group-hover:bg-hover-custom transition-colors shrink-0 p-1">
            {getFileIcon(file.type, file.thumbnail)}
          </div>
          <div className="flex-1 min-w-0 flex flex-col justify-center">
            {renamingFile?.id === file.id ? (
              <input value={renameInput} onChange={e => setRenameInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleRenameSubmit(); if (e.key === 'Escape') handleRenameCancel(); }}
                onBlur={handleRenameSubmit} autoFocus onClick={e => e.stopPropagation()}
                className="text-[14px] font-black text-on-surface bg-primary/20 border border-primary rounded-md px-2 py-0.5 outline-none w-full" />
            ) : (
              <h3 className={`select-none text-[14px] font-black ${fileNameClass} truncate leading-tight transition-colors`}>{formattedName}</h3>
            )}
            <p className={`text-[11px] ${fileMetaClass} font-black truncate`}>{file.size && file.size !== '--' ? `${file.size} • ` : ''}{file.modified}</p>
            {tags.length > 0 && <div className="flex gap-1 mt-1">{tags.slice(0, 4).map(tag => <span key={tag} className="w-2 h-2 rounded-full" style={{ backgroundColor: TAG_COLORS[tag] || '#8e8e93' }} />)}</div>}
          </div>
          {file.type === 'folder' && (
            <ChevronRight className="w-4 h-4 text-on-surface shrink-0" />
          )}
        </motion.div>
      );
    }

    if (displayMode === 'grid') {
      const isMediaItem = Boolean(file.thumbnail) && (file.type === 'image' || file.type === 'video');
      const normalWidth = theme.gridWidth || theme.gridSize || 180;
      const normalHeight = theme.gridHeight || theme.gridSize || 180;
      const mediaWidth = theme.mediaGridLinked === false ? (theme.mediaGridWidth || normalWidth) : normalWidth;
      const mediaHeight = theme.mediaGridLinked === false ? (theme.mediaGridHeight || normalHeight) : normalHeight;
      return (
        <motion.div
          key={file.id}
          data-id={file.id}
          draggable
          onMouseDown={(e) => handleFileMouseDown(e, file)}
          onDragStart={(e) => handleDragStart(e, file)}
          onDragOver={file.type === 'folder' ? (e) => handleDragOver(e, file.id) : undefined}
          onDragLeave={file.type === 'folder' ? (e) => handleDragLeave(e, file.id) : undefined}
          onDragEnd={handleDragEnd}
          onDrop={file.type === 'folder' ? (e) => handleDrop(e, file.id) : undefined}
          title={isLongName ? file.name : undefined}
          onClick={(e) => { e.stopPropagation(); handleSelectFile(file, e); }}
          onDoubleClick={() => handleDoubleClick(file)}
          onContextMenu={(e) => { void handleContextMenu(e, [file.id]); }}
          animate={isPulsing ? { scale: [1, 0.985, 1.01, 1] } : undefined}
          transition={isPulsing ? { duration: 0.26 } : undefined}
          className={`file-item file-item-grid select-none relative rounded-2xl p-4 flex flex-col justify-between group cursor-pointer transition-[transform,background-color,border-color,box-shadow] duration-200 border
            ${isPulsing ? 'ring-2 ring-primary/35' : ''}
            ${isDropTarget ? 'ring-4 ring-primary outline-none scale-[1.01] z-20' : ''}
            ${isSelected ? 'bg-selected border-custom shadow-custom' : 'bg-panel-custom border-transparent hover:bg-hover-custom hover:border-custom shadow-sm'}
            ${isMediaItem ? 'p-0 overflow-hidden' + (!isSelected ? ' !border-none !bg-transparent' : '') : ''}
          `}
          style={{ 
            width: isMediaItem ? `${mediaWidth}px` : `${normalWidth}px`,
            height: isMediaItem ? `${mediaHeight}px` : `${normalHeight}px`
          }}
        >
          {isMediaItem && displayMode === 'grid' ? (
            <>
              {file.type === 'video' ? (
                <video src={file.thumbnail} className="absolute inset-0 w-full h-full object-cover opacity-80 group-hover:scale-105 transition-transform duration-700" muted playsInline preload="metadata" />
              ) : (
                <img src={file.thumbnail} alt={file.name} className="absolute inset-0 w-full h-full object-cover opacity-80 group-hover:scale-105 transition-transform duration-700" />
              )}
              <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent" />
              <div className="absolute bottom-0 left-0 right-0 p-4">
                <div className="flex items-center gap-2 mb-1">
                  {getFileIcon(file.type, file.thumbnail)}
                  <span className="text-[10px] font-black bg-primary text-on-primary px-1.5 py-0.5 rounded-full shadow-lg">{file.type === 'video' ? 'VIDEO' : 'IMAGE'}</span>
                </div>
                {renamingFile?.id === file.id ? (
              <input value={renameInput} onChange={e => setRenameInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleRenameSubmit(); if (e.key === 'Escape') handleRenameCancel(); }}
                onBlur={handleRenameSubmit} autoFocus onClick={e => e.stopPropagation()}
                className="text-[14px] font-black text-white bg-black/40 border border-primary rounded-md px-2 py-0.5 outline-none w-full" />
            ) : (
              <h3 className={`select-none text-[14px] font-black ${mediaNameClass} whitespace-normal break-all line-clamp-3 leading-tight drop-shadow-md`}>{formattedName}</h3>
            )}
                <p className={`text-[11px] ${mediaMetaClass} font-black mt-1 drop-shadow-sm`}>{formatFileMeta(file)}</p>
                {tags.length > 0 && <div className="flex gap-1 mt-2">{tags.slice(0, 4).map(tag => <span key={tag} className="w-2 h-2 rounded-full border border-white/40" style={{ backgroundColor: TAG_COLORS[tag] || '#8e8e93' }} />)}</div>}
              </div>
            </>
          ) : (
            <>
              <div className="flex justify-between items-start">
                <div className={`w-14 h-14 rounded-2xl flex items-center justify-center bg-panel-custom group-hover:bg-hover-custom transition-colors shrink-0 p-1`}>
                  {getFileIcon(file.type, file.thumbnail)}
                </div>
              </div>
              <div className="mt-4 flex-1">
                {renamingFile?.id === file.id ? (
                  <input value={renameInput} onChange={e => setRenameInput(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') handleRenameSubmit(); if (e.key === 'Escape') handleRenameCancel(); }}
                    onBlur={handleRenameSubmit} autoFocus onClick={e => e.stopPropagation()}
                    className="text-[13px] font-black text-on-surface bg-primary/20 border border-primary rounded-md px-2 py-0.5 outline-none w-full" />
                ) : (
                  <h3 className={`select-none text-[13px] font-black ${fileNameClass} whitespace-normal break-all line-clamp-3 transition-colors leading-snug`}>{formattedName}</h3>
                )}
                <p className={`text-[10px] ${fileMetaClass} font-black mt-1`}>{formatFileMeta(file)}</p>
                {tags.length > 0 && <div className="flex gap-1 mt-2">{tags.slice(0, 4).map(tag => <span key={tag} className="w-2 h-2 rounded-full" style={{ backgroundColor: TAG_COLORS[tag] || '#8e8e93' }} />)}</div>}
              </div>
              {displayMode !== 'column' && (
                <button
                  onClick={(e) => openFileActionsMenu(e, file)}
                  className="absolute top-2 right-2 p-1.5 rounded-lg text-on-surface/0 group-hover:text-on-surface/60 hover:text-on-surface hover:bg-primary/20 transition-all"
                  title={t('tooltips.moreActions')}
                >
                  <MoreVertical className="w-4 h-4" />
                </button>
              )}
            </>
          )}
        </motion.div>
      );
    }
  };

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

  const loadColumnFiles = (colPath: string) => {
    if (columnFilesCache[colPath]) return;
    listDirectory(colPath, theme.showHiddenFiles).then(entries => {
      setColumnFilesCache(prev => ({ ...prev, [colPath]: entries }));
    }).catch(() => {});
  };

  const getColumnFiles = (parentPath: string | undefined) => {
    if (!parentPath) return displayedFiles;
    if (columnFilesCache[parentPath]) return columnFilesCache[parentPath];
    loadColumnFiles(parentPath);
    return [];
  };

  const groupOptions: Array<{ id: GroupBy; label: string }> = [
    { id: 'none', label: t('explorer.groupNone', '不分组') },
    { id: 'name', label: t('explorer.groupName', '名称') },
    { id: 'kind', label: t('explorer.groupKind', '种类') },
    { id: 'application', label: t('explorer.groupApplication', '应用程序') },
    { id: 'lastOpened', label: t('explorer.groupLastOpened', '上次打开日期') },
    { id: 'added', label: t('explorer.groupAdded', '添加日期') },
    { id: 'modified', label: t('explorer.groupModified', '修改日期') },
    { id: 'created', label: t('explorer.groupCreated', '创建日期') },
    { id: 'size', label: t('explorer.groupSize', '大小') },
    { id: 'tags', label: t('explorer.groupTags', '标签') },
  ];

  const getDateGroup = (value?: string) => {
    if (!value) return t('explorer.groupUnknown', '未知');
    return value.split(' ')[0] || t('explorer.groupUnknown', '未知');
  };

  const getSizeGroup = (file: FileItem) => {
    const size = file.size || '';
    if (!size || size === '--') return t('explorer.groupSizeUnknown', '未知大小');

    const parsed = Number.parseFloat(size);
    if (Number.isNaN(parsed)) return t('explorer.groupSizeUnknown', '未知大小');

    if (size.includes('GB') || size.includes('TB')) {
      return t('explorer.groupSizeHuge', '超大');
    }
    if (size.includes('MB')) {
      if (parsed >= 100) return t('explorer.groupSizeLarge', '大');
      if (parsed >= 10) return t('explorer.groupSizeMedium', '中');
      return t('explorer.groupSizeSmall', '小');
    }
    if (size.includes('KB')) {
      return parsed >= 1024 ? t('explorer.groupSizeMedium', '中') : t('explorer.groupSizeSmall', '小');
    }

    return t('explorer.groupSizeSmall', '小');
  };

  const getGroupKey = (file: FileItem, mode: GroupBy) => {
    switch (mode) {
      case 'name':
        return file.name.charAt(0).toUpperCase() || t('explorer.groupUnknown', '未知');
      case 'kind':
        return getFileTypeLabel(file.type);
      case 'application':
        return file.type === 'application'
          ? t('explorer.application', '应用程序')
          : t('explorer.groupNonApplication', '非应用程序');
      case 'lastOpened':
        return getDateGroup(file.lastOpened);
      case 'added':
        return getDateGroup(file.added);
      case 'modified':
        return getDateGroup(file.modified);
      case 'created':
        return getDateGroup(file.created);
      case 'size':
        return getSizeGroup(file);
      case 'tags':
        return file.tags?.[0] ? getTagLabel(file.tags[0]) : t('explorer.groupNoTags', '无标签');
      case 'none':
      default:
        return t('explorer.groupAllFiles', '全部项目');
    }
  };

  const formatFileMeta = (file: FileItem) => {
    if (file.type === 'folder' && typeof file.childCount === 'number') {
      return t('explorer.folderItemsCount', { count: file.childCount, defaultValue: `${file.childCount} 个项目` });
    }
    const parts = [file.size && file.size !== '--' ? file.size : '', file.modified].filter(Boolean);
    return parts.length > 0 ? parts.join(' • ') : '--';
  };

  const groupedFiles = useMemo<{ [key: string]: FileItem[] }>(() => {
    if (groupBy === 'none') {
      return { [t('explorer.groupAllFiles', '全部项目')]: currentLevelFiles };
    }

    const groups: { [key: string]: FileItem[] } = {};
    currentLevelFiles.forEach(file => {
      const key = getGroupKey(file, groupBy);
      if (!groups[key]) groups[key] = [];
      groups[key].push(file);
    });

    return groups;
  }, [currentLevelFiles, groupBy, t]);

  // Load text preview for text/code/md files
  useEffect(() => {
    const f = lastSelectedFile;
    let cancelled = false;
    setImagePreviewFailed(false);
    setPdfPreviewFailed(false);
    if (f && (f.type === 'text' || f.type === 'code')) {
      setTextPreviewLoading(true);
      invoke<string>('read_text_preview', { path: f.path })
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
    return currentPath.split('/').filter(Boolean);
  }, [currentPath]);

  const currentDisplayTitle = isVirtualRoot
    ? virtualRootLabel
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

  // ── File Operation Handlers ──

  // Context menu helper — respects system menu preference
  const openSystemContextMenu = async (targetFiles: FileItem[], isBlank = false, position?: { x: number; y: number }) => {
    await focusCurrentWindow();
    const currentWindow = getCurrentWindow();
    const primary = targetFiles[0] ?? null;
    const items: Array<
      | Awaited<ReturnType<typeof MenuItem.new>>
      | Awaited<ReturnType<typeof PredefinedMenuItem.new>>
      | Awaited<ReturnType<typeof Submenu.new>>
    > = [];

    const addSeparator = async () => {
      items.push(await PredefinedMenuItem.new({ item: 'Separator' }));
    };

    if (isBlank || !primary) {
      // 第1分组: 新建文件夹 + 新建文件
      items.push(await MenuItem.new({
        text: t('explorer.newFolder', '新建文件夹'),
        action: () => { void handleNewFolder(); },
      }));
      items.push(await MenuItem.new({
        text: t('explorer.newFile', '新建文件'),
        action: () => { void handleNewFile(); },
      }));
      await addSeparator();
      // 第2分组: 刷新 + 排序
      items.push(await MenuItem.new({
        text: t('explorer.refresh', '刷新'),
        action: () => { void refreshCurrentDir(true); },
      }));
      items.push(await MenuItem.new({
        text: t('explorer.sortByName', '按名称排序'),
        action: () => { void handleSort('name'); },
      }));
      await addSeparator();
      // 第3分组: 查看简介 + 粘贴
      items.push(await MenuItem.new({
        text: t('explorer.getInfo', '查看简介'),
        action: () => { void handleShowInspector(true); },
      }));
      const clipboardPayload = await refreshFileClipboardState();
      const canPaste = Boolean(clipboardPayload?.paths.length);
      items.push(await MenuItem.new({
        text: t('explorer.paste', '粘贴'),
        enabled: canPaste,
        action: () => { void handlePasteFromClipboard(); },
      }));
      // 第4分组: 设为首页
      await addSeparator();
      const isAlreadyHome = currentPath === (theme.defaultHomePath || FAVORITES_VIRTUAL_PATH);
      items.push(await MenuItem.new({
        text: isAlreadyHome
          ? t('explorer.alreadyHome', '已是首页')
          : t('explorer.setAsHome', '设为首页'),
        enabled: !isAlreadyHome && !!currentPath,
        action: () => { handleSetCurrentAsHome(); },
      }));
      await addSeparator();
      items.push(await MenuItem.new({
        text: 'AI 文件助手',
        action: () => { setShowAIRename(true); },
      }));
      items.push(await MenuItem.new({
        text: 'AI 操作历史',
        action: () => { setShowAIHistory(true); },
      }));
    } else {
      // 第1分组: 打开 + 重命名
      items.push(await MenuItem.new({
        text: t('explorer.open', '打开'),
        action: () => { void handleOpenFile(primary); },
      }));
      items.push(await Submenu.new({
        text: t('explorer.openWith', '打开方式'),
        items: await Promise.all([
          ...OPEN_WITH_APPS.map(appName => MenuItem.new({
            text: appName,
            action: () => { void handleOpenWith(primary, appName); },
          })),
          MenuItem.new({
            text: t('explorer.openWithOther', '其它…'),
            action: () => { void handleOpenWithOther(primary); },
          }),
        ]),
      }));
      items.push(await MenuItem.new({
        text: t('explorer.rename', '重命名'),
        action: () => { void handleRenameStart(primary); },
      }));
      items.push(await MenuItem.new({
        text: 'AI 文件助手',
        action: () => { setShowAIRename(true); },
      }));
      await addSeparator();
      // 第2分组: 复制 + 剪切 + 制作替身
      items.push(await MenuItem.new({
        text: t('explorer.copy', '复制'),
        action: () => { void handleCopyToClipboard(getActionFiles(primary)); },
      }));
      items.push(await MenuItem.new({
        text: t('explorer.cut', '剪切'),
        action: () => { void handleCutToClipboard(getActionFiles(primary)); },
      }));
      items.push(await MenuItem.new({
        text: '制作替身',
        action: () => { void handleAlias(primary); },
      }));
      await addSeparator();
      // 第3分组: 解压/压缩 + 在终端打开 + 查看简介
      if (primary.type === 'archive') {
        items.push(await MenuItem.new({
          text: '解压',
          action: () => { void handleDecompress(primary); },
        }));
      }
      items.push(await MenuItem.new({
        text: '压缩',
        action: () => { void handleCompress(primary); },
      }));
      items.push(await MenuItem.new({
        text: '在终端打开',
        action: () => { void handleOpenTerminal(primary); },
      }));
      items.push(await MenuItem.new({
        text: t('explorer.getInfo', '查看简介'),
        action: () => { void handleShowInspector(); },
      }));
      items.push(await MenuItem.new({
        text: t('explorer.copyName', '复制文件名'),
        action: () => { void handleCopyNames(getActionFiles(primary)); },
      }));
      items.push(await MenuItem.new({
        text: areAllFavorites(getActionFiles(primary))
          ? t('explorer.removeFavorite', '取消收藏')
          : t('explorer.addFavorite', '收藏'),
        action: () => { void handleToggleFavoriteForItems(getActionFiles(primary)); },
      }));
      items.push(await Submenu.new({
        text: t('explorer.colorTag', '颜色标签'),
        items: await Promise.all(Object.keys(TAG_COLORS).map(tag => MenuItem.new({
          text: `${areAllTagged(getActionFiles(primary), tag) ? '✓ ' : ''}${getTagLabel(tag)}`,
          action: () => { void toggleTagForItems(tag, getActionFiles(primary)); },
        }))),
      }));
      await addSeparator();
      // 第4分组: Quick Look + Finder 中显示 + 复制路径
      items.push(await MenuItem.new({
        text: t('explorer.quickLook', 'Quick Look'),
        action: () => { void handleQuickLook(primary); },
      }));
      items.push(await MenuItem.new({
        text: t('explorer.revealInFinder', '在 Finder 中显示'),
        action: () => { void handleRevealInFinder(primary); },
      }));
      items.push(await MenuItem.new({
        text: t('explorer.copyPath', '复制路径'),
        action: () => { void handleCopyPaths(getActionFiles(primary)); },
      }));
      await addSeparator();
      // 第5分组: 删除
      items.push(await MenuItem.new({
        text: t('explorer.moveToTrash', '移至废纸篓'),
        action: () => { void handleDeleteFile(primary); },
      }));
      // 第6分组: 扩展功能
      if (enabledContextExtensions.length > 0) {
        await addSeparator();
        for (const ext of enabledContextExtensions) {
          items.push(await MenuItem.new({
            text: ext.label,
            action: () => { void handleExtensionAction(ext.id, primary); },
          }));
        }
      }
    }

    const menu = await Menu.new({ items });
    await menu.popup(theme.useSystemContextMenu ? undefined : (position ? new PhysicalPosition(position.x, position.y) : undefined), currentWindow);
  };

  const handleContextMenu = async (e: React.MouseEvent, fileIds: string[], isBlank = false) => {
    e.preventDefault();
    e.stopPropagation();
    await focusCurrentWindow();
    const newSelection = isBlank ? selectedFileIds : (selectedFileIds.includes(fileIds[0]) ? selectedFileIds : fileIds);
    if (!isBlank && !selectedFileIds.includes(fileIds[0])) onSelectFiles(newSelection);

    if (theme.useSystemContextMenu) {
      const targetFiles = newSelection
        .map(id => findFileById(id))
        .filter((file): file is FileItem => Boolean(file));
      await openSystemContextMenu(targetFiles, isBlank, { x: e.clientX, y: e.clientY });
      return;
    }

    if (isBlank) void refreshFileClipboardState();
    setContextSubmenu(null);
    setContextMenu({ x: e.clientX, y: e.clientY, fileIds: newSelection, isBlank });
  };

  const openFileActionsMenu = async (e: React.MouseEvent, file: FileItem) => {
    e.preventDefault();
    e.stopPropagation();
    await focusCurrentWindow();

    if (theme.useSystemContextMenu) {
      if (!selectedFileIds.includes(file.id)) onSelectFiles([file.id]);
      await openSystemContextMenu([file], false, { x: e.clientX, y: e.clientY });
      return;
    }

    setContextSubmenu(null);
    setContextMenu({ x: e.clientX, y: e.clientY, fileIds: [file.id] });
  };

  const refreshCurrentDir = async (fullRefresh = false) => {
    const requestId = ++loadRequestSeqRef.current;
    if (fullRefresh) {
      setLoading(true);
      resetTabTransientState();
    }
    try {
      if (isFavoritesRoot) {
        const entries = await resolveFavoriteItems(favorites);
        if (requestId !== loadRequestSeqRef.current) return [] as FileItem[];
        setFavoriteFiles(entries);
        if (fullRefresh) {
          setLoading(false);
          showFeedback(t('messages.refreshed'));
        }
        return entries;
      }
      if (isRecentRoot) {
        const entries = await resolveFavoriteItems(recentItems);
        if (requestId !== loadRequestSeqRef.current) return [] as FileItem[];
        setRecentFiles(entries);
        if (fullRefresh) {
          setLoading(false);
          showFeedback(t('messages.refreshed'));
        }
        return entries;
      }
      if (isTagRoot) {
        const entries = await resolveTaggedItems(baseView, fileTags);
        if (requestId !== loadRequestSeqRef.current) return [] as FileItem[];
        setTaggedFiles(entries);
        if (fullRefresh) {
          setLoading(false);
          showFeedback(t('messages.refreshed'));
        }
        return entries;
      }
      const entries = await listDirectory(currentPath, theme.showHiddenFiles);
      if (requestId !== loadRequestSeqRef.current) return [] as FileItem[];
      setFiles(entries);
      if (fullRefresh) {
        setLoading(false);
        showFeedback(t('messages.refreshed'));
      }
      return entries;
    } catch {
      if (fullRefresh) setLoading(false);
      return [] as FileItem[];
    }
  };

  const handleOpenFile = (file: FileItem) => {
    onRecordRecent(file.path);
    if (file.type === 'folder') {
      navigateToPath(file.path);
    } else {
      invoke('open_path', { path: file.path }).catch(err => console.error('打开失败:', err));
    }
    setContextMenu(null);
    setContextSubmenu(null);
  };

  const handleOpenWith = async (file: FileItem, appName: string) => {
    try {
      await invoke('open_with', { path: file.path, appName });
      onRecordRecent(file.path);
    } catch (err) {
      showFeedback(t('messages.openWithFailed', { error: String(err) }));
    }
    setContextMenu(null);
    setContextSubmenu(null);
  };

  const handleOpenWithOther = async (file: FileItem) => {
    const selected = await openDialog({ multiple: false, directory: false, defaultPath: '/Applications' });
    if (!selected || typeof selected !== 'string') return;
    try {
      await invoke('open_with', { path: file.path, appName: selected });
      onRecordRecent(file.path);
    } catch (err) {
      showFeedback(t('messages.openWithFailed', { error: String(err) }));
    }
    setContextMenu(null);
    setContextSubmenu(null);
  };

  const getActionFiles = (file?: FileItem) => {
    if (file && selectedFileIds.includes(file.id) && selectedFiles.length > 0) return selectedFiles;
    return file ? [file] : selectedFiles;
  };

  const handleCopyPaths = async (items = selectedFiles) => {
    if (items.length === 0) return;
    await navigator.clipboard.writeText(items.map(f => f.path).join('\n'));
    showFeedback(t('messages.pathCopied', { count: items.length }));
    setContextMenu(null);
  };

  const handleCopyNames = async (items = selectedFiles) => {
    if (items.length === 0) return;
    await navigator.clipboard.writeText(items.map(f => f.name).join('\n'));
    showFeedback(t('messages.nameCopied', { count: items.length }));
    setContextMenu(null);
  };

  const areAllFavorites = (items: FileItem[]) => (
    items.length > 0 && items.every(item => favorites.includes(item.path))
  );

  const handleToggleFavoriteForItems = (items: FileItem[] = selectedFiles) => {
    if (items.length === 0) return;
    const uniqueItems = Array.from(new Map<string, FileItem>(items.map(item => [item.path, item])).values());
    const shouldRemove = areAllFavorites(uniqueItems);
    const changedItems = uniqueItems.filter(item => (
      shouldRemove ? favorites.includes(item.path) : !favorites.includes(item.path)
    ));

    changedItems.forEach(item => onToggleFavorite(item.path));
    if (changedItems.length > 0) {
      showFeedback(t(shouldRemove ? 'messages.favoriteRemoved' : 'messages.favoriteAdded', { count: changedItems.length }));
    }
    setContextMenu(null);
  };

  const handleQuickLook = async (file = lastSelectedFile) => {
    if (!file) return;
    try {
      await invoke('quick_look', { path: file.path });
    } catch (err) {
      showFeedback(t('messages.quickLookFailed', { error: String(err) }));
    }
  };

  const handleRevealInFinder = async (file = lastSelectedFile) => {
    if (!file) return;
    try {
      await invoke('reveal_in_finder', { path: file.path });
    } catch (err) {
      showFeedback(t('messages.finderFailed', { error: String(err) }));
    }
    setContextMenu(null);
  };

  const handleOpenTerminal = async (file?: FileItem | null) => {
    const target = file || lastSelectedFile;
    const path = target?.path || currentPath || homeDir;
    if (!path) return;
    try {
      // 合并启动脚本：terminalScripts 优先，否则用 terminalArgs
      const scriptLines = (theme.terminalScripts || []).filter(s => s.enabled && s.script.trim()).map(s => s.script.trim());
      await invoke('open_terminal_at', {
        path,
        terminalApp: theme.terminalApp || 'Terminal',
        args: theme.terminalArgs || '',
        scripts: scriptLines.length > 0 ? scriptLines : undefined,
        customCommand: theme.customTerminalCommand || '',
      });
      showFeedback(t('messages.terminalOpened', { app: theme.terminalApp || 'Terminal' }));
    } catch (err) {
      showFeedback(t('messages.terminalFailed', { error: String(err) }));
    }
    setContextMenu(null);
  };

  const getItemDirectory = (file: FileItem) => file.type === 'folder' ? file.path : file.path.split('/').slice(0, -1).join('/') || '/';

  const interpolateActionTemplate = (template: string, file: FileItem) => template
    .replaceAll('{path}', file.path)
    .replaceAll('{dir}', getItemDirectory(file))
    .replaceAll('{name}', file.name)
    .replaceAll('{currentPath}', currentPath);

  const getExtensionIcon = (extension: ContextMenuAction) => {
    switch (extension.actionType) {
      case 'terminal':
        return <Terminal className="w-4 h-4" />;
      case 'shell':
        return <Code2 className="w-4 h-4" />;
      case 'url':
        return <ExternalLink className="w-4 h-4" />;
      case 'placeholder':
        return <Sparkles className="w-4 h-4 text-icon" />;
      default:
        return <Puzzle className="w-4 h-4" />;
    }
  };

  const handleRenameStart = (file: FileItem) => {
    setRenamingFile(file);
    setRenameInput(file.name);
    setContextMenu(null);
  };

  const handleRenameSubmit = async () => {
    if (!renamingFile || !renameInput.trim() || renameInput === renamingFile.name) {
      setRenamingFile(null);
      return;
    }
    try {
      await renameFile(renamingFile.path, renameInput.trim());
      refreshCurrentDir();
    } catch (e) { console.error('重命名失败:', e); }
    setRenamingFile(null);
  };

  const handleRenameCancel = () => {
    setRenamingFile(null);
  };

  const handleDeleteFile = async (file: FileItem) => {
    const targets = getActionFiles(file);
    const ok = await confirm(t('dialogs.moveToTrash', { count: targets.length }));
    if (ok) {
      try {
        await Promise.all(targets.map(item => deleteToTrash(item.path)));
        refreshCurrentDir();
        onSelectFiles([]);
        showFeedback(t('messages.movedToTrash', { count: targets.length }));
      } catch (e) { showFeedback(`移至废纸篓失败：${String(e)}`); }
    }
    setContextMenu(null);
  };

  const handleCopyFile = async (file: FileItem) => {
    setContextMenu(null);
    setActiveDropdown('copy-move');
    const targets = getActionFiles(file);
    let targetDir: string | null = null;
    try {
      const selected = await openDialog({
        multiple: false,
        directory: true,
        defaultPath: currentPath || undefined,
        title: t('dialogs.copyToTitle', { defaultValue: '选择复制目标' }),
      });
      targetDir = typeof selected === 'string' ? selected : null;
    } catch { /* user cancelled */ }
    setActiveDropdown(null);
    if (targetDir) {
      try {
        await executeCopyFiles(targets, makeFolderItemFromPath(targetDir), 'abort');
      } catch (e) { showFeedback(`复制失败：${String(e)}`); }
    }
  };

  const handleMoveFile = async (file: FileItem) => {
    const targets = getActionFiles(file);
    let targetDir: string | null = null;
    try {
      const selected = await openDialog({
        multiple: false,
        directory: true,
        defaultPath: currentPath || undefined,
        title: t('dialogs.moveToTitle', { defaultValue: '选择移动目标' }),
      });
      targetDir = typeof selected === 'string' ? selected : null;
    } catch { /* user cancelled */ }
    if (targetDir) {
      try {
        await executeMoveFiles(targets, makeFolderItemFromPath(targetDir), 'abort');
      } catch (e) { showFeedback(`移动失败：${String(e)}`); }
    }
    setContextMenu(null);
  };

  const handleNewFile = async () => {
    const baseName = '新建文件.txt';
    const existing = new Set(files.map(file => file.name));
    let name = baseName;
    let index = 2;
    while (existing.has(name)) {
      name = `新建文件 ${index}.txt`;
      index += 1;
    }

    try {
      const createdPath = await createFile(currentPath, name);
      const entries = await refreshCurrentDir();
      const created = entries.find(file => file.path === createdPath);
      if (created) {
        onSelectFiles([created.id]);
        setRenamingFile(created);
        setRenameInput(created.name);
      }
      showFeedback(`已创建文件：${name}`);
    } catch (e) {
      showFeedback(`创建文件失败：${String(e)}`);
    }
    setContextMenu(null);
  };

  // 把当前正在浏览的目录设为应用启动时的首页（避免用户走"选择目录"对话框的繁琐流程）。
  // 虚拟根目录（收藏 / 最近 / 标签）也支持作为首页。
  const handleSetCurrentAsHome = () => {
    if (!currentPath) return;
    onThemeChange({ ...theme, defaultHomePath: currentPath });
    showFeedback(t('messages.setAsHome', {
      defaultValue: '已将当前位置设为首页',
    }));
    setContextMenu(null);
  };

  const handleNewFolder = async () => {
    const baseName = '新建文件夹';
    const existing = new Set(files.map(file => file.name));
    let name = baseName;
    let index = 2;
    while (existing.has(name)) {
      name = `新建文件夹 ${index}`;
      index += 1;
    }

    try {
      const createdPath = await createFolder(currentPath, name);
      const entries = await refreshCurrentDir();
      const created = entries.find(file => file.path === createdPath);
      if (created) {
        onSelectFiles([created.id]);
        setRenamingFile(created);
        setRenameInput(created.name);
      }
      showFeedback(`已创建文件夹：${name}`);
    } catch (e) {
      showFeedback(`创建文件夹失败：${String(e)}`);
    }
    setContextMenu(null);
  };

  const handleCompress = async (file: FileItem) => {
    const targets = getActionFiles(file);
    const defaultName = targets.length === 1 ? `${targets[0].name}.zip` : `Aether Selection ${new Date().toISOString().slice(0, 10)}.zip`;
    let output = `${currentPath}/${defaultName}`;
    const exists = files.some(f => f.name === defaultName);
    if (exists) {
      const msg = t('dialogs.fileExists', { name: defaultName }) + '\n' + t('dialogs.replaceOrRename');
      const action = await confirm(msg);
      if (!action) {
        let counter = 1;
        const base = defaultName.replace(/\.zip$/, '');
        while (files.some(f => f.name === `${base} (${counter}).zip`)) counter++;
        output = `${currentPath}/${base} (${counter}).zip`;
      }
    }
    try {
      await compressFiles(targets.map(item => item.path), output);
      refreshCurrentDir();
      showFeedback(`已压缩 ${targets.length} 个项目`);
    } catch (e) { showFeedback(`压缩失败：${String(e)}`); }
    setContextMenu(null);
  };

  const handleDecompress = async (file: FileItem) => {
    const baseName = file.name.replace(/\.[^.]+$/, '');
    let outputDir = `${currentPath}/${baseName}`;
    const exists = files.some(f => f.name === baseName && f.type === 'folder');
    if (exists) {
      const msg = t('dialogs.fileExists', { name: baseName }) + '\n' + t('dialogs.overwriteOrRename');
      const action = await confirm(msg);
      if (!action) {
        let counter = 1;
        while (files.some(f => f.name === `${baseName} (${counter})`)) counter++;
        outputDir = `${currentPath}/${baseName} (${counter})`;
      }
    }
    try {
      await decompressFile(file.path, outputDir);
      refreshCurrentDir();
      showFeedback(`已解压：${file.name}`);
    } catch (e) { showFeedback(`解压失败：${String(e)}`); }
    setContextMenu(null);
  };

  const handleAlias = async (file: FileItem) => {
    try {
      await makeAlias(file.path);
      refreshCurrentDir();
      showFeedback(`已创建替身：${file.name}`);
    } catch (e) { showFeedback(`创建替身失败：${String(e)}`); }
    setContextMenu(null);
  };

  const handleExtensionAction = async (id: string, file: FileItem) => {
    const extension = (theme.contextMenuExtensions || []).find(ext => ext.id === id);
    if (!extension) {
      showFeedback(`扩展「${id}」不存在或已被移除。`);
      setContextMenu(null);
      return;
    }

    const actionType = extension.actionType || 'placeholder';
    const workingPath = extension.workingDirectory === 'current' ? currentPath : file.path;

    try {
      if (extension.confirmExecution !== false) {
        const ok = await confirm(t('dialogs.executeAction', { label: extension.label }), { title: t('dialogs.executeActionTitle'), kind: 'warning' });
        if (!ok) {
          setContextMenu(null);
          return;
        }
      }
      if (actionType === 'terminal') {
        await invoke('open_terminal_at', {
          path: workingPath,
          terminalApp: extension.terminalApp || theme.terminalApp || 'Terminal',
          args: interpolateActionTemplate(extension.terminalArgs || '', file),
          customCommand: '',
        });
        showFeedback(`已执行扩展：${extension.label}`);
      } else if (actionType === 'shell') {
        const command = interpolateActionTemplate(extension.command || '', file).trim();
        if (!command) {
          showFeedback(`扩展「${extension.label}」未配置命令。`);
        } else {
          await invoke('open_terminal_at', {
            path: workingPath,
            terminalApp: extension.terminalApp || theme.terminalApp || 'Terminal',
            args: '',
            customCommand: command,
          });
          showFeedback(`已在终端执行：${extension.label}`);
        }
      } else if (actionType === 'url') {
        const url = interpolateActionTemplate(extension.urlTemplate || '', file).trim();
        if (!url) {
          showFeedback(`扩展「${extension.label}」未配置 URL。`);
        } else {
          try {
            await safeShellOpen(url);
            showFeedback(`已打开链接：${extension.label}`);
          } catch (err) {
            showFeedback(`扩展「${extension.label}」链接不安全：${String(err)}`);
          }
        }
      } else if (actionType === 'ai-assistant') {
        setContextMenu(null);
        setShowAIRename(true);
        return;
      } else if (actionType === 'ai-history') {
        setContextMenu(null);
        setShowAIHistory(true);
        return;
      } else {
        showFeedback(`扩展「${extension.label}」已预留，等待插件接入。`);
      }
    } catch (err) {
      showFeedback(`扩展执行失败：${String(err)}`);
    }
    setContextMenu(null);
  };

  const handleImportFiles = async () => {
    try {
      const selected = await openDialog({ multiple: true, directory: false });
      const paths = Array.isArray(selected) ? selected : selected ? [selected] : [];
      if (paths.length === 0) return;
      await Promise.all(paths.map(path => copyFile(path, currentPath)));
      refreshCurrentDir();
      showFeedback(`已导入 ${paths.length} 个文件`);
    } catch (e) {
      showFeedback(`导入失败：${String(e)}`);
    }
    setActiveDropdown(null);
  };

  const activeTagsForLastFile = lastSelectedFile ? (fileTags[lastSelectedFile.path] || lastSelectedFile.tags || []) : [];

  const openCurrentInNewTab = (file?: FileItem | null) => {
    if (!onOpenTab) return;
    const targetPath = file
      ? (file.type === 'folder' ? file.path : getItemDirectory(file))
      : currentPath;
    if (!targetPath) return;
    const label = targetPath.split('/').filter(Boolean).pop() || t('explorer.localStorage', '本地存储');
    onOpenTab(`tab-${Date.now()}`, 'tabs.volume', { label, initialPath: targetPath });
    setActiveDropdown(null);
  };

  const allColumns = displayMode === 'column'
    ? [undefined, ...columnPaths]
    : [];

  return (
      <div className="h-full flex overflow-hidden">
      <div className="flex-1 flex flex-col overflow-hidden" onClick={() => { 
        if (!isMarqueeDragging) {
           setContextMenu(null); 
           onSelectFiles([]); 
         }
      }} onContextMenu={(e) => {
        if (e.target === e.currentTarget || (e.target as HTMLElement).closest('[data-explorer-surface]')) {
           e.preventDefault();
           setContextMenu({ x: e.clientX, y: e.clientY, fileIds: [], isBlank: true });
        }
      }}>
        <div className="flex-1 overflow-hidden px-8 py-4 min-h-0">
          <div className={`${displayMode === 'column' ? 'w-full h-full' : 'max-w-7xl mx-auto w-full'} h-full min-h-0 flex flex-col space-y-4`}>
            
            {/* Breadcrumbs & Search Area */}
            <div className="flex items-center justify-between gap-3 shrink-0">
              <div className="flex items-center gap-1 mr-1">
                <button
                  onClick={navigateBack}
                  disabled={backStack.length === 0}
                  className={`p-1.5 rounded-lg transition-colors ${backStack.length > 0 ? 'hover:bg-hover-custom text-on-surface/50 hover:text-on-surface' : 'text-on-surface/20 cursor-not-allowed'}`}
                  title={t('tooltips.back')}
                >
                  <ChevronLeft className="w-5 h-5" />
                </button>
                <button
                  onClick={navigateForward}
                  disabled={forwardStack.length === 0}
                  className={`p-1.5 rounded-lg transition-colors ${forwardStack.length > 0 ? 'hover:bg-hover-custom text-on-surface/50 hover:text-on-surface' : 'text-on-surface/20 cursor-not-allowed'}`}
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
                      <span className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: TAG_COLORS[baseView] || '#8e8e93' }} />
                    )}
                    <span className="truncate font-bold">{virtualRootLabel}</span>
                  </div>
                ) : isEditingPath ? (
                  <input 
                    type="text" 
                    value={pathInput}
                    onChange={(e) => setPathInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        navigateToPath(pathInput);
                        setIsEditingPath(false);
                      }
                      if (e.key === 'Escape') {
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

                    {/* Home root */}
                    <button
                      onClick={() => { setCurrentPath(homeDir); setSearchQuery(''); }}
                      className="shrink-0 hover:text-primary hover:underline transition-colors cursor-pointer"
                    >
                      {homeDir ? homeDir.split('/').pop() : t('explorer.localStorage')}
                    </button>

                    {pathSegments.filter(s => s !== 'Users' && s !== homeDir?.split('/').pop()).map((seg, i) => {
                      const segIdx = pathSegments.indexOf(seg);
                      const segPath = '/' + pathSegments.slice(0, segIdx + 1).join('/');
                      return (
                        <React.Fragment key={segPath}>
                          <ChevronRight className="w-3.5 h-3.5 shrink-0 text-on-surface/30" />
                          <button
                            onClick={() => navigateToPath(segPath)}
                            className={`shrink-0 hover:text-primary hover:underline transition-colors cursor-pointer ${segPath === currentPath ? 'font-bold text-on-surface cursor-default hover:no-underline' : ''}`}
                            disabled={segPath === currentPath}
                          >
                            {seg}
                          </button>
                        </React.Fragment>
                      );
                    })}
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

              {/* Local Search */}
              <div className="w-56 relative shrink-0 group">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-on-surface/40 group-hover:text-icon transition-colors" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder={t('topbar.searchPlaceholder') || "搜索文件..."}
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
                        ${folder.color === 'primary' ? 'bg-primary/20 text-primary' : 
                          folder.color === 'secondary' ? 'bg-secondary/20 text-secondary' : 'bg-tertiary/20 text-tertiary'}
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
                  
                  {/* Action Capsule */}
          <div className="flex items-center bg-panel-custom p-1 rounded-xl border border-transparent mr-2 relative" ref={dropdownRef} onMouseDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
                    <button
                      onClick={() => setActiveDropdown(activeDropdown === 'upload' ? null : 'upload')}
                      className={`p-1.5 hover:bg-hover-custom rounded-lg hover:text-on-surface transition-all active:scale-95 ${activeDropdown === 'upload' ? 'bg-hover-custom text-icon' : 'text-on-surface/60'}`}
                      title={t('tooltips.import')}
                    >
                      <Upload className="w-4 h-4" />
                    </button>
                    <button
                      onClick={onStartTransfer}
                      className="p-1.5 hover:bg-hover-custom rounded-lg hover:text-on-surface transition-all active:scale-95 text-on-surface/60"
                      title={t('tooltips.transferManager')}
                    >
                      <ExternalLink className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => handleOpenTerminal(lastSelectedFile)}
                      className="p-1.5 hover:bg-hover-custom rounded-lg hover:text-on-surface transition-all active:scale-95 text-on-surface/60"
                      title={t('tooltips.openInTerminal')}
                    >
                      <Terminal className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => setActiveDropdown(activeDropdown === 'tag' ? null : 'tag')}
                      className={`p-1.5 hover:bg-hover-custom rounded-lg hover:text-on-surface transition-all active:scale-95 ${activeDropdown === 'tag' ? 'bg-hover-custom text-icon' : 'text-on-surface/60'}`}
                      title={t('tooltips.tags')}
                    >
                      <Tag className="w-4 h-4" />
                    </button>
                    <button 
                      onClick={() => setActiveDropdown(activeDropdown === 'group' ? null : 'group')}
                      className={`p-1.5 hover:bg-primary/10 rounded-lg hover:text-on-surface transition-all active:scale-95 ${activeDropdown === 'group' ? 'bg-primary/20 text-primary' : 'text-on-surface/60'}`}
                      title={t('explorer.groupBy', '分组')}
                    >
                      <Layers3 className="w-4 h-4" />
                    </button>
                    <button 
                      onClick={() => onThemeChange({ ...theme, showPreviewPanel: !theme.showPreviewPanel })}
                      className={`p-1.5 hover:bg-primary/10 rounded-lg hover:text-on-surface transition-all active:scale-95 ${theme.showPreviewPanel ? 'bg-primary/20 text-primary' : 'text-on-surface/60'}`}
                      title={theme.showPreviewPanel ? t('tooltips.hideInspector', '隐藏简介') : t('tooltips.showInspector', '显示简介')}
                    >
                      {theme.showPreviewPanel ? <PanelRightClose className="w-4 h-4" /> : <PanelRight className="w-4 h-4" />}
                    </button>
                    <button 
                      onClick={() => onThemeChange({ ...theme, showHiddenFiles: !theme.showHiddenFiles })}
                      className={`p-1.5 hover:bg-primary/10 rounded-lg hover:text-on-surface transition-all active:scale-95 ${theme.showHiddenFiles ? 'bg-primary/20 text-primary' : 'text-on-surface/60'}`}
                      title={theme.showHiddenFiles ? t('tooltips.hideHiddenFiles', '隐藏隐藏文件') : t('tooltips.showHiddenFiles', '显示隐藏文件')}
                    >
                      {theme.showHiddenFiles ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                    <button
                      onClick={() => refreshCurrentDir(true)}
                      className="p-1.5 hover:bg-primary/10 rounded-lg hover:text-on-surface transition-all active:scale-95 text-on-surface/60"
                      title={t('tooltips.refresh')}
                    >
                      <RefreshCw className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => setActiveDropdown(activeDropdown === 'more' ? null : 'more')}
                      className={`p-1.5 hover:bg-primary/10 rounded-lg hover:text-on-surface transition-all active:scale-95 ${activeDropdown === 'more' ? 'bg-primary/20 text-primary' : 'text-on-surface/60'}`}
                    >
                      <MoreHorizontal className="w-4 h-4" />
                    </button>

                    {/* Simple Dropdown Placeholders */}
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
                                  await Promise.all(paths.map(path => copyFile(path, currentPath)));
                                  refreshCurrentDir();
                                  showFeedback(`已导入 ${paths.length} 个文件夹`);
                                }
                                setActiveDropdown(null);
                              }} className="w-full text-left px-3 py-1.5 rounded-lg hover:bg-primary/20 text-[13px]">{t('transfer.uploadFolder', 'Upload Folder')}</button>
                            </div>
                          )}
                          {activeDropdown === 'tag' && (
                            <div className="p-2 grid grid-cols-4 gap-2">
                              {Object.entries(TAG_COLORS).map(([tag, c]) => (
                                <button
                                  key={tag}
                                  onClick={() => toggleTagForItems(tag)}
                                  className={`relative w-8 h-8 rounded-full border transition-transform hover:scale-110 ${
                                    areAllTagged(selectedFiles, tag) ? 'border-on-surface shadow-[0_0_0_2px_rgba(var(--primary-rgb),0.35)]' : 'border-white/10'
                                  }`}
                                  style={{ backgroundColor: c }}
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
                              <button onClick={handleNewFolder} className="w-full text-left px-3 py-1.5 rounded-lg hover:bg-primary/20 text-[13px]">{t('explorer.newFolder', '新建文件夹')}</button>
                              <button onClick={handleNewFile} className="w-full text-left px-3 py-1.5 rounded-lg hover:bg-primary/20 text-[13px]">{t('explorer.newFile', '新建文件')}</button>
                              <button onClick={() => openCurrentInNewTab(lastSelectedFile)} className="w-full text-left px-3 py-1.5 rounded-lg hover:bg-primary/20 text-[13px]">{t('explorer.openInNewTab', '在新标签页中打开')}</button>
                              <div className="my-1 h-px bg-primary/10" />
                              <button onClick={() => { onThemeChange({ ...theme, showPreviewPanel: true }); setActiveDropdown(null); }} className="w-full text-left px-3 py-1.5 rounded-lg hover:bg-primary/20 text-[13px]">{t('explorer.showInspector', '显示检查器')}</button>
                              <button onClick={() => handleQuickLook(lastSelectedFile)} className="w-full text-left px-3 py-1.5 rounded-lg hover:bg-primary/20 text-[13px]">{t('explorer.quickLook', 'Quick Look')}</button>
                              <button onClick={() => handleOpenTerminal(lastSelectedFile)} className="w-full text-left px-3 py-1.5 rounded-lg hover:bg-primary/20 text-[13px]">{t('explorer.openInTerminal', '在终端打开')}</button>
                              <button onClick={() => handleCopyPaths(lastSelectedFile ? getActionFiles(lastSelectedFile) : [])} className="w-full text-left px-3 py-1.5 rounded-lg hover:bg-primary/20 text-[13px]">{t('explorer.copyPath', '拷贝为路径名')}</button>
                              <div className="my-1 h-px bg-primary/10" />
                              <button onClick={() => { setShowAIRename(true); setActiveDropdown(null); }} className="w-full text-left px-3 py-1.5 rounded-lg hover:bg-primary/20 text-[13px] flex items-center gap-2">
                                <Sparkles className="w-3.5 h-3.5 text-primary" /> AI 文件助手
                              </button>
                              <button onClick={() => { setShowAIHistory(true); setActiveDropdown(null); }} className="w-full text-left px-3 py-1.5 rounded-lg hover:bg-primary/20 text-[13px] flex items-center gap-2">
                                <History className="w-3.5 h-3.5 text-on-surface/50" /> AI 操作历史
                              </button>
                              <div className="my-1 h-px bg-primary/10" />
                              <button onClick={() => { handleSort('name'); setActiveDropdown(null); }} className="w-full text-left px-3 py-1.5 rounded-lg hover:bg-primary/20 text-[13px]">{t('explorer.sortByName', '按名称排序')}</button>
                              <button onClick={() => { handleSort('modified'); setActiveDropdown(null); }} className="w-full text-left px-3 py-1.5 rounded-lg hover:bg-primary/20 text-[13px]">{t('explorer.sortByModified', '按修改时间排序')}</button>
                              <button onClick={() => { setGroupBy(groupBy === 'none' ? 'kind' : 'none'); setActiveDropdown(null); }} className="w-full text-left px-3 py-1.5 rounded-lg hover:bg-primary/20 text-[13px]">{groupBy === 'none' ? t('explorer.useGroups', '启用分组') : t('explorer.disableGroups', '取消分组')}</button>
                              <div className="my-1 h-px bg-primary/10" />
                              <p className="px-3 py-1 text-[10px] font-black text-on-surface/30 uppercase tracking-widest">显示</p>
                              <button onClick={() => setShowCheckboxCol(v => !v)} className="w-full flex items-center justify-between px-3 py-1.5 rounded-lg hover:bg-primary/20 text-[13px]">
                                <span>显示勾选框</span>
                                {showCheckboxCol && <Check className="w-3.5 h-3.5 text-primary" />}
                              </button>
                              <button onClick={() => setShowSortCol(v => !v)} className="w-full flex items-center justify-between px-3 py-1.5 rounded-lg hover:bg-primary/20 text-[13px]">
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
                      onClick={() => { setDisplayMode('column'); setColumnPaths([]); }}
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
                // 左键空白区域关闭一次性简介面板
                if (inspectorOverride) closeInspector();
              }}
              onContextMenu={(e) => {
                if ((e.target as HTMLElement).closest('.file-item')) return;
                void handleContextMenu(e, [], true);
              }}
              onScroll={handleContainerScroll}
              onMouseDownCapture={(e) => {
                if (e.button === 2) void focusCurrentWindow();
              }}
              onMouseDown={handleContainerMouseDown}
              onMouseMove={handleContainerMouseMove}
              onMouseUp={handleContainerMouseUp}
              onMouseLeave={handleContainerMouseUp}
              onDragEnter={(e) => {
                // 跨窗口 dragenter 是底层窗口"被进入"的最早信号 — 立刻 raise。
                // 比 dragover 触发更早一帧，避免 banner 看到但窗口仍在底层。
                if (incomingFileDragRef.current) {
                  void focusCurrentWindow();
                }
                // 系统拖入（Finder→Aether）也需要 raise
                if (e.dataTransfer.types.includes('Files')) {
                  void focusCurrentWindow();
                }
              }}
              onDragOver={handleSurfaceDragOver}
              onDrop={handleSurfaceDrop}
              className="relative flex-1 min-h-0 flex flex-col overflow-hidden"
            >
              {/* 跨窗口拖拽悬停反馈 — 纯视觉，由源端 dragEnd 自动触发处理 */}
              {incomingFileDrag && (
                <CrossWindowDropBanner
                  drag={incomingFileDrag}
                  currentPath={currentPath}
                  defaultMode={theme.crossWindowDropDefault || 'copy'}
                  visibleMs={INCOMING_DRAG_VISIBLE_MS}
                  t={t}
                />
              )}
              {/* Finder→Aether 系统拖入视觉反馈 */}
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
              {loading && (
                <div className="flex-1 min-h-0 flex items-center justify-center text-on-surface/40 text-sm">{t('explorer.loading')}</div>
              )}
              {!loading && loadError && (
                <div className="flex-1 min-h-0 flex flex-col items-center justify-center gap-6">
                  <div className="w-16 h-16 rounded-full bg-red-400/10 flex items-center justify-center">
                    <Shield className="w-8 h-8 text-red-400" />
                  </div>
                  <p className="text-on-surface/50 text-sm font-bold">无权访问此目录</p>
                  <p className="text-on-surface/30 text-xs max-w-md text-center px-4">
                    此目录受 macOS 保护。需要授予 Aether Explorer "完全磁盘访问权限"后才能读取。
                  </p>
                  <div className="flex gap-3">
                    <button
                      onClick={() => invoke('open_system_settings').catch(() => {})}
                      className="px-6 py-3 bg-primary text-on-primary font-black rounded-2xl text-[13px] shadow-lg shadow-primary/20 hover:scale-[1.02] transition-all"
                    >
                      打开系统设置
                    </button>
                    <button
                      onClick={refreshCurrentDir}
                      className="px-6 py-3 bg-primary/10 text-on-surface font-bold rounded-2xl text-[13px] hover:bg-primary/20 transition-all"
                    >
                      重试
                    </button>
                  </div>
                  <p className="text-on-surface/20 text-[11px] max-w-sm text-center leading-relaxed">
                    操作步骤：点击"打开系统设置" → 隐私与安全性 → 完全磁盘访问权限 → 打开 Aether Explorer 开关 → 回到此页面点击"重试"
                  </p>
                </div>
              )}
              {!loading && !loadError && currentLevelFiles.length === 0 && displayedFiles.length > 0 && (
                <div className="flex-1 min-h-0 flex items-center justify-center text-on-surface/30 text-sm">{t('explorer.noResults', '没有匹配结果')}</div>
              )}
              {!loading && !loadError && displayedFiles.length === 0 && (
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
              {displayMode === 'grid' && currentLevelFiles.length > 0 && (
                <div ref={scrollContainerRef} onScroll={handleContainerScroll} className="relative flex-1 min-h-0 overflow-y-auto overflow-x-hidden pb-32 auto-scrollbar">
                  <div className="space-y-8">
                    {(Object.entries(groupedFiles) as [string, FileItem[]][]).map(([groupName, files]) => (
                      <div key={groupName} className="space-y-4">
                        {groupBy !== 'none' && (
                          <h3 className="text-[14px] font-bold text-on-surface/40 px-2 uppercase tracking-widest flex items-center gap-2">
                            <ChevronRight className="w-4 h-4" /> {groupName} ({files.length})
                          </h3>
                        )}
                        <div 
                          className="grid gap-6"
                          style={{ 
                            gridTemplateColumns: `repeat(auto-fill, minmax(${Math.max(theme.gridWidth || theme.gridSize || 180, theme.mediaGridLinked === false ? (theme.mediaGridWidth || theme.gridWidth || theme.gridSize || 180) : (theme.gridWidth || theme.gridSize || 180))}px, 1fr))`,
                            gap: `${theme.gridGap || 16}px`,
                            gridAutoRows: `${Math.max(theme.gridHeight || theme.gridSize || 180, theme.mediaGridLinked === false ? (theme.mediaGridHeight || theme.gridHeight || theme.gridSize || 180) : (theme.gridHeight || theme.gridSize || 180))}px`
                          }}
                        >
                          {files.map((file, i) => renderFileItem(file, false, i + 1))}
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="sticky bottom-4 ml-auto mr-3 flex w-8 flex-col gap-1.5 z-[40]">
                    <motion.button
                      whileHover={{ y: -1 }}
                      whileTap={{ scale: 0.94 }}
                      onClick={scrollToTop}
                      className="w-8 h-8 flex items-center justify-center text-on-surface/45 hover:text-primary hover:bg-primary/10 rounded-lg transition-all backdrop-blur-xl"
                      title={t('explorer.scrollToTop', '回到顶部')}
                    >
                      <ChevronsUp className="w-4 h-4" />
                    </motion.button>
                    <motion.button
                      whileHover={{ y: 1 }}
                      whileTap={{ scale: 0.94 }}
                      onClick={scrollToBottom}
                      className="w-8 h-8 flex items-center justify-center text-on-surface/45 hover:text-primary hover:bg-primary/10 rounded-lg transition-all backdrop-blur-xl"
                      title={t('explorer.scrollToBottom', '回到底部')}
                    >
                      <ChevronsDown className="w-4 h-4" />
                    </motion.button>
                  </div>
                </div>
              )}

              {displayMode === 'list' && currentLevelFiles.length > 0 && (
                <div ref={scrollContainerRef} onScroll={handleContainerScroll} className="relative flex-1 min-h-0 overflow-y-auto overflow-x-hidden pb-32 auto-scrollbar">
                  <div className="min-w-[760px] flex flex-col">
                    {/* Table Header */}
                    <div className="sticky top-0 z-20 shrink-0 flex items-center px-4 py-3 pr-4 text-[12px] font-black text-on-surface select-none uppercase tracking-[0.1em] border-b border-primary/20 mb-2 bg-primary/10 rounded-t-xl backdrop-blur-xl">
                      {showCheckboxCol && (
                        <div className={`${LIST_COLS.checkbox} shrink-0 mr-2 flex items-center justify-center`}>
                          <input
                            type="checkbox"
                            checked={currentLevelFiles.length > 0 && currentLevelFiles.every(f => selectedFileIds.includes(f.id))}
                            ref={el => { if (el) el.indeterminate = selectedFileIds.length > 0 && !currentLevelFiles.every(f => selectedFileIds.includes(f.id)); }}
                            onChange={e => onSelectFiles(e.target.checked ? currentLevelFiles.map(f => f.id) : [])}
                            className="w-3.5 h-3.5 accent-primary cursor-pointer"
                          />
                        </div>
                      )}
                      {showSortCol && <div className={`${LIST_COLS.sortNum} shrink-0 text-on-surface/30 text-[10px] pl-1`}>#</div>}
                      <div
                        className="flex items-center gap-2 cursor-pointer hover:text-primary transition-colors pr-4 flex-1 min-w-0"
                        onClick={() => handleSort('name')}
                      >
                        <span className="truncate">{t('explorer.name', '文件名')}</span>
                        {sortConfig?.key === 'name' && <span className="shrink-0">{sortConfig.direction === 'asc' ? '↑' : '↓'}</span>}
                      </div>
                      <div
                        className={`${LIST_COLS.modified} shrink-0 cursor-pointer hover:text-primary transition-colors pl-2`}
                        onClick={() => handleSort('modified')}
                      >
                        <span className="truncate flex items-center gap-2">
                          {t('explorer.modified', '修改日期')}
                          {sortConfig?.key === 'modified' && <span>{sortConfig.direction === 'asc' ? '↑' : '↓'}</span>}
                        </span>
                      </div>
                      <div
                        className={`${LIST_COLS.size} shrink-0 cursor-pointer hover:text-primary transition-colors pl-2 text-right`}
                        onClick={() => handleSort('size')}
                      >
                        <span className="truncate flex items-center justify-end gap-2">
                          {t('explorer.size', '大小')}
                          {sortConfig?.key === 'size' && <span>{sortConfig.direction === 'asc' ? '↑' : '↓'}</span>}
                        </span>
                      </div>
                      <div
                        className={`${LIST_COLS.type} shrink-0 cursor-pointer hover:text-primary transition-colors pl-2 text-right`}
                        onClick={() => handleSort('type')}
                      >
                        <span className="truncate flex items-center justify-end gap-2">
                          {t('explorer.type', '类型')}
                          {sortConfig?.key === 'type' && <span>{sortConfig.direction === 'asc' ? '↑' : '↓'}</span>}
                        </span>
                      </div>
                      <div className={`${LIST_COLS.actions} shrink-0`}></div>
                    </div>
                    <div className="space-y-2" ref={fileListRef}>
                      {(Object.entries(groupedFiles) as [string, FileItem[]][]).map(([groupName, files]) => (
                        <React.Fragment key={groupName}>
                          {groupBy !== 'none' && (
                            <div className="px-4 py-2 mt-4 text-[12px] font-bold text-primary bg-primary/5 rounded-lg flex items-center gap-2">
                              <ChevronRight className="w-4 h-4" /> {groupName}
                            </div>
                          )}
                          {/* 虚拟滚动（仅无分组时启用） */}
                          {groupBy === 'none' && visibleRange ? (
                            <>
                              <div style={{ height: visibleRange.offsetTop }} />
                              {files.slice(visibleRange.start, visibleRange.end).map((file, i) => renderFileItem(file, false, visibleRange.start + i + 1))}
                              <div style={{ height: Math.max(0, visibleRange.totalHeight - visibleRange.end * listItemHeight) }} />
                            </>
                          ) : (
                            files.map((file, i) => renderFileItem(file, false, i + 1))
                          )}
                        </React.Fragment>
                      ))}
                    </div>
                    <div className="sticky bottom-4 ml-auto mr-3 flex w-8 flex-col gap-1.5 z-[40]">
                        <motion.button
                          whileHover={{ y: -1 }}
                          whileTap={{ scale: 0.94 }}
                          onClick={scrollToTop}
                          className="w-8 h-8 flex items-center justify-center text-on-surface/45 hover:text-primary hover:bg-primary/10 rounded-lg transition-all backdrop-blur-xl"
                          title={t('explorer.scrollToTop', '回到顶部')}
                        >
                          <ChevronsUp className="w-4 h-4" />
                        </motion.button>
                        <motion.button
                          whileHover={{ y: 1 }}
                          whileTap={{ scale: 0.94 }}
                          onClick={scrollToBottom}
                          className="w-8 h-8 flex items-center justify-center text-on-surface/45 hover:text-primary hover:bg-primary/10 rounded-lg transition-all backdrop-blur-xl"
                          title={t('explorer.scrollToBottom', '回到底部')}
                        >
                          <ChevronsDown className="w-4 h-4" />
                        </motion.button>
                    </div>
                  </div>
                </div>
              )}

              {displayMode === 'column' && currentLevelFiles.length > 0 && (
                <div ref={scrollContainerRef} className="flex gap-0 flex-1 min-h-0 overflow-x-auto overflow-y-hidden pb-4">
                  {allColumns.map((parentId, colIndex) => {
                    const filesInCol = getColumnFiles(parentId);
                    const groupedColumnFiles: { [key: string]: FileItem[] } = {};
                    if (groupBy === 'none') {
                      groupedColumnFiles[t('explorer.groupAllFiles', '全部项目')] = filesInCol;
                    } else {
                      filesInCol.forEach(file => {
                        const key = getGroupKey(file, groupBy);
                        if (!groupedColumnFiles[key]) groupedColumnFiles[key] = [];
                        groupedColumnFiles[key].push(file);
                      });
                    }

                    return (
                      <div 
                        key={`col-${colIndex}-${parentId || 'root'}`} 
                        className="shrink-0 flex flex-col border-r border-on-surface/10 h-full bg-primary/5"
                        style={{ width: `${theme.columnWidth || 280}px` }}
                      >
                        <h4 className="text-[12px] font-black text-on-surface uppercase tracking-[0.15em] px-4 py-3 shrink-0">
                          {parentId ? parentId.split('/').pop() : t('explorer.localStorage')}
                        </h4>
                        <div className="flex-1 overflow-y-auto custom-scrollbar px-2 space-y-1">
                          {Object.entries(groupedColumnFiles).map(([groupName, files]) => (
                            <React.Fragment key={groupName}>
                              {groupBy !== 'none' && (
                                <div className="text-[10px] font-black text-primary px-3 py-1 mt-2 mb-1 bg-primary/10 rounded uppercase tracking-wider">
                                  {groupName}
                                </div>
                              )}
                              {files.map(file => renderFileItem(file, true))}
                            </React.Fragment>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
            </section>
          </div>
        </div>
      </div>

      {/* Inspector Panel */}
      <AnimatePresence>
        {(inspectorOverride || (lastSelectedFile && theme.showPreviewPanel)) && (
          <motion.aside
            initial={{ x: 360, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: 360, opacity: 0 }}
            className="w-[336px] my-3 mr-3 ml-2 rounded-2xl glass-panel border border-primary/20 bg-primary/5 flex flex-col shrink-0 shadow-xl overflow-hidden relative backdrop-blur-2xl"
          >
            {/* 关闭按钮（一次性弹出模式时显示） */}
            {inspectorOverride && !theme.showPreviewPanel && (
              <button onClick={closeInspector} className="absolute top-3 right-3 z-10 w-7 h-7 rounded-full bg-primary/10 hover:bg-primary/30 flex items-center justify-center transition-colors">
                <X className="w-3.5 h-3.5 text-on-surface/60" />
              </button>
            )}
            <div className="p-5 border-b border-transparent">
              <div className="h-40 rounded-2xl overflow-hidden bg-primary/10 border border-primary/10 relative shadow-lg group">
                {!lastSelectedFile ? (
                  <div className="w-full h-full flex items-center justify-center">
                    {getFileIcon('folder')}
                  </div>
                ) : lastSelectedFile.type === 'image' && lastSelectedFile.thumbnail && !imagePreviewFailed ? (
                  <img
                    src={lastSelectedFile.thumbnail}
                    alt="Preview"
                    className="w-full h-full object-cover"
                    onError={() => setImagePreviewFailed(true)}
                  />
                ) : (lastSelectedFile.type === 'text' || lastSelectedFile.type === 'code') && textPreview ? (
                  <pre className="w-full h-full p-3 overflow-hidden text-[10.5px] leading-relaxed text-on-surface/70 whitespace-pre-wrap break-all font-mono bg-primary/5">
                    {textPreview}
                  </pre>
                ) : lastSelectedFile.type === 'pdf' && !pdfPreviewFailed ? (
                  <iframe
                    src={convertFileSrc(lastSelectedFile.path)}
                    title="PDF Preview"
                    className="w-full h-full bg-white"
                    onError={() => setPdfPreviewFailed(true)}
                  />
                ) : lastSelectedFile.type === 'pdf' && pdfPreviewFailed ? (
                  <div className="w-full h-full flex items-center justify-center px-6 text-center text-[12px] text-on-surface/35 font-bold leading-relaxed">
                    PDF 预览加载失败
                  </div>
                ) : textPreviewLoading ? (
                  <div className="w-full h-full flex items-center justify-center text-[12px] text-on-surface/35 font-bold">
                    正在生成预览...
                  </div>
                ) : (lastSelectedFile.type === 'text' || lastSelectedFile.type === 'code') ? (
                  <div className="w-full h-full flex items-center justify-center px-6 text-center text-[12px] text-on-surface/35 font-bold leading-relaxed">
                    此文本暂不可预览
                  </div>
                ) : lastSelectedFile.type === 'image' && imagePreviewFailed ? (
                  <div className="w-full h-full flex flex-col items-center justify-center gap-3 px-6 text-center text-[12px] text-on-surface/35 font-bold leading-relaxed">
                    {getFileIcon(lastSelectedFile.type, lastSelectedFile.thumbnail)}
                    图片预览加载失败
                  </div>
                ) : (
                  <div className="w-full h-full flex items-center justify-center">
                    <div className="transform group-hover:scale-110 transition-transform duration-500">
                      {getFileIcon(lastSelectedFile.type, lastSelectedFile.thumbnail)}
                    </div>
                  </div>
                )}
                {lastSelectedFile?.dimensions && (
                  <div className="absolute bottom-2 right-2 bg-black/60 backdrop-blur-md px-2 py-0.5 rounded text-[10px] text-white">
                    {lastSelectedFile.dimensions}
                  </div>
                )}
              </div>
              <h3 className="text-[16px] font-bold text-on-surface mt-4 break-words leading-tight">{lastSelectedFile?.name || currentPath}</h3>
              <p className="text-[11px] text-primary font-bold mt-1 opacity-80">{lastSelectedFile ? getFileTypeLabel(lastSelectedFile.type) : '文件夹'}</p>
            </div>

            <div className="flex-1 p-5 space-y-5 overflow-y-auto auto-scrollbar">
               {selectedFileIds.length > 1 && (
                 <div className="p-4 bg-primary/10 rounded-2xl border border-primary/20 text-center">
                    <p className="text-[14px] font-bold text-primary">{selectedFileIds.length} {t('explorer.itemsSelectedLabel', '个项目已选中')}</p>
                 </div>
               )}
              <div className="space-y-3">
                <h4 className="text-[11px] font-bold text-on-surface/40 uppercase tracking-widest">{t('explorer.details')}</h4>
                <div className="grid grid-cols-3 gap-2 text-[13px] leading-relaxed">
                  <div className="text-on-surface/40">{t('explorer.size')}</div>
                  <div className="text-on-surface col-span-2">
                    {dirSizeLoading ? (
                      <span className="inline-block h-4 w-24 rounded bg-gradient-to-r from-primary/20 via-primary/40 to-primary/20 bg-[length:200%_100%] animate-shimmer" />
                    ) : dirSize ? (
                      <span>{dirSize.formatted} <span className="text-on-surface/40 text-[11px]">({dirSize.file_count} 个文件)</span></span>
                    ) : lastSelectedFile.type === 'folder' ? (
                      <span className="text-on-surface/40 text-[11px]">点击查看简介以统计</span>
                    ) : (
                      lastSelectedFile.size
                    )}
                  </div>
                  <div className="text-on-surface/40">{t('explorer.type')}</div>
                  <div className="text-on-surface col-span-2">{lastSelectedFile ? getFileTypeLabel(lastSelectedFile.type) : '文件夹'}</div>
                  <div className="text-on-surface/40">{t('explorer.modified')}</div>
                  <div className="text-on-surface col-span-2">{lastSelectedFile?.modified || '--'}</div>
                  <div className="text-on-surface/40">{t('explorer.location')}</div>
                  <div className="text-on-surface col-span-2 break-all opacity-80">{lastSelectedFile?.path || currentPath}</div>
                </div>
              </div>

              {(textPreview || textPreviewLoading) && (lastSelectedFile.type === 'text' || lastSelectedFile.type === 'code') && (
                <div className="space-y-3">
                  <h4 className="text-[11px] font-bold text-on-surface/40 uppercase tracking-widest">内容预览</h4>
                  <pre className="text-[12px] text-on-surface/70 bg-primary/5 rounded-xl p-3 overflow-auto max-h-72 whitespace-pre-wrap break-all font-mono leading-relaxed border border-primary/10">
                    {textPreviewLoading ? '正在读取...' : textPreview}
                  </pre>
                </div>
              )}

              {activeTagsForLastFile.length > 0 && (
                <div className="space-y-4">
                  <h4 className="text-[11px] font-bold text-on-surface/40 uppercase tracking-widest">{t('explorer.tags')}</h4>
                  <div className="flex flex-wrap gap-2">
                    {activeTagsForLastFile.map(tag => (
                      <span key={tag} className="px-3 py-1 bg-primary/10 border border-primary/20 rounded-full text-[12px] text-on-surface/70 flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full" style={{ backgroundColor: TAG_COLORS[tag] || '#8e8e93' }} />
                        {tag}
                      </span>
                    ))}
                    <button className="px-3 py-1 bg-primary/20 border border-primary/40 rounded-full text-[12px] text-primary font-bold flex items-center gap-1 hover:bg-primary/30 transition-colors">
                      + {t('explorer.add')}
                    </button>
                  </div>
                </div>
              )}
            </div>

            <div className="p-5 space-y-2 border-t border-transparent bg-white/[0.02]">
              <button 
                onClick={() => handleCopyFile(lastSelectedFile)}
                className="w-full py-3 bg-primary text-on-primary rounded-xl font-bold text-[14px] shadow-lg shadow-primary/20 hover:scale-[1.02] active:scale-98 transition-all flex items-center justify-center gap-2"
              >
                <ExternalLink className="w-5 h-5" />
                {t('explorer.copyTo')}
              </button>
              <div className="flex gap-2">
                <button onClick={() => handleRenameStart(lastSelectedFile)} className="flex-1 py-2.5 bg-primary/10 text-on-surface/70 rounded-xl font-medium text-[13px] hover:bg-primary/20 transition-colors flex items-center justify-center gap-2 border border-transparent">
                  <Edit3 className="w-4 h-4" />
                  {t('explorer.rename')}
                </button>
                <button onClick={() => handleDeleteFile(lastSelectedFile)} className="flex-1 py-2.5 bg-red-400/10 text-red-400 border border-red-400/20 rounded-xl font-medium text-[13px] hover:bg-red-400/20 transition-colors flex items-center justify-center gap-2 group">
                  <Trash2 className="w-4 h-4 group-hover:scale-110 transition-transform" />
                  {t('explorer.delete')}
                </button>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <button onClick={() => handleQuickLook(lastSelectedFile)} className="py-2.5 bg-primary/10 text-on-surface/70 rounded-xl font-medium text-[13px] hover:bg-primary/20 transition-colors flex items-center justify-center gap-2 border border-transparent">
                  <Eye className="w-4 h-4" /> Quick Look
                </button>
                <button onClick={() => handleRevealInFinder(lastSelectedFile)} className="py-2.5 bg-primary/10 text-on-surface/70 rounded-xl font-medium text-[13px] hover:bg-primary/20 transition-colors flex items-center justify-center gap-2 border border-transparent">
                  <Folder className="w-4 h-4" /> Finder
                </button>
                <button onClick={() => handleOpenTerminal(lastSelectedFile)} className="py-2.5 bg-primary/10 text-on-surface/70 rounded-xl font-medium text-[13px] hover:bg-primary/20 transition-colors flex items-center justify-center gap-2 border border-transparent col-span-2">
                  <Terminal className="w-4 h-4" /> 在终端打开
                </button>
              </div>
            </div>
          </motion.aside>
        )}
      </AnimatePresence>

      {/* Context Menu Overlay */}
      {contextMenu && (
        <div
          ref={contextMenuRef}
          className={`fixed z-[100] w-56 shadow-2xl animate-in fade-in zoom-in-95 duration-200 overflow-visible ${
            theme.useSystemContextMenu
              ? 'rounded-xl bg-surface/95 border border-on-surface/10 text-on-surface backdrop-blur-xl'
              : 'glass-panel bg-primary/10 border border-primary/20 rounded-2xl backdrop-blur-3xl'
          }`}
          style={contextMenuPosition || undefined}
        >
          <div className="p-1.5 space-y-0.5 rounded-inherit overflow-visible">
            {contextMenu.isBlank ? (
              <>
                {/* 第1分组: 新建文件夹 + 新建文件 */}
                <button onClick={handleNewFolder} className="w-full flex items-center gap-3 px-3 py-1.5 rounded-lg hover:bg-primary/10 text-[12px] font-bold transition-all text-on-surface hover:text-primary">
                  <Folder className="w-4 h-4" /> 新建文件夹
                </button>
                <button onClick={handleNewFile} className="w-full flex items-center gap-3 px-3 py-1.5 rounded-lg hover:bg-primary/10 text-[12px] font-bold transition-all text-on-surface hover:text-primary">
                   <Upload className="w-4 h-4" /> 新建文件
                </button>
                <div className="my-1 h-px bg-primary/10" />
                {/* 第2分组: 刷新 + 排序 */}
                <button onClick={() => { refreshCurrentDir(true); }} className="w-full flex items-center gap-3 px-3 py-1.5 rounded-lg hover:bg-primary/10 text-[12px] font-bold transition-all text-on-surface hover:text-primary">
                  <RefreshCw className="w-4 h-4" /> {t('explorer.refresh', '刷新')}
                </button>
                <button className="w-full flex items-center gap-3 px-3 py-1.5 rounded-lg hover:bg-primary/10 text-[13px] font-bold transition-all text-on-surface hover:text-primary" onClick={() => handleSort('name')}>
                  <List className="w-4 h-4" /> {t('explorer.sortBy', '按名称排序')}
                </button>
                <div className="my-1 h-px bg-primary/10" />
                {/* 第3分组: 查看简介 + 粘贴 */}
                <button onClick={() => handleShowInspector(true)} className="w-full flex items-center gap-3 px-3 py-1.5 rounded-lg hover:bg-primary/10 text-[12px] font-bold transition-all text-on-surface hover:text-primary">
                  <Info className="w-4 h-4" /> {t('explorer.getInfo', '查看简介')}
                </button>
                <button
                  onClick={handlePasteFromClipboard}
                  disabled={!hasFileClipboard}
                  className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-[13px] font-bold transition-all ${
                    !hasFileClipboard
                      ? 'text-on-surface/25 cursor-not-allowed'
                      : 'hover:bg-primary/10 text-on-surface hover:text-primary'
                  }`}
                >
                  <Copy className="w-4 h-4" /> {t('explorer.paste', '粘贴')}
                </button>
                <div className="my-1 h-px bg-primary/10" />
                {/* 第4分组: 设为首页（一键把当前目录变成 App 启动默认位置） */}
                {(() => {
                  const isAlreadyHome = currentPath === (theme.defaultHomePath || FAVORITES_VIRTUAL_PATH);
                  return (
                    <button
                      onClick={handleSetCurrentAsHome}
                      disabled={isAlreadyHome || !currentPath}
                      className={`w-full flex items-center gap-3 px-3 py-1.5 rounded-lg text-[12px] font-bold transition-all ${
                        isAlreadyHome || !currentPath
                          ? 'text-on-surface/25 cursor-not-allowed'
                          : 'hover:bg-primary/10 text-on-surface hover:text-primary'
                      }`}
                    >
                      <Star className={`w-4 h-4 ${isAlreadyHome ? 'fill-primary text-primary' : ''}`} />
                      {isAlreadyHome
                        ? t('explorer.alreadyHome', '已是首页')
                        : t('explorer.setAsHome', '设为首页')}
                    </button>
                  );
                })()}
                <div className="my-1 h-px bg-primary/10" />
                <button onClick={() => { setShowAIRename(true); setContextMenu(null); }} className="w-full flex items-center gap-3 px-3 py-1.5 rounded-lg hover:bg-primary/10 text-[12px] font-bold transition-all text-on-surface hover:text-primary">
                  <Sparkles className="w-4 h-4 text-primary" /> AI 文件助手
                </button>
                <button onClick={() => { setShowAIHistory(true); setContextMenu(null); }} className="w-full flex items-center gap-3 px-3 py-1.5 rounded-lg hover:bg-primary/10 text-[12px] font-bold transition-all text-on-surface hover:text-primary">
                  <History className="w-4 h-4 text-on-surface/50" /> AI 操作历史
                </button>
              </>
            ) : findFileById(contextMenu.fileIds[0]) ? (
              (() => {
                const ctxFile = findFileById(contextMenu.fileIds[0])!;
                return (
              <>
                {/* 第1分组: 打开 + 重命名 */}
                <button onClick={() => handleOpenFile(ctxFile)} className="w-full flex items-center gap-3 px-3 py-1.5 rounded-lg hover:bg-primary/10 text-[12px] font-bold transition-all text-on-surface hover:text-primary">
                  <ExternalLink className="w-4 h-4" /> {t('explorer.open', '打开')}
                </button>
                <div
                  className="relative"
                  onMouseEnter={() => setContextSubmenu('openWith')}
                  onMouseLeave={() => setContextSubmenu(prev => prev === 'openWith' ? null : prev)}
                >
                  <button className="w-full flex items-center justify-between gap-3 px-3 py-1.5 rounded-lg hover:bg-primary/10 text-[12px] font-bold transition-all text-on-surface hover:text-primary">
                    <span className="flex items-center gap-3">
                      <ExternalLink className="w-4 h-4" /> {t('explorer.openWith', '打开方式')}
                    </span>
                    <ChevronRight className="w-3.5 h-3.5" />
                  </button>
                  {contextSubmenu === 'openWith' && (
                    <div
                      className="absolute left-full top-0 z-[110] ml-1 w-52 rounded-2xl border border-primary/20 shadow-2xl p-1.5"
                      style={{
                        // 用 color-mix 把 primary 与 surface 实混，
                        // 视觉上有"父菜单的玻璃淡色感"但不透明、不依赖 backdrop-filter
                        // （backdrop-filter 在已被父菜单 backdrop-blur 包住的子菜单里几乎失效）
                        background: 'color-mix(in srgb, var(--primary) 8%, var(--surface) 100%)',
                      }}
                    >
                      {OPEN_WITH_APPS.map((appName) => (
                        <button
                          key={appName}
                          onClick={() => handleOpenWith(ctxFile, appName)}
                          className="w-full rounded-lg px-3 py-1.5 text-left text-[12px] font-bold text-on-surface transition-all hover:bg-primary/10 hover:text-primary"
                        >
                          {appName}
                        </button>
                      ))}
                      <div className="my-1 h-px bg-primary/10" />
                      <button
                        onClick={() => handleOpenWithOther(ctxFile)}
                        className="w-full rounded-lg px-3 py-1.5 text-left text-[12px] font-bold text-on-surface transition-all hover:bg-primary/10 hover:text-primary"
                      >
                        {t('explorer.openWithOther', '其它…')}
                      </button>
                    </div>
                  )}
                </div>
                <button onClick={() => handleRenameStart(ctxFile)} className="w-full flex items-center gap-3 px-3 py-1.5 rounded-lg hover:bg-primary/10 text-[12px] font-bold transition-all text-on-surface hover:text-primary">
                  <Edit3 className="w-4 h-4" /> {t('explorer.rename', '重命名')}
                </button>
                <div className="my-1 h-px bg-primary/10" />
                {/* 第2分组: 复制 + 剪切 + 制作替身 */}
                <button onClick={() => handleCopyToClipboard(getActionFiles(ctxFile))} className="w-full flex items-center gap-3 px-3 py-1.5 rounded-lg hover:bg-primary/10 text-[12px] font-bold transition-all text-on-surface hover:text-primary">
                  <Copy className="w-4 h-4" /> {t('explorer.copy', '复制')}
                </button>
                <button onClick={() => handleCutToClipboard(getActionFiles(ctxFile))} className="w-full flex items-center gap-3 px-3 py-1.5 rounded-lg hover:bg-primary/10 text-[12px] font-bold transition-all text-on-surface hover:text-primary">
                  <Edit2 className="w-4 h-4" /> {t('explorer.cut', '剪切')}
                </button>
                <button onClick={() => handleAlias(ctxFile)} className="w-full flex items-center gap-3 px-3 py-1.5 rounded-lg hover:bg-primary/10 text-[12px] font-bold transition-all text-on-surface hover:text-primary">
                  <ExternalLink className="w-4 h-4" /> 制作替身
                </button>
                <div className="my-1 h-px bg-primary/10" />
                {/* 第3分组: 解压/压缩 + 在终端打开 + 查看简介 */}
                {ctxFile.type === 'archive' && (
                  <button onClick={() => handleDecompress(ctxFile)} className="w-full flex items-center gap-3 px-3 py-1.5 rounded-lg hover:bg-primary/10 text-[12px] font-bold transition-all text-on-surface hover:text-primary">
                    <FolderArchive className="w-4 h-4" /> 解压
                  </button>
                )}
                <button onClick={() => handleCompress(ctxFile)} className="w-full flex items-center gap-3 px-3 py-1.5 rounded-lg hover:bg-primary/10 text-[12px] font-bold transition-all text-on-surface hover:text-primary">
                  <FolderArchive className="w-4 h-4" /> 压缩
                </button>
                <button onClick={() => handleOpenTerminal(ctxFile)} className="w-full flex items-center gap-3 px-3 py-1.5 rounded-lg hover:bg-primary/10 text-[12px] font-bold transition-all text-on-surface hover:text-primary">
                  <Terminal className="w-4 h-4" /> 在终端打开
                </button>
                <button onClick={() => handleShowInspector()} className="w-full flex items-center gap-3 px-3 py-1.5 rounded-lg hover:bg-primary/10 text-[12px] font-bold transition-all text-on-surface hover:text-primary">
                  <Info className="w-4 h-4" /> {t('explorer.getInfo', '查看简介')}
                </button>
                <button onClick={() => handleCopyNames(getActionFiles(ctxFile))} className="w-full flex items-center gap-3 px-3 py-1.5 rounded-lg hover:bg-primary/10 text-[12px] font-bold transition-all text-on-surface hover:text-primary">
                  <Copy className="w-4 h-4" /> {t('explorer.copyName', '复制文件名')}
                </button>
                <button onClick={() => handleToggleFavoriteForItems(getActionFiles(ctxFile))} className="w-full flex items-center gap-3 px-3 py-1.5 rounded-lg hover:bg-primary/10 text-[12px] font-bold transition-all text-on-surface hover:text-primary">
                  <Star className={`w-4 h-4 ${areAllFavorites(getActionFiles(ctxFile)) ? 'fill-current' : ''}`} />
                  {areAllFavorites(getActionFiles(ctxFile)) ? t('explorer.removeFavorite', '取消收藏') : t('explorer.addFavorite', '收藏')}
                </button>
                <div className="px-3 pt-1 pb-1">
                  <div className="mb-2 flex items-center gap-2 text-[11px] font-black text-on-surface/45">
                    <Tag className="w-3.5 h-3.5" /> {t('explorer.colorTag', '颜色标签')}
                  </div>
                  <div className="grid grid-cols-7 gap-1.5">
                    {Object.entries(TAG_COLORS).map(([tag, color]) => (
                      <button
                        key={tag}
                        onClick={() => toggleTagForItems(tag, getActionFiles(ctxFile))}
                        className={`relative h-6 w-6 rounded-full border transition-transform hover:scale-110 ${
                          areAllTagged(getActionFiles(ctxFile), tag) ? 'border-on-surface shadow-[0_0_0_2px_rgba(var(--primary-rgb),0.35)]' : 'border-white/10'
                        }`}
                        style={{ backgroundColor: color }}
                        title={getTagLabel(tag)}
                      >
                        {areAllTagged(getActionFiles(ctxFile), tag) && <Check className="absolute inset-0 m-auto w-3.5 h-3.5 text-white drop-shadow" />}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="my-1 h-px bg-primary/10" />
                {/* 第4分组: Quick Look + Finder 中显示 + 复制路径 */}
                <button onClick={() => handleQuickLook(ctxFile)} className="w-full flex items-center gap-3 px-3 py-1.5 rounded-lg hover:bg-primary/10 text-[12px] font-bold transition-all text-on-surface hover:text-primary">
                  <Eye className="w-4 h-4" /> Quick Look
                </button>
                <button onClick={() => handleRevealInFinder(ctxFile)} className="w-full flex items-center gap-3 px-3 py-1.5 rounded-lg hover:bg-primary/10 text-[12px] font-bold transition-all text-on-surface hover:text-primary">
                  <Folder className="w-4 h-4" /> 在 Finder 中显示
                </button>
                <button onClick={() => handleCopyPaths(getActionFiles(ctxFile))} className="w-full flex items-center gap-3 px-3 py-1.5 rounded-lg hover:bg-primary/10 text-[12px] font-bold transition-all text-on-surface hover:text-primary">
                  <Copy className="w-4 h-4" /> 复制路径
                </button>
                <div className="my-1 h-px bg-primary/10" />
                {/* 第5分组: 删除 */}
                <button onClick={() => handleDeleteFile(ctxFile)} className="w-full flex items-center gap-3 px-3 py-1.5 rounded-lg hover:bg-red-500/10 text-[13px] font-bold transition-all text-red-500">
                  <Trash2 className="w-4 h-4" /> {t('explorer.moveToTrash', '移至废纸篓')}
                </button>

                {/* 第6分组: 扩展功能 */}
                {enabledContextExtensions.length > 0 && (
                  <>
                    <div className="my-1 h-px bg-primary/10" />
                    {enabledContextExtensions.map((ext) => (
                      <button
                        key={ext.id}
                        onClick={() => handleExtensionAction(ext.id, ctxFile)}
                        className="w-full flex items-center gap-3 px-3 py-1.5 rounded-lg hover:bg-primary/20 text-[13px] font-bold transition-all text-on-surface"
                      >
                        {getExtensionIcon(ext)}
                        {ext.label}
                      </button>
                    ))}
                  </>
                )}
              </>
                );
              })()
            ) : (
              <>
                {!contextMenu.isBlank && isAdminContextMenuEmpty && !theme.contextMenuExtensions && (
                  <div className="px-3 py-4 text-center">
                    <p className="text-[12px] text-on-surface/40 italic">右键菜单已禁用</p>
                    <button onClick={() => onViewChange('settings')} className="mt-2 text-[11px] text-primary font-bold hover:underline">去设置中开启</button>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}

      <AnimatePresence>
        {operationMessage && (
          <motion.div
            initial={{ opacity: 0, y: 16, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.96 }}
            className="fixed bottom-8 left-1/2 -translate-x-1/2 z-[120] px-5 py-3 rounded-2xl bg-primary text-on-primary text-[13px] font-black shadow-2xl shadow-primary/20 max-w-[70vw] truncate"
          >
            {operationMessage}
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {moveConflictDialog && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[140] flex items-center justify-center bg-black/35 px-4 backdrop-blur-sm"
          >
            <motion.div
              initial={{ opacity: 0, y: 18, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 18, scale: 0.96 }}
              className="w-full max-w-md rounded-2xl border border-primary/25 bg-surface/95 p-5 shadow-2xl shadow-black/30"
            >
              <h3 className="text-[17px] font-black text-on-surface">
                {t('dialogs.moveConflictTitle', '目标中已有同名项目')}
              </h3>
              <p className="mt-2 text-[13px] font-medium leading-relaxed text-on-surface/65">
                {moveConflictDialog.conflicts.length === 1
                  ? t('dialogs.moveConflictDescription', {
                    name: moveConflictDialog.conflicts[0].name,
                    folder: moveConflictDialog.targetFolder.name,
                  })
                  : t('dialogs.moveConflictDescriptionMultiple', {
                    count: moveConflictDialog.conflicts.length,
                    folder: moveConflictDialog.targetFolder.name,
                  })}
              </p>
              <div className="mt-4 max-h-36 overflow-y-auto rounded-xl border border-primary/10 bg-primary/5 p-2">
                {moveConflictDialog.conflicts.slice(0, 6).map(conflict => (
                  <div key={`${conflict.src}-${conflict.dst}`} className="truncate px-2 py-1 text-[12px] font-bold text-on-surface/70">
                    {conflict.name}
                  </div>
                ))}
                {moveConflictDialog.conflicts.length > 6 && (
                  <div className="px-2 py-1 text-[12px] font-bold text-on-surface/40">
                    +{moveConflictDialog.conflicts.length - 6}
                  </div>
                )}
              </div>
              <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <button
                  onClick={() => handleMoveConflictChoice('cancel')}
                  className="rounded-xl px-4 py-2.5 text-[13px] font-black text-on-surface/65 transition-colors hover:bg-primary/10"
                >
                  {t('dialogs.cancel', '取消')}
                </button>
                <button
                  onClick={() => handleMoveConflictChoice('keepBoth')}
                  className="rounded-xl border border-primary/20 bg-primary/10 px-4 py-2.5 text-[13px] font-black text-on-surface transition-colors hover:bg-primary/20"
                >
                  {t('dialogs.keepBoth', '保留两者')}
                </button>
                <button
                  onClick={() => handleMoveConflictChoice('replace')}
                  className="rounded-xl bg-red-500 px-4 py-2.5 text-[13px] font-black text-white shadow-lg shadow-red-500/20 transition-transform active:scale-95"
                >
                  {t('dialogs.replaceExisting', '替换')}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {renderDragPreview()}
      </AnimatePresence>

      {showAIRename && (
        <AIRenamePanel
          files={selectedFiles.length > 0 ? selectedFiles : currentLevelFiles}
          currentDir={currentPath}
          theme={theme}
          onClose={() => setShowAIRename(false)}
          onComplete={() => { setShowAIRename(false); refreshCurrentDir(); }}
        />
      )}

      {showAIHistory && (
        <AIOpsHistory
          onClose={() => setShowAIHistory(false)}
          onRollbackComplete={() => { setShowAIHistory(false); refreshCurrentDir(); }}
        />
      )}

    </div>
  );
}
