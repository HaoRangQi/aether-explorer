export interface FileItem {
  id: string;
  name: string;
  type: 'file' | 'folder' | 'application' | 'image' | 'video' | 'audio' | 'pdf' | 'archive' | 'code' | 'text';
  size?: string;
  modified: string;
  created?: string;
  added?: string;
  lastOpened?: string;
  path: string;
  thumbnail?: string;
  tags?: string[];
  dimensions?: string;
  childCount?: number;
  parentId?: string; // used for folder hierarchy if needed
}

export type ViewMode = string; // allow dynamic tab IDs

export type DisplayMode = 'list' | 'grid' | 'column';

export type GroupBy = 'none' | 'name' | 'kind' | 'application' | 'lastOpened' | 'added' | 'modified' | 'created' | 'size' | 'tags';

export interface ContextMenuAction {
  id: string;
  label: string;
  enabled: boolean;
  isSystem?: boolean;
  actionType?: 'terminal' | 'shell' | 'url' | 'placeholder';
  terminalApp?: string;
  terminalArgs?: string;
  command?: string;
  urlTemplate?: string;
  workingDirectory?: 'selection' | 'current';
  confirmExecution?: boolean;
}

export interface LanguageOption {
  code: string;
  label: string;
  nativeLabel: string;
  source: 'built-in' | 'imported' | 'available';
  completeness: number;
  enabled: boolean;
}

export interface VolumeInfo {
  name: string;
  path: string;
  filesystem: string;
  size: string;
  used: string;
  available: string;
  capacity: string;
  capacity_value: number;
  is_root: boolean;
  is_external: boolean;
  is_ejectable?: boolean;
}

export interface ThemeSettings {
  mode: 'light' | 'dark' | 'auto';
  accentColor: string;
  blurIntensity: number;
  transparency: number;
  enableMica: boolean;
  fontFamily?: string;
  gridSize?: number;
  gridWidth?: number;
  gridHeight?: number;
  gridGap?: number;
  mediaGridWidth?: number;
  mediaGridHeight?: number;
  mediaGridLinked?: boolean;
  columnWidth?: number;
  columnHeight?: number;
  showHiddenFiles?: boolean;
  showPreviewPanel?: boolean;
  /** 空格键调用 macOS Quick Look 预览，默认开启 */
  enableSpacePreview?: boolean;
  enableDevTools?: boolean;
  useSystemContextMenu?: boolean;
  wallpaperUrl?: string;
  wallpaperBlur?: number;
  enableGradient?: boolean;
  listDensity?: 'relaxed' | 'normal' | 'compact' | 'ultra';
  contextMenuExtensions?: ContextMenuAction[];
  terminalApp?: string;
  terminalArgs?: string;
  terminalScripts?: { script: string; enabled: boolean }[];
  customTerminalCommand?: string;
  defaultHomePath?: string;
  /**
   * 跨窗口拖拽默认动作。
   * - `copy` 默认复制（Finder 跨卷一致，最安全）
   * - `move` 默认移动（Finder 同卷一致）
   * - `ask` 拖到目标窗口后弹出选择
   * 修饰键在任何模式下都能临时覆盖（⌘ + 点击切换、⌥ 强制复制、⇧ 强制移动）。
   */
  crossWindowDropDefault?: 'copy' | 'move' | 'ask';
  language?: string;
  followSystemLanguage?: boolean;
  languageOptions?: LanguageOption[];

  // 颜色细化控制（14项）
  colorIcon?: string;              // 图标颜色
  colorSelectedFg?: string;        // 选中前景色
  colorSelectedBg?: string;        // 选中背景色
  colorHoverFg?: string;           // 悬浮前景色
  colorHoverBg?: string;           // 悬浮背景色
  colorPanelBg?: string;           // 面板底色
  colorTextPrimary?: string;       // 主文字色
  colorTextSecondary?: string;     // 次文字色
  colorBorder?: string;            // 边框色
  colorDivider?: string;           // 分隔线色
  colorShadow?: string;            // 阴影色
  colorActiveIconBg?: string;      // 激活图标背景
  colorTagSelected?: string;       // 标签选中色
  colorSearchBg?: string;          // 搜索框底色
  colorAppBg?: string;             // 主背景色（纯色模式下生效）
}

export interface TabData {
  id: string;
  labelTranslationKey: string;
  label?: string;
  initialPath?: string;
  currentPath?: string;
}
