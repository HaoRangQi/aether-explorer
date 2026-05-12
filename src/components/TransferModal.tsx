import { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import { useTranslation } from 'react-i18next';
import { X, FileText, Archive, Pause, Square, CheckCircle2 } from 'lucide-react';
import { ThemeSettings } from '../types';
import Loader from './Loader';

interface TransferModalProps {
  onClose: () => void;
  theme: ThemeSettings;
}

export default function TransferModal({ onClose, theme }: TransferModalProps) {
  const { t } = useTranslation();
  const [progress, setProgress] = useState(0);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    const interval = setInterval(() => {
      if (!paused) setProgress(p => (p < 100 ? p + 0.5 : 100));
    }, 50);
    return () => clearInterval(interval);
  }, [paused]);

  const tasks = [
    { name: '当前复制/移动任务', target: '由文件操作触发，完成后自动刷新目录', progress: Math.min(100, progress + 8), icon: Archive, color: 'text-yellow-400' },
    { name: '压缩/解压任务', target: progress > 45 ? '已进入收尾阶段' : t('transfer.waiting'), progress: Math.max(0, progress - 15), icon: FileText, color: 'text-red-400' },
    { name: '通知与历史记录', target: progress >= 100 ? '全部完成' : '等待任务事件写入', progress: progress >= 100 ? 100 : 0, icon: CheckCircle2, color: 'text-primary' },
  ];

  const radius = 45;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (progress / 100) * circumference;

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
          <div className="space-y-1">
            <h2 className="text-[20px] font-bold text-on-surface">{t('transfer.title')}</h2>
            <p className="text-[13px] text-on-surface/40">{progress >= 100 ? '所有队列任务已完成' : `${Math.max(1, Math.ceil((100 - progress) / 20))} min ${t('transfer.timeRemaining')}`}</p>
          </div>
          <button 
            onClick={onClose}
            className="w-10 h-10 rounded-full hover:bg-on-surface/[0.08] flex items-center justify-center text-on-surface/40 hover:text-on-surface transition-all"
          >
            <X className="w-5 h-5" />
          </button>
        </header>

        <div className="p-8 flex flex-col items-center gap-12 max-h-[70vh] overflow-y-auto">
          {/* Circular Progress */}
          <div className="relative w-40 h-40 flex items-center justify-center">
            <svg className="w-full h-full -rotate-90 transform" viewBox="0 0 100 100">
              <circle 
                cx="50" cy="50" r={radius} 
                className="stroke-white/10" 
                strokeWidth="6" fill="none" 
              />
              <motion.circle 
                cx="50" cy="50" r={radius} 
                className="stroke-primary" 
                strokeWidth="6" fill="none" 
                strokeDasharray={circumference}
                animate={{ strokeDashoffset: offset }}
                strokeLinecap="round"
                transition={{ duration: 0.1 }}
              />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-[32px] font-bold text-on-surface">{Math.floor(progress)}%</span>
              <span className="text-[11px] text-on-surface/40 font-bold uppercase tracking-wider">{paused ? 'PAUSED' : progress >= 100 ? 'DONE' : 'ACTIVE'}</span>
            </div>
          </div>

          {/* Task List */}
          <div className="w-full space-y-3">
             {tasks.map((task, i) => (
                <div key={i} className={`bg-on-surface/[0.04] p-4 rounded-2xl border border-transparent flex flex-col gap-3 ${task.progress === 0 ? 'opacity-50' : ''}`}>
                  <div className="flex justify-between items-center">
                    <div className="flex items-center gap-4 overflow-hidden">
                      <div className={`w-8 h-8 rounded-lg bg-on-surface/[0.04] flex items-center justify-center shrink-0 ${task.color}`}>
                        {task.progress === 0 ? (
                          <Loader size={16} />
                        ) : (
                          <task.icon className="w-4 h-4" />
                        )}
                      </div>
                      <div className="min-w-0">
                        <p className="text-[14px] font-medium text-on-surface truncate leading-tight">{task.name}</p>
                        <p className="text-[11px] text-on-surface/40 mt-0.5">{task.target}</p>
                      </div>
                    </div>
                    <button onClick={() => setProgress(100)} className="text-[11px] font-bold text-red-400 hover:bg-red-400/10 px-3 py-1 rounded-full transition-colors uppercase tracking-wider">
                      {t('transfer.cancel')}
                    </button>
                  </div>
                  <div className="h-1.5 w-full bg-on-surface/[0.04] rounded-full overflow-hidden">
                    <motion.div 
                      initial={{ width: 0 }}
                      animate={{ width: `${task.progress}%` }}
                      className="h-full bg-primary rounded-full" 
                    />
                  </div>
                </div>
             ))}
          </div>
        </div>

        <footer className="px-8 py-6 border-t border-transparent bg-white/[0.02] flex justify-end gap-3">
          <button onClick={() => setPaused(p => !p)} className="px-6 py-2 rounded-full border border-transparent text-[13px] font-bold text-on-surface hover:bg-on-surface/[0.04] transition-all flex items-center gap-2">
            <Pause className="w-4 h-4" /> {paused ? '继续' : t('transfer.pauseAll')}
          </button>
          <button onClick={() => setProgress(100)} className="px-6 py-2 rounded-full bg-red-400 text-white text-[13px] font-bold hover:bg-red-500 transition-all flex items-center gap-2 shadow-lg shadow-red-400/20">
            <Square className="w-4 h-4" /> {t('transfer.cancelAll')}
          </button>
        </footer>
      </motion.div>
    </div>
  );
}
