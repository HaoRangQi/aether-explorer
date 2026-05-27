import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { useTranslation } from 'react-i18next';
import { Archive, CheckCircle2, Copy, Square, Trash2, X } from 'lucide-react';
import { ThemeSettings } from '../types';
import {
  cancelTransferTask,
  clearFinishedTransferTasks,
  listTransferTasks,
  type TransferTaskSnapshot,
} from '../api/filesystem';
import { normalizeAppError } from '../lib/app-error';
import { usePrefersReducedMotion } from '../lib/use-prefers-reduced-motion';
import Loader from './Loader';

const AUTO_CLOSE_DELAY_MS = 1500;
const FINISHED_TASK_VISIBLE_WINDOW_SECONDS = 2;

interface TransferModalProps {
  onClose: () => void;
  theme: ThemeSettings;
}

function taskPercent(task: TransferTaskSnapshot): number {
  if (task.totalBytes > 0) {
    return Math.min(100, (task.completedBytes / task.totalBytes) * 100);
  }
  if (task.totalItems > 0) {
    return Math.min(100, (task.completedItems / task.totalItems) * 100);
  }
  return task.status === 'completed' ? 100 : 0;
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'K', 'M', 'G', 'T'];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value >= 10 || unitIndex === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[unitIndex]}`;
}

function isActiveTask(task: TransferTaskSnapshot): boolean {
  return task.status === 'queued' || task.status === 'running' || task.status === 'cancelling';
}

function resultSummary(task: TransferTaskSnapshot, t: (key: string, options?: Record<string, unknown>) => string): string | null {
  if (isActiveTask(task)) return null;
  const parts: string[] = [];

  if (task.copied > 0) parts.push(t('transfer.result.copied', { count: task.copied }));
  if (task.moved > 0) parts.push(t('transfer.result.moved', { count: task.moved }));
  if (task.copiedCrossDevice > 0) {
    parts.push(t('transfer.result.copiedCrossDevice', { count: task.copiedCrossDevice }));
  }
  if (task.skippedSameDir > 0) parts.push(t('transfer.result.skippedSameDir', { count: task.skippedSameDir }));
  if (task.skippedConflicts > 0) parts.push(t('transfer.result.skippedConflicts', { count: task.skippedConflicts }));
  const unknownSkipped = Math.max(0, task.skipped - task.skippedSameDir - task.skippedConflicts);
  if (unknownSkipped > 0) parts.push(t('transfer.result.skipped', { count: unknownSkipped }));
  if (task.failed > 0) parts.push(t('transfer.result.failed', { count: task.failed }));
  if (task.conflicts > 0) parts.push(t('transfer.result.conflicts', { count: task.conflicts }));

  return parts.length > 0 ? parts.join(' · ') : null;
}

export default function TransferModal({ onClose, theme }: TransferModalProps) {
  const { t } = useTranslation();
  const prefersReducedMotion = usePrefersReducedMotion();
  const liquidGlassEnabled = theme.enableLiquidGlass === true;
  const [tasks, setTasks] = useState<TransferTaskSnapshot[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [autoCloseProgress, setAutoCloseProgress] = useState(0);
  const autoCloseTimeoutRef = useRef<number | null>(null);
  const autoCloseRafRef = useRef<number | null>(null);
  const autoCloseStartedAtRef = useRef<number | null>(null);

  const loadTasks = useCallback(async () => {
    try {
      const nextTasks = await listTransferTasks();
      setTasks(nextTasks);
      setError(null);
    } catch (err) {
      setError(normalizeAppError(err).userMessage);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const isRecentlyFinishedTask = useCallback((task: TransferTaskSnapshot) => {
    if (isActiveTask(task)) return false;
    const now = Math.floor(Date.now() / 1000);
    const finishedAt = task.finishedAt ?? task.startedAt;
    const elapsed = now - finishedAt;
    return elapsed >= 0 && elapsed <= FINISHED_TASK_VISIBLE_WINDOW_SECONDS;
  }, []);

  useEffect(() => {
    void loadTasks();
    const interval = window.setInterval(() => {
      void loadTasks();
    }, 600);
    return () => window.clearInterval(interval);
  }, [loadTasks]);

  const activeTasks = useMemo(() => tasks.filter(isActiveTask), [tasks]);

  const mostRecentFinishedTask = useMemo(() => {
    const recentFinishedTasks = tasks
      .filter(task => isRecentlyFinishedTask(task))
      .sort((a, b) => {
        const aTime = a.finishedAt ?? a.startedAt;
        const bTime = b.finishedAt ?? b.startedAt;
        return bTime - aTime;
      });
    return recentFinishedTasks[0] ?? null;
  }, [isRecentlyFinishedTask, tasks]);

  const visibleTasks = useMemo(() => {
    if (activeTasks.length > 0) {
      return activeTasks;
    }
    return mostRecentFinishedTask ? [mostRecentFinishedTask] : [];
  }, [activeTasks, mostRecentFinishedTask]);

  const overallProgress = useMemo(() => {
    if (activeTasks.length === 0) {
      return tasks.length > 0 ? 100 : 0;
    }
    const totalBytes = activeTasks.reduce((sum, task) => sum + task.totalBytes, 0);
    if (totalBytes > 0) {
      const completedBytes = activeTasks.reduce((sum, task) => sum + task.completedBytes, 0);
      return Math.min(100, (completedBytes / totalBytes) * 100);
    }

    const totalItems = activeTasks.reduce((sum, task) => sum + task.totalItems, 0);
    if (totalItems > 0) {
      const completedItems = activeTasks.reduce((sum, task) => sum + task.completedItems, 0);
      return Math.min(100, (completedItems / totalItems) * 100);
    }

    return 0;
  }, [activeTasks, tasks.length]);

  const activeCount = visibleTasks.filter(isActiveTask).length;
  const finishedCount = visibleTasks.length - activeCount;
  const totalFinishedCount = tasks.length - activeCount;
  const canAutoClose = !isLoading && activeCount === 0 && (totalFinishedCount > 0 || tasks.length === 0);
  const radius = 45;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (overallProgress / 100) * circumference;

  const clearAutoClose = useCallback(() => {
    if (autoCloseTimeoutRef.current) {
      window.clearTimeout(autoCloseTimeoutRef.current);
      autoCloseTimeoutRef.current = null;
    }
    if (autoCloseRafRef.current) {
      window.cancelAnimationFrame(autoCloseRafRef.current);
      autoCloseRafRef.current = null;
    }
    autoCloseStartedAtRef.current = null;
    setAutoCloseProgress(0);
  }, []);

  const scheduleAutoClose = useCallback(() => {
    clearAutoClose();
    if (!canAutoClose) return;

    const startedAt = performance.now();
    autoCloseStartedAtRef.current = startedAt;

    const tick = () => {
      if (autoCloseStartedAtRef.current !== startedAt) return;
      const elapsed = performance.now() - startedAt;
      setAutoCloseProgress(Math.min(1, elapsed / AUTO_CLOSE_DELAY_MS));
      if (elapsed < AUTO_CLOSE_DELAY_MS) {
        autoCloseRafRef.current = window.requestAnimationFrame(tick);
      }
    };

    tick();
    autoCloseTimeoutRef.current = window.setTimeout(() => {
      autoCloseTimeoutRef.current = null;
      void clearFinishedTransferTasks()
        .catch(() => undefined)
        .finally(() => {
          onClose();
        });
    }, AUTO_CLOSE_DELAY_MS);
  }, [canAutoClose, clearAutoClose, onClose]);

  useEffect(() => {
    if (!canAutoClose) {
      clearAutoClose();
      return;
    }

    scheduleAutoClose();
    window.addEventListener('mousemove', scheduleAutoClose, { passive: true });
    return () => {
      window.removeEventListener('mousemove', scheduleAutoClose);
      clearAutoClose();
    };
  }, [canAutoClose, clearAutoClose, scheduleAutoClose]);

  useEffect(() => clearAutoClose, [clearAutoClose]);

  const handleCancel = async (taskId: string) => {
    try {
      await cancelTransferTask(taskId);
      await loadTasks();
    } catch (err) {
      setError(normalizeAppError(err).userMessage);
    }
  };

  const handleCancelAll = async () => {
    try {
      await Promise.all(tasks.filter(isActiveTask).map(task => cancelTransferTask(task.id)));
      await loadTasks();
    } catch (err) {
      setError(normalizeAppError(err).userMessage);
    }
  };

  const handleClearFinished = async () => {
    try {
      await clearFinishedTransferTasks();
      await loadTasks();
    } catch (err) {
      setError(normalizeAppError(err).userMessage);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 sm:p-12">
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="absolute inset-0 bg-black/60 backdrop-blur-md"
      />

      <motion.div
        initial={{ opacity: 0, scale: 0.9, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.9, y: 20 }}
        className={`${liquidGlassEnabled ? 'liquid-glass' : 'glass-panel bg-surface-container-high/90 border border-transparent'} relative w-full max-w-2xl rounded-3xl shadow-2xl overflow-hidden flex flex-col`}
      >
        <header className="px-8 py-6 border-b border-transparent flex justify-between items-center bg-white/[0.02]">
          <div className="space-y-1 min-w-0">
            <h2 className="text-[20px] font-bold text-on-surface">{t('transfer.title')}</h2>
            <p className="text-[13px] text-on-surface/45 truncate">
              {t('transfer.summary', { active: activeCount, finished: finishedCount })}
            </p>
          </div>
          <button
            onClick={onClose}
            className="w-10 h-10 rounded-full hover:bg-on-surface/[0.08] flex items-center justify-center text-on-surface/40 hover:text-on-surface transition-all"
          >
            <X className="w-5 h-5" />
          </button>
        </header>

        <div className="p-8 flex flex-col items-center gap-10 max-h-[70vh] overflow-y-auto">
          <div className="relative w-40 h-40 flex items-center justify-center">
            <svg className="w-full h-full -rotate-90 transform" viewBox="0 0 100 100">
              <circle cx="50" cy="50" r={radius} className="stroke-white/10" strokeWidth="6" fill="none" />
              <motion.circle
                cx="50"
                cy="50"
                r={radius}
                className="stroke-primary"
                strokeWidth="6"
                fill="none"
                strokeDasharray={circumference}
                animate={{ strokeDashoffset: offset }}
                strokeLinecap="round"
                transition={prefersReducedMotion ? { duration: 0 } : { duration: 0.2 }}
              />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-[32px] font-bold text-on-surface">{Math.floor(overallProgress)}%</span>
              <span className="text-[11px] text-on-surface/40 font-bold uppercase tracking-wider">
                {activeCount > 0 ? t('transfer.active') : t('transfer.idle')}
              </span>
            </div>
          </div>

          {error && (
            <div className="w-full rounded-xl bg-red-500/10 px-4 py-3 text-[12px] text-red-300">
              {error}
            </div>
          )}

          <div className="w-full space-y-3">
            {isLoading && tasks.length === 0 ? (
              <div className="flex items-center justify-center gap-3 py-10 text-[13px] text-on-surface/45">
                <Loader size={18} />
                <span>{t('transfer.loading')}</span>
              </div>
            ) : visibleTasks.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-2 py-10 text-center">
                <CheckCircle2 className="w-8 h-8 text-on-surface/25" />
                <p className="text-[14px] font-semibold text-on-surface/70">{t('transfer.empty')}</p>
              </div>
            ) : (
              visibleTasks.map(task => {
                const progress = taskPercent(task);
                const Icon = task.kind === 'move' ? Archive : Copy;
                const meta = task.totalBytes > 0
                  ? `${formatBytes(task.completedBytes)} / ${formatBytes(task.totalBytes)}`
                  : t('transfer.itemsProgress', { completed: task.completedItems, total: task.totalItems });
                const summary = resultSummary(task, t);
                return (
                  <div key={task.id} className="bg-on-surface/[0.04] p-4 rounded-2xl border border-transparent flex flex-col gap-3">
                    <div className="flex justify-between items-center gap-4">
                      <div className="flex items-center gap-4 overflow-hidden">
                        <div className="w-8 h-8 rounded-lg bg-on-surface/[0.04] flex items-center justify-center shrink-0 text-primary">
                          {isActiveTask(task) && progress === 0 ? <Loader size={16} /> : <Icon className="w-4 h-4" />}
                        </div>
                        <div className="min-w-0">
                          <p className="text-[14px] font-medium text-on-surface truncate leading-tight">
                            {t(`transfer.kind.${task.kind}`)}
                          </p>
                          <p className="text-[11px] text-on-surface/45 mt-0.5 truncate">
                            {summary || task.error || task.currentName || meta}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-[11px] font-bold text-on-surface/45 uppercase tracking-wider">
                          {t(`transfer.status.${task.status}`)}
                        </span>
                        {isActiveTask(task) && (
                          <button
                            onClick={() => void handleCancel(task.id)}
                            className="text-[11px] font-bold text-red-400 hover:bg-red-400/10 px-3 py-1 rounded-full transition-colors uppercase tracking-wider"
                          >
                            {t('transfer.cancel')}
                          </button>
                        )}
                      </div>
                    </div>
                    <div className="h-1.5 w-full bg-on-surface/[0.04] rounded-full overflow-hidden">
                      <motion.div
                        initial={prefersReducedMotion ? false : { width: 0 }}
                        animate={{ width: `${progress}%` }}
                        className={`h-full rounded-full ${task.status === 'failed' ? 'bg-red-400' : task.status === 'cancelled' ? 'bg-on-surface/35' : 'bg-primary'}`}
                      />
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        <footer className="px-8 py-6 border-t border-transparent bg-white/[0.02] flex justify-end gap-3">
          <div className="mr-auto flex min-w-0 flex-col justify-center gap-2">
            {canAutoClose && (
              <>
                <span className="text-[11px] font-bold text-on-surface/40">
                  {t('transfer.autoCloseCountdown')}
                </span>
                <div className="h-1 w-36 overflow-hidden rounded-full bg-on-surface/[0.06]">
                  <motion.div
                    className="h-full rounded-full bg-primary"
                    animate={{ width: `${autoCloseProgress * 100}%` }}
                    transition={prefersReducedMotion ? { duration: 0 } : { duration: 0.08 }}
                  />
                </div>
              </>
            )}
          </div>
          <button
            onClick={() => void handleClearFinished()}
            disabled={totalFinishedCount === 0}
            className="px-6 py-2 rounded-full border border-transparent text-[13px] font-bold text-on-surface hover:bg-on-surface/[0.04] transition-all flex items-center gap-2 disabled:opacity-40 disabled:pointer-events-none"
          >
            <Trash2 className="w-4 h-4" /> {t('transfer.clearFinished')}
          </button>
          <button
            onClick={() => void handleCancelAll()}
            disabled={activeCount === 0}
            className="px-6 py-2 rounded-full bg-red-400 text-white text-[13px] font-bold hover:bg-red-500 transition-all flex items-center gap-2 shadow-lg shadow-red-400/20 disabled:opacity-40 disabled:pointer-events-none"
          >
            <Square className="w-4 h-4" /> {t('transfer.cancelAll')}
          </button>
          <button
            onClick={onClose}
            className="px-6 py-2 rounded-full bg-primary text-on-primary text-[13px] font-bold hover:bg-primary/90 transition-all flex items-center gap-2 shadow-lg shadow-primary/20"
          >
            <X className="w-4 h-4" /> {t('transfer.close')}
          </button>
        </footer>
      </motion.div>
    </div>
  );
}
