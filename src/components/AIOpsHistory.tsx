import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { History, X, RotateCcw, Trash2, ChevronDown, ChevronRight, AlertCircle, Check, Loader2, Pencil, FolderPlus, Move, Archive } from 'lucide-react';
import { AIOpSession } from '../types';
import { loadOpSessions, deleteOpSession } from '../lib/ai-ops-log';
import { renameFile, createFolder, moveFile, deleteToTrash } from '../api/filesystem';

interface AIOpsHistoryProps {
  onClose: () => void;
  onRollbackComplete: () => void;
}

const OP_ICONS: Record<string, React.ReactNode> = {
  rename:   <Pencil className="w-3 h-3" />,
  mkdir:    <FolderPlus className="w-3 h-3" />,
  move:     <Move className="w-3 h-3" />,
  trash:    <Trash2 className="w-3 h-3" />,
  compress: <Archive className="w-3 h-3" />,
};

const OP_LABELS: Record<string, string> = {
  rename: '重命名', mkdir: '新建文件夹', move: '移动', trash: '移至废纸篓', compress: '压缩',
};

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

export default function AIOpsHistory({ onClose, onRollbackComplete }: AIOpsHistoryProps) {
  const [sessions, setSessions] = useState<AIOpSession[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [rolling, setRolling] = useState<string | null>(null);
  const [rollResult, setRollResult] = useState<Record<string, 'ok' | 'fail' | 'partial'>>({});
  const [search, setSearch] = useState('');

  useEffect(() => {
    loadOpSessions().then(setSessions);
  }, []);

  const handleRollback = useCallback(async (session: AIOpSession) => {
    setRolling(session.id);
    const reversible = session.ops.filter(e => e.status === 'ok' && e.reverseOp);
    let failed = 0;
    // 反向顺序执行回滚
    for (const executed of [...reversible].reverse()) {
      try {
        const rev = executed.reverseOp!;
        switch (rev.type) {
          case 'rename': await renameFile(rev.path, rev.newName); break;
          case 'move':   await moveFile(rev.path, rev.targetDir); break;
          case 'trash':  await deleteToTrash(rev.path); break;
          case 'mkdir':  await createFolder(rev.parentDir, rev.name); break;
        }
      } catch {
        failed++;
      }
    }
    setRolling(null);
    setRollResult(r => ({ ...r, [session.id]: failed === 0 ? 'ok' : failed === reversible.length ? 'fail' : 'partial' }));
    onRollbackComplete();
  }, [onRollbackComplete]);

  const handleDelete = useCallback(async (id: string) => {
    await deleteOpSession(id);
    setSessions(s => s.filter(s => s.id !== id));
  }, []);

  const filtered = sessions.filter(s =>
    !search || s.instruction.includes(search) || s.summary.includes(search)
  );

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
        onClick={e => e.stopPropagation()}
        className="w-[680px] max-h-[640px] bg-surface/95 backdrop-blur-3xl rounded-3xl border border-primary/20 shadow-2xl flex flex-col overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-8 py-5 border-b border-primary/10">
          <div className="flex items-center gap-3">
            <History className="w-5 h-5 text-primary" />
            <h2 className="text-[17px] font-black text-on-surface">AI 操作历史</h2>
            <span className="text-[12px] text-on-surface/40 font-bold">{sessions.length} 条记录</span>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-primary/10 rounded-xl transition-colors">
            <X className="w-4 h-4 text-on-surface/50" />
          </button>
        </div>

        {/* Search */}
        <div className="px-8 py-4 border-b border-primary/10">
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="搜索操作记录..."
            className="w-full bg-primary/5 border border-primary/20 rounded-2xl px-5 py-3 text-[13px] outline-none focus:border-primary focus:ring-4 focus:ring-primary/10 transition-all"
          />
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto px-8 py-4 space-y-3 custom-scrollbar">
          {filtered.length === 0 && (
            <div className="flex items-center justify-center h-40 text-on-surface/25 text-[14px]">
              {search ? '无匹配记录' : '暂无操作历史'}
            </div>
          )}
          {filtered.map(session => (
            <div key={session.id} className="rounded-2xl border border-primary/10 overflow-hidden">
              {/* Session header */}
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

              {/* Expanded ops */}
              <AnimatePresence>
                {expanded === session.id && (
                  <motion.div
                    initial={{ height: 0 }} animate={{ height: 'auto' }} exit={{ height: 0 }}
                    className="overflow-hidden"
                  >
                    <div className="px-5 py-3 space-y-1.5 border-t border-primary/10">
                      {session.ops.map((e, i) => (
                        <div key={i} className="flex items-center gap-2.5 py-1.5">
                          <span className={`shrink-0 ${e.status === 'ok' ? 'text-on-surface/50' : 'text-red-400'}`}>
                            {OP_ICONS[e.op.type]}
                          </span>
                          <span className="text-[10px] font-bold text-on-surface/30 w-14 shrink-0">{OP_LABELS[e.op.type]}</span>
                          <span className="text-[11px] font-mono text-on-surface/60 flex-1 truncate">
                            {'path' in e.op ? e.op.path.split('/').pop() : ''}
                            {'newName' in e.op ? ` → ${e.op.newName}` : ''}
                            {'targetDir' in e.op && e.op.type === 'move' ? ` → ${e.op.targetDir.split('/').pop()}/` : ''}
                          </span>
                          {e.status === 'ok'
                            ? <Check className="w-3 h-3 text-green-500 shrink-0" />
                            : <AlertCircle className="w-3 h-3 text-red-400 shrink-0" />
                          }
                          {e.note && <span className="text-[10px] text-amber-500/70 shrink-0 max-w-[120px] truncate">{e.note}</span>}
                        </div>
                      ))}

                      {/* Trash warning */}
                      {session.ops.some(e => e.op.type === 'trash') && (
                        <p className="text-[11px] text-amber-500/70 pt-1 flex items-center gap-1.5">
                          <AlertCircle className="w-3 h-3 shrink-0" />
                          包含移至废纸篓操作，需手动从废纸篓恢复
                        </p>
                      )}

                      {/* Actions */}
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
      </motion.div>
    </motion.div>
  );
}
