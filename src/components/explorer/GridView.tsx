import React from 'react';
import { motion } from 'motion/react';
import { ChevronRight, ChevronsDown, ChevronsUp } from 'lucide-react';
import type { TFunction } from 'i18next';
import type { FileItem, GroupBy, ThemeSettings } from '../../types';

type GridViewProps = {
  currentLevelFiles: FileItem[];
  groupBy: GroupBy;
  groupedFiles: Record<string, FileItem[]>;
  handleContainerScroll: () => void;
  renderFileItem: (file: FileItem, isColumnItem?: boolean, sortIndex?: number, sourceColumnIndex?: number) => React.ReactNode;
  scrollContainerRef: React.RefObject<HTMLDivElement | null>;
  scrollToBottom: () => void;
  scrollToTop: () => void;
  t: TFunction;
  theme: ThemeSettings;
};

export default function GridView({
  currentLevelFiles,
  groupBy,
  groupedFiles,
  handleContainerScroll,
  renderFileItem,
  scrollContainerRef,
  scrollToBottom,
  scrollToTop,
  t,
  theme,
}: GridViewProps) {
  if (currentLevelFiles.length === 0) return null;

  const minColumnWidth = Math.max(
    theme.gridWidth || theme.gridSize || 180,
    theme.mediaGridLinked === false
      ? (theme.mediaGridWidth || theme.gridWidth || theme.gridSize || 180)
      : (theme.gridWidth || theme.gridSize || 180),
  );
  const rowHeight = Math.max(
    theme.gridHeight || theme.gridSize || 180,
    theme.mediaGridLinked === false
      ? (theme.mediaGridHeight || theme.gridHeight || theme.gridSize || 180)
      : (theme.gridHeight || theme.gridSize || 180),
  );

  return (
    <div ref={scrollContainerRef} onScroll={handleContainerScroll} className="relative flex-1 min-h-0 overflow-y-auto overflow-x-hidden pb-32 custom-scrollbar">
      <div className="space-y-8">
        {(Object.entries(groupedFiles) as [string, FileItem[]][]).map(([groupName, files]) => (
          <div key={groupName} className="space-y-4">
            {groupBy !== 'none' && (
              <h3 className="text-[14px] font-bold text-on-surface/40 px-2 uppercase tracking-widest flex items-center gap-2">
                <ChevronRight className="w-4 h-4" /> {groupName} ({files.length})
              </h3>
            )}
            <div
              className="grid gap-6"
              style={{
                gridTemplateColumns: `repeat(auto-fill, minmax(${minColumnWidth}px, 1fr))`,
                gap: `${theme.gridGap || 16}px`,
                gridAutoRows: `${rowHeight}px`,
              }}
            >
              {files.map((file, i) => renderFileItem(file, false, i + 1))}
            </div>
          </div>
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
  );
}
