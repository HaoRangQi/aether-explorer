import { useCallback, useEffect, useRef } from 'react';
import type React from 'react';
import type { TFunction } from 'i18next';
import { resolveAdjacentSelectedFile } from '../../lib/file-selection';
import { resolveExplorerShortcut, resolveNextTypeaheadQuery, resolveTypeaheadTarget } from '../../lib/keyboard-shortcuts';
import { resolveColumnPathsAfterFolderSelection } from '../../lib/column-navigation';
import { getParentPath, isRemotePath, isVirtualPath } from '../../lib/path-helpers';
import type { DisplayMode, FileItem, GroupBy, ThemeSettings } from '../../types';

type UseExplorerKeyboardInput = {
  containerRef: React.RefObject<HTMLDivElement | null>;
  currentLevelFiles: FileItem[];
  currentPath: string;
  displayMode: DisplayMode;
  fileListOffset: number;
  getActionDirectory: (preferredPath?: string) => string;
  groupBy: GroupBy;
  handleCopyToClipboard: (items?: FileItem[]) => Promise<void>;
  handleCutToClipboard: (items?: FileItem[]) => Promise<void>;
  handleDeleteFile: (file: FileItem) => Promise<void>;
  handleOpenFile: (file: FileItem) => void;
  handlePasteFromClipboard: (targetPath?: string) => Promise<void>;
  handleQuickLook: (file?: FileItem) => Promise<void>;
  isActive: boolean;
  isRemoteRoot: boolean;
  lastActivatedFileId: string | null;
  lastSelectedFile: FileItem | null;
  listItemHeight: number;
  navigateBack: () => void;
  navigateForward: () => void;
  navigateToPath: (path: string, options?: { replace?: boolean }) => void;
  onSelectFiles: (ids: string[]) => void;
  onThemeChange: (theme: ThemeSettings) => void;
  refreshCurrentDirRef: React.MutableRefObject<(fullRefresh?: boolean, targetPath?: string) => Promise<FileItem[]>>;
  renamingFileId: string | null;
  resetColumnState: () => void;
  scrollContainerRef: React.RefObject<HTMLDivElement | null>;
  selectedFileIds: string[];
  selectedFileIdsRef: React.MutableRefObject<string[]>;
  selectedFiles: FileItem[];
  setActiveDropdown: React.Dispatch<React.SetStateAction<string | null>>;
  setColumnPaths: React.Dispatch<React.SetStateAction<string[]>>;
  setContextMenu: React.Dispatch<React.SetStateAction<null>>;
  setContextSubmenu: React.Dispatch<React.SetStateAction<string | null>>;
  setDisplayMode: React.Dispatch<React.SetStateAction<DisplayMode>>;
  setLastActivatedFileId: React.Dispatch<React.SetStateAction<string | null>>;
  setPulseFileId: React.Dispatch<React.SetStateAction<string | null>>;
  setShowAIRename: React.Dispatch<React.SetStateAction<boolean>>;
  setTypeaheadQuery: React.Dispatch<React.SetStateAction<string>>;
  showFeedback: (message: string) => void;
  t: TFunction;
  theme: ThemeSettings;
  typeaheadQuery: string;
};

const PULSE_VISIBLE_MS = 260;
const TYPEAHEAD_RESET_MS = 700;

export default function useExplorerKeyboard({
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
  renamingFileId,
  resetColumnState,
  scrollContainerRef,
  selectedFileIds,
  selectedFileIdsRef,
  selectedFiles,
  setActiveDropdown,
  setColumnPaths,
  setContextMenu,
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
}: UseExplorerKeyboardInput) {
  const pulseTimerRef = useRef<number | null>(null);
  const typeaheadTimerRef = useRef<number | null>(null);
  const focusFileByPrefixRef = useRef<(prefix: string) => void>(() => {});

  const clearPulseTimer = useCallback(() => {
    if (!pulseTimerRef.current) return;
    window.clearTimeout(pulseTimerRef.current);
    pulseTimerRef.current = null;
  }, []);

  const clearTypeaheadTimer = useCallback(() => {
    if (!typeaheadTimerRef.current) return;
    window.clearTimeout(typeaheadTimerRef.current);
    typeaheadTimerRef.current = null;
  }, []);

  const pulseFile = useCallback((fileId: string) => {
    setLastActivatedFileId(fileId);
    setPulseFileId(fileId);
    clearPulseTimer();
    pulseTimerRef.current = window.setTimeout(() => {
      setPulseFileId(null);
      pulseTimerRef.current = null;
    }, PULSE_VISIBLE_MS);
  }, [clearPulseTimer, setLastActivatedFileId, setPulseFileId]);

  const scrollFileIntoView = useCallback((fileId: string, fileIndex = -1, attempt = 0) => {
    window.requestAnimationFrame(() => {
      const surface = containerRef.current;
      if (!surface) return;
      const target = Array.from(surface.querySelectorAll('.file-item') as NodeListOf<HTMLElement>)
        .find(element => element.dataset.id === fileId);
      if (!target && displayMode === 'list' && groupBy === 'none' && fileIndex >= 0 && scrollContainerRef.current) {
        const scrollParent = scrollContainerRef.current;
        const nextTop = Math.max(
          0,
          fileListOffset + (fileIndex * listItemHeight) - (scrollParent.clientHeight / 2) + (listItemHeight / 2),
        );
        scrollParent.scrollTo({ top: nextTop, behavior: attempt === 0 ? 'auto' : 'smooth' });
        if (attempt < 4) {
          scrollFileIntoView(fileId, fileIndex, attempt + 1);
        }
        return;
      }
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
  }, [containerRef, displayMode, fileListOffset, groupBy, listItemHeight, scrollContainerRef]);

  const focusFileByPrefix = useCallback((prefix: string) => {
    if (!prefix || currentLevelFiles.length === 0) return;
    const next = resolveTypeaheadTarget<FileItem>(
      currentLevelFiles,
      prefix,
      selectedFileIds[selectedFileIds.length - 1],
      lastActivatedFileId || undefined,
    );
    if (!next) return;
    onSelectFiles([next.id]);
    pulseFile(next.id);
    if (next.type === 'folder' && displayMode === 'column') {
      setColumnPaths(paths => resolveColumnPathsAfterFolderSelection(paths, next.path, 0));
    }
    scrollFileIntoView(next.id, currentLevelFiles.findIndex(file => file.id === next.id));
    clearTypeaheadTimer();
    typeaheadTimerRef.current = window.setTimeout(() => {
      setTypeaheadQuery('');
      typeaheadTimerRef.current = null;
    }, TYPEAHEAD_RESET_MS);
  }, [
    clearTypeaheadTimer,
    currentLevelFiles,
    displayMode,
    lastActivatedFileId,
    onSelectFiles,
    pulseFile,
    scrollFileIntoView,
    selectedFileIds,
    setColumnPaths,
    setTypeaheadQuery,
  ]);
  focusFileByPrefixRef.current = focusFileByPrefix;

  const handleDoubleClick = useCallback((file: FileItem) => {
    if (renamingFileId === file.id) return;
    pulseFile(file.id);
    if ((file.type === 'folder' || file.type === 'remote-unknown') && isRemotePath(file.path)) {
      navigateToPath(file.path);
    } else if (file.type === 'folder' && displayMode !== 'column') {
      navigateToPath(file.path);
    } else if (file.type !== 'folder') {
      handleOpenFile(file);
    }
  }, [displayMode, handleOpenFile, navigateToPath, pulseFile, renamingFileId]);

  useEffect(() => {
    if (!isActive) return undefined;
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const isTyping = !!target?.closest('input, textarea, select, [contenteditable="true"]');
      if (isTyping) return;

      const action = resolveExplorerShortcut(e, {
        hasSelection: selectedFiles.length > 0,
        hasLastSelectedFile: Boolean(lastSelectedFile),
        lastSelectedFileIsFolder: lastSelectedFile?.type === 'folder',
        spacePreviewEnabled: theme.enableSpacePreview !== false,
      });
      if (!action) return;

      e.preventDefault();

      if (action === 'aiRename') {
        if (isRemoteRoot || selectedFiles.some(file => isRemotePath(file.path))) {
          showFeedback(t('messages.remoteReadOnly', { defaultValue: '远程访问第一版仅支持浏览。' }));
          return;
        }
        setShowAIRename(true);
      } else if (action === 'selectAll') {
        onSelectFiles(currentLevelFiles.map(f => f.id));
      } else if (action === 'copy') {
        void handleCopyToClipboard();
      } else if (action === 'cut') {
        void handleCutToClipboard();
      } else if (action === 'paste') {
        void handlePasteFromClipboard();
      } else if (action === 'showInfo') {
        onThemeChange({ ...theme, showPreviewPanel: true });
      } else if (action === 'refresh') {
        void refreshCurrentDirRef.current(true, getActionDirectory() || undefined);
      } else if (action === 'showListView') {
        setDisplayMode('list');
      } else if (action === 'showGridView') {
        setDisplayMode('grid');
      } else if (action === 'showColumnView') {
        setDisplayMode('column');
        resetColumnState();
      } else if (action === 'toggleHiddenFiles') {
        resetColumnState();
        onThemeChange({ ...theme, showHiddenFiles: !theme.showHiddenFiles });
      } else if (action === 'back') {
        navigateBack();
      } else if (action === 'forward') {
        navigateForward();
      } else if (action === 'navigateParent') {
        const parentSource = getActionDirectory() || currentPath;
        if (!parentSource || isVirtualPath(parentSource)) return;
        const parent = getParentPath(parentSource);
        if (parent !== parentSource) navigateToPath(parent);
      } else if ((action === 'openFolder' || action === 'openSelection') && lastSelectedFile) {
        handleOpenFile(lastSelectedFile);
      } else if (action === 'deleteSelection' && selectedFiles.length > 0) {
        void handleDeleteFile(selectedFiles[0]);
      } else if (action === 'quickLook' && lastSelectedFile) {
        void handleQuickLook(lastSelectedFile);
      } else if (action === 'typeahead') {
        const nextQuery = resolveNextTypeaheadQuery(typeaheadQuery, e.key);
        setTypeaheadQuery(nextQuery);
        focusFileByPrefixRef.current(nextQuery);
      } else if (action === 'selectNext' || action === 'selectPrevious') {
        const nextFile = resolveAdjacentSelectedFile(
          currentLevelFiles,
          selectedFileIdsRef.current,
          action === 'selectNext' ? 'next' : 'previous',
        );
        if (nextFile) {
          onSelectFiles([nextFile.id]);
          const el = document.querySelector(`[data-id="${nextFile.id}"]`);
          el?.scrollIntoView({ block: 'nearest' });
        }
      } else if (action === 'escape') {
        setActiveDropdown(null);
        setContextMenu(null);
        setContextSubmenu(null);
        onSelectFiles([]);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    currentLevelFiles,
    currentPath,
    getActionDirectory,
    handleCopyToClipboard,
    handleCutToClipboard,
    handleDeleteFile,
    handleOpenFile,
    handlePasteFromClipboard,
    handleQuickLook,
    isActive,
    isRemoteRoot,
    lastSelectedFile,
    navigateBack,
    navigateForward,
    navigateToPath,
    onSelectFiles,
    onThemeChange,
    refreshCurrentDirRef,
    resetColumnState,
    selectedFiles,
    selectedFileIdsRef,
    setActiveDropdown,
    setContextMenu,
    setContextSubmenu,
    setDisplayMode,
    setShowAIRename,
    setTypeaheadQuery,
    showFeedback,
    t,
    theme,
    typeaheadQuery,
  ]);

  useEffect(() => () => {
    clearPulseTimer();
    clearTypeaheadTimer();
  }, [clearPulseTimer, clearTypeaheadTimer]);

  return {
    handleDoubleClick,
  };
}
