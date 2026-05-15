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
  columnWidth?: number;
  columnHeight?: number;
  showHiddenFiles?: boolean;
  showPreviewPanel?: boolean;
  enableDevTools?: boolean;
  useSystemContextMenu?: boolean;
  wallpaperUrl?: string;
  wallpaperBlur?: number;
  listDensity?: 'relaxed' | 'normal' | 'compact' | 'ultra';
  contextMenuExtensions?: ContextMenuAction[];
  terminalApp?: string;
  terminalArgs?: string;
  terminalScripts?: string[];
  customTerminalCommand?: string;
  defaultHomePath?: string;
  language?: string;
  followSystemLanguage?: boolean;
  languageOptions?: LanguageOption[];
}

export interface TabData {
  id: string;
  labelTranslationKey: string;
  label?: string;
  initialPath?: string;
  currentPath?: string;
}
