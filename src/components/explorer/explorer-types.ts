import type React from 'react';
import type {
  MoveConflict,
  MoveConflictStrategy,
  TransferTaskSnapshot,
} from '../../api/filesystem';
import type {
  FileItem,
  OperationCategory,
  OperationEffect,
  OperationStatus,
  RemoteConnection,
  ThemeSettings,
  ViewMode,
} from '../../types';

export interface InternalDragState {
  id: string;
  startX: number;
  startY: number;
  active: boolean;
}

export interface MoveConflictDialogState {
  filesToMove: FileItem[];
  targetFolder: FileItem;
  conflicts: MoveConflict[];
  operation: 'move' | 'copy';
  clearClipboardOnSuccess?: boolean;
  clearDragPayloadOnSuccess?: boolean;
  useTransferTaskOnResolve?: boolean;
}

export interface ExistingOutputDialogState {
  name: string;
  path: string;
  kind: 'archive' | 'folder';
  onResolve: (choice: 'replace' | 'keepBoth' | 'cancel') => void;
}

export type ExistingOutputChoice = 'replace' | 'keepBoth' | 'cancel';

export interface FileOperationOptions {
  clearClipboardOnSuccess?: boolean;
  clearDragPayloadOnSuccess?: boolean;
  skipLargeBatchConfirm?: boolean;
  useTransferTask?: boolean;
}

export interface TransferTaskWaitMessages {
  success: string;
  failed: string;
  failedDefaultValue: string;
  failurePathHints?: string[];
  onCompleted?: (task: TransferTaskSnapshot | null) => void | Promise<void>;
  onFinished?: (task: TransferTaskSnapshot) => boolean;
  onSettled?: (task: TransferTaskSnapshot | null) => void | Promise<void>;
}

export interface ManualHistoryRecordInput {
  category: OperationCategory;
  title: string;
  summary: string;
  effects?: OperationEffect[];
  itemCount?: number;
  status?: OperationStatus;
  canUndo?: boolean;
  reasonNotUndoable?: string;
  primaryPath?: string;
  targetPath?: string;
  conflictStrategy?: MoveConflictStrategy;
  volumeHint?: 'same-volume' | 'cross-volume' | 'mixed';
}

export interface IncomingFileDrag {
  paths: string[];
  sourceWindow: string;
  transferId: string;
  previewName: string;
  count: number;
  cut: boolean;
  shownAt: number;
}

export interface FileDragBroadcastPayload {
  paths: string[];
  sourceWindow: string;
  transferId: string;
  previewName: string;
  count: number;
  cut: boolean;
}

export interface FileDropAcceptedPayload {
  transferId: string;
  paths: string[];
  op: 'copy' | 'move' | 'mixed';
  targetWindow: string;
  moved?: number;
  copiedCrossDevice?: number;
}

export interface FileDropStartedPayload {
  transferId: string;
}

export interface MoveExecutionSummary {
  started: boolean;
  moved: number;
  copiedCrossDevice: number;
  failed: number;
  conflicts: number;
  skipped: number;
}

export type MoveConflictChoice = MoveConflictStrategy | 'cancel';

export interface DragPreviewState {
  x: number;
  y: number;
  fileId: string;
  count: number;
  active: boolean;
}

export type DirectoryErrorKind = 'permission' | 'notFound' | 'generic';

export interface ProtectedRootInfo {
  path: string;
  label: string;
}

export interface FileDragEndAtPayload {
  transferId: string;
  screenX: number;
  screenY: number;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  sourceWindow: string;
}

export interface TauriDragDropPayload {
  paths: string[];
  position: { x: number; y: number };
}

export interface ExplorerViewProps {
  view: ViewMode;
  isActive?: boolean;
  currentTabLabelKey?: string;
  initialPath?: string;
  remoteConnections?: RemoteConnection[];
  theme: ThemeSettings;
  selectedFileIds: string[];
  onSelectFiles: (ids: string[]) => void;
  onSelectionCountChange?: (count: number) => void;
  onStartTransfer: () => void;
  onOpenTab?: (id: string, labelKey: string, options?: { label?: string; initialPath?: string }) => void;
  onCreateWindow?: (path?: string, label?: string) => void;
  favorites: string[];
  onToggleFavorite: (id: string) => void;
  fileTags: Record<string, string[]>;
  onFileTagsChange: React.Dispatch<React.SetStateAction<Record<string, string[]>>>;
  recentItems: string[];
  onRecordRecent: (path: string) => void;
  onClearRecent: () => void;
  onThemeChange: (theme: ThemeSettings) => void;
  onViewChange: (view: ViewMode) => void;
  onTitleChange?: (tabId: string, title: string) => void;
  onPathChange?: (tabId: string, path: string) => void;
}
