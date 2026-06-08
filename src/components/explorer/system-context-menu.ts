import { PhysicalPosition } from '@tauri-apps/api/dpi';
import { Menu, MenuItem, PredefinedMenuItem, Submenu } from '@tauri-apps/api/menu';
import type { TFunction } from 'i18next';
import { isRemotePath } from '../../lib/path-helpers';
import { safeCurrentWindow } from '../../lib/tauri-runtime';
import type { ContextMenuAction, FileItem, ThemeSettings } from '../../types';
import {
  FAVORITES_VIRTUAL_PATH,
  OPEN_WITH_APPS,
  TAG_COLORS,
} from './explorer-constants';

type MaybePromise<T> = T | Promise<T>;
type SystemContextMenuPosition = { x: number; y: number };

export type OpenExplorerSystemContextMenuArgs = {
  areAllFavorites: (items: FileItem[]) => boolean;
  areAllTagged: (items: FileItem[], tagId: string) => boolean;
  currentPath: string;
  enabledContextExtensions: ContextMenuAction[];
  focusCurrentWindow: () => MaybePromise<void>;
  getActionFiles: (file?: FileItem) => FileItem[];
  getTagLabel: (tagId: string) => string;
  handleAlias: (file: FileItem) => MaybePromise<void>;
  handleCompress: (file: FileItem) => MaybePromise<void>;
  handleCopyNames: (items?: FileItem[]) => MaybePromise<void>;
  handleCopyPaths: (items?: FileItem[]) => MaybePromise<void>;
  handleCopyToClipboard: (items?: FileItem[]) => MaybePromise<void>;
  handleCutToClipboard: (items?: FileItem[]) => MaybePromise<void>;
  handleDecompress: (file: FileItem) => MaybePromise<void>;
  handleDeleteFile: (file: FileItem) => MaybePromise<void>;
  handleExtensionAction: (id: string, file: FileItem) => MaybePromise<void>;
  handleNewFile: (targetPath?: string) => MaybePromise<void>;
  handleNewFolder: (targetPath?: string) => MaybePromise<void>;
  handleOpenFile: (file: FileItem) => MaybePromise<void>;
  handleOpenTerminal: (file?: FileItem | null) => MaybePromise<void>;
  handleOpenWith: (file: FileItem, appName: string) => MaybePromise<void>;
  handleOpenWithOther: (file: FileItem) => MaybePromise<void>;
  handlePasteFromClipboard: (targetPath?: string) => MaybePromise<void>;
  handleQuickLook: (file?: FileItem) => MaybePromise<void>;
  handleRenameStart: (file: FileItem) => void;
  handleRevealInFinder: (file?: FileItem) => MaybePromise<void>;
  handleSetCurrentAsHome: () => void;
  handleShowInspector: (useCurrentDir?: boolean) => void;
  handleSort: (key: string) => void;
  handleToggleFavoriteForItems: (items?: FileItem[]) => void;
  isBlank?: boolean;
  isRemoteRoot: boolean;
  position?: SystemContextMenuPosition;
  refreshCurrentDir: (fullRefresh?: boolean, refreshPath?: string) => MaybePromise<unknown>;
  refreshFileClipboardState: () => Promise<{ paths: string[] } | null>;
  setShowAIRename: (show: boolean) => void;
  setShowOperationHistory: (show: boolean) => void;
  showFeedback: (message: string) => void;
  t: TFunction;
  targetDir?: string;
  targetFiles: FileItem[];
  theme: ThemeSettings;
  toggleTagForItems: (tagId: string, items?: FileItem[]) => void;
};

export async function openExplorerSystemContextMenu({
  areAllFavorites,
  areAllTagged,
  currentPath,
  enabledContextExtensions,
  focusCurrentWindow,
  getActionFiles,
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
  isBlank = false,
  isRemoteRoot,
  position,
  refreshCurrentDir,
  refreshFileClipboardState,
  setShowAIRename,
  setShowOperationHistory,
  showFeedback,
  t,
  targetDir,
  targetFiles,
  theme,
  toggleTagForItems,
}: OpenExplorerSystemContextMenuArgs) {
  await focusCurrentWindow();
  const currentWindow = safeCurrentWindow() as never;
  const primary = targetFiles[0] ?? null;
  const items: Array<
    | Awaited<ReturnType<typeof MenuItem.new>>
    | Awaited<ReturnType<typeof PredefinedMenuItem.new>>
    | Awaited<ReturnType<typeof Submenu.new>>
  > = [];

  const popupMenu = async () => {
    const menu = await Menu.new({ items });
    await menu.popup(
      theme.useSystemContextMenu
        ? undefined
        : (position ? new PhysicalPosition(position.x, position.y) : undefined),
      currentWindow,
    );
  };

  const addSeparator = async () => {
    items.push(await PredefinedMenuItem.new({ item: 'Separator' }));
  };

  if (isBlank || !primary) {
    if (isRemoteRoot) {
      items.push(await MenuItem.new({
        text: t('explorer.refresh', '刷新'),
        action: () => { void refreshCurrentDir(true); },
      }));
      items.push(await MenuItem.new({
        text: t('explorer.getInfo', '查看简介'),
        action: () => { void handleShowInspector(true); },
      }));
      await popupMenu();
      return;
    }

    items.push(await MenuItem.new({
      text: t('explorer.newFolder', '新建文件夹'),
      action: () => { void handleNewFolder(targetDir); },
    }));
    items.push(await MenuItem.new({
      text: t('explorer.newFile', '新建文件'),
      action: () => { void handleNewFile(targetDir); },
    }));
    await addSeparator();
    items.push(await MenuItem.new({
      text: t('explorer.refresh', '刷新'),
      action: () => { void refreshCurrentDir(true, targetDir); },
    }));
    items.push(await MenuItem.new({
      text: t('explorer.sortByName', '按名称排序'),
      action: () => { void handleSort('name'); },
    }));
    await addSeparator();
    items.push(await MenuItem.new({
      text: t('explorer.getInfo', '查看简介'),
      action: () => { void handleShowInspector(true); },
    }));
    const clipboardPayload = await refreshFileClipboardState();
    const canPaste = Boolean(clipboardPayload?.paths.length);
    items.push(await MenuItem.new({
      text: t('explorer.paste', '粘贴'),
      enabled: canPaste,
      action: () => { void handlePasteFromClipboard(targetDir); },
    }));
    await addSeparator();
    const isAlreadyHome = currentPath === (theme.defaultHomePath || FAVORITES_VIRTUAL_PATH);
    items.push(await MenuItem.new({
      text: isAlreadyHome
        ? t('explorer.alreadyHome', '已是首页')
        : t('explorer.setAsHome', '设为首页'),
      enabled: !isAlreadyHome && !!currentPath,
      action: () => { handleSetCurrentAsHome(); },
    }));
    await addSeparator();
    items.push(await MenuItem.new({
      text: t('explorer.aiAssistant', 'AI 文件助手'),
      action: () => {
        if (isRemoteRoot) {
          showFeedback(t('messages.remoteReadOnly', { defaultValue: '远程访问第一版仅支持浏览。' }));
          return;
        }
        setShowAIRename(true);
      },
    }));
    items.push(await MenuItem.new({
      text: t('explorer.aiHistory', '操作历史'),
      action: () => { setShowOperationHistory(true); },
    }));
  } else {
    const primaryIsRemote = isRemotePath(primary.path);
    if (primaryIsRemote) {
      items.push(await MenuItem.new({
        text: t('explorer.open', '打开'),
        action: () => { void handleOpenFile(primary); },
      }));
      items.push(await MenuItem.new({
        text: t('explorer.getInfo', '查看简介'),
        action: () => { void handleShowInspector(); },
      }));
      items.push(await MenuItem.new({
        text: t('explorer.copyName', '复制文件名'),
        action: () => { void handleCopyNames(getActionFiles(primary)); },
      }));
      items.push(await MenuItem.new({
        text: t('explorer.copyPath', '复制路径'),
        action: () => { void handleCopyPaths(getActionFiles(primary)); },
      }));
      await popupMenu();
      return;
    }

    items.push(await MenuItem.new({
      text: t('explorer.open', '打开'),
      action: () => { void handleOpenFile(primary); },
    }));
    items.push(await Submenu.new({
      text: t('explorer.openWith', '打开方式'),
      items: await Promise.all([
        ...OPEN_WITH_APPS.map(appName => MenuItem.new({
          text: appName,
          action: () => { void handleOpenWith(primary, appName); },
        })),
        MenuItem.new({
          text: t('explorer.openWithOther', '选择更多…'),
          action: () => { void handleOpenWithOther(primary); },
        }),
      ]),
    }));
    items.push(await MenuItem.new({
      text: t('explorer.rename', '重命名'),
      action: () => { void handleRenameStart(primary); },
    }));
    items.push(await MenuItem.new({
      text: t('explorer.aiAssistant', 'AI 文件助手'),
      action: () => {
        if (getActionFiles(primary).some(file => isRemotePath(file.path))) {
          showFeedback(t('messages.remoteReadOnly', { defaultValue: '远程访问第一版仅支持浏览。' }));
          return;
        }
        setShowAIRename(true);
      },
    }));
    await addSeparator();
    items.push(await MenuItem.new({
      text: t('explorer.copy', '复制'),
      action: () => { void handleCopyToClipboard(getActionFiles(primary)); },
    }));
    items.push(await MenuItem.new({
      text: t('explorer.cut', '剪切'),
      action: () => { void handleCutToClipboard(getActionFiles(primary)); },
    }));
    items.push(await MenuItem.new({
      text: t('explorer.alias', '创建副本'),
      action: () => { void handleAlias(primary); },
    }));
    await addSeparator();
    if (primary.type === 'archive') {
      items.push(await MenuItem.new({
        text: t('explorer.decompress', '解压'),
        action: () => { void handleDecompress(primary); },
      }));
    }
    items.push(await MenuItem.new({
      text: t('explorer.compress', '压缩'),
      action: () => { void handleCompress(primary); },
    }));
    items.push(await MenuItem.new({
      text: t('explorer.openInTerminal', '在终端打开'),
      action: () => { void handleOpenTerminal(primary); },
    }));
    items.push(await MenuItem.new({
      text: t('explorer.getInfo', '查看简介'),
      action: () => { void handleShowInspector(); },
    }));
    items.push(await MenuItem.new({
      text: t('explorer.copyName', '复制文件名'),
      action: () => { void handleCopyNames(getActionFiles(primary)); },
    }));
    items.push(await MenuItem.new({
      text: areAllFavorites(getActionFiles(primary))
        ? t('explorer.removeFavorite', '取消收藏')
        : t('explorer.addFavorite', '收藏'),
      action: () => { void handleToggleFavoriteForItems(getActionFiles(primary)); },
    }));
    items.push(await Submenu.new({
      text: t('explorer.colorTag', '颜色标签'),
      items: await Promise.all(Object.keys(TAG_COLORS).map(tag => MenuItem.new({
        text: `${areAllTagged(getActionFiles(primary), tag) ? '✓ ' : ''}${getTagLabel(tag)}`,
        action: () => { void toggleTagForItems(tag, getActionFiles(primary)); },
      }))),
    }));
    await addSeparator();
    items.push(await MenuItem.new({
      text: t('explorer.quickLook', 'Quick Look'),
      action: () => { void handleQuickLook(primary); },
    }));
    items.push(await MenuItem.new({
      text: t('explorer.revealInFinder', '在 Finder 中显示'),
      action: () => { void handleRevealInFinder(primary); },
    }));
    items.push(await MenuItem.new({
      text: t('explorer.copyPath', '复制路径'),
      action: () => { void handleCopyPaths(getActionFiles(primary)); },
    }));
    await addSeparator();
    items.push(await MenuItem.new({
      text: t('explorer.moveToTrash', '移至废纸篓'),
      action: () => { void handleDeleteFile(primary); },
    }));
    if (enabledContextExtensions.length > 0) {
      await addSeparator();
      for (const ext of enabledContextExtensions) {
        items.push(await MenuItem.new({
          text: ext.label,
          action: () => { void handleExtensionAction(ext.id, primary); },
        }));
      }
    }
  }

  await popupMenu();
}
