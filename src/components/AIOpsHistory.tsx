import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  History,
  X,
  RotateCcw,
  Trash2,
  ChevronDown,
  ChevronRight,
  AlertCircle,
  Check,
  Loader2,
  Pencil,
  FolderPlus,
  Move,
  Archive,
  Search,
  Calendar,
} from 'lucide-react';
import { AIOpSession } from '../types';
import {
  AI_OP_HISTORY_DEFAULT_RETENTION_DAYS,
  deleteOpSession,
  loadOpSessionsPage,
} from '../lib/ai-ops-log';
import { renameFile, createFolder, moveFile, deleteToTrash } from '../api/filesystem';

interface AIOpsHistoryProps {
  onClose: () => void;
  onRollbackComplete: () => void;
  retentionDays?: number;
  liquidGlassEnabled?: boolean;
}

const OP_ICONS: Record<string, React.ReactNode> = {
  rename: <Pencil className="w-3 h-3" />,
  mkdir: <FolderPlus className="w-3 h-3" />,
  move: <Move className="w-3 h-3" />,
  trash: <Trash2 className="w-3 h-3" />,
  compress: <Archive className="w-3 h-3" />,
};

const OP_LABELS: Record<string, string> = {
  rename: '重命名',
  mkdir: '新建文件夹',
  move: '移动',
  trash: '移至废纸篓',
  compress: '压缩',
};

const PAGE_SIZE_OPTIONS = [10, 20, 50];

type DatePreset = 'all' | 'today' | '7d' | '30d' | 'custom';

function formatTime(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const diffMs = now.getTime() - ts;
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return '刚刚';
  if (diffMin < 60) return `${diffMin} 分钟前`;
  if (diffMin < 1440) return `${Math.floor(diffMin / 60)} 小时前`;
  return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
}

function toStartOfDayTs(dateStr: string): number | null {
  if (!dateStr) return null;
  const d = new Date(`${dateStr}T00:00:00`);
  return Number.isNaN(d.getTime()) ? null : d.getTime();
}

function toEndOfDayTs(dateStr: string): number | null {
  if (!dateStr) return null;
  const d = new Date(`${dateStr}T23:59:59.999`);
  return Number.isNaN(d.getTime()) ? null : d.getTime();
}

function resolveDateRange(
  preset: DatePreset,
  customStart: string,
  customEnd: string,
): { from: number | null; to: number | null } {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayStart = today.getTime();
  const todayEnd = todayStart + 24 * 60 * 60 * 1000 - 1;

  switch (preset) {
    case 'today':
      return { from: todayStart, to: todayEnd };
    case '7d':
      return { from: todayStart - 6 * 24 * 60 * 60 * 1000, to: todayEnd };
    case '30d':
      return { from: todayStart - 29 * 24 * 60 * 60 * 1000, to: todayEnd };
    case 'custom':
      return {
        from: toStartOfDayTs(customStart),
        to: toEndOfDayTs(customEnd),
      };
    case 'all':
    default:
      return { from: null, to: null };
  }
}

export default function AIOpsHistory({
  onClose,
  onRollbackComplete,
  retentionDays = AI_OP_HISTORY_DEFAULT_RETENTION_DAYS,
  liquidGlassEnabled = false,
}: AIOpsHistoryProps) {
  const [sessions, setSessions] = useState<AIOpSession[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [rolling, setRolling] = useState<string | null>(null);
  const [rollResult, setRollResult] = useState<Record<string, 'ok' | 'fail' | 'partial'>>({});
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [datePreset, setDatePreset] = useState<DatePreset>('all');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  const [loading, setLoading] = useState(false);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [totalPages, setTotalPages] = useState(1);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search.trim()), 180);
    return () => window.clearTimeout(timer);
  }, [search]);

  const dateRange = useMemo(
    () => resolveDateRange(datePreset, customStart, customEnd),
    [datePreset, customStart, customEnd],
  );

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, datePreset, customStart, customEnd, pageSize]);

  const reloadPage = useCallback(async (targetPage = page) => {
    setLoading(true);
    try {
      const result = await loadOpSessionsPage({
        page: targetPage,
        pageSize,
        query: debouncedSearch,
        dateFrom: dateRange.from,
        dateTo: dateRange.to,
        retentionDays,
      });
      setSessions(result.items);
      setTotal(result.total);
      setTotalPages(result.totalPages);
      setPage(result.page);
      setExpanded(current => (current && result.items.some(item => item.id === current) ? current : null));
    } finally {
      setLoading(false);
    }
  }, [dateRange.from, dateRange.to, debouncedSearch, page, pageSize, retentionDays]);

  useEffect(() => {
    void reloadPage(page);
  }, [page, reloadPage]);

  useEffect(() => {
    if (datePreset !== 'custom') {
      setCustomStart('');
      setCustomEnd('');
    }
  }, [datePreset]);

  const isFiltered = Boolean(
    debouncedSearch
    || datePreset !== 'all'
    || customStart
    || customEnd,
  );

  const handleDelete = useCallback(async (id: string) => {
    await deleteOpSession(id);
    await reloadPage(page);
  }, [page, reloadPage]);

  const handleRollback = useCallback(async (session: AIOpSession) => {
    setRolling(session.id);
    const reversible = session.ops.filter(entry => entry.status === 'ok' && entry.reverseOp);
    let failed = 0;
    for (const executed of [...reversible].reverse()) {
      try {
        const rev = executed.reverseOp!;
        switch (rev.type) {
          case 'rename':
            await renameFile(rev.path, rev.newName);
            break;
          case 'move':
            await moveFile(rev.path, rev.targetDir);
            break;
          case 'trash':
            await deleteToTrash(rev.path);
            break;
          case 'mkdir':
            await createFolder(rev.parentDir, rev.name);
            break;
        }
      } catch {
        failed += 1;
      }
    }
    setRolling(null);
    setRollResult(r => ({
      ...r,
      [session.id]: failed === 0 ? 'ok' : failed === reversible.length ? 'fail' : 'partial',
    }));
    onRollbackComplete();
  }, [onRollbackComplete]);

  const pageStart = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const pageEnd = total === 0 ? 0 : Math.min(total, page * pageSize);

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
        onClick={e => e.stopPropagation()}
        className={`${liquidGlassEnabled ? 'liquid-glass' : 'bg-surface/95 backdrop-blur-3xl border border-primary/20'} w-[760px] max-h-[700px] rounded-3xl shadow-2xl flex flex-col overflow-hidden`}
      >
        <div className="flex items-center justify-between px-8 py-5 border-b border-primary/10">
          <div className="flex items-center gap-3 min-w-0">
            <History className="w-5 h-5 text-primary shrink-0" />
            <h2 className="text-[17px] font-black text-on-surface shrink-0">AI 操作历史</h2>
            <span className="text-[12px] text-on-surface/40 font-bold shrink-0">{total} 条记录</span>
            <span className="text-[11px] text-on-surface/30 truncate">保留 {retentionDays} 天</span>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-primary/10 rounded-xl transition-colors">
            <X className="w-4 h-4 text-on-surface/50" />
          </button>
        </div>

        <div className="px-8 py-4 border-b border-primary/10 space-y-3">
          <div className="relative">
            <Search className="w-4 h-4 text-on-surface/35 absolute left-4 top-1/2 -translate-y-1/2" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="按指令、摘要、文件名搜索..."
              className="w-full bg-primary/5 border border-primary/20 rounded-2xl pl-11 pr-5 py-3 text-[13px] outline-none focus:border-primary focus:ring-4 focus:ring-primary/10 transition-all"
            />
          </div>

          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-2 flex-wrap">
              <div className="flex items-center gap-1.5 text-[11px] font-bold text-on-surface/45 px-2">
                <Calendar className="w-3.5 h-3.5" />
                日期范围
              </div>
              {([
                ['all', '全部'],
                ['today', '今天'],
                ['7d', '近 7 天'],
                ['30d', '近 30 天'],
                ['custom', '自定义'],
              ] as const).map(([value, label]) => (
                <button
                  key={value}
                  onClick={() => setDatePreset(value)}
                  className={`px-3 py-1.5 rounded-xl text-[12px] font-bold transition-colors ${
                    datePreset === value
                      ? 'bg-primary text-on-primary'
                      : 'bg-primary/5 text-on-surface/55 hover:bg-primary/10'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-2">
              <span className="text-[11px] text-on-surface/40 font-bold">每页</span>
              <select
                value={pageSize}
                onChange={e => setPageSize(Number(e.target.value))}
                className="bg-primary/5 border border-primary/20 rounded-xl px-2.5 py-1.5 text-[12px] font-bold text-on-surface/70 outline-none focus:border-primary"
              >
                {PAGE_SIZE_OPTIONS.map(size => (
                  <option key={size} value={size}>
                    {size}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {datePreset === 'custom' && (
            <div className="flex items-center gap-2 text-[12px]">
              <input
                type="date"
                value={customStart}
                onChange={e => setCustomStart(e.target.value)}
                className="bg-primary/5 border border-primary/20 rounded-xl px-3 py-2 text-[12px] outline-none focus:border-primary"
              />
              <span className="text-on-surface/35">到</span>
              <input
                type="date"
                value={customEnd}
                onChange={e => setCustomEnd(e.target.value)}
                className="bg-primary/5 border border-primary/20 rounded-xl px-3 py-2 text-[12px] outline-none focus:border-primary"
              />
            </div>
          )}
        </div>

        <div className="flex-1 overflow-y-auto px-8 py-4 space-y-3 custom-scrollbar">
          {loading && (
            <div className="flex items-center justify-center h-40 text-on-surface/35 text-[13px] gap-2">
              <Loader2 className="w-4 h-4 animate-spin" />
              正在加载历史记录...
            </div>
          )}

          {!loading && sessions.length === 0 && (
            <div className="flex items-center justify-center h-40 text-on-surface/25 text-[14px]">
              {isFiltered ? '无匹配记录' : '暂无操作历史'}
            </div>
          )}

          {!loading && sessions.map(session => (
            <div key={session.id} className="rounded-2xl border border-primary/10 overflow-hidden">
              <div
                className="flex items-center gap-3 px-5 py-4 bg-primary/5 cursor-pointer hover:bg-primary/10 transition-colors"
                onClick={() => setExpanded(expanded === session.id ? null : session.id)}
              >
                {expanded === session.id
                  ? <ChevronDown className="w-4 h-4 text-on-surface/40 shrink-0" />
                  : <ChevronRight className="w-4 h-4 text-on-surface/40 shrink-0" />
                }
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-bold text-on-surface truncate">{session.instruction}</p>
                  <p className="text-[11px] text-on-surface/40 truncate mt-0.5">{session.summary}</p>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <span className="text-[11px] text-on-surface/30">{formatTime(session.timestamp)}</span>
                  <span className="text-[10px] font-bold text-on-surface/30 bg-primary/5 px-2 py-0.5 rounded">
                    {session.ops.length} 步
                  </span>
                  {rollResult[session.id] === 'ok' && <span className="text-[11px] text-green-500 font-bold">已回滚</span>}
                  {rollResult[session.id] === 'partial' && <span className="text-[11px] text-amber-500 font-bold">部分回滚</span>}
                  {rollResult[session.id] === 'fail' && <span className="text-[11px] text-red-500 font-bold">回滚失败</span>}
                </div>
              </div>

              <AnimatePresence>
                {expanded === session.id && (
                  <motion.div
                    initial={{ height: 0 }} animate={{ height: 'auto' }} exit={{ height: 0 }}
                    className="overflow-hidden"
                  >
                    <div className="px-5 py-3 space-y-1.5 border-t border-primary/10">
                      {session.ops.map((entry, i) => (
                        <div key={i} className="flex items-center gap-2.5 py-1.5">
                          <span className={`shrink-0 ${entry.status === 'ok' ? 'text-on-surface/50' : 'text-red-400'}`}>
                            {OP_ICONS[entry.op.type]}
                          </span>
                          <span className="text-[10px] font-bold text-on-surface/30 w-14 shrink-0">{OP_LABELS[entry.op.type]}</span>
                          <span className="text-[11px] font-mono text-on-surface/60 flex-1 truncate">
                            {'path' in entry.op ? entry.op.path.split('/').pop() : ''}
                            {'newName' in entry.op ? ` → ${entry.op.newName}` : ''}
                            {'targetDir' in entry.op && entry.op.type === 'move' ? ` → ${entry.op.targetDir.split('/').pop()}/` : ''}
                          </span>
                          {entry.status === 'ok'
                            ? <Check className="w-3 h-3 text-green-500 shrink-0" />
                            : <AlertCircle className="w-3 h-3 text-red-400 shrink-0" />
                          }
                          {entry.note && <span className="text-[10px] text-amber-500/70 shrink-0 max-w-[120px] truncate">{entry.note}</span>}
                        </div>
                      ))}

                      {session.ops.some(entry => entry.op.type === 'trash') && (
                        <p className="text-[11px] text-amber-500/70 pt-1 flex items-center gap-1.5">
                          <AlertCircle className="w-3 h-3 shrink-0" />
                          包含移至废纸篓操作，需手动从废纸篓恢复
                        </p>
                      )}

                      <div className="flex items-center gap-3 pt-2 border-t border-primary/10 mt-2">
                        {session.canRollback && !rollResult[session.id] && (
                          <button
                            onClick={() => handleRollback(session)}
                            disabled={rolling === session.id}
                            className="flex items-center gap-1.5 px-4 py-2 bg-primary/10 hover:bg-primary/20 rounded-xl text-[12px] font-bold text-primary transition-colors disabled:opacity-50"
                          >
                            {rolling === session.id
                              ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              : <RotateCcw className="w-3.5 h-3.5" />
                            }
                            一键回滚
                          </button>
                        )}
                        {!session.canRollback && !rollResult[session.id] && (
                          <span className="text-[11px] text-on-surface/30 flex items-center gap-1.5">
                            <AlertCircle className="w-3 h-3" /> 此操作不支持自动回滚
                          </span>
                        )}
                        <div className="flex-1" />
                        <button
                          onClick={() => handleDelete(session.id)}
                          className="flex items-center gap-1.5 px-3 py-2 hover:bg-red-500/10 rounded-xl text-[11px] text-on-surface/30 hover:text-red-500 transition-colors"
                        >
                          <Trash2 className="w-3 h-3" /> 删除记录
                        </button>
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          ))}
        </div>

        <div className="px-8 py-3 border-t border-primary/10 flex items-center justify-between text-[12px] text-on-surface/45">
          <span>
            {total === 0 ? '0 条' : `${pageStart}-${pageEnd} / ${total}`}
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page <= 1 || loading}
              className="px-3 py-1.5 rounded-lg bg-primary/5 hover:bg-primary/10 disabled:opacity-40 disabled:hover:bg-primary/5 transition-colors"
            >
              上一页
            </button>
            <span className="min-w-14 text-center">{page} / {Math.max(1, totalPages)}</span>
            <button
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages || loading}
              className="px-3 py-1.5 rounded-lg bg-primary/5 hover:bg-primary/10 disabled:opacity-40 disabled:hover:bg-primary/5 transition-colors"
            >
              下一页
            </button>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}
