import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { OperationSession } from '../types';
import {
  loadOperationSessionsPage,
  normalizeOperationHistoryMaxSessions,
  OP_HISTORY_DEFAULT_MAX_SESSIONS,
  OP_HISTORY_HARD_MAX_SESSIONS,
  OP_HISTORY_MAX_UNDO_EFFECTS,
  saveOperationSession,
  updateOperationSessionUndoStatus,
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

vi.mock('@tauri-apps/plugin-store', () => ({
  load: storeState.loadMock,
}));

function makeManualSession(id: string, timestamp: number): OperationSession {
  return {
    id,
    timestamp,
    source: 'manual',
    category: 'rename',
    status: 'success',
    canUndo: true,
    itemCount: 1,
    title: `manual-${id}`,
    summary: `manual summary ${id}`,
    effects: [{
      op: { type: 'rename', path: `/tmp/${id}.txt`, newName: `${id}-renamed.txt` },
      status: 'ok',
      reverseOp: { type: 'rename', path: `/tmp/${id}-renamed.txt`, newName: `${id}.txt` },
    }],
    sourceMeta: {
      manualMeta: {
        action: 'rename',
        primaryPath: `/tmp/${id}.txt`,
      },
    },
  };
}

function makeAISession(id: string, timestamp: number): OperationSession {
  return {
    id,
    timestamp,
    source: 'ai',
    category: 'batch',
    status: 'success',
    canUndo: true,
    itemCount: 1,
    title: `ai-${id}`,
    summary: `ai summary ${id}`,
    effects: [{
      op: { type: 'rename', path: `/tmp/${id}.txt`, newName: `${id}-ai.txt` },
      status: 'ok',
      reverseOp: { type: 'rename', path: `/tmp/${id}-ai.txt`, newName: `${id}.txt` },
    }],
    sourceMeta: {
      aiMeta: {
        instruction: `rename ${id}`,
        batchTotal: 1,
        batchSucceeded: 1,
        batchFailed: 0,
        batchSkipped: 0,
      },
    },
  };
}

beforeEach(() => {
  storeState.reset();
});

describe('normalizeOperationHistoryMaxSessions', () => {
  it('falls back and clamps correctly', () => {
    expect(normalizeOperationHistoryMaxSessions(undefined)).toBe(OP_HISTORY_DEFAULT_MAX_SESSIONS);
    expect(normalizeOperationHistoryMaxSessions(Number.NaN)).toBe(OP_HISTORY_DEFAULT_MAX_SESSIONS);
    expect(normalizeOperationHistoryMaxSessions(0)).toBe(1);
    expect(normalizeOperationHistoryMaxSessions(99999)).toBe(OP_HISTORY_HARD_MAX_SESSIONS);
  });
});

describe('operation-history source filtering', () => {
  it('defaults to all and supports manual/ai filters', async () => {
    const now = Date.now();
    await saveOperationSession(makeManualSession('m1', now - 1000), { retentionDays: 90 });
    await saveOperationSession(makeAISession('a1', now), { retentionDays: 90 });

    const all = await loadOperationSessionsPage({ page: 1, pageSize: 10, retentionDays: 90 });
    expect(all.total).toBe(2);

    const manual = await loadOperationSessionsPage({ page: 1, pageSize: 10, retentionDays: 90, source: 'manual' });
    expect(manual.total).toBe(1);
    expect(manual.items[0].source).toBe('manual');

    const ai = await loadOperationSessionsPage({ page: 1, pageSize: 10, retentionDays: 90, source: 'ai' });
    expect(ai.total).toBe(1);
    expect(ai.items[0].source).toBe('ai');
  });
});

describe('operation-history undo boundaries', () => {
  it('marks very large sessions as non-undoable', async () => {
    const now = Date.now();
    const hugeEffects = Array.from({ length: OP_HISTORY_MAX_UNDO_EFFECTS + 1 }).map((_, idx) => ({
      op: { type: 'rename' as const, path: `/tmp/f-${idx}.txt`, newName: `g-${idx}.txt` },
      status: 'ok' as const,
      reverseOp: { type: 'rename' as const, path: `/tmp/g-${idx}.txt`, newName: `f-${idx}.txt` },
    }));

    const saved = await saveOperationSession({
      ...makeManualSession('huge', now),
      effects: hugeEffects,
      itemCount: hugeEffects.length,
    }, { retentionDays: 90 });

    expect(saved.canUndo).toBe(false);
    expect(saved.reasonNotUndoable).toContain(String(OP_HISTORY_MAX_UNDO_EFFECTS));
  });

  it('writes back undo status into original session', async () => {
    const now = Date.now();
    await saveOperationSession(makeManualSession('undo-1', now), { retentionDays: 90 });

    const updated = await updateOperationSessionUndoStatus('undo-1', 'undo_partial');
    expect(updated?.status).toBe('undo_partial');
    expect(updated?.canUndo).toBe(false);
    expect(updated?.reasonNotUndoable).toBe('部分撤销');
  });
});
