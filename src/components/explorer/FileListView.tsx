import React from 'react';
import { motion } from 'motion/react';
import { ChevronRight, ChevronsDown, ChevronsUp } from 'lucide-react';
import type { TFunction } from 'i18next';
import type { FileItem, GroupBy } from '../../types';
import { LIST_COLS } from './view-constants';

type VisibleRange = {
  start: number;
  end: number;
  totalHeight: number;
  offsetTop: number;
};

type FileListViewProps = {
  currentLevelFiles: FileItem[];
  fileListRef: React.RefObject<HTMLDivElement | null>;
  groupBy: GroupBy;
  groupedFiles: Record<string, FileItem[]>;
  handleContainerScroll: () => void;
  handleSort: (key: string) => void;
  listItemHeight: number;
  listModifiedColClass: string;
  onSelectFiles: (ids: string[]) => void;
  renderFileItem: (file: FileItem, isColumnItem?: boolean, sortIndex?: number, sourceColumnIndex?: number) => React.ReactNode;
  scrollContainerRef: React.RefObject<HTMLDivElement | null>;
  scrollToBottom: () => void;
  scrollToTop: () => void;
  selectedFileIds: string[];
  showCheckboxCol: boolean;
  showSortCol: boolean;
  sortConfig: { key: string; direction: 'asc' | 'desc' } | null;
  t: TFunction;
  visibleRange: VisibleRange | null;
};

export default function FileListView({
  currentLevelFiles,
  fileListRef,
  groupBy,
  groupedFiles,
  handleContainerScroll,
  handleSort,
  listItemHeight,
  listModifiedColClass,
  onSelectFiles,
  renderFileItem,
  scrollContainerRef,
  scrollToBottom,
  scrollToTop,
  selectedFileIds,
  showCheckboxCol,
  showSortCol,
  sortConfig,
  t,
  visibleRange,
}: FileListViewProps) {
  if (currentLevelFiles.length === 0) return null;

  const allSelected = currentLevelFiles.length > 0 && currentLevelFiles.every(file => selectedFileIds.includes(file.id));
  const someSelected = selectedFileIds.length > 0 && !allSelected;

  return (
    <div ref={scrollContainerRef} onScroll={handleContainerScroll} className="relative flex-1 min-h-0 overflow-y-auto overflow-x-hidden pb-32 custom-scrollbar">
      <div className="min-w-[760px] flex flex-col">
        <div className="sticky top-0 z-20 shrink-0 flex items-center px-4 py-3 pr-4 text-[12px] font-black text-on-surface select-none uppercase tracking-[0.1em] border-b border-primary/20 mb-2 bg-primary/10 rounded-t-xl backdrop-blur-xl">
          {showCheckboxCol && (
            <div className={`${LIST_COLS.checkbox} shrink-0 mr-2 flex items-center justify-center`}>
              <input
                type="checkbox"
                checked={allSelected}
                ref={el => { if (el) el.indeterminate = someSelected; }}
                onChange={event => onSelectFiles(event.target.checked ? currentLevelFiles.map(file => file.id) : [])}
                className="w-3.5 h-3.5 accent-primary cursor-pointer"
              />
            </div>
          )}
          {showSortCol && <div className={`${LIST_COLS.sortNum} shrink-0 text-on-surface/30 text-[10px] pl-1`}>#</div>}
          <div
            className="flex items-center gap-2 cursor-pointer hover:text-primary transition-colors pr-4 flex-1 min-w-0"
            onClick={() => handleSort('name')}
          >
            <span className="truncate">{t('explorer.name', '文件名')}</span>
            {sortConfig?.key === 'name' && <span className="shrink-0">{sortConfig.direction === 'asc' ? '↑' : '↓'}</span>}
          </div>
          <div
            className={`${listModifiedColClass} shrink-0 cursor-pointer hover:text-primary transition-colors pl-1.5`}
            onClick={() => handleSort('modified')}
          >
            <span className="truncate min-w-0 flex items-center gap-2">
              {t('explorer.modified', '修改日期')}
              {sortConfig?.key === 'modified' && <span>{sortConfig.direction === 'asc' ? '↑' : '↓'}</span>}
            </span>
          </div>
          <div
            className={`${LIST_COLS.size} shrink-0 cursor-pointer hover:text-primary transition-colors pl-2 text-right`}
            onClick={() => handleSort('size')}
          >
            <span className="truncate flex items-center justify-end gap-2">
              {t('explorer.size', '大小')}
              {sortConfig?.key === 'size' && <span>{sortConfig.direction === 'asc' ? '↑' : '↓'}</span>}
            </span>
          </div>
          <div
            className={`${LIST_COLS.type} shrink-0 cursor-pointer hover:text-primary transition-colors pl-2 text-right`}
            onClick={() => handleSort('type')}
          >
            <span className="truncate flex items-center justify-end gap-2">
              {t('explorer.type', '类型')}
              {sortConfig?.key === 'type' && <span>{sortConfig.direction === 'asc' ? '↑' : '↓'}</span>}
            </span>
          </div>
          <div className={`${LIST_COLS.actions} shrink-0`} />
        </div>
        <div className="space-y-2" ref={fileListRef}>
          {(Object.entries(groupedFiles) as [string, FileItem[]][]).map(([groupName, files]) => (
            <React.Fragment key={groupName}>
              {groupBy !== 'none' && (
                <div className="px-4 py-2 mt-4 text-[12px] font-bold text-primary bg-primary/5 rounded-lg flex items-center gap-2">
                  <ChevronRight className="w-4 h-4" /> {groupName}
                </div>
              )}
              {groupBy === 'none' && visibleRange ? (
                <>
                  <div style={{ height: visibleRange.offsetTop }} />
                  {files.slice(visibleRange.start, visibleRange.end).map((file, i) => renderFileItem(file, false, visibleRange.start + i + 1))}
                  <div style={{ height: Math.max(0, visibleRange.totalHeight - visibleRange.end * listItemHeight) }} />
                </>
              ) : (
                files.map((file, i) => renderFileItem(file, false, i + 1))
              )}
            </React.Fragment>
          ))}
        </div>
        <div className="sticky bottom-4 ml-auto mr-3 flex w-8 flex-col gap-1.5 z-[40]">
          <motion.button
            whileHover={{ y: -1 }}
            whileTap={{ scale: 0.94 }}
            onClick={scrollToTop}
            className="w-8 h-8 flex items-center justify-center text-on-surface/45 hover:text-primary hover:bg-primary/10 rounded-lg transition-all backdrop-blur-xl"
            title={t('explorer.scrollToTop', '回到顶部')}
          >
            <ChevronsUp className="w-4 h-4" />
          </motion.button>
          <motion.button
            whileHover={{ y: 1 }}
            whileTap={{ scale: 0.94 }}
            onClick={scrollToBottom}
            className="w-8 h-8 flex items-center justify-center text-on-surface/45 hover:text-primary hover:bg-primary/10 rounded-lg transition-all backdrop-blur-xl"
            title={t('explorer.scrollToBottom', '回到底部')}
          >
            <ChevronsDown className="w-4 h-4" />
          </motion.button>
        </div>
      </div>
    </div>
  );
}
