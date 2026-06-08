import type {
  DragEvent as ReactDragEvent,
  MouseEvent as ReactMouseEvent,
  MutableRefObject,
} from 'react';
import { useEffect, useRef, useState } from 'react';
import type { TFunction } from 'i18next';
import {
  clearFileDragPayload,
  getFileDragPayload,
  setFileDragPayload,
} from '../../api/filesystem';
import type { FileTransferPayload } from '../../api/filesystem';
import type { FileItem } from '../../types';
import {
  currentWindowLabel,
  safeEmit,
  safeInvoke,
  safeListen,
} from '../../lib/tauri-runtime';
import {
  FILE_DRAG_END_AT_EVENT,
  FILE_DRAG_END_EVENT,
  FILE_DRAG_START_EVENT,
  INTERNAL_FILE_DRAG_MIME,
} from './explorer-constants';
import type {
  DragPreviewState,
  FileDragBroadcastPayload,
  FileDragEndAtPayload,
  InternalDragState,
} from './explorer-types';

type ActiveTransferState = {
  transferId: string;
  paths: string[];
};

type UseExplorerDragDropInput = {
  activeTransferRef?: MutableRefObject<ActiveTransferState | null>;
  findFileById: (id: string) => FileItem | undefined;
  focusCurrentWindow: () => void | Promise<void>;
  getActionDirectory: (preferredPath?: string) => string;
  importExternalPaths: (paths: string[], targetPath?: string) => Promise<boolean>;
  isRemotePath: (path: string) => boolean;
  logDragDebug: (message: string) => void;
  moveDraggedFiles: (draggedFileId: string, targetFolderId: string) => Promise<void>;
  movePayloadPathsToDirectory: (paths: string[], targetDir: string) => Promise<void>;
  movePayloadPathsToFolder: (paths: string[], targetFolder: FileItem) => Promise<void>;
  recentExternalDropRef?: MutableRefObject<Set<string>>;
  selectedFileIds: string[];
  selectedFiles: FileItem[];
  showFeedback: (message: string) => void;
  t: TFunction;
};

export default function useExplorerDragDrop({
  activeTransferRef: providedActiveTransferRef,
  findFileById,
  focusCurrentWindow,
  getActionDirectory,
  importExternalPaths,
  isRemotePath,
  logDragDebug,
  moveDraggedFiles,
  movePayloadPathsToDirectory,
  movePayloadPathsToFolder,
  recentExternalDropRef: providedRecentExternalDropRef,
  selectedFileIds,
  selectedFiles,
  showFeedback,
  t,
}: UseExplorerDragDropInput) {
  const [dragOverFolderId, setDragOverFolderId] = useState<string | null>(null);
  const [dragPreview, setDragPreview] = useState<DragPreviewState | null>(null);
  const [isAppFileDragActive, setIsAppFileDragActive] = useState(false);

  const fileDragActivityTimerRef = useRef<number | null>(null);
  const fileDragClearTimerRef = useRef<number | null>(null);
  const externalDragFallbackTimerRef = useRef<number | null>(null);
  const localFileDropHandledRef = useRef(false);
  const draggedFileIdRef = useRef<string | null>(null);
  const internalActiveTransferRef = useRef<ActiveTransferState | null>(null);
  const activeTransferRef = providedActiveTransferRef ?? internalActiveTransferRef;
  const internalRecentExternalDropRef = useRef<Set<string>>(new Set());
  const recentExternalDropRef = providedRecentExternalDropRef ?? internalRecentExternalDropRef;
  const nativeFileDragActiveRef = useRef(false);
  const dragCursorHandlerRef = useRef<((event: DragEvent) => void) | null>(null);
  const lastRaiseAtRef = useRef(0);
  const lastRaisedLabelRef = useRef<string | null>(null);
  const findFileByIdRef = useRef(findFileById);
  const finishSharedFileDragRef = useRef<(delayMs?: number) => void>(() => {});
  const logDragDebugRef = useRef(logDragDebug);
  const moveDraggedFilesRef = useRef(moveDraggedFiles);
  const dragOverFolderIdRef = useRef<string | null>(null);
  const internalDragRef = useRef<InternalDragState | null>(null);
  const selectedFileIdsRef = useRef(selectedFileIds);
  const selectedFilesRef = useRef(selectedFiles);
  const writeDragPayloadRef = useRef<(file: FileItem) => string[]>(() => []);

  findFileByIdRef.current = findFileById;
  logDragDebugRef.current = logDragDebug;
  moveDraggedFilesRef.current = moveDraggedFiles;
  dragOverFolderIdRef.current = dragOverFolderId;
  selectedFileIdsRef.current = selectedFileIds;
  selectedFilesRef.current = selectedFiles;

  const markAppFileDragActive = () => {
    setIsAppFileDragActive(true);
    if (fileDragActivityTimerRef.current) {
      window.clearTimeout(fileDragActivityTimerRef.current);
    }
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

  const clearExternalDragFallback = () => {
    if (externalDragFallbackTimerRef.current) {
      window.clearTimeout(externalDragFallbackTimerRef.current);
      externalDragFallbackTimerRef.current = null;
    }
  };

  const finishSharedFileDrag = (delayMs = 0) => {
    if (fileDragClearTimerRef.current) {
      window.clearTimeout(fileDragClearTimerRef.current);
    }
    const finish = () => {
      fileDragClearTimerRef.current = null;
      clearExternalDragFallback();
      activeTransferRef.current = null;
      clearAppFileDragActive();
      void clearFileDragPayload();
      void safeEmit(FILE_DRAG_END_EVENT);
    };
    if (delayMs > 0) {
      fileDragClearTimerRef.current = window.setTimeout(finish, delayMs);
    } else {
      finish();
    }
  };
  finishSharedFileDragRef.current = finishSharedFileDrag;

  const startCursorRaiseTracking = () => {
    if (dragCursorHandlerRef.current) return;
    const sourceLabel = currentWindowLabel();
    const handler = (event: DragEvent) => {
      const now = Date.now();
      if (now - lastRaiseAtRef.current < 50) return;
      if (event.screenX === 0 && event.screenY === 0) return;
      lastRaiseAtRef.current = now;
      safeInvoke<string | null>('raise_window_at', {
        screenX: event.screenX,
        screenY: event.screenY,
        exceptWindow: sourceLabel,
      })
        .then(label => {
          if (label && label !== lastRaisedLabelRef.current) {
            lastRaisedLabelRef.current = label;
            logDragDebug(`raised window=${label} at=${event.screenX},${event.screenY}`);
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

  const getTransferPathsForFile = (file: FileItem) => {
    const items = selectedFileIdsRef.current.includes(file.id) && selectedFilesRef.current.length > 0
      ? selectedFilesRef.current
      : [file];
    return items.map(item => item.path);
  };

  const writeDragPayload = (file: FileItem) => {
    const paths = getTransferPathsForFile(file);
    if (paths.some(isRemotePath)) {
      showFeedback(t('messages.remoteReadOnly', { defaultValue: '远程访问第一版仅支持浏览。' }));
      return [];
    }
    const sourceWindow = currentWindowLabel();
    const transferId = `xfer-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const previewName = paths.length === 1 ? file.name : `${file.name} 等 ${paths.length} 项`;
    localFileDropHandledRef.current = false;
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
      .then(() => safeEmit(FILE_DRAG_START_EVENT, {
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
  writeDragPayloadRef.current = writeDragPayload;

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

  const markRecentExternalDrop = (path: string) => {
    recentExternalDropRef.current.add(path);
    window.setTimeout(() => {
      recentExternalDropRef.current.delete(path);
    }, 1500);
  };

  const isRecentExternalDrop = (path: string) => recentExternalDropRef.current.has(path);

  useEffect(() => {
    const startListener = safeListen<FileTransferPayload>(FILE_DRAG_START_EVENT, event => {
      if (event.payload?.paths.length) {
        markAppFileDragActive();
      }
    });
    const endListener = safeListen(FILE_DRAG_END_EVENT, () => {
      clearAppFileDragActive();
    });

    return () => {
      startListener.then(unlisten => unlisten());
      endListener.then(unlisten => unlisten());
      if (fileDragActivityTimerRef.current) {
        window.clearTimeout(fileDragActivityTimerRef.current);
        fileDragActivityTimerRef.current = null;
      }
      if (fileDragClearTimerRef.current) {
        window.clearTimeout(fileDragClearTimerRef.current);
        fileDragClearTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    const handleInternalMouseMove = (event: MouseEvent) => {
      if (nativeFileDragActiveRef.current) return;
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
          count: selectedFileIdsRef.current.includes(dragState.id)
            ? Math.max(1, selectedFileIdsRef.current.length)
            : 1,
          active: true,
        });
        const sourceFile = findFileByIdRef.current(dragState.id);
        if (sourceFile) {
          writeDragPayloadRef.current(sourceFile);
        }
        logDragDebugRef.current(`mouseDragStart id=${dragState.id}`);
      } else {
        setDragPreview(prev => (prev ? { ...prev, x: event.clientX, y: event.clientY } : prev));
      }

      const folderId = getFolderIdFromPoint(event.clientX, event.clientY, dragState.id);
      if (folderId !== dragOverFolderIdRef.current) {
        logDragDebugRef.current(`mouseDragOver folderId=${folderId ?? ''}`);
        dragOverFolderIdRef.current = folderId;
        setDragOverFolderId(folderId);
      }
    };

    const handleInternalMouseUp = async (event: MouseEvent) => {
      if (nativeFileDragActiveRef.current) {
        internalDragRef.current = null;
        return;
      }
      const dragState = internalDragRef.current;
      if (!dragState) return;

      internalDragRef.current = null;
      dragOverFolderIdRef.current = null;
      setDragOverFolderId(null);
      setDragPreview(null);

      if (!dragState.active) {
        finishSharedFileDragRef.current();
        return;
      }

      const folderId = getFolderIdFromPoint(event.clientX, event.clientY, dragState.id);
      logDragDebugRef.current(`mouseDrop draggedId=${dragState.id} folderId=${folderId ?? ''}`);
      if (folderId) {
        if (localFileDropHandledRef.current) {
          finishSharedFileDragRef.current();
          return;
        }
        localFileDropHandledRef.current = true;
        await moveDraggedFilesRef.current(dragState.id, folderId);
      }
      finishSharedFileDragRef.current();
    };

    window.addEventListener('mousemove', handleInternalMouseMove);
    window.addEventListener('mouseup', handleInternalMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleInternalMouseMove);
      window.removeEventListener('mouseup', handleInternalMouseUp);
    };
  }, []);

  useEffect(() => () => {
    stopCursorRaiseTracking();
  }, []);

  const handleFileMouseDown = (event: ReactMouseEvent, file: FileItem) => {
    if (event.button !== 0) return;
    const target = event.target as HTMLElement;
    if (target.closest('button, input, textarea, select, [data-no-drag]')) return;
    if (isRemotePath(file.path)) return;

    internalDragRef.current = {
      id: file.id,
      startX: event.clientX,
      startY: event.clientY,
      active: false,
    };
    draggedFileIdRef.current = file.id;
    setDragPreview({
      x: event.clientX,
      y: event.clientY,
      fileId: file.id,
      count: selectedFileIds.includes(file.id) ? Math.max(1, selectedFileIds.length) : 1,
      active: false,
    });
  };

  const handleExternalDrop = async (event: ReactDragEvent, targetPath?: string) => {
    const rawFiles = Array.from(event.dataTransfer.files || []);
    const paths = rawFiles
      .map(file => (file as File & { path?: string }).path)
      .filter((path): path is string => Boolean(path));
    if (paths.length === 0) return;
    event.preventDefault();
    markRecentExternalDrop(paths[0]);
    await importExternalPaths(paths, targetPath);
  };

  const getFolderIdFromDragEvent = (event: ReactDragEvent) => {
    const target = event.target as HTMLElement | null;
    const item = target?.closest<HTMLElement>('.file-item');
    const id = item?.dataset.id;
    if (!id) return null;

    const file = findFileById(id);
    return file?.type === 'folder' ? id : null;
  };

  function getFolderIdFromPoint(clientX: number, clientY: number, draggedFileId?: string) {
    const element = document.elementFromPoint(clientX, clientY) as HTMLElement | null;
    const item = element?.closest<HTMLElement>('.file-item');
    const id = item?.dataset.id;
    if (!id || id === draggedFileId) return null;

    const file = findFileByIdRef.current(id);
    return file?.type === 'folder' ? id : null;
  }

  const handleDragOver = (event: ReactDragEvent, fileId: string) => {
    if (!isFileTransferDrag(event.dataTransfer)) return;
    void focusCurrentWindow();

    event.preventDefault();
    event.stopPropagation();
    const types = getDragTypes(event.dataTransfer);
    event.dataTransfer.dropEffect = types.includes('Files') ? 'copy' : 'move';
    if (dragOverFolderId !== fileId) {
      logDragDebug(`dragOver folderId=${fileId} dataTypes=${types.join('|')}`);
      setDragOverFolderId(fileId);
    }
  };

  const handleSurfaceDragOver = (event: ReactDragEvent) => {
    if (!isFileTransferDrag(event.dataTransfer)) return;
    void focusCurrentWindow();

    const folderId = getFolderIdFromDragEvent(event);
    if (folderId) {
      handleDragOver(event, folderId);
      return;
    }

    if (dragOverFolderId !== null) {
      setDragOverFolderId(null);
    }
    const types = getDragTypes(event.dataTransfer);
    event.preventDefault();
    event.dataTransfer.dropEffect = types.includes('Files') ? 'copy' : 'move';
  };

  const handleSurfaceDrop = async (event: ReactDragEvent) => {
    if (!isFileTransferDrag(event.dataTransfer)) return;
    void focusCurrentWindow();

    const folderId = getFolderIdFromDragEvent(event);
    if (folderId) {
      await handleDrop(event, folderId);
      return;
    }

    const payload = await readTransferPayload(event.dataTransfer);
    if (payload?.paths.length) {
      const targetDir = getActionDirectory();
      if (!targetDir) {
        showFeedback(t('messages.crossWindowNoTarget', {
          defaultValue: '当前没有可作为目标的真实目录',
        }));
        return;
      }
      event.preventDefault();
      localFileDropHandledRef.current = true;
      if (payload.paths.some(isRemotePath) || isRemotePath(targetDir)) {
        showFeedback(t('messages.remoteReadOnly', { defaultValue: '远程访问第一版仅支持浏览。' }));
        return;
      }
      await movePayloadPathsToDirectory(payload.paths, targetDir);
      return;
    }

    await handleExternalDrop(event);
  };

  const handleDragStart = (event: ReactDragEvent, file: FileItem) => {
    if (isRemotePath(file.path)) {
      event.preventDefault();
      showFeedback(t('messages.remoteReadOnly', { defaultValue: '远程访问第一版仅支持浏览。' }));
      return;
    }
    nativeFileDragActiveRef.current = true;
    internalDragRef.current = null;
    draggedFileIdRef.current = file.id;
    localFileDropHandledRef.current = false;
    const paths = writeDragPayload(file);
    if (paths.length === 0) {
      event.preventDefault();
      return;
    }
    const payload: FileTransferPayload = { paths, cut: true };
    event.dataTransfer.setData(INTERNAL_FILE_DRAG_MIME, JSON.stringify(payload));
    event.dataTransfer.effectAllowed = 'move';
    setDragPreview({
      x: event.clientX,
      y: event.clientY,
      fileId: file.id,
      count: paths.length,
      active: true,
    });

    startCursorRaiseTracking();
    logDragDebug(`dragStart id=${file.id} name=${file.name} type=${file.type} paths=${paths.join('|')}`);
  };

  const handleDragLeave = (event: ReactDragEvent, fileId: string) => {
    const related = event.relatedTarget as Node | null;
    if (related && event.currentTarget.contains(related)) return;
    logDragDebug(`dragLeave folderId=${fileId}`);
    if (dragOverFolderId === fileId) {
      setDragOverFolderId(null);
    }
  };

  const handleDragEnd = (event: ReactDragEvent) => {
    nativeFileDragActiveRef.current = false;
    logDragDebug(`dragEnd activeId=${draggedFileIdRef.current ?? ''} screenX=${event.screenX} screenY=${event.screenY} meta=${event.metaKey} alt=${event.altKey} shift=${event.shiftKey}`);

    stopCursorRaiseTracking();

    const activeDraggedId = draggedFileIdRef.current;
    const pointTarget = document.elementFromPoint(event.clientX, event.clientY) as HTMLElement | null;
    const endedInsideApp = Boolean(pointTarget);
    const pointFolderId = getFolderIdFromPoint(event.clientX, event.clientY, activeDraggedId || undefined);
    const active = activeTransferRef.current;
    const localDropHandled = localFileDropHandledRef.current;

    if (active && !localDropHandled && pointFolderId) {
      localFileDropHandledRef.current = true;
      draggedFileIdRef.current = null;
      setDragPreview(null);
      if (dragOverFolderId !== null) {
        setDragOverFolderId(null);
      }
      clearExternalDragFallback();
      void moveDraggedFilesRef.current(activeDraggedId || '', pointFolderId).finally(() => {
        finishSharedFileDrag(400);
      });
      return;
    }

    if (active && !localDropHandled) {
      void safeEmit(FILE_DRAG_END_AT_EVENT, {
        transferId: active.transferId,
        screenX: event.screenX,
        screenY: event.screenY,
        metaKey: event.metaKey,
        altKey: event.altKey,
        shiftKey: event.shiftKey,
        sourceWindow: currentWindowLabel(),
      } satisfies FileDragEndAtPayload);
    }

    draggedFileIdRef.current = null;
    setDragPreview(null);
    if (dragOverFolderId !== null) {
      setDragOverFolderId(null);
    }
    clearExternalDragFallback();
    if (localDropHandled) {
      finishSharedFileDrag(400);
    } else if (active && !dragOverFolderId && !endedInsideApp) {
      externalDragFallbackTimerRef.current = window.setTimeout(() => {
        externalDragFallbackTimerRef.current = null;
        if (!activeTransferRef.current || activeTransferRef.current.transferId !== active.transferId) return;
        showFeedback(t('messages.finderDragOutFallback', {
          count: active.paths.length,
          defaultValue: '暂不支持直接拖到 Finder。可用“在 Finder 中显示”继续操作。',
        }));
        finishSharedFileDrag(0);
      }, 450);
    } else {
      finishSharedFileDrag(400);
    }
  };

  const handleDrop = async (event: ReactDragEvent, targetFolderId: string) => {
    if (!isFileTransferDrag(event.dataTransfer)) return;
    void focusCurrentWindow();

    event.preventDefault();
    event.stopPropagation();
    if (localFileDropHandledRef.current) {
      finishSharedFileDrag();
      return;
    }
    localFileDropHandledRef.current = true;
    setDragOverFolderId(null);

    const payload = await readTransferPayload(event.dataTransfer);
    const fallbackDraggedId = draggedFileIdRef.current;
    logDragDebug(`drop targetFolderId=${targetFolderId} payloadPaths=${payload?.paths.join('|') ?? ''} ref=${fallbackDraggedId ?? ''} dataTypes=${Array.from(event.dataTransfer.types).join('|')}`);
    draggedFileIdRef.current = null;
    const targetFolder = findFileById(targetFolderId);
    if (!targetFolder || targetFolder.type !== 'folder') {
      finishSharedFileDrag();
      return;
    }
    if (isRemotePath(targetFolder.path)) {
      showFeedback(t('messages.remoteReadOnly', { defaultValue: '远程访问第一版仅支持浏览。' }));
      finishSharedFileDrag();
      return;
    }
    if (payload?.paths.length) {
      if (payload.paths.some(isRemotePath)) {
        showFeedback(t('messages.remoteReadOnly', { defaultValue: '远程访问第一版仅支持浏览。' }));
        finishSharedFileDrag();
        return;
      }
      await movePayloadPathsToFolder(payload.paths, targetFolder);
      return;
    }
    if (getDragTypes(event.dataTransfer).includes('Files')) {
      await handleExternalDrop(event, targetFolder.path);
      return;
    }
    await moveDraggedFilesRef.current(fallbackDraggedId || '', targetFolderId);
  };

  return {
    clearDragPreview: () => setDragPreview(null),
    dragOverFolderId,
    dragPreview,
    clearExternalDragFallback,
    finishSharedFileDrag,
    getActiveTransfer: () => activeTransferRef.current,
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
  };
}
