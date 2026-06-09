import React, { useCallback } from 'react';
import type { TFunction } from 'i18next';
import { confirm, open as openDialog } from '@tauri-apps/plugin-dialog';
import { Code2, ExternalLink, Fingerprint, Puzzle, Sparkles, Terminal } from 'lucide-react';
import { calculateFileHash, compressFiles, decompressFile, deleteToTrash, duplicateAsAlias, pickApplication, renameFile, setFileClipboard } from '../../api/filesystem';
import type { FileTransferPayload } from '../../api/filesystem';
import { normalizeAppError } from '../../lib/app-error';
import { formatOperationPermissionError } from '../../lib/operation-permission-error';
import { isRemotePath } from '../../lib/path-helpers';
import { safeInvoke } from '../../lib/tauri-runtime';
import { interpolateFileActionTemplate, safeShellOpen } from '../../lib/url-guard';
import type { ContextMenuAction, FileItem, ThemeSettings } from '../../types';
import type { FileOperationOptions, ManualHistoryRecordInput, ProtectedRootInfo } from './explorer-types';
import type { HashDialogState } from './preview-panel-types';
import { buildTemplateValues, formatAppError, makeFileItemsFromPaths, makeFolderItemFromPath } from './explorer-utils';

type UseExplorerFileOperationsInput = {
  currentPath: string;
  favorites: string[];
  hashDialog: HashDialogState | null;
  homeDir: string;
  lastSelectedFile: FileItem | null;
  renameInput: string;
  renamingFile: FileItem | null;
  selectedFileIds: string[];
  selectedFiles: FileItem[];
  theme: ThemeSettings;
  t: TFunction;
  clearContextSubmenuCloseTimer: () => void;
  executeCopyFiles: (
    filesToCopy: FileItem[],
    targetFolder: FileItem,
    conflictStrategy: 'abort' | 'skip' | 'replace',
    options?: FileOperationOptions,
  ) => Promise<boolean>;
  executeMoveFiles: (
    filesToMove: FileItem[],
    targetFolder: FileItem,
    conflictStrategy: 'abort' | 'skip' | 'replace',
    options?: FileOperationOptions,
  ) => Promise<unknown>;
  files: FileItem[];
  getActionDirectory: (preferredPath?: string) => string;
  getProtectedRootForPath: (path: string) => ProtectedRootInfo | null;
  navigateToPath: (path: string, options?: { replace?: boolean }) => void;
  importExternalPaths: (paths: string[], targetPath?: string) => Promise<boolean>;
  isRemoteRoot: boolean;
  onSelectFiles: (ids: string[]) => void;
  onRecordRecent: (path: string) => void;
  onToggleFavorite: (path: string) => void;
  refreshFileClipboardState: () => Promise<FileTransferPayload | null>;
  recordManualOperationHistory: (input: ManualHistoryRecordInput) => Promise<void>;
  refreshCurrentDir: () => Promise<FileItem[]>;
  resolvePasteTargetDirectory: (preferredPath?: string) => string;
  requestExistingOutputChoice: (state: { name: string; path: string; kind: 'archive' | 'folder' }) => Promise<'replace' | 'keepBoth' | 'cancel'>;
  setActiveDropdown: (value: string | null) => void;
  setContextMenu: (value: null) => void;
  setContextSubmenu: (value: null) => void;
  setHasFileClipboard: (value: boolean) => void;
  setHashDialog: React.Dispatch<React.SetStateAction<HashDialogState | null>>;
  setRenameInput: (value: string) => void;
  setRenamingFile: React.Dispatch<React.SetStateAction<FileItem | null>>;
  setShowAIRename: (show: boolean) => void;
  setShowOperationHistory: (show: boolean) => void;
  showFeedback: (message: string) => void;
  startMoveTaskFromDialog: (
    filesToMove: FileItem[],
    targetFolder: FileItem,
    conflictStrategy: 'abort' | 'skip' | 'replace',
    options?: FileOperationOptions,
  ) => Promise<boolean>;
};

const remoteReadOnlyMessage = (t: TFunction) => (
  t('messages.remoteReadOnly', { defaultValue: '远程访问第一版仅支持浏览。' })
);

export default function useExplorerFileOperations({
  currentPath,
  favorites,
  hashDialog,
  homeDir,
  lastSelectedFile,
  renameInput,
  renamingFile,
  selectedFileIds,
  selectedFiles,
  theme,
  t,
  clearContextSubmenuCloseTimer,
  executeCopyFiles,
  executeMoveFiles,
  files,
  getActionDirectory,
  getProtectedRootForPath,
  navigateToPath,
  importExternalPaths,
  isRemoteRoot,
  onSelectFiles,
  onRecordRecent,
  onToggleFavorite,
  refreshFileClipboardState,
  recordManualOperationHistory,
  refreshCurrentDir,
  resolvePasteTargetDirectory,
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
}: UseExplorerFileOperationsInput) {
  const closeContextMenus = useCallback(() => {
    setContextMenu(null);
    setContextSubmenu(null);
  }, [setContextMenu, setContextSubmenu]);

  const formatPermissionError = useCallback((error: unknown, pathHints: string[] = []) =>
    formatOperationPermissionError({
      error,
      getProtectedRootForPath,
      pathHints,
      t,
    }), [getProtectedRootForPath, t]);

  const handleOpenFile = useCallback((file: FileItem) => {
    onRecordRecent(file.path);
    if (file.type === 'folder' || (file.type === 'remote-unknown' && isRemotePath(file.path))) {
      navigateToPath(file.path);
    } else if (isRemotePath(file.path)) {
      showFeedback(remoteReadOnlyMessage(t));
    } else {
      safeInvoke('open_path', { path: file.path }).catch(async err => {
        showFeedback(t('messages.openFailed', {
          error: await formatPermissionError(err, [file.path]),
          defaultValue: '打开失败：{{error}}',
        }));
      });
    }
    clearContextSubmenuCloseTimer();
    closeContextMenus();
  }, [clearContextSubmenuCloseTimer, closeContextMenus, formatPermissionError, navigateToPath, onRecordRecent, showFeedback, t]);

  const handleOpenWith = useCallback(async (file: FileItem, appName: string) => {
    if (isRemotePath(file.path)) {
      showFeedback(remoteReadOnlyMessage(t));
      return;
    }
    try {
      await safeInvoke('open_with', { path: file.path, appName });
      onRecordRecent(file.path);
    } catch (err) {
      showFeedback(t('messages.openWithFailed', { error: await formatPermissionError(err, [file.path]) }));
    }
    clearContextSubmenuCloseTimer();
    closeContextMenus();
  }, [clearContextSubmenuCloseTimer, closeContextMenus, formatPermissionError, onRecordRecent, showFeedback, t]);

  const handleOpenWithOther = useCallback(async (file: FileItem) => {
    if (isRemotePath(file.path)) {
      showFeedback(remoteReadOnlyMessage(t));
      return;
    }
    try {
      const selected = await pickApplication();
      if (!selected) return;
      await safeInvoke('open_with', { path: file.path, appName: selected });
      onRecordRecent(file.path);
    } catch (err) {
      showFeedback(t('messages.openWithFailed', { error: await formatPermissionError(err, [file.path]) }));
    } finally {
      clearContextSubmenuCloseTimer();
      closeContextMenus();
    }
  }, [clearContextSubmenuCloseTimer, closeContextMenus, formatPermissionError, onRecordRecent, showFeedback, t]);

  const getActionFiles = useCallback((file?: FileItem) => {
    if (file && selectedFileIds.includes(file.id) && selectedFiles.length > 0) return selectedFiles;
    return file ? [file] : selectedFiles;
  }, [selectedFileIds, selectedFiles]);

  const handleCopyPaths = useCallback(async (items = selectedFiles) => {
    if (items.length === 0) return;
    await navigator.clipboard.writeText(items.map(file => file.path).join('\n'));
    showFeedback(t('messages.pathCopied', { count: items.length }));
    setContextMenu(null);
  }, [selectedFiles, setContextMenu, showFeedback, t]);

  const handleCopyNames = useCallback(async (items = selectedFiles) => {
    if (items.length === 0) return;
    await navigator.clipboard.writeText(items.map(file => file.name).join('\n'));
    showFeedback(t('messages.nameCopied', { count: items.length }));
    setContextMenu(null);
  }, [selectedFiles, setContextMenu, showFeedback, t]);

  const handleCopyToClipboard = useCallback(async (items = selectedFiles) => {
    if (items.length === 0) return;
    if (items.some(item => isRemotePath(item.path))) {
      showFeedback(remoteReadOnlyMessage(t));
      setContextMenu(null);
      return;
    }
    await setFileClipboard(items.map(file => file.path), false);
    setHasFileClipboard(true);
    showFeedback(t('messages.copied', { count: items.length }));
    setContextMenu(null);
  }, [selectedFiles, setContextMenu, setHasFileClipboard, showFeedback, t]);

  const handleCutToClipboard = useCallback(async (items = selectedFiles) => {
    if (items.length === 0) return;
    if (items.some(item => isRemotePath(item.path))) {
      showFeedback(remoteReadOnlyMessage(t));
      setContextMenu(null);
      return;
    }
    await setFileClipboard(items.map(file => file.path), true);
    setHasFileClipboard(true);
    showFeedback(t('messages.cut', { count: items.length }));
    setContextMenu(null);
  }, [selectedFiles, setContextMenu, setHasFileClipboard, showFeedback, t]);

  const handlePasteFromClipboard = useCallback(async (targetPath?: string) => {
    const payload = await refreshFileClipboardState();
    const paths = payload?.paths ?? [];
    if (paths.length === 0) {
      showFeedback(t('messages.clipboardEmpty'));
      return;
    }
    if (paths.some(isRemotePath)) {
      showFeedback(remoteReadOnlyMessage(t));
      return;
    }
    const targetDir = resolvePasteTargetDirectory(targetPath);
    if (isRemotePath(targetDir)) {
      showFeedback(remoteReadOnlyMessage(t));
      return;
    }
    if (!targetDir) {
      showFeedback(t('messages.crossWindowNoTarget', { defaultValue: '当前没有可作为目标的真实目录' }));
      return;
    }
    setContextMenu(null);
    try {
      if (payload?.cut) {
        await executeMoveFiles(makeFileItemsFromPaths(paths), makeFolderItemFromPath(targetDir), 'abort', {
          clearClipboardOnSuccess: true,
          useTransferTask: true,
        });
      } else {
        await executeCopyFiles(makeFileItemsFromPaths(paths), makeFolderItemFromPath(targetDir), 'abort', {
          clearClipboardOnSuccess: true,
        });
      }
    } catch (error) {
      showFeedback(t('messages.operationFailed', { error: await formatPermissionError(error, [targetDir, ...paths]) }));
    }
  }, [executeCopyFiles, executeMoveFiles, formatPermissionError, refreshFileClipboardState, resolvePasteTargetDirectory, setContextMenu, showFeedback, t]);

  const areAllFavorites = useCallback((items: FileItem[]) => (
    items.length > 0 && items.every(item => favorites.includes(item.path))
  ), [favorites]);

  const handleToggleFavoriteForItems = useCallback((items: FileItem[] = selectedFiles) => {
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
  }, [areAllFavorites, favorites, onToggleFavorite, selectedFiles, setContextMenu, showFeedback, t]);

  const handleQuickLook = useCallback(async (file = lastSelectedFile) => {
    if (!file) return;
    if (isRemotePath(file.path)) {
      showFeedback(remoteReadOnlyMessage(t));
      return;
    }
    try {
      await safeInvoke('quick_look', { path: file.path });
    } catch (err) {
      showFeedback(t('messages.quickLookFailed', { error: await formatPermissionError(err, [file.path]) }));
    }
  }, [formatPermissionError, lastSelectedFile, showFeedback, t]);

  const handleRevealInFinder = useCallback(async (file = lastSelectedFile) => {
    if (!file) return;
    if (isRemotePath(file.path)) {
      showFeedback(remoteReadOnlyMessage(t));
      setContextMenu(null);
      return;
    }
    try {
      await safeInvoke('reveal_in_finder', { path: file.path });
    } catch (err) {
      showFeedback(t('messages.finderFailed', { error: await formatPermissionError(err, [file.path]) }));
    }
    setContextMenu(null);
  }, [formatPermissionError, lastSelectedFile, setContextMenu, showFeedback, t]);

  const handleOpenTerminal = useCallback(async (file?: FileItem | null) => {
    const target = file || lastSelectedFile;
    const path = target?.path || currentPath || homeDir;
    if (!path) return;
    if (isRemotePath(path)) {
      showFeedback(remoteReadOnlyMessage(t));
      setContextMenu(null);
      return;
    }
    try {
      const scriptLines = (theme.terminalScripts || [])
        .filter(script => script.enabled && script.script.trim())
        .map(script => script.script.trim());
      await safeInvoke('open_terminal_at', {
        path,
        terminalApp: theme.terminalApp || 'Terminal',
        args: theme.terminalArgs || '',
        scripts: scriptLines.length > 0 ? scriptLines : undefined,
        customCommand: theme.customTerminalCommand || '',
      });
      showFeedback(t('messages.terminalOpened', { app: theme.terminalApp || 'Terminal' }));
    } catch (err) {
      showFeedback(t('messages.terminalFailed', { error: normalizeAppError(err).userMessage }));
    }
    setContextMenu(null);
  }, [currentPath, homeDir, lastSelectedFile, setContextMenu, showFeedback, t, theme]);

  const getExtensionIcon = useCallback((extension: ContextMenuAction) => {
    switch (extension.actionType) {
      case 'terminal':
        return React.createElement(Terminal, { className: 'w-4 h-4' });
      case 'shell':
        return React.createElement(Code2, { className: 'w-4 h-4' });
      case 'url':
        return React.createElement(ExternalLink, { className: 'w-4 h-4' });
      case 'calculate-hash':
        return React.createElement(Fingerprint, { className: 'w-4 h-4' });
      case 'placeholder':
        return React.createElement(Sparkles, { className: 'w-4 h-4 text-icon' });
      default:
        return React.createElement(Puzzle, { className: 'w-4 h-4' });
    }
  }, []);

  const handleCalculateHash = useCallback(async (file: FileItem) => {
    const target = getActionFiles(file)[0] || file;
    if (isRemotePath(target.path)) {
      showFeedback(remoteReadOnlyMessage(t));
      setContextMenu(null);
      return;
    }
    if (target.type === 'folder') {
      showFeedback(t('messages.hashFolderUnsupported', { defaultValue: '文件夹暂不支持计算哈希值' }));
      setContextMenu(null);
      return;
    }

    setHashDialog({
      file: target,
      loading: true,
      result: null,
      error: '',
    });
    closeContextMenus();

    try {
      const result = await calculateFileHash(target.path);
      setHashDialog(current => (
        current && current.file.path === target.path
          ? { ...current, loading: false, result }
          : current
      ));
    } catch (err) {
      const error = await formatPermissionError(err, [target.path]);
      setHashDialog(current => (
        current && current.file.path === target.path
          ? { ...current, loading: false, error }
          : current
      ));
    }
  }, [closeContextMenus, formatPermissionError, getActionFiles, setContextMenu, setHashDialog, showFeedback, t]);

  const handleCopyHashValue = useCallback(async () => {
    if (!hashDialog?.result) return;
    await navigator.clipboard.writeText(hashDialog.result.value);
    showFeedback(t('messages.hashCopied', { defaultValue: '哈希值已复制' }));
  }, [hashDialog?.result, showFeedback, t]);

  const handleExtensionAction = useCallback(async (id: string, file: FileItem) => {
    if (isRemotePath(file.path) || isRemotePath(currentPath)) {
      showFeedback(remoteReadOnlyMessage(t));
      setContextMenu(null);
      return;
    }
    const extension = (theme.contextMenuExtensions || []).find(ext => ext.id === id);
    if (!extension) {
      showFeedback(t('messages.extensionMissing', { id, defaultValue: `扩展「${id}」不存在或已被移除。` }));
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
        await safeInvoke('open_terminal_at', {
          path: workingPath,
          terminalApp: extension.terminalApp || theme.terminalApp || 'Terminal',
          args: interpolateFileActionTemplate(extension.terminalArgs || '', buildTemplateValues(file, currentPath), 'shell'),
          customCommand: '',
        });
        showFeedback(t('messages.extensionExecuted', { label: extension.label, defaultValue: `已执行扩展：${extension.label}` }));
      } else if (actionType === 'shell') {
        const command = interpolateFileActionTemplate(extension.command || '', buildTemplateValues(file, currentPath), 'shell').trim();
        if (!command) {
          showFeedback(t('messages.extensionCommandMissing', { label: extension.label, defaultValue: `扩展「${extension.label}」未配置命令。` }));
        } else {
          await safeInvoke('open_terminal_at', {
            path: workingPath,
            terminalApp: extension.terminalApp || theme.terminalApp || 'Terminal',
            args: '',
            customCommand: command,
          });
          showFeedback(t('messages.extensionTerminalExecuted', { label: extension.label, defaultValue: `已在终端执行：${extension.label}` }));
        }
      } else if (actionType === 'url') {
        const url = interpolateFileActionTemplate(extension.urlTemplate || '', buildTemplateValues(file, currentPath), 'url').trim();
        if (!url) {
          showFeedback(t('messages.extensionUrlMissing', { label: extension.label, defaultValue: `扩展「${extension.label}」未配置 URL。` }));
        } else {
          try {
            await safeShellOpen(url);
            showFeedback(t('messages.extensionUrlOpened', { label: extension.label, defaultValue: `已打开链接：${extension.label}` }));
          } catch (err) {
            showFeedback(t('messages.extensionUnsafeUrl', {
              label: extension.label,
              error: normalizeAppError(err).userMessage,
              defaultValue: `扩展「${extension.label}」链接不安全：${normalizeAppError(err).userMessage}`,
            }));
          }
        }
      } else if (actionType === 'ai-assistant') {
        if (isRemotePath(file.path) || isRemotePath(currentPath)) {
          showFeedback(remoteReadOnlyMessage(t));
          setContextMenu(null);
          return;
        }
        setContextMenu(null);
        setShowAIRename(true);
        return;
      } else if (actionType === 'ai-history') {
        setContextMenu(null);
        setShowOperationHistory(true);
        return;
      } else if (actionType === 'calculate-hash') {
        setContextMenu(null);
        void handleCalculateHash(file);
        return;
      } else {
        showFeedback(t('messages.extensionReserved', { label: extension.label, defaultValue: `扩展「${extension.label}」已预留，等待插件接入。` }));
      }
    } catch (err) {
      showFeedback(t('messages.extensionFailed', {
        error: normalizeAppError(err).userMessage,
        defaultValue: `扩展执行失败：${normalizeAppError(err).userMessage}`,
      }));
    }
    setContextMenu(null);
  }, [
    currentPath,
    handleCalculateHash,
    setContextMenu,
    setShowAIRename,
    setShowOperationHistory,
    showFeedback,
    t,
    theme,
  ]);

  const handleRenameStart = useCallback((file: FileItem) => {
    if (isRemotePath(file.path)) {
      showFeedback(remoteReadOnlyMessage(t));
      setContextMenu(null);
      return;
    }
    setRenamingFile(file);
    setRenameInput(file.name);
    setContextMenu(null);
  }, [setContextMenu, setRenameInput, setRenamingFile, showFeedback, t]);

  const handleRenameSubmit = useCallback(async () => {
    if (!renamingFile || !renameInput.trim() || renameInput === renamingFile.name) {
      setRenamingFile(null);
      return;
    }
    const file = renamingFile;
    if (isRemotePath(file.path)) {
      showFeedback(remoteReadOnlyMessage(t));
      setRenamingFile(null);
      return;
    }
    const nextName = renameInput.trim();
    try {
      const renamedPath = await renameFile(file.path, nextName);
      await recordManualOperationHistory({
        category: 'rename',
        title: '重命名',
        summary: `${file.name} → ${nextName}`,
        effects: [{
          op: { type: 'rename', path: file.path, newName: nextName },
          status: 'ok',
          reverseOp: { type: 'rename', path: renamedPath || `${file.path.split('/').slice(0, -1).join('/')}/${nextName}`, newName: file.name },
        }],
        primaryPath: file.path,
        targetPath: renamedPath,
      });
      await refreshCurrentDir();
      showFeedback(t('messages.renameCompleted', {
        name: nextName,
        defaultValue: '已重命名为：{{name}}',
      }));
    } catch (error) {
      const errorMessage = await formatPermissionError(error, [file.path]);
      await recordManualOperationHistory({
        category: 'rename',
        title: '重命名',
        summary: `${file.name} → ${nextName}`,
        effects: [{
          op: { type: 'rename', path: file.path, newName: nextName },
          status: 'fail',
          note: errorMessage,
        }],
        status: 'failed',
        canUndo: false,
        reasonNotUndoable: `重命名失败：${errorMessage}`,
        primaryPath: file.path,
      });
      showFeedback(t('messages.renameFailed', {
        error: errorMessage,
        defaultValue: '重命名失败：{{error}}',
      }));
    }
    setRenamingFile(null);
  }, [formatPermissionError, recordManualOperationHistory, refreshCurrentDir, renameInput, renamingFile, setRenamingFile, showFeedback, t]);

  const handleRenameCancel = useCallback(() => {
    setRenamingFile(null);
  }, [setRenamingFile]);

  const handleDeleteFile = useCallback(async (file: FileItem) => {
    const targets = getActionFiles(file);
    if (targets.some(item => isRemotePath(item.path))) {
      showFeedback(remoteReadOnlyMessage(t));
      setContextMenu(null);
      return;
    }
    const ok = await confirm(t('dialogs.moveToTrash', { count: targets.length }));
    if (ok) {
      const results = await Promise.allSettled(targets.map(item => deleteToTrash(item.path)));
      const failed = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected');
      const movedCount = targets.length - failed.length;
      const effects = results.map((result, index) => {
        const target = targets[index];
        if (result.status === 'fulfilled') {
          return {
            op: { type: 'trash', path: target.path },
            status: 'ok' as const,
          };
        }
        return {
          op: { type: 'trash', path: target.path },
          status: 'fail' as const,
          note: normalizeAppError(result.reason).userMessage,
        };
      });
      await recordManualOperationHistory({
        category: 'trash',
        title: '移至废纸篓',
        summary: `共 ${targets.length} 项，成功 ${movedCount}，失败 ${failed.length}`,
        effects,
        status: failed.length === 0 ? 'success' : movedCount > 0 ? 'partial' : 'failed',
        canUndo: false,
        reasonNotUndoable: '移至废纸篓操作需手动从废纸篓恢复',
        primaryPath: targets[0]?.path,
      });

      if (movedCount > 0) {
        await refreshCurrentDir();
        onSelectFiles([]);
      }

      if (failed.length === 0) {
        showFeedback(t('messages.movedToTrash', { count: targets.length }));
      } else {
        const failedWithPaths = results
          .map((result, index) => ({ result, path: targets[index]?.path }))
          .filter((item): item is { result: PromiseRejectedResult; path?: string } => item.result.status === 'rejected');
        const primaryFailure = failedWithPaths.find(item => (
          normalizeAppError(item.result.reason).kind === 'PermissionDenied'
        )) ?? failedWithPaths[0];
        const appError = normalizeAppError(primaryFailure.result.reason);
        const error = await formatPermissionError(
          primaryFailure.result.reason,
          [primaryFailure.path].filter(Boolean) as string[],
        );
        const key = appError.kind === 'TrashUnsupported'
          ? 'messages.externalTrashUnsupported'
          : 'messages.moveToTrashFailed';
        showFeedback(t(key, { error, moved: movedCount, failed: failed.length }));
      }
    }
    setContextMenu(null);
  }, [formatPermissionError, getActionFiles, onSelectFiles, recordManualOperationHistory, refreshCurrentDir, setContextMenu, showFeedback, t]);

  const handleCopyFile = useCallback(async (file: FileItem) => {
    setContextMenu(null);
    setActiveDropdown('copy-move');
    const targets = getActionFiles(file);
    if (targets.some(item => isRemotePath(item.path))) {
      showFeedback(remoteReadOnlyMessage(t));
      setActiveDropdown(null);
      return;
    }
    let targetDir: string | null = null;
    try {
      const selected = await openDialog({
        multiple: false,
        directory: true,
        defaultPath: currentPath || undefined,
        title: t('dialogs.copyToTitle', { defaultValue: '选择复制目标' }),
      });
      targetDir = typeof selected === 'string' ? selected : null;
    } catch {
      // user cancelled
    }
    setActiveDropdown(null);
    if (targetDir) {
      try {
        await executeCopyFiles(targets, makeFolderItemFromPath(targetDir), 'abort');
      } catch (error) {
        showFeedback(t('messages.operationFailed', {
          error: await formatPermissionError(error, [targetDir, ...targets.map(target => target.path)]),
          defaultValue: '复制失败：{{error}}',
        }));
      }
    }
  }, [currentPath, executeCopyFiles, formatPermissionError, getActionFiles, setActiveDropdown, setContextMenu, showFeedback, t]);

  const handleMoveFile = useCallback(async (file: FileItem) => {
    const targets = getActionFiles(file);
    if (targets.some(item => isRemotePath(item.path))) {
      showFeedback(remoteReadOnlyMessage(t));
      setContextMenu(null);
      return;
    }
    let targetDir: string | null = null;
    try {
      const selected = await openDialog({
        multiple: false,
        directory: true,
        defaultPath: currentPath || undefined,
        title: t('dialogs.moveToTitle', { defaultValue: '选择移动目标' }),
      });
      targetDir = typeof selected === 'string' ? selected : null;
    } catch {
      // user cancelled
    }
    if (targetDir) {
      try {
        await startMoveTaskFromDialog(targets, makeFolderItemFromPath(targetDir), 'abort');
      } catch (error) {
        showFeedback(t('messages.moveFailed', {
          error: await formatPermissionError(error, [targetDir, ...targets.map(target => target.path)]),
        }));
      }
    }
    setContextMenu(null);
  }, [currentPath, formatPermissionError, getActionFiles, setContextMenu, showFeedback, startMoveTaskFromDialog, t]);

  const handleCompress = useCallback(async (file: FileItem) => {
    const targets = getActionFiles(file);
    if (isRemoteRoot || targets.some(item => isRemotePath(item.path))) {
      showFeedback(remoteReadOnlyMessage(t));
      setContextMenu(null);
      return;
    }
    const defaultName = targets.length === 1
      ? `${targets[0].name}.zip`
      : `Aether Selection ${new Date().toISOString().slice(0, 10)}.zip`;
    let output = `${currentPath}/${defaultName}`;
    if (files.some(f => f.name === defaultName)) {
      const action = await requestExistingOutputChoice({
        name: defaultName,
        path: output,
        kind: 'archive',
      });
      if (action === 'cancel') {
        setContextMenu(null);
        return;
      }
      if (action === 'keepBoth') {
        let counter = 1;
        const base = defaultName.replace(/\.zip$/, '');
        while (files.some(f => f.name === `${base} (${counter}).zip`)) counter++;
        output = `${currentPath}/${base} (${counter}).zip`;
      }
    }
    try {
      await compressFiles(targets.map(item => item.path), output);
      await recordManualOperationHistory({
        category: 'compress',
        title: '压缩',
        summary: `${targets.length} 个项目 → ${output.split('/').pop() || output}`,
        effects: [{
          op: { type: 'compress', paths: targets.map(item => item.path), outputName: output.split('/').pop() || output },
          status: 'ok',
          reverseOp: { type: 'trash', path: output },
        }],
        primaryPath: targets[0]?.path,
        targetPath: output,
      });
      void refreshCurrentDir();
      showFeedback(t('messages.compressCompleted', {
        count: targets.length,
        defaultValue: `已压缩 ${targets.length} 个项目`,
      }));
    } catch (error) {
      const errorMessage = await formatPermissionError(error, [output, ...targets.map(target => target.path)]);
      await recordManualOperationHistory({
        category: 'compress',
        title: '压缩',
        summary: `${targets.length} 个项目`,
        effects: [{
          op: { type: 'compress', paths: targets.map(item => item.path), outputName: output.split('/').pop() || output },
          status: 'fail',
          note: errorMessage,
        }],
        status: 'failed',
        canUndo: false,
        reasonNotUndoable: `压缩失败：${errorMessage}`,
        primaryPath: targets[0]?.path,
        targetPath: output,
      });
      showFeedback(t('messages.compressFailed', {
        error: errorMessage,
        defaultValue: `压缩失败：${errorMessage}`,
      }));
    }
    setContextMenu(null);
  }, [currentPath, files, formatPermissionError, getActionFiles, isRemoteRoot, recordManualOperationHistory, refreshCurrentDir, requestExistingOutputChoice, setContextMenu, showFeedback, t]);

  const handleDecompress = useCallback(async (file: FileItem) => {
    if (isRemoteRoot || isRemotePath(file.path)) {
      showFeedback(remoteReadOnlyMessage(t));
      setContextMenu(null);
      return;
    }
    const baseName = file.name.replace(/\.[^.]+$/, '');
    let outputDir = `${currentPath}/${baseName}`;
    const exists = files.some(f => f.name === baseName && f.type === 'folder');
    if (exists) {
      const action = await requestExistingOutputChoice({
        name: baseName,
        path: outputDir,
        kind: 'folder',
      });
      if (action === 'cancel') {
        setContextMenu(null);
        return;
      }
      if (action === 'keepBoth') {
        let counter = 1;
        while (files.some(f => f.name === `${baseName} (${counter})`)) counter++;
        outputDir = `${currentPath}/${baseName} (${counter})`;
      }
    }
    try {
      await decompressFile(file.path, outputDir);
      void refreshCurrentDir();
      showFeedback(t('messages.decompressCompleted', { name: file.name, defaultValue: `已解压：${file.name}` }));
    } catch (error) {
      const errorMessage = await formatPermissionError(error, [file.path, outputDir]);
      showFeedback(t('messages.decompressFailed', {
        error: errorMessage,
        defaultValue: `解压失败：${errorMessage}`,
      }));
    }
    setContextMenu(null);
  }, [currentPath, files, formatPermissionError, isRemoteRoot, refreshCurrentDir, requestExistingOutputChoice, setContextMenu, showFeedback, t]);

  const handleAlias = useCallback(async (file: FileItem) => {
    if (isRemotePath(file.path)) {
      showFeedback(remoteReadOnlyMessage(t));
      setContextMenu(null);
      return;
    }
    try {
      const copiedPath = await duplicateAsAlias(file.path);
      await recordManualOperationHistory({
        category: 'copy',
        title: '创建副本',
        summary: `${file.name}`,
        effects: [{
          op: {
            type: 'copy',
            path: file.path,
            targetDir: copiedPath.split('/').slice(0, -1).join('/') || currentPath,
          },
          status: 'ok',
          reverseOp: { type: 'trash', path: copiedPath },
        }],
        primaryPath: file.path,
        targetPath: copiedPath,
      });
      void refreshCurrentDir();
      showFeedback(t('messages.aliasCreated', { name: file.name, defaultValue: `已创建副本：${file.name}` }));
    } catch (error) {
      const errorMessage = await formatPermissionError(error, [file.path]);
      await recordManualOperationHistory({
        category: 'copy',
        title: '创建副本',
        summary: `${file.name}`,
        effects: [{
          op: {
            type: 'copy',
            path: file.path,
            targetDir: file.path.split('/').slice(0, -1).join('/') || currentPath,
          },
          status: 'fail',
          note: errorMessage,
        }],
        status: 'failed',
        canUndo: false,
        reasonNotUndoable: `创建副本失败：${errorMessage}`,
        primaryPath: file.path,
      });
      showFeedback(t('messages.aliasCreateFailed', {
        error: errorMessage,
        defaultValue: `创建副本失败：${errorMessage}`,
      }));
    }
    setContextMenu(null);
  }, [currentPath, formatPermissionError, recordManualOperationHistory, refreshCurrentDir, setContextMenu, showFeedback, t]);

  const handleImportFiles = useCallback(async () => {
    if (isRemoteRoot) {
      showFeedback(remoteReadOnlyMessage(t));
      setActiveDropdown(null);
      return;
    }
    try {
      const selected = await openDialog({ multiple: true, directory: false });
      const paths = Array.isArray(selected) ? selected : selected ? [selected] : [];
      if (paths.length === 0) return;
      await importExternalPaths(paths, getActionDirectory());
    } catch (error) {
      showFeedback(t('messages.finderImportFailed', {
        error: await formatPermissionError(error, [getActionDirectory()]),
        defaultValue: '导入失败：{{error}}',
      }));
    }
    setActiveDropdown(null);
  }, [formatPermissionError, getActionDirectory, importExternalPaths, isRemoteRoot, setActiveDropdown, showFeedback, t]);

  return {
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
  };
}
