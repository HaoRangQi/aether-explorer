import React from 'react';
import type { TFunction } from 'i18next';
import {
  Check,
  ChevronRight,
  Copy,
  Edit2,
  Edit3,
  ExternalLink,
  Eye,
  Folder,
  FolderArchive,
  History,
  Info,
  List,
  RefreshCw,
  Sparkles,
  Star,
  Tag,
  Terminal,
  Trash2,
  Upload,
} from 'lucide-react';
import type { ContextMenuAction, FileItem, ThemeSettings, ViewMode } from '../../types';

export type ExplorerContextMenuState = {
  x: number;
  y: number;
  fileIds: string[];
  isBlank?: boolean;
  targetDir?: string;
};

type ContextMenuProps = {
  areAllFavorites: (items: FileItem[]) => boolean;
  areAllTagged: (items: FileItem[], tagId: string) => boolean;
  contextMenu: ExplorerContextMenuState;
  contextMenuPosition: React.CSSProperties | null;
  contextMenuRef: React.RefObject<HTMLDivElement | null>;
  contextSubmenu: string | null;
  currentPath: string;
  defaultHomePath: string;
  enabledContextExtensions: ContextMenuAction[];
  findFileById: (id: string) => FileItem | undefined;
  getActionFiles: (file?: FileItem) => FileItem[];
  getExtensionIcon: (extension: ContextMenuAction) => React.ReactNode;
  getTagLabel: (tagId: string) => string;
  handleAlias: (file: FileItem) => void | Promise<void>;
  handleCompress: (file: FileItem) => void | Promise<void>;
  handleCopyNames: (items?: FileItem[]) => void | Promise<void>;
  handleCopyPaths: (items?: FileItem[]) => void | Promise<void>;
  handleCopyToClipboard: (items?: FileItem[]) => void | Promise<void>;
  handleCutToClipboard: (items?: FileItem[]) => void | Promise<void>;
  handleDecompress: (file: FileItem) => void | Promise<void>;
  handleDeleteFile: (file: FileItem) => void | Promise<void>;
  handleExtensionAction: (id: string, file: FileItem) => void | Promise<void>;
  handleNewFile: (targetPath?: string) => void | Promise<void>;
  handleNewFolder: (targetPath?: string) => void | Promise<void>;
  handleOpenFile: (file: FileItem) => void | Promise<void>;
  handleOpenTerminal: (file?: FileItem | null) => void | Promise<void>;
  handleOpenWith: (file: FileItem, appName: string) => void | Promise<void>;
  handleOpenWithOther: (file: FileItem) => void | Promise<void>;
  handlePasteFromClipboard: (targetPath?: string) => void | Promise<void>;
  handleQuickLook: (file?: FileItem) => void | Promise<void>;
  handleRenameStart: (file: FileItem) => void;
  handleRevealInFinder: (file?: FileItem) => void | Promise<void>;
  handleSetCurrentAsHome: () => void;
  handleShowInspector: (useCurrentDir?: boolean) => void;
  handleSort: (key: string) => void;
  handleToggleFavoriteForItems: (items?: FileItem[]) => void;
  hasFileClipboard: boolean;
  isAdminContextMenuEmpty: boolean;
  liquidGlassEnabled: boolean;
  onShowAiAssistant: () => void;
  onShowOperationHistory: () => void;
  onViewChange: (view: ViewMode) => void;
  openContextSubmenu: (submenu: string) => void;
  openWithApps: string[];
  refreshCurrentDir: (fullRefresh?: boolean, refreshPath?: string) => void | Promise<unknown>;
  scheduleContextSubmenuClose: (submenu: string) => void;
  t: TFunction;
  tagColors: Record<string, string>;
  theme: ThemeSettings;
  toggleTagForItems: (tagId: string, items?: FileItem[]) => void;
};

export default function ContextMenu({
  areAllFavorites,
  areAllTagged,
  contextMenu,
  contextMenuPosition,
  contextMenuRef,
  contextSubmenu,
  currentPath,
  defaultHomePath,
  enabledContextExtensions,
  findFileById,
  getActionFiles,
  getExtensionIcon,
  getTagLabel,
  handleAlias,
  handleCompress,
  handleCopyNames,
  handleCopyPaths,
  handleCopyToClipboard,
  handleCutToClipboard,
  handleDecompress,
  handleDeleteFile,
  handleExtensionAction,
  handleNewFile,
  handleNewFolder,
  handleOpenFile,
  handleOpenTerminal,
  handleOpenWith,
  handleOpenWithOther,
  handlePasteFromClipboard,
  handleQuickLook,
  handleRenameStart,
  handleRevealInFinder,
  handleSetCurrentAsHome,
  handleShowInspector,
  handleSort,
  handleToggleFavoriteForItems,
  hasFileClipboard,
  isAdminContextMenuEmpty,
  liquidGlassEnabled,
  onShowAiAssistant,
  onShowOperationHistory,
  onViewChange,
  openContextSubmenu,
  openWithApps,
  refreshCurrentDir,
  scheduleContextSubmenuClose,
  t,
  tagColors,
  theme,
  toggleTagForItems,
}: ContextMenuProps) {
  const contextFile = contextMenu.isBlank ? undefined : findFileById(contextMenu.fileIds[0]);

  return (
    <div
      ref={contextMenuRef}
      className={`fixed z-[100] w-56 shadow-2xl animate-in fade-in zoom-in-95 duration-200 overflow-visible ${
        theme.useSystemContextMenu || !liquidGlassEnabled
          ? 'rounded-xl bg-surface/95 border border-on-surface/10 text-on-surface backdrop-blur-xl'
          : 'liquid-glass rounded-2xl'
      }`}
      style={contextMenuPosition || undefined}
    >
      <div className="p-1.5 space-y-0.5 rounded-inherit overflow-visible">
        {contextMenu.isBlank ? (
          <>
            <button onClick={() => handleNewFolder(contextMenu.targetDir)} className="w-full flex items-center gap-3 px-3 py-1.5 rounded-lg hover:bg-primary/10 text-[12px] font-bold transition-all text-on-surface hover:text-primary">
              <Folder className="w-4 h-4" /> {t('explorer.newFolder', '新建文件夹')}
            </button>
            <button onClick={() => handleNewFile(contextMenu.targetDir)} className="w-full flex items-center gap-3 px-3 py-1.5 rounded-lg hover:bg-primary/10 text-[12px] font-bold transition-all text-on-surface hover:text-primary">
              <Upload className="w-4 h-4" /> {t('explorer.newFile', '新建文件')}
            </button>
            <div className="my-1 h-px bg-primary/10" />
            <button onClick={() => { void refreshCurrentDir(true, contextMenu.targetDir); }} className="w-full flex items-center gap-3 px-3 py-1.5 rounded-lg hover:bg-primary/10 text-[12px] font-bold transition-all text-on-surface hover:text-primary">
              <RefreshCw className="w-4 h-4" /> {t('explorer.refresh', '刷新')}
            </button>
            <button className="w-full flex items-center gap-3 px-3 py-1.5 rounded-lg hover:bg-primary/10 text-[13px] font-bold transition-all text-on-surface hover:text-primary" onClick={() => handleSort('name')}>
              <List className="w-4 h-4" /> {t('explorer.sortBy', '按名称排序')}
            </button>
            <div className="my-1 h-px bg-primary/10" />
            <button onClick={() => handleShowInspector(true)} className="w-full flex items-center gap-3 px-3 py-1.5 rounded-lg hover:bg-primary/10 text-[12px] font-bold transition-all text-on-surface hover:text-primary">
              <Info className="w-4 h-4" /> {t('explorer.getInfo', '查看简介')}
            </button>
            <button
              onClick={() => handlePasteFromClipboard(contextMenu.targetDir)}
              disabled={!hasFileClipboard}
              className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-[13px] font-bold transition-all ${
                !hasFileClipboard
                  ? 'text-on-surface/25 cursor-not-allowed'
                  : 'hover:bg-primary/10 text-on-surface hover:text-primary'
              }`}
            >
              <Copy className="w-4 h-4" /> {t('explorer.paste', '粘贴')}
            </button>
            <div className="my-1 h-px bg-primary/10" />
            {(() => {
              const isAlreadyHome = currentPath === defaultHomePath;
              return (
                <button
                  onClick={handleSetCurrentAsHome}
                  disabled={isAlreadyHome || !currentPath}
                  className={`w-full flex items-center gap-3 px-3 py-1.5 rounded-lg text-[12px] font-bold transition-all ${
                    isAlreadyHome || !currentPath
                      ? 'text-on-surface/25 cursor-not-allowed'
                      : 'hover:bg-primary/10 text-on-surface hover:text-primary'
                  }`}
                >
                  <Star className={`w-4 h-4 ${isAlreadyHome ? 'fill-primary text-primary' : ''}`} />
                  {isAlreadyHome
                    ? t('explorer.alreadyHome', '已是首页')
                    : t('explorer.setAsHome', '设为首页')}
                </button>
              );
            })()}
            <div className="my-1 h-px bg-primary/10" />
            <button onClick={onShowAiAssistant} className="w-full flex items-center gap-3 px-3 py-1.5 rounded-lg hover:bg-primary/10 text-[12px] font-bold transition-all text-on-surface hover:text-primary">
              <Sparkles className="w-4 h-4 text-primary" /> {t('explorer.aiAssistant', 'AI 文件助手')}
            </button>
            <button onClick={onShowOperationHistory} className="w-full flex items-center gap-3 px-3 py-1.5 rounded-lg hover:bg-primary/10 text-[12px] font-bold transition-all text-on-surface hover:text-primary">
              <History className="w-4 h-4 text-on-surface/50" /> {t('explorer.operationHistory', '操作历史')}
            </button>
          </>
        ) : contextFile ? (
          <>
            <button onClick={() => handleOpenFile(contextFile)} className="w-full flex items-center gap-3 px-3 py-1.5 rounded-lg hover:bg-primary/10 text-[12px] font-bold transition-all text-on-surface hover:text-primary">
              <ExternalLink className="w-4 h-4" /> {t('explorer.open', '打开')}
            </button>
            <div
              className="relative"
              onMouseEnter={() => openContextSubmenu('openWith')}
              onMouseLeave={() => scheduleContextSubmenuClose('openWith')}
            >
              <button className="w-full flex items-center justify-between gap-3 px-3 py-1.5 rounded-lg hover:bg-primary/10 text-[12px] font-bold transition-all text-on-surface hover:text-primary">
                <span className="flex items-center gap-3">
                  <ExternalLink className="w-4 h-4" /> {t('explorer.openWith', '打开方式')}
                </span>
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
              {contextSubmenu === 'openWith' && (
                <div
                  className="absolute left-full top-0 z-[110] ml-1 w-52 rounded-2xl border border-primary/20 shadow-2xl p-1.5"
                  onMouseEnter={() => openContextSubmenu('openWith')}
                  onMouseLeave={() => scheduleContextSubmenuClose('openWith')}
                  style={{ background: 'color-mix(in srgb, var(--primary) 8%, var(--surface) 100%)' }}
                >
                  {openWithApps.map(appName => (
                    <button
                      key={appName}
                      onClick={() => handleOpenWith(contextFile, appName)}
                      className="w-full rounded-lg px-3 py-1.5 text-left text-[12px] font-bold text-on-surface transition-all hover:bg-primary/10 hover:text-primary"
                    >
                      {appName}
                    </button>
                  ))}
                  <div className="my-1 h-px bg-primary/10" />
                  <button
                    onClick={() => handleOpenWithOther(contextFile)}
                    className="w-full rounded-lg px-3 py-1.5 text-left text-[12px] font-bold text-on-surface transition-all hover:bg-primary/10 hover:text-primary"
                  >
                    {t('explorer.openWithOther', '选择更多…')}
                  </button>
                </div>
              )}
            </div>
            <button onClick={() => handleRenameStart(contextFile)} className="w-full flex items-center gap-3 px-3 py-1.5 rounded-lg hover:bg-primary/10 text-[12px] font-bold transition-all text-on-surface hover:text-primary">
              <Edit3 className="w-4 h-4" /> {t('explorer.rename', '重命名')}
            </button>
            <div className="my-1 h-px bg-primary/10" />
            <button onClick={() => handleCopyToClipboard(getActionFiles(contextFile))} className="w-full flex items-center gap-3 px-3 py-1.5 rounded-lg hover:bg-primary/10 text-[12px] font-bold transition-all text-on-surface hover:text-primary">
              <Copy className="w-4 h-4" /> {t('explorer.copy', '复制')}
            </button>
            <button onClick={() => handleCutToClipboard(getActionFiles(contextFile))} className="w-full flex items-center gap-3 px-3 py-1.5 rounded-lg hover:bg-primary/10 text-[12px] font-bold transition-all text-on-surface hover:text-primary">
              <Edit2 className="w-4 h-4" /> {t('explorer.cut', '剪切')}
            </button>
            <button onClick={() => handleAlias(contextFile)} className="w-full flex items-center gap-3 px-3 py-1.5 rounded-lg hover:bg-primary/10 text-[12px] font-bold transition-all text-on-surface hover:text-primary">
              <Copy className="w-4 h-4" /> {t('explorer.alias', '创建副本')}
            </button>
            <div className="my-1 h-px bg-primary/10" />
            {contextFile.type === 'archive' && (
              <button onClick={() => handleDecompress(contextFile)} className="w-full flex items-center gap-3 px-3 py-1.5 rounded-lg hover:bg-primary/10 text-[12px] font-bold transition-all text-on-surface hover:text-primary">
                <FolderArchive className="w-4 h-4" /> {t('explorer.decompress', '解压')}
              </button>
            )}
            <button onClick={() => handleCompress(contextFile)} className="w-full flex items-center gap-3 px-3 py-1.5 rounded-lg hover:bg-primary/10 text-[12px] font-bold transition-all text-on-surface hover:text-primary">
              <FolderArchive className="w-4 h-4" /> {t('explorer.compress', '压缩')}
            </button>
            <button onClick={() => handleOpenTerminal(contextFile)} className="w-full flex items-center gap-3 px-3 py-1.5 rounded-lg hover:bg-primary/10 text-[12px] font-bold transition-all text-on-surface hover:text-primary">
              <Terminal className="w-4 h-4" /> {t('explorer.openInTerminal', '在终端打开')}
            </button>
            <button onClick={() => handleShowInspector()} className="w-full flex items-center gap-3 px-3 py-1.5 rounded-lg hover:bg-primary/10 text-[12px] font-bold transition-all text-on-surface hover:text-primary">
              <Info className="w-4 h-4" /> {t('explorer.getInfo', '查看简介')}
            </button>
            <button onClick={() => handleCopyNames(getActionFiles(contextFile))} className="w-full flex items-center gap-3 px-3 py-1.5 rounded-lg hover:bg-primary/10 text-[12px] font-bold transition-all text-on-surface hover:text-primary">
              <Copy className="w-4 h-4" /> {t('explorer.copyName', '复制文件名')}
            </button>
            <button onClick={() => handleToggleFavoriteForItems(getActionFiles(contextFile))} className="w-full flex items-center gap-3 px-3 py-1.5 rounded-lg hover:bg-primary/10 text-[12px] font-bold transition-all text-on-surface hover:text-primary">
              <Star className={`w-4 h-4 ${areAllFavorites(getActionFiles(contextFile)) ? 'fill-current' : ''}`} />
              {areAllFavorites(getActionFiles(contextFile)) ? t('explorer.removeFavorite', '取消收藏') : t('explorer.addFavorite', '收藏')}
            </button>
            <div className="px-3 pt-1 pb-1">
              <div className="mb-2 flex items-center gap-2 text-[11px] font-black text-on-surface/45">
                <Tag className="w-3.5 h-3.5" /> {t('explorer.colorTag', '颜色标签')}
              </div>
              <div className="grid grid-cols-7 gap-1.5">
                {Object.entries(tagColors).map(([tag, color]) => (
                  <button
                    key={tag}
                    onClick={() => toggleTagForItems(tag, getActionFiles(contextFile))}
                    className={`relative h-6 w-6 rounded-full border transition-transform hover:scale-110 ${
                      areAllTagged(getActionFiles(contextFile), tag) ? 'border-on-surface shadow-[0_0_0_2px_rgba(var(--primary-rgb),0.35)]' : 'border-white/10'
                    }`}
                    style={{ backgroundColor: color }}
                    title={getTagLabel(tag)}
                  >
                    {areAllTagged(getActionFiles(contextFile), tag) && <Check className="absolute inset-0 m-auto w-3.5 h-3.5 text-white drop-shadow" />}
                  </button>
                ))}
              </div>
            </div>
            <div className="my-1 h-px bg-primary/10" />
            <button onClick={() => handleQuickLook(contextFile)} className="w-full flex items-center gap-3 px-3 py-1.5 rounded-lg hover:bg-primary/10 text-[12px] font-bold transition-all text-on-surface hover:text-primary">
              <Eye className="w-4 h-4" /> {t('explorer.quickLook', 'Quick Look')}
            </button>
            <button onClick={() => handleRevealInFinder(contextFile)} className="w-full flex items-center gap-3 px-3 py-1.5 rounded-lg hover:bg-primary/10 text-[12px] font-bold transition-all text-on-surface hover:text-primary">
              <Folder className="w-4 h-4" /> {t('explorer.revealInFinder', '在 Finder 中显示')}
            </button>
            <button onClick={() => handleCopyPaths(getActionFiles(contextFile))} className="w-full flex items-center gap-3 px-3 py-1.5 rounded-lg hover:bg-primary/10 text-[12px] font-bold transition-all text-on-surface hover:text-primary">
              <Copy className="w-4 h-4" /> {t('explorer.copyPath', '复制路径')}
            </button>
            <div className="my-1 h-px bg-primary/10" />
            <button onClick={() => handleDeleteFile(contextFile)} className="w-full flex items-center gap-3 px-3 py-1.5 rounded-lg hover:bg-red-500/10 text-[13px] font-bold transition-all text-red-500">
              <Trash2 className="w-4 h-4" /> {t('explorer.moveToTrash', '移至废纸篓')}
            </button>

            {enabledContextExtensions.length > 0 && (
              <>
                <div className="my-1 h-px bg-primary/10" />
                {enabledContextExtensions.map(ext => (
                  <button
                    key={ext.id}
                    onClick={() => handleExtensionAction(ext.id, contextFile)}
                    className="w-full flex items-center gap-3 px-3 py-1.5 rounded-lg hover:bg-primary/20 text-[13px] font-bold transition-all text-on-surface"
                  >
                    {getExtensionIcon(ext)}
                    {ext.label}
                  </button>
                ))}
              </>
            )}
          </>
        ) : (
          <>
            {!contextMenu.isBlank && isAdminContextMenuEmpty && !theme.contextMenuExtensions && (
              <div className="px-3 py-4 text-center">
                <p className="text-[12px] text-on-surface/40 italic">{t('explorer.contextMenuDisabled', '右键菜单已禁用')}</p>
                <button onClick={() => onViewChange('settings')} className="mt-2 text-[11px] text-primary font-bold hover:underline">{t('explorer.contextMenuDisabledAction', '去设置中开启')}</button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
