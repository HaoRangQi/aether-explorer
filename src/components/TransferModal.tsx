import { useCallback, useEffect, useMemo, useState } from 'react';
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
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
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

export default function TransferModal({ onClose, theme: _theme }: TransferModalProps) {
  const { t } = useTranslation();
  const prefersReducedMotion = usePrefersReducedMotion();
  const [tasks, setTasks] = useState<TransferTaskSnapshot[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

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

  useEffect(() => {
    void loadTasks();
    const interval = window.setInterval(() => {
      void loadTasks();
    }, 600);
    return () => window.clearInterval(interval);
  }, [loadTasks]);

  const overallProgress = useMemo(() => {
    if (tasks.length === 0) return 0;
    const totalBytes = tasks.reduce((sum, task) => sum + task.totalBytes, 0);
    if (totalBytes > 0) {
      const completedBytes = tasks.reduce((sum, task) => sum + task.completedBytes, 0);
      return Math.min(100, (completedBytes / totalBytes) * 100);
    }

    const totalItems = tasks.reduce((sum, task) => sum + task.totalItems, 0);
    if (totalItems > 0) {
      const completedItems = tasks.reduce((sum, task) => sum + task.completedItems, 0);
      return Math.min(100, (completedItems / totalItems) * 100);
    }

    return tasks.every(task => task.status === 'completed') ? 100 : 0;
  }, [tasks]);

  const activeCount = tasks.filter(isActiveTask).length;
  const finishedCount = tasks.length - activeCount;
  const radius = 45;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (overallProgress / 100) * circumference;

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
        className="relative w-full max-w-2xl glass-panel bg-surface-container-high/90 border border-transparent rounded-3xl shadow-2xl overflow-hidden flex flex-col"
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
            ) : tasks.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-2 py-10 text-center">
                <CheckCircle2 className="w-8 h-8 text-on-surface/25" />
                <p className="text-[14px] font-semibold text-on-surface/70">{t('transfer.empty')}</p>
              </div>
            ) : (
              tasks.map(task => {
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
          <button
            onClick={() => void handleClearFinished()}
            disabled={finishedCount === 0}
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
        </footer>
      </motion.div>
    </div>
  );
}
