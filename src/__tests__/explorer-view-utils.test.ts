import { readFileSync } from 'node:fs';
import path from 'node:path';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildMoveRefreshPaths,
  buildMoveTaskDedupeKey,
  buildTimestampTextFileName,
  getPdfPreviewSrc,
  getRelativeTimeLabel,
  parseModifiedTimestamp,
  parseSizeToBytes,
} from '../components/explorer/explorer-utils';
import {
  isExternalFileDrop,
  shouldReadStoredDragPayload,
} from '../components/explorer/useExplorerDragDrop';
import useExplorerDragDrop from '../components/explorer/useExplorerDragDrop';
import useExplorerTransferWorkflow from '../components/explorer/useExplorerTransferWorkflow';
import { INTERNAL_FILE_DRAG_MIME } from '../components/explorer/explorer-constants';
import type { MoveConflictDialogState } from '../components/explorer/explorer-types';
import type { TransferTaskSnapshot } from '../api/filesystem';
import type { FileItem } from '../types';

const clearFileDragPayloadMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const getFileDragPayloadMock = vi.hoisted(() => vi.fn());
const listTransferTasksMock = vi.hoisted(() => vi.fn());
const previewCopyFileConflictsMock = vi.hoisted(() => vi.fn().mockResolvedValue([]));
const setFileDragPayloadMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const startCopyFilesTaskMock = vi.hoisted(() => vi.fn().mockResolvedValue('copy-task-1'));
const startMoveFilesTaskMock = vi.hoisted(() => vi.fn().mockResolvedValue('move-task-1'));

vi.mock('@tauri-apps/api/core', () => ({
  convertFileSrc: (path: string) => `asset://${path}`,
}));

vi.mock('../api/filesystem', () => ({
  clearFileDragPayload: clearFileDragPayloadMock,
  getFileDragPayload: getFileDragPayloadMock,
  listTransferTasks: listTransferTasksMock,
  previewCopyFileConflicts: previewCopyFileConflictsMock,
  previewMoveFileConflicts: vi.fn().mockResolvedValue([]),
  setFileDragPayload: setFileDragPayloadMock,
  startCopyFilesTask: startCopyFilesTaskMock,
  startMoveFilesTask: startMoveFilesTaskMock,
}));

describe('parseModifiedTimestamp', () => {
  it('parses filesystem timestamps and falls back to zero', () => {
    expect(parseModifiedTimestamp('2026-05-31 18:20')).toBe(new Date('2026-05-31T18:20').getTime());
    expect(parseModifiedTimestamp('')).toBe(0);
    expect(parseModifiedTimestamp('not a date')).toBe(0);
  });
});

describe('parseSizeToBytes', () => {
  it('normalizes common size units to bytes', () => {
    expect(parseSizeToBytes('1 KB')).toBe(1024);
    expect(parseSizeToBytes('1.5 MB')).toBe(1.5 * 1024 * 1024);
    expect(parseSizeToBytes('2 G')).toBe(2 * 1024 * 1024 * 1024);
    expect(parseSizeToBytes('3 TB')).toBe(3 * 1024 * 1024 * 1024 * 1024);
    expect(parseSizeToBytes('42')).toBe(42);
  });

  it('falls back to zero for missing or invalid sizes', () => {
    expect(parseSizeToBytes('--')).toBe(0);
    expect(parseSizeToBytes('')).toBe(0);
    expect(parseSizeToBytes('unknown')).toBe(0);
  });
});

describe('getRelativeTimeLabel', () => {
  it('returns relative labels for recent timestamps', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-01T12:00:00'));

    expect(getRelativeTimeLabel('2026-06-01 11:59')).toBe('1 分钟前');
    expect(getRelativeTimeLabel('2026-06-01 11:40')).toBe('半小时内');
    expect(getRelativeTimeLabel('2026-06-01 11:15')).toBe('1 小时内');
    expect(getRelativeTimeLabel('2026-06-01 08:00')).toBe('今天');
    expect(getRelativeTimeLabel('2026-05-31 08:00')).toBe('昨天');
    expect(getRelativeTimeLabel('2026-05-28 08:00')).toBe('4 天前');

    vi.useRealTimers();
  });

  it('hides invalid, unknown, and older timestamps', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-01T12:00:00'));

    expect(getRelativeTimeLabel('未知')).toBe('');
    expect(getRelativeTimeLabel('not a date')).toBe('');
    expect(getRelativeTimeLabel('2026-05-20 08:00')).toBe('');

    vi.useRealTimers();
  });
});

describe('getPdfPreviewSrc', () => {
  it('adds pdf viewer parameters to the cached asset url', () => {
    expect(getPdfPreviewSrc('/tmp/file.pdf')).toBe('asset:///tmp/file.pdf#page=1&view=FitH&toolbar=0&navpanes=0&scrollbar=0');
  });
});

describe('buildMoveTaskDedupeKey', () => {
  it('sorts source paths while normalizing trailing slashes after dedupe', () => {
    expect(buildMoveTaskDedupeKey(['/b/', '/a', '/a/'], '/target/', 'replace')).toBe('replace::/target::/a\u001f/a\u001f/b');
  });

  it('keeps root paths normalized', () => {
    expect(buildMoveTaskDedupeKey(['/', ''], '', 'skip')).toBe('skip::/::/');
  });
});

describe('buildTimestampTextFileName', () => {
  it('formats clipboard txt names as yyyyMMddHHmmss.txt', () => {
    expect(buildTimestampTextFileName(new Date('2026-06-09T12:34:56'))).toBe('20260609123456.txt');
  });
});

describe('buildMoveRefreshPaths', () => {
  it('refreshes source parent directories and target directory after moves', () => {
    expect(buildMoveRefreshPaths([
      '/source/a.txt',
      '/source/nested/b.txt',
      '/source/a.txt',
    ], '/target')).toEqual(['/target', '/source', '/source/nested']);
  });
});

describe('explorer drag wiring source checks', () => {
  const dataTransferWithTypes = (types: string[]): Pick<DataTransfer, 'types'> => ({ types } as Pick<DataTransfer, 'types'>);
  const sourceFile: FileItem = {
    id: 'source-id',
    modified: '2026-06-09',
    name: 'source.txt',
    path: '/source/source.txt',
    size: '1 KB',
    type: 'text',
  };
  const targetFolder: FileItem = {
    id: 'folder-id',
    modified: '2026-06-09',
    name: 'Target',
    path: '/target',
    size: '--',
    type: 'folder',
  };
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;
  const waitForDeferredDragEnd = () => new Promise(resolve => window.setTimeout(resolve, 120));

  beforeEach(() => {
    clearFileDragPayloadMock.mockClear();
    getFileDragPayloadMock.mockReset();
    listTransferTasksMock.mockReset();
    previewCopyFileConflictsMock.mockClear();
    setFileDragPayloadMock.mockClear();
    startCopyFilesTaskMock.mockClear();
    startMoveFilesTaskMock.mockClear();
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    if (root) {
      act(() => {
        root?.unmount();
      });
      root = null;
    }
    container?.remove();
    container = null;
  });

  it('treats plain Finder file drops as external and ignores stored internal drag payloads', () => {
    const finderDrop = dataTransferWithTypes(['Files']);

    expect(isExternalFileDrop(finderDrop)).toBe(true);
    expect(shouldReadStoredDragPayload(finderDrop)).toBe(false);
  });

  it('keeps explicit Aether drag payloads authoritative even if Files is also present', () => {
    const aetherDrop = dataTransferWithTypes(['Files', INTERNAL_FILE_DRAG_MIME]);

    expect(isExternalFileDrop(aetherDrop)).toBe(false);
    expect(shouldReadStoredDragPayload(aetherDrop)).toBe(true);
  });

  it('imports plain external file drops without reading stored internal drag payloads', async () => {
    const importExternalPaths = vi.fn().mockResolvedValue(true);
    const copyPayloadPathsToDirectory = vi.fn().mockResolvedValue(undefined);
    let handlers: ReturnType<typeof useExplorerDragDrop> | null = null;

    function Harness() {
      const activeTransferRef = React.useRef<{ transferId: string; paths: string[] } | null>(null);
      handlers = useExplorerDragDrop({
        activeTransferRef,
        findFileById: () => undefined,
        focusCurrentWindow: vi.fn(),
        getActionDirectory: () => '/target',
        importExternalPaths,
        isRemotePath: () => false,
        logDragDebug: vi.fn(),
        moveDraggedFiles: vi.fn(),
        movePayloadPathsToDirectory: vi.fn(),
        movePayloadPathsToFolder: vi.fn(),
        copyPayloadPathsToDirectory,
        copyPayloadPathsToFolder: vi.fn(),
        selectedFileIds: [],
        selectedFiles: [],
        showFeedback: vi.fn(),
        t: ((key: string, options?: Record<string, unknown>) => String(options?.defaultValue ?? key)) as never,
      });
      return null;
    }

    root = createRoot(container as HTMLDivElement);
    await act(async () => {
      root?.render(React.createElement(Harness));
    });

    const event = {
      dataTransfer: {
        files: [{ path: '/source/external.txt' }],
        types: ['Files'],
      },
      preventDefault: vi.fn(),
      target: document.createElement('div'),
    } as unknown as React.DragEvent;

    await act(async () => {
      await handlers?.handleSurfaceDrop(event);
    });

    expect(importExternalPaths).toHaveBeenCalledWith(['/source/external.txt'], undefined);
    expect(copyPayloadPathsToDirectory).not.toHaveBeenCalled();
    expect(getFileDragPayloadMock).not.toHaveBeenCalled();
  });

  it('starts same-window internal drags as move payloads', async () => {
    const dataTransfer = {
      effectAllowed: 'none',
      setData: vi.fn(),
      types: [],
    };
    let handlers: ReturnType<typeof useExplorerDragDrop> | null = null;

    function Harness() {
      const activeTransferRef = React.useRef<{ transferId: string; paths: string[] } | null>(null);
      handlers = useExplorerDragDrop({
        activeTransferRef,
        findFileById: id => (id === sourceFile.id ? sourceFile : undefined),
        focusCurrentWindow: vi.fn(),
        getActionDirectory: () => '/target',
        importExternalPaths: vi.fn(),
        isRemotePath: () => false,
        logDragDebug: vi.fn(),
        moveDraggedFiles: vi.fn(),
        movePayloadPathsToDirectory: vi.fn(),
        movePayloadPathsToFolder: vi.fn(),
        copyPayloadPathsToDirectory: vi.fn(),
        copyPayloadPathsToFolder: vi.fn(),
        selectedFileIds: [sourceFile.id],
        selectedFiles: [sourceFile],
        showFeedback: vi.fn(),
        t: ((key: string, options?: Record<string, unknown>) => String(options?.defaultValue ?? key)) as never,
      });
      return null;
    }

    root = createRoot(container as HTMLDivElement);
    await act(async () => {
      root?.render(React.createElement(Harness));
    });

    await act(async () => {
      handlers?.handleDragStart({
        clientX: 10,
        clientY: 20,
        dataTransfer,
        preventDefault: vi.fn(),
      } as unknown as React.DragEvent, sourceFile);
    });

    expect(setFileDragPayloadMock).toHaveBeenCalledWith(['/source/source.txt'], true, expect.objectContaining({
      count: 1,
      previewName: sourceFile.name,
    }));
    expect(JSON.parse(dataTransfer.setData.mock.calls[0][1])).toEqual({
      paths: ['/source/source.txt'],
      cut: true,
    });
    expect(dataTransfer.effectAllowed).toBe('move');
  });

  it('shows same-window internal folder drop targets as move drops', async () => {
    let handlers: ReturnType<typeof useExplorerDragDrop> | null = null;

    function Harness() {
      const activeTransferRef = React.useRef<{ transferId: string; paths: string[] } | null>(null);
      handlers = useExplorerDragDrop({
        activeTransferRef,
        findFileById: id => {
          if (id === targetFolder.id) return targetFolder;
          if (id === sourceFile.id) return sourceFile;
          return undefined;
        },
        focusCurrentWindow: vi.fn(),
        getActionDirectory: () => '/target',
        importExternalPaths: vi.fn(),
        isRemotePath: () => false,
        logDragDebug: vi.fn(),
        moveDraggedFiles: vi.fn(),
        movePayloadPathsToDirectory: vi.fn(),
        movePayloadPathsToFolder: vi.fn(),
        copyPayloadPathsToDirectory: vi.fn(),
        copyPayloadPathsToFolder: vi.fn(),
        selectedFileIds: [sourceFile.id],
        selectedFiles: [sourceFile],
        showFeedback: vi.fn(),
        t: ((key: string, options?: Record<string, unknown>) => String(options?.defaultValue ?? key)) as never,
      });
      return null;
    }

    root = createRoot(container as HTMLDivElement);
    await act(async () => {
      root?.render(React.createElement(Harness));
    });

    const event = {
      dataTransfer: {
        dropEffect: 'none',
        types: [INTERNAL_FILE_DRAG_MIME],
      },
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    } as unknown as React.DragEvent;

    await act(async () => {
      handlers?.handleDragStart({
        clientX: 10,
        clientY: 20,
        dataTransfer: {
          effectAllowed: 'none',
          setData: vi.fn(),
          types: [],
        },
        preventDefault: vi.fn(),
      } as unknown as React.DragEvent, sourceFile);
      handlers?.handleDragOver(event, targetFolder.id);
    });

    expect(event.dataTransfer.dropEffect).toBe('move');
  });

  it('accepts local native drags even when the webview hides custom data transfer types', async () => {
    let handlers: ReturnType<typeof useExplorerDragDrop> | null = null;

    function Harness() {
      const activeTransferRef = React.useRef<{ transferId: string; paths: string[] } | null>(null);
      handlers = useExplorerDragDrop({
        activeTransferRef,
        findFileById: id => {
          if (id === targetFolder.id) return targetFolder;
          if (id === sourceFile.id) return sourceFile;
          return undefined;
        },
        focusCurrentWindow: vi.fn(),
        getActionDirectory: () => '/target',
        importExternalPaths: vi.fn(),
        isRemotePath: () => false,
        logDragDebug: vi.fn(),
        moveDraggedFiles: vi.fn(),
        movePayloadPathsToDirectory: vi.fn(),
        movePayloadPathsToFolder: vi.fn(),
        copyPayloadPathsToDirectory: vi.fn(),
        copyPayloadPathsToFolder: vi.fn(),
        selectedFileIds: [sourceFile.id],
        selectedFiles: [sourceFile],
        showFeedback: vi.fn(),
        t: ((key: string, options?: Record<string, unknown>) => String(options?.defaultValue ?? key)) as never,
      });
      return null;
    }

    root = createRoot(container as HTMLDivElement);
    await act(async () => {
      root?.render(React.createElement(Harness));
    });

    const dragStartTransfer = {
      effectAllowed: 'none',
      setData: vi.fn(),
      types: [],
    };
    const dragOverEvent = {
      dataTransfer: {
        dropEffect: 'none',
        types: [],
      },
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    } as unknown as React.DragEvent;

    await act(async () => {
      handlers?.handleDragStart({
        clientX: 10,
        clientY: 20,
        dataTransfer: dragStartTransfer,
        preventDefault: vi.fn(),
      } as unknown as React.DragEvent, sourceFile);
      handlers?.handleDragOver(dragOverEvent, targetFolder.id);
    });

    expect(dragOverEvent.preventDefault).toHaveBeenCalled();
    expect(dragOverEvent.dataTransfer.dropEffect).toBe('move');
  });

  it('moves local surface drops from active transfer state when payload data is unavailable', async () => {
    const movePayloadPathsToDirectory = vi.fn().mockResolvedValue(undefined);
    const copyPayloadPathsToDirectory = vi.fn().mockResolvedValue(undefined);
    let handlers: ReturnType<typeof useExplorerDragDrop> | null = null;

    function Harness() {
      const activeTransferRef = React.useRef<{ transferId: string; paths: string[] } | null>(null);
      handlers = useExplorerDragDrop({
        activeTransferRef,
        findFileById: id => (id === sourceFile.id ? sourceFile : undefined),
        focusCurrentWindow: vi.fn(),
        getActionDirectory: () => '/target',
        importExternalPaths: vi.fn(),
        isRemotePath: () => false,
        logDragDebug: vi.fn(),
        moveDraggedFiles: vi.fn(),
        movePayloadPathsToDirectory,
        movePayloadPathsToFolder: vi.fn(),
        copyPayloadPathsToDirectory,
        copyPayloadPathsToFolder: vi.fn(),
        selectedFileIds: [sourceFile.id],
        selectedFiles: [sourceFile],
        showFeedback: vi.fn(),
        t: ((key: string, options?: Record<string, unknown>) => String(options?.defaultValue ?? key)) as never,
      });
      return null;
    }

    root = createRoot(container as HTMLDivElement);
    await act(async () => {
      root?.render(React.createElement(Harness));
    });

    await act(async () => {
      handlers?.handleDragStart({
        clientX: 10,
        clientY: 20,
        dataTransfer: {
          effectAllowed: 'none',
          setData: vi.fn(),
          types: [],
        },
        preventDefault: vi.fn(),
      } as unknown as React.DragEvent, sourceFile);
    });

    await act(async () => {
      await handlers?.handleSurfaceDrop({
        dataTransfer: {
          files: [],
          getData: vi.fn().mockReturnValue(''),
          types: [],
        },
        preventDefault: vi.fn(),
        target: document.createElement('div'),
      } as unknown as React.DragEvent);
    });

    expect(movePayloadPathsToDirectory).toHaveBeenCalledWith([sourceFile.path], '/target');
    expect(copyPayloadPathsToDirectory).not.toHaveBeenCalled();
  });

  it('copies cross-window payload drops into target folders', async () => {
    const copyPayloadPathsToFolder = vi.fn().mockResolvedValue(undefined);
    const movePayloadPathsToFolder = vi.fn().mockResolvedValue(undefined);
    const importExternalPaths = vi.fn().mockResolvedValue(true);
    let handlers: ReturnType<typeof useExplorerDragDrop> | null = null;

    function Harness() {
      const activeTransferRef = React.useRef<{ transferId: string; paths: string[] } | null>(null);
      handlers = useExplorerDragDrop({
        activeTransferRef,
        findFileById: id => (id === targetFolder.id ? targetFolder : undefined),
        focusCurrentWindow: vi.fn(),
        getActionDirectory: () => '/target',
        importExternalPaths,
        isRemotePath: () => false,
        logDragDebug: vi.fn(),
        moveDraggedFiles: vi.fn(),
        movePayloadPathsToDirectory: vi.fn(),
        movePayloadPathsToFolder,
        copyPayloadPathsToDirectory: vi.fn(),
        copyPayloadPathsToFolder,
        selectedFileIds: [],
        selectedFiles: [],
        showFeedback: vi.fn(),
        t: ((key: string, options?: Record<string, unknown>) => String(options?.defaultValue ?? key)) as never,
      });
      return null;
    }

    root = createRoot(container as HTMLDivElement);
    await act(async () => {
      root?.render(React.createElement(Harness));
    });

    const payload = { paths: ['/source/source.txt'], cut: true };
    const event = {
      dataTransfer: {
        files: [],
        getData: vi.fn().mockReturnValue(JSON.stringify(payload)),
        types: [INTERNAL_FILE_DRAG_MIME],
      },
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    } as unknown as React.DragEvent;

    await act(async () => {
      await handlers?.handleDrop(event, targetFolder.id);
    });

    expect(copyPayloadPathsToFolder).toHaveBeenCalledWith(payload.paths, targetFolder);
    expect(movePayloadPathsToFolder).not.toHaveBeenCalled();
    expect(importExternalPaths).not.toHaveBeenCalled();
    expect(getFileDragPayloadMock).not.toHaveBeenCalled();
  });

  it('moves same-window payload drops into folders and clears drag state', async () => {
    const movePayloadPathsToFolder = vi.fn().mockResolvedValue(undefined);
    const copyPayloadPathsToFolder = vi.fn().mockResolvedValue(undefined);
    let handlers: ReturnType<typeof useExplorerDragDrop> | null = null;

    function Harness() {
      const activeTransferRef = React.useRef<{ transferId: string; paths: string[] } | null>(null);
      handlers = useExplorerDragDrop({
        activeTransferRef,
        findFileById: id => {
          if (id === targetFolder.id) return targetFolder;
          if (id === sourceFile.id) return sourceFile;
          return undefined;
        },
        focusCurrentWindow: vi.fn(),
        getActionDirectory: () => '/target',
        importExternalPaths: vi.fn(),
        isRemotePath: () => false,
        logDragDebug: vi.fn(),
        moveDraggedFiles: vi.fn(),
        movePayloadPathsToDirectory: vi.fn(),
        movePayloadPathsToFolder,
        copyPayloadPathsToDirectory: vi.fn(),
        copyPayloadPathsToFolder,
        selectedFileIds: [sourceFile.id],
        selectedFiles: [sourceFile],
        showFeedback: vi.fn(),
        t: ((key: string, options?: Record<string, unknown>) => String(options?.defaultValue ?? key)) as never,
      });
      return null;
    }

    root = createRoot(container as HTMLDivElement);
    await act(async () => {
      root?.render(React.createElement(Harness));
    });

    const dataTransfer = {
      effectAllowed: 'none',
      setData: vi.fn(),
      types: [],
    };
    await act(async () => {
      handlers?.handleDragStart({
        clientX: 10,
        clientY: 20,
        dataTransfer,
        preventDefault: vi.fn(),
      } as unknown as React.DragEvent, sourceFile);
    });
    expect(handlers?.getActiveTransfer()).toEqual(expect.objectContaining({
      paths: [sourceFile.path],
    }));

    const payload = { paths: [sourceFile.path], cut: true };
    await act(async () => {
      await handlers?.handleDrop({
        dataTransfer: {
          files: [],
          getData: vi.fn().mockReturnValue(JSON.stringify(payload)),
          types: [INTERNAL_FILE_DRAG_MIME],
        },
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
      } as unknown as React.DragEvent, targetFolder.id);
    });

    expect(movePayloadPathsToFolder).toHaveBeenCalledWith(payload.paths, targetFolder);
    expect(copyPayloadPathsToFolder).not.toHaveBeenCalled();
    expect(handlers?.getActiveTransfer()).toBeNull();
    expect(clearFileDragPayloadMock).toHaveBeenCalled();
  });

  it('allows a second mouse drag after a native payload drop completes', async () => {
    const movePayloadPathsToFolder = vi.fn().mockResolvedValue(undefined);
    const moveDraggedFiles = vi.fn().mockResolvedValue(undefined);
    let handlers: ReturnType<typeof useExplorerDragDrop> | null = null;

    function Harness() {
      const activeTransferRef = React.useRef<{ transferId: string; paths: string[] } | null>(null);
      handlers = useExplorerDragDrop({
        activeTransferRef,
        findFileById: id => {
          if (id === targetFolder.id) return targetFolder;
          if (id === sourceFile.id) return sourceFile;
          return undefined;
        },
        focusCurrentWindow: vi.fn(),
        getActionDirectory: () => '/target',
        importExternalPaths: vi.fn(),
        isRemotePath: () => false,
        logDragDebug: vi.fn(),
        moveDraggedFiles,
        movePayloadPathsToDirectory: vi.fn(),
        movePayloadPathsToFolder,
        copyPayloadPathsToDirectory: vi.fn(),
        copyPayloadPathsToFolder: vi.fn(),
        selectedFileIds: [sourceFile.id],
        selectedFiles: [sourceFile],
        showFeedback: vi.fn(),
        t: ((key: string, options?: Record<string, unknown>) => String(options?.defaultValue ?? key)) as never,
      });
      return null;
    }

    root = createRoot(container as HTMLDivElement);
    await act(async () => {
      root?.render(React.createElement(Harness));
    });

    const dataTransfer = {
      effectAllowed: 'none',
      setData: vi.fn(),
      types: [INTERNAL_FILE_DRAG_MIME],
    };
    await act(async () => {
      handlers?.handleDragStart({
        clientX: 10,
        clientY: 20,
        dataTransfer,
        preventDefault: vi.fn(),
      } as unknown as React.DragEvent, sourceFile);
    });

    const fileItem = document.createElement('div');
    fileItem.className = 'file-item';
    fileItem.dataset.id = targetFolder.id;
    const originalElementFromPoint = document.elementFromPoint;
    Object.defineProperty(document, 'elementFromPoint', {
      configurable: true,
      value: vi.fn().mockReturnValue(fileItem),
    });
    try {
      await act(async () => {
        await handlers?.handleDrop({
          dataTransfer: {
            files: [],
            getData: vi.fn().mockReturnValue(JSON.stringify({ paths: [sourceFile.path], cut: true })),
            types: [INTERNAL_FILE_DRAG_MIME],
          },
          preventDefault: vi.fn(),
          stopPropagation: vi.fn(),
        } as unknown as React.DragEvent, targetFolder.id);
      });

      await act(async () => {
        handlers?.handleFileMouseDown({
          button: 0,
          clientX: 5,
          clientY: 5,
          target: document.createElement('div'),
        } as unknown as React.MouseEvent, sourceFile);
        window.dispatchEvent(new MouseEvent('mousemove', { clientX: 30, clientY: 40 }));
        window.dispatchEvent(new MouseEvent('mouseup', { clientX: 30, clientY: 40 }));
        await Promise.resolve();
      });
    } finally {
      Object.defineProperty(document, 'elementFromPoint', {
        configurable: true,
        value: originalElementFromPoint,
      });
    }

    expect(movePayloadPathsToFolder).toHaveBeenCalledWith([sourceFile.path], targetFolder);
    expect(moveDraggedFiles).toHaveBeenCalledWith(sourceFile.id, targetFolder.id);
  });

  it('moves native drag-end fallback drops into target folders', async () => {
    const moveDraggedFiles = vi.fn().mockResolvedValue(undefined);
    let handlers: ReturnType<typeof useExplorerDragDrop> | null = null;

    function Harness() {
      const activeTransferRef = React.useRef<{ transferId: string; paths: string[] } | null>(null);
      handlers = useExplorerDragDrop({
        activeTransferRef,
        findFileById: id => {
          if (id === targetFolder.id) return targetFolder;
          if (id === sourceFile.id) return sourceFile;
          return undefined;
        },
        focusCurrentWindow: vi.fn(),
        getActionDirectory: () => '/target',
        importExternalPaths: vi.fn(),
        isRemotePath: () => false,
        logDragDebug: vi.fn(),
        moveDraggedFiles,
        movePayloadPathsToDirectory: vi.fn(),
        movePayloadPathsToFolder: vi.fn(),
        copyPayloadPathsToDirectory: vi.fn(),
        copyPayloadPathsToFolder: vi.fn(),
        selectedFileIds: [sourceFile.id],
        selectedFiles: [sourceFile],
        showFeedback: vi.fn(),
        t: ((key: string, options?: Record<string, unknown>) => String(options?.defaultValue ?? key)) as never,
      });
      return null;
    }

    root = createRoot(container as HTMLDivElement);
    await act(async () => {
      root?.render(React.createElement(Harness));
    });

    const dataTransfer = {
      effectAllowed: 'none',
      setData: vi.fn(),
      types: [INTERNAL_FILE_DRAG_MIME],
    };
    await act(async () => {
      handlers?.handleDragStart({
        clientX: 10,
        clientY: 20,
        dataTransfer,
        preventDefault: vi.fn(),
      } as unknown as React.DragEvent, sourceFile);
    });

    const fileItem = document.createElement('div');
    fileItem.className = 'file-item';
    fileItem.dataset.id = targetFolder.id;
    const originalElementFromPoint = document.elementFromPoint;
    Object.defineProperty(document, 'elementFromPoint', {
      configurable: true,
      value: vi.fn().mockReturnValue(fileItem),
    });
    try {
      await act(async () => {
        handlers?.handleDragEnd({
          clientX: 30,
          clientY: 40,
          screenX: 30,
          screenY: 40,
          metaKey: false,
          altKey: false,
          shiftKey: false,
        } as unknown as React.DragEvent);
        await waitForDeferredDragEnd();
      });
    } finally {
      Object.defineProperty(document, 'elementFromPoint', {
        configurable: true,
        value: originalElementFromPoint,
      });
    }

    expect(moveDraggedFiles).toHaveBeenCalledWith(sourceFile.id, targetFolder.id);
  });

  it('uses the globally highlighted folder when drag-end coordinates are stale', async () => {
    const moveDraggedFiles = vi.fn().mockResolvedValue(undefined);
    const logs: string[] = [];
    let handlers: ReturnType<typeof useExplorerDragDrop> | null = null;

    function Harness() {
      const activeTransferRef = React.useRef<{ transferId: string; paths: string[] } | null>(null);
      handlers = useExplorerDragDrop({
        activeTransferRef,
        findFileById: id => {
          if (id === targetFolder.id) return targetFolder;
          if (id === sourceFile.id) return sourceFile;
          return undefined;
        },
        focusCurrentWindow: vi.fn(),
        getActionDirectory: preferredPath => preferredPath || '/source',
        importExternalPaths: vi.fn(),
        isRemotePath: () => false,
        logDragDebug: message => logs.push(message),
        moveDraggedFiles,
        movePayloadPathsToDirectory: vi.fn(),
        movePayloadPathsToFolder: vi.fn(),
        copyPayloadPathsToDirectory: vi.fn(),
        copyPayloadPathsToFolder: vi.fn(),
        selectedFileIds: [sourceFile.id],
        selectedFiles: [sourceFile],
        showFeedback: vi.fn(),
        t: ((key: string, options?: Record<string, unknown>) => String(options?.defaultValue ?? key)) as never,
      });
      return null;
    }

    root = createRoot(container as HTMLDivElement);
    await act(async () => {
      root?.render(React.createElement(Harness));
    });

    await act(async () => {
      handlers?.handleDragStart({
        clientX: 10,
        clientY: 20,
        dataTransfer: {
          effectAllowed: 'none',
          setData: vi.fn(),
          types: [INTERNAL_FILE_DRAG_MIME],
        },
        preventDefault: vi.fn(),
      } as unknown as React.DragEvent, sourceFile);
    });

    const folderItem = document.createElement('div');
    folderItem.className = 'file-item';
    folderItem.dataset.id = targetFolder.id;
    const surface = document.createElement('div');
    surface.dataset.dropTargetDir = '/source';
    document.body.appendChild(folderItem);
    document.body.appendChild(surface);
    let pointMode: 'folder' | 'surface' = 'folder';
    const originalElementFromPoint = document.elementFromPoint;
    const originalElementsFromPoint = document.elementsFromPoint;
    Object.defineProperty(document, 'elementFromPoint', {
      configurable: true,
      value: vi.fn().mockImplementation(() => (pointMode === 'folder' ? folderItem : surface)),
    });
    Object.defineProperty(document, 'elementsFromPoint', {
      configurable: true,
      value: vi.fn().mockImplementation(() => (pointMode === 'folder' ? [folderItem] : [surface])),
    });
    try {
      const hoverEvent = new Event('drag', { bubbles: true, cancelable: true });
      Object.defineProperties(hoverEvent, {
        clientX: { value: 100 },
        clientY: { value: 100 },
        screenX: { value: 100 },
        screenY: { value: 100 },
      });
      await act(async () => {
        window.dispatchEvent(hoverEvent);
      });

      pointMode = 'surface';
      await act(async () => {
        handlers?.handleDragEnd({
          clientX: 30,
          clientY: 40,
          screenX: 30,
          screenY: 40,
          metaKey: false,
          altKey: false,
          shiftKey: false,
        } as unknown as React.DragEvent);
        await waitForDeferredDragEnd();
      });
    } finally {
      Object.defineProperty(document, 'elementFromPoint', {
        configurable: true,
        value: originalElementFromPoint,
      });
      Object.defineProperty(document, 'elementsFromPoint', {
        configurable: true,
        value: originalElementsFromPoint,
      });
      folderItem.remove();
      surface.remove();
    }

    expect(moveDraggedFiles).toHaveBeenCalledWith(sourceFile.id, targetFolder.id);
    expect(logs.some(message => message.includes(`globalDragHover folderId=${targetFolder.id}`))).toBe(true);
    expect(logs.some(message => message.includes(`resolvedFolderId=${targetFolder.id}`))).toBe(true);
  });

  it('uses the captured release point when native drag-end coordinates miss the folder', async () => {
    const moveDraggedFiles = vi.fn().mockResolvedValue(undefined);
    const logs: string[] = [];
    let handlers: ReturnType<typeof useExplorerDragDrop> | null = null;

    function Harness() {
      const activeTransferRef = React.useRef<{ transferId: string; paths: string[] } | null>(null);
      handlers = useExplorerDragDrop({
        activeTransferRef,
        findFileById: id => {
          if (id === targetFolder.id) return targetFolder;
          if (id === sourceFile.id) return sourceFile;
          return undefined;
        },
        focusCurrentWindow: vi.fn(),
        getActionDirectory: preferredPath => preferredPath || '/source',
        importExternalPaths: vi.fn(),
        isRemotePath: () => false,
        logDragDebug: message => logs.push(message),
        moveDraggedFiles,
        movePayloadPathsToDirectory: vi.fn(),
        movePayloadPathsToFolder: vi.fn(),
        copyPayloadPathsToDirectory: vi.fn(),
        copyPayloadPathsToFolder: vi.fn(),
        selectedFileIds: [sourceFile.id],
        selectedFiles: [sourceFile],
        showFeedback: vi.fn(),
        t: ((key: string, options?: Record<string, unknown>) => String(options?.defaultValue ?? key)) as never,
      });
      return null;
    }

    root = createRoot(container as HTMLDivElement);
    await act(async () => {
      root?.render(React.createElement(Harness));
    });

    await act(async () => {
      handlers?.handleDragStart({
        clientX: 10,
        clientY: 20,
        dataTransfer: {
          effectAllowed: 'none',
          setData: vi.fn(),
          types: [INTERNAL_FILE_DRAG_MIME],
        },
        preventDefault: vi.fn(),
      } as unknown as React.DragEvent, sourceFile);
    });

    const folderItem = document.createElement('div');
    folderItem.className = 'file-item';
    folderItem.dataset.id = targetFolder.id;
    const surface = document.createElement('div');
    surface.dataset.dropTargetDir = '/source';
    document.body.appendChild(folderItem);
    document.body.appendChild(surface);
    const originalElementFromPoint = document.elementFromPoint;
    const originalElementsFromPoint = document.elementsFromPoint;
    const elementsAtPoint = vi.fn().mockImplementation((clientX: number, clientY: number) => (
      clientX === 111 && clientY === 222 ? [folderItem] : [surface]
    ));
    Object.defineProperty(document, 'elementFromPoint', {
      configurable: true,
      value: vi.fn().mockImplementation((clientX: number, clientY: number) => elementsAtPoint(clientX, clientY)[0]),
    });
    Object.defineProperty(document, 'elementsFromPoint', {
      configurable: true,
      value: elementsAtPoint,
    });
    try {
      await act(async () => {
        handlers?.handleDragEnd({
          clientX: 30,
          clientY: 40,
          screenX: 30,
          screenY: 40,
          metaKey: false,
          altKey: false,
          shiftKey: false,
        } as unknown as React.DragEvent);
        window.dispatchEvent(new MouseEvent('mouseup', {
          bubbles: true,
          clientX: 111,
          clientY: 222,
          screenX: 111,
          screenY: 222,
        }));
        await waitForDeferredDragEnd();
      });
    } finally {
      Object.defineProperty(document, 'elementFromPoint', {
        configurable: true,
        value: originalElementFromPoint,
      });
      Object.defineProperty(document, 'elementsFromPoint', {
        configurable: true,
        value: originalElementsFromPoint,
      });
      folderItem.remove();
      surface.remove();
    }

    expect(moveDraggedFiles).toHaveBeenCalledWith(sourceFile.id, targetFolder.id);
    expect(logs.some(message => message.includes(`releasePointFolderId=${targetFolder.id}`))).toBe(true);
    expect(logs.some(message => message.includes(`resolvedFolderId=${targetFolder.id}`))).toBe(true);
  });

  it('uses the drag-start screen offset when native drag-end client coordinates are wrong', async () => {
    const moveDraggedFiles = vi.fn().mockResolvedValue(undefined);
    const logs: string[] = [];
    let handlers: ReturnType<typeof useExplorerDragDrop> | null = null;

    function Harness() {
      const activeTransferRef = React.useRef<{ transferId: string; paths: string[] } | null>(null);
      handlers = useExplorerDragDrop({
        activeTransferRef,
        findFileById: id => {
          if (id === targetFolder.id) return targetFolder;
          if (id === sourceFile.id) return sourceFile;
          return undefined;
        },
        focusCurrentWindow: vi.fn(),
        getActionDirectory: preferredPath => preferredPath || '/source',
        importExternalPaths: vi.fn(),
        isRemotePath: () => false,
        logDragDebug: message => logs.push(message),
        moveDraggedFiles,
        movePayloadPathsToDirectory: vi.fn(),
        movePayloadPathsToFolder: vi.fn(),
        copyPayloadPathsToDirectory: vi.fn(),
        copyPayloadPathsToFolder: vi.fn(),
        selectedFileIds: [sourceFile.id],
        selectedFiles: [sourceFile],
        showFeedback: vi.fn(),
        t: ((key: string, options?: Record<string, unknown>) => String(options?.defaultValue ?? key)) as never,
      });
      return null;
    }

    root = createRoot(container as HTMLDivElement);
    await act(async () => {
      root?.render(React.createElement(Harness));
    });

    await act(async () => {
      handlers?.handleDragStart({
        clientX: 415,
        clientY: 293,
        screenX: 1095,
        screenY: 477,
        dataTransfer: {
          effectAllowed: 'none',
          setData: vi.fn(),
          types: [INTERNAL_FILE_DRAG_MIME],
        },
        preventDefault: vi.fn(),
      } as unknown as React.DragEvent, sourceFile);
    });

    const folderItem = document.createElement('div');
    folderItem.className = 'file-item';
    folderItem.dataset.id = targetFolder.id;
    Object.defineProperty(folderItem, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({
        bottom: 273,
        height: 38,
        left: 260,
        right: 1167,
        top: 235,
        width: 907,
        x: 260,
        y: 235,
        toJSON: () => ({}),
      }),
    });
    const surface = document.createElement('div');
    surface.dataset.dropTargetDir = '/source';
    document.body.appendChild(folderItem);
    document.body.appendChild(surface);
    const originalElementFromPoint = document.elementFromPoint;
    const originalElementsFromPoint = document.elementsFromPoint;
    const elementsAtPoint = vi.fn().mockImplementation((clientX: number, clientY: number) => (
      clientY >= 235 && clientY <= 310 ? [folderItem] : [surface]
    ));
    Object.defineProperty(document, 'elementFromPoint', {
      configurable: true,
      value: vi.fn().mockImplementation((clientX: number, clientY: number) => elementsAtPoint(clientX, clientY)[0]),
    });
    Object.defineProperty(document, 'elementsFromPoint', {
      configurable: true,
      value: elementsAtPoint,
    });
    try {
      await act(async () => {
        handlers?.handleDragEnd({
          clientX: 534,
          clientY: 573,
          screenX: 1214,
          screenY: 462,
          metaKey: false,
          altKey: false,
          shiftKey: false,
        } as unknown as React.DragEvent);
        await waitForDeferredDragEnd();
      });
    } finally {
      Object.defineProperty(document, 'elementFromPoint', {
        configurable: true,
        value: originalElementFromPoint,
      });
      Object.defineProperty(document, 'elementsFromPoint', {
        configurable: true,
        value: originalElementsFromPoint,
      });
      folderItem.remove();
      surface.remove();
    }

    expect(moveDraggedFiles).toHaveBeenCalledWith(sourceFile.id, targetFolder.id);
    expect(logs.some(message => message.includes(`screenPointFolderId=${targetFolder.id}`))).toBe(true);
    expect(logs.some(message => message.includes('dragEnd action=fallbackMoveDragged'))).toBe(true);
  });

  it('moves native drag-end fallback drops into point directories when no folder item is hit', async () => {
    const movePayloadPathsToDirectory = vi.fn().mockResolvedValue(undefined);
    const logs: string[] = [];
    let handlers: ReturnType<typeof useExplorerDragDrop> | null = null;

    function Harness() {
      const activeTransferRef = React.useRef<{ transferId: string; paths: string[] } | null>(null);
      handlers = useExplorerDragDrop({
        activeTransferRef,
        findFileById: id => (id === sourceFile.id ? sourceFile : undefined),
        focusCurrentWindow: vi.fn(),
        getActionDirectory: preferredPath => preferredPath || '/fallback',
        importExternalPaths: vi.fn(),
        isRemotePath: () => false,
        logDragDebug: message => logs.push(message),
        moveDraggedFiles: vi.fn(),
        movePayloadPathsToDirectory,
        movePayloadPathsToFolder: vi.fn(),
        copyPayloadPathsToDirectory: vi.fn(),
        copyPayloadPathsToFolder: vi.fn(),
        selectedFileIds: [sourceFile.id],
        selectedFiles: [sourceFile],
        showFeedback: vi.fn(),
        t: ((key: string, options?: Record<string, unknown>) => String(options?.defaultValue ?? key)) as never,
      });
      return null;
    }

    root = createRoot(container as HTMLDivElement);
    await act(async () => {
      root?.render(React.createElement(Harness));
    });

    await act(async () => {
      handlers?.handleDragStart({
        clientX: 10,
        clientY: 20,
        dataTransfer: {
          effectAllowed: 'none',
          setData: vi.fn(),
          types: [INTERNAL_FILE_DRAG_MIME],
        },
        preventDefault: vi.fn(),
      } as unknown as React.DragEvent, sourceFile);
    });

    const dropTarget = document.createElement('div');
    dropTarget.dataset.dropTargetDir = '/target';
    document.body.appendChild(dropTarget);
    const originalElementFromPoint = document.elementFromPoint;
    const originalElementsFromPoint = document.elementsFromPoint;
    Object.defineProperty(document, 'elementFromPoint', {
      configurable: true,
      value: vi.fn().mockReturnValue(dropTarget),
    });
    Object.defineProperty(document, 'elementsFromPoint', {
      configurable: true,
      value: vi.fn().mockReturnValue([dropTarget]),
    });
    try {
      await act(async () => {
        handlers?.handleDragEnd({
          clientX: 30,
          clientY: 40,
          screenX: 30,
          screenY: 40,
          metaKey: false,
          altKey: false,
          shiftKey: false,
        } as unknown as React.DragEvent);
        await waitForDeferredDragEnd();
      });
    } finally {
      Object.defineProperty(document, 'elementFromPoint', {
        configurable: true,
        value: originalElementFromPoint,
      });
      Object.defineProperty(document, 'elementsFromPoint', {
        configurable: true,
        value: originalElementsFromPoint,
      });
      dropTarget.remove();
    }

    expect(movePayloadPathsToDirectory).toHaveBeenCalledWith([sourceFile.path], '/target');
    expect(logs.some(message => message.includes('dragEnd action=fallbackMoveToDirectory'))).toBe(true);
  });

  it('does not start directory fallback moves when released back into the source parent', async () => {
    const movePayloadPathsToDirectory = vi.fn().mockResolvedValue(undefined);
    const showFeedback = vi.fn();
    const logs: string[] = [];
    let handlers: ReturnType<typeof useExplorerDragDrop> | null = null;

    function Harness() {
      const activeTransferRef = React.useRef<{ transferId: string; paths: string[] } | null>(null);
      handlers = useExplorerDragDrop({
        activeTransferRef,
        findFileById: id => (id === sourceFile.id ? sourceFile : undefined),
        focusCurrentWindow: vi.fn(),
        getActionDirectory: preferredPath => preferredPath || '/source',
        importExternalPaths: vi.fn(),
        isRemotePath: () => false,
        logDragDebug: message => logs.push(message),
        moveDraggedFiles: vi.fn(),
        movePayloadPathsToDirectory,
        movePayloadPathsToFolder: vi.fn(),
        copyPayloadPathsToDirectory: vi.fn(),
        copyPayloadPathsToFolder: vi.fn(),
        selectedFileIds: [sourceFile.id],
        selectedFiles: [sourceFile],
        showFeedback,
        t: ((key: string, options?: Record<string, unknown>) => String(options?.defaultValue ?? key)) as never,
      });
      return null;
    }

    root = createRoot(container as HTMLDivElement);
    await act(async () => {
      root?.render(React.createElement(Harness));
    });

    await act(async () => {
      handlers?.handleDragStart({
        clientX: 10,
        clientY: 20,
        dataTransfer: {
          effectAllowed: 'none',
          setData: vi.fn(),
          types: [INTERNAL_FILE_DRAG_MIME],
        },
        preventDefault: vi.fn(),
      } as unknown as React.DragEvent, sourceFile);
    });

    const dropTarget = document.createElement('div');
    dropTarget.dataset.dropTargetDir = '/source';
    document.body.appendChild(dropTarget);
    const originalElementFromPoint = document.elementFromPoint;
    const originalElementsFromPoint = document.elementsFromPoint;
    Object.defineProperty(document, 'elementFromPoint', {
      configurable: true,
      value: vi.fn().mockReturnValue(dropTarget),
    });
    Object.defineProperty(document, 'elementsFromPoint', {
      configurable: true,
      value: vi.fn().mockReturnValue([dropTarget]),
    });
    try {
      await act(async () => {
        handlers?.handleDragEnd({
          clientX: 30,
          clientY: 40,
          screenX: 30,
          screenY: 40,
          metaKey: false,
          altKey: false,
          shiftKey: false,
        } as unknown as React.DragEvent);
        await waitForDeferredDragEnd();
      });
    } finally {
      Object.defineProperty(document, 'elementFromPoint', {
        configurable: true,
        value: originalElementFromPoint,
      });
      Object.defineProperty(document, 'elementsFromPoint', {
        configurable: true,
        value: originalElementsFromPoint,
      });
      dropTarget.remove();
    }

    expect(movePayloadPathsToDirectory).not.toHaveBeenCalled();
    expect(showFeedback).not.toHaveBeenCalledWith('已在该目录中');
    expect(showFeedback).toHaveBeenCalledWith('请拖到文件夹上');
    expect(logs.some(message => message.includes('dragEnd action=localSameDirectoryIgnored'))).toBe(true);
  });

  it('does not report same-directory success when released over a non-folder item in the same directory', async () => {
    const otherTextFile: FileItem = {
      id: '/source/other.txt',
      modified: '2026-06-09',
      name: 'other.txt',
      path: '/source/other.txt',
      size: '1 KB',
      type: 'text',
    };
    const movePayloadPathsToDirectory = vi.fn().mockResolvedValue(undefined);
    const showFeedback = vi.fn();
    const logs: string[] = [];
    let handlers: ReturnType<typeof useExplorerDragDrop> | null = null;

    function Harness() {
      const activeTransferRef = React.useRef<{ transferId: string; paths: string[] } | null>(null);
      handlers = useExplorerDragDrop({
        activeTransferRef,
        findFileById: id => {
          if (id === sourceFile.id) return sourceFile;
          if (id === otherTextFile.id) return otherTextFile;
          return undefined;
        },
        focusCurrentWindow: vi.fn(),
        getActionDirectory: preferredPath => preferredPath || '/source',
        importExternalPaths: vi.fn(),
        isRemotePath: () => false,
        logDragDebug: message => logs.push(message),
        moveDraggedFiles: vi.fn(),
        movePayloadPathsToDirectory,
        movePayloadPathsToFolder: vi.fn(),
        copyPayloadPathsToDirectory: vi.fn(),
        copyPayloadPathsToFolder: vi.fn(),
        selectedFileIds: [sourceFile.id],
        selectedFiles: [sourceFile],
        showFeedback,
        t: ((key: string, options?: Record<string, unknown>) => String(options?.defaultValue ?? key)) as never,
      });
      return null;
    }

    root = createRoot(container as HTMLDivElement);
    await act(async () => {
      root?.render(React.createElement(Harness));
    });

    await act(async () => {
      handlers?.handleDragStart({
        clientX: 10,
        clientY: 20,
        dataTransfer: {
          effectAllowed: 'none',
          setData: vi.fn(),
          types: [INTERNAL_FILE_DRAG_MIME],
        },
        preventDefault: vi.fn(),
      } as unknown as React.DragEvent, sourceFile);
    });

    const dropTarget = document.createElement('div');
    dropTarget.className = 'file-item';
    dropTarget.dataset.id = otherTextFile.id;
    const surface = document.createElement('div');
    surface.dataset.dropTargetDir = '/source';
    surface.appendChild(dropTarget);
    document.body.appendChild(surface);
    const originalElementFromPoint = document.elementFromPoint;
    const originalElementsFromPoint = document.elementsFromPoint;
    Object.defineProperty(document, 'elementFromPoint', {
      configurable: true,
      value: vi.fn().mockReturnValue(dropTarget),
    });
    Object.defineProperty(document, 'elementsFromPoint', {
      configurable: true,
      value: vi.fn().mockReturnValue([dropTarget, surface]),
    });
    try {
      await act(async () => {
        handlers?.handleDragEnd({
          clientX: 30,
          clientY: 40,
          screenX: 30,
          screenY: 40,
          metaKey: false,
          altKey: false,
          shiftKey: false,
        } as unknown as React.DragEvent);
        await waitForDeferredDragEnd();
      });
    } finally {
      Object.defineProperty(document, 'elementFromPoint', {
        configurable: true,
        value: originalElementFromPoint,
      });
      Object.defineProperty(document, 'elementsFromPoint', {
        configurable: true,
        value: originalElementsFromPoint,
      });
      surface.remove();
    }

    expect(movePayloadPathsToDirectory).not.toHaveBeenCalled();
    expect(showFeedback).not.toHaveBeenCalledWith('已在该目录中');
    expect(showFeedback).toHaveBeenCalledWith('目标不是文件夹');
    expect(logs.some(message => message.includes('dragEnd action=localSameDirectoryNonFolderHit'))).toBe(true);
  });

  it('logs captured global drag and release events during active internal drags', async () => {
    const logs: string[] = [];
    let handlers: ReturnType<typeof useExplorerDragDrop> | null = null;

    function Harness() {
      const activeTransferRef = React.useRef<{ transferId: string; paths: string[] } | null>(null);
      handlers = useExplorerDragDrop({
        activeTransferRef,
        findFileById: id => (id === sourceFile.id ? sourceFile : undefined),
        focusCurrentWindow: vi.fn(),
        getActionDirectory: () => '/source',
        importExternalPaths: vi.fn(),
        isRemotePath: () => false,
        logDragDebug: message => logs.push(message),
        moveDraggedFiles: vi.fn(),
        movePayloadPathsToDirectory: vi.fn(),
        movePayloadPathsToFolder: vi.fn(),
        copyPayloadPathsToDirectory: vi.fn(),
        copyPayloadPathsToFolder: vi.fn(),
        selectedFileIds: [sourceFile.id],
        selectedFiles: [sourceFile],
        showFeedback: vi.fn(),
        t: ((key: string, options?: Record<string, unknown>) => String(options?.defaultValue ?? key)) as never,
      });
      return null;
    }

    root = createRoot(container as HTMLDivElement);
    await act(async () => {
      root?.render(React.createElement(Harness));
    });

    await act(async () => {
      handlers?.handleDragStart({
        clientX: 10,
        clientY: 20,
        dataTransfer: {
          effectAllowed: 'none',
          setData: vi.fn(),
          types: [INTERNAL_FILE_DRAG_MIME],
        },
        preventDefault: vi.fn(),
      } as unknown as React.DragEvent, sourceFile);
    });

    const dropTarget = document.createElement('div');
    dropTarget.className = 'file-item';
    dropTarget.dataset.id = sourceFile.id;
    document.body.appendChild(dropTarget);
    try {
      const dragEndEvent = new Event('dragend', { bubbles: true, cancelable: true });
      Object.defineProperties(dragEndEvent, {
        clientX: { value: 30 },
        clientY: { value: 40 },
        screenX: { value: 50 },
        screenY: { value: 60 },
        dataTransfer: {
          value: {
            files: [],
            types: [INTERNAL_FILE_DRAG_MIME],
          },
        },
      });

      await act(async () => {
        dropTarget.dispatchEvent(dragEndEvent);
        window.dispatchEvent(new MouseEvent('mouseup', { clientX: 30, clientY: 40 }));
      });
    } finally {
      dropTarget.remove();
    }

    expect(logs.some(message => message.includes('globalEvent scope=document type=dragend'))).toBe(true);
    expect(logs.some(message => message.includes('globalEvent scope=window type=mouseup'))).toBe(true);
  });

  it('refreshes the copy target directory after copy transfer tasks settle', async () => {
    const completedTask: TransferTaskSnapshot = {
      id: 'copy-task-1',
      kind: 'copy',
      status: 'completed',
      totalItems: 1,
      completedItems: 1,
      totalBytes: 1,
      completedBytes: 1,
      currentName: null,
      error: null,
      errorPath: null,
      startedAt: 1,
      finishedAt: 2,
      copied: 1,
      moved: 0,
      copiedCrossDevice: 0,
      failed: 0,
      conflicts: 0,
      skipped: 0,
      skippedSameDir: 0,
      skippedConflicts: 0,
    };
    listTransferTasksMock.mockResolvedValue([completedTask]);
    const refreshCurrentDir = vi.fn().mockResolvedValue([]);
    let workflow: ReturnType<typeof useExplorerTransferWorkflow> | null = null;

    function Harness() {
      const [, setMoveConflictDialog] = React.useState(null);
      const executeMoveFilesRef = React.useRef(async () => ({
        started: false,
        moved: 0,
        copiedCrossDevice: 0,
        failed: 0,
        conflicts: 0,
        skipped: 0,
      }));
      const refreshCurrentDirRef = React.useRef(refreshCurrentDir);
      const startMoveTaskFromDialogRef = React.useRef(async () => true);
      workflow = useExplorerTransferWorkflow({
        clearFileClipboardState: vi.fn().mockResolvedValue(undefined),
        confirmLargeBatchOperation: vi.fn().mockResolvedValue(true),
        executeMoveFilesRef,
        finishSharedFileDrag: vi.fn(),
        getActionDirectory: () => '/target',
        getProtectedRootForPath: () => null,
        logDragDebug: vi.fn(),
        moveConflictDialog: null,
        onStartTransfer: vi.fn(),
        recordManualOperationHistory: vi.fn().mockResolvedValue(undefined),
        refreshCurrentDirRef,
        setMoveConflictDialog,
        showFeedback: vi.fn(),
        startMoveTaskFromDialogRef,
        t: ((key: string, options?: Record<string, unknown>) => String(options?.defaultValue ?? key)) as never,
      });
      return null;
    }

    root = createRoot(container as HTMLDivElement);
    await act(async () => {
      root?.render(React.createElement(Harness));
    });

    await act(async () => {
      await workflow?.executeCopyFiles([sourceFile], targetFolder, 'abort');
      await new Promise(resolve => window.setTimeout(resolve, 0));
    });

    expect(startCopyFilesTaskMock).toHaveBeenCalledWith([sourceFile.path], targetFolder.path, 'abort');
    expect(refreshCurrentDir).toHaveBeenCalledWith(false, targetFolder.path);
  });

  it('resolves external copy conflicts with the selected replace strategy', async () => {
    const completedTask: TransferTaskSnapshot = {
      id: 'copy-task-1',
      kind: 'copy',
      status: 'completed',
      totalItems: 1,
      completedItems: 1,
      totalBytes: 1,
      completedBytes: 1,
      currentName: null,
      error: null,
      errorPath: null,
      startedAt: 1,
      finishedAt: 2,
      copied: 1,
      moved: 0,
      copiedCrossDevice: 0,
      failed: 0,
      conflicts: 0,
      skipped: 0,
      skippedSameDir: 0,
      skippedConflicts: 0,
    };
    const conflict = {
      src: sourceFile.path,
      dst: `${targetFolder.path}/${sourceFile.name}`,
      name: sourceFile.name,
    };
    listTransferTasksMock.mockResolvedValue([completedTask]);
    previewCopyFileConflictsMock.mockResolvedValueOnce([conflict]);
    const refreshCurrentDir = vi.fn().mockResolvedValue([]);
    let workflow: ReturnType<typeof useExplorerTransferWorkflow> | null = null;
    let latestDialog: MoveConflictDialogState | null = null;

    function Harness() {
      const [moveConflictDialog, setMoveConflictDialog] = React.useState<MoveConflictDialogState | null>(null);
      latestDialog = moveConflictDialog;
      const executeMoveFilesRef = React.useRef(async () => ({
        started: false,
        moved: 0,
        copiedCrossDevice: 0,
        failed: 0,
        conflicts: 0,
        skipped: 0,
      }));
      const refreshCurrentDirRef = React.useRef(refreshCurrentDir);
      const startMoveTaskFromDialogRef = React.useRef(async () => true);
      workflow = useExplorerTransferWorkflow({
        clearFileClipboardState: vi.fn().mockResolvedValue(undefined),
        confirmLargeBatchOperation: vi.fn().mockResolvedValue(true),
        executeMoveFilesRef,
        finishSharedFileDrag: vi.fn(),
        getActionDirectory: () => targetFolder.path,
        getProtectedRootForPath: () => null,
        logDragDebug: vi.fn(),
        moveConflictDialog,
        onStartTransfer: vi.fn(),
        recordManualOperationHistory: vi.fn().mockResolvedValue(undefined),
        refreshCurrentDirRef,
        setMoveConflictDialog,
        showFeedback: vi.fn(),
        startMoveTaskFromDialogRef,
        t: ((key: string, options?: Record<string, unknown>) => String(options?.defaultValue ?? key)) as never,
      });
      return null;
    }

    root = createRoot(container as HTMLDivElement);
    await act(async () => {
      root?.render(React.createElement(Harness));
    });

    await act(async () => {
      await workflow?.importExternalPaths([sourceFile.path], targetFolder.path);
    });

    expect(latestDialog).toMatchObject({
      conflicts: [conflict],
      operation: 'copy',
      targetFolder: expect.objectContaining({ path: targetFolder.path }),
    });

    await act(async () => {
      await workflow?.handleMoveConflictChoice('replace');
      await new Promise(resolve => window.setTimeout(resolve, 0));
    });

    expect(startCopyFilesTaskMock).toHaveBeenCalledWith([sourceFile.path], targetFolder.path, 'replace');
    expect(refreshCurrentDir).toHaveBeenCalledWith(false, targetFolder.path);
  });

  it('imports plain external file drops into folders without reading stored internal drag payloads', async () => {
    const importExternalPaths = vi.fn().mockResolvedValue(true);
    const copyPayloadPathsToFolder = vi.fn().mockResolvedValue(undefined);
    let handlers: ReturnType<typeof useExplorerDragDrop> | null = null;

    function Harness() {
      const activeTransferRef = React.useRef<{ transferId: string; paths: string[] } | null>(null);
      handlers = useExplorerDragDrop({
        activeTransferRef,
        findFileById: id => (id === targetFolder.id ? targetFolder : undefined),
        focusCurrentWindow: vi.fn(),
        getActionDirectory: () => '/target',
        importExternalPaths,
        isRemotePath: () => false,
        logDragDebug: vi.fn(),
        moveDraggedFiles: vi.fn(),
        movePayloadPathsToDirectory: vi.fn(),
        movePayloadPathsToFolder: vi.fn(),
        copyPayloadPathsToDirectory: vi.fn(),
        copyPayloadPathsToFolder,
        selectedFileIds: [],
        selectedFiles: [],
        showFeedback: vi.fn(),
        t: ((key: string, options?: Record<string, unknown>) => String(options?.defaultValue ?? key)) as never,
      });
      return null;
    }

    root = createRoot(container as HTMLDivElement);
    await act(async () => {
      root?.render(React.createElement(Harness));
    });

    const fileItem = document.createElement('div');
    fileItem.className = 'file-item';
    fileItem.dataset.id = targetFolder.id;
    const event = {
      dataTransfer: {
        files: [{ path: '/source/external.txt' }],
        types: ['Files'],
      },
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
      target: fileItem,
    } as unknown as React.DragEvent;

    await act(async () => {
      await handlers?.handleSurfaceDrop(event);
    });

    expect(importExternalPaths).toHaveBeenCalledWith(['/source/external.txt'], targetFolder.path);
    expect(copyPayloadPathsToFolder).not.toHaveBeenCalled();
    expect(getFileDragPayloadMock).not.toHaveBeenCalled();
  });

  it('passes selected ids and file lookup into transfer drag moves', () => {
    const source = readFileSync(path.join(process.cwd(), 'src/components/ExplorerView.tsx'), 'utf-8');

    expect(source).toContain('moveDraggedFiles(draggedFileId, targetFolderId, selectedFileIdsRef.current, findFileByIdRef.current)');
  });

  it('resets directory scroll state on path navigation and history restore', () => {
    const source = readFileSync(path.join(process.cwd(), 'src/components/ExplorerView.tsx'), 'utf-8');

    expect(source).toContain('const resetDirectoryScrollState = useCallback');
    expect(source).toMatch(/const navigateToPath = useCallback[\s\S]*resetDirectoryScrollState\(\);[\s\S]*setCurrentPath/);
    expect(source).toMatch(/const restoreHistoryPath = useCallback[\s\S]*resetDirectoryScrollState\(\);[\s\S]*setCurrentPath/);
  });

  it('wires same-window drag drops to move and payload drops to copy fallback', () => {
    const hookSource = readFileSync(path.join(process.cwd(), 'src/components/explorer/useExplorerDragDrop.ts'), 'utf-8');
    const viewSource = readFileSync(path.join(process.cwd(), 'src/components/ExplorerView.tsx'), 'utf-8');
    const workflowSource = readFileSync(path.join(process.cwd(), 'src/components/explorer/useExplorerTransferWorkflow.ts'), 'utf-8');

    expect(hookSource).toContain('movePayloadPathsToDirectory');
    expect(hookSource).toContain('movePayloadPathsToFolder');
    expect(hookSource).toContain('copyPayloadPathsToDirectory');
    expect(hookSource).toContain('copyPayloadPathsToFolder');
    expect(hookSource).toContain('payload.cut && localDragWasActive');
    expect(viewSource).toContain('const movePayloadPathsToDirectory');
    expect(viewSource).toContain('const movePayloadPathsToFolder');
    expect(viewSource).toContain('const copyPayloadPathsToDirectory');
    expect(viewSource).toContain('const copyPayloadPathsToFolder');
    expect(workflowSource).toContain('const moveDraggedFiles = useCallback');
    expect(workflowSource).toContain('await executeMoveFilesRef.current(filesToMove, targetFolder,');
  });

  it('wires move task settlement to refresh source parents and target directories', () => {
    const source = readFileSync(path.join(process.cwd(), 'src/components/ExplorerView.tsx'), 'utf-8');

    expect(source).toContain('const moveRefreshPaths = buildMoveRefreshPaths(paths, targetFolder.path);');
    expect(source).toContain('await Promise.all(moveRefreshPaths.map(path => refreshCurrentDirRef.current(false, path)));');
  });

  it('keeps drag diagnostics on key event, payload, and transfer task boundaries', () => {
    const hookSource = readFileSync(path.join(process.cwd(), 'src/components/explorer/useExplorerDragDrop.ts'), 'utf-8');
    const workflowSource = readFileSync(path.join(process.cwd(), 'src/components/explorer/useExplorerTransferWorkflow.ts'), 'utf-8');
    const viewSource = readFileSync(path.join(process.cwd(), 'src/components/ExplorerView.tsx'), 'utf-8');
    const shellSource = readFileSync(path.join(process.cwd(), 'src/components/explorer/ExplorerShell.tsx'), 'utf-8');
    const columnSource = readFileSync(path.join(process.cwd(), 'src/components/explorer/ColumnView.tsx'), 'utf-8');
    const windowCommandSource = readFileSync(path.join(process.cwd(), 'src-tauri/src/commands/window.rs'), 'utf-8');
    const transferCommandSource = readFileSync(path.join(process.cwd(), 'src-tauri/src/commands/transfer.rs'), 'utf-8');

    expect(hookSource).toContain('surfaceDrop enter');
    expect(hookSource).toContain('drop action=moveToFolder');
    expect(hookSource).toContain('readTransferPayload source=local');
    expect(hookSource).toContain('dragEnd action=fallbackMoveToDirectory');
    expect(hookSource).toContain('dragEnd action=localSameDirectoryIgnored');
    expect(hookSource).toContain('globalEvent scope=');
    expect(hookSource).toContain('pointHit=');
    expect(workflowSource).toContain('moveDraggedFiles enter');
    expect(workflowSource).toContain('moveDraggedFiles executeSettled');
    expect(workflowSource).toContain('transferWait settled taskId=');
    expect(viewSource).toContain('moveTaskStartInvoke');
    expect(viewSource).toContain('moveTaskSettledRefresh start');
    expect(viewSource).toContain('__aetherDragDebug');
    expect(shellSource).toContain('data-drop-target-dir={currentPath}');
    expect(columnSource).toContain('data-drop-target-dir={columnTargetDir}');
    expect(windowCommandSource).toContain('drag-debug.log');
    expect(transferCommandSource).toContain('backendMoveTask startRequest');
    expect(transferCommandSource).toContain('backendMoveTask finishOk');
  });

  it('keeps folder drop targets visually obvious during drag hover', () => {
    const rendererSource = readFileSync(path.join(process.cwd(), 'src/components/explorer/FileItemRenderer.tsx'), 'utf-8');

    expect(rendererSource).toContain('DROP_TARGET_ITEM_CLASS');
    expect(rendererSource).toContain('drop-target-active');
    expect(rendererSource).toContain('border-emerald-300');
    expect(rendererSource).toContain('shadow-[0_0_0_4px_rgba(52,211,153,0.55)');
  });
});

describe('explorer context menu source checks', () => {
  it('adds file menu new-tab and new-window actions immediately after rename', () => {
    const source = readFileSync(path.join(process.cwd(), 'src/components/explorer/ContextMenu.tsx'), 'utf-8');
    const renameIndex = source.indexOf('handleRenameStart(contextFile)');
    const newTabIndex = source.indexOf('handleOpenInNewTab(contextFile)');
    const newWindowIndex = source.indexOf('handleOpenInNewWindow(contextFile)');
    const nextSeparatorIndex = source.indexOf('<div className="my-1 h-px bg-primary/10" />', renameIndex);

    expect(renameIndex).toBeGreaterThan(-1);
    expect(newTabIndex).toBeGreaterThan(renameIndex);
    expect(newWindowIndex).toBeGreaterThan(newTabIndex);
    expect(nextSeparatorIndex).toBeGreaterThan(newWindowIndex);
  });

  it('adds blank-menu paste-as-txt directly after new file', () => {
    const source = readFileSync(path.join(process.cwd(), 'src/components/explorer/ContextMenu.tsx'), 'utf-8');
    const newFileIndex = source.indexOf('handleNewFile(contextMenu.targetDir)');
    const pasteTxtIndex = source.indexOf('handlePasteAsTextFile(contextMenu.targetDir)');
    const nextSeparatorIndex = source.indexOf('<div className="my-1 h-px bg-primary/10" />', newFileIndex);

    expect(newFileIndex).toBeGreaterThan(-1);
    expect(pasteTxtIndex).toBeGreaterThan(newFileIndex);
    expect(nextSeparatorIndex).toBeGreaterThan(pasteTxtIndex);
  });

  it('disables paste-as-txt when the system clipboard has no text', () => {
    const customMenuSource = readFileSync(path.join(process.cwd(), 'src/components/explorer/ContextMenu.tsx'), 'utf-8');
    const systemMenuSource = readFileSync(path.join(process.cwd(), 'src/components/explorer/system-context-menu.ts'), 'utf-8');

    expect(customMenuSource).toContain('hasTextClipboard: boolean');
    expect(customMenuSource).toContain('disabled={!hasTextClipboard}');
    expect(systemMenuSource).toContain('const canPasteText = await refreshTextClipboardState();');
    expect(systemMenuSource).toContain('enabled: canPasteText');
  });

  it('reads paste-as-txt content through Tauri instead of the browser clipboard API', () => {
    const createEntriesSource = readFileSync(path.join(process.cwd(), 'src/components/explorer/useExplorerCreateEntries.ts'), 'utf-8');
    const filesystemApiSource = readFileSync(path.join(process.cwd(), 'src/api/filesystem.ts'), 'utf-8');
    const tauriLibSource = readFileSync(path.join(process.cwd(), 'src-tauri/src/lib.rs'), 'utf-8');

    expect(createEntriesSource).toContain('readClipboardText()');
    expect(createEntriesSource).not.toContain('navigator.clipboard.readText');
    expect(filesystemApiSource).toContain("return invokeFs('read_clipboard_text'");
    expect(filesystemApiSource).toContain("return invokeFs('has_clipboard_text'");
    expect(tauriLibSource).toContain('commands::fs::read_clipboard_text');
    expect(tauriLibSource).toContain('commands::fs::has_clipboard_text');
  });

  it('wires matching actions into the native system context menu', () => {
    const source = readFileSync(path.join(process.cwd(), 'src/components/explorer/system-context-menu.ts'), 'utf-8');

    expect(source).toContain("t('explorer.openInNewTab'");
    expect(source).toContain("t('explorer.openInNewWindow'");
    expect(source).toContain("t('explorer.pasteAsTextFile'");
    expect(source).toContain('handleOpenInNewTab(primary)');
    expect(source).toContain('handleOpenInNewWindow(primary)');
    expect(source).toContain('handlePasteAsTextFile(targetDir)');
  });
});
