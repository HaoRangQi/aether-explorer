import type { DragEvent, MouseEvent } from 'react';
import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, X } from 'lucide-react';
import { ViewMode, ThemeSettings, TabData } from '../types';
import { currentWindowLabel, safeCurrentWindow, safeEmit, safeInvoke, safeListen } from '../lib/tauri-runtime';

export interface TabTransferPayload {
  transferId: string;
  sourceWindowLabel: string;
  tab: TabData;
}

interface TopBarProps {
  currentView: ViewMode;
  onViewChange: (view: ViewMode) => void;
  theme: ThemeSettings;
  tabs: TabData[];
  onCloseTab: (id: string) => void;
  onDetachTab: (tab: TabData) => void;
  onAcceptDraggedTab: (payload: TabTransferPayload) => void;
  onCreateWindow: () => void;
}

const TAB_TRANSFER_MIME = 'application/x-aether-tab';
const TAB_TRANSFER_STORAGE_KEY = 'aether-dragging-tab';

export default function TopBar({ currentView, onViewChange, theme, tabs, onCloseTab, onDetachTab, onAcceptDraggedTab, onCreateWindow }: TopBarProps) {
  const { t } = useTranslation();
  const liquidGlassEnabled = theme.enableLiquidGlass === true;
  const [isDragOver, setIsDragOver] = useState(false);
  const [globalDragData, setGlobalDragData] = useState<TabTransferPayload | null>(null);
  const clearTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isAcceptedRef = useRef(false); // 防止重复显示

  // 清理拖拽状态的统一函数
  const clearDragState = () => {
    if (clearTimeoutRef.current) {
      clearTimeout(clearTimeoutRef.current);
      clearTimeoutRef.current = null;
    }
    setGlobalDragData(null);
  };

  // 监听全局拖拽事件
  useEffect(() => {
    const unlisten = safeListen<TabTransferPayload>('aether-tab-drag-start', (event) => {
      // 如果已经接受了，忽略
      if (isAcceptedRef.current) return;

      // 清除之前的超时
      if (clearTimeoutRef.current) {
        clearTimeout(clearTimeoutRef.current);
      }

      setGlobalDragData(event.payload);

      // 设置 5 秒后自动清空
      clearTimeoutRef.current = setTimeout(() => {
        clearDragState();
      }, 5000);
    });

    const unlisten2 = safeListen('aether-tab-drag-end', () => {
      clearDragState();
    });

    return () => {
      unlisten.then(fn => fn());
      unlisten2.then(fn => fn());
      if (clearTimeoutRef.current) clearTimeout(clearTimeoutRef.current);
    };
  }, []);

  const handleDragStart = (e: MouseEvent) => {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (target.closest('button, input, a, [data-no-drag]')) return;
    safeCurrentWindow().startDragging().catch(() => {
      safeInvoke('start_window_drag').catch(() => {});
    });
  };

  const createTransferPayload = (tab: TabData): TabTransferPayload => ({
    transferId: `tab-transfer-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    sourceWindowLabel: currentWindowLabel(),
    tab: {
      ...tab,
      initialPath: tab.currentPath || tab.initialPath,
    },
  });

  const handleTabDragStart = (event: DragEvent<HTMLDivElement>, tab: TabData) => {
    const payload = createTransferPayload(tab);
    const serialized = JSON.stringify(payload);
    event.stopPropagation();
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData(TAB_TRANSFER_MIME, serialized);
    // 不设置 text/plain，避免拖到桌面时创建文件
    localStorage.setItem(TAB_TRANSFER_STORAGE_KEY, serialized);
    event.currentTarget.dataset.transferId = payload.transferId;

    safeEmit('aether-tab-drag-start', payload).catch(() => {});
  };

  const handleTabDragEnd = (event: DragEvent<HTMLDivElement>, tab: TabData) => {
    const transferId = event.currentTarget.dataset.transferId;
    delete event.currentTarget.dataset.transferId;

    if (!transferId) return;

    // 检查是否拖拽到窗口外（dropEffect 为 'none' 表示没有有效的放置目标）
    if (event.dataTransfer.dropEffect === 'none') {
      // 延迟清除 localStorage，给目标窗口时间读取数据
      setTimeout(() => {
        localStorage.removeItem(TAB_TRANSFER_STORAGE_KEY);
      }, 100);

      // 等待 500ms，如果没有收到确认事件，说明是拖到空白处，创建新窗口
      const detachTimeout = setTimeout(() => {
        onDetachTab(tab);
      }, 500);

      // 将 timeout ID 存储到 window 对象，以便确认事件可以取消它
      (window as any)[`detach-timeout-${transferId}`] = detachTimeout;
    } else {
      // 如果拖拽到了有效目标，延迟清除
      setTimeout(() => {
        localStorage.removeItem(TAB_TRANSFER_STORAGE_KEY);
      }, 100);
    }
  };

  const readTransferPayload = (event: DragEvent<HTMLElement>) => {
    const raw = event.dataTransfer.getData(TAB_TRANSFER_MIME) || localStorage.getItem(TAB_TRANSFER_STORAGE_KEY);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as TabTransferPayload;
    } catch {
      return null;
    }
  };

  const handleTabsDragOver = (event: DragEvent<HTMLDivElement>) => {
    // 检查是否有全局拖拽数据
    if (!globalDragData) {
      return;
    }

    // 检查是否是从其他窗口拖拽过来的
    const windowLabel = currentWindowLabel();
    if (globalDragData.sourceWindowLabel === windowLabel) {
      return;
    }

    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    setIsDragOver(true);
  };

  const handleTabsDragLeave = (event: DragEvent<HTMLDivElement>) => {
    setIsDragOver(false);
  };

  const handleTabsDrop = (event: DragEvent<HTMLDivElement>) => {
    setIsDragOver(false);

    if (!globalDragData) {
      return;
    }

    event.preventDefault();
    onAcceptDraggedTab(globalDragData);
  };

  return (
    <header
      className={`${liquidGlassEnabled ? 'liquid-nav border-white/10' : 'border-transparent'} border-b flex flex-col z-50 shrink-0 select-none`}
      onMouseDown={handleDragStart}
      data-tauri-drag-region
    >
      <div
        className="h-3 shrink-0 cursor-grab active:cursor-grabbing"
        data-tauri-drag-region
        onMouseDown={handleDragStart}
        title={t('tooltips.dragWindow')}
      />
      {/* Navigation Tabs */}
      <div
        className={`flex items-center px-6 gap-3 relative z-0 pt-1 pb-2.5 shrink-0 min-w-0 transition-all duration-300 ${
          isDragOver ? 'ring-2 ring-primary ring-inset rounded-lg' : ''
        }`}
        onDragOver={handleTabsDragOver}
        onDragLeave={handleTabsDragLeave}
        onDrop={handleTabsDrop}
        style={{ minHeight: '48px' }}
      >
        {/* 拖拽放置提示 */}
        {globalDragData && globalDragData.sourceWindowLabel !== currentWindowLabel() && (
          <div
            className="absolute inset-0 flex items-center justify-center bg-primary/20 backdrop-blur-sm rounded-lg border-2 border-primary border-dashed z-50 cursor-pointer"
            onClick={(e) => {
              e.stopPropagation();
              // 标记已接受，阻止后续事件重新显示
              isAcceptedRef.current = true;
              // 立即清除拖拽状态
              clearDragState();
              // 广播结束事件
              safeEmit('aether-tab-drag-end');
              // 执行标签页接受
              onAcceptDraggedTab(globalDragData);
              // 重置标记
              setTimeout(() => { isAcceptedRef.current = false; }, 500);
            }}
          >
            <div className="text-primary font-bold text-sm px-4 py-2 bg-surface/90 rounded-full shadow-lg pointer-events-none">
              点击此处放置标签页
            </div>
          </div>
        )}
        <div
          className="flex justify-start gap-2 overflow-x-auto scrollbar-hide flex-1 min-w-0"
          data-no-drag
          onWheel={(e) => {
            if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
              e.currentTarget.scrollLeft += e.deltaY;
              e.preventDefault();
            }
          }}
        >
          {tabs.map((tab) => {
            const isActive = currentView === tab.id;
            return (
              <div
                key={tab.id}
                draggable
                onDragStart={(event) => handleTabDragStart(event, tab)}
                onDragEnd={(event) => handleTabDragEnd(event, tab)}
                className={`relative flex items-center justify-center shrink-0 group rounded-full transition-all cursor-grab active:cursor-grabbing border
                  ${liquidGlassEnabled
                    ? isActive ? 'liquid-tab-active text-primary' : 'liquid-tab text-on-surface/70 hover:text-on-surface hover:border-primary/30'
                    : isActive ? 'text-primary bg-primary/40 shadow-[0_2px_10px_rgba(var(--primary-rgb),0.3)] border-primary/60' : 'text-on-surface/70 hover:text-on-surface bg-primary/20 hover:bg-primary/30 border-transparent'}
                `}
                style={{ minWidth: '90px', maxWidth: '220px' }}
              >
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onCloseTab(tab.id);
                  }}
                  className={`absolute left-1.5 p-1 rounded-full transition-all opacity-0 group-hover:opacity-100 z-10
                    ${isActive ? 'hover:bg-primary/20 text-primary' : 'hover:bg-on-surface/[0.08] text-on-surface/60 hover:text-on-surface'}
                  `}
                >
                  <X className="w-3.5 h-3.5" />
                </button>

                <button
                  onClick={() => onViewChange(tab.id as ViewMode)}
                  className={`py-1.5 px-7 text-[12px] transition-all whitespace-nowrap w-full text-center overflow-hidden text-ellipsis
                    ${isActive ? 'font-bold' : 'font-medium'}
                  `}
                  title={tab.label || t(tab.labelTranslationKey)}
                >
                  {tab.label || t(tab.labelTranslationKey)}
                </button>
              </div>
            );
          })}
        </div>
        <div
          className="w-6 self-stretch shrink-0 cursor-grab active:cursor-grabbing"
          data-tauri-drag-region
          onMouseDown={handleDragStart}
          title={t('tooltips.dragWindow')}
        />
      </div>
    </header>
  );
}
