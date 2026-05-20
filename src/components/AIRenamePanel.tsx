import React, { useState, useCallback } from 'react';
import { motion } from 'motion/react';
import { Sparkles, X, Loader2, Check, AlertCircle, FolderPlus, Move, Trash2, Archive, Pencil } from 'lucide-react';
import { ThemeSettings, FileItem, AIExecutedOp } from '../types';
import { generateFileOps, AIFileOp } from '../lib/ai-service';
import { renameFile, createFolder, moveFile, deleteToTrash, compressFiles } from '../api/filesystem';
import { saveOpSession, buildReverseOp } from '../lib/ai-ops-log';

interface AIRenamePanelProps {
  files: FileItem[];
  currentDir: string;
  theme: ThemeSettings;
  onClose: () => void;
  onComplete: () => void;
}

type Status = 'idle' | 'generating' | 'previewing' | 'executing' | 'done' | 'error';

const OP_ICONS: Record<string, React.ReactNode> = {
  rename:   <Pencil className="w-3.5 h-3.5 text-primary" />,
  mkdir:    <FolderPlus className="w-3.5 h-3.5 text-green-500" />,
  move:     <Move className="w-3.5 h-3.5 text-blue-500" />,
  trash:    <Trash2 className="w-3.5 h-3.5 text-red-500" />,
  compress: <Archive className="w-3.5 h-3.5 text-amber-500" />,
};

const OP_LABELS: Record<string, string> = {
  rename: '重命名', mkdir: '新建文件夹', move: '移动', trash: '移至废纸篓', compress: '压缩',
};

function describeOp(op: AIFileOp): string {
  switch (op.type) {
    case 'rename':   return `${op.path.split('/').pop()} → ${op.newName}`;
    case 'mkdir':    return `新建 ${op.parentDir.split('/').pop()}/${op.name}`;
    case 'move':     return `${op.path.split('/').pop()} → ${op.targetDir.split('/').pop()}/`;
    case 'trash':    return `${op.path.split('/').pop() || op.path}（可从废纸篓恢复）`;
    case 'compress': return `${op.paths.length} 个文件 → ${op.outputName}`;
  }
}

const PRESETS = [
  '按类型整理到子文件夹',
  '重命名并加序号前缀',
  '去掉文件名里的空格和特殊字符',
  '把选中文件压缩打包',
  '移至废纸篓',
];

export default function AIRenamePanel({ files, currentDir, theme, onClose, onComplete }: AIRenamePanelProps) {
  const [instruction, setInstruction] = useState('');
  const [ops, setOps] = useState<AIFileOp[]>([]);
  const [summary, setSummary] = useState('');
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState('');
  const [progress, setProgress] = useState(0);
  const [opResults, setOpResults] = useState<('pending' | 'ok' | 'fail')[]>([]);

  const handleGenerate = useCallback(async () => {
    if (!instruction.trim()) return;
    setStatus('generating');
    setError('');
    const result = await generateFileOps(theme, {
      files: files.map(f => ({ name: f.name, path: f.path, isDir: f.type === 'folder' })),
      instruction: instruction.trim(),
      currentDir,
    });
    if (result.error) {
      setError(result.error);
      setStatus('error');
    } else {
      setOps(result.ops);
      setSummary(result.summary);
      setOpResults(result.ops.map(() => 'pending'));
      setStatus('previewing');
    }
  }, [instruction, files, currentDir, theme]);

  const handleExecute = useCallback(async () => {
    setStatus('executing');
    setProgress(0);
    const executedOps: AIExecutedOp[] = [];
    const results: ('ok' | 'fail')[] = [];

    for (let i = 0; i < ops.length; i++) {
      const op = ops[i];
      let resultPath: string | undefined;
      let status: 'ok' | 'fail' = 'ok';
      try {
        switch (op.type) {
          case 'rename': {
            const dir = op.path.split('/').slice(0, -1).join('/');
            resultPath = `${dir}/${op.newName}`;
            await renameFile(op.path, op.newName);
            break;
          }
          case 'mkdir':    await createFolder(op.parentDir, op.name); break;
          case 'move': {
            const name = op.path.split('/').pop()!;
            resultPath = `${op.targetDir}/${name}`;
            await moveFile(op.path, op.targetDir);
            break;
          }
          case 'trash':    await deleteToTrash(op.path); break;
          case 'compress': {
            resultPath = `${currentDir}/${op.outputName}`;
            await compressFiles(op.paths, resultPath);
            break;
          }
        }
      } catch {
        status = 'fail';
      }
      results.push(status);
      const { reverseOp, note } = buildReverseOp(op, resultPath);
      executedOps.push({ op, status, reverseOp, note });
      setProgress(i + 1);
      setOpResults([...results, ...ops.slice(results.length).map(() => 'pending' as const)]);
    }

    // 写操作日志
    const hasTrash = executedOps.some(e => e.op.type === 'trash');
    await saveOpSession({
      id: `ai-${Date.now()}`,
      timestamp: Date.now(),
      instruction,
      summary,
      ops: executedOps,
      canRollback: executedOps.some(e => e.status === 'ok' && e.reverseOp) && !hasTrash,
    });

    setStatus('done');
    setTimeout(onComplete, 1000);
  }, [ops, currentDir, instruction, summary, onComplete]);

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
        onClick={e => e.stopPropagation()}
        className="w-[760px] max-h-[620px] bg-surface/95 backdrop-blur-3xl rounded-3xl border border-primary/20 shadow-2xl flex flex-col overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-8 py-5 border-b border-primary/10">
          <div className="flex items-center gap-3">
            <Sparkles className="w-5 h-5 text-primary" />
            <h2 className="text-[17px] font-black text-on-surface">AI 文件助手</h2>
            <span className="text-[12px] text-on-surface/40 font-bold">
              {files.length} 个文件{files.length === 0 ? '' : ''}
            </span>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-primary/10 rounded-xl transition-colors">
            <X className="w-4 h-4 text-on-surface/50" />
          </button>
        </div>

        {/* Input */}
        <div className="px-8 py-5 border-b border-primary/10 space-y-3">
          <textarea
            value={instruction}
            onChange={e => setInstruction(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleGenerate(); } }}
            placeholder="描述你想做什么，例如：按类型整理到子文件夹、把图片重命名为日期格式、压缩这些文件..."
            className="w-full bg-primary/5 border border-primary/20 rounded-2xl px-5 py-4 text-[14px] text-on-surface outline-none focus:border-primary focus:ring-4 focus:ring-primary/10 resize-none h-20 transition-all"
            disabled={status === 'generating' || status === 'executing'}
          />
          <div className="flex items-center gap-2 flex-wrap">
            {PRESETS.map(p => (
              <button key={p} onClick={() => setInstruction(p)}
                className="px-3 py-1.5 text-[11px] font-bold text-on-surface/50 bg-primary/5 hover:bg-primary/10 hover:text-primary rounded-lg transition-colors">
                {p}
              </button>
            ))}
            <div className="flex-1" />
            <button onClick={handleGenerate}
              disabled={!instruction.trim() || status === 'generating' || status === 'executing'}
              className="px-5 py-2.5 bg-primary text-on-primary rounded-xl text-[13px] font-bold flex items-center gap-2 disabled:opacity-40 shadow-lg shadow-primary/20 transition-all">
              {status === 'generating' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
              {status === 'generating' ? '生成中...' : '生成计划'}
            </button>
          </div>
        </div>

        {/* Preview */}
        <div className="flex-1 overflow-y-auto px-8 py-5 min-h-0 space-y-3">
          {status === 'error' && (
            <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-2xl space-y-2">
              <div className="flex items-start gap-3">
                <AlertCircle className="w-4 h-4 shrink-0 text-red-500 mt-0.5" />
                <p className="text-[13px] text-red-500 font-medium break-all leading-relaxed">{error}</p>
              </div>
              <p className="text-[11px] text-red-400/70 pl-7">修改描述或检查 AI 配置后，可直接点「生成计划」重试</p>
            </div>
          )}

          {summary && (status === 'previewing' || status === 'executing' || status === 'done') && (
            <p className="text-[13px] text-on-surface/60 font-medium px-1">{summary}</p>
          )}

          {ops.length > 0 && (status === 'previewing' || status === 'executing' || status === 'done') && (
            <div className="space-y-1.5">
              {ops.map((op, i) => (
                <div key={i} className="flex items-center gap-3 px-4 py-2.5 rounded-xl bg-primary/5 border border-primary/10">
                  <span className="shrink-0">{OP_ICONS[op.type]}</span>
                  <span className="text-[11px] font-bold text-on-surface/40 shrink-0 w-16">{OP_LABELS[op.type]}</span>
                  <span className="text-[12px] font-mono text-on-surface/70 flex-1 truncate">{describeOp(op)}</span>
                  {opResults[i] === 'ok' && <Check className="w-3.5 h-3.5 text-green-500 shrink-0" />}
                  {opResults[i] === 'fail' && <AlertCircle className="w-3.5 h-3.5 text-red-500 shrink-0" />}
                  {status === 'executing' && opResults[i] === 'pending' && i === progress && <Loader2 className="w-3.5 h-3.5 text-primary animate-spin shrink-0" />}
                </div>
              ))}
            </div>
          )}

          {status === 'idle' && (
            <div className="flex items-center justify-center h-full text-on-surface/25 text-[14px] font-medium">
              描述你想做什么，AI 会生成操作计划供你确认
            </div>
          )}
        </div>

        {/* Footer */}
        {status === 'previewing' && ops.length > 0 && (
          <div className="px-8 py-5 border-t border-primary/10 space-y-3">
            {ops.some(op => op.type === 'trash') && (
              <p className="text-[11px] text-amber-500/80 font-medium flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0" />
                包含移至废纸篓操作，文件不会被永久删除，可随时从废纸篓恢复
              </p>
            )}
            <div className="flex items-center justify-between">
              <p className="text-[12px] text-on-surface/40">共 {ops.length} 步操作，确认后依次执行</p>
              <button onClick={handleExecute}
                className="px-6 py-3 bg-primary text-on-primary rounded-xl text-[13px] font-bold shadow-lg shadow-primary/20 hover:shadow-xl transition-all flex items-center gap-2">
                <Check className="w-4 h-4" /> 执行
              </button>
            </div>
          </div>
        )}
        {status === 'executing' && (
          <div className="px-8 py-5 border-t border-primary/10 flex items-center gap-3">
            <Loader2 className="w-4 h-4 animate-spin text-primary" />
            <span className="text-[13px] font-bold text-on-surface/60">执行中 {progress}/{ops.length}</span>
            <div className="flex-1 h-1.5 bg-primary/10 rounded-full overflow-hidden">
              <div className="h-full bg-primary rounded-full transition-all" style={{ width: `${(progress / ops.length) * 100}%` }} />
            </div>
          </div>
        )}
      </motion.div>
    </motion.div>
  );
}
