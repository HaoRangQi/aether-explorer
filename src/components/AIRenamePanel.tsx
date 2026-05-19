import React, { useState, useCallback } from 'react';
import { motion } from 'motion/react';
import { Sparkles, X, Loader2, Check, AlertCircle, ArrowRight } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { ThemeSettings, FileItem } from '../types';
import { generateRenames } from '../lib/ai-service';

interface AIRenamePanelProps {
  files: FileItem[];
  theme: ThemeSettings;
  onClose: () => void;
  onComplete: () => void;
}

type Status = 'idle' | 'generating' | 'previewing' | 'executing' | 'done' | 'error';

export default function AIRenamePanel({ files, theme, onClose, onComplete }: AIRenamePanelProps) {
  const [instruction, setInstruction] = useState('');
  const [newNames, setNewNames] = useState<string[]>([]);
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState('');
  const [progress, setProgress] = useState(0);

  const handleGenerate = useCallback(async () => {
    if (!instruction.trim()) return;
    setStatus('generating');
    setError('');

    const directory = files[0]?.path.split('/').slice(0, -1).join('/') || '/';
    const result = await generateRenames(theme, {
      fileNames: files.map(f => f.name),
      instruction: instruction.trim(),
      directory,
    });

    if (result.error) {
      setError(result.error);
      setStatus('error');
    } else {
      setNewNames(result.newNames);
      setStatus('previewing');
    }
  }, [instruction, files, theme]);

  const handleExecute = useCallback(async () => {
    setStatus('executing');
    setProgress(0);
    let failed = 0;
    for (let i = 0; i < files.length; i++) {
      try {
        await invoke('rename_file', { oldPath: files[i].path, newName: newNames[i] });
      } catch {
        failed++;
      }
      setProgress(i + 1);
    }
    if (failed > 0) {
      setError(`${files.length - failed} 个成功，${failed} 个失败`);
    }
    setStatus('done');
    setTimeout(onComplete, 800);
  }, [files, newNames, onComplete]);

  const handleEditName = (idx: number, value: string) => {
    setNewNames(prev => prev.map((n, i) => i === idx ? value : n));
  };

  const presets = ['加序号前缀', '去掉空格和特殊字符', '全部小写', '按日期格式重命名'];

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        onClick={e => e.stopPropagation()}
        className="w-[800px] max-h-[600px] bg-surface/95 backdrop-blur-3xl rounded-3xl border border-primary/20 shadow-2xl flex flex-col overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-8 py-5 border-b border-primary/10">
          <div className="flex items-center gap-3">
            <Sparkles className="w-5 h-5 text-primary" />
            <h2 className="text-[17px] font-black text-on-surface">AI 批量重命名</h2>
            <span className="text-[12px] text-on-surface/40 font-bold">{files.length} 个文件</span>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-primary/10 rounded-xl transition-colors">
            <X className="w-4 h-4 text-on-surface/50" />
          </button>
        </div>

        {/* Input area */}
        <div className="px-8 py-5 border-b border-primary/10 space-y-3">
          <textarea
            value={instruction}
            onChange={e => setInstruction(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleGenerate(); } }}
            placeholder="描述你的重命名意图，例如：把所有文件加上日期前缀、去掉括号和空格、按序号重新编号..."
            className="w-full bg-primary/5 border border-primary/20 rounded-2xl px-5 py-4 text-[14px] text-on-surface outline-none focus:border-primary focus:ring-4 focus:ring-primary/10 resize-none h-20 transition-all"
            disabled={status === 'generating' || status === 'executing'}
          />
          <div className="flex items-center gap-2 flex-wrap">
            {presets.map(p => (
              <button
                key={p}
                onClick={() => setInstruction(p)}
                className="px-3 py-1.5 text-[11px] font-bold text-on-surface/50 bg-primary/5 hover:bg-primary/10 hover:text-primary rounded-lg transition-colors"
              >
                {p}
              </button>
            ))}
            <div className="flex-1" />
            <button
              onClick={handleGenerate}
              disabled={!instruction.trim() || status === 'generating' || status === 'executing'}
              className="px-5 py-2.5 bg-primary text-on-primary rounded-xl text-[13px] font-bold flex items-center gap-2 disabled:opacity-40 shadow-lg shadow-primary/20 transition-all hover:shadow-xl"
            >
              {status === 'generating' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
              {status === 'generating' ? '生成中...' : '生成预览'}
            </button>
          </div>
        </div>

        {/* Preview area */}
        <div className="flex-1 overflow-y-auto px-8 py-5 min-h-0">
          {status === 'error' && (
            <div className="flex items-center gap-3 p-4 bg-red-500/10 border border-red-500/20 rounded-2xl text-[13px] text-red-500 font-medium">
              <AlertCircle className="w-4 h-4 shrink-0" />
              {error}
            </div>
          )}
          {(status === 'previewing' || status === 'executing' || status === 'done') && newNames.length > 0 && (
            <div className="space-y-1.5">
              {files.map((file, i) => (
                <div key={file.id} className="flex items-center gap-3 px-4 py-2.5 rounded-xl bg-primary/5 border border-primary/10">
                  <span className="text-[12px] text-on-surface/60 font-mono truncate w-[40%] shrink-0">{file.name}</span>
                  <ArrowRight className="w-3.5 h-3.5 text-primary/50 shrink-0" />
                  {status === 'previewing' ? (
                    <input
                      value={newNames[i]}
                      onChange={e => handleEditName(i, e.target.value)}
                      className="flex-1 text-[12px] font-mono font-bold text-primary bg-transparent outline-none border-b border-transparent focus:border-primary/30 truncate"
                    />
                  ) : (
                    <span className="flex-1 text-[12px] font-mono font-bold text-primary truncate">{newNames[i]}</span>
                  )}
                  {status === 'done' && i < progress && <Check className="w-3.5 h-3.5 text-green-500 shrink-0" />}
                </div>
              ))}
            </div>
          )}
          {status === 'idle' && (
            <div className="flex items-center justify-center h-full text-on-surface/25 text-[14px] font-medium">
              输入意图后点击「生成预览」
            </div>
          )}
        </div>

        {/* Footer */}
        {status === 'previewing' && (
          <div className="px-8 py-5 border-t border-primary/10 flex items-center justify-between">
            <p className="text-[12px] text-on-surface/40">确认无误后点击执行，可点击右侧文件名手动修改</p>
            <button
              onClick={handleExecute}
              className="px-6 py-3 bg-primary text-on-primary rounded-xl text-[13px] font-bold shadow-lg shadow-primary/20 hover:shadow-xl transition-all flex items-center gap-2"
            >
              <Check className="w-4 h-4" /> 执行重命名
            </button>
          </div>
        )}
        {status === 'executing' && (
          <div className="px-8 py-5 border-t border-primary/10">
            <div className="flex items-center gap-3">
              <Loader2 className="w-4 h-4 animate-spin text-primary" />
              <span className="text-[13px] font-bold text-on-surface/60">正在重命名 {progress}/{files.length}</span>
              <div className="flex-1 h-1.5 bg-primary/10 rounded-full overflow-hidden">
                <div className="h-full bg-primary rounded-full transition-all" style={{ width: `${(progress / files.length) * 100}%` }} />
              </div>
            </div>
          </div>
        )}
      </motion.div>
    </motion.div>
  );
}