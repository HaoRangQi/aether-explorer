import { useEffect, useRef, useState } from 'react';
import { Copy, ArrowRightLeft, HelpCircle } from 'lucide-react';
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
  t: TFunction;
}

/**
 * 跨窗口拖拽悬停提示。
 *
 * 行为：纯视觉反馈，不接收任何点击。
 * - dragstart 后由父组件挂载、dragEnd 后立即卸载
 * - 用户「松开鼠标」是唯一触发动作的事件，由父组件根据屏幕坐标 + 修饰键统一判定
 * - banner 自己不做任何决策，只回答：现在拖到了哪个 Aether 窗口、按当前设置会发生什么
 */
export default function CrossWindowDropBanner({
  drag,
  currentPath,
  defaultMode,
  visibleMs,
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

  const actionIcon = defaultMode === 'move' ? <ArrowRightLeft className="w-4 h-4" />
    : defaultMode === 'ask' ? <HelpCircle className="w-4 h-4" />
    : <Copy className="w-4 h-4" />;

  const actionText = defaultMode === 'move'
    ? t('crossWindow.releaseToMove', { defaultValue: '松开鼠标即可移动到此' })
    : defaultMode === 'ask'
      ? t('crossWindow.releaseToAsk', { defaultValue: '松开鼠标后选择动作' })
      : t('crossWindow.releaseToCopy', { defaultValue: '松开鼠标即可复制到此' });

  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center bg-primary/15 backdrop-blur-md border-2 border-dashed border-primary/70 rounded-2xl m-2 pointer-events-none animate-in fade-in duration-150">
      <div className="bg-surface/95 rounded-2xl px-7 py-6 shadow-2xl text-center max-w-lg relative overflow-hidden">
        {/* 倒计时进度条（兜底，正常松手前就会消失） */}
        <div className="absolute top-0 left-0 right-0 h-0.5 bg-primary/10">
          <div
            className="h-full bg-primary/60 transition-[width] duration-100 ease-linear"
            style={{ width: `${remainingPct}%` }}
          />
        </div>

        <div className="text-on-surface text-base font-bold mb-1.5 mt-1">
          {t('crossWindow.incomingTitle', {
            count: drag.count,
            defaultValue: '来自其他窗口的 {{count}} 个项目',
          })}
        </div>

        <div className="text-on-surface/60 text-xs mb-4 truncate font-mono">
          {drag.previewName}
        </div>

        <div className="text-on-surface/85 text-sm mb-1">
          {t('crossWindow.targetPath', { defaultValue: '目标目录' })}
        </div>
        <div className="text-primary text-xs font-mono mb-4 truncate">
          {currentPath || t('crossWindow.unknownPath', { defaultValue: '（当前没有真实目录）' })}
        </div>

        <div className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-primary/15 text-primary text-sm font-bold">
          {actionIcon}
          {actionText}
        </div>

        <div className="text-on-surface/45 text-[11px] mt-3 leading-relaxed">
          {t('crossWindow.modifierHintGlobal', {
            defaultValue: '拖回去或松到别处即可取消 · ⌥ 强制复制 · ⇧ 强制移动 · ⌘ 切换默认',
          })}
        </div>
      </div>
    </div>
  );
}
