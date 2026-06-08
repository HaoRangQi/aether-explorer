import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { TFunction } from 'i18next';
import {
  cancelDirSizeTask,
  estimateDirsSizeFast,
  getDirSizeTask,
  getFileInfo,
  getOpenWithOptions,
  pickApplication,
  setDefaultOpenWith,
  startDirSizeTask,
} from '../../api/filesystem';
import type { DirectorySizeTaskSnapshot, OpenWithOption } from '../../api/filesystem';
import { normalizeAppError } from '../../lib/app-error';
import type { FileItem } from '../../types';
import { DIR_SIZE_POLL_INTERVAL_MS, OPEN_WITH_SELECT_OTHER, OPEN_WITH_SELECT_PLACEHOLDER } from './explorer-constants';
import { directorySizeInfoFromTaskSnapshot, makeFolderItemFromPath } from './explorer-utils';
import type { DirectorySizeInfo } from './preview-panel-types';

type UseExplorerInspectorInput = {
  clearContextMenu: () => void;
  currentPath: string;
  favorites: string[];
  getFileTypeLabel: (type: FileItem['type']) => string;
  getTagsForItem: (item: FileItem) => string[];
  isLocalFilesystemPath: (path?: string | null) => boolean;
  lastSelectedFile: FileItem | null;
  onSelectFiles: (ids: string[]) => void;
  onSyncFileOpenWith: (targetPath: string, openWith: string) => void;
  showFeedback: (message: string) => void;
  showPreviewPanel: boolean;
  t: TFunction;
};

export default function useExplorerInspector({
  clearContextMenu,
  currentPath,
  favorites,
  getFileTypeLabel,
  getTagsForItem,
  isLocalFilesystemPath,
  lastSelectedFile,
  onSelectFiles,
  onSyncFileOpenWith,
  showFeedback,
  showPreviewPanel,
  t,
}: UseExplorerInspectorInput) {
  const dirSizeTaskIdRef = useRef<string | null>(null);
  const dirSizePollTimerRef = useRef<number | null>(null);
  const dirSizeRequestSeqRef = useRef(0);

  const [dirSize, setDirSize] = useState<DirectorySizeInfo | null>(null);
  const [dirSizeLoading, setDirSizeLoading] = useState(false);
  const [dirSizeError, setDirSizeError] = useState('');
  const [inspectorOverride, setInspectorOverride] = useState(false);
  const [inspectorDetails, setInspectorDetails] = useState<FileItem | null>(null);
  const [inspectorDetailsLoading, setInspectorDetailsLoading] = useState(false);
  const [openWithOptions, setOpenWithOptions] = useState<OpenWithOption[]>([]);
  const [openWithOptionsLoading, setOpenWithOptionsLoading] = useState(false);
  const [openWithUpdating, setOpenWithUpdating] = useState(false);

  const clearDirSizePolling = useCallback((cancelTask = false) => {
    if (dirSizePollTimerRef.current) {
      window.clearInterval(dirSizePollTimerRef.current);
      dirSizePollTimerRef.current = null;
    }

    const taskId = dirSizeTaskIdRef.current;
    dirSizeTaskIdRef.current = null;
    if (cancelTask && taskId) {
      void cancelDirSizeTask(taskId).catch(() => {});
    }
  }, []);

  const closeInspector = useCallback(() => {
    setInspectorOverride(false);
    if (!showPreviewPanel) {
      clearDirSizePolling(true);
      setDirSize(null);
      setDirSizeLoading(false);
      setDirSizeError('');
    }
  }, [clearDirSizePolling, showPreviewPanel]);

  const handleShowInspector = useCallback((useCurrentDir = false) => {
    const openInspector = () => {
      if (useCurrentDir) onSelectFiles([]);
      setInspectorOverride(true);
      clearContextMenu();
    };

    if (useCurrentDir && inspectorOverride) {
      setInspectorOverride(false);
      window.setTimeout(openInspector, 150);
      return;
    }

    openInspector();
  }, [clearContextMenu, inspectorOverride, onSelectFiles]);

  const inspectorSourceFile = useMemo(
    () => lastSelectedFile ?? (currentPath ? makeFolderItemFromPath(currentPath) : null),
    [currentPath, lastSelectedFile],
  );

  const inspectorFile = useMemo(() => {
    if (!inspectorSourceFile) return null;
    if (!inspectorDetails || inspectorDetails.path !== inspectorSourceFile.path) return inspectorSourceFile;
    return {
      ...inspectorSourceFile,
      ...inspectorDetails,
      size: inspectorDetails.size === '--' && inspectorSourceFile.size
        ? inspectorSourceFile.size
        : (inspectorDetails.size || inspectorSourceFile.size),
      thumbnail: inspectorSourceFile.thumbnail || inspectorDetails.thumbnail,
      duration: inspectorSourceFile.duration || inspectorDetails.duration,
      dimensions: inspectorSourceFile.dimensions || inspectorDetails.dimensions,
      tags: inspectorSourceFile.tags || inspectorDetails.tags,
    };
  }, [inspectorDetails, inspectorSourceFile]);

  const inspectorVisible = Boolean((inspectorOverride || (lastSelectedFile && showPreviewPanel)) && inspectorFile);
  const inspectorFileType = inspectorFile ? getFileTypeLabel(inspectorFile.type) : t('explorer.folder', '文件夹');
  const inspectorTags = inspectorFile ? getTagsForItem(inspectorFile) : [];
  const inspectorIsFavorite = inspectorFile ? favorites.includes(inspectorFile.path) : false;
  const inspectorSizeInfo = inspectorFile?.type === 'folder' && dirSize?.path === inspectorFile.path
    ? dirSize
    : null;
  const inspectorPath = inspectorFile?.path || '';
  const inspectorType = inspectorFile?.type;
  const inspectorSupportsOpenWith = Boolean(
    inspectorFile
      && inspectorFile.type !== 'folder'
      && inspectorFile.type !== 'application'
      && isLocalFilesystemPath(inspectorFile.path),
  );
  const inspectorDefaultOpenWith = openWithOptions.find(option => option.isDefault) ?? null;
  const inspectorOpenWithValue = inspectorDefaultOpenWith?.path ?? OPEN_WITH_SELECT_PLACEHOLDER;
  const inspectorOpenWithDisabled = !inspectorSupportsOpenWith || openWithOptionsLoading || openWithUpdating;
  const inspectorOpenWithPlaceholder = openWithOptionsLoading
    ? t('explorer.openWithLoading', '正在加载应用...')
    : openWithUpdating
      ? t('explorer.reading', '正在读取...')
      : inspectorFile?.openWith || t('explorer.selectOpenWith', '选择应用');
  const inspectorSizePending = Boolean(
    inspectorSizeInfo?.status
      && !['completed', 'failed', 'cancelled'].includes(inspectorSizeInfo.status),
  );
  const inspectorSizeStatusText = inspectorSizeInfo
    ? inspectorSizeInfo.status === 'failed'
      ? t('explorer.sizeUpdateFailed', '统计未完成')
      : inspectorSizeInfo.status === 'cancelled'
        ? t('explorer.sizeUpdateCancelled', '统计已取消')
        : inspectorSizeInfo.isApproximate
          ? t('explorer.sizeEstimated', '估算中，结果会继续更新')
          : inspectorSizePending
            ? t('explorer.sizeUpdating', '正在统计，结果会继续更新')
            : ''
    : '';

  useEffect(() => {
    if (!inspectorVisible || !inspectorSourceFile?.path || !isLocalFilesystemPath(inspectorSourceFile.path)) {
      setInspectorDetails(null);
      setInspectorDetailsLoading(false);
      return;
    }

    let disposed = false;
    const path = inspectorSourceFile.path;
    setInspectorDetails(prev => (prev?.path === path ? prev : null));
    setInspectorDetailsLoading(true);

    getFileInfo(path)
      .then(file => {
        if (!disposed) setInspectorDetails(file);
      })
      .catch(() => {
        if (!disposed) setInspectorDetails(null);
      })
      .finally(() => {
        if (!disposed) setInspectorDetailsLoading(false);
      });

    return () => {
      disposed = true;
    };
  }, [inspectorSourceFile, inspectorVisible, isLocalFilesystemPath]);

  useEffect(() => {
    if (!inspectorVisible || !inspectorSourceFile?.path || !isLocalFilesystemPath(inspectorSourceFile.path) || inspectorSourceFile.type === 'folder') {
      setOpenWithOptions([]);
      setOpenWithOptionsLoading(false);
      setOpenWithUpdating(false);
      return;
    }

    let disposed = false;
    const path = inspectorSourceFile.path;
    setOpenWithOptions([]);
    setOpenWithOptionsLoading(true);

    getOpenWithOptions(path)
      .then(options => {
        if (!disposed) setOpenWithOptions(options);
      })
      .catch(() => {
        if (!disposed) setOpenWithOptions([]);
      })
      .finally(() => {
        if (!disposed) setOpenWithOptionsLoading(false);
      });

    return () => {
      disposed = true;
    };
  }, [inspectorSourceFile, inspectorVisible, isLocalFilesystemPath]);

  const applyInspectorDefaultOpenWith = useCallback(async (targetAppPath: string) => {
    if (!inspectorFile || !inspectorSupportsOpenWith) return;
    setOpenWithUpdating(true);
    try {
      const appName = await setDefaultOpenWith(inspectorFile.path, targetAppPath);
      setOpenWithOptions(prev => {
        const exists = prev.some(option => option.path === targetAppPath);
        const next = exists
          ? prev.map(option => ({
            ...option,
            isDefault: option.path === targetAppPath,
          }))
          : [
            ...prev.map(option => ({ ...option, isDefault: false })),
            {
              name: appName,
              path: targetAppPath,
              isDefault: true,
            },
          ];

        return next.sort((a, b) => {
          if (a.isDefault !== b.isDefault) return Number(b.isDefault) - Number(a.isDefault);
          return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
        });
      });
      onSyncFileOpenWith(inspectorFile.path, appName);
      setInspectorDetails(prev => (
        prev?.path === inspectorFile.path && prev.openWith !== appName
          ? { ...prev, openWith: appName }
          : prev
      ));
      showFeedback(t('messages.defaultOpenWithUpdated', {
        app: appName,
        defaultValue: `已将默认打开方式改为 ${appName}`,
      }));
    } catch (err) {
      showFeedback(t('messages.defaultOpenWithUpdateFailed', {
        error: normalizeAppError(err).userMessage,
        defaultValue: `设置默认打开方式失败：${normalizeAppError(err).userMessage}`,
      }));
    } finally {
      setOpenWithUpdating(false);
    }
  }, [inspectorFile, inspectorSupportsOpenWith, onSyncFileOpenWith, showFeedback, t]);

  const handleInspectorOpenWithOther = useCallback(async () => {
    if (!inspectorFile || !inspectorSupportsOpenWith) return;
    try {
      const selected = await pickApplication();
      if (!selected) return;
      if (inspectorDefaultOpenWith?.path === selected) return;
      await applyInspectorDefaultOpenWith(selected);
    } catch (err) {
      showFeedback(t('messages.defaultOpenWithUpdateFailed', {
        error: normalizeAppError(err).userMessage,
        defaultValue: `设置默认打开方式失败：${normalizeAppError(err).userMessage}`,
      }));
    }
  }, [applyInspectorDefaultOpenWith, inspectorDefaultOpenWith?.path, inspectorFile, inspectorSupportsOpenWith, showFeedback, t]);

  const handleInspectorOpenWithChange = useCallback(async (event: React.ChangeEvent<HTMLSelectElement>) => {
    if (!inspectorFile || !inspectorSupportsOpenWith) return;
    const nextAppPath = event.target.value;
    if (!nextAppPath || nextAppPath === OPEN_WITH_SELECT_PLACEHOLDER) return;
    if (nextAppPath === OPEN_WITH_SELECT_OTHER) {
      await handleInspectorOpenWithOther();
      return;
    }
    if (inspectorDefaultOpenWith?.path === nextAppPath) return;
    await applyInspectorDefaultOpenWith(nextAppPath);
  }, [
    applyInspectorDefaultOpenWith,
    handleInspectorOpenWithOther,
    inspectorDefaultOpenWith?.path,
    inspectorFile,
    inspectorSupportsOpenWith,
  ]);

  useEffect(() => {
    if (!inspectorVisible || !inspectorPath) {
      clearDirSizePolling(true);
      setDirSize(null);
      setDirSizeLoading(false);
      setDirSizeError('');
      return;
    }

    if (inspectorType !== 'folder' || !isLocalFilesystemPath(inspectorPath)) {
      clearDirSizePolling(true);
      setDirSize(null);
      setDirSizeLoading(false);
      setDirSizeError('');
      return;
    }

    const path = inspectorPath;
    const requestId = ++dirSizeRequestSeqRef.current;
    let disposed = false;

    clearDirSizePolling(true);
    setDirSize(null);
    setDirSizeError('');
    setDirSizeLoading(true);

    const stopPolling = () => {
      if (dirSizePollTimerRef.current) {
        window.clearInterval(dirSizePollTimerRef.current);
        dirSizePollTimerRef.current = null;
      }
    };

    const applyTaskSnapshot = (snapshot: DirectorySizeTaskSnapshot) => {
      if (disposed || requestId !== dirSizeRequestSeqRef.current) return;
      setDirSize(prev => {
        const next = directorySizeInfoFromTaskSnapshot(snapshot);
        if (
          snapshot.status === 'running'
          && snapshot.bytes === 0
          && snapshot.fileCount === 0
          && prev?.path === snapshot.path
          && (prev.bytes > 0 || prev.file_count > 0)
        ) {
          return {
            ...prev,
            status: snapshot.status,
            isApproximate: true,
            error: snapshot.error,
          };
        }
        return next;
      });

      const isFinished = snapshot.status === 'completed' || snapshot.status === 'failed' || snapshot.status === 'cancelled';
      setDirSizeLoading(!isFinished);
      if (snapshot.status === 'failed' && snapshot.error) {
        setDirSizeError(snapshot.error);
      } else if (snapshot.status !== 'failed') {
        setDirSizeError('');
      }

      if (isFinished) {
        stopPolling();
        dirSizeTaskIdRef.current = null;
      }
    };

    const pollTask = async (taskId: string) => {
      const snapshot = await getDirSizeTask(taskId);
      if (disposed || requestId !== dirSizeRequestSeqRef.current) return;
      if (!snapshot) {
        setDirSizeLoading(false);
        setDirSizeError(t('explorer.sizeTaskUnavailable', '大小统计任务记录已清理'));
        stopPolling();
        dirSizeTaskIdRef.current = null;
        return;
      }
      applyTaskSnapshot(snapshot);
    };

    void (async () => {
      try {
        const estimates = await estimateDirsSizeFast([path]);
        if (disposed || requestId !== dirSizeRequestSeqRef.current) return;
        const estimate = estimates.find(item => item.path === path);
        if (estimate) {
          setDirSize({
            path,
            bytes: estimate.bytes,
            formatted: estimate.formatted,
            allocated_bytes: estimate.bytes,
            formatted_allocated: estimate.formatted,
            file_count: 0,
            skipped_count: 0,
            isApproximate: true,
            status: 'running',
            error: null,
          });
        }

        const taskId = await startDirSizeTask(path);
        if (disposed || requestId !== dirSizeRequestSeqRef.current) {
          void cancelDirSizeTask(taskId).catch(() => {});
          return;
        }

        dirSizeTaskIdRef.current = taskId;
        await pollTask(taskId);
        if (disposed || !dirSizeTaskIdRef.current) return;

        dirSizePollTimerRef.current = window.setInterval(() => {
          void pollTask(taskId).catch(error => {
            if (disposed || requestId !== dirSizeRequestSeqRef.current) return;
            setDirSizeError(normalizeAppError(error).userMessage);
            setDirSizeLoading(false);
            stopPolling();
            dirSizeTaskIdRef.current = null;
          });
        }, DIR_SIZE_POLL_INTERVAL_MS);
      } catch (error) {
        if (disposed || requestId !== dirSizeRequestSeqRef.current) return;
        setDirSizeError(normalizeAppError(error).userMessage);
        setDirSizeLoading(false);
      }
    })();

    return () => {
      disposed = true;
      clearDirSizePolling(true);
    };
  }, [clearDirSizePolling, inspectorVisible, inspectorPath, inspectorType, isLocalFilesystemPath, t]);

  useEffect(() => () => {
    clearDirSizePolling(true);
  }, [clearDirSizePolling]);

  return {
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
  };
}
