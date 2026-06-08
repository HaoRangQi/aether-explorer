import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type React from 'react';
import type { TFunction } from 'i18next';
import {
  buildFileLookup,
  resolveLastSelectedFile,
  resolveSelectedFiles,
} from '../../lib/file-selection';
import { useDebouncedValue } from '../../lib/use-debounced-value';
import type { ContextMenuAction, DisplayMode, FileItem, GroupBy, ThemeSettings } from '../../types';
import { parseModifiedTimestamp, parseSizeToBytes } from './explorer-utils';

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

type UseExplorerStateInput = {
  appIconMap: Record<string, string>;
  columnFilesCache: Record<string, FileItem[]>;
  currentPath: string;
  displayMode: DisplayMode;
  favoriteFiles: FileItem[];
  files: FileItem[];
  folderSizeEstimateMap: Record<string, string>;
  groupBy: GroupBy;
  isFavoritesRoot: boolean;
  isRecentRoot: boolean;
  isRemoteRoot: boolean;
  isTagRoot: boolean;
  isVirtualRoot: boolean;
  loading: boolean;
  mediaDurationMap: Record<string, string>;
  recentFiles: FileItem[];
  scrollContainerRef: React.RefObject<HTMLDivElement | null>;
  searchQuery: string;
  selectedFileIds: string[];
  sortConfig: SortConfig;
  taggedFiles: FileItem[];
  theme: ThemeSettings;
  t: TFunction;
  getFileTypeLabel: (type: FileItem['type']) => string;
  getTagLabel: (tagId: string) => string;
};

const DENSITY_HEIGHTS: Record<NonNullable<ThemeSettings['listDensity']>, number> = {
  ultra: 28,
  compact: 36,
  normal: 44,
  relaxed: 60,
};

const LIST_ITEM_GAP = 8;
const LIST_OVERSCAN = 10;
const VIRTUAL_LIST_THRESHOLD = 80;

export default function useExplorerState(input: UseExplorerStateInput) {
  const {
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
  } = input;

  const displayedFiles = isFavoritesRoot
    ? favoriteFiles
    : isRecentRoot
      ? recentFiles
      : isTagRoot
        ? taggedFiles
        : files;
  const hasDisplayableFiles = displayedFiles.length > 0;
  const showBlockingLoading = loading && (!isRemoteRoot || !hasDisplayableFiles);
  const folderSizeEstimateEnabled = theme.showFolderSizeInList !== false;

  const filesWithFolderSizeEstimates = useMemo(() => {
    if (!folderSizeEstimateEnabled || displayMode !== 'list') return displayedFiles;
    return displayedFiles.map(file => {
      if (file.type !== 'folder') return file;
      const estimated = folderSizeEstimateMap[file.path];
      if (!estimated || estimated === file.size) return file;
      return { ...file, size: estimated };
    });
  }, [displayMode, displayedFiles, folderSizeEstimateEnabled, folderSizeEstimateMap]);

  const filesWithAppIcons = useMemo(() => filesWithFolderSizeEstimates.map(file => (
    file.type === 'application' && appIconMap[file.path]
      ? { ...file, thumbnail: appIconMap[file.path] }
      : file
  )), [filesWithFolderSizeEstimates, appIconMap]);

  const filesWithMediaMetadata = useMemo(() => filesWithAppIcons.map(file => (
    file.type === 'video' && mediaDurationMap[file.path]
      ? { ...file, duration: mediaDurationMap[file.path] }
      : file
  )), [filesWithAppIcons, mediaDurationMap]);

  const selectableFiles = useMemo(() => {
    const filesById = new Map<string, FileItem>();
    filesWithMediaMetadata.forEach(file => filesById.set(file.id, file));
    Object.keys(columnFilesCache).forEach(columnPath => {
      const columnFiles = columnFilesCache[columnPath];
      columnFiles.forEach(file => filesById.set(file.id, file));
    });
    return Array.from(filesById.values());
  }, [columnFilesCache, filesWithMediaMetadata]);

  const fileLookup = useMemo(() => buildFileLookup(selectableFiles), [selectableFiles]);
  const selectedFiles = useMemo(() => (
    resolveSelectedFiles(selectedFileIds, fileLookup)
  ), [selectedFileIds, fileLookup]);
  const lastSelectedFile = useMemo(() => (
    resolveLastSelectedFile(selectedFileIds, fileLookup)
  ), [selectedFileIds, fileLookup]);

  const isAdminContextMenuEmpty = useMemo(() => !(theme.contextMenuExtensions || []).some(ext => ext.enabled), [theme.contextMenuExtensions]);
  const enabledContextExtensions = useMemo<ContextMenuAction[]>(() => (theme.contextMenuExtensions || []).filter(ext => ext.enabled), [theme.contextMenuExtensions]);
  const debouncedSearchQuery = useDebouncedValue(searchQuery, 150);

  const currentLevelFiles = useMemo(() => {
    const normalizedSearchQuery = debouncedSearchQuery.toLowerCase();
    let filtered = filesWithMediaMetadata.filter(file => {
      if (isVirtualRoot) {
        return file.name.toLowerCase().includes(normalizedSearchQuery);
      }
      return file.name.toLowerCase().includes(normalizedSearchQuery);
    });

    if (sortConfig) {
      filtered = [...filtered].sort((a, b) => {
        let result = 0;
        if (sortConfig.key === 'modified') {
          const tsA = parseModifiedTimestamp(a.modified);
          const tsB = parseModifiedTimestamp(b.modified);
          result = tsA - tsB;
        } else if (sortConfig.key === 'size') {
          const sizeA = parseSizeToBytes(a.size);
          const sizeB = parseSizeToBytes(b.size);
          result = sizeA - sizeB;
        } else {
          const valA = String((a as Record<string, unknown>)[sortConfig.key] || '').toLowerCase();
          const valB = String((b as Record<string, unknown>)[sortConfig.key] || '').toLowerCase();
          if (valA < valB) result = -1;
          else if (valA > valB) result = 1;
        }
        if (result < 0) return sortConfig.direction === 'asc' ? -1 : 1;
        if (result > 0) return sortConfig.direction === 'asc' ? 1 : -1;
        const fallbackA = a.name.toLowerCase();
        const fallbackB = b.name.toLowerCase();
        if (fallbackA < fallbackB) return -1;
        if (fallbackA > fallbackB) return 1;
        return 0;
      });
    }

    return filtered;
  }, [filesWithMediaMetadata, debouncedSearchQuery, sortConfig, isVirtualRoot]);

  const listItemHeight = (DENSITY_HEIGHTS[theme.listDensity || 'normal'] || 44) + LIST_ITEM_GAP;
  const fileListRef = useRef<HTMLDivElement>(null);
  const [fileListOffset, setFileListOffset] = useState(0);
  const [scrollTop, setScrollTop] = useState(0);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const scrollEl = scrollContainerRef.current;
    if (fileListRef.current && scrollEl) {
      const listTop = fileListRef.current.getBoundingClientRect().top;
      const scrollTop2 = scrollEl.getBoundingClientRect().top;
      setFileListOffset(listTop - scrollTop2 + scrollEl.scrollTop);
    }
  }, [currentPath, scrollContainerRef]);

  const visibleRange = useMemo<VisibleRange | null>(() => {
    if (displayMode !== 'list') return null;
    if (groupBy !== 'none') return null;
    if (currentLevelFiles.length < VIRTUAL_LIST_THRESHOLD) return null;
    const containerH = scrollContainerRef.current?.clientHeight || 600;
    const adjustedTop = Math.max(0, scrollTop - fileListOffset);
    const start = Math.max(0, Math.floor(adjustedTop / listItemHeight) - LIST_OVERSCAN);
    const end = Math.min(currentLevelFiles.length, Math.ceil((adjustedTop + containerH) / listItemHeight) + LIST_OVERSCAN);
    if (start >= end) return null;
    return { start, end, totalHeight: currentLevelFiles.length * listItemHeight, offsetTop: start * listItemHeight };
  }, [scrollTop, currentLevelFiles.length, listItemHeight, displayMode, groupBy, fileListOffset, scrollContainerRef]);

  const handleContainerScroll = () => {
    if (displayMode !== 'list') return;
    if (rafRef.current) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      const el = scrollContainerRef.current;
      if (el) setScrollTop(el.scrollTop);
    });
  };

  useEffect(() => () => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
  }, []);

  const groupOptions = useMemo<Array<{ id: GroupBy; label: string }>>(() => [
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
  ], [t]);

  const getDateGroup = useCallback((value?: string) => {
    if (!value) return t('explorer.groupUnknown', '未知');
    return value.split(' ')[0] || t('explorer.groupUnknown', '未知');
  }, [t]);

  const getSizeGroup = useCallback((file: FileItem) => {
    const size = file.size || '';
    if (!size || size === '--') return t('explorer.groupSizeUnknown', '未知大小');

    const parsed = Number.parseFloat(size);
    if (Number.isNaN(parsed)) return t('explorer.groupSizeUnknown', '未知大小');
    const normalized = size.trim().toUpperCase();
    const hasHugeUnit = /(?:^|\s)(?:T|TB|G|GB)$/.test(normalized);
    const hasMediumUnit = /(?:^|\s)(?:M|MB)$/.test(normalized);
    const hasSmallUnit = /(?:^|\s)(?:K|KB)$/.test(normalized);

    if (hasHugeUnit) {
      return t('explorer.groupSizeHuge', '超大');
    }
    if (hasMediumUnit) {
      if (parsed >= 100) return t('explorer.groupSizeLarge', '大');
      if (parsed >= 10) return t('explorer.groupSizeMedium', '中');
      return t('explorer.groupSizeSmall', '小');
    }
    if (hasSmallUnit) {
      return parsed >= 1024 ? t('explorer.groupSizeMedium', '中') : t('explorer.groupSizeSmall', '小');
    }

    return t('explorer.groupSizeSmall', '小');
  }, [t]);

  const getGroupKey = useCallback((file: FileItem, mode: GroupBy) => {
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
  }, [getDateGroup, getFileTypeLabel, getSizeGroup, getTagLabel, t]);

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
  }, [currentLevelFiles, getGroupKey, groupBy, t]);

  return {
    currentLevelFiles,
    displayedFiles,
    enabledContextExtensions,
    fileListRef,
    folderSizeEstimateEnabled,
    fileListOffset,
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
  };
}
