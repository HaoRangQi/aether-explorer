import { ChevronRight, MoreVertical } from 'lucide-react';
import { motion } from 'motion/react';
import type React from 'react';
import type { TFunction } from 'i18next';
import type { DisplayMode, FileItem, ThemeSettings } from '../../types';
import { isRemotePath } from '../../lib/path-helpers';
import { getRelativeTimeLabel } from './explorer-utils';
import { LIST_COLS, LIST_MODIFIED_COL_BY_DENSITY } from './view-constants';

type FileIconRenderer = (target: FileItem | FileItem['type'], thumbnailOverride?: string) => React.ReactNode;

export type ExplorerFileItemRendererProps = {
  columnPaths: string[];
  displayMode: DisplayMode;
  dragOverFolderId: string | null;
  file: FileItem;
  fileTags: Record<string, string[]>;
  formatFileMeta: (file: FileItem) => string;
  getFileIcon: FileIconRenderer;
  getFileTypeLabel: (type: FileItem['type']) => string;
  handleContextMenu: (event: React.MouseEvent, fileIds: string[], isBlank?: boolean, targetDir?: string) => void | Promise<void>;
  handleDoubleClick: (file: FileItem) => void;
  handleDragEnd: (event: React.DragEvent) => void;
  handleDragLeave: (event: React.DragEvent, fileId: string) => void;
  handleDragOver: (event: React.DragEvent, fileId: string) => void;
  handleDragStart: (event: React.DragEvent, file: FileItem) => void;
  handleDrop: (event: React.DragEvent, targetFolderId: string) => void | Promise<void>;
  handleFileMouseDown: (event: React.MouseEvent, file: FileItem) => void;
  handleRenameCancel: () => void;
  handleRenameSubmit: () => void | Promise<void>;
  handleSelectFile: (file: FileItem, event: React.MouseEvent | React.KeyboardEvent, sourceColumnIndex?: number) => void;
  handleVideoMetadataLoaded: (file: FileItem, duration: number) => void;
  isColumnItem?: boolean;
  onSelectFiles: (ids: string[]) => void;
  openFileActionsMenu: (event: React.MouseEvent, file: FileItem) => void | Promise<void>;
  pulseFileId: string | null;
  renameInput: string;
  renamingFile: FileItem | null;
  selectedFileIds: string[];
  setRenameInput: React.Dispatch<React.SetStateAction<string>>;
  showCheckboxCol: boolean;
  showSortCol: boolean;
  sortIndex?: number;
  sourceColumnIndex?: number;
  t: TFunction;
  tagColors: Record<string, string>;
  theme: ThemeSettings;
};

function formatFileName(name: string) {
  if (name.length <= 40) return name;
  const lastDotIndex = name.lastIndexOf('.');
  if (lastDotIndex === -1 || name.length - lastDotIndex > 10) {
    return `${name.substring(0, 20)}...${name.substring(name.length - 15)}`;
  }
  const ext = name.substring(lastDotIndex);
  const base = name.substring(0, lastDotIndex);
  return `${base.substring(0, 25)}...${ext}`;
}

export default function FileItemRenderer({
  columnPaths,
  displayMode,
  dragOverFolderId,
  file,
  fileTags,
  formatFileMeta,
  getFileIcon,
  getFileTypeLabel,
  handleContextMenu,
  handleDoubleClick,
  handleDragEnd,
  handleDragLeave,
  handleDragOver,
  handleDragStart,
  handleDrop,
  handleFileMouseDown,
  handleRenameCancel,
  handleRenameSubmit,
  handleSelectFile,
  handleVideoMetadataLoaded,
  isColumnItem = false,
  onSelectFiles,
  openFileActionsMenu,
  pulseFileId,
  renameInput,
  renamingFile,
  selectedFileIds,
  setRenameInput,
  showCheckboxCol,
  showSortCol,
  sortIndex,
  sourceColumnIndex,
  t,
  tagColors,
  theme,
}: ExplorerFileItemRendererProps) {
  const isColumnBranchSelected = isColumnItem
    && file.type === 'folder'
    && typeof sourceColumnIndex === 'number'
    && columnPaths[sourceColumnIndex] === file.path;
  const isSelected = selectedFileIds.includes(file.id) || isColumnBranchSelected;
  const isPulsing = pulseFileId === file.id;
  const isDropTarget = dragOverFolderId === file.id && file.type === 'folder';
  const formattedName = formatFileName(file.name);
  const isLongName = file.name !== formattedName;
  const tags = fileTags[file.path] || file.tags || [];
  const isHiddenFile = file.name.startsWith('.');
  const fileNameClass = isHiddenFile ? 'text-on-surface/45 group-hover:text-on-surface/60' : 'text-primary-custom group-hover:text-hover-custom';
  const fileMetaClass = isHiddenFile ? 'text-on-surface/35' : 'text-primary-custom';
  const mediaNameClass = isHiddenFile ? 'text-white/55' : 'text-white';
  const mediaMetaClass = isHiddenFile ? 'text-white/45' : 'text-white/90';

  if (displayMode === 'list' && !isColumnItem) {
    const density = (theme.listDensity || 'normal') as keyof typeof LIST_MODIFIED_COL_BY_DENSITY;
    const listModifiedColClass = LIST_MODIFIED_COL_BY_DENSITY[density] || LIST_MODIFIED_COL_BY_DENSITY.normal;
    const relativeModifiedLabel = getRelativeTimeLabel(file.modified);

    const config = {
      relaxed: { py: 'py-4', gap: 'gap-4', icon: 'w-10 h-10', text: 'text-[15px]', subText: 'text-[12px]', scale: 'scale-100' },
      normal: { py: 'py-2', gap: 'gap-4', icon: 'w-8 h-8', text: 'text-[14px]', subText: 'text-[12px]', scale: 'scale-90' },
      compact: { py: 'py-1', gap: 'gap-3', icon: 'w-7 h-7', text: 'text-[13px]', subText: 'text-[11px]', scale: 'scale-75' },
      ultra: { py: 'py-0.5', gap: 'gap-2', icon: 'w-6 h-6', text: 'text-[12px]', subText: 'text-[10px]', scale: 'scale-60' },
    }[density];

    return (
      <motion.div
        key={file.id}
        data-id={file.id}
        draggable={renamingFile?.id !== file.id && !isRemotePath(file.path)}
        onMouseDown={(event) => { if (renamingFile?.id === file.id) return; handleFileMouseDown(event, file); }}
        onDragStart={(event) => { if (renamingFile?.id === file.id) { event.preventDefault(); return; } handleDragStart(event, file); }}
        onDragOver={file.type === 'folder' ? (event) => handleDragOver(event, file.id) : undefined}
        onDragLeave={file.type === 'folder' ? (event) => handleDragLeave(event, file.id) : undefined}
        onDragEnd={handleDragEnd}
        onDrop={file.type === 'folder' ? (event) => handleDrop(event, file.id) : undefined}
        onClick={(event) => { event.stopPropagation(); handleSelectFile(file, event, sourceColumnIndex); }}
        onDoubleClick={() => handleDoubleClick(file)}
        title={isLongName ? file.name : undefined}
        onContextMenu={(event) => { void handleContextMenu(event, [file.id]); }}
        animate={isPulsing ? { scale: [1, 0.985, 1.01, 1] } : undefined}
        transition={isPulsing ? { duration: 0.26 } : undefined}
        className={`file-item select-none flex items-center transition-all duration-200 group border px-4 cursor-pointer
          ${config.py} ${config.gap}
          ${isPulsing ? 'ring-2 ring-primary/35' : ''}
          ${isDropTarget ? 'ring-4 ring-primary outline-none scale-[1.01] z-20' : ''}
          ${isSelected ? 'bg-selected border-custom shadow-custom rounded-xl z-10' : 'bg-panel-custom border-transparent hover:bg-hover-custom hover:border-custom shadow-sm rounded-lg'}
        `}
      >
        {showCheckboxCol && (
          <div
            className={`${LIST_COLS.checkbox} shrink-0 mr-2 flex items-center justify-center`}
            onMouseDown={event => event.stopPropagation()}
            onClick={event => event.stopPropagation()}
          >
            <input
              type="checkbox"
              checked={isSelected}
              onChange={() => {
                const next = selectedFileIds.includes(file.id)
                  ? selectedFileIds.filter(id => id !== file.id)
                  : [...selectedFileIds, file.id];
                onSelectFiles(next);
              }}
              className="w-3.5 h-3.5 accent-primary cursor-pointer"
            />
          </div>
        )}
        {showSortCol && (
          <div className={`${LIST_COLS.sortNum} shrink-0 text-[10px] font-black text-on-surface/25 tabular-nums pl-1`}>{sortIndex ?? ''}</div>
        )}
        <div className={`flex items-center flex-1 min-w-0 ${config.gap}`}>
          <div className={`${config.icon} flex items-center justify-center shrink-0 overflow-hidden`}>
            <div className={`w-full h-full flex items-center justify-center transition-transform ${
              file.thumbnail && (file.type === 'application' || file.type === 'image') ? '' : config.scale
            }`}>
              {getFileIcon(file)}
            </div>
          </div>
          {renamingFile?.id === file.id ? (
            <input value={renameInput} onChange={event => setRenameInput(event.target.value)}
              onKeyDown={event => { if (event.key === 'Enter') handleRenameSubmit(); if (event.key === 'Escape') handleRenameCancel(); }}
              onBlur={handleRenameSubmit}
              onFocus={event => event.target.select()}
              onMouseDown={event => event.stopPropagation()}
              onClick={event => event.stopPropagation()}
              autoFocus
              className={`${config.text} font-black text-on-surface bg-primary/20 border border-primary rounded-md px-2 py-0.5 outline-none min-w-0 flex-1`} />
          ) : (
            <span className={`${config.text} select-none font-black ${fileNameClass} truncate pr-2 transition-all duration-300`}>{formattedName}</span>
          )}
          {tags.length > 0 && (
            <div className="flex gap-1 shrink-0">
              {tags.slice(0, 3).map(tag => <span key={tag} className="w-2 h-2 rounded-full" style={{ backgroundColor: tagColors[tag] || '#8e8e93' }} />)}
            </div>
          )}
        </div>
        <div className={`${listModifiedColClass} shrink-0 pl-1.5 flex items-center gap-1 transition-all duration-300 min-w-0`}>
          <span className={`${config.subText} ${fileMetaClass} font-black truncate min-w-0 flex-1`}>{file.modified}</span>
          {relativeModifiedLabel && (
            <span className="text-[10px] font-medium text-on-surface/35 shrink-0 max-w-[3.5rem] truncate">{relativeModifiedLabel}</span>
          )}
        </div>
        <div className={`${LIST_COLS.size} shrink-0 ${config.subText} ${fileMetaClass} font-mono font-black pl-2 text-right tabular-nums transition-all duration-300`}>{file.size || '--'}</div>
        <div className={`${LIST_COLS.type} shrink-0 ${config.subText} ${fileMetaClass} truncate font-black tracking-tight pl-2 text-right opacity-70 transition-all duration-300`}>{getFileTypeLabel(file.type)}</div>
        <div className={`${LIST_COLS.actions} shrink-0 flex justify-end overflow-visible`}>
          <button
            onClick={(event) => openFileActionsMenu(event, file)}
            className="p-1 -mr-1 rounded opacity-0 group-hover:opacity-100 text-on-surface hover:bg-primary/20 transition-all"
            title={t('tooltips.moreActions')}
          >
            <MoreVertical className="w-4 h-4" />
          </button>
        </div>
      </motion.div>
    );
  }

  if (displayMode === 'column' || isColumnItem) {
    return (
      <motion.div
        key={file.id}
        data-id={file.id}
        draggable={renamingFile?.id !== file.id && !isRemotePath(file.path)}
        onMouseDown={(event) => { if (renamingFile?.id === file.id) return; handleFileMouseDown(event, file); }}
        onDragStart={(event) => { if (renamingFile?.id === file.id) { event.preventDefault(); return; } handleDragStart(event, file); }}
        onDragOver={file.type === 'folder' ? (event) => handleDragOver(event, file.id) : undefined}
        onDragLeave={file.type === 'folder' ? (event) => handleDragLeave(event, file.id) : undefined}
        onDragEnd={handleDragEnd}
        onDrop={file.type === 'folder' ? (event) => handleDrop(event, file.id) : undefined}
        title={isLongName ? file.name : undefined}
        onClick={(event) => { event.stopPropagation(); handleSelectFile(file, event, sourceColumnIndex); }}
        onDoubleClick={() => handleDoubleClick(file)}
        onContextMenu={(event) => { void handleContextMenu(event, [file.id]); }}
        animate={isPulsing ? { scale: [1, 0.985, 1.01, 1] } : undefined}
        transition={isPulsing ? { duration: 0.26 } : undefined}
        className={`file-item select-none flex items-center gap-3 px-3 rounded-xl cursor-pointer transition-all duration-300 group border
          ${isPulsing ? 'ring-2 ring-primary/35' : ''}
          ${isDropTarget ? 'ring-4 ring-primary outline-none scale-[1.01] z-20' : ''}
          ${isSelected ? 'bg-selected border-custom shadow-custom' : 'bg-panel-custom border-transparent hover:bg-hover-custom hover:border-custom shadow-sm'}
        `}
        style={{
          height: `${theme.columnHeight || 60}px`,
          width: '100%',
          marginBottom: '8px',
        }}
      >
        <div className="w-10 h-10 rounded-xl flex items-center justify-center bg-panel-custom group-hover:bg-hover-custom transition-colors shrink-0 p-1">
          {getFileIcon(file)}
        </div>
        <div className="flex-1 min-w-0 flex flex-col justify-center">
          {renamingFile?.id === file.id ? (
            <input value={renameInput} onChange={event => setRenameInput(event.target.value)}
              onKeyDown={event => { if (event.key === 'Enter') handleRenameSubmit(); if (event.key === 'Escape') handleRenameCancel(); }}
              onBlur={handleRenameSubmit} autoFocus onClick={event => event.stopPropagation()}
              className="text-[14px] font-black text-on-surface bg-primary/20 border border-primary rounded-md px-2 py-0.5 outline-none w-full" />
          ) : (
            <h3 className={`select-none text-[14px] font-black ${fileNameClass} truncate leading-tight transition-colors`}>{formattedName}</h3>
          )}
          <p className={`text-[11px] ${fileMetaClass} font-black truncate`}>{file.size && file.size !== '--' ? `${file.size} • ` : ''}{file.modified}</p>
          {tags.length > 0 && <div className="flex gap-1 mt-1">{tags.slice(0, 4).map(tag => <span key={tag} className="w-2 h-2 rounded-full" style={{ backgroundColor: tagColors[tag] || '#8e8e93' }} />)}</div>}
        </div>
        {file.type === 'folder' && (
          <ChevronRight className="w-4 h-4 text-on-surface shrink-0" />
        )}
      </motion.div>
    );
  }

  if (displayMode === 'grid') {
    const isMediaItem = Boolean(file.thumbnail) && (file.type === 'image' || file.type === 'video');
    const normalWidth = theme.gridWidth || theme.gridSize || 180;
    const normalHeight = theme.gridHeight || theme.gridSize || 180;
    const mediaWidth = theme.mediaGridLinked === false ? (theme.mediaGridWidth || normalWidth) : normalWidth;
    const mediaHeight = theme.mediaGridLinked === false ? (theme.mediaGridHeight || normalHeight) : normalHeight;
    return (
      <motion.div
        key={file.id}
        data-id={file.id}
        draggable={renamingFile?.id !== file.id && !isRemotePath(file.path)}
        onMouseDown={(event) => { if (renamingFile?.id === file.id) return; handleFileMouseDown(event, file); }}
        onDragStart={(event) => { if (renamingFile?.id === file.id) { event.preventDefault(); return; } handleDragStart(event, file); }}
        onDragOver={file.type === 'folder' ? (event) => handleDragOver(event, file.id) : undefined}
        onDragLeave={file.type === 'folder' ? (event) => handleDragLeave(event, file.id) : undefined}
        onDragEnd={handleDragEnd}
        onDrop={file.type === 'folder' ? (event) => handleDrop(event, file.id) : undefined}
        title={isLongName ? file.name : undefined}
        onClick={(event) => { event.stopPropagation(); handleSelectFile(file, event); }}
        onDoubleClick={() => handleDoubleClick(file)}
        onContextMenu={(event) => { void handleContextMenu(event, [file.id]); }}
        animate={isPulsing ? { scale: [1, 0.985, 1.01, 1] } : undefined}
        transition={isPulsing ? { duration: 0.26 } : undefined}
        className={`file-item file-item-grid select-none relative rounded-2xl p-4 flex flex-col justify-between group cursor-pointer transition-[transform,background-color,border-color,box-shadow] duration-200 border
          ${isPulsing ? 'ring-2 ring-primary/35' : ''}
          ${isDropTarget ? 'ring-4 ring-primary outline-none scale-[1.01] z-20' : ''}
          ${isSelected ? 'bg-selected border-custom shadow-custom' : 'bg-panel-custom border-transparent hover:bg-hover-custom hover:border-custom shadow-sm'}
          ${isMediaItem ? 'p-0 overflow-hidden' + (!isSelected ? ' !border-none !bg-transparent' : '') : ''}
        `}
        style={{
          width: isMediaItem ? `${mediaWidth}px` : `${normalWidth}px`,
          height: isMediaItem ? `${mediaHeight}px` : `${normalHeight}px`,
        }}
      >
        {isMediaItem && displayMode === 'grid' ? (
          <>
            {file.type === 'video' ? (
              <video
                src={file.thumbnail}
                className="absolute inset-0 w-full h-full object-cover opacity-80 group-hover:scale-105 transition-transform duration-700"
                muted
                playsInline
                preload="metadata"
                onLoadedMetadata={event => handleVideoMetadataLoaded(file, event.currentTarget.duration)}
              />
            ) : (
              <img src={file.thumbnail} alt={file.name} className="absolute inset-0 w-full h-full object-cover opacity-80 group-hover:scale-105 transition-transform duration-700" />
            )}
            <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent" />
            <div className="absolute bottom-0 left-0 right-0 p-4">
              <div className="flex items-center gap-2 mb-1">
                {getFileIcon(file)}
                <span className="text-[10px] font-black bg-primary text-on-primary px-1.5 py-0.5 rounded-full shadow-lg">{file.type === 'video' ? 'VIDEO' : 'IMAGE'}</span>
              </div>
              {renamingFile?.id === file.id ? (
                <input value={renameInput} onChange={event => setRenameInput(event.target.value)}
                  onKeyDown={event => { if (event.key === 'Enter') handleRenameSubmit(); if (event.key === 'Escape') handleRenameCancel(); }}
                  onBlur={handleRenameSubmit} autoFocus onClick={event => event.stopPropagation()}
                  className="text-[14px] font-black text-white bg-black/40 border border-primary rounded-md px-2 py-0.5 outline-none w-full" />
              ) : (
                <h3 className={`select-none text-[14px] font-black ${mediaNameClass} whitespace-normal break-all line-clamp-3 leading-tight drop-shadow-md`}>{formattedName}</h3>
              )}
              <p className={`text-[11px] ${mediaMetaClass} font-black mt-1 drop-shadow-sm`}>{file.duration ? `${file.duration} • ` : ''}{formatFileMeta(file)}</p>
              {tags.length > 0 && <div className="flex gap-1 mt-2">{tags.slice(0, 4).map(tag => <span key={tag} className="w-2 h-2 rounded-full border border-white/40" style={{ backgroundColor: tagColors[tag] || '#8e8e93' }} />)}</div>}
            </div>
          </>
        ) : (
          <>
            <div className="flex justify-between items-start">
              <div className="w-14 h-14 rounded-2xl flex items-center justify-center bg-panel-custom group-hover:bg-hover-custom transition-colors shrink-0 p-1">
                {getFileIcon(file)}
              </div>
            </div>
            <div className="mt-4 flex-1">
              {renamingFile?.id === file.id ? (
                <input value={renameInput} onChange={event => setRenameInput(event.target.value)}
                  onKeyDown={event => { if (event.key === 'Enter') handleRenameSubmit(); if (event.key === 'Escape') handleRenameCancel(); }}
                  onBlur={handleRenameSubmit} autoFocus onClick={event => event.stopPropagation()}
                  className="text-[13px] font-black text-on-surface bg-primary/20 border border-primary rounded-md px-2 py-0.5 outline-none w-full" />
              ) : (
                <h3 className={`select-none text-[13px] font-black ${fileNameClass} whitespace-normal break-all line-clamp-3 transition-colors leading-snug`}>{formattedName}</h3>
              )}
              <p className={`text-[10px] ${fileMetaClass} font-black mt-1`}>{formatFileMeta(file)}</p>
              {tags.length > 0 && <div className="flex gap-1 mt-2">{tags.slice(0, 4).map(tag => <span key={tag} className="w-2 h-2 rounded-full" style={{ backgroundColor: tagColors[tag] || '#8e8e93' }} />)}</div>}
            </div>
            <button
              onClick={(event) => openFileActionsMenu(event, file)}
              className="absolute top-2 right-2 p-1.5 rounded-lg text-on-surface/0 group-hover:text-on-surface/60 hover:text-on-surface hover:bg-primary/20 transition-all"
              title={t('tooltips.moreActions')}
            >
              <MoreVertical className="w-4 h-4" />
            </button>
          </>
        )}
      </motion.div>
    );
  }

  return null;
}
