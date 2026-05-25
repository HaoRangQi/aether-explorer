import { load } from '@tauri-apps/plugin-store';
import type { AIOpSession } from '../types';
import type { AIFileOp } from './ai-service';

const STORE_OPTIONS = { autoSave: true, defaults: {} };
const LEGACY_SESSIONS_KEY = 'sessions';
const INDEX_KEY = 'sessions:index:v2';
const SESSION_KEY_PREFIX = 'session:';
const INDEX_VERSION = 2;
const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;
const MAX_SESSIONS = 2000;

export const AI_OP_HISTORY_DEFAULT_RETENTION_DAYS = 7;
export const AI_OP_HISTORY_MIN_RETENTION_DAYS = 1;
export const AI_OP_HISTORY_MAX_RETENTION_DAYS = 90;

interface AIOpSessionIndexItem {
  id: string;
  timestamp: number;
  instruction: string;
  summary: string;
  opCount: number;
  canRollback: boolean;
  searchText: string;
}

interface AIOpSessionIndex {
  version: number;
  items: AIOpSessionIndexItem[];
}

export interface LoadOpSessionsPageOptions {
  page?: number;
  pageSize?: number;
  query?: string;
  dateFrom?: number | null;
  dateTo?: number | null;
  retentionDays?: number;
}

export interface OpSessionsPageResult {
  items: AIOpSession[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

function loadOpStore() {
  return load('ai-ops.json', STORE_OPTIONS);
}

function normalizePage(page?: number): number {
  if (!Number.isFinite(page)) return 1;
  return Math.max(1, Math.floor(page!));
}

function normalizePageSize(pageSize?: number): number {
  if (!Number.isFinite(pageSize)) return DEFAULT_PAGE_SIZE;
  const n = Math.floor(pageSize!);
  return Math.min(MAX_PAGE_SIZE, Math.max(1, n));
}

function normalizeTimestamp(value?: number | null): number | null {
  if (!Number.isFinite(value)) return null;
  return Math.max(0, Math.floor(value!));
}

function toSessionKey(id: string): string {
  return `${SESSION_KEY_PREFIX}${id}`;
}

function basename(path: string): string {
  const normalized = path.trim();
  if (!normalized) return '';
  const parts = normalized.split('/');
  return parts[parts.length - 1] || normalized;
}

function trimAndLower(value: string): string {
  return value.trim().toLowerCase();
}

function extractSearchTokens(session: AIOpSession): string[] {
  const tokens: string[] = [session.instruction, session.summary];
  for (const entry of session.ops) {
    const op = entry.op;
    switch (op.type) {
      case 'rename':
        tokens.push(basename(op.path), op.newName);
        break;
      case 'mkdir':
        tokens.push(op.name, basename(op.parentDir));
        break;
      case 'move':
        tokens.push(basename(op.path), basename(op.targetDir));
        break;
      case 'trash':
        tokens.push(basename(op.path));
        break;
      case 'compress':
        tokens.push(op.outputName, ...op.paths.map(path => basename(path)));
        break;
    }
  }
  return tokens.filter(Boolean);
}

function buildSearchText(session: AIOpSession): string {
  return extractSearchTokens(session).map(trimAndLower).join(' ');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isValidSession(value: unknown): value is AIOpSession {
  if (!isRecord(value)) return false;
  if (typeof value.id !== 'string' || !value.id.trim()) return false;
  if (typeof value.timestamp !== 'number' || !Number.isFinite(value.timestamp)) return false;
  if (typeof value.instruction !== 'string') return false;
  if (typeof value.summary !== 'string') return false;
  if (!Array.isArray(value.ops)) return false;
  if (typeof value.canRollback !== 'boolean') return false;
  return true;
}

function toIndexItem(session: AIOpSession): AIOpSessionIndexItem {
  return {
    id: session.id,
    timestamp: Math.floor(session.timestamp),
    instruction: session.instruction,
    summary: session.summary,
    opCount: session.ops.length,
    canRollback: session.canRollback,
    searchText: buildSearchText(session),
  };
}

function sanitizeIndexItem(item: unknown): AIOpSessionIndexItem | null {
  if (!isRecord(item)) return null;
  const id = typeof item.id === 'string' ? item.id.trim() : '';
  const timestamp = Number(item.timestamp);
  if (!id || !Number.isFinite(timestamp)) return null;
  return {
    id,
    timestamp: Math.max(0, Math.floor(timestamp)),
    instruction: typeof item.instruction === 'string' ? item.instruction : '',
    summary: typeof item.summary === 'string' ? item.summary : '',
    opCount: Number.isFinite(item.opCount) ? Math.max(0, Math.floor(Number(item.opCount))) : 0,
    canRollback: Boolean(item.canRollback),
    searchText: typeof item.searchText === 'string'
      ? item.searchText.toLowerCase()
      : trimAndLower(`${typeof item.instruction === 'string' ? item.instruction : ''} ${typeof item.summary === 'string' ? item.summary : ''}`),
  };
}

function sanitizeIndexItems(items: unknown[]): AIOpSessionIndexItem[] {
  const map = new Map<string, AIOpSessionIndexItem>();
  for (const raw of items) {
    const item = sanitizeIndexItem(raw);
    if (!item) continue;
    const existing = map.get(item.id);
    if (!existing || item.timestamp > existing.timestamp) {
      map.set(item.id, item);
    }
  }
  return Array.from(map.values()).sort((a, b) => b.timestamp - a.timestamp);
}

function isValidIndex(value: unknown): value is AIOpSessionIndex {
  return isRecord(value) && Number(value.version) === INDEX_VERSION && Array.isArray(value.items);
}

function sortSessionsByNewest(sessions: AIOpSession[]): AIOpSession[] {
  return [...sessions].sort((a, b) => b.timestamp - a.timestamp);
}

function clampByRetention(items: AIOpSessionIndexItem[], retentionDays: number): AIOpSessionIndexItem[] {
  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  return items
    .filter(item => item.timestamp >= cutoff)
    .slice(0, MAX_SESSIONS);
}

async function loadOrMigrateIndex(store: Awaited<ReturnType<typeof loadOpStore>>): Promise<AIOpSessionIndex> {
  const current = await store.get<AIOpSessionIndex>(INDEX_KEY);
  if (isValidIndex(current)) {
    const sanitized = sanitizeIndexItems(current.items);
    if (sanitized.length !== current.items.length) {
      await store.set(INDEX_KEY, { version: INDEX_VERSION, items: sanitized } satisfies AIOpSessionIndex);
    }
    return { version: INDEX_VERSION, items: sanitized };
  }

  const legacy = await store.get<unknown>(LEGACY_SESSIONS_KEY);
  if (!Array.isArray(legacy) || legacy.length === 0) {
    const empty = { version: INDEX_VERSION, items: [] } satisfies AIOpSessionIndex;
    await store.set(INDEX_KEY, empty);
    return empty;
  }

  const migrated = sortSessionsByNewest(legacy.filter(isValidSession));
  const deduped: AIOpSession[] = [];
  const seen = new Set<string>();
  for (const session of migrated) {
    if (seen.has(session.id)) continue;
    seen.add(session.id);
    deduped.push(session);
  }

  await Promise.all(deduped.map(session => store.set(toSessionKey(session.id), session)));
  const nextIndex = {
    version: INDEX_VERSION,
    items: sanitizeIndexItems(deduped.map(toIndexItem)),
  } satisfies AIOpSessionIndex;
  await store.set(INDEX_KEY, nextIndex);
  await store.delete(LEGACY_SESSIONS_KEY);
  return nextIndex;
}

async function writeIndex(store: Awaited<ReturnType<typeof loadOpStore>>, items: AIOpSessionIndexItem[]): Promise<void> {
  await store.set(INDEX_KEY, { version: INDEX_VERSION, items } satisfies AIOpSessionIndex);
}

async function purgeExpiredSessions(
  store: Awaited<ReturnType<typeof loadOpStore>>,
  index: AIOpSessionIndex,
  retentionDays: number,
): Promise<AIOpSessionIndex> {
  const kept = clampByRetention(index.items, retentionDays);
  if (kept.length === index.items.length) return index;

  const removedIds = index.items
    .filter(item => !kept.some(next => next.id === item.id))
    .map(item => item.id);
  await Promise.all(removedIds.map(id => store.delete(toSessionKey(id))));
  await writeIndex(store, kept);
  return { version: INDEX_VERSION, items: kept };
}

export function normalizeOpHistoryRetentionDays(days?: number | null): number {
  if (!Number.isFinite(days)) return AI_OP_HISTORY_DEFAULT_RETENTION_DAYS;
  const n = Math.floor(days!);
  return Math.max(
    AI_OP_HISTORY_MIN_RETENTION_DAYS,
    Math.min(AI_OP_HISTORY_MAX_RETENTION_DAYS, n),
  );
}

export async function pruneOpSessions(retentionDays?: number): Promise<{ removed: number; kept: number }> {
  const normalizedRetention = normalizeOpHistoryRetentionDays(retentionDays);
  const store = await loadOpStore();
  const index = await loadOrMigrateIndex(store);
  const next = await purgeExpiredSessions(store, index, normalizedRetention);
  return {
    removed: index.items.length - next.items.length,
    kept: next.items.length,
  };
}

export async function saveOpSession(
  session: AIOpSession,
  options: { retentionDays?: number } = {},
): Promise<void> {
  const normalizedRetention = normalizeOpHistoryRetentionDays(options.retentionDays);
  const store = await loadOpStore();
  const index = await purgeExpiredSessions(store, await loadOrMigrateIndex(store), normalizedRetention);

  await store.set(toSessionKey(session.id), session);
  const incoming = toIndexItem(session);
  const items = sanitizeIndexItems([incoming, ...index.items]).slice(0, MAX_SESSIONS);

  const removed = index.items
    .filter(item => !items.some(next => next.id === item.id))
    .map(item => item.id);
  if (removed.length > 0) {
    await Promise.all(removed.map(id => store.delete(toSessionKey(id))));
  }

  await writeIndex(store, items);
}

function matchesDate(item: AIOpSessionIndexItem, from: number | null, to: number | null): boolean {
  if (from !== null && item.timestamp < from) return false;
  if (to !== null && item.timestamp > to) return false;
  return true;
}

function matchesQuery(item: AIOpSessionIndexItem, query: string): boolean {
  if (!query) return true;
  const q = query.toLowerCase();
  return item.searchText.includes(q);
}

export async function loadOpSessionsPage(
  options: LoadOpSessionsPageOptions = {},
): Promise<OpSessionsPageResult> {
  const retentionDays = normalizeOpHistoryRetentionDays(options.retentionDays);
  const page = normalizePage(options.page);
  const pageSize = normalizePageSize(options.pageSize);
  const query = (options.query || '').trim().toLowerCase();
  const from = normalizeTimestamp(options.dateFrom);
  const to = normalizeTimestamp(options.dateTo);

  const store = await loadOpStore();
  const index = await purgeExpiredSessions(store, await loadOrMigrateIndex(store), retentionDays);
  const filtered = index.items.filter(item => matchesDate(item, from, to) && matchesQuery(item, query));

  const total = filtered.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(page, totalPages);
  const start = (safePage - 1) * pageSize;
  const pageItems = filtered.slice(start, start + pageSize);

  const sessions = await Promise.all(
    pageItems.map(async item => {
      const raw = await store.get<unknown>(toSessionKey(item.id));
      return isValidSession(raw) ? raw : null;
    }),
  );

  const items = sessions.filter((session): session is AIOpSession => Boolean(session));
  return {
    items,
    page: safePage,
    pageSize,
    total,
    totalPages,
  };
}

export async function loadOpSessions(options: { retentionDays?: number } = {}): Promise<AIOpSession[]> {
  const retentionDays = normalizeOpHistoryRetentionDays(options.retentionDays);
  const page = await loadOpSessionsPage({
    page: 1,
    pageSize: MAX_SESSIONS,
    retentionDays,
  });
  return page.items;
}

export async function deleteOpSession(id: string): Promise<void> {
  const sessionId = id.trim();
  if (!sessionId) return;
  const store = await loadOpStore();
  const index = await loadOrMigrateIndex(store);
  await store.delete(toSessionKey(sessionId));
  const next = index.items.filter(item => item.id !== sessionId);
  await writeIndex(store, next);
}

// 根据原始操作和执行结果推导反向操作
export function buildReverseOp(op: AIFileOp, resultPath?: string): { reverseOp?: AIFileOp; note?: string } {
  switch (op.type) {
    case 'rename': {
      // rename(oldPath, newName) → rename(newPath, originalName)
      const dir = op.path.split('/').slice(0, -1).join('/');
      const originalName = op.path.split('/').pop()!;
      const newPath = resultPath || `${dir}/${op.newName}`;
      return { reverseOp: { type: 'rename', path: newPath, newName: originalName } };
    }
    case 'move': {
      // move(path, targetDir) → move(targetDir/name, originalDir)
      const originalDir = op.path.split('/').slice(0, -1).join('/');
      const name = op.path.split('/').pop()!;
      const movedPath = resultPath || `${op.targetDir}/${name}`;
      return { reverseOp: { type: 'move', path: movedPath, targetDir: originalDir } };
    }
    case 'mkdir': {
      // mkdir(parentDir, name) → trash(parentDir/name)（仅当文件夹为空时安全）
      return { reverseOp: { type: 'trash', path: `${op.parentDir}/${op.name}` }, note: '回滚将把新建的空文件夹移至废纸篓' };
    }
    case 'compress': {
      // compress → trash(outputFile)（原文件未动，删压缩包即可）
      const outputPath = resultPath || op.outputName;
      return { reverseOp: { type: 'trash', path: outputPath }, note: '回滚将把压缩包移至废纸篓，原文件未受影响' };
    }
    case 'trash': {
      // 无法自动还原，需用户手动从废纸篓恢复
      return { note: '此操作无法自动回滚，请手动从废纸篓恢复' };
    }
  }
}
