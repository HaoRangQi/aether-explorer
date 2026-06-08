import React from 'react';
import { AnimatePresence, motion } from 'motion/react';
import type { TFunction } from 'i18next';
import { Check, ChevronRight, Edit3, ExternalLink, Eye, Folder, Star, Terminal, Trash2, X } from 'lucide-react';
import type { OpenWithOption } from '../../api/filesystem';
import type { FileItem, ThemeSettings } from '../../types';
import { getPdfPreviewSrc } from './explorer-utils';
import type { DirectorySizeInfo, HashDialogState } from './preview-panel-types';

type PreviewPanelProps = {
  closeInspector: () => void;
  currentPath: string;
  dirSizeError: string;
  dirSizeLoading: boolean;
  getFileIcon: (target: FileItem | FileItem['type'], thumbnailOverride?: string) => React.ReactNode;
  getTagLabel: (tagId: string) => string;
  handleCopyFile: (file: FileItem) => void | Promise<void>;
  handleCopyHashValue: () => void | Promise<void>;
  handleDeleteFile: (file: FileItem) => void | Promise<void>;
  handleInspectorOpenWithChange: (event: React.ChangeEvent<HTMLSelectElement>) => void | Promise<void>;
  handleOpenTerminal: (file?: FileItem | null) => void | Promise<void>;
  handleQuickLook: (file?: FileItem) => void | Promise<void>;
  handleRenameStart: (file: FileItem) => void;
  handleRevealInFinder: (file?: FileItem) => void | Promise<void>;
  handleToggleFavoriteForItems: (items?: FileItem[]) => void;
  handleVideoMetadataLoaded: (file: FileItem, durationSeconds: number) => void;
  hashDialog: HashDialogState | null;
  imagePreviewFailed: boolean;
  inspectorDefaultOpenWith: OpenWithOption | null;
  inspectorFile: FileItem | null;
  inspectorFileType: string;
  inspectorIsFavorite: boolean;
  inspectorOpenWithDisabled: boolean;
  inspectorOpenWithPlaceholder: string;
  inspectorOpenWithValue: string;
  inspectorOverride: boolean;
  inspectorSizeInfo: DirectorySizeInfo | null;
  inspectorSizePending: boolean;
  inspectorSizeStatusText: string;
  inspectorSupportsOpenWith: boolean;
  inspectorTags: string[];
  inspectorVisible: boolean;
  isRemotePath: (path: string) => boolean;
  lastSelectedFile: FileItem | null;
  liquidGlassEnabled: boolean;
  onCloseHashDialog: () => void;
  openWithOptions: OpenWithOption[];
  openWithSelectOther: string;
  openWithSelectPlaceholder: string;
  pdfPreviewFailed: boolean;
  pdfPreviewLoading: boolean;
  selectedFileIds: string[];
  setImagePreviewFailed: (failed: boolean) => void;
  setPdfPreviewFailed: (failed: boolean) => void;
  setPdfPreviewLoading: (loading: boolean) => void;
  t: TFunction;
  tagColors: Record<string, string>;
  textPreview: string;
  textPreviewLoading: boolean;
  theme: ThemeSettings;
  toggleTagForItems: (tagId: string, items?: FileItem[]) => void;
};

export default function PreviewPanel({
  closeInspector,
  currentPath,
  dirSizeError,
  dirSizeLoading,
  getFileIcon,
  getTagLabel,
  handleCopyFile,
  handleCopyHashValue,
  handleDeleteFile,
  handleInspectorOpenWithChange,
  handleOpenTerminal,
  handleQuickLook,
  handleRenameStart,
  handleRevealInFinder,
  handleToggleFavoriteForItems,
  handleVideoMetadataLoaded,
  hashDialog,
  imagePreviewFailed,
  inspectorDefaultOpenWith,
  inspectorFile,
  inspectorFileType,
  inspectorIsFavorite,
  inspectorOpenWithDisabled,
  inspectorOpenWithPlaceholder,
  inspectorOpenWithValue,
  inspectorOverride,
  inspectorSizeInfo,
  inspectorSizePending,
  inspectorSizeStatusText,
  inspectorSupportsOpenWith,
  inspectorTags,
  inspectorVisible,
  isRemotePath,
  lastSelectedFile,
  liquidGlassEnabled,
  onCloseHashDialog,
  openWithOptions,
  openWithSelectOther,
  openWithSelectPlaceholder,
  pdfPreviewFailed,
  pdfPreviewLoading,
  selectedFileIds,
  setImagePreviewFailed,
  setPdfPreviewFailed,
  setPdfPreviewLoading,
  t,
  tagColors,
  textPreview,
  textPreviewLoading,
  theme,
  toggleTagForItems,
}: PreviewPanelProps) {
  return (
    <>
      <AnimatePresence>
        {inspectorVisible && inspectorFile && (
          <motion.aside
            initial={{ x: 360, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: 360, opacity: 0 }}
            className={`${liquidGlassEnabled ? 'liquid-glass' : 'bg-surface/95 border border-primary/10 backdrop-blur-xl'} w-[336px] my-3 mr-3 ml-2 rounded-2xl flex flex-col shrink-0 shadow-xl overflow-hidden relative`}
          >
            {inspectorOverride && !theme.showPreviewPanel && (
              <button onClick={closeInspector} className="absolute top-3 right-3 z-10 w-7 h-7 rounded-full bg-primary/10 hover:bg-primary/30 flex items-center justify-center transition-colors">
                <X className="w-3.5 h-3.5 text-on-surface/60" />
              </button>
            )}
            <div className="p-5 border-b border-transparent">
              <div className="h-40 rounded-2xl overflow-hidden bg-primary/10 border border-primary/10 relative shadow-lg group">
                {!lastSelectedFile ? (
                  <div className="w-full h-full flex items-center justify-center">
                    {getFileIcon('folder')}
                  </div>
                ) : lastSelectedFile.type === 'image' && lastSelectedFile.thumbnail && !imagePreviewFailed ? (
                  <img
                    src={lastSelectedFile.thumbnail}
                    alt="Preview"
                    className="w-full h-full object-cover"
                    onError={() => setImagePreviewFailed(true)}
                  />
                ) : lastSelectedFile.type === 'video' && lastSelectedFile.thumbnail ? (
                  <video
                    src={lastSelectedFile.thumbnail}
                    className="w-full h-full object-cover"
                    muted
                    playsInline
                    preload="metadata"
                    controls
                    onLoadedMetadata={event => handleVideoMetadataLoaded(lastSelectedFile, event.currentTarget.duration)}
                  />
                ) : (lastSelectedFile.type === 'text' || lastSelectedFile.type === 'code') && textPreview ? (
                  <pre className="w-full h-full p-3 overflow-hidden text-[10.5px] leading-relaxed text-on-surface/70 whitespace-pre-wrap break-all font-mono bg-primary/5">
                    {textPreview}
                  </pre>
                ) : lastSelectedFile.type === 'pdf' && !isRemotePath(lastSelectedFile.path) && !pdfPreviewFailed ? (
                  <div className="relative w-full h-full bg-white">
                    {pdfPreviewLoading && (
                      <div className="absolute inset-0 z-10 flex items-center justify-center bg-primary/5 text-[12px] text-on-surface/35 font-bold">
                        {t('explorer.pdfLoading', '正在加载 PDF 首页...')}
                      </div>
                    )}
                    <iframe
                      src={getPdfPreviewSrc(lastSelectedFile.path)}
                      title="PDF Preview"
                      className="w-full h-full bg-white"
                      onLoad={() => setPdfPreviewLoading(false)}
                      onError={() => {
                        setPdfPreviewLoading(false);
                        setPdfPreviewFailed(true);
                      }}
                    />
                  </div>
                ) : lastSelectedFile.type === 'pdf' && !isRemotePath(lastSelectedFile.path) && pdfPreviewFailed ? (
                  <div className="w-full h-full flex items-center justify-center px-6 text-center text-[12px] text-on-surface/35 font-bold leading-relaxed">
                    {t('explorer.pdfPreviewFailed', 'PDF 预览加载失败')}
                  </div>
                ) : textPreviewLoading ? (
                  <div className="w-full h-full flex items-center justify-center text-[12px] text-on-surface/35 font-bold">
                    {t('explorer.generatingPreview', '正在生成预览...')}
                  </div>
                ) : (lastSelectedFile.type === 'text' || lastSelectedFile.type === 'code') ? (
                  <div className="w-full h-full flex items-center justify-center px-6 text-center text-[12px] text-on-surface/35 font-bold leading-relaxed">
                    {t('explorer.textPreviewUnavailable', '此文本暂不可预览')}
                  </div>
                ) : lastSelectedFile.type === 'image' && imagePreviewFailed ? (
                  <div className="w-full h-full flex flex-col items-center justify-center gap-3 px-6 text-center text-[12px] text-on-surface/35 font-bold leading-relaxed">
                    {getFileIcon(lastSelectedFile)}
                    {t('explorer.imagePreviewFailed', '图片预览加载失败')}
                  </div>
                ) : (
                  <div className="w-full h-full flex items-center justify-center">
                    <div className="transform group-hover:scale-110 transition-transform duration-500">
                      {getFileIcon(lastSelectedFile)}
                    </div>
                  </div>
                )}
                {lastSelectedFile?.dimensions && (
                  <div className="absolute bottom-2 right-2 bg-black/60 backdrop-blur-md px-2 py-0.5 rounded text-[10px] text-white">
                    {lastSelectedFile.dimensions}
                  </div>
                )}
              </div>
              <h3 className="text-[16px] font-bold text-on-surface mt-4 break-words leading-tight">{inspectorFile.name || currentPath}</h3>
              <p className="text-[11px] text-primary font-bold mt-1 opacity-80">{inspectorFileType}</p>
            </div>

            <div className="flex-1 p-5 space-y-5 overflow-y-auto custom-scrollbar">
              {selectedFileIds.length > 1 && (
                <div className="p-4 bg-primary/10 rounded-2xl border border-primary/20 text-center">
                  <p className="text-[14px] font-bold text-primary">{selectedFileIds.length} {t('explorer.itemsSelectedLabel', '个项目已选中')}</p>
                </div>
              )}
              <div className="space-y-3">
                <h4 className="text-[11px] font-bold text-on-surface/40 uppercase tracking-widest">{t('explorer.details')}</h4>
                <div className="grid grid-cols-3 gap-2 text-[13px] leading-relaxed">
                  <div className="text-on-surface/40">{t('explorer.size')}</div>
                  <div className="text-on-surface col-span-2">
                    {inspectorSizeInfo ? (
                      <span>
                        <span className="inline-flex items-center gap-2">
                          <span>{inspectorSizeInfo.formatted}</span>
                          {inspectorSizePending && (
                            <span className="inline-block h-2 w-10 rounded-full bg-gradient-to-r from-primary/15 via-primary/45 to-primary/15 bg-[length:200%_100%] animate-shimmer" />
                          )}
                        </span>
                        {(inspectorSizeInfo.file_count > 0 || !inspectorSizePending) && (
                          <span className="text-on-surface/40 text-[11px]"> ({t('explorer.filesCount', { count: inspectorSizeInfo.file_count, defaultValue: `${inspectorSizeInfo.file_count} 个文件` })})</span>
                        )}
                        {inspectorSizeStatusText && (
                          <span
                            className={`block text-[11px] ${inspectorSizeInfo.status === 'failed' ? 'text-amber-400/80' : 'text-on-surface/35'}`}
                            title={dirSizeError || undefined}
                          >
                            {inspectorSizeStatusText}
                          </span>
                        )}
                        {inspectorSizeInfo.formatted_allocated && inspectorSizeInfo.formatted_allocated !== inspectorSizeInfo.formatted && (
                          <span className="block text-on-surface/35 text-[11px]">
                            {t('explorer.diskSize', { size: inspectorSizeInfo.formatted_allocated, defaultValue: `磁盘占用 ${inspectorSizeInfo.formatted_allocated}` })}
                          </span>
                        )}
                        {inspectorSizeInfo.skipped_count ? (
                          <span className="block text-on-surface/30 text-[11px]">
                            {t('explorer.sizeSkippedCount', { count: inspectorSizeInfo.skipped_count, defaultValue: `已跳过 ${inspectorSizeInfo.skipped_count} 项` })}
                          </span>
                        ) : null}
                      </span>
                    ) : dirSizeLoading ? (
                      <span className="inline-block h-4 w-24 rounded bg-gradient-to-r from-primary/20 via-primary/40 to-primary/20 bg-[length:200%_100%] animate-shimmer" />
                    ) : dirSizeError ? (
                      <span className="text-on-surface/40 text-[11px]" title={dirSizeError}>--</span>
                    ) : inspectorFile.type === 'folder' ? (
                      '--'
                    ) : (
                      inspectorFile.size || '--'
                    )}
                  </div>
                  <div className="text-on-surface/40">{t('explorer.type')}</div>
                  <div className="text-on-surface col-span-2">{inspectorFileType}</div>
                  <div className="text-on-surface/40">{t('explorer.openWith', '打开方式')}</div>
                  <div className="text-on-surface col-span-2 min-w-0">
                    {inspectorSupportsOpenWith ? (
                      <div className="relative min-w-0">
                        <select
                          value={inspectorOpenWithValue}
                          onChange={handleInspectorOpenWithChange}
                          disabled={inspectorOpenWithDisabled}
                          className="w-full min-w-0 appearance-none rounded-xl border border-primary/10 bg-primary/5 px-3 py-2 pr-9 text-[12px] font-bold text-on-surface outline-none transition-all focus:border-primary focus:ring-4 focus:ring-primary/10 disabled:cursor-not-allowed disabled:text-on-surface/35"
                        >
                          {!inspectorDefaultOpenWith && (
                            <option value={openWithSelectPlaceholder}>{inspectorOpenWithPlaceholder}</option>
                          )}
                          {openWithOptions.map(option => (
                            <option key={option.path} value={option.path}>
                              {option.name}
                            </option>
                          ))}
                          <option value={openWithSelectOther}>
                            {t('explorer.openWithOther', '选择更多…')}
                          </option>
                        </select>
                        <div className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-on-surface/35">
                          <ChevronRight className="h-4 w-4 rotate-90" />
                        </div>
                      </div>
                    ) : (
                      '--'
                    )}
                  </div>
                  {inspectorFile.type === 'video' && inspectorFile.duration && (
                    <>
                      <div className="text-on-surface/40">{t('explorer.duration')}</div>
                      <div className="text-on-surface col-span-2">{inspectorFile.duration}</div>
                    </>
                  )}
                  <div className="text-on-surface/40">{t('explorer.modified')}</div>
                  <div className="text-on-surface col-span-2">{inspectorFile.modified || '--'}</div>
                  <div className="text-on-surface/40">{t('explorer.created')}</div>
                  <div className="text-on-surface col-span-2">{inspectorFile.created || '--'}</div>
                  <div className="text-on-surface/40">{t('explorer.added')}</div>
                  <div className="text-on-surface col-span-2">{inspectorFile.added || '--'}</div>
                  <div className="text-on-surface/40">{t('explorer.lastOpened')}</div>
                  <div className="text-on-surface col-span-2">{inspectorFile.lastOpened || '--'}</div>
                  {typeof inspectorFile.childCount === 'number' && (
                    <>
                      <div className="text-on-surface/40">{t('explorer.childCount')}</div>
                      <div className="text-on-surface col-span-2">
                        {t('explorer.folderItemsCount', { count: inspectorFile.childCount })}
                      </div>
                    </>
                  )}
                  <div className="text-on-surface/40">{t('explorer.location')}</div>
                  <div className="text-on-surface col-span-2 break-all opacity-80">{inspectorFile.path}</div>
                </div>
              </div>

              <div className="space-y-3">
                <h4 className="text-[11px] font-bold text-on-surface/40 uppercase tracking-widest">{t('explorer.favoriteAndTags')}</h4>
                <button
                  onClick={() => handleToggleFavoriteForItems([inspectorFile])}
                  className={`w-full flex items-center justify-between rounded-xl border px-3 py-2.5 text-[13px] font-bold transition-colors ${
                    inspectorIsFavorite
                      ? 'border-primary/35 bg-primary/15 text-primary'
                      : 'border-primary/10 bg-primary/5 text-on-surface/65 hover:bg-primary/10'
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <Star className={`w-4 h-4 ${inspectorIsFavorite ? 'fill-current' : ''}`} />
                    {inspectorIsFavorite ? t('explorer.inFavorites') : t('explorer.notFavorite')}
                  </span>
                  <span className="text-[11px] text-on-surface/40">{t(inspectorIsFavorite ? 'explorer.removeFavorite' : 'explorer.addFavorite')}</span>
                </button>
                <div className="grid grid-cols-7 gap-2">
                  {Object.entries(tagColors).map(([tag, color]) => {
                    const selected = inspectorTags.includes(tag);
                    return (
                      <button
                        key={tag}
                        onClick={() => toggleTagForItems(tag, [inspectorFile])}
                        className={`relative h-7 w-7 rounded-full border transition-transform hover:scale-110 ${
                          selected ? 'border-on-surface shadow-[0_0_0_2px_rgba(var(--primary-rgb),0.35)]' : 'border-white/10'
                        }`}
                        style={{ backgroundColor: color }}
                        title={getTagLabel(tag)}
                      >
                        {selected && <Check className="absolute inset-0 m-auto w-4 h-4 text-white drop-shadow" />}
                      </button>
                    );
                  })}
                </div>
                {inspectorTags.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {inspectorTags.map(tag => (
                      <span key={tag} className="px-2.5 py-1 bg-primary/10 border border-primary/20 rounded-full text-[11px] text-on-surface/70 flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full" style={{ backgroundColor: tagColors[tag] || '#8e8e93' }} />
                        {getTagLabel(tag)}
                      </span>
                    ))}
                  </div>
                )}
              </div>

              {lastSelectedFile && (textPreview || textPreviewLoading) && (lastSelectedFile.type === 'text' || lastSelectedFile.type === 'code') && (
                <div className="space-y-3">
                  <h4 className="text-[11px] font-bold text-on-surface/40 uppercase tracking-widest">{t('explorer.contentPreview', '内容预览')}</h4>
                  <pre className="text-[12px] text-on-surface/70 bg-primary/5 rounded-xl p-3 overflow-auto max-h-72 whitespace-pre-wrap break-all font-mono leading-relaxed border border-primary/10">
                    {textPreviewLoading ? t('explorer.reading', '正在读取...') : textPreview}
                  </pre>
                </div>
              )}
            </div>

            {lastSelectedFile && (
              <div className="p-5 space-y-2 border-t border-transparent bg-white/[0.02]">
                <button
                  onClick={() => handleCopyFile(lastSelectedFile)}
                  className="w-full py-3 bg-primary text-on-primary rounded-xl font-bold text-[14px] shadow-lg shadow-primary/20 hover:scale-[1.02] active:scale-98 transition-all flex items-center justify-center gap-2"
                >
                  <ExternalLink className="w-5 h-5" />
                  {t('explorer.copyTo')}
                </button>
                <div className="flex gap-2">
                  <button onClick={() => handleRenameStart(lastSelectedFile)} className="flex-1 py-2.5 bg-primary/10 text-on-surface/70 rounded-xl font-medium text-[13px] hover:bg-primary/20 transition-colors flex items-center justify-center gap-2 border border-transparent">
                    <Edit3 className="w-4 h-4" />
                    {t('explorer.rename')}
                  </button>
                  <button onClick={() => handleDeleteFile(lastSelectedFile)} className="flex-1 py-2.5 bg-red-400/10 text-red-400 border border-red-400/20 rounded-xl font-medium text-[13px] hover:bg-red-400/20 transition-colors flex items-center justify-center gap-2 group">
                    <Trash2 className="w-4 h-4 group-hover:scale-110 transition-transform" />
                    {t('explorer.delete')}
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <button onClick={() => handleQuickLook(lastSelectedFile)} className="py-2.5 bg-primary/10 text-on-surface/70 rounded-xl font-medium text-[13px] hover:bg-primary/20 transition-colors flex items-center justify-center gap-2 border border-transparent">
                    <Eye className="w-4 h-4" /> Quick Look
                  </button>
                  <button onClick={() => handleRevealInFinder(lastSelectedFile)} className="py-2.5 bg-primary/10 text-on-surface/70 rounded-xl font-medium text-[13px] hover:bg-primary/20 transition-colors flex items-center justify-center gap-2 border border-transparent">
                    <Folder className="w-4 h-4" /> Finder
                  </button>
                  <button onClick={() => handleOpenTerminal(lastSelectedFile)} className="py-2.5 bg-primary/10 text-on-surface/70 rounded-xl font-medium text-[13px] hover:bg-primary/20 transition-colors flex items-center justify-center gap-2 border border-transparent col-span-2">
                    <Terminal className="w-4 h-4" /> {t('explorer.openInTerminal', '在终端打开')}
                  </button>
                </div>
              </div>
            )}
          </motion.aside>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {hashDialog && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[140] flex items-center justify-center bg-black/35 px-4 backdrop-blur-sm"
          >
            <motion.div
              initial={{ opacity: 0, y: 18, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 18, scale: 0.96 }}
              className="w-full max-w-lg rounded-2xl border border-primary/25 bg-surface/95 p-5 shadow-2xl shadow-black/30"
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h3 className="text-[17px] font-black text-on-surface">{t('explorer.calculateHash', '计算哈希值')}</h3>
                  <p className="mt-1 break-all text-[12px] font-medium text-on-surface/55">{hashDialog.file.path}</p>
                </div>
                <button
                  onClick={onCloseHashDialog}
                  className="rounded-lg p-2 text-on-surface/45 transition-colors hover:bg-primary/10 hover:text-on-surface"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="mt-5 rounded-2xl border border-primary/10 bg-primary/5 p-4">
                {hashDialog.loading ? (
                  <div className="space-y-3">
                    <div className="text-[13px] font-bold text-on-surface/60">{t('explorer.hashComputing', '正在计算哈希值...')}</div>
                    <div className="h-3 w-full rounded-full bg-gradient-to-r from-primary/15 via-primary/45 to-primary/15 bg-[length:200%_100%] animate-shimmer" />
                  </div>
                ) : hashDialog.error ? (
                  <div className="text-[13px] font-bold text-red-400">
                    {t('messages.hashCalculateFailed', { error: hashDialog.error, defaultValue: `计算哈希值失败：${hashDialog.error}` })}
                  </div>
                ) : hashDialog.result ? (
                  <div className="grid grid-cols-3 gap-2 text-[13px] leading-relaxed">
                    <div className="text-on-surface/40">{t('explorer.hashAlgorithm', '算法')}</div>
                    <div className="col-span-2 text-on-surface">{hashDialog.result.algorithm}</div>
                    <div className="text-on-surface/40">{t('explorer.hashValue', '哈希值')}</div>
                    <div className="col-span-2 break-all font-mono text-[12px] text-on-surface">{hashDialog.result.value}</div>
                  </div>
                ) : null}
              </div>

              <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <button
                  onClick={onCloseHashDialog}
                  className="rounded-xl px-4 py-2.5 text-[13px] font-black text-on-surface/65 transition-colors hover:bg-primary/10"
                >
                  {t('common.cancel', '取消')}
                </button>
                <button
                  onClick={() => { void handleCopyHashValue(); }}
                  disabled={!hashDialog.result}
                  className={`rounded-xl px-4 py-2.5 text-[13px] font-black transition-colors ${
                    hashDialog.result
                      ? 'bg-primary text-on-primary shadow-lg shadow-primary/20'
                      : 'bg-primary/10 text-on-surface/35'
                  }`}
                >
                  {t('explorer.copyHash', '复制哈希值')}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
