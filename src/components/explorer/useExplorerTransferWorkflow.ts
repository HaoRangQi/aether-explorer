import React, { useCallback } from 'react';
import type { TFunction } from 'i18next';
import {
  listTransferTasks,
  previewCopyFileConflicts,
  previewMoveFileConflicts,
  startCopyFilesTask,
  startMoveFilesTask,
} from '../../api/filesystem';
import type { MoveConflictStrategy, TransferTaskSnapshot } from '../../api/filesystem';
import { isRemotePath } from '../../lib/path-helpers';
import type { FileItem } from '../../types';
import type {
  FileOperationOptions,
  ManualHistoryRecordInput,
  MoveConflictChoice,
  MoveConflictDialogState,
  MoveExecutionSummary,
  TransferTaskWaitMessages,
} from './explorer-types';
import {
  formatAppError,
  makeFileItemsFromPaths,
  makeFolderItemFromPath,
  resolveTransferTaskOperationStatus,
  resolveTransferTaskVolumeHint,
} from './explorer-utils';

type UseExplorerTransferWorkflowInput = {
  clearFileClipboardState: () => Promise<void>;
  confirmLargeBatchOperation: (count: number) => Promise<boolean>;
  executeMoveFilesRef: React.MutableRefObject<(
    filesToMove: FileItem[],
    targetFolder: FileItem,
    conflictStrategy: MoveConflictStrategy,
    options?: FileOperationOptions,
  ) => Promise<MoveExecutionSummary>>;
  finishSharedFileDrag: () => void;
  getActionDirectory: (preferredPath?: string) => string;
  logDragDebug: (message: string) => void;
  onStartTransfer: () => void;
  recordManualOperationHistory: (input: ManualHistoryRecordInput) => Promise<void>;
  refreshCurrentDirRef: React.MutableRefObject<(fullRefresh?: boolean, targetPath?: string) => Promise<FileItem[]>>;
  setMoveConflictDialog: React.Dispatch<React.SetStateAction<MoveConflictDialogState | null>>;
  showFeedback: (message: string) => void;
  startMoveTaskFromDialogRef: React.MutableRefObject<(
    filesToMove: FileItem[],
    targetFolder: FileItem,
    conflictStrategy: MoveConflictStrategy,
    options?: FileOperationOptions,
  ) => Promise<boolean>>;
  t: TFunction;
};

export default function useExplorerTransferWorkflow({
  clearFileClipboardState,
  confirmLargeBatchOperation,
  executeMoveFilesRef,
  finishSharedFileDrag,
  getActionDirectory,
  logDragDebug,
  onStartTransfer,
  recordManualOperationHistory,
  refreshCurrentDirRef,
  setMoveConflictDialog,
  showFeedback,
  startMoveTaskFromDialogRef,
  t,
}: UseExplorerTransferWorkflowInput) {
  const waitForTransferTaskResult = useCallback(async (
    taskId: string,
    refreshTargetPath?: string,
  ): Promise<TransferTaskSnapshot | null> => {
    for (;;) {
      const task = (await listTransferTasks()).find(item => item.id === taskId);
      if (!task) return null;
      if (task.status === 'completed' || task.status === 'failed' || task.status === 'cancelled') {
        await refreshCurrentDirRef.current(false, refreshTargetPath);
        return task;
      }
      await new Promise(resolve => window.setTimeout(resolve, 800));
    }
  }, [refreshCurrentDirRef]);

  const waitForTransferTask = useCallback(async (
    taskId: string,
    expectedCount: number,
    messages: TransferTaskWaitMessages,
    refreshTargetPath?: string,
  ) => {
    let settledTask: TransferTaskSnapshot | null = null;
    try {
      const task = await waitForTransferTaskResult(taskId, refreshTargetPath);
      settledTask = task;
      if (!task) {
        showFeedback(t(messages.failed, {
          error: t('messages.transferTaskUnavailable', { defaultValue: '传输任务记录已清理' }),
          defaultValue: messages.failedDefaultValue,
        }));
        return;
      }
      if (messages.onFinished?.(task)) return;
      if (task.status === 'completed') {
        if (messages.onCompleted) {
          await messages.onCompleted(task);
        } else {
          showFeedback(t(messages.success, { count: expectedCount }));
        }
      } else if (task.status === 'cancelled') {
        showFeedback(t('messages.transferCancelled', { defaultValue: '传输已取消' }));
      } else {
        showFeedback(t(messages.failed, {
          error: task.error || t('messages.operationFailed', { error: '' }),
          defaultValue: messages.failedDefaultValue,
        }));
      }
    } catch (error) {
      showFeedback(t(messages.failed, {
        error: formatAppError(error),
        defaultValue: messages.failedDefaultValue,
      }));
    } finally {
      await messages.onSettled?.(settledTask);
    }
  }, [showFeedback, t, waitForTransferTaskResult]);

  const waitForCrossWindowTask = useCallback(async (
    taskId: string,
    refreshTargetPath?: string,
  ): Promise<TransferTaskSnapshot | null> => {
    try {
      const task = await waitForTransferTaskResult(taskId, refreshTargetPath);
      if (!task) {
        showFeedback(t('messages.operationFailed', {
          error: t('messages.transferTaskUnavailable', { defaultValue: '传输任务记录已清理' }),
        }));
        return null;
      }
      if (task.status === 'cancelled') {
        showFeedback(t('messages.transferCancelled', { defaultValue: '传输已取消' }));
        return null;
      }
      if (task.status === 'failed') {
        showFeedback(t('messages.operationFailed', {
          error: task.error || t('messages.operationFailed', { error: '' }),
        }));
        return null;
      }
      return task;
    } catch (error) {
      showFeedback(t('messages.operationFailed', { error: formatAppError(error) }));
      return null;
    }
  }, [showFeedback, t, waitForTransferTaskResult]);

  const showMoveTaskCompletedFeedback = useCallback((task: TransferTaskSnapshot | null, expectedCount: number) => {
    if (!task) {
      showFeedback(t('messages.moveCompleted', { count: expectedCount }));
      return;
    }

    const completed = task.moved + task.copiedCrossDevice;
    const skippedConflicts = task.skippedConflicts ?? task.skipped;
    const skippedSameDir = task.skippedSameDir ?? 0;
    if (task.failed > 0) {
      showFeedback(t('messages.moveTaskPartial', {
        ok: completed,
        skipped: task.skipped,
        failed: task.failed,
      }));
    } else if (skippedSameDir > 0 && skippedConflicts === 0 && completed === 0) {
      showFeedback(t('messages.sameDirectory'));
    } else if (skippedConflicts > 0 && completed === 0) {
      showFeedback(t('messages.skippedConflicts', { count: skippedConflicts }));
    } else if (skippedConflicts > 0) {
      showFeedback(t('messages.processedWithSkips', { ok: completed, skipped: skippedConflicts }));
    } else if (task.copiedCrossDevice > 0 && task.moved > 0) {
      showFeedback(t('messages.movedWithCrossDeviceCopies', {
        moved: task.moved,
        copied: task.copiedCrossDevice,
      }));
    } else if (task.copiedCrossDevice > 0) {
      showFeedback(t('messages.crossDeviceCopied', { count: task.copiedCrossDevice }));
    } else if (skippedSameDir > 0) {
      showFeedback(t('messages.moveCompleted', { count: completed || expectedCount }));
    } else {
      showFeedback(t('messages.moveCompleted', { count: task.moved || expectedCount }));
    }
  }, [showFeedback, t]);

  const importExternalPaths = useCallback(async (paths: string[], targetPath?: string) => {
    const cleanPaths = paths.filter(Boolean);
    if (cleanPaths.length === 0) return false;

    const targetDir = getActionDirectory(targetPath);
    if (isRemotePath(targetDir)) {
      showFeedback(t('messages.remoteReadOnly', { defaultValue: '远程访问第一版仅支持浏览。' }));
      return false;
    }
    if (!targetDir) {
      showFeedback(t('messages.crossWindowNoTarget', {
        defaultValue: '当前没有可作为目标的真实目录',
      }));
      return false;
    }

    try {
      const shouldContinue = await confirmLargeBatchOperation(cleanPaths.length);
      if (!shouldContinue) return false;

      const targetFolder = makeFolderItemFromPath(targetDir);
      const conflicts = await previewCopyFileConflicts(cleanPaths, targetDir);
      if (conflicts.length > 0) {
        setMoveConflictDialog({
          filesToMove: makeFileItemsFromPaths(cleanPaths),
          targetFolder,
          conflicts,
          operation: 'copy',
        });
        return true;
      }

      const taskId = await startCopyFilesTask(cleanPaths, targetDir, 'abort');
      onStartTransfer();
      showFeedback(t('messages.importStarted', { count: cleanPaths.length }));
      void waitForTransferTask(taskId, cleanPaths.length, {
        success: 'messages.importedFromFinder',
        failed: 'messages.finderImportFailed',
        failedDefaultValue: '导入失败：{{error}}',
        onSettled: async task => {
          await recordManualOperationHistory({
            category: 'copy',
            title: '导入文件',
            summary: `导入 ${cleanPaths.length} 个项目`,
            itemCount: cleanPaths.length,
            status: resolveTransferTaskOperationStatus(task),
            canUndo: false,
            reasonNotUndoable: '传输任务无逐项回滚信息',
            primaryPath: cleanPaths[0],
            targetPath: targetDir,
            conflictStrategy: 'abort',
            volumeHint: resolveTransferTaskVolumeHint(task),
          });
        },
      }, targetDir);
      return true;
    } catch (error) {
      showFeedback(t('messages.finderImportFailed', {
        error: formatAppError(error),
        defaultValue: '导入失败：{{error}}',
      }));
      return true;
    }
  }, [
    confirmLargeBatchOperation,
    getActionDirectory,
    onStartTransfer,
    recordManualOperationHistory,
    setMoveConflictDialog,
    showFeedback,
    t,
    waitForTransferTask,
  ]);

  const startCrossWindowCopyTask = useCallback(async (
    paths: string[],
    targetFolder: FileItem,
  ): Promise<TransferTaskSnapshot | null> => {
    if (paths.some(isRemotePath) || isRemotePath(targetFolder.path)) {
      showFeedback(t('messages.remoteReadOnly', { defaultValue: '远程访问第一版仅支持浏览。' }));
      return null;
    }
    const conflicts = await previewCopyFileConflicts(paths, targetFolder.path);
    if (conflicts.length > 0) {
      setMoveConflictDialog({
        filesToMove: makeFileItemsFromPaths(paths),
        targetFolder,
        conflicts,
        operation: 'copy',
      });
      return null;
    }

    const taskId = await startCopyFilesTask(paths, targetFolder.path, 'abort');
    logDragDebug(`crossWindowCopyTaskStarted taskId=${taskId} count=${paths.length}`);
    onStartTransfer();
    showFeedback(t('messages.copyStarted', { count: paths.length }));
    return waitForCrossWindowTask(taskId, targetFolder.path);
  }, [logDragDebug, onStartTransfer, setMoveConflictDialog, showFeedback, t, waitForCrossWindowTask]);

  const startCrossWindowMoveTask = useCallback(async (
    paths: string[],
    targetFolder: FileItem,
  ): Promise<TransferTaskSnapshot | null> => {
    if (paths.some(isRemotePath) || isRemotePath(targetFolder.path)) {
      showFeedback(t('messages.remoteReadOnly', { defaultValue: '远程访问第一版仅支持浏览。' }));
      return null;
    }
    const conflicts = await previewMoveFileConflicts(paths, targetFolder.path);
    if (conflicts.length > 0) {
      setMoveConflictDialog({
        filesToMove: makeFileItemsFromPaths(paths),
        targetFolder,
        conflicts,
        operation: 'move',
        useTransferTaskOnResolve: true,
      });
      return null;
    }

    const taskId = await startMoveFilesTask(paths, targetFolder.path, 'abort');
    logDragDebug(`crossWindowMoveTaskStarted taskId=${taskId} count=${paths.length}`);
    onStartTransfer();
    showFeedback(t('messages.moveStarted', { count: paths.length }));
    const task = await waitForCrossWindowTask(taskId, targetFolder.path);
    if (task) {
      showMoveTaskCompletedFeedback(task, paths.length);
    }
    return task;
  }, [
    logDragDebug,
    onStartTransfer,
    setMoveConflictDialog,
    showFeedback,
    showMoveTaskCompletedFeedback,
    t,
    waitForCrossWindowTask,
  ]);

  const executeCopyFiles = useCallback(async (
    filesToCopy: FileItem[],
    targetFolder: FileItem,
    conflictStrategy: MoveConflictStrategy,
    options: FileOperationOptions = {},
  ) => {
    try {
      if (filesToCopy.some(file => isRemotePath(file.path)) || isRemotePath(targetFolder.path)) {
        showFeedback(t('messages.remoteReadOnly', { defaultValue: '远程访问第一版仅支持浏览。' }));
        return false;
      }
      if (!options.skipLargeBatchConfirm) {
        const shouldContinue = await confirmLargeBatchOperation(filesToCopy.length);
        if (!shouldContinue) return false;
      }
      const paths = filesToCopy.map(file => file.path);

      if (conflictStrategy === 'abort') {
        const conflicts = await previewCopyFileConflicts(paths, targetFolder.path);
        if (conflicts.length > 0) {
          setMoveConflictDialog({
            filesToMove: filesToCopy,
            targetFolder,
            conflicts,
            operation: 'copy',
            clearClipboardOnSuccess: options.clearClipboardOnSuccess,
          });
          return true;
        }
      }

      const taskId = await startCopyFilesTask(paths, targetFolder.path, conflictStrategy);
      logDragDebug(`copyTaskStarted taskId=${taskId} count=${paths.length} conflictStrategy=${conflictStrategy}`);
      onStartTransfer();
      showFeedback(t('messages.copyStarted', { count: paths.length }));
      void waitForTransferTask(taskId, paths.length, {
        success: 'messages.copyCompleted',
        failed: 'messages.operationFailed',
        failedDefaultValue: '复制失败：{{error}}',
        onCompleted: async task => {
          if (task && task.failed === 0 && options.clearClipboardOnSuccess) {
            await clearFileClipboardState();
          }
        },
        onSettled: async task => {
          await recordManualOperationHistory({
            category: 'copy',
            title: '复制',
            summary: `复制 ${paths.length} 个项目`,
            itemCount: paths.length,
            status: resolveTransferTaskOperationStatus(task),
            canUndo: false,
            reasonNotUndoable: '传输任务无逐项回滚信息',
            primaryPath: paths[0],
            targetPath: targetFolder.path,
            conflictStrategy,
            volumeHint: resolveTransferTaskVolumeHint(task),
          });
        },
      });
    } catch (error) {
      logDragDebug(`copyError error=${formatAppError(error)}`);
      showFeedback(t('messages.operationFailed', { error: formatAppError(error) }));
    }
    return true;
  }, [
    clearFileClipboardState,
    confirmLargeBatchOperation,
    logDragDebug,
    onStartTransfer,
    recordManualOperationHistory,
    setMoveConflictDialog,
    showFeedback,
    t,
    waitForTransferTask,
  ]);

  const handleMoveConflictChoice = useCallback(async (
    moveConflictDialog: MoveConflictDialogState | null,
    strategy: MoveConflictChoice,
  ) => {
    const dialog = moveConflictDialog;
    setMoveConflictDialog(null);
    if (!dialog) return;
    if (strategy === 'cancel') {
      if (dialog.clearDragPayloadOnSuccess) finishSharedFileDrag();
      return;
    }

    if (dialog.operation === 'copy') {
      await executeCopyFiles(dialog.filesToMove, dialog.targetFolder, strategy, {
        clearClipboardOnSuccess: dialog.clearClipboardOnSuccess,
        skipLargeBatchConfirm: true,
      });
      return;
    }

    if (dialog.useTransferTaskOnResolve) {
      await startMoveTaskFromDialogRef.current(dialog.filesToMove, dialog.targetFolder, strategy, {
        clearClipboardOnSuccess: dialog.clearClipboardOnSuccess,
        clearDragPayloadOnSuccess: dialog.clearDragPayloadOnSuccess,
        skipLargeBatchConfirm: true,
      });
      return;
    }

    await executeMoveFilesRef.current(dialog.filesToMove, dialog.targetFolder, strategy, {
      clearClipboardOnSuccess: dialog.clearClipboardOnSuccess,
      clearDragPayloadOnSuccess: dialog.clearDragPayloadOnSuccess,
      skipLargeBatchConfirm: true,
    });
  }, [executeCopyFiles, executeMoveFilesRef, finishSharedFileDrag, setMoveConflictDialog, startMoveTaskFromDialogRef]);

  const moveDraggedFiles = useCallback(async (
    draggedFileId: string,
    targetFolderId: string,
    selectedFileIds: string[],
    findFileById: (id: string) => FileItem | undefined,
  ) => {
    if (!draggedFileId || draggedFileId === targetFolderId) {
      logDragDebug(`moveAbort reason=${!draggedFileId ? 'missing-dragged-id' : 'same-target'}`);
      return;
    }

    const targetFolder = findFileById(targetFolderId);
    if (targetFolder?.type !== 'folder') {
      logDragDebug(`moveAbort reason=target-not-folder targetExists=${Boolean(targetFolder)} targetType=${targetFolder?.type ?? ''}`);
      return;
    }
    if (isRemotePath(targetFolder.path)) {
      logDragDebug('moveAbort reason=remote-target');
      showFeedback(t('messages.remoteReadOnly', { defaultValue: '远程访问第一版仅支持浏览。' }));
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
    if (filesToMove.some(file => isRemotePath(file.path))) {
      logDragDebug('moveAbort reason=remote-source');
      showFeedback(t('messages.remoteReadOnly', { defaultValue: '远程访问第一版仅支持浏览。' }));
      return;
    }

    if (filesToMove.some(file => targetFolder.path === file.path || targetFolder.path.startsWith(`${file.path}/`))) {
      logDragDebug('moveAbort reason=move-into-self');
      showFeedback(t('messages.cannotMoveToSelf'));
      return;
    }

    await executeMoveFilesRef.current(filesToMove, targetFolder, 'abort', {
      useTransferTask: true,
    });
  }, [executeMoveFilesRef, logDragDebug, showFeedback, t]);

  return {
    executeCopyFiles,
    handleMoveConflictChoice,
    importExternalPaths,
    moveDraggedFiles,
    showMoveTaskCompletedFeedback,
    startCrossWindowCopyTask,
    startCrossWindowMoveTask,
    waitForTransferTask,
  };
}
