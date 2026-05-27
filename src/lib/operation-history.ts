import { load } from '@tauri-apps/plugin-store';
import type {
  AIExecutedOp,
  AIOpSession,
  OperationCategory,
  OperationEffect,
  OperationFileOp,
  OperationHistoryFilter,
  OperationSession,
  OperationSource,
  OperationStatus,
} from '../types';
import type { AIFileOp } from './ai-service';

const STORE_OPTIONS = { autoSave: true, defaults: {} };
const STORE_FILE = 'operation-history.json';
const LEGACY_STORE_FILE = 'ai-ops.json';
const LEGACY_SESSIONS_KEY = 'sessions';
const LEGACY_INDEX_KEY = 'sessions:index:v2';
const LEGACY_SESSION_KEY_PREFIX = 'session:';
const INDEX_KEY = 'sessions:index:v1';
const SESSION_KEY_PREFIX = 'session:';
const INDEX_VERSION = 1;
const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

export const OP_HISTORY_DEFAULT_RETENTION_DAYS = 7;
export const OP_HISTORY_MIN_RETENTION_DAYS = 1;
export const OP_HISTORY_MAX_RETENTION_DAYS = 90;
export const OP_HISTORY_DEFAULT_MAX_SESSIONS = 500;
export const OP_HISTORY_HARD_MAX_SESSIONS = 1000;
export const OP_HISTORY_MAX_UNDO_EFFECTS = 2000;

// 兼容旧命名，避免设置与存量逻辑瞬时失效。
export const AI_OP_HISTORY_DEFAULT_RETENTION_DAYS = OP_HISTORY_DEFAULT_RETENTION_DAYS;
export const AI_OP_HISTORY_MIN_RETENTION_DAYS = OP_HISTORY_MIN_RETENTION_DAYS;
export const AI_OP_HISTORY_MAX_RETENTION_DAYS = OP_HISTORY_MAX_RETENTION_DAYS;

interface OperationSessionIndexItem {
  id: string;
  timestamp: number;
  source: OperationSource;
  category: OperationCategory;
  status: OperationStatus;
  canUndo: boolean;
  title: string;
  summary: string;
  itemCount: number;
  searchText: string;
}

interface OperationSessionIndex {
  version: number;
  items: OperationSessionIndexItem[];
}

interface LegacySessionIndex {
  version: number;
  items: Array<{ id: string; timestamp: number }>;
}

export interface LoadOperationSessionsPageOptions {
  page?: number;
  pageSize?: number;
  query?: string;
  dateFrom?: number | null;
  dateTo?: number | null;
  source?: OperationHistoryFilter | OperationSource | null;
  retentionDays?: number;
  maxSessions?: number;
}

export interface OperationSessionsPageResult {
  items: OperationSession[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface SaveOperationSessionOptions {
  retentionDays?: number;
  maxSessions?: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function loadOperationStore() {
  return load(STORE_FILE, STORE_OPTIONS);
}

function loadLegacyStore() {
  return load(LEGACY_STORE_FILE, STORE_OPTIONS);
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

function normalizeSourceFilter(source?: OperationHistoryFilter | OperationSource | null): OperationHistoryFilter {
  if (source === 'manual' || source === 'ai') return source;
  return 'all';
}

export function normalizeOperationHistoryMaxSessions(maxSessions?: number | null): number {
  if (!Number.isFinite(maxSessions)) return OP_HISTORY_DEFAULT_MAX_SESSIONS;
  const n = Math.floor(maxSessions!);
  return Math.max(1, Math.min(OP_HISTORY_HARD_MAX_SESSIONS, n));
}

export function normalizeOpHistoryRetentionDays(days?: number | null): number {
  if (!Number.isFinite(days)) return OP_HISTORY_DEFAULT_RETENTION_DAYS;
  const n = Math.floor(days!);
  return Math.max(OP_HISTORY_MIN_RETENTION_DAYS, Math.min(OP_HISTORY_MAX_RETENTION_DAYS, n));
}

function toSessionKey(id: string): string {
  return `${SESSION_KEY_PREFIX}${id}`;
}

function toLegacySessionKey(id: string): string {
  return `${LEGACY_SESSION_KEY_PREFIX}${id}`;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isValidOperationFileOp(op: unknown): op is OperationFileOp {
  if (!isRecord(op) || typeof op.type !== 'string') return false;
  switch (op.type) {
    case 'rename':
      return typeof op.path === 'string' && typeof op.newName === 'string';
    case 'mkdir':
      return typeof op.parentDir === 'string' && typeof op.name === 'string';
    case 'create_file':
      return typeof op.parentDir === 'string' && typeof op.name === 'string';
    case 'move':
      return typeof op.path === 'string' && typeof op.targetDir === 'string';
    case 'copy':
      return typeof op.path === 'string' && typeof op.targetDir === 'string';
    case 'trash':
      return typeof op.path === 'string';
    case 'compress':
      return Array.isArray(op.paths) && op.paths.every(path => typeof path === 'string') && typeof op.outputName === 'string';
    default:
      return false;
  }
}

function isValidOperationEffect(effect: unknown): effect is OperationEffect {
  if (!isRecord(effect)) return false;
  if (!isValidOperationFileOp(effect.op)) return false;
  if (effect.status !== 'ok' && effect.status !== 'fail' && effect.status !== 'skipped') return false;
  if (effect.reverseOp !== undefined && !isValidOperationFileOp(effect.reverseOp)) return false;
  if (effect.note !== undefined && typeof effect.note !== 'string') return false;
  return true;
}

function isValidOperationCategory(category: unknown): category is OperationCategory {
  return [
    'rename',
    'create-file',
    'create-folder',
    'copy',
    'move',
    'trash',
    'compress',
    'decompress',
    'batch',
    'other',
  ].includes(String(category));
}

function isValidOperationStatus(status: unknown): status is OperationStatus {
  return [
    'success',
    'partial',
    'failed',
    'undone',
    'undo_partial',
    'undo_failed',
  ].includes(String(status));
}

function isValidSourceMeta(value: unknown, source: OperationSource): boolean {
  if (!isRecord(value)) return false;
  if (source === 'ai') {
    if (!isRecord(value.aiMeta)) return false;
    return typeof value.aiMeta.instruction === 'string';
  }
  if (!isRecord(value.manualMeta)) return false;
  return typeof value.manualMeta.action === 'string';
}

function isValidOperationSession(value: unknown): value is OperationSession {
  if (!isRecord(value)) return false;
  if (typeof value.id !== 'string' || !value.id.trim()) return false;
  if (typeof value.timestamp !== 'number' || !Number.isFinite(value.timestamp)) return false;
  if (value.source !== 'manual' && value.source !== 'ai') return false;
  if (!isValidOperationCategory(value.category)) return false;
  if (!isValidOperationStatus(value.status)) return false;
  if (typeof value.canUndo !== 'boolean') return false;
  if (value.reasonNotUndoable !== undefined && typeof value.reasonNotUndoable !== 'string') return false;
  if (typeof value.itemCount !== 'number' || !Number.isFinite(value.itemCount)) return false;
  if (typeof value.title !== 'string') return false;
  if (typeof value.summary !== 'string') return false;
  if (!Array.isArray(value.effects) || !value.effects.every(isValidOperationEffect)) return false;
  if (!isValidSourceMeta(value.sourceMeta, value.source)) return false;
  return true;
}

function isValidLegacyExecutedOp(value: unknown): value is AIExecutedOp {
  if (!isRecord(value)) return false;
  if (!isValidOperationFileOp(value.op)) return false;
  if (value.status !== 'ok' && value.status !== 'fail' && value.status !== 'skipped') return false;
  if (value.reverseOp !== undefined && !isValidOperationFileOp(value.reverseOp)) return false;
  if (value.note !== undefined && typeof value.note !== 'string') return false;
  return true;
}

function isValidLegacySession(value: unknown): value is AIOpSession {
  if (!isRecord(value)) return false;
  if (typeof value.id !== 'string' || !value.id.trim()) return false;
  if (typeof value.timestamp !== 'number' || !Number.isFinite(value.timestamp)) return false;
  if (typeof value.instruction !== 'string') return false;
  if (typeof value.summary !== 'string') return false;
  if (!Array.isArray(value.ops) || !value.ops.every(isValidLegacyExecutedOp)) return false;
  if (typeof value.canRollback !== 'boolean') return false;
  return true;
}

function deriveStatusFromEffects(effects: OperationEffect[]): OperationStatus {
  const okCount = effects.filter(effect => effect.status === 'ok').length;
  const failCount = effects.filter(effect => effect.status === 'fail').length;
  if (failCount > 0 && okCount > 0) return 'partial';
  if (failCount > 0 && okCount === 0) return 'failed';
  if (okCount > 0) return 'success';
  return 'partial';
}

function deriveCategoryFromEffects(effects: OperationEffect[]): OperationCategory {
  if (effects.length === 0) return 'other';
  const uniqueTypes = new Set(effects.map(effect => effect.op.type));
  if (uniqueTypes.size !== 1) return 'batch';
  const opType = effects[0].op.type;
  switch (opType) {
    case 'rename':
      return 'rename';
    case 'mkdir':
      return 'create-folder';
    case 'create_file':
      return 'create-file';
    case 'copy':
      return 'copy';
    case 'move':
      return 'move';
    case 'trash':
      return 'trash';
    case 'compress':
      return 'compress';
    default:
      return 'other';
  }
}

function operationOpToTokens(op: OperationFileOp): string[] {
  switch (op.type) {
    case 'rename':
      return [basename(op.path), op.newName];
    case 'mkdir':
    case 'create_file':
      return [op.name, basename(op.parentDir)];
    case 'move':
    case 'copy':
      return [basename(op.path), basename(op.targetDir)];
    case 'trash':
      return [basename(op.path)];
    case 'compress':
      return [op.outputName, ...op.paths.map(path => basename(path))];
  }
}

function extractSearchTokens(session: OperationSession): string[] {
  const baseTokens: string[] = [
    session.title,
    session.summary,
  ];
  if (session.source === 'ai') {
    baseTokens.push(session.sourceMeta.aiMeta.instruction);
    if (session.sourceMeta.aiMeta.model) baseTokens.push(session.sourceMeta.aiMeta.model);
  } else {
    if (session.sourceMeta.manualMeta.primaryPath) baseTokens.push(basename(session.sourceMeta.manualMeta.primaryPath));
    if (session.sourceMeta.manualMeta.targetPath) baseTokens.push(basename(session.sourceMeta.manualMeta.targetPath));
  }
  for (const effect of session.effects) {
    baseTokens.push(...operationOpToTokens(effect.op));
  }
  return baseTokens.filter(Boolean);
}

function buildSearchText(session: OperationSession): string {
  return extractSearchTokens(session).map(trimAndLower).join(' ');
}

function toIndexItem(session: OperationSession): OperationSessionIndexItem {
  return {
    id: session.id,
    timestamp: Math.floor(session.timestamp),
    source: session.source,
    category: session.category,
    status: session.status,
    canUndo: session.canUndo,
    title: session.title,
    summary: session.summary,
    itemCount: session.itemCount,
    searchText: buildSearchText(session),
  };
}

function sanitizeIndexItem(item: unknown): OperationSessionIndexItem | null {
  if (!isRecord(item)) return null;
  const id = typeof item.id === 'string' ? item.id.trim() : '';
  const timestamp = Number(item.timestamp);
  if (!id || !Number.isFinite(timestamp)) return null;
  const source: OperationSource = item.source === 'manual' ? 'manual' : 'ai';
  const category = isValidOperationCategory(item.category) ? item.category : 'other';
  const status = isValidOperationStatus(item.status) ? item.status : 'partial';
  const title = typeof item.title === 'string' ? item.title : '';
  const summary = typeof item.summary === 'string' ? item.summary : '';
  const searchText = typeof item.searchText === 'string'
    ? item.searchText.toLowerCase()
    : trimAndLower(`${title} ${summary}`);
  return {
    id,
    timestamp: Math.max(0, Math.floor(timestamp)),
    source,
    category,
    status,
    canUndo: Boolean(item.canUndo),
    title,
    summary,
    itemCount: Number.isFinite(item.itemCount) ? Math.max(0, Math.floor(Number(item.itemCount))) : 0,
    searchText,
  };
}

function sanitizeIndexItems(items: unknown[]): OperationSessionIndexItem[] {
  const map = new Map<string, OperationSessionIndexItem>();
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

function isValidIndex(value: unknown): value is OperationSessionIndex {
  return isRecord(value) && Number(value.version) === INDEX_VERSION && Array.isArray(value.items);
}

function isValidLegacyIndex(value: unknown): value is LegacySessionIndex {
  if (!isRecord(value)) return false;
  if (!Array.isArray(value.items)) return false;
  return value.items.every(item => isRecord(item) && typeof item.id === 'string');
}

function clampByRetention(
  items: OperationSessionIndexItem[],
  retentionDays: number,
  maxSessions: number,
): OperationSessionIndexItem[] {
  const cutoff = Date.now() - retentionDays * DAY_MS;
  const limit = Math.min(OP_HISTORY_HARD_MAX_SESSIONS, maxSessions);
  return items
    .filter(item => item.timestamp >= cutoff)
    .slice(0, limit);
}

function mapLegacyOp(op: AIFileOp): OperationFileOp {
  switch (op.type) {
    case 'rename':
      return { type: 'rename', path: op.path, newName: op.newName };
    case 'mkdir':
      return { type: 'mkdir', parentDir: op.parentDir, name: op.name };
    case 'move':
      return { type: 'move', path: op.path, targetDir: op.targetDir };
    case 'trash':
      return { type: 'trash', path: op.path };
    case 'compress':
      return { type: 'compress', paths: op.paths, outputName: op.outputName };
  }
}

function mapLegacyEffect(effect: AIExecutedOp): OperationEffect {
  return {
    op: mapLegacyOp(effect.op as AIFileOp),
    status: effect.status,
    reverseOp: effect.reverseOp ? mapLegacyOp(effect.reverseOp as AIFileOp) : undefined,
    note: effect.note,
  };
}

function ensureUndoability(session: OperationSession): OperationSession {
  const effects = Array.isArray(session.effects) ? session.effects : [];
  const canReverse = effects.some(effect => effect.status === 'ok' && Boolean(effect.reverseOp));
  let canUndo = Boolean(session.canUndo);
  let reason = session.reasonNotUndoable;

  if (effects.length > OP_HISTORY_MAX_UNDO_EFFECTS) {
    canUndo = false;
    reason = `超过 ${OP_HISTORY_MAX_UNDO_EFFECTS} 条明细，仅记录不可撤销`;
  } else if (canUndo && !canReverse) {
    canUndo = false;
    reason = reason || '该操作没有可安全回退的步骤';
  } else if (!canUndo && !reason) {
    reason = '该操作不可安全撤销';
  }

  return {
    ...session,
    timestamp: Math.floor(session.timestamp),
    itemCount: Math.max(0, Math.floor(session.itemCount || effects.length)),
    status: isValidOperationStatus(session.status) ? session.status : deriveStatusFromEffects(effects),
    canUndo,
    reasonNotUndoable: canUndo ? undefined : reason,
  };
}

function toOperationSessionFromLegacy(legacy: AIOpSession): OperationSession {
  const effects = legacy.ops.map(mapLegacyEffect);
  const okCount = effects.filter(effect => effect.status === 'ok').length;
  const failCount = effects.filter(effect => effect.status === 'fail').length;
  const skippedCount = effects.filter(effect => effect.status === 'skipped').length;
  const raw: OperationSession = {
    id: legacy.id,
    timestamp: legacy.timestamp,
    source: 'ai',
    category: deriveCategoryFromEffects(effects),
    status: deriveStatusFromEffects(effects),
    canUndo: legacy.canRollback,
    itemCount: effects.length,
    title: legacy.summary || legacy.instruction || 'AI 批量操作',
    summary: legacy.summary || legacy.instruction || '',
    effects,
    sourceMeta: {
      aiMeta: {
        instruction: legacy.instruction,
        batchTotal: effects.length,
        batchSucceeded: okCount,
        batchFailed: failCount,
        batchSkipped: skippedCount,
      },
    },
  };
  return ensureUndoability(raw);
}

function sanitizeSession(session: OperationSession): OperationSession {
  const baseTitle = session.title.trim() || session.summary.trim() || '文件操作';
  const normalized: OperationSession = {
    ...session,
    id: session.id.trim(),
    source: session.source === 'manual' ? 'manual' : 'ai',
    category: isValidOperationCategory(session.category) ? session.category : deriveCategoryFromEffects(session.effects),
    title: baseTitle,
    summary: session.summary ?? '',
    effects: session.effects.filter(isValidOperationEffect),
  };
  return ensureUndoability(normalized);
}

async function readLegacySessions(): Promise<AIOpSession[]> {
  try {
    const store = await loadLegacyStore();
    const index = await store.get<unknown>(LEGACY_INDEX_KEY);
    if (isValidLegacyIndex(index) && index.items.length > 0) {
      const sessions = await Promise.all(
        index.items.map(async item => {
          const raw = await store.get<unknown>(toLegacySessionKey(item.id));
          return isValidLegacySession(raw) ? raw : null;
        }),
      );
      return sessions.filter((session): session is AIOpSession => Boolean(session));
    }
    const legacyArray = await store.get<unknown>(LEGACY_SESSIONS_KEY);
    if (!Array.isArray(legacyArray)) return [];
    return legacyArray.filter(isValidLegacySession);
  } catch {
    return [];
  }
}

async function loadOrMigrateIndex(store: Awaited<ReturnType<typeof loadOperationStore>>): Promise<OperationSessionIndex> {
  const current = await store.get<OperationSessionIndex>(INDEX_KEY);
  if (isValidIndex(current)) {
    const sanitized = sanitizeIndexItems(current.items);
    if (sanitized.length !== current.items.length) {
      await store.set(INDEX_KEY, { version: INDEX_VERSION, items: sanitized } satisfies OperationSessionIndex);
    }
    return { version: INDEX_VERSION, items: sanitized };
  }

  const legacySessions = await readLegacySessions();
  if (legacySessions.length === 0) {
    const empty = { version: INDEX_VERSION, items: [] } satisfies OperationSessionIndex;
    await store.set(INDEX_KEY, empty);
    return empty;
  }

  const converted = legacySessions
    .map(toOperationSessionFromLegacy)
    .sort((a, b) => b.timestamp - a.timestamp);

  const deduped: OperationSession[] = [];
  const seen = new Set<string>();
  for (const session of converted) {
    if (!session.id || seen.has(session.id)) continue;
    seen.add(session.id);
    deduped.push(session);
  }

  await Promise.all(deduped.map(session => store.set(toSessionKey(session.id), session)));
  const nextIndex = {
    version: INDEX_VERSION,
    items: sanitizeIndexItems(deduped.map(toIndexItem)),
  } satisfies OperationSessionIndex;
  await store.set(INDEX_KEY, nextIndex);
  return nextIndex;
}

async function writeIndex(
  store: Awaited<ReturnType<typeof loadOperationStore>>,
  items: OperationSessionIndexItem[],
): Promise<void> {
  await store.set(INDEX_KEY, { version: INDEX_VERSION, items } satisfies OperationSessionIndex);
}

async function purgeExpiredSessions(
  store: Awaited<ReturnType<typeof loadOperationStore>>,
  index: OperationSessionIndex,
  retentionDays: number,
  maxSessions: number,
): Promise<OperationSessionIndex> {
  const kept = clampByRetention(index.items, retentionDays, maxSessions);
  if (kept.length === index.items.length) return index;

  const removedIds = index.items
    .filter(item => !kept.some(next => next.id === item.id))
    .map(item => item.id);
  await Promise.all(removedIds.map(id => store.delete(toSessionKey(id))));
  await writeIndex(store, kept);
  return { version: INDEX_VERSION, items: kept };
}

function matchesDate(item: OperationSessionIndexItem, from: number | null, to: number | null): boolean {
  if (from !== null && item.timestamp < from) return false;
  if (to !== null && item.timestamp > to) return false;
  return true;
}

function matchesQuery(item: OperationSessionIndexItem, query: string): boolean {
  if (!query) return true;
  return item.searchText.includes(query.toLowerCase());
}

function matchesSource(item: OperationSessionIndexItem, source: OperationHistoryFilter): boolean {
  if (source === 'all') return true;
  return item.source === source;
}

export async function pruneOperationSessions(options: SaveOperationSessionOptions = {}): Promise<{ removed: number; kept: number }> {
  const retentionDays = normalizeOpHistoryRetentionDays(options.retentionDays);
  const maxSessions = normalizeOperationHistoryMaxSessions(options.maxSessions);
  const store = await loadOperationStore();
  const index = await loadOrMigrateIndex(store);
  const next = await purgeExpiredSessions(store, index, retentionDays, maxSessions);
  return {
    removed: index.items.length - next.items.length,
    kept: next.items.length,
  };
}

export async function saveOperationSession(
  session: OperationSession,
  options: SaveOperationSessionOptions = {},
): Promise<OperationSession> {
  const retentionDays = normalizeOpHistoryRetentionDays(options.retentionDays);
  const maxSessions = normalizeOperationHistoryMaxSessions(options.maxSessions);
  const store = await loadOperationStore();
  const index = await purgeExpiredSessions(store, await loadOrMigrateIndex(store), retentionDays, maxSessions);
  const sanitizedSession = sanitizeSession(session);

  await store.set(toSessionKey(sanitizedSession.id), sanitizedSession);
  const incoming = toIndexItem(sanitizedSession);
  const items = sanitizeIndexItems([incoming, ...index.items]).slice(0, maxSessions);

  const removed = index.items
    .filter(item => !items.some(next => next.id === item.id))
    .map(item => item.id);
  if (removed.length > 0) {
    await Promise.all(removed.map(id => store.delete(toSessionKey(id))));
  }

  await writeIndex(store, items);
  return sanitizedSession;
}

export async function loadOperationSessionsPage(
  options: LoadOperationSessionsPageOptions = {},
): Promise<OperationSessionsPageResult> {
  const retentionDays = normalizeOpHistoryRetentionDays(options.retentionDays);
  const maxSessions = normalizeOperationHistoryMaxSessions(options.maxSessions);
  const page = normalizePage(options.page);
  const pageSize = normalizePageSize(options.pageSize);
  const query = (options.query || '').trim().toLowerCase();
  const from = normalizeTimestamp(options.dateFrom);
  const to = normalizeTimestamp(options.dateTo);
  const source = normalizeSourceFilter(options.source);

  const store = await loadOperationStore();
  const index = await purgeExpiredSessions(store, await loadOrMigrateIndex(store), retentionDays, maxSessions);
  const filtered = index.items.filter(
    item => matchesDate(item, from, to) && matchesQuery(item, query) && matchesSource(item, source),
  );

  const total = filtered.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(page, totalPages);
  const start = (safePage - 1) * pageSize;
  const pageItems = filtered.slice(start, start + pageSize);

  const sessions = await Promise.all(
    pageItems.map(async item => {
      const raw = await store.get<unknown>(toSessionKey(item.id));
      return isValidOperationSession(raw) ? sanitizeSession(raw) : null;
    }),
  );

  const items = sessions.filter((session): session is OperationSession => Boolean(session));
  return {
    items,
    page: safePage,
    pageSize,
    total,
    totalPages,
  };
}

export async function loadOperationSessions(
  options: SaveOperationSessionOptions & { source?: OperationHistoryFilter | OperationSource | null } = {},
): Promise<OperationSession[]> {
  const maxSessions = normalizeOperationHistoryMaxSessions(options.maxSessions);
  const page = await loadOperationSessionsPage({
    page: 1,
    pageSize: maxSessions,
    retentionDays: options.retentionDays,
    maxSessions,
    source: options.source,
  });
  return page.items;
}

export async function getOperationSession(id: string): Promise<OperationSession | null> {
  const sessionId = id.trim();
  if (!sessionId) return null;
  const store = await loadOperationStore();
  const raw = await store.get<unknown>(toSessionKey(sessionId));
  if (!isValidOperationSession(raw)) return null;
  return sanitizeSession(raw);
}

export async function deleteOperationSession(id: string): Promise<void> {
  const sessionId = id.trim();
  if (!sessionId) return;
  const store = await loadOperationStore();
  const index = await loadOrMigrateIndex(store);
  await store.delete(toSessionKey(sessionId));
  const next = index.items.filter(item => item.id !== sessionId);
  await writeIndex(store, next);
}

const UNDO_REASON_BY_STATUS: Record<'undone' | 'undo_partial' | 'undo_failed', string> = {
  undone: '已撤销',
  undo_partial: '部分撤销',
  undo_failed: '撤销失败',
};

export async function updateOperationSessionUndoStatus(
  id: string,
  status: 'undone' | 'undo_partial' | 'undo_failed',
  reasonOverride?: string,
): Promise<OperationSession | null> {
  const sessionId = id.trim();
  if (!sessionId) return null;
  const store = await loadOperationStore();
  const index = await loadOrMigrateIndex(store);
  const raw = await store.get<unknown>(toSessionKey(sessionId));
  if (!isValidOperationSession(raw)) return null;

  const reason = (reasonOverride || '').trim() || UNDO_REASON_BY_STATUS[status];
  const nextSession = sanitizeSession({
    ...raw,
    status,
    canUndo: false,
    reasonNotUndoable: reason,
  });
  await store.set(toSessionKey(sessionId), nextSession);

  const nextItems = index.items.map(item => (
    item.id === sessionId
      ? {
        ...item,
        status,
        canUndo: false,
        searchText: buildSearchText(nextSession),
      }
      : item
  ));
  await writeIndex(store, nextItems);
  return nextSession;
}

export function buildReverseOp(op: AIFileOp, resultPath?: string): { reverseOp?: OperationFileOp; note?: string } {
  switch (op.type) {
    case 'rename': {
      const dir = op.path.split('/').slice(0, -1).join('/');
      const originalName = op.path.split('/').pop()!;
      const newPath = resultPath || `${dir}/${op.newName}`;
      return {
        reverseOp: { type: 'rename', path: newPath, newName: originalName },
      };
    }
    case 'move': {
      const originalDir = op.path.split('/').slice(0, -1).join('/');
      const name = op.path.split('/').pop()!;
      const movedPath = resultPath || `${op.targetDir}/${name}`;
      return {
        reverseOp: { type: 'move', path: movedPath, targetDir: originalDir },
      };
    }
    case 'mkdir':
      return {
        reverseOp: { type: 'trash', path: `${op.parentDir}/${op.name}` },
        note: '回滚将把新建的空文件夹移至废纸篓',
      };
    case 'trash':
      return {
        note: '此操作无法自动回滚，请手动从废纸篓恢复',
      };
    case 'compress': {
      const outputPath = resultPath || op.outputName;
      return {
        reverseOp: { type: 'trash', path: outputPath },
        note: '回滚将把压缩包移至废纸篓，原文件未受影响',
      };
    }
  }
}
