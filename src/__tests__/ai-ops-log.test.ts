import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AIOpSession } from '../types';
import {
  AI_OP_HISTORY_DEFAULT_RETENTION_DAYS,
  AI_OP_HISTORY_MAX_RETENTION_DAYS,
  AI_OP_HISTORY_MIN_RETENTION_DAYS,
  deleteOpSession,
  loadOpSessionsPage,
  normalizeOpHistoryRetentionDays,
  pruneOpSessions,
  saveOpSession,
} from '../lib/ai-ops-log';

const DAY_MS = 24 * 60 * 60 * 1000;
const LEGACY_SESSIONS_KEY = 'sessions';
const INDEX_KEY = 'sessions:index:v2';
const SESSION_KEY_PREFIX = 'session:';

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
  const loadMock = vi.fn(async (..._args: unknown[]) => store);

  return {
    data,
    store,
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

function makeSession(params: {
  id: string;
  timestamp: number;
  instruction?: string;
  summary?: string;
  filePath?: string;
  newName?: string;
}): AIOpSession {
  const {
    id,
    timestamp,
    instruction = `instruction ${id}`,
    summary = `summary ${id}`,
    filePath = `/docs/${id}.txt`,
    newName = `${id}-renamed.txt`,
  } = params;

  return {
    id,
    timestamp,
    instruction,
    summary,
    ops: [
      {
        op: { type: 'rename', path: filePath, newName },
        status: 'ok',
        reverseOp: { type: 'rename', path: `/docs/${newName}`, newName: `${id}.txt` },
      },
    ],
    canRollback: true,
  };
}

function getSessionKey(id: string): string {
  return `${SESSION_KEY_PREFIX}${id}`;
}

beforeEach(() => {
  storeState.reset();
});

describe('normalizeOpHistoryRetentionDays', () => {
  it('falls back to defaults and clamps range', () => {
    expect(normalizeOpHistoryRetentionDays(undefined)).toBe(AI_OP_HISTORY_DEFAULT_RETENTION_DAYS);
    expect(normalizeOpHistoryRetentionDays(null)).toBe(AI_OP_HISTORY_DEFAULT_RETENTION_DAYS);
    expect(normalizeOpHistoryRetentionDays(Number.NaN)).toBe(AI_OP_HISTORY_DEFAULT_RETENTION_DAYS);
    expect(normalizeOpHistoryRetentionDays(0)).toBe(AI_OP_HISTORY_MIN_RETENTION_DAYS);
    expect(normalizeOpHistoryRetentionDays(1.9)).toBe(1);
    expect(normalizeOpHistoryRetentionDays(999)).toBe(AI_OP_HISTORY_MAX_RETENTION_DAYS);
  });
});

describe('ai-ops-log migration and pagination', () => {
  it('migrates legacy sessions into index + per-session keys with dedupe', async () => {
    const now = Date.now();
    const older = makeSession({ id: 'dup', timestamp: now - 6_000, instruction: 'older dup' });
    const newer = makeSession({ id: 'dup', timestamp: now - 2_000, instruction: 'newer dup' });
    const recent = makeSession({ id: 'recent', timestamp: now - 1_000, instruction: 'recent one' });

    storeState.data.set(LEGACY_SESSIONS_KEY, [
      older,
      { invalid: true },
      recent,
      newer,
    ]);

    const page = await loadOpSessionsPage({
      page: 1,
      pageSize: 10,
      retentionDays: 90,
    });

    expect(page.total).toBe(2);
    expect(page.items.map(item => item.id)).toEqual(['recent', 'dup']);
    expect(page.items.find(item => item.id === 'dup')?.instruction).toBe('newer dup');

    expect(storeState.data.has(LEGACY_SESSIONS_KEY)).toBe(false);
    expect(storeState.data.has(getSessionKey('dup'))).toBe(true);
    expect(storeState.data.has(getSessionKey('recent'))).toBe(true);

    const index = storeState.data.get(INDEX_KEY) as { version: number; items: Array<{ id: string }> };
    expect(index.version).toBe(2);
    expect(index.items.map(item => item.id)).toEqual(['recent', 'dup']);
  });

  it('supports true pagination, filename search, and date filtering', async () => {
    const now = Date.now();
    const s1 = makeSession({
      id: 's1',
      timestamp: now - 5 * DAY_MS,
      instruction: 'rename alpha',
      filePath: '/docs/alpha.txt',
      newName: 'alpha-final.txt',
    });
    const s2 = makeSession({
      id: 's2',
      timestamp: now - 3 * DAY_MS,
      instruction: 'rename budget',
      filePath: '/docs/budget.xlsx',
      newName: 'budget-q2.xlsx',
    });
    const s3 = makeSession({
      id: 's3',
      timestamp: now - DAY_MS,
      instruction: 'rename notes',
      filePath: '/docs/notes.md',
      newName: 'meeting-notes.md',
    });

    await saveOpSession(s1, { retentionDays: 90 });
    await saveOpSession(s2, { retentionDays: 90 });
    await saveOpSession(s3, { retentionDays: 90 });

    const page1 = await loadOpSessionsPage({ page: 1, pageSize: 2, retentionDays: 90 });
    expect(page1.total).toBe(3);
    expect(page1.totalPages).toBe(2);
    expect(page1.items.map(item => item.id)).toEqual(['s3', 's2']);

    const page2 = await loadOpSessionsPage({ page: 2, pageSize: 2, retentionDays: 90 });
    expect(page2.items.map(item => item.id)).toEqual(['s1']);

    const searched = await loadOpSessionsPage({
      query: 'ALPHA-final',
      page: 1,
      pageSize: 10,
      retentionDays: 90,
    });
    expect(searched.total).toBe(1);
    expect(searched.items[0].id).toBe('s1');

    const dateFiltered = await loadOpSessionsPage({
      dateFrom: now - 2 * DAY_MS,
      dateTo: now,
      page: 1,
      pageSize: 10,
      retentionDays: 90,
    });
    expect(dateFiltered.items.map(item => item.id)).toEqual(['s3']);
  });
});

describe('ai-ops-log retention and delete consistency', () => {
  it('prunes expired sessions by retention and keeps index/session keys consistent', async () => {
    const now = Date.now();
    const oldSession = makeSession({ id: 'old', timestamp: now - 10 * DAY_MS });
    const freshSession = makeSession({ id: 'fresh', timestamp: now - DAY_MS });

    await saveOpSession(oldSession, { retentionDays: 90 });
    await saveOpSession(freshSession, { retentionDays: 90 });

    const pruned = await pruneOpSessions(7);
    expect(pruned.removed).toBe(1);
    expect(pruned.kept).toBe(1);
    expect(storeState.data.has(getSessionKey('old'))).toBe(false);
    expect(storeState.data.has(getSessionKey('fresh'))).toBe(true);

    const page = await loadOpSessionsPage({ page: 1, pageSize: 10, retentionDays: 90 });
    expect(page.total).toBe(1);
    expect(page.items[0].id).toBe('fresh');
  });

  it('deletes a session from both index and session storage', async () => {
    const now = Date.now();
    const session = makeSession({ id: 'to-delete', timestamp: now - DAY_MS });
    await saveOpSession(session, { retentionDays: 90 });

    expect(storeState.data.has(getSessionKey('to-delete'))).toBe(true);

    await deleteOpSession('to-delete');

    expect(storeState.data.has(getSessionKey('to-delete'))).toBe(false);
    const page = await loadOpSessionsPage({ page: 1, pageSize: 10, retentionDays: 90 });
    expect(page.total).toBe(0);
    expect(page.items).toEqual([]);
  });
});
