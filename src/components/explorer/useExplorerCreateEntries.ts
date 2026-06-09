import React, { useCallback } from 'react';
import type { TFunction } from 'i18next';
import { createFile, createFolder, createTextFile, readClipboardText } from '../../api/filesystem';
import { isRemotePath } from '../../lib/path-helpers';
import type { FileItem, ThemeSettings } from '../../types';
import { FAVORITES_VIRTUAL_PATH } from './explorer-constants';
import type { ManualHistoryRecordInput } from './explorer-types';
import { buildTimestampTextFileName, formatAppError, getItemDirectory } from './explorer-utils';

type UseExplorerCreateEntriesInput = {
  contextMenuTargetDir?: string;
  createEntryClickTimerRef: React.MutableRefObject<number | null>;
  createEntryWindowLockRef: React.MutableRefObject<boolean>;
  createEntryWindowLockTimerRef: React.MutableRefObject<number | null>;
  currentPath: string;
  getActionDirectory: (preferredPath?: string) => string;
  getDirectoryEntries: (targetPath: string) => FileItem[];
  isRemoteRoot: boolean;
  listItemHeight: number;
  onCreateWindow?: (path: string, label: string) => void;
  onOpenTab?: (id: string, titleKey: string, options?: { label?: string; initialPath?: string }) => void;
  onSelectFiles: (ids: string[]) => void;
  onThemeChange: (theme: ThemeSettings) => void;
  recordManualOperationHistory: (input: ManualHistoryRecordInput) => Promise<void>;
  refreshCurrentDir: (fullRefresh?: boolean, targetPath?: string) => Promise<FileItem[]>;
  scrollContainerRef: React.RefObject<HTMLDivElement | null>;
  setActiveDropdown: (value: string | null) => void;
  setContextMenu: (value: null) => void;
  setRenameInput: (value: string) => void;
  setRenamingFile: React.Dispatch<React.SetStateAction<FileItem | null>>;
  showFeedback: (message: string) => void;
  t: TFunction;
  theme: ThemeSettings;
};

function scrollToCreatedEntry(
  created: FileItem,
  createdPath: string,
  entries: FileItem[],
  listItemHeight: number,
  scrollContainerRef: React.RefObject<HTMLDivElement | null>,
) {
  const tryScroll = (attempts = 0) => {
    const el = document.querySelector(`[data-id="${created.id}"]`);
    if (el) {
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      return;
    }
    if (scrollContainerRef.current && attempts === 0) {
      const idx = entries.findIndex(file => file.path === createdPath);
      if (idx >= 0) {
        scrollContainerRef.current.scrollTo({ top: idx * listItemHeight, behavior: 'auto' });
      }
    }
    if (attempts < 5) {
      requestAnimationFrame(() => tryScroll(attempts + 1));
    }
  };

  requestAnimationFrame(() => tryScroll());
}

export default function useExplorerCreateEntries({
  contextMenuTargetDir,
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
}: UseExplorerCreateEntriesInput) {
  const resolveWritableTarget = useCallback((targetPath?: string) => {
    const requestedTarget = targetPath || contextMenuTargetDir || currentPath;
    if (isRemoteRoot || isRemotePath(requestedTarget)) {
      showFeedback(t('messages.remoteReadOnly', { defaultValue: '远程访问第一版仅支持浏览。' }));
      setContextMenu(null);
      return null;
    }
    const targetDir = getActionDirectory(targetPath || contextMenuTargetDir);
    if (!targetDir) {
      showFeedback(t('messages.crossWindowNoTarget', {
        defaultValue: '当前没有可作为目标的真实目录',
      }));
      setContextMenu(null);
      return null;
    }
    return targetDir;
  }, [contextMenuTargetDir, currentPath, getActionDirectory, isRemoteRoot, setContextMenu, showFeedback, t]);

  const handleNewFile = useCallback(async (targetPath?: string) => {
    setActiveDropdown(null);
    const targetDir = resolveWritableTarget(targetPath);
    if (!targetDir) return;

    const baseName = t('filenames.newFile', { defaultValue: '新建文件.txt' });
    const existing = new Set(getDirectoryEntries(targetDir).map(file => file.name));
    let name = baseName;
    let index = 2;
    while (existing.has(name)) {
      name = t('filenames.newFileIndexed', {
        index,
        defaultValue: `新建文件 ${index}.txt`,
      });
      index += 1;
    }

    try {
      const createdPath = await createFile(targetDir, name);
      await recordManualOperationHistory({
        category: 'create-file',
        title: '新建文件',
        summary: `${name}`,
        effects: [{
          op: { type: 'create_file', parentDir: targetDir, name },
          status: 'ok',
          reverseOp: { type: 'trash', path: createdPath },
        }],
        primaryPath: createdPath,
        targetPath: targetDir,
      });
      const entries = await refreshCurrentDir(false, targetDir);
      const created = entries.find(file => file.path === createdPath);
      if (created) {
        onSelectFiles([created.id]);
        setRenamingFile(created);
        setRenameInput(created.name);
        scrollToCreatedEntry(created, createdPath, entries, listItemHeight, scrollContainerRef);
      }
      showFeedback(t('messages.fileCreated', { name, defaultValue: `已创建文件：${name}` }));
    } catch (error) {
      await recordManualOperationHistory({
        category: 'create-file',
        title: '新建文件',
        summary: `${name}`,
        effects: [{
          op: { type: 'create_file', parentDir: targetDir, name },
          status: 'fail',
          note: formatAppError(error),
        }],
        status: 'failed',
        canUndo: false,
        reasonNotUndoable: `创建失败：${formatAppError(error)}`,
        targetPath: targetDir,
      });
      showFeedback(t('messages.fileCreateFailed', {
        error: formatAppError(error),
        defaultValue: `创建文件失败：${formatAppError(error)}`,
      }));
    }
    setContextMenu(null);
  }, [
    getDirectoryEntries,
    listItemHeight,
    onSelectFiles,
    recordManualOperationHistory,
    refreshCurrentDir,
    resolveWritableTarget,
    scrollContainerRef,
    setActiveDropdown,
    setContextMenu,
    setRenameInput,
    setRenamingFile,
    showFeedback,
    t,
  ]);

  const handleSetCurrentAsHome = useCallback(() => {
    if (!currentPath) return;
    if (isRemoteRoot) {
      showFeedback(t('messages.remoteReadOnly', { defaultValue: '远程访问第一版仅支持浏览。' }));
      setContextMenu(null);
      return;
    }
    onThemeChange({ ...theme, defaultHomePath: currentPath });
    showFeedback(t('messages.setAsHome', {
      defaultValue: '已将当前位置设为首页',
    }));
    setContextMenu(null);
  }, [currentPath, isRemoteRoot, onThemeChange, setContextMenu, showFeedback, t, theme]);

  const handlePasteAsTextFile = useCallback(async (targetPath?: string) => {
    setActiveDropdown(null);
    const targetDir = resolveWritableTarget(targetPath);
    if (!targetDir) return;

    let content = '';
    try {
      content = await readClipboardText();
    } catch (error) {
      showFeedback(t('messages.clipboardReadFailed', {
        error: formatAppError(error),
        defaultValue: `读取剪贴板失败：${formatAppError(error)}`,
      }));
      setContextMenu(null);
      return;
    }
    if (!content) {
      showFeedback(t('messages.clipboardEmpty'));
      setContextMenu(null);
      return;
    }

    const name = buildTimestampTextFileName();
    try {
      const createdPath = await createTextFile(targetDir, name, content);
      await recordManualOperationHistory({
        category: 'create-file',
        title: '粘贴为 txt',
        summary: `${name}`,
        effects: [{
          op: { type: 'create_file', parentDir: targetDir, name },
          status: 'ok',
          reverseOp: { type: 'trash', path: createdPath },
        }],
        primaryPath: createdPath,
        targetPath: targetDir,
      });
      const entries = await refreshCurrentDir(false, targetDir);
      const created = entries.find(file => file.path === createdPath);
      if (created) {
        onSelectFiles([created.id]);
        scrollToCreatedEntry(created, createdPath, entries, listItemHeight, scrollContainerRef);
      }
      showFeedback(t('messages.pastedAsTextFile', {
        name: createdPath.split('/').pop() || name,
        defaultValue: `已生成文本文件：${createdPath.split('/').pop() || name}`,
      }));
    } catch (error) {
      await recordManualOperationHistory({
        category: 'create-file',
        title: '粘贴为 txt',
        summary: `${name}`,
        effects: [{
          op: { type: 'create_file', parentDir: targetDir, name },
          status: 'fail',
          note: formatAppError(error),
        }],
        status: 'failed',
        canUndo: false,
        reasonNotUndoable: `创建失败：${formatAppError(error)}`,
        targetPath: targetDir,
      });
      showFeedback(t('messages.pasteAsTextFileFailed', {
        error: formatAppError(error),
        defaultValue: `生成文本文件失败：${formatAppError(error)}`,
      }));
    }
    setContextMenu(null);
  }, [
    listItemHeight,
    onSelectFiles,
    recordManualOperationHistory,
    refreshCurrentDir,
    resolveWritableTarget,
    scrollContainerRef,
    setActiveDropdown,
    setContextMenu,
    showFeedback,
    t,
  ]);

  const handleNewFolder = useCallback(async (targetPath?: string) => {
    setActiveDropdown(null);
    const targetDir = resolveWritableTarget(targetPath);
    if (!targetDir) return;

    const baseName = t('filenames.newFolder', { defaultValue: '新建文件夹' });
    const existing = new Set(getDirectoryEntries(targetDir).map(file => file.name));
    let name = baseName;
    let index = 2;
    while (existing.has(name)) {
      name = t('filenames.newFolderIndexed', {
        index,
        defaultValue: `新建文件夹 ${index}`,
      });
      index += 1;
    }

    try {
      const createdPath = await createFolder(targetDir, name);
      await recordManualOperationHistory({
        category: 'create-folder',
        title: '新建文件夹',
        summary: `${name}`,
        effects: [{
          op: { type: 'mkdir', parentDir: targetDir, name },
          status: 'ok',
          reverseOp: { type: 'trash', path: createdPath },
        }],
        primaryPath: createdPath,
        targetPath: targetDir,
      });
      const entries = await refreshCurrentDir(false, targetDir);
      const created = entries.find(file => file.path === createdPath);
      if (created) {
        onSelectFiles([created.id]);
        setRenamingFile(created);
        setRenameInput(created.name);
        scrollToCreatedEntry(created, createdPath, entries, listItemHeight, scrollContainerRef);
      }
      showFeedback(t('messages.folderCreated', { name, defaultValue: `已创建文件夹：${name}` }));
    } catch (error) {
      await recordManualOperationHistory({
        category: 'create-folder',
        title: '新建文件夹',
        summary: `${name}`,
        effects: [{
          op: { type: 'mkdir', parentDir: targetDir, name },
          status: 'fail',
          note: formatAppError(error),
        }],
        status: 'failed',
        canUndo: false,
        reasonNotUndoable: `创建失败：${formatAppError(error)}`,
        targetPath: targetDir,
      });
      showFeedback(t('messages.folderCreateFailed', {
        error: formatAppError(error),
        defaultValue: `创建文件夹失败：${formatAppError(error)}`,
      }));
    }
    setContextMenu(null);
  }, [
    getDirectoryEntries,
    listItemHeight,
    onSelectFiles,
    recordManualOperationHistory,
    refreshCurrentDir,
    resolveWritableTarget,
    scrollContainerRef,
    setActiveDropdown,
    setContextMenu,
    setRenameInput,
    setRenamingFile,
    showFeedback,
    t,
  ]);

  const resolveOpenTarget = useCallback((file?: FileItem | null) => {
    const targetPath = file
      ? (file.type === 'folder' ? file.path : getItemDirectory(file))
      : (currentPath || theme.defaultHomePath || FAVORITES_VIRTUAL_PATH);
    if (!targetPath) return null;
    const label = targetPath.split('/').filter(Boolean).pop() || t('explorer.localStorage', '本地存储');
    return { targetPath, label };
  }, [currentPath, t, theme.defaultHomePath]);

  const openCurrentInNewTab = useCallback((file?: FileItem | null) => {
    if (!onOpenTab) return;
    const target = resolveOpenTarget(file);
    if (!target) return;
    const { targetPath, label } = target;
    onOpenTab(`tab-${Date.now()}`, 'tabs.volume', { label, initialPath: targetPath });
    setActiveDropdown(null);
    setContextMenu(null);
  }, [onOpenTab, resolveOpenTarget, setActiveDropdown, setContextMenu]);

  const openCurrentInNewWindow = useCallback((file?: FileItem | null) => {
    if (!onCreateWindow) return;
    const target = resolveOpenTarget(file);
    if (!target) return;
    onCreateWindow(target.targetPath, target.label);
    setActiveDropdown(null);
    setContextMenu(null);
  }, [onCreateWindow, resolveOpenTarget, setActiveDropdown, setContextMenu]);

  const handleQuickCreateClick = useCallback((event: React.MouseEvent<HTMLButtonElement>) => {
    if (event.detail >= 2) {
      if (createEntryClickTimerRef.current) {
        window.clearTimeout(createEntryClickTimerRef.current);
        createEntryClickTimerRef.current = null;
      }
      if (createEntryWindowLockRef.current) return;
      createEntryWindowLockRef.current = true;
      if (createEntryWindowLockTimerRef.current) {
        window.clearTimeout(createEntryWindowLockTimerRef.current);
      }
      createEntryWindowLockTimerRef.current = window.setTimeout(() => {
        createEntryWindowLockRef.current = false;
        createEntryWindowLockTimerRef.current = null;
      }, 480);
      const targetPath = currentPath || theme.defaultHomePath || FAVORITES_VIRTUAL_PATH;
      const targetLabel = targetPath.split('/').filter(Boolean).pop() || t('explorer.localStorage', '本地存储');
      onCreateWindow?.(targetPath, targetLabel);
      setActiveDropdown(null);
      return;
    }

    if (createEntryClickTimerRef.current) {
      window.clearTimeout(createEntryClickTimerRef.current);
    }
    createEntryClickTimerRef.current = window.setTimeout(() => {
      openCurrentInNewTab();
      createEntryClickTimerRef.current = null;
    }, 220);
  }, [
    createEntryClickTimerRef,
    createEntryWindowLockRef,
    createEntryWindowLockTimerRef,
    currentPath,
    onCreateWindow,
    openCurrentInNewTab,
    setActiveDropdown,
    t,
    theme.defaultHomePath,
  ]);

  return {
    handleNewFile,
    handleNewFolder,
    handlePasteAsTextFile,
    handleQuickCreateClick,
    handleSetCurrentAsHome,
    openCurrentInNewTab,
    openCurrentInNewWindow,
  };
}
