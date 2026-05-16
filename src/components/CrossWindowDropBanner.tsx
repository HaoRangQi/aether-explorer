import { useEffect, useRef, useState } from 'react';
import type { MouseEvent as ReactMouseEvent } from 'react';
import { Copy, ArrowRightLeft, X } from 'lucide-react';
import type { TFunction } from 'i18next';

export interface IncomingFileDragView {
  paths: string[];
  sourceWindow: string;
  transferId: string;
  previewName: string;
  count: number;
  cut: boolean;
  shownAt: number;
}

interface Props {
  drag: IncomingFileDragView;
  currentPath: string;
  defaultMode: 'copy' | 'move' | 'ask';
  visibleMs: number;
  onAccept: (op: 'copy' | 'move') => void;
  onCancel: () => void;
  t: TFunction;
}

/**
 * 跨窗口拖拽到达提示。
 *
 * 设计要点：
 * - 不立即响应任何 drag-end 系列事件 — 用户拖到目标窗口后必须有充足时间看清。
 * - 默认动作来自 theme.crossWindowDropDefault；修饰键临时覆盖（⌘ 切换、⌥ 复制、⇧ 移动）。
 * - ask 模式提供并列两个按钮，强制用户显式选择，没有"默认"动作。
 * - 视觉上的倒计时进度条暗示剩余时间，不让用户惊讶 banner 突然消失。
 */
export default function CrossWindowDropBanner({
  drag,
  currentPath,
  defaultMode,
  visibleMs,
  onAccept,
  onCancel,
  t,
}: Props) {
  const [remainingPct, setRemainingPct] = useState(100);
  const startedRef = useRef(drag.shownAt);

  useEffect(() => {
    startedRef.current = drag.shownAt;
    let raf = 0;
    const tick = () => {
      const elapsed = Date.now() - startedRef.current;
      const pct = Math.max(0, 100 - (elapsed / visibleMs) * 100);
      setRemainingPct(pct);
      if (pct > 0) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [drag.shownAt, visibleMs]);

  // ESC 取消
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCancel();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  const resolveOp = (e: ReactMouseEvent): 'copy' | 'move' => {
    if (e.altKey) return 'copy';   // ⌥ 强制复制
    if (e.shiftKey) return 'move'; // ⇧ 强制移动
    if (defaultMode === 'copy') return e.metaKey ? 'move' : 'copy';
    if (defaultMode === 'move') return e.metaKey ? 'copy' : 'move';
    return 'copy'; // ask 模式的默认值（实际由按钮路径决定）
  };

  const isAsk = defaultMode === 'ask';

  return (
    <div
      className="absolute inset-0 z-40 flex items-center justify-center bg-primary/15 backdrop-blur-md border-2 border-dashed border-primary/70 rounded-2xl m-2 cursor-pointer animate-in fade-in duration-200"
      onClick={(e) => {
        if (isAsk) return; // ask 模式必须点按钮
        e.stopPropagation();
        onAccept(resolveOp(e));
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onCancel();
      }}
    >
      <div className="bg-surface/95 rounded-2xl px-7 py-6 shadow-2xl text-center max-w-lg pointer-events-auto relative overflow-hidden">
        {/* 倒计时进度条 */}
        <div className="absolute top-0 left-0 right-0 h-1 bg-primary/10">
          <div
            className="h-full bg-primary transition-[width] duration-100 ease-linear"
            style={{ width: `${remainingPct}%` }}
          />
        </div>

        {/* 取消按钮 */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            onCancel();
          }}
          className="absolute top-2 right-2 p-1.5 rounded-lg text-on-surface/40 hover:text-on-surface hover:bg-primary/10 transition-colors"
          title={t('crossWindow.cancel', { defaultValue: '取消（ESC）' })}
        >
          <X className="w-4 h-4" />
        </button>

        <div className="text-on-surface text-base font-bold mb-1.5 mt-2">
          {t('crossWindow.incomingTitle', {
            count: drag.count,
            defaultValue: '来自其他窗口的 {{count}} 个项目',
          })}
        </div>

        <div className="text-on-surface/70 text-xs mb-4 truncate font-mono">
          {drag.previewName}
        </div>

        <div className="text-on-surface/85 text-sm mb-1">
          {t('crossWindow.targetPath', {
            defaultValue: '目标目录',
          })}
        </div>
        <div className="text-primary text-xs font-mono mb-4 truncate">
          {currentPath || t('crossWindow.unknownPath', { defaultValue: '（当前没有真实目录）' })}
        </div>

        {isAsk ? (
          <div className="flex gap-3 justify-center">
            <button
              onClick={(e) => {
                e.stopPropagation();
                onAccept('copy');
              }}
              className="px-5 py-2.5 rounded-xl bg-primary text-on-primary text-sm font-bold flex items-center gap-2 hover:scale-[1.02] active:scale-95 transition-transform shadow-lg"
            >
              <Copy className="w-4 h-4" />
              {t('crossWindow.copyHere', { defaultValue: '复制到此' })}
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onAccept('move');
              }}
              className="px-5 py-2.5 rounded-xl bg-primary/15 text-primary text-sm font-bold flex items-center gap-2 hover:bg-primary/25 active:scale-95 transition-all"
            >
              <ArrowRightLeft className="w-4 h-4" />
              {t('crossWindow.moveHere', { defaultValue: '移动到此' })}
            </button>
          </div>
        ) : (
          <>
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-primary/15 text-primary text-sm font-bold">
              {defaultMode === 'move' ? (
                <>
                  <ArrowRightLeft className="w-4 h-4" />
                  {t('crossWindow.clickToMove', { defaultValue: '点击移动到此' })}
                </>
              ) : (
                <>
                  <Copy className="w-4 h-4" />
                  {t('crossWindow.clickToCopy', { defaultValue: '点击复制到此' })}
                </>
              )}
            </div>
            <div className="text-on-surface/55 text-[11px] mt-3 leading-relaxed">
              {defaultMode === 'move'
                ? t('crossWindow.modifierHintMoveDefault', {
                    defaultValue: '⌘ 改为复制 · ⌥ 强制复制 · ⇧ 强制移动 · 右键 / ESC 取消',
                  })
                : t('crossWindow.modifierHintCopyDefault', {
                    defaultValue: '⌘ 改为移动 · ⌥ 强制复制 · ⇧ 强制移动 · 右键 / ESC 取消',
                  })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
