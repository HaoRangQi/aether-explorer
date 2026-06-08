import React, { useCallback, useEffect, useMemo } from 'react';
import type { TFunction } from 'i18next';
import type { FileItem, ThemeSettings } from '../../types';
import type { ExplorerContextMenuState } from './ContextMenu';
import { OPEN_WITH_SUBMENU_CLOSE_DELAY_MS } from './explorer-constants';
import { openExplorerSystemContextMenu } from './system-context-menu';
import type { OpenExplorerSystemContextMenuArgs } from './system-context-menu';

type ContextMenuSize = { key: string; width: number; height: number } | null;

type UseExplorerContextMenuInput = {
  areAllFavorites: OpenExplorerSystemContextMenuArgs['areAllFavorites'];
  areAllTagged: OpenExplorerSystemContextMenuArgs['areAllTagged'];
  clearContextSubmenuCloseTimer: () => void;
  contextMenu: ExplorerContextMenuState | null;
  contextMenuRef: React.RefObject<HTMLDivElement | null>;
  contextMenuSize: ContextMenuSize;
  currentPath: string;
  enabledContextExtensions: OpenExplorerSystemContextMenuArgs['enabledContextExtensions'];
  findFileById: (id: string) => FileItem | undefined;
  focusCurrentWindow: OpenExplorerSystemContextMenuArgs['focusCurrentWindow'];
  getActionDirectory: (preferredPath?: string) => string;
  getActionFiles: OpenExplorerSystemContextMenuArgs['getActionFiles'];
  getTagLabel: OpenExplorerSystemContextMenuArgs['getTagLabel'];
  handleAlias: OpenExplorerSystemContextMenuArgs['handleAlias'];
  handleCompress: OpenExplorerSystemContextMenuArgs['handleCompress'];
  handleCopyNames: OpenExplorerSystemContextMenuArgs['handleCopyNames'];
  handleCopyPaths: OpenExplorerSystemContextMenuArgs['handleCopyPaths'];
  handleCopyToClipboard: OpenExplorerSystemContextMenuArgs['handleCopyToClipboard'];
  handleCutToClipboard: OpenExplorerSystemContextMenuArgs['handleCutToClipboard'];
  handleDecompress: OpenExplorerSystemContextMenuArgs['handleDecompress'];
  handleDeleteFile: OpenExplorerSystemContextMenuArgs['handleDeleteFile'];
  handleExtensionAction: OpenExplorerSystemContextMenuArgs['handleExtensionAction'];
  handleNewFile: OpenExplorerSystemContextMenuArgs['handleNewFile'];
  handleNewFolder: OpenExplorerSystemContextMenuArgs['handleNewFolder'];
  handleOpenFile: OpenExplorerSystemContextMenuArgs['handleOpenFile'];
  handleOpenTerminal: OpenExplorerSystemContextMenuArgs['handleOpenTerminal'];
  handleOpenWith: OpenExplorerSystemContextMenuArgs['handleOpenWith'];
  handleOpenWithOther: OpenExplorerSystemContextMenuArgs['handleOpenWithOther'];
  handlePasteFromClipboard: OpenExplorerSystemContextMenuArgs['handlePasteFromClipboard'];
  handleQuickLook: OpenExplorerSystemContextMenuArgs['handleQuickLook'];
  handleRenameStart: OpenExplorerSystemContextMenuArgs['handleRenameStart'];
  handleRevealInFinder: OpenExplorerSystemContextMenuArgs['handleRevealInFinder'];
  handleSetCurrentAsHome: OpenExplorerSystemContextMenuArgs['handleSetCurrentAsHome'];
  handleShowInspector: OpenExplorerSystemContextMenuArgs['handleShowInspector'];
  handleSort: OpenExplorerSystemContextMenuArgs['handleSort'];
  handleToggleFavoriteForItems: OpenExplorerSystemContextMenuArgs['handleToggleFavoriteForItems'];
  isRemoteRoot: boolean;
  onSelectFiles: (ids: string[]) => void;
  refreshCurrentDir: OpenExplorerSystemContextMenuArgs['refreshCurrentDir'];
  refreshFileClipboardState: OpenExplorerSystemContextMenuArgs['refreshFileClipboardState'];
  selectedFileIds: string[];
  setContextMenu: React.Dispatch<React.SetStateAction<ExplorerContextMenuState | null>>;
  setContextMenuSize: React.Dispatch<React.SetStateAction<ContextMenuSize>>;
  setContextSubmenu: React.Dispatch<React.SetStateAction<string | null>>;
  setShowAIRename: OpenExplorerSystemContextMenuArgs['setShowAIRename'];
  setShowOperationHistory: OpenExplorerSystemContextMenuArgs['setShowOperationHistory'];
  showFeedback: OpenExplorerSystemContextMenuArgs['showFeedback'];
  submenuCloseTimerRef: React.MutableRefObject<number | null>;
  t: TFunction;
  theme: ThemeSettings;
  toggleTagForItems: OpenExplorerSystemContextMenuArgs['toggleTagForItems'];
};

export default function useExplorerContextMenu({
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
  handleOpenTerminal,
  handleOpenWith,
  handleOpenWithOther,
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
}: UseExplorerContextMenuInput) {
  const openContextSubmenu = useCallback((submenu: string) => {
    clearContextSubmenuCloseTimer();
    setContextSubmenu(submenu);
  }, [clearContextSubmenuCloseTimer, setContextSubmenu]);

  const scheduleContextSubmenuClose = useCallback((submenu: string) => {
    clearContextSubmenuCloseTimer();
    submenuCloseTimerRef.current = window.setTimeout(() => {
      submenuCloseTimerRef.current = null;
      setContextSubmenu(prev => (prev === submenu ? null : prev));
    }, OPEN_WITH_SUBMENU_CLOSE_DELAY_MS);
  }, [clearContextSubmenuCloseTimer, setContextSubmenu, submenuCloseTimerRef]);

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

    return { left, top, maxHeight };
  }, [contextMenu, contextMenuKey, contextMenuSize]);

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
  }, [contextMenu, contextMenuKey, contextMenuRef, setContextMenuSize]);

  const openSystemContextMenu = useCallback(async (
    targetFiles: FileItem[],
    isBlank = false,
    position?: { x: number; y: number },
    targetDir?: string,
  ) => {
    await openExplorerSystemContextMenu({
      areAllFavorites,
      areAllTagged,
      currentPath,
      enabledContextExtensions,
      focusCurrentWindow,
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
      handleOpenTerminal,
      handleOpenWith,
      handleOpenWithOther,
      handlePasteFromClipboard,
      handleQuickLook,
      handleRenameStart,
      handleRevealInFinder,
      handleSetCurrentAsHome,
      handleShowInspector,
      handleSort,
      handleToggleFavoriteForItems,
      isBlank,
      isRemoteRoot,
      position,
      refreshCurrentDir,
      refreshFileClipboardState,
      setShowAIRename,
      setShowOperationHistory,
      showFeedback,
      t,
      targetDir,
      targetFiles,
      theme,
      toggleTagForItems,
    });
  }, [
    areAllFavorites,
    areAllTagged,
    currentPath,
    enabledContextExtensions,
    focusCurrentWindow,
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
    handleOpenTerminal,
    handleOpenWith,
    handleOpenWithOther,
    handlePasteFromClipboard,
    handleQuickLook,
    handleRenameStart,
    handleRevealInFinder,
    handleSetCurrentAsHome,
    handleShowInspector,
    handleSort,
    handleToggleFavoriteForItems,
    isRemoteRoot,
    refreshCurrentDir,
    refreshFileClipboardState,
    setShowAIRename,
    setShowOperationHistory,
    showFeedback,
    t,
    theme,
    toggleTagForItems,
  ]);

  const handleContextMenu = useCallback(async (
    event: React.MouseEvent,
    fileIds: string[],
    isBlank = false,
    targetDir?: string,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    await focusCurrentWindow();
    const newSelection = isBlank
      ? selectedFileIds
      : (selectedFileIds.includes(fileIds[0]) ? selectedFileIds : fileIds);
    if (!isBlank && !selectedFileIds.includes(fileIds[0])) onSelectFiles(newSelection);
    const blankTargetDir = isBlank ? getActionDirectory(targetDir) : undefined;

    if (theme.useSystemContextMenu) {
      const targetFiles = newSelection
        .map(id => findFileById(id))
        .filter((file): file is FileItem => Boolean(file));
      await openSystemContextMenu(targetFiles, isBlank, { x: event.clientX, y: event.clientY }, blankTargetDir);
      return;
    }

    if (isBlank) void refreshFileClipboardState();
    clearContextSubmenuCloseTimer();
    setContextSubmenu(null);
    setContextMenu({ x: event.clientX, y: event.clientY, fileIds: newSelection, isBlank, targetDir: blankTargetDir });
  }, [
    clearContextSubmenuCloseTimer,
    findFileById,
    focusCurrentWindow,
    getActionDirectory,
    onSelectFiles,
    openSystemContextMenu,
    refreshFileClipboardState,
    selectedFileIds,
    setContextMenu,
    setContextSubmenu,
    theme.useSystemContextMenu,
  ]);

  const openFileActionsMenu = useCallback(async (event: React.MouseEvent, file: FileItem) => {
    event.preventDefault();
    event.stopPropagation();
    await focusCurrentWindow();

    if (theme.useSystemContextMenu) {
      if (!selectedFileIds.includes(file.id)) onSelectFiles([file.id]);
      await openSystemContextMenu([file], false, { x: event.clientX, y: event.clientY });
      return;
    }

    clearContextSubmenuCloseTimer();
    setContextSubmenu(null);
    setContextMenu({ x: event.clientX, y: event.clientY, fileIds: [file.id] });
  }, [
    clearContextSubmenuCloseTimer,
    focusCurrentWindow,
    onSelectFiles,
    openSystemContextMenu,
    selectedFileIds,
    setContextMenu,
    setContextSubmenu,
    theme.useSystemContextMenu,
  ]);

  return {
    contextMenuPosition,
    handleContextMenu,
    openContextSubmenu,
    openFileActionsMenu,
    scheduleContextSubmenuClose,
  };
}
