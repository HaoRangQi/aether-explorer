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

type DragPointSnapshot = {
  at: number;
  clientX: number;
  clientY: number;
  screenX: number | null;
  screenY: number | null;
  target: string;
  type: string;
};

type DragEndSnapshot = {
  altKey: boolean;
  clientX: number;
  clientY: number;
  metaKey: boolean;
  screenX: number;
  screenY: number;
  shiftKey: boolean;
};

type DragScreenClientOffset = {
  at: number;
  offsetX: number;
  offsetY: number;
  source: string;
};

export const getDragTypes = (dataTransfer: Pick<DataTransfer, 'types'>) => Array.from(dataTransfer.types);

export const isExternalFileDrop = (dataTransfer: Pick<DataTransfer, 'types'>) => {
  const types = getDragTypes(dataTransfer);
  return types.includes('Files') && !types.includes(INTERNAL_FILE_DRAG_MIME);
};

export const shouldReadStoredDragPayload = (dataTransfer?: Pick<DataTransfer, 'types'>) => {
  if (!dataTransfer) return true;
  const types = getDragTypes(dataTransfer);
  return !types.includes('Files') || types.includes(INTERNAL_FILE_DRAG_MIME);
};

const describeDataTransfer = (dataTransfer?: Pick<DataTransfer, 'types'> & Partial<Pick<DataTransfer, 'files'>>) => {
  if (!dataTransfer) return 'types=(none) files=0';
  const types = getDragTypes(dataTransfer);
  const files = dataTransfer.files ? Array.from(dataTransfer.files) : [];
  const filePaths = files
    .map(file => (file as File & { path?: string }).path)
    .filter(Boolean);
  return `types=${types.length ? types.join('|') : '(empty)'} files=${files.length} filePaths=${filePaths.length ? filePaths.join('|') : '(none)'}`;
};

const describePaths = (paths?: string[]) => (paths?.length ? paths.join('|') : '(none)');
const compactLogValue = (value: string | null | undefined, maxLength = 160) => {
  if (!value) return '';
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength)}...` : normalized;
};

const normalizeDirectoryPath = (path: string) => {
  const trimmed = path.trim();
  if (!trimmed) return '';
  const withoutTrailing = trimmed.replace(/[\\/]+$/, '');
  return withoutTrailing || (trimmed.startsWith('/') ? '/' : trimmed);
};

const getParentDirectoryPath = (path: string) => {
  const normalized = normalizeDirectoryPath(path);
  if (!normalized || normalized === '/') return normalized;
  const slashIndex = Math.max(normalized.lastIndexOf('/'), normalized.lastIndexOf('\\'));
  if (slashIndex <= 0) {
    return normalized.startsWith('/') ? '/' : '';
  }
  return normalized.slice(0, slashIndex);
};

const hasPathOutsideDirectory = (paths: string[], targetDir: string) => {
  const normalizedTarget = normalizeDirectoryPath(targetDir);
  return paths.some(path => normalizeDirectoryPath(getParentDirectoryPath(path)) !== normalizedTarget);
};

const describeElementForLog = (element: Element | null | undefined) => {
  if (!element) return '(none)';
  const html = element as HTMLElement;
  const id = compactLogValue(html.id);
  const className = compactLogValue(typeof html.className === 'string' ? html.className : '');
  const fileId = compactLogValue(html.dataset?.id);
  const targetDir = compactLogValue(html.dataset?.dropTargetDir);
  return [
    html.tagName.toLowerCase(),
    id ? `#${id}` : '',
    className ? `.${className.replace(/\s+/g, '.')}` : '',
    fileId ? `data-id=${fileId}` : '',
    targetDir ? `dropDir=${targetDir}` : '',
  ].filter(Boolean).join('');
};

const getEventNumeric = (event: Event, key: keyof MouseEvent) => {
  const value = (event as Partial<MouseEvent>)[key];
  return typeof value === 'number' ? value : null;
};

const getEventNumber = (event: Event, key: keyof MouseEvent) => {
  const value = getEventNumeric(event, key);
  return typeof value === 'number' ? String(value) : '(none)';
};

const getEventDataTransfer = (event: Event) => (
  'dataTransfer' in event ? (event as DragEvent).dataTransfer ?? undefined : undefined
);

const getEventTargetElement = (event: Event) => {
  const path = typeof event.composedPath === 'function' ? event.composedPath() : [];
  const pathElement = path.find((item): item is Element => item instanceof Element);
  if (pathElement) return pathElement;
  return event.target instanceof Element ? event.target : null;
};

const getEventPointSnapshot = (event: Event): DragPointSnapshot | null => {
  const clientX = getEventNumeric(event, 'clientX');
  const clientY = getEventNumeric(event, 'clientY');
  if (typeof clientX !== 'number' || typeof clientY !== 'number') return null;
  if (clientX === 0 && clientY === 0) return null;
  return {
    at: Date.now(),
    clientX,
    clientY,
    screenX: getEventNumeric(event, 'screenX'),
    screenY: getEventNumeric(event, 'screenY'),
    target: describeElementForLog(getEventTargetElement(event)),
    type: event.type,
  };
};

const describePointSnapshot = (point: DragPointSnapshot | null | undefined) => (
  point
    ? `${point.type}@${point.clientX},${point.clientY} screen=${point.screenX ?? '(none)'},${point.screenY ?? '(none)'} ageMs=${Date.now() - point.at} target=${point.target || '(none)'}`
    : '(none)'
);

const getElementsFromPointSafe = (clientX: number, clientY: number) => {
  if (typeof document.elementsFromPoint === 'function') {
    return document.elementsFromPoint(clientX, clientY);
  }
  if (typeof document.elementFromPoint === 'function') {
    const element = document.elementFromPoint(clientX, clientY);
    return element ? [element] : [];
  }
  return [];
};

const getElementFromPointSafe = (clientX: number, clientY: number) => {
  if (typeof document.elementFromPoint === 'function') {
    return document.elementFromPoint(clientX, clientY) as HTMLElement | null;
  }
  return getElementsFromPointSafe(clientX, clientY)[0] as HTMLElement | undefined ?? null;
};

const getWindowScreenClientPointCandidates = (
  screenX: number,
  screenY: number,
  dragScreenClientOffset?: DragScreenClientOffset | null,
): DragPointSnapshot[] => {
  if (!Number.isFinite(screenX) || !Number.isFinite(screenY)) return [];
  const now = Date.now();
  const points: DragPointSnapshot[] = [];
  if (dragScreenClientOffset && now - dragScreenClientOffset.at <= 10_000) {
    points.push({
      at: now,
      clientX: screenX - dragScreenClientOffset.offsetX,
      clientY: screenY - dragScreenClientOffset.offsetY,
      screenX,
      screenY,
      target: `(${dragScreenClientOffset.source}-screen-client-offset)`,
      type: 'dragStartScreenOffset',
    });
  }
  const screenLeft = typeof window.screenX === 'number' ? window.screenX : 0;
  const screenTop = typeof window.screenY === 'number' ? window.screenY : 0;
  const frameX = Math.max(0, (window.outerWidth - window.innerWidth) / 2);
  const frameY = Math.max(0, window.outerHeight - window.innerHeight - frameX);
  const raw = {
    at: Date.now(),
    clientX: screenX - screenLeft,
    clientY: screenY - screenTop,
    screenX,
    screenY,
    target: '(screen-window)',
    type: 'screenWindow',
  };
  const adjusted = {
    ...raw,
    clientX: raw.clientX - frameX,
    clientY: raw.clientY - frameY,
    target: '(screen-window-frame-adjusted)',
    type: 'screenWindowFrameAdjusted',
  };
  points.push(raw, adjusted);
  const seen = new Set<string>();
  return points.filter(point => {
    if (
      point.clientX < -160
      || point.clientY < -160
      || point.clientX > window.innerWidth + 160
      || point.clientY > window.innerHeight + 160
    ) {
      return false;
    }
    const key = `${Math.round(point.clientX)}:${Math.round(point.clientY)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const describeGlobalEventForLog = (scope: 'document' | 'window', event: Event, state: string) => {
  const dataTransfer = getEventDataTransfer(event);
  return [
    `globalEvent scope=${scope}`,
    `type=${event.type}`,
    `phase=${event.eventPhase}`,
    `client=${getEventNumber(event, 'clientX')},${getEventNumber(event, 'clientY')}`,
    `screen=${getEventNumber(event, 'screenX')},${getEventNumber(event, 'screenY')}`,
    `button=${getEventNumber(event, 'button')}`,
    `buttons=${getEventNumber(event, 'buttons')}`,
    `defaultPrevented=${event.defaultPrevented ? 'yes' : 'no'}`,
    `dropEffect=${dataTransfer?.dropEffect ?? '(none)'}`,
    `effectAllowed=${dataTransfer?.effectAllowed ?? '(none)'}`,
    `target=${describeElementForLog(getEventTargetElement(event))}`,
    describeDataTransfer(dataTransfer),
    state,
  ].join(' ');
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
  copyPayloadPathsToDirectory: (paths: string[], targetDir: string) => Promise<void>;
  copyPayloadPathsToFolder: (paths: string[], targetFolder: FileItem) => Promise<void>;
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
  copyPayloadPathsToDirectory,
  copyPayloadPathsToFolder,
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
  const getFolderIdFromPointRef = useRef<(clientX: number, clientY: number, draggedFileId?: string) => string | null>(() => null);
  const describePointHitRef = useRef<(clientX: number, clientY: number) => string>(() => '(none)');
  const lastDragPointRef = useRef<DragPointSnapshot | null>(null);
  const lastReleasePointRef = useRef<DragPointSnapshot | null>(null);
  const dragScreenClientOffsetRef = useRef<DragScreenClientOffset | null>(null);
  const lastDragGateLogRef = useRef<{ key: string; at: number }>({ key: '', at: 0 });
  const lastGlobalEventLogRef = useRef<Map<string, number>>(new Map());
  const getDragStateSnapshotRef = useRef<() => string>(() => '');
  const logDragGateRef = useRef<(label: string, dataTransfer: DataTransfer, detail?: string, force?: boolean) => void>(() => {});
  const appFileDragActiveRef = useRef(false);

  findFileByIdRef.current = findFileById;
  logDragDebugRef.current = logDragDebug;
  moveDraggedFilesRef.current = moveDraggedFiles;
  dragOverFolderIdRef.current = dragOverFolderId;
  selectedFileIdsRef.current = selectedFileIds;
  selectedFilesRef.current = selectedFiles;

  const getDragStateSnapshot = () => {
    const active = activeTransferRef.current;
    const internal = internalDragRef.current;
    return [
      `active=${active?.transferId ?? '(none)'}`,
      `activePaths=${active?.paths.length ?? 0}`,
      `dragged=${draggedFileIdRef.current ?? '(none)'}`,
      `internal=${internal ? `${internal.id}:${internal.active ? 'active' : 'pending'}` : '(none)'}`,
      `native=${nativeFileDragActiveRef.current ? 'yes' : 'no'}`,
      `appActive=${appFileDragActiveRef.current || isAppFileDragActive ? 'yes' : 'no'}`,
      `handled=${localFileDropHandledRef.current ? 'yes' : 'no'}`,
      `over=${dragOverFolderIdRef.current ?? '(none)'}`,
    ].join(' ');
  };
  getDragStateSnapshotRef.current = getDragStateSnapshot;

  const logDragGate = (label: string, dataTransfer: DataTransfer, detail = '', force = false) => {
    const key = `${label}|${detail}|${describeDataTransfer(dataTransfer)}|${getDragStateSnapshot()}`;
    const now = Date.now();
    if (!force && lastDragGateLogRef.current.key === key && now - lastDragGateLogRef.current.at < 300) {
      return;
    }
    lastDragGateLogRef.current = { key, at: now };
    logDragDebug(`${label} ${detail} ${describeDataTransfer(dataTransfer)} ${getDragStateSnapshot()}`);
  };
  logDragGateRef.current = logDragGate;

  const markAppFileDragActive = () => {
    appFileDragActiveRef.current = true;
    setIsAppFileDragActive(true);
    if (fileDragActivityTimerRef.current) {
      window.clearTimeout(fileDragActivityTimerRef.current);
    }
    fileDragActivityTimerRef.current = window.setTimeout(() => {
      appFileDragActiveRef.current = false;
      setIsAppFileDragActive(false);
      fileDragActivityTimerRef.current = null;
    }, 7000);
  };

  const clearAppFileDragActive = () => {
    appFileDragActiveRef.current = false;
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

  const stopCursorRaiseTracking = () => {
    if (dragCursorHandlerRef.current) {
      document.removeEventListener('drag', dragCursorHandlerRef.current, true);
      dragCursorHandlerRef.current = null;
    }
    lastRaisedLabelRef.current = null;
    lastRaiseAtRef.current = 0;
  };

  const resetLocalDragState = () => {
    logDragDebug(`resetLocalDragState before ${getDragStateSnapshot()}`);
    nativeFileDragActiveRef.current = false;
    internalDragRef.current = null;
    draggedFileIdRef.current = null;
    localFileDropHandledRef.current = false;
    dragOverFolderIdRef.current = null;
    lastDragPointRef.current = null;
    lastReleasePointRef.current = null;
    dragScreenClientOffsetRef.current = null;
    setDragOverFolderId(null);
    setDragPreview(null);
    stopCursorRaiseTracking();
  };

  const finishSharedFileDrag = (delayMs = 0) => {
    if (fileDragClearTimerRef.current) {
      window.clearTimeout(fileDragClearTimerRef.current);
    }
    logDragDebug(`finishSharedFileDrag requested delayMs=${delayMs} ${getDragStateSnapshot()}`);
    const finish = () => {
      fileDragClearTimerRef.current = null;
      logDragDebug(`finishSharedFileDrag running ${getDragStateSnapshot()}`);
      resetLocalDragState();
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

  const getTransferPathsForFile = (file: FileItem) => {
    const items = selectedFileIdsRef.current.includes(file.id) && selectedFilesRef.current.length > 0
      ? selectedFilesRef.current
      : [file];
    return items.map(item => item.path);
  };

  const writeDragPayload = (file: FileItem) => {
    const paths = getTransferPathsForFile(file);
    if (paths.some(isRemotePath)) {
      logDragDebug(`writeDragPayload abort=remote fileId=${file.id} paths=${describePaths(paths)} ${getDragStateSnapshot()}`);
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
    logDragDebug(`writeDragPayload transferId=${transferId} sourceWindow=${sourceWindow} fileId=${file.id} count=${paths.length} paths=${describePaths(paths)} ${getDragStateSnapshot()}`);
    markAppFileDragActive();
    void setFileDragPayload(paths, true, {
      sourceWindow,
      transferId,
      previewName,
      count: paths.length,
    })
      .then(() => {
        logDragDebug(`setFileDragPayload ok transferId=${transferId} paths=${describePaths(paths)} ${getDragStateSnapshot()}`);
        return safeEmit(FILE_DRAG_START_EVENT, {
          paths,
          sourceWindow,
          transferId,
          previewName,
          count: paths.length,
          cut: true,
        } satisfies FileDragBroadcastPayload);
      })
      .then(() => {
        logDragDebug(`emitDragStart ok transferId=${transferId} ${getDragStateSnapshot()}`);
      })
      .catch(error => {
        logDragDebug(`setOrEmitDragPayload failed transferId=${transferId} error=${String(error)} ${getDragStateSnapshot()}`);
      });
    return paths;
  };
  writeDragPayloadRef.current = writeDragPayload;

  const readTransferPayload = async (dataTransfer?: DataTransfer): Promise<FileTransferPayload | null> => {
    logDragDebug(`readTransferPayload enter ${describeDataTransfer(dataTransfer)} ${getDragStateSnapshot()}`);
    const raw = dataTransfer?.getData(INTERNAL_FILE_DRAG_MIME);
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as FileTransferPayload;
        if (Array.isArray(parsed.paths) && parsed.paths.length > 0) {
          logDragDebug(`readTransferPayload source=dataTransfer cut=${parsed.cut ? 'yes' : 'no'} paths=${describePaths(parsed.paths)} ${getDragStateSnapshot()}`);
          return parsed;
        }
      } catch {
        logDragDebug(`readTransferPayload dataTransferParseFailed rawLength=${raw.length} ${getDragStateSnapshot()}`);
      }
    }
    if (!shouldReadStoredDragPayload(dataTransfer)) {
      logDragDebug(`readTransferPayload skipStored reason=external-files ${describeDataTransfer(dataTransfer)} ${getDragStateSnapshot()}`);
      return null;
    }

    try {
      const payload = await getFileDragPayload();
      if (payload?.paths.length) {
        logDragDebug(`readTransferPayload source=tauri cut=${payload.cut ? 'yes' : 'no'} paths=${describePaths(payload.paths)} ${getDragStateSnapshot()}`);
        return payload;
      }
      logDragDebug(`readTransferPayload tauriEmpty ${getDragStateSnapshot()}`);
    } catch (error) {
      logDragDebug(`readTransferPayload tauriError=${String(error)} ${getDragStateSnapshot()}`);
      // fall through to the local in-memory payload below
    }
    const localTransfer = activeTransferRef.current;
    if (localTransfer?.paths.length) {
      logDragDebug(`readTransferPayload source=local transferId=${localTransfer.transferId} paths=${describePaths(localTransfer.paths)} ${getDragStateSnapshot()}`);
      return { paths: localTransfer.paths, cut: true, transferId: localTransfer.transferId };
    }
    logDragDebug(`readTransferPayload none ${getDragStateSnapshot()}`);
    return null;
  };

  const hasLocalInternalDrag = () => Boolean(activeTransferRef.current || draggedFileIdRef.current || internalDragRef.current);

  const isFileTransferDrag = (dataTransfer: DataTransfer) => {
    const types = getDragTypes(dataTransfer);
    return types.includes('Files') || types.includes(INTERNAL_FILE_DRAG_MIME) || hasLocalInternalDrag() || isAppFileDragActive;
  };

  const getDropEffect = (dataTransfer: DataTransfer): 'copy' | 'move' => (
    isExternalFileDrop(dataTransfer) || !hasLocalInternalDrag() ? 'copy' : 'move'
  );

  const markRecentExternalDrop = (path: string) => {
    recentExternalDropRef.current.add(path);
    window.setTimeout(() => {
      recentExternalDropRef.current.delete(path);
    }, 1500);
  };

  const isRecentExternalDrop = (path: string) => recentExternalDropRef.current.has(path);

  useEffect(() => {
    const noisyEventTypes = new Set(['drag', 'dragover']);
    const logWithoutActiveDragEventTypes = new Set([
      'dragstart',
      'drop',
      'dragend',
      'blur',
      'visibilitychange',
    ]);
    const hasActiveDragForGlobalLog = () => Boolean(
      activeTransferRef.current
      || draggedFileIdRef.current
      || internalDragRef.current
      || nativeFileDragActiveRef.current
      || appFileDragActiveRef.current
    );
    const captureGlobalReleasePoint = (event: Event) => {
      if (event.type !== 'mouseup' && event.type !== 'pointerup') return;
      if (!hasActiveDragForGlobalLog()) return;
      const point = getEventPointSnapshot(event);
      if (!point) return;
      lastReleasePointRef.current = point;
      const folderId = getFolderIdFromPointRef.current(point.clientX, point.clientY, draggedFileIdRef.current ?? undefined);
      const targetDir = getDropDirectoryFromPoint(point.clientX, point.clientY);
      if (folderId !== dragOverFolderIdRef.current) {
        dragOverFolderIdRef.current = folderId;
        setDragOverFolderId(folderId);
      }
      logDragDebugRef.current(`releasePointCaptured releasePoint=${describePointSnapshot(point)} releasePointFolderId=${folderId ?? '(none)'} releasePointTargetDir=${targetDir ?? '(none)'} pointHit=${describePointHitRef.current(point.clientX, point.clientY)} ${getDragStateSnapshotRef.current()}`);
    };
    const updateGlobalDragHover = (event: Event) => {
      if (event.type !== 'drag' && event.type !== 'dragover' && event.type !== 'dragenter') return;
      if (!hasActiveDragForGlobalLog()) return;
      const point = getEventPointSnapshot(event);
      if (!point) return;
      lastDragPointRef.current = point;

      const screenPoints = point.screenX !== null && point.screenY !== null
        ? getWindowScreenClientPointCandidates(point.screenX, point.screenY, dragScreenClientOffsetRef.current)
        : [];
      const folderId = getFolderIdFromPointRef.current(point.clientX, point.clientY, draggedFileIdRef.current ?? undefined)
        ?? screenPoints
          .map(candidate => getFolderIdFromPointRef.current(candidate.clientX, candidate.clientY, draggedFileIdRef.current ?? undefined))
          .find(Boolean)
        ?? null;
      if (folderId === dragOverFolderIdRef.current) return;
      dragOverFolderIdRef.current = folderId;
      setDragOverFolderId(folderId);
      logDragDebugRef.current(`globalDragHover folderId=${folderId ?? '(none)'} source=${event.type} client=${point.clientX},${point.clientY} screenPoints=${screenPoints.map(describePointSnapshot).join('|') || '(none)'} ${getDragStateSnapshotRef.current()}`);
    };
    const logGlobalEvent = (scope: 'document' | 'window', event: Event) => {
      captureGlobalReleasePoint(event);
      updateGlobalDragHover(event);
      if (!hasActiveDragForGlobalLog() && !logWithoutActiveDragEventTypes.has(event.type)) return;
      const now = Date.now();
      const key = `${scope}:${event.type}`;
      const throttleMs = noisyEventTypes.has(event.type) ? 250 : 0;
      const lastLoggedAt = lastGlobalEventLogRef.current.get(key) ?? 0;
      if (throttleMs > 0 && now - lastLoggedAt < throttleMs) return;
      lastGlobalEventLogRef.current.set(key, now);
      logDragDebugRef.current(describeGlobalEventForLog(scope, event, getDragStateSnapshotRef.current()));
    };
    const documentHandler = (event: Event) => logGlobalEvent('document', event);
    const windowHandler = (event: Event) => logGlobalEvent('window', event);
    const dragEventTypes = ['dragstart', 'dragenter', 'drag', 'dragover', 'dragleave', 'drop', 'dragend'];
    const releaseEventTypes = ['mouseup', 'pointerup'];

    dragEventTypes.forEach(type => {
      document.addEventListener(type, documentHandler, true);
      window.addEventListener(type, windowHandler, true);
    });
    releaseEventTypes.forEach(type => {
      document.addEventListener(type, documentHandler, true);
      window.addEventListener(type, windowHandler, true);
    });
    window.addEventListener('blur', windowHandler, true);
    document.addEventListener('visibilitychange', documentHandler, true);

    return () => {
      dragEventTypes.forEach(type => {
        document.removeEventListener(type, documentHandler, true);
        window.removeEventListener(type, windowHandler, true);
      });
      releaseEventTypes.forEach(type => {
        document.removeEventListener(type, documentHandler, true);
        window.removeEventListener(type, windowHandler, true);
      });
      window.removeEventListener('blur', windowHandler, true);
      document.removeEventListener('visibilitychange', documentHandler, true);
    };
  }, [activeTransferRef]);

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
      if (nativeFileDragActiveRef.current) {
        logDragGateRef.current('mouseMoveIgnored', {
          types: [],
        } as unknown as DataTransfer, `reason=native-drag-active client=${event.clientX},${event.clientY}`);
        return;
      }
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

      const folderId = getFolderIdFromPointRef.current(event.clientX, event.clientY, dragState.id);
      if (folderId !== dragOverFolderIdRef.current) {
        logDragDebugRef.current(`mouseDragOver folderId=${folderId ?? ''}`);
        dragOverFolderIdRef.current = folderId;
        setDragOverFolderId(folderId);
      }
    };

    const handleInternalMouseUp = async (event: MouseEvent) => {
      if (nativeFileDragActiveRef.current) {
        logDragDebugRef.current(`mouseUp ignored reason=native-drag-active client=${event.clientX},${event.clientY} ${getDragStateSnapshotRef.current()}`);
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

      const folderId = getFolderIdFromPointRef.current(event.clientX, event.clientY, dragState.id);
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
    if (event.button !== 0) {
      logDragDebug(`mouseDown ignored reason=button button=${event.button} fileId=${file.id} path=${file.path} ${getDragStateSnapshot()}`);
      return;
    }
    const target = event.target as HTMLElement;
    if (target.closest('button, input, textarea, select, [data-no-drag]')) {
      logDragDebug(`mouseDown ignored reason=interactive-target fileId=${file.id} target=${target.tagName} ${getDragStateSnapshot()}`);
      return;
    }
    if (isRemotePath(file.path)) {
      logDragDebug(`mouseDown ignored reason=remote fileId=${file.id} path=${file.path} ${getDragStateSnapshot()}`);
      return;
    }

    internalDragRef.current = {
      id: file.id,
      startX: event.clientX,
      startY: event.clientY,
      active: false,
    };
    draggedFileIdRef.current = file.id;
    lastDragPointRef.current = null;
    lastReleasePointRef.current = null;
    dragScreenClientOffsetRef.current = null;
    setDragPreview({
      x: event.clientX,
      y: event.clientY,
      fileId: file.id,
      count: selectedFileIds.includes(file.id) ? Math.max(1, selectedFileIds.length) : 1,
      active: false,
    });
    logDragDebug(`mouseDown tracked fileId=${file.id} type=${file.type} path=${file.path} selectedIds=${selectedFileIdsRef.current.join('|') || '(none)'} ${getDragStateSnapshot()}`);
  };

  const handleExternalDrop = async (event: ReactDragEvent, targetPath?: string) => {
    const rawFiles = Array.from(event.dataTransfer.files || []);
    const paths = rawFiles
      .map(file => (file as File & { path?: string }).path)
      .filter((path): path is string => Boolean(path));
    logDragDebug(`externalDrop enter targetPath=${targetPath ?? '(current)'} rawFiles=${rawFiles.length} paths=${describePaths(paths)} ${describeDataTransfer(event.dataTransfer)} ${getDragStateSnapshot()}`);
    if (paths.length === 0) {
      logDragDebug(`externalDrop abort=no-paths ${describeDataTransfer(event.dataTransfer)} ${getDragStateSnapshot()}`);
      return;
    }
    event.preventDefault();
    markRecentExternalDrop(paths[0]);
    logDragDebug(`externalDrop import targetPath=${targetPath ?? '(current)'} paths=${describePaths(paths)} ${getDragStateSnapshot()}`);
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

  const collectPointFileItems = (clientX: number, clientY: number) => {
    const items: HTMLElement[] = [];
    const seen = new Set<HTMLElement>();
    const addItem = (item: HTMLElement | null | undefined) => {
      if (!item || seen.has(item)) return;
      seen.add(item);
      items.push(item);
    };
    const pointElements = getElementsFromPointSafe(clientX, clientY);
    pointElements.forEach(element => addItem((element as HTMLElement).closest<HTMLElement>('.file-item')));
    document.querySelectorAll<HTMLElement>('.file-item[data-id]').forEach(item => {
      const rect = item.getBoundingClientRect();
      if (
        rect.width > 0
        && rect.height > 0
        && clientX >= rect.left
        && clientX <= rect.right
        && clientY >= rect.top
        && clientY <= rect.bottom
      ) {
        addItem(item);
      }
    });
    return items;
  };

  const describePointHit = (clientX: number, clientY: number) => {
    const pointElements = getElementsFromPointSafe(clientX, clientY);
    const stack = pointElements.slice(0, 5).map(describeElementForLog).join(' > ') || '(none)';
    const items = collectPointFileItems(clientX, clientY).slice(0, 5).map(item => {
      const file = item.dataset.id ? findFileByIdRef.current(item.dataset.id) : undefined;
      const rect = item.getBoundingClientRect();
      return [
        compactLogValue(file?.name ?? item.dataset.id),
        file?.type ?? '(missing)',
        `rect=${Math.round(rect.left)},${Math.round(rect.top)},${Math.round(rect.width)}x${Math.round(rect.height)}`,
      ].join(':');
    }).join(';') || '(none)';
    return `stack=${stack} items=${items}`;
  };
  describePointHitRef.current = describePointHit;

  const getDropDirectoryFromPoint = (clientX: number, clientY: number) => {
    const pointElements = getElementsFromPointSafe(clientX, clientY);
    for (const element of pointElements) {
      const target = (element as HTMLElement).closest<HTMLElement>('[data-drop-target-dir]');
      const targetDir = target?.dataset.dropTargetDir;
      if (targetDir) return targetDir;
    }
    for (const target of Array.from(document.querySelectorAll<HTMLElement>('[data-drop-target-dir]'))) {
      const targetDir = target.dataset.dropTargetDir;
      const rect = target.getBoundingClientRect();
      if (
        targetDir
        && rect.width > 0
        && rect.height > 0
        && clientX >= rect.left
        && clientX <= rect.right
        && clientY >= rect.top
        && clientY <= rect.bottom
      ) {
        return targetDir;
      }
    }
    return null;
  };

  function getFolderIdFromPoint(clientX: number, clientY: number, draggedFileId?: string) {
    const item = collectPointFileItems(clientX, clientY).find(candidate => {
      const id = candidate.dataset.id;
      if (!id || id === draggedFileId) return false;
      const file = findFileByIdRef.current(id);
      return file?.type === 'folder';
    });
    const id = item?.dataset.id;
    if (!id || id === draggedFileId) {
      const nearby = getNearbyFolderIdFromPoint(clientX, clientY, draggedFileId);
      if (nearby) return nearby;
      return null;
    }

    const file = findFileByIdRef.current(id);
    return file?.type === 'folder' ? id : null;
  }
  getFolderIdFromPointRef.current = getFolderIdFromPoint;

  function getNearbyFolderIdFromPoint(clientX: number, clientY: number, draggedFileId?: string) {
    let best: { id: string; distance: number; rect: DOMRect } | null = null;
    document.querySelectorAll<HTMLElement>('.file-item[data-id]').forEach(item => {
      const id = item.dataset.id;
      if (!id || id === draggedFileId) return;
      const file = findFileByIdRef.current(id);
      if (file?.type !== 'folder') return;
      const rect = item.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;

      const margin = Math.min(36, Math.max(18, rect.height * 0.55));
      const insideExpanded = clientX >= rect.left - margin
        && clientX <= rect.right + margin
        && clientY >= rect.top - margin
        && clientY <= rect.bottom + margin;
      if (!insideExpanded) return;

      const dx = clientX < rect.left ? rect.left - clientX : clientX > rect.right ? clientX - rect.right : 0;
      const dy = clientY < rect.top ? rect.top - clientY : clientY > rect.bottom ? clientY - rect.bottom : 0;
      const distance = Math.hypot(dx, dy);
      if (!best || distance < best.distance) {
        best = { id, distance, rect };
      }
    });
    if (!best) return null;
    logDragDebugRef.current(`nearbyFolderHit folderId=${best.id} distance=${Math.round(best.distance)} rect=${Math.round(best.rect.left)},${Math.round(best.rect.top)},${Math.round(best.rect.width)}x${Math.round(best.rect.height)} client=${clientX},${clientY} ${getDragStateSnapshotRef.current()}`);
    return best.id;
  }

  const handleDragOver = (event: ReactDragEvent, fileId: string) => {
    if (!isFileTransferDrag(event.dataTransfer)) {
      logDragGate('dragOverIgnored', event.dataTransfer, `folderId=${fileId}`);
      return;
    }
    void focusCurrentWindow();

    event.preventDefault();
    event.stopPropagation();
    const types = getDragTypes(event.dataTransfer);
    event.dataTransfer.dropEffect = getDropEffect(event.dataTransfer);
    logDragGate('dragOverAccepted', event.dataTransfer, `folderId=${fileId} dropEffect=${event.dataTransfer.dropEffect}`);
    if (dragOverFolderId !== fileId) {
      logDragDebug(`dragOver folderId=${fileId} dataTypes=${types.join('|')}`);
      dragOverFolderIdRef.current = fileId;
      setDragOverFolderId(fileId);
    }
  };

  const handleSurfaceDragOver = (event: ReactDragEvent) => {
    if (!isFileTransferDrag(event.dataTransfer)) {
      logDragGate('surfaceDragOverIgnored', event.dataTransfer);
      return;
    }
    void focusCurrentWindow();

    const folderId = getFolderIdFromDragEvent(event);
    if (folderId) {
      logDragGate('surfaceDragOverForwardFolder', event.dataTransfer, `folderId=${folderId}`);
      handleDragOver(event, folderId);
      return;
    }

    if (dragOverFolderId !== null) {
      dragOverFolderIdRef.current = null;
      setDragOverFolderId(null);
    }
    event.preventDefault();
    event.dataTransfer.dropEffect = getDropEffect(event.dataTransfer);
    logDragGate('surfaceDragOverAccepted', event.dataTransfer, `dropEffect=${event.dataTransfer.dropEffect}`);
  };

  const handleSurfaceDrop = async (event: ReactDragEvent) => {
    logDragDebug(`surfaceDrop enter ${describeDataTransfer(event.dataTransfer)} ${getDragStateSnapshot()}`);
    if (!isFileTransferDrag(event.dataTransfer)) {
      logDragDebug(`surfaceDrop ignored reason=not-file-transfer ${describeDataTransfer(event.dataTransfer)} ${getDragStateSnapshot()}`);
      return;
    }
    void focusCurrentWindow();

    const folderId = getFolderIdFromDragEvent(event);
    if (folderId) {
      logDragDebug(`surfaceDrop forwardFolder folderId=${folderId} ${describeDataTransfer(event.dataTransfer)} ${getDragStateSnapshot()}`);
      await handleDrop(event, folderId);
      return;
    }

    if (isExternalFileDrop(event.dataTransfer)) {
      logDragDebug(`surfaceDrop branch=external ${describeDataTransfer(event.dataTransfer)} ${getDragStateSnapshot()}`);
      await handleExternalDrop(event);
      return;
    }

    const payload = await readTransferPayload(event.dataTransfer);
    if (payload?.paths.length) {
      const localDragWasActive = hasLocalInternalDrag();
      try {
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
          logDragDebug(`surfaceDrop abort=remote targetDir=${targetDir} payloadPaths=${describePaths(payload.paths)} ${getDragStateSnapshot()}`);
          showFeedback(t('messages.remoteReadOnly', { defaultValue: '远程访问第一版仅支持浏览。' }));
          return;
        }
        if (payload.cut && localDragWasActive) {
          logDragDebug(`surfaceDrop action=moveToDirectory targetDir=${targetDir} payloadPaths=${describePaths(payload.paths)} localDrag=yes ${getDragStateSnapshot()}`);
          await movePayloadPathsToDirectory(payload.paths, targetDir);
        } else {
          logDragDebug(`surfaceDrop action=copyToDirectory targetDir=${targetDir} payloadCut=${payload.cut ? 'yes' : 'no'} localDrag=${localDragWasActive ? 'yes' : 'no'} payloadPaths=${describePaths(payload.paths)} ${getDragStateSnapshot()}`);
          await copyPayloadPathsToDirectory(payload.paths, targetDir);
        }
        return;
      } finally {
        finishSharedFileDrag();
      }
    }

    logDragDebug(`surfaceDrop fallbackExternalAfterNoPayload ${describeDataTransfer(event.dataTransfer)} ${getDragStateSnapshot()}`);
    await handleExternalDrop(event);
  };

  const handleDragStart = (event: ReactDragEvent, file: FileItem) => {
    if (isRemotePath(file.path)) {
      event.preventDefault();
      logDragDebug(`dragStart abort=remote fileId=${file.id} path=${file.path} ${getDragStateSnapshot()}`);
      showFeedback(t('messages.remoteReadOnly', { defaultValue: '远程访问第一版仅支持浏览。' }));
      return;
    }
    nativeFileDragActiveRef.current = true;
    internalDragRef.current = null;
    draggedFileIdRef.current = file.id;
    localFileDropHandledRef.current = false;
    lastDragPointRef.current = null;
    lastReleasePointRef.current = null;
    dragScreenClientOffsetRef.current = {
      at: Date.now(),
      offsetX: event.screenX - event.clientX,
      offsetY: event.screenY - event.clientY,
      source: 'dragStart',
    };
    const paths = writeDragPayload(file);
    if (paths.length === 0) {
      event.preventDefault();
      logDragDebug(`dragStart abort=no-paths fileId=${file.id} ${describeDataTransfer(event.dataTransfer)} ${getDragStateSnapshot()}`);
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
    logDragDebug(`dragStart id=${file.id} name=${file.name} type=${file.type} effectAllowed=${event.dataTransfer.effectAllowed} screenClientOffset=${dragScreenClientOffsetRef.current.offsetX},${dragScreenClientOffsetRef.current.offsetY} ${describeDataTransfer(event.dataTransfer)} paths=${describePaths(paths)} ${getDragStateSnapshot()}`);
  };

  const handleDragLeave = (event: ReactDragEvent, fileId: string) => {
    const related = event.relatedTarget as Node | null;
    if (related && event.currentTarget.contains(related)) return;
    logDragDebug(`dragLeave folderId=${fileId}`);
    if (dragOverFolderId === fileId) {
      dragOverFolderIdRef.current = null;
      setDragOverFolderId(null);
    }
  };

  const finishDragEnd = (event: DragEndSnapshot) => {
    const activeDraggedId = draggedFileIdRef.current;
    const now = Date.now();
    const hasUsableDragEndPoint = !(event.clientX === 0 && event.clientY === 0);
    const releasePoint = lastReleasePointRef.current && now - lastReleasePointRef.current.at <= 1200
      ? lastReleasePointRef.current
      : null;
    const hoverPoint = lastDragPointRef.current && now - lastDragPointRef.current.at <= 1200
      ? lastDragPointRef.current
      : null;
    const pointTarget = hasUsableDragEndPoint ? getElementFromPointSafe(event.clientX, event.clientY) : null;
    const releasePointTarget = releasePoint ? getElementFromPointSafe(releasePoint.clientX, releasePoint.clientY) : null;
    const hoverPointTarget = hoverPoint ? getElementFromPointSafe(hoverPoint.clientX, hoverPoint.clientY) : null;
    const screenPoints = getWindowScreenClientPointCandidates(event.screenX, event.screenY, dragScreenClientOffsetRef.current);
    const screenPointTargets = screenPoints.map(point => getElementFromPointSafe(point.clientX, point.clientY)).filter(Boolean);
    const endedInsideApp = Boolean(pointTarget || releasePointTarget || hoverPointTarget);
    const pointFolderId = hasUsableDragEndPoint ? getFolderIdFromPoint(event.clientX, event.clientY, activeDraggedId || undefined) : null;
    const releasePointFolderId = releasePoint ? getFolderIdFromPoint(releasePoint.clientX, releasePoint.clientY, activeDraggedId || undefined) : null;
    const hoverPointFolderId = hoverPoint ? getFolderIdFromPoint(hoverPoint.clientX, hoverPoint.clientY, activeDraggedId || undefined) : null;
    const screenPointFolderId = screenPoints
      .map(point => getFolderIdFromPoint(point.clientX, point.clientY, activeDraggedId || undefined))
      .find(Boolean) ?? null;
    const highlightedFolderId = dragOverFolderIdRef.current;
    const highlightedFolder = highlightedFolderId ? findFileByIdRef.current(highlightedFolderId) : undefined;
    const resolvedFolderId = pointFolderId
      ?? releasePointFolderId
      ?? screenPointFolderId
      ?? hoverPointFolderId
      ?? (highlightedFolder?.type === 'folder' ? highlightedFolder.id : null);
    const pointTargetDir = hasUsableDragEndPoint ? getDropDirectoryFromPoint(event.clientX, event.clientY) : null;
    const releasePointTargetDir = releasePoint ? getDropDirectoryFromPoint(releasePoint.clientX, releasePoint.clientY) : null;
    const hoverPointTargetDir = hoverPoint ? getDropDirectoryFromPoint(hoverPoint.clientX, hoverPoint.clientY) : null;
    const screenPointTargetDir = screenPoints
      .map(point => getDropDirectoryFromPoint(point.clientX, point.clientY))
      .find(Boolean) ?? null;
    const resolvedTargetDir = pointTargetDir ?? releasePointTargetDir ?? screenPointTargetDir ?? hoverPointTargetDir;
    const active = activeTransferRef.current;
    const localDropHandled = localFileDropHandledRef.current;
    const hitPoint = releasePoint ?? screenPoints[0] ?? hoverPoint;
    const hitClientX = hitPoint?.clientX ?? event.clientX;
    const hitClientY = hitPoint?.clientY ?? event.clientY;
    logDragDebug(`dragEnd resolved activeId=${activeDraggedId ?? '(none)'} endedInside=${endedInsideApp || screenPointTargets.length > 0 ? 'yes' : 'no'} pointFolderId=${pointFolderId ?? '(none)'} releasePointFolderId=${releasePointFolderId ?? '(none)'} screenPointFolderId=${screenPointFolderId ?? '(none)'} hoverPointFolderId=${hoverPointFolderId ?? '(none)'} highlightedFolderId=${highlightedFolderId ?? '(none)'} resolvedFolderId=${resolvedFolderId ?? '(none)'} pointTargetDir=${pointTargetDir ?? '(none)'} releasePointTargetDir=${releasePointTargetDir ?? '(none)'} screenPointTargetDir=${screenPointTargetDir ?? '(none)'} hoverPointTargetDir=${hoverPointTargetDir ?? '(none)'} resolvedTargetDir=${resolvedTargetDir ?? '(none)'} releasePoint=${describePointSnapshot(releasePoint)} screenPoints=${screenPoints.map(describePointSnapshot).join('|') || '(none)'} hoverPoint=${describePointSnapshot(hoverPoint)} localDropHandled=${localDropHandled ? 'yes' : 'no'} activeTransfer=${active?.transferId ?? '(none)'} pointHit=${hasUsableDragEndPoint ? describePointHit(event.clientX, event.clientY) : '(none)'} releaseHit=${releasePoint ? describePointHit(releasePoint.clientX, releasePoint.clientY) : '(none)'} screenHits=${screenPoints.map(point => describePointHit(point.clientX, point.clientY)).join('|') || '(none)'} hoverHit=${hoverPoint ? describePointHit(hoverPoint.clientX, hoverPoint.clientY) : '(none)'} ${getDragStateSnapshot()}`);

    if (active && !localDropHandled && resolvedFolderId) {
      localFileDropHandledRef.current = true;
      draggedFileIdRef.current = null;
      setDragPreview(null);
      if (dragOverFolderIdRef.current !== null) {
        dragOverFolderIdRef.current = null;
        setDragOverFolderId(null);
      }
      clearExternalDragFallback();
      logDragDebug(`dragEnd action=fallbackMoveDragged activeId=${activeDraggedId ?? '(none)'} pointFolderId=${pointFolderId ?? '(none)'} releasePointFolderId=${releasePointFolderId ?? '(none)'} screenPointFolderId=${screenPointFolderId ?? '(none)'} hoverPointFolderId=${hoverPointFolderId ?? '(none)'} highlightedFolderId=${highlightedFolderId ?? '(none)'} resolvedFolderId=${resolvedFolderId} transferId=${active.transferId} ${getDragStateSnapshot()}`);
      void moveDraggedFilesRef.current(activeDraggedId || '', resolvedFolderId).finally(() => {
        finishSharedFileDrag(400);
      });
      return;
    }

    if (active && !localDropHandled && (endedInsideApp || screenPointTargets.length > 0) && !resolvedFolderId) {
      const targetDir = getActionDirectory(resolvedTargetDir ?? undefined);
      if (targetDir && hasPathOutsideDirectory(active.paths, targetDir)) {
        if (active.paths.some(isRemotePath) || isRemotePath(targetDir)) {
          logDragDebug(`dragEnd abort=fallbackMoveToDirectory reason=remote targetDir=${targetDir} paths=${describePaths(active.paths)} ${getDragStateSnapshot()}`);
          showFeedback(t('messages.remoteReadOnly', { defaultValue: '远程访问第一版仅支持浏览。' }));
          finishSharedFileDrag(400);
          return;
        }
        localFileDropHandledRef.current = true;
        draggedFileIdRef.current = null;
        setDragPreview(null);
        if (dragOverFolderIdRef.current !== null) {
          dragOverFolderIdRef.current = null;
          setDragOverFolderId(null);
        }
        clearExternalDragFallback();
        logDragDebug(`dragEnd action=fallbackMoveToDirectory targetDir=${targetDir} transferId=${active.transferId} paths=${describePaths(active.paths)} ${getDragStateSnapshot()}`);
        void movePayloadPathsToDirectory(active.paths, targetDir).finally(() => {
          finishSharedFileDrag(400);
        });
        return;
      }
      if (targetDir) {
        const hitItem = collectPointFileItems(hitClientX, hitClientY)[0];
        const hitFile = hitItem?.dataset.id ? findFileByIdRef.current(hitItem.dataset.id) : undefined;
        const hitIsDraggedSource = Boolean(hitFile && active.paths.includes(hitFile.path));
        if (hitFile && hitFile.type !== 'folder' && !hitIsDraggedSource) {
          localFileDropHandledRef.current = true;
          draggedFileIdRef.current = null;
          setDragPreview(null);
          if (dragOverFolderIdRef.current !== null) {
            dragOverFolderIdRef.current = null;
            setDragOverFolderId(null);
          }
          clearExternalDragFallback();
          logDragDebug(`dragEnd action=localSameDirectoryNonFolderHit targetDir=${targetDir} hitId=${hitFile.id} hitType=${hitFile.type} paths=${describePaths(active.paths)} ${getDragStateSnapshot()}`);
          showFeedback(t('messages.dropTargetNotFolder', { defaultValue: '目标不是文件夹' }));
          finishSharedFileDrag(400);
          return;
        }
        localFileDropHandledRef.current = true;
        draggedFileIdRef.current = null;
        setDragPreview(null);
        if (dragOverFolderIdRef.current !== null) {
          dragOverFolderIdRef.current = null;
          setDragOverFolderId(null);
        }
        clearExternalDragFallback();
        logDragDebug(`dragEnd action=localSameDirectoryIgnored targetDir=${targetDir} paths=${describePaths(active.paths)} ${getDragStateSnapshot()}`);
        showFeedback(t('messages.dropOnFolderRequired', { defaultValue: '请拖到文件夹上' }));
        finishSharedFileDrag(400);
        return;
      }
      logDragDebug(`dragEnd skip=fallbackMoveToDirectory reason=no-target-dir targetDir=(none) paths=${describePaths(active.paths)} ${getDragStateSnapshot()}`);
    }

    if (active && !localDropHandled) {
      logDragDebug(`dragEnd emitEndAt transferId=${active.transferId} screen=${event.screenX},${event.screenY} ${getDragStateSnapshot()}`);
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
    if (dragOverFolderIdRef.current !== null) {
      dragOverFolderIdRef.current = null;
      setDragOverFolderId(null);
    }
    clearExternalDragFallback();
    if (localDropHandled) {
      finishSharedFileDrag(400);
    } else if (active && !dragOverFolderId && !endedInsideApp && screenPointTargets.length === 0) {
      externalDragFallbackTimerRef.current = window.setTimeout(() => {
        externalDragFallbackTimerRef.current = null;
        if (!activeTransferRef.current || activeTransferRef.current.transferId !== active.transferId) return;
        logDragDebug(`dragEnd externalFallbackUnsupported transferId=${active.transferId} paths=${describePaths(active.paths)} ${getDragStateSnapshot()}`);
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

  const handleDragEnd = (event: ReactDragEvent) => {
    nativeFileDragActiveRef.current = false;
    const snapshot: DragEndSnapshot = {
      altKey: event.altKey,
      clientX: event.clientX,
      clientY: event.clientY,
      metaKey: event.metaKey,
      screenX: event.screenX,
      screenY: event.screenY,
      shiftKey: event.shiftKey,
    };
    logDragDebug(`dragEnd enter activeId=${draggedFileIdRef.current ?? ''} client=${snapshot.clientX},${snapshot.clientY} screen=${snapshot.screenX},${snapshot.screenY} meta=${snapshot.metaKey} alt=${snapshot.altKey} shift=${snapshot.shiftKey} ${getDragStateSnapshot()}`);

    stopCursorRaiseTracking();
    window.setTimeout(() => {
      finishDragEnd(snapshot);
    }, 80);
  };

  const handleDrop = async (event: ReactDragEvent, targetFolderId: string) => {
    logDragDebug(`drop enter targetFolderId=${targetFolderId} ${describeDataTransfer(event.dataTransfer)} ${getDragStateSnapshot()}`);
    if (!isFileTransferDrag(event.dataTransfer)) {
      logDragDebug(`drop ignored reason=not-file-transfer targetFolderId=${targetFolderId} ${describeDataTransfer(event.dataTransfer)} ${getDragStateSnapshot()}`);
      return;
    }
    void focusCurrentWindow();

    event.preventDefault();
    event.stopPropagation();
    if (localFileDropHandledRef.current) {
      logDragDebug(`drop ignored reason=already-handled targetFolderId=${targetFolderId} ${getDragStateSnapshot()}`);
      finishSharedFileDrag();
      return;
    }
    localFileDropHandledRef.current = true;
    dragOverFolderIdRef.current = null;
    setDragOverFolderId(null);

    const fallbackDraggedId = draggedFileIdRef.current;
    const localDragWasActive = hasLocalInternalDrag();
    draggedFileIdRef.current = null;
    try {
      const targetFolder = findFileById(targetFolderId);
      if (!targetFolder || targetFolder.type !== 'folder') {
        logDragDebug(`drop abort=target-not-folder targetFolderId=${targetFolderId} targetType=${targetFolder?.type ?? '(missing)'} ${getDragStateSnapshot()}`);
        return;
      }
      if (isRemotePath(targetFolder.path)) {
        logDragDebug(`drop abort=remote-target targetFolderId=${targetFolderId} targetPath=${targetFolder.path} ${getDragStateSnapshot()}`);
        showFeedback(t('messages.remoteReadOnly', { defaultValue: '远程访问第一版仅支持浏览。' }));
        return;
      }
      if (isExternalFileDrop(event.dataTransfer)) {
        logDragDebug(`dropExternal targetFolderId=${targetFolderId} ref=${fallbackDraggedId ?? ''} dataTypes=${getDragTypes(event.dataTransfer).join('|')}`);
        await handleExternalDrop(event, targetFolder.path);
        return;
      }
      const payload = await readTransferPayload(event.dataTransfer);
      logDragDebug(`drop targetFolderId=${targetFolderId} payloadPaths=${payload?.paths.join('|') ?? ''} ref=${fallbackDraggedId ?? ''} dataTypes=${getDragTypes(event.dataTransfer).join('|')}`);
      if (payload?.paths.length) {
        if (payload.paths.some(isRemotePath)) {
          logDragDebug(`drop abort=remote-payload targetFolderId=${targetFolderId} payloadPaths=${describePaths(payload.paths)} ${getDragStateSnapshot()}`);
          showFeedback(t('messages.remoteReadOnly', { defaultValue: '远程访问第一版仅支持浏览。' }));
          return;
        }
        if (payload.cut && localDragWasActive) {
          logDragDebug(`drop action=moveToFolder targetFolderId=${targetFolderId} targetPath=${targetFolder.path} payloadPaths=${describePaths(payload.paths)} localDrag=yes ${getDragStateSnapshot()}`);
          await movePayloadPathsToFolder(payload.paths, targetFolder);
        } else {
          logDragDebug(`drop action=copyToFolder targetFolderId=${targetFolderId} targetPath=${targetFolder.path} payloadCut=${payload.cut ? 'yes' : 'no'} localDrag=${localDragWasActive ? 'yes' : 'no'} payloadPaths=${describePaths(payload.paths)} ${getDragStateSnapshot()}`);
          await copyPayloadPathsToFolder(payload.paths, targetFolder);
        }
        return;
      }
      if (getDragTypes(event.dataTransfer).includes('Files')) {
        logDragDebug(`drop branch=external-files-after-no-payload targetFolderId=${targetFolderId} targetPath=${targetFolder.path} ${describeDataTransfer(event.dataTransfer)} ${getDragStateSnapshot()}`);
        await handleExternalDrop(event, targetFolder.path);
        return;
      }
      logDragDebug(`drop action=moveDraggedFallback fallbackDraggedId=${fallbackDraggedId ?? '(none)'} targetFolderId=${targetFolderId} ${getDragStateSnapshot()}`);
      await moveDraggedFilesRef.current(fallbackDraggedId || '', targetFolderId);
    } finally {
      logDragDebug(`drop finally targetFolderId=${targetFolderId} ${getDragStateSnapshot()}`);
      finishSharedFileDrag();
    }
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
