import React from 'react';
import type { TFunction } from 'i18next';
import type { FileItem, GroupBy, ThemeSettings } from '../../types';
import { resolveColumnPaneDirectory } from '../../lib/column-navigation';

type ColumnViewProps = {
  allColumns: Array<string | undefined>;
  columnFilesCache: Record<string, FileItem[]>;
  columnLoadErrors: Record<string, string>;
  currentLevelFiles: FileItem[];
  currentPath: string;
  getColumnFiles: (parentPath: string | undefined) => FileItem[];
  getGroupKey: (file: FileItem, groupBy: GroupBy) => string;
  groupBy: GroupBy;
  handleContextMenu: (event: React.MouseEvent, fileIds: string[], isBlank?: boolean, targetDir?: string) => void | Promise<void>;
  renderFileItem: (file: FileItem, isColumnItem?: boolean, sortIndex?: number, sourceColumnIndex?: number) => React.ReactNode;
  scrollContainerRef: React.RefObject<HTMLDivElement | null>;
  t: TFunction;
  theme: ThemeSettings;
};

export default function ColumnView({
  allColumns,
  columnFilesCache,
  columnLoadErrors,
  currentLevelFiles,
  currentPath,
  getColumnFiles,
  getGroupKey,
  groupBy,
  handleContextMenu,
  renderFileItem,
  scrollContainerRef,
  t,
  theme,
}: ColumnViewProps) {
  if (currentLevelFiles.length === 0) return null;

  return (
    <div ref={scrollContainerRef} className="relative flex-1 min-h-0 overflow-x-auto overflow-y-hidden pb-4 custom-scrollbar">
      <div className="flex h-full min-w-max flex-nowrap">
        {allColumns.map((parentId, colIndex) => {
          const filesInCol = getColumnFiles(parentId);
          const columnTargetDir = resolveColumnPaneDirectory(currentPath, parentId);
          const columnError = parentId ? columnLoadErrors[parentId] : '';
          const columnHasLoaded = !parentId || Object.prototype.hasOwnProperty.call(columnFilesCache, parentId);
          const columnIsLoading = Boolean(parentId && !columnHasLoaded && !columnError);
          const groupedColumnFiles: Record<string, FileItem[]> = {};
          if (groupBy === 'none') {
            groupedColumnFiles[t('explorer.groupAllFiles', '全部项目')] = filesInCol;
          } else {
            filesInCol.forEach(file => {
              const key = getGroupKey(file, groupBy);
              if (!groupedColumnFiles[key]) groupedColumnFiles[key] = [];
              groupedColumnFiles[key].push(file);
            });
          }

          return (
            <div
              key={`col-${colIndex}-${parentId || 'root'}`}
              className="h-full min-w-0 shrink-0 flex flex-col border-r border-on-surface/10 bg-primary/5"
              style={{ width: `${theme.columnWidth || 280}px` }}
              onContextMenu={(event) => {
                if ((event.target as HTMLElement).closest('.file-item')) return;
                void handleContextMenu(event, [], true, columnTargetDir);
              }}
            >
              <h4 className="text-[12px] font-black text-on-surface uppercase tracking-[0.15em] px-4 py-3 shrink-0 truncate">
                {parentId ? parentId.split('/').pop() : t('explorer.localStorage')}
              </h4>
              <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden custom-scrollbar px-2 space-y-1">
                {columnError ? (
                  <div className="px-3 py-4 text-[12px] font-bold leading-relaxed text-red-400/80">
                    {t('messages.loadFailed', { error: columnError, defaultValue: `读取失败：${columnError}` })}
                  </div>
                ) : columnIsLoading ? (
                  <div className="px-3 py-4 text-[12px] font-bold text-on-surface/35">
                    {t('explorer.loading', '正在加载...')}
                  </div>
                ) : filesInCol.length === 0 ? (
                  <div className="px-3 py-4 text-[12px] font-bold text-on-surface/30">
                    {t('explorer.emptyFolder', '此文件夹为空')}
                  </div>
                ) : (
                  Object.entries(groupedColumnFiles).map(([groupName, files]) => (
                    <React.Fragment key={groupName}>
                      {groupBy !== 'none' && (
                        <div className="text-[10px] font-black text-primary px-3 py-1 mt-2 mb-1 bg-primary/10 rounded uppercase tracking-wider">
                          {groupName}
                        </div>
                      )}
                      {files.map(file => renderFileItem(file, true, undefined, colIndex))}
                    </React.Fragment>
                  ))
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
