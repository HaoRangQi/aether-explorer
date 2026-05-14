import React, { useState, useMemo, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Search, Folder, Palette, Image as ImageIcon, ChevronRight, ChevronLeft, Grid2X2, List, Columns, MoreVertical, FileText, Video, Archive, FileIcon, ExternalLink, Info, Edit3, Copy, FolderArchive, Trash2, Edit2, Upload, Tag, MoreHorizontal, Star, LayoutGrid, Check, Eye, EyeOff, PanelRight, PanelRightClose, Puzzle, Sparkles, ChevronsUp, ChevronsDown, Shield, Terminal, Code2, X, RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { open as shellOpen } from '@tauri-apps/plugin-shell';
import { confirm } from '@tauri-apps/plugin-dialog';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { Menu, MenuItem, PredefinedMenuItem } from '@tauri-apps/api/menu';
import { PhysicalPosition } from '@tauri-apps/api/dpi';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { invoke, convertFileSrc } from '@tauri-apps/api/core';
import { listDirectory, getHomeDir, copyFile, moveFile, renameFile, deleteToTrash, createFile, createFolder, compressFiles, decompressFile, makeAlias } from '../api/filesystem';
import { ViewMode, ThemeSettings, FileItem, DisplayMode, GroupBy, ContextMenuAction } from '../types';
import { QUICK_ACCESS } from '../constants';

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
  modified: 'w-36',
  size: 'w-24',
  type: 'w-24',
  actions: 'w-8',
};

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
  onThemeChange: (theme: ThemeSettings) => void;
  onViewChange: (view: ViewMode) => void;
  onTitleChange?: (tabId: string, title: string) => void;
  onPathChange?: (tabId: string, path: string) => void;
}

export default function ExplorerView({ view, isActive = false, currentTabLabelKey, initialPath, theme, selectedFileIds, onSelectFiles, onSelectionCountChange, onStartTransfer, onOpenTab, favorites, onToggleFavorite, onThemeChange, onViewChange, onTitleChange, onPathChange }: ExplorerViewProps) {
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
  const [files, setFiles] = useState<FileItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [homeDir, setHomeDir] = useState('');
  const [renamingFile, setRenamingFile] = useState<FileItem | null>(null);
  const [renameInput, setRenameInput] = useState('');
  const [textPreview, setTextPreview] = useState('');
  const [textPreviewLoading, setTextPreviewLoading] = useState(false);
  const [imagePreviewFailed, setImagePreviewFailed] = useState(false);
  const [pdfPreviewFailed, setPdfPreviewFailed] = useState(false);
  const [operationMessage, setOperationMessage] = useState('');
  const [fileTags, setFileTags] = useState<Record<string, string[]>>(() => {
    try {
      return JSON.parse(localStorage.getItem('aether-file-tags') || '{}');
    } catch {
      return {};
    }
  });

  const dropdownRef = useRef<HTMLDivElement>(null);
  const pathScrollRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const feedbackTimerRef = useRef<number | null>(null);
  const marqueeResetTimerRef = useRef<number | null>(null);
  const [selectionBox, setSelectionBox] = useState<{ x1: number, y1: number, x2: number, y2: number } | null>(null);
  const [isMarqueeDragging, setIsMarqueeDragging] = useState(false);
  const [typeaheadQuery, setTypeaheadQuery] = useState('');
  const typeaheadTimerRef = useRef<number | null>(null);
  const clipboardRef = useRef<string[]>([]);
  const clipboardCutRef = useRef(false); // true = 剪切模式 // 存储复制/剪切的文件路径

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

  const handleCopyToClipboard = (items = selectedFiles) => {
    if (items.length === 0) return;
    clipboardRef.current = items.map(f => f.path);
    clipboardCutRef.current = false;
    showFeedback(t('messages.copied', { count: items.length }));
    setContextMenu(null);
  };

  const handleCutToClipboard = (items = selectedFiles) => {
    if (items.length === 0) return;
    clipboardRef.current = items.map(f => f.path);
    clipboardCutRef.current = true;
    showFeedback(t('messages.cut', { count: items.length }));
    setContextMenu(null);
  };

  const handlePasteFromClipboard = async () => {
    const paths = clipboardRef.current;
    if (paths.length === 0) {
      showFeedback(t('messages.clipboardEmpty'));
      return;
    }
    setContextMenu(null);
    try {
      if (clipboardCutRef.current) {
        // 剪切模式：移动文件
        await Promise.all(paths.map(path => moveFile(path, currentPath)));
        clipboardRef.current = [];
        clipboardCutRef.current = false;
        refreshCurrentDir();
        showFeedback(t('messages.moved', { count: paths.length }));
      } else {
        await Promise.all(paths.map(path => copyFile(path, currentPath)));
        refreshCurrentDir();
        showFeedback(t('messages.pasted', { count: paths.length }));
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

  const contextMenuPosition = useMemo(() => {
    if (!contextMenu || typeof window === 'undefined') return null;
    const menuWidth = 256;
    const menuMaxHeight = Math.min(420, window.innerHeight - 40);
    return {
      left: Math.max(12, Math.min(contextMenu.x, window.innerWidth - menuWidth - 12)),
      top: Math.max(12, Math.min(contextMenu.y, window.innerHeight - menuMaxHeight - 12)),
      maxHeight: menuMaxHeight,
    };
  }, [contextMenu]);

  // Sidebar view → real path mapping
  // Note: sidebar "主页" uses viewId 'desktop' (lucide Home icon)
  const viewPathMap: Record<string, string> = {
    downloads: `${homeDir}/Downloads`,
    documents: `${homeDir}/Documents`,
    desktop: homeDir,             // "主页" → ~/  (sidebar labels 'desktop' as 'home/主页')
    applications: '/Applications',
    home: homeDir,
    recent: homeDir,
    icloud: `${homeDir}/Library/Mobile Documents/com~apple~CloudDocs`,
    macos: '/',
    airdrop: '/',
    network: '/Volumes',
    trash: `${homeDir}/.Trash`,
    'favorites-list': homeDir,
    'tag-red': homeDir,
    'tag-orange': homeDir,
    'tag-yellow': homeDir,
    'tag-green': homeDir,
    'tag-blue': homeDir,
    'tag-purple': homeDir,
    'tag-gray': homeDir,
    'tag-all': homeDir,
  };

  const showFeedback = (message: string) => {
    setOperationMessage(message);
    if (feedbackTimerRef.current) window.clearTimeout(feedbackTimerRef.current);
    feedbackTimerRef.current = window.setTimeout(() => setOperationMessage(''), 300);
  };

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
      setCurrentPath(initialPath || `${home}/Downloads`);
    }).catch(() => {
      if (cancelled) return;
      setCurrentPath(initialPath || '/Users');
    });
    return () => { cancelled = true; };
  }, [initialPath]);

  useEffect(() => () => {
    if (feedbackTimerRef.current) window.clearTimeout(feedbackTimerRef.current);
    if (marqueeResetTimerRef.current) window.clearTimeout(marqueeResetTimerRef.current);
    if (typeaheadTimerRef.current) window.clearTimeout(typeaheadTimerRef.current);
  }, []);

  useEffect(() => {
    localStorage.setItem('aether-file-tags', JSON.stringify(fileTags));
  }, [fileTags]);

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
    if (!homeDir) return;
    const mappedPath = resolveViewPath(view);
    if (mappedPath && mappedPath !== currentPath) {
      navigateToPath(mappedPath, { replace: true });
    }
  }, [view, homeDir]);

  const [loadError, setLoadError] = useState('');
  const [showPermissionDialog, setShowPermissionDialog] = useState(false);

  // Load directory when path changes
  useEffect(() => {
    let cancelled = false;
    if (!currentPath) return;
    setLoading(true);
    setLoadError('');
    setShowPermissionDialog(false);
    listDirectory(currentPath, theme.showHiddenFiles)
      .then(f => {
        if (cancelled) return;
        setFiles(f);
        setLoadError('');
      })
      .catch(err => {
        if (cancelled) return;
        const msg = String(err);
        setFiles([]);
        setLoadError(msg);
        // Permission denied → show dialog
        if (msg.includes('PermissionDenied') || msg.includes('NotSupported') || msg.includes('无法读取')) {
          setShowPermissionDialog(true);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [currentPath, theme.showHiddenFiles]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setActiveDropdown(null);
      }
    };
    const handleGlobalMouseUp = (e: MouseEvent) => {
      setSelectionBox(null);
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

  React.useEffect(() => {
    setSearchQuery('');
    onSelectFiles([]);
    setColumnPaths([]);
  }, [view]);
  
  const selectedFiles = useMemo(() => files.filter(f => selectedFileIds.includes(f.id)), [selectedFileIds, files]);
  const lastSelectedFile = useMemo(() => files.find(f => f.id === selectedFileIds[selectedFileIds.length - 1]), [selectedFileIds, files]);
  const isAdminContextMenuEmpty = useMemo(() => !(theme.contextMenuExtensions || []).some(ext => ext.enabled), [theme.contextMenuExtensions]);
  const enabledContextExtensions = useMemo(() => (theme.contextMenuExtensions || []).filter(ext => ext.enabled), [theme.contextMenuExtensions]);

  const currentLevelFiles = useMemo(() => {
    let filtered = files.filter(file => {
      if (view === 'favorites-list') {
        return favorites.includes(file.id);
      }
      if (view.startsWith('tag-')) {
        const tags = fileTags[file.path] || file.tags || [];
        if (view === 'tag-all') return tags.length > 0;
        return tags.includes(view);
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
  }, [files, searchQuery, sortConfig, view, favorites, fileTags]);

  // 虚拟滚动：仅渲染列表视图的可见项（>50 文件时启用）
  const densityHeights: Record<string, number> = { ultra: 28, compact: 36, normal: 44, relaxed: 60 };
  const listItemGap = 8;
  const listItemHeight = (densityHeights[theme.listDensity || 'normal'] || 44) + listItemGap;
  const listOverScan = 10;
  const fileListRef = useRef<HTMLDivElement>(null);
  const [fileListOffset, setFileListOffset] = useState(0);
  useEffect(() => {
    if (fileListRef.current && containerRef.current) {
      const listTop = fileListRef.current.getBoundingClientRect().top;
      const containerTop = containerRef.current.getBoundingClientRect().top;
      setFileListOffset(listTop - containerTop + containerRef.current.scrollTop);
    }
  }, [currentPath]);

  const visibleRange = useMemo(() => {
    if (displayMode !== 'list' || currentLevelFiles.length < 999999) return null; // 虚拟滚动暂时禁用
    const containerH = containerRef.current?.clientHeight || 600;
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
      const el = containerRef.current;
      if (el) setScrollTop(el.scrollTop);
    });
  };
  useEffect(() => () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); }, []);

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
        const currentFolderIndex = columnPaths.indexOf(next.path);
        const newPaths = currentFolderIndex !== -1 ? columnPaths.slice(0, currentFolderIndex + 1) : [];
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
    const leaf = currentPath.split('/').filter(Boolean).pop();
    const title = leaf || (currentPath === '/' ? '/' : currentTabLabelKey ? t(currentTabLabelKey) : t('explorer.localStorage', '本地存储'));
    onTitleChange(view, title);
  }, [isActive, currentPath, currentTabLabelKey, view, t, onTitleChange]);

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

      // Cmd+A: 全选
      if ((e.metaKey || e.ctrlKey) && e.key === 'a') {
        e.preventDefault();
        onSelectFiles(currentLevelFiles.map(f => f.id));
        return;
      }
      // Cmd+C: 复制路径
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'c' && selectedFiles.length > 0) {
        e.preventDefault();
        handleCopyPaths();
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
      // Space: Quick Look 预览
      if (e.key === ' ' && lastSelectedFile) {
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

  const toggleTagForSelection = (tagId: string, items = selectedFiles) => {
    if (items.length === 0) return;
    setFileTags(prev => {
      const next = { ...prev };
      const shouldRemove = items.every(item => (next[item.path] || item.tags || []).includes(tagId));
      items.forEach(item => {
        const existing = new Set(next[item.path] || item.tags || []);
        if (shouldRemove) existing.delete(tagId);
        else existing.add(tagId);
        const values = Array.from(existing);
        if (values.length === 0) delete next[item.path];
        else next[item.path] = values;
      });
      return next;
    });
    const action = items.every(item => (fileTags[item.path] || item.tags || []).includes(tagId)) ? t('messages.tagRemoved') : t('messages.tagAdded');
    showFeedback(t('messages.tagToggled', { action }));
    setActiveDropdown(null);
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
        const currentFolderIndex = columnPaths.indexOf(file.path);
        const newPaths = currentFolderIndex !== -1 ? columnPaths.slice(0, currentFolderIndex + 1) : [];
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

  const handleExternalDrop = async (e: React.DragEvent) => {
    const rawFiles = Array.from(e.dataTransfer.files || []);
    const paths = rawFiles
      .map(file => (file as File & { path?: string }).path)
      .filter((path): path is string => Boolean(path));
    if (paths.length === 0) return;
    e.preventDefault();
    try {
      await Promise.all(paths.map(path => copyFile(path, currentPath)));
      refreshCurrentDir();
      showFeedback(t('messages.importedFromFinder', { count: paths.length }));
    } catch (err) {
      showFeedback(t('messages.finderImportFailed', { error: String(err) }));
    }
  };

  const handleDragStart = (e: React.DragEvent, file: FileItem) => {
    e.dataTransfer.setData('fileId', file.id);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  const handleDrop = (e: React.DragEvent, targetFolderId: string) => {
    e.preventDefault();
    const draggedFileId = e.dataTransfer.getData('fileId');
    if (draggedFileId === targetFolderId) return;

    const targetFolder = files.find(f => f.id === targetFolderId && f.type === 'folder');
    if (!targetFolder) return;

    const idsToMove = selectedFileIds.includes(draggedFileId) ? selectedFileIds : [draggedFileId];
    const filesToMove = files.filter(f => idsToMove.includes(f.id));
    if (filesToMove.some(f => targetFolder.path === f.path || targetFolder.path.startsWith(`${f.path}/`))) {
      showFeedback(t('messages.cannotMoveToSelf'));
      return;
    }

    Promise.all(filesToMove.map(file => moveFile(file.path, targetFolder.path)))
      .then(() => {
        showFeedback(t('messages.movedToFolder', { count: filesToMove.length, folder: targetFolder.name }));
        onSelectFiles([]);
        refreshCurrentDir();
      })
      .catch(err => showFeedback(t('messages.moveFailed', { error: String(err) })));
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

  const getFileIcon = (type: FileItem['type']) => {
    switch (type) {
      case 'image': return <ImageIcon className="w-5 h-5 text-primary" />;
      case 'video': return <Video className="w-5 h-5 text-secondary" />;
      case 'pdf': return <FileText className="w-5 h-5 text-red-400" />;
      case 'archive': return <Archive className="w-5 h-5 text-yellow-400" />;
      case 'folder': return <Folder className="w-5 h-5 text-primary fill-current opacity-80" />;
      default: return <FileIcon className="w-5 h-5 text-on-surface/40" />;
    }
  };

  const getFileTypeLabel = (type: FileItem['type']) => {
    switch (type) {
      case 'folder': return t('explorer.folder', '文件夹');
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

  const renderFileItem = (file: FileItem, isColumnItem = false) => {
    const isSelected = selectedFileIds.includes(file.id) || (isColumnItem && columnPaths.includes(file.id));
    const isPulsing = pulseFileId === file.id;
    const formattedName = formatFileName(file.name);
    const isLongName = file.name !== formattedName;
    const tags = fileTags[file.path] || file.tags || [];
    
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
          onDragStart={(e) => handleDragStart(e, file)}
          onDragOver={file.type === 'folder' ? (e) => handleDragOver(e) : undefined}
          onDrop={file.type === 'folder' ? (e) => handleDrop(e, file.id) : undefined}
          onClick={(e) => { e.stopPropagation(); handleSelectFile(file, e); }}
          onDoubleClick={() => handleDoubleClick(file)}
          title={isLongName ? file.name : undefined}
          onContextMenu={(e) => { void handleContextMenu(e, [file.id]); }}
          animate={isPulsing ? { scale: [1, 0.985, 1.01, 1] } : undefined}
          transition={isPulsing ? { duration: 0.26 } : undefined}
          className={`file-item flex items-center transition-all duration-200 group border px-4 cursor-pointer
            ${config.py} ${config.gap}
            ${isPulsing ? 'ring-2 ring-primary/35' : ''}
            ${isSelected ? 'bg-primary/40 border-primary/60 shadow-[0_4px_12px_rgba(var(--primary-rgb),0.2)] rounded-xl z-10' : 'bg-primary/10 border-transparent hover:bg-primary/20 hover:border-primary/20 shadow-sm rounded-lg'}
          `}
        >
          <div className={`flex items-center flex-1 min-w-0 ${config.gap}`}>
            <div className={`${config.icon} rounded-lg flex items-center justify-center shrink-0 shadow-sm border border-on-surface/5 transition-colors ${isSelected ? 'bg-primary/20' : 'bg-primary/5'}`}>
               <div className={`flex items-center justify-center transition-transform ${config.scale}`}>
                 {getFileIcon(file.type)}
               </div>
            </div>
            {renamingFile?.id === file.id ? (
              <input value={renameInput} onChange={e => setRenameInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleRenameSubmit(); if (e.key === 'Escape') handleRenameCancel(); }}
                onBlur={handleRenameSubmit} autoFocus onClick={e => e.stopPropagation()}
                className={`${config.text} font-black text-on-surface bg-primary/20 border border-primary rounded-md px-2 py-0.5 outline-none min-w-0 flex-1`} />
            ) : (
            <span className={`${config.text} font-black text-on-surface truncate pr-4 transition-all duration-300`}>{formattedName}</span>
            )}
            {tags.length > 0 && (
              <div className="flex gap-1 shrink-0">
                {tags.slice(0, 3).map(tag => <span key={tag} className="w-2 h-2 rounded-full" style={{ backgroundColor: TAG_COLORS[tag] || '#8e8e93' }} />)}
              </div>
            )}
          </div>
          <div className={`${LIST_COLS.modified} shrink-0 ${config.subText} text-on-surface font-black truncate pl-2 transition-all duration-300`}>{file.modified}</div>
          <div className={`${LIST_COLS.size} shrink-0 ${config.subText} text-on-surface font-mono font-black pl-2 text-right tabular-nums transition-all duration-300`}>{file.size || '--'}</div>
          <div className={`${LIST_COLS.type} shrink-0 ${config.subText} text-on-surface truncate font-black tracking-tight pl-2 text-right opacity-70 transition-all duration-300`}>{getFileTypeLabel(file.type)}</div>
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
          onDragStart={(e) => handleDragStart(e, file)}
          onDragOver={file.type === 'folder' ? (e) => handleDragOver(e) : undefined}
          onDrop={file.type === 'folder' ? (e) => handleDrop(e, file.id) : undefined}
          title={isLongName ? file.name : undefined}
          onClick={(e) => { e.stopPropagation(); handleSelectFile(file, e); }}
          onDoubleClick={() => handleDoubleClick(file)}
          onContextMenu={(e) => { void handleContextMenu(e, [file.id]); }}
          animate={isPulsing ? { scale: [1, 0.985, 1.01, 1] } : undefined}
          transition={isPulsing ? { duration: 0.26 } : undefined}
          className={`file-item flex items-center gap-3 px-3 rounded-xl cursor-pointer transition-all duration-300 group border
            ${isPulsing ? 'ring-2 ring-primary/35' : ''}
            ${isSelected ? 'bg-primary/40 border-primary/60 shadow-[0_4px_12px_rgba(var(--primary-rgb),0.2)]' : 'bg-primary/10 border-transparent hover:bg-primary/20 hover:border-primary/20 shadow-sm'}
          `}
          style={{ 
            height: `${theme.columnHeight || 60}px`,
            width: '100%',
            marginBottom: '8px'
          }}
        >
          <div className="w-10 h-10 rounded-full flex items-center justify-center bg-primary/5 group-hover:bg-primary/10 transition-colors shrink-0">
            {getFileIcon(file.type)}
          </div>
          <div className="flex-1 min-w-0 flex flex-col justify-center">
            {renamingFile?.id === file.id ? (
              <input value={renameInput} onChange={e => setRenameInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleRenameSubmit(); if (e.key === 'Escape') handleRenameCancel(); }}
                onBlur={handleRenameSubmit} autoFocus onClick={e => e.stopPropagation()}
                className="text-[14px] font-black text-on-surface bg-primary/20 border border-primary rounded-md px-2 py-0.5 outline-none w-full" />
            ) : (
              <h3 className="text-[14px] font-black text-on-surface truncate leading-tight group-hover:text-primary transition-colors">{formattedName}</h3>
            )}
            <p className="text-[11px] text-on-surface font-black truncate">{file.size && file.size !== '--' ? `${file.size} • ` : ''}{file.modified}</p>
            {tags.length > 0 && <div className="flex gap-1 mt-1">{tags.slice(0, 4).map(tag => <span key={tag} className="w-2 h-2 rounded-full" style={{ backgroundColor: TAG_COLORS[tag] || '#8e8e93' }} />)}</div>}
          </div>
          {file.type === 'folder' && (
            <ChevronRight className="w-4 h-4 text-on-surface shrink-0" />
          )}
        </motion.div>
      );
    }

    if (displayMode === 'grid') {
      return (
        <motion.div
          key={file.id}
          data-id={file.id}
          draggable
          onDragStart={(e) => handleDragStart(e, file)}
          onDragOver={file.type === 'folder' ? (e) => handleDragOver(e) : undefined}
          onDrop={file.type === 'folder' ? (e) => handleDrop(e, file.id) : undefined}
          title={isLongName ? file.name : undefined}
          onClick={(e) => { e.stopPropagation(); handleSelectFile(file, e); }}
          onDoubleClick={() => handleDoubleClick(file)}
          onContextMenu={(e) => { void handleContextMenu(e, [file.id]); }}
          animate={isPulsing ? { scale: [1, 0.985, 1.01, 1] } : undefined}
          transition={isPulsing ? { duration: 0.26 } : undefined}
          whileHover={{ y: -4 }}
          className={`file-item relative rounded-2xl p-4 flex flex-col justify-between group cursor-pointer transition-all duration-300 border
            ${isPulsing ? 'ring-2 ring-primary/35' : ''}
            ${isSelected ? 'bg-primary/40 border-primary/60 shadow-[0_4px_12px_rgba(var(--primary-rgb),0.2)]' : 'bg-primary/10 border-transparent hover:bg-primary/20 hover:border-primary/20 shadow-sm'}
            ${file.type === 'image' && file.thumbnail ? 'col-span-2 row-span-2 p-0 overflow-hidden' + (!isSelected ? ' !border-none !bg-transparent' : '') : ''}
          `}
          style={{ 
            width: file.type === 'image' && file.thumbnail ? `${(theme.gridWidth || theme.gridSize || 180) * 2 + (theme.gridGap || 16)}px` : `${theme.gridWidth || theme.gridSize || 180}px`,
            height: file.type === 'image' && file.thumbnail ? `${(theme.gridHeight || theme.gridSize || 180) * 2 + (theme.gridGap || 16)}px` : `${theme.gridHeight || theme.gridSize || 180}px`
          }}
        >
          {file.type === 'image' && file.thumbnail && displayMode === 'grid' ? (
            <>
              <img src={file.thumbnail} alt={file.name} className="absolute inset-0 w-full h-full object-cover opacity-80 group-hover:scale-105 transition-transform duration-700" />
              <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent" />
              <div className="absolute bottom-0 left-0 right-0 p-4">
                <div className="flex items-center gap-2 mb-1">
                  {getFileIcon(file.type)}
                  <span className="text-[10px] font-black bg-primary text-on-primary px-1.5 py-0.5 rounded-full shadow-lg">PNG</span>
                </div>
                {renamingFile?.id === file.id ? (
              <input value={renameInput} onChange={e => setRenameInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleRenameSubmit(); if (e.key === 'Escape') handleRenameCancel(); }}
                onBlur={handleRenameSubmit} autoFocus onClick={e => e.stopPropagation()}
                className="text-[14px] font-black text-white bg-black/40 border border-primary rounded-md px-2 py-0.5 outline-none w-full" />
            ) : (
              <h3 className="text-[14px] font-black text-white whitespace-normal break-all line-clamp-3 leading-tight drop-shadow-md">{formattedName}</h3>
            )}
                <p className="text-[11px] text-white/90 font-black mt-1 drop-shadow-sm">{file.size} • {file.modified}</p>
                {tags.length > 0 && <div className="flex gap-1 mt-2">{tags.slice(0, 4).map(tag => <span key={tag} className="w-2 h-2 rounded-full border border-white/40" style={{ backgroundColor: TAG_COLORS[tag] || '#8e8e93' }} />)}</div>}
              </div>
            </>
          ) : (
            <>
              <div className="flex justify-between items-start">
                <div className={`w-10 h-10 rounded-full flex items-center justify-center bg-primary/5 group-hover:bg-primary/10 transition-colors shrink-0`}>
                  {getFileIcon(file.type)}
                </div>
              </div>
              <div className="mt-4 flex-1">
                {renamingFile?.id === file.id ? (
                  <input value={renameInput} onChange={e => setRenameInput(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') handleRenameSubmit(); if (e.key === 'Escape') handleRenameCancel(); }}
                    onBlur={handleRenameSubmit} autoFocus onClick={e => e.stopPropagation()}
                    className="text-[13px] font-black text-on-surface bg-primary/20 border border-primary rounded-md px-2 py-0.5 outline-none w-full" />
                ) : (
                  <h3 className="text-[13px] font-black text-on-surface whitespace-normal break-all line-clamp-3 group-hover:text-primary transition-colors leading-snug">{formattedName}</h3>
                )}
                <p className="text-[10px] text-on-surface font-black mt-1">{file.size} • {file.modified}</p>
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

  const [columnFilesCache, setColumnFilesCache] = useState<Record<string, FileItem[]>>({});

  const loadColumnFiles = (colPath: string) => {
    if (columnFilesCache[colPath]) return;
    listDirectory(colPath, theme.showHiddenFiles).then(entries => {
      setColumnFilesCache(prev => ({ ...prev, [colPath]: entries }));
    }).catch(() => {});
  };

  const getColumnFiles = (parentPath: string | undefined) => {
    if (!parentPath) return files;
    if (columnFilesCache[parentPath]) return columnFilesCache[parentPath];
    loadColumnFiles(parentPath);
    return [];
  };

  const groupedFiles = useMemo<{ [key: string]: FileItem[] }>(() => {
    if (groupBy === 'none') return { 'All Files': currentLevelFiles };

    const groups: { [key: string]: FileItem[] } = {};
    currentLevelFiles.forEach(file => {
      let key = 'Other';
      if (groupBy === 'kind') {
        key = file.type.charAt(0).toUpperCase() + file.type.slice(1);
      } else if (groupBy === 'extension') {
        const ext = file.name.split('.').pop()?.toUpperCase();
        key = ext && ext !== file.name.toUpperCase() ? ext : 'No Extension';
      } else if (groupBy === 'size') {
        const sizeStr = file.size || '0';
        if (sizeStr === '--') key = 'Unknown';
        else {
          const val = parseFloat(sizeStr);
          if (sizeStr.includes('GB')) key = 'Very Large (>1GB)';
          else if (sizeStr.includes('MB')) {
            if (val > 100) key = 'Large (100MB - 1GB)';
            else if (val > 10) key = 'Medium (10MB - 100MB)';
            else key = 'Small (1MB - 10MB)';
          } else key = 'Tiny (<1MB)';
        }
      } else if (groupBy === 'modified') {
        key = file.modified.includes('Just now') ? 'Today' : file.modified.split(' ')[0];
      }
      
      if (!groups[key]) groups[key] = [];
      groups[key].push(file);
    });

    return groups;
  }, [currentLevelFiles, groupBy]);

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
    const currentWindow = getCurrentWindow();
    const primary = targetFiles[0] ?? null;
    const items: Array<Awaited<ReturnType<typeof MenuItem.new>> | Awaited<ReturnType<typeof PredefinedMenuItem.new>>> = [];

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
      const hasClipboard = clipboardRef.current.length > 0;
      items.push(await MenuItem.new({
        text: t('explorer.paste', '粘贴'),
        enabled: hasClipboard,
        action: () => { void handlePasteFromClipboard(); },
      }));
    } else {
      // 第1分组: 打开 + 重命名
      items.push(await MenuItem.new({
        text: t('explorer.open', '打开'),
        action: () => { void handleOpenFile(primary); },
      }));
      items.push(await MenuItem.new({
        text: t('explorer.rename', '重命名'),
        action: () => { void handleRenameStart(primary); },
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
    const newSelection = isBlank ? selectedFileIds : (selectedFileIds.includes(fileIds[0]) ? selectedFileIds : fileIds);
    if (!isBlank && !selectedFileIds.includes(fileIds[0])) onSelectFiles(newSelection);

    if (theme.useSystemContextMenu) {
      const targetFiles = newSelection
        .map(id => files.find(file => file.id === id))
        .filter((file): file is FileItem => Boolean(file));
      await openSystemContextMenu(targetFiles, isBlank, { x: e.clientX, y: e.clientY });
      return;
    }

    setContextMenu({ x: e.clientX, y: e.clientY, fileIds: newSelection, isBlank });
  };

  const openFileActionsMenu = async (e: React.MouseEvent, file: FileItem) => {
    e.preventDefault();
    e.stopPropagation();

    if (theme.useSystemContextMenu) {
      if (!selectedFileIds.includes(file.id)) onSelectFiles([file.id]);
      await openSystemContextMenu([file], false, { x: e.clientX, y: e.clientY });
      return;
    }

    setContextMenu({ x: e.clientX, y: e.clientY, fileIds: [file.id] });
  };

  const refreshCurrentDir = async (fullRefresh = false) => {
    if (fullRefresh) {
      setLoading(true);
      setSearchQuery('');
      setSortConfig(null);
      setGroupBy('none');
    }
    try {
      const entries = await listDirectory(currentPath, theme.showHiddenFiles);
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
    if (file.type === 'folder') {
      navigateToPath(file.path);
    } else {
      invoke('open_path', { path: file.path }).catch(err => console.error('打开失败:', err));
    }
    setContextMenu(null);
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
      const scriptLines = (theme.terminalScripts || []).filter(s => s.trim()).map(s => s.trim());
      const scriptsJoined = scriptLines.join(' && ');
      const args = scriptsJoined || theme.terminalArgs || '';
      await invoke('open_terminal_at', {
        path,
        terminalApp: theme.terminalApp || 'Terminal',
        args,
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
        return <Sparkles className="w-4 h-4 text-primary" />;
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
    const targetDir = prompt('复制到（输入目标目录路径）:', currentPath);
    setActiveDropdown(null);
    if (targetDir) {
      try {
        await Promise.all(targets.map(item => copyFile(item.path, targetDir)));
        refreshCurrentDir();
        showFeedback(`已复制 ${targets.length} 个项目`);
      } catch (e) { showFeedback(`复制失败：${String(e)}`); }
    }
  };

  const handleMoveFile = async (file: FileItem) => {
    const targets = getActionFiles(file);
    const targetDir = prompt('移动到（输入目标目录路径）:', currentPath);
    if (targetDir) {
      try {
        await Promise.all(targets.map(item => moveFile(item.path, targetDir)));
        refreshCurrentDir();
        onSelectFiles([]);
        showFeedback(`已移动 ${targets.length} 个项目`);
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
          await shellOpen(url);
          showFeedback(`已打开链接：${extension.label}`);
        }
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
          <div className={`${displayMode === 'column' ? 'min-w-max h-full' : 'max-w-7xl mx-auto w-full'} h-full min-h-0 flex flex-col space-y-4`}>
            
            {/* Breadcrumbs & Search Area */}
            <div className="flex items-center justify-between gap-3 shrink-0">
              <div className="flex items-center gap-1 mr-1">
                <button
                  onClick={navigateBack}
                  disabled={backStack.length === 0}
                  className={`p-1.5 rounded-lg transition-colors ${backStack.length > 0 ? 'hover:bg-primary/20 text-on-surface/50 hover:text-on-surface' : 'text-on-surface/20 cursor-not-allowed'}`}
                  title={t('tooltips.back')}
                >
                  <ChevronLeft className="w-5 h-5" />
                </button>
                <button
                  onClick={navigateForward}
                  disabled={forwardStack.length === 0}
                  className={`p-1.5 rounded-lg transition-colors ${forwardStack.length > 0 ? 'hover:bg-primary/20 text-on-surface/50 hover:text-on-surface' : 'text-on-surface/20 cursor-not-allowed'}`}
                  title={t('tooltips.forward')}
                >
                  <ChevronRight className="w-5 h-5" />
                </button>
              </div>
              <div className="flex-1 flex items-center bg-primary/5 rounded-xl px-3 py-1.5 border border-transparent h-10 shrink-0 overflow-hidden transition-all duration-300 hover:border-primary/50 hover:shadow-[0_4px_12px_rgba(var(--primary-rgb),0.15)]">
                <button
                  onClick={async () => {
                    await navigator.clipboard.writeText(currentPath);
                  }}
                  className="p-1.5 hover:bg-primary/10 rounded-md transition-colors text-on-surface/50 hover:text-on-surface mr-2 shrink-0"
                  title="Copy Path"
                >
                  <Copy className="w-4 h-4" />
                </button>
                
                {isEditingPath ? (
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
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-on-surface/40 group-hover:text-primary transition-colors" />
                <input 
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder={t('topbar.searchPlaceholder') || "搜索文件..."}
                  className="w-full bg-primary/5 border border-primary/30 rounded-xl py-2 pl-10 pr-4 text-[13px] text-on-surface placeholder:text-on-surface/40 focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary focus:bg-primary/10 transition-all h-10 hover:border-primary/60 shadow-[0_2px_8px_rgba(var(--primary-rgb),0.1)]"
                />
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
                <h2 className="text-[17px] font-bold text-on-surface">
                  {pathSegments.length > 0 ? pathSegments[pathSegments.length - 1] : t('tabs.downloads', 'Downloads')}
                </h2>
                  <div className="flex items-center gap-4">
                  {view !== 'downloads' && <button className="text-[12px] text-primary font-semibold hover:underline">{t('explorer.viewAll')}</button>}
                  
                  {/* Action Capsule */}
          <div className="flex items-center bg-primary/5 p-1 rounded-xl border border-transparent mr-2 relative" ref={dropdownRef}>
                    <button 
                      onClick={() => setActiveDropdown(activeDropdown === 'upload' ? null : 'upload')}
                      className={`p-1.5 hover:bg-primary/10 rounded-lg hover:text-on-surface transition-all active:scale-95 ${activeDropdown === 'upload' ? 'bg-primary/20 text-primary' : 'text-on-surface/60'}`}
                      title={t('tooltips.import')}
                    >
                      <Upload className="w-4 h-4" />
                    </button>
                    <button 
                      onClick={onStartTransfer}
                      className="p-1.5 hover:bg-primary/10 rounded-lg hover:text-on-surface transition-all active:scale-95 text-on-surface/60"
                      title={t('tooltips.transferManager')}
                    >
                      <ExternalLink className="w-4 h-4" />
                    </button>
                    <button 
                      onClick={() => handleOpenTerminal(lastSelectedFile)}
                      className="p-1.5 hover:bg-primary/10 rounded-lg hover:text-on-surface transition-all active:scale-95 text-on-surface/60"
                      title={t('tooltips.openInTerminal')}
                    >
                      <Terminal className="w-4 h-4" />
                    </button>
                    <button 
                      onClick={() => setActiveDropdown(activeDropdown === 'tag' ? null : 'tag')}
                      className={`p-1.5 hover:bg-primary/10 rounded-lg hover:text-on-surface transition-all active:scale-95 ${activeDropdown === 'tag' ? 'bg-primary/20 text-primary' : 'text-on-surface/60'}`}
                      title={t('tooltips.tags')}
                    >
                      <Tag className="w-4 h-4" />
                    </button>
                    <button 
                      onClick={() => setActiveDropdown(activeDropdown === 'group' ? null : 'group')}
                      className={`p-1.5 hover:bg-primary/10 rounded-lg hover:text-on-surface transition-all active:scale-95 ${activeDropdown === 'group' ? 'bg-primary/20 text-primary' : 'text-on-surface/60'}`}
                    >
                      <LayoutGrid className="w-4 h-4" />
                    </button>
                    <button 
                      onClick={() => onThemeChange({ ...theme, showPreviewPanel: !theme.showPreviewPanel })}
                      className={`p-1.5 hover:bg-primary/10 rounded-lg hover:text-on-surface transition-all active:scale-95 ${theme.showPreviewPanel ? 'bg-primary/20 text-primary' : 'text-on-surface/60'}`}
                      title={theme.showPreviewPanel ? "Hide inspector" : "Show inspector"}
                    >
                      {theme.showPreviewPanel ? <PanelRightClose className="w-4 h-4" /> : <PanelRight className="w-4 h-4" />}
                    </button>
                    <button 
                      onClick={() => onThemeChange({ ...theme, showHiddenFiles: !theme.showHiddenFiles })}
                      className={`p-1.5 hover:bg-primary/10 rounded-lg hover:text-on-surface transition-all active:scale-95 ${theme.showHiddenFiles ? 'bg-primary/20 text-primary' : 'text-on-surface/60'}`}
                      title={theme.showHiddenFiles ? "Hide hidden files" : "Show hidden files"}
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
                                <button key={tag} onClick={() => toggleTagForSelection(tag)} className="w-8 h-8 rounded-full border border-white/10 hover:scale-110 transition-transform" style={{ backgroundColor: c }} />
                              ))}
                            </div>
                          )}
                          {activeDropdown === 'group' && (
                            <div className="p-2 space-y-1">
                              {[
                                { id: 'none', label: '不分组' },
                                { id: 'kind', label: '种类' },
                                { id: 'extension', label: '扩展名' },
                                { id: 'size', label: '大小' },
                                { id: 'modified', label: '修改日期' }
                              ].map(item => (
                                <button 
                                  key={item.id}
                                  onClick={() => { setGroupBy(item.id as GroupBy); setActiveDropdown(null); }}
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
                              <button onClick={() => { handleSort('name'); setActiveDropdown(null); }} className="w-full text-left px-3 py-1.5 rounded-lg hover:bg-primary/20 text-[13px]">{t('explorer.sortByName', '按名称排序')}</button>
                              <button onClick={() => { handleSort('modified'); setActiveDropdown(null); }} className="w-full text-left px-3 py-1.5 rounded-lg hover:bg-primary/20 text-[13px]">{t('explorer.sortByModified', '按修改时间排序')}</button>
                              <button onClick={() => { setGroupBy(groupBy === 'none' ? 'kind' : 'none'); setActiveDropdown(null); }} className="w-full text-left px-3 py-1.5 rounded-lg hover:bg-primary/20 text-[13px]">{groupBy === 'none' ? t('explorer.useGroups', '使用群组') : t('explorer.disableGroups', '取消群组')}</button>
                            </div>
                          )}
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>

                  <div className="flex p-1 bg-primary/5 rounded-lg border border-transparent">
                    <button 
                      onClick={() => setDisplayMode('list')}
                      className={`p-1 rounded-sm transition-colors ${displayMode === 'list' ? 'bg-primary/20 text-primary' : 'text-on-surface/40 hover:text-on-surface'}`}
                    >
                      <List className="w-4 h-4" />
                    </button>
                    <button 
                      onClick={() => setDisplayMode('grid')}
                      className={`p-1 rounded-sm transition-colors ${displayMode === 'grid' ? 'bg-primary/20 text-primary' : 'text-on-surface/40 hover:text-on-surface'}`}
                    >
                      <Grid2X2 className="w-4 h-4" />
                    </button>
                    <button 
                      onClick={() => { setDisplayMode('column'); setColumnPaths([]); }}
                      className={`p-1 rounded-sm transition-colors ${displayMode === 'column' ? 'bg-primary/20 text-primary' : 'text-on-surface/40 hover:text-on-surface'}`}
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
              onMouseDown={handleContainerMouseDown}
              onMouseMove={handleContainerMouseMove}
              onMouseUp={handleContainerMouseUp}
              onMouseLeave={handleContainerMouseUp}
              onDragOver={(e) => {
                if (e.dataTransfer.types.includes('Files')) e.preventDefault();
              }}
              onDrop={handleExternalDrop}
              className="relative flex-1 min-h-0 flex flex-col overflow-hidden"
            >
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
              {!loading && !loadError && currentLevelFiles.length === 0 && files.length > 0 && (
                <div className="flex-1 min-h-0 flex items-center justify-center text-on-surface/30 text-sm">没有匹配结果</div>
              )}
              {!loading && !loadError && files.length === 0 && (
                <div className="flex-1 min-h-0 flex items-center justify-center text-on-surface/30 text-sm">此文件夹为空</div>
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
                <div ref={scrollContainerRef} className="relative flex-1 min-h-0 overflow-y-auto overflow-x-hidden pb-32 auto-scrollbar">
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
                            gridTemplateColumns: `repeat(auto-fill, minmax(${theme.gridWidth || theme.gridSize || 180}px, 1fr))`,
                            gap: `${theme.gridGap || 16}px`,
                            gridAutoRows: `${theme.gridHeight || theme.gridSize || 180}px`
                          }}
                        >
                          {files.map((file) => renderFileItem(file))}
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
                <div ref={scrollContainerRef} className="relative flex-1 min-h-0 overflow-y-auto overflow-x-hidden pb-32 auto-scrollbar">
                  <div className="min-w-[760px] flex flex-col">
                    {/* Table Header */}
                    <div className="sticky top-0 z-20 shrink-0 flex items-center px-4 py-3 pr-4 text-[12px] font-black text-on-surface select-none uppercase tracking-[0.1em] border-b border-primary/20 mb-2 bg-primary/10 rounded-t-xl backdrop-blur-xl">
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
                              {files.slice(visibleRange.start, visibleRange.end).map((file) => renderFileItem(file))}
                              <div style={{ height: Math.max(0, visibleRange.totalHeight - visibleRange.end * listItemHeight) }} />
                            </>
                          ) : (
                            files.map((file) => renderFileItem(file))
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
                    
                    // Apply grouping logic to column files too
                    const groupedColumnFiles: { [key: string]: FileItem[] } = {};
                    if (groupBy === 'none') {
                      groupedColumnFiles['All Files'] = filesInCol;
                    } else {
                      filesInCol.forEach(file => {
                        let key = 'Other';
                        if (groupBy === 'kind') key = file.type.charAt(0).toUpperCase() + file.type.slice(1);
                        else if (groupBy === 'extension') {
                          const ext = file.name.split('.').pop()?.toUpperCase();
                          key = ext && ext !== file.name.toUpperCase() ? ext : 'No Extension';
                        } else if (groupBy === 'size') {
                          const sizeStr = file.size || '0';
                          if (sizeStr === '--') key = 'Unknown';
                          else {
                            const val = parseFloat(sizeStr);
                            if (sizeStr.includes('GB')) key = 'Very Large (>1GB)';
                            else if (sizeStr.includes('MB')) key = val > 100 ? 'Large' : (val > 10 ? 'Medium' : 'Small');
                            else key = 'Tiny (<1MB)';
                          }
                        } else if (groupBy === 'modified') key = file.modified.split(' ')[0];
                        
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
                    {getFileIcon(lastSelectedFile.type)}
                    图片预览加载失败
                  </div>
                ) : (
                  <div className="w-full h-full flex items-center justify-center">
                    <div className="transform group-hover:scale-110 transition-transform duration-500">
                      {getFileIcon(lastSelectedFile.type)}
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
          className={`fixed z-[100] w-56 shadow-2xl animate-in fade-in zoom-in-95 duration-200 overflow-hidden ${
            theme.useSystemContextMenu
              ? 'rounded-xl bg-surface/95 border border-on-surface/10 text-on-surface backdrop-blur-xl'
              : 'glass-panel bg-primary/10 border border-primary/20 rounded-2xl backdrop-blur-3xl'
          }`}
          style={contextMenuPosition || undefined}
        >
          <div className="overflow-y-auto scrollbar-hide p-1.5 max-h-[50vh] space-y-0.5">
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
                  disabled={clipboardRef.current.length === 0}
                  className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-[13px] font-bold transition-all ${
                    clipboardRef.current.length === 0
                      ? 'text-on-surface/25 cursor-not-allowed'
                      : 'hover:bg-primary/10 text-on-surface hover:text-primary'
                  }`}
                >
                  <Copy className="w-4 h-4" /> {t('explorer.paste', '粘贴')}
                </button>
              </>
            ) : files.find(f => f.id === contextMenu.fileIds[0]) ? (
              (() => {
                const ctxFile = files.find(f => f.id === contextMenu.fileIds[0])!;
                return (
              <>
                {/* 第1分组: 打开 + 重命名 */}
                <button onClick={() => handleOpenFile(ctxFile)} className="w-full flex items-center gap-3 px-3 py-1.5 rounded-lg hover:bg-primary/10 text-[12px] font-bold transition-all text-on-surface hover:text-primary">
                  <ExternalLink className="w-4 h-4" /> {t('explorer.open', '打开')}
                </button>
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

    </div>
  );
}
