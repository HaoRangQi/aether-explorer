import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { OperationSession } from '../types';
import {
  isSessionUndoable,
  undoOperationSession,
} from '../lib/operation-history-undo';
import {
  saveOperationSession,
} from '../lib/operation-history';

const storeState = vi.hoisted(() => {
  const data = new Map<string, unknown>();
  const store = {
    get: vi.fn(async (key: string) => data.get(key)),
    set: vi.fn(async (key: string, value: unknown) => {
      data.set(key, value);
    }),
    delete: vi.fn(async (key: string) => {
      data.delete(key);
    }),
  };
  const loadMock = vi.fn(async () => store);

  return {
    data,
    loadMock,
    reset() {
      data.clear();
      store.get.mockClear();
      store.set.mockClear();
      store.delete.mockClear();
      loadMock.mockClear();
    },
  };
});

const fsMocks = vi.hoisted(() => ({
  createFile: vi.fn(),
  createFolder: vi.fn(),
  deleteToTrash: vi.fn(),
  getFileInfo: vi.fn(),
  moveFile: vi.fn(),
  renameFile: vi.fn(),
}));

vi.mock('@tauri-apps/plugin-store', () => ({
  load: storeState.loadMock,
}));

vi.mock('../api/filesystem', () => fsMocks);

function makeRenameSession(overrides: Partial<OperationSession> = {}): OperationSession {
  return {
    id: 'undo-session',
    timestamp: Date.now(),
    source: 'manual',
    category: 'rename',
    status: 'success',
    canUndo: true,
    itemCount: 1,
    title: 'Rename note',
    summary: 'Renamed note.txt',
    effects: [{
      op: { type: 'rename', path: '/tmp/note.txt', newName: 'renamed.txt' },
      status: 'ok',
      reverseOp: { type: 'rename', path: '/tmp/renamed.txt', newName: 'note.txt' },
    }],
    sourceMeta: {
      manualMeta: {
        action: 'rename',
        primaryPath: '/tmp/note.txt',
      },
    },
    ...overrides,
  };
}

function fileInfo(path: string, type: 'file' | 'folder' = 'file') {
  return {
    id: path,
    name: path.split('/').pop() || path,
    path,
    type,
    size: type === 'folder' ? '--' : '1 B',
    modified: '2026-05-30 10:00',
  };
}

beforeEach(() => {
  storeState.reset();
  fsMocks.createFile.mockReset();
  fsMocks.createFolder.mockReset();
  fsMocks.deleteToTrash.mockReset();
  fsMocks.getFileInfo.mockReset();
  fsMocks.moveFile.mockReset();
  fsMocks.renameFile.mockReset();
});

describe('operation-history undo', () => {
  it('reports not found sessions without touching filesystem', async () => {
    const result = await undoOperationSession('missing-session');

    expect(result).toEqual({
      status: 'undo_failed',
      total: 0,
      succeeded: 0,
      failed: 0,
      reason: '未找到对应的操作记录',
    });
    expect(fsMocks.renameFile).not.toHaveBeenCalled();
  });

  it('identifies sessions with successful reverse effects as undoable', () => {
    expect(isSessionUndoable(makeRenameSession())).toBe(true);
    expect(isSessionUndoable(makeRenameSession({ canUndo: false }))).toBe(false);
    expect(isSessionUndoable(makeRenameSession({
      effects: [{
        op: { type: 'rename', path: '/tmp/a.txt', newName: 'b.txt' },
        status: 'fail',
        reverseOp: { type: 'rename', path: '/tmp/b.txt', newName: 'a.txt' },
      }],
    }))).toBe(false);
  });

  it('blocks undo when target name already exists before applying reverse rename', async () => {
    const session = makeRenameSession();
    await saveOperationSession(session, { retentionDays: 90 });

    fsMocks.getFileInfo.mockImplementation(async (path: string) => {
      if (path === '/tmp/renamed.txt') return fileInfo(path);
      if (path === '/tmp') return fileInfo(path, 'folder');
      if (path === '/tmp/note.txt') return fileInfo(path);
      throw { kind: 'NotFound', message: '路径不存在', path };
    });

    const result = await undoOperationSession(session.id);

    expect(result.status).toBe('undo_failed');
    expect(result.total).toBe(1);
    expect(result.failed).toBe(1);
    expect(result.reason).toContain('目标名称已存在');
    expect(fsMocks.renameFile).not.toHaveBeenCalled();
  });

  it('applies reverse effects in reverse order and marks session as undone', async () => {
    const session = makeRenameSession({
      effects: [
        {
          op: { type: 'rename', path: '/tmp/a.txt', newName: 'b.txt' },
          status: 'ok',
          reverseOp: { type: 'rename', path: '/tmp/b.txt', newName: 'a.txt' },
        },
        {
          op: { type: 'move', path: '/tmp/b.txt', targetDir: '/tmp/archive' },
          status: 'ok',
          reverseOp: { type: 'move', path: '/tmp/archive/b.txt', targetDir: '/tmp' },
        },
      ],
    });
    await saveOperationSession(session, { retentionDays: 90 });

    const existingPaths = new Set(['/tmp/archive/b.txt', '/tmp']);
    fsMocks.getFileInfo.mockImplementation(async (path: string) => {
      if (path === '/tmp') return fileInfo(path, 'folder');
      if (existingPaths.has(path)) return fileInfo(path);
      throw { kind: 'NotFound', message: '路径不存在', path };
    });
    fsMocks.moveFile.mockImplementation(async () => {
      existingPaths.delete('/tmp/archive/b.txt');
      existingPaths.add('/tmp/b.txt');
      return '/tmp/b.txt';
    });
    fsMocks.renameFile.mockResolvedValue('/tmp/a.txt');

    const result = await undoOperationSession(session.id);

    expect(result.status).toBe('undone');
    expect(result.succeeded).toBe(2);
    expect(fsMocks.moveFile).toHaveBeenCalledWith('/tmp/archive/b.txt', '/tmp');
    expect(fsMocks.renameFile).toHaveBeenCalledWith('/tmp/b.txt', 'a.txt');
    expect(fsMocks.moveFile.mock.invocationCallOrder[0]).toBeLessThan(fsMocks.renameFile.mock.invocationCallOrder[0]);
  });

  it('continues after one reverse effect fails and writes undo_partial status', async () => {
    const session = makeRenameSession({
      effects: [
        {
          op: { type: 'rename', path: '/tmp/a.txt', newName: 'b.txt' },
          status: 'ok',
          reverseOp: { type: 'rename', path: '/tmp/b.txt', newName: 'a.txt' },
        },
        {
          op: { type: 'rename', path: '/tmp/c.txt', newName: 'd.txt' },
          status: 'ok',
          reverseOp: { type: 'rename', path: '/tmp/d.txt', newName: 'c.txt' },
        },
      ],
    });
    await saveOperationSession(session, { retentionDays: 90 });

    fsMocks.getFileInfo.mockImplementation(async (path: string) => {
      if (path === '/tmp/b.txt' || path === '/tmp/d.txt') return fileInfo(path);
      if (path === '/tmp') return fileInfo(path, 'folder');
      throw { kind: 'NotFound', message: '路径不存在', path };
    });
    fsMocks.renameFile
      .mockRejectedValueOnce(new Error('permission denied'))
      .mockResolvedValueOnce('/tmp/a.txt');

    const result = await undoOperationSession(session.id);

    expect(result.status).toBe('undo_partial');
    expect(result.succeeded).toBe(1);
    expect(result.failed).toBe(1);
    expect(result.reason).toContain('部分撤销');
    expect(fsMocks.renameFile).toHaveBeenCalledTimes(2);
  });
});
