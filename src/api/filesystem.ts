import type { FileItem, RemoteAuthMethod, RemoteConnection, RemoteConnectionProtocol } from '../types';
import { normalizeAppError } from '../lib/app-error';
import { getCachedAssetUrl } from '../lib/asset-url-cache';
import { isRemotePath } from '../lib/path-helpers';
import { safeInvoke } from '../lib/tauri-runtime';

interface RawFileEntry {
  name: string;
  path: string;
  is_dir: boolean;
  size: string;
  modified: string;
  created?: string;
  added?: string;
  lastOpened?: string;
  openWith?: string;
  type: string;
  iconPath?: string;
  childCount?: number;
}

const REMOTE_REQUEST_TIMEOUT_MS = 5_000;

function withRemoteRequestTimeout<T>(request: Promise<T>, message: string): Promise<T> {
  let timeoutId: number | undefined;
  const timeout = new Promise<T>((_, reject) => {
    timeoutId = window.setTimeout(() => reject(new Error(message)), REMOTE_REQUEST_TIMEOUT_MS);
  });
  return Promise.race([request, timeout]).finally(() => {
    if (timeoutId !== undefined) window.clearTimeout(timeoutId);
  });
}

export interface DirectorySizeEstimate {
  path: string;
  bytes: number;
  formatted: string;
  isApproximate: boolean;
}

export type DirectorySizeTaskStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface DirectorySizeTaskSnapshot {
  id: string;
  path: string;
  status: DirectorySizeTaskStatus;
  bytes: number;
  formatted: string;
  allocatedBytes: number;
  formattedAllocated: string;
  fileCount: number;
  skippedCount: number;
  isApproximate: boolean;
  startedAt: number;
  finishedAt?: number | null;
  error?: string | null;
}

function mapEntry(item: RawFileEntry): FileItem {
  const mapped: FileItem = {
    id: item.path,
    name: item.name,
    type: item.type as FileItem['type'],
    size: item.size,
    modified: item.modified,
    created: item.created,
    added: item.added,
    lastOpened: item.lastOpened,
    openWith: item.openWith,
    childCount: item.childCount,
    path: item.path,
  };

  // Generate asset URL for local media thumbnails and macOS app bundle icons.
  if ((item.type === 'image' || item.type === 'video') && !isRemotePath(item.path)) {
    mapped.thumbnail = getCachedAssetUrl(item.path);
  } else if (item.type === 'application' && item.iconPath && !isRemotePath(item.iconPath)) {
    mapped.thumbnail = getCachedAssetUrl(item.iconPath);
  }

  return mapped;
}

async function invokeFs<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return await safeInvoke<T>(command, args);
  } catch (error) {
    throw normalizeAppError(error);
  }
}

export interface ListDirectoryOptions {
  requestScope?: string;
  requestId?: number;
}

export async function listDirectory(
  dirPath: string,
  showHidden = false,
  options: ListDirectoryOptions = {},
): Promise<FileItem[]> {
  const entries: RawFileEntry[] = await invokeFs('list_directory', {
    dirPath,
    showHidden,
    requestScope: options.requestScope,
    requestId: options.requestId,
  });
  return entries.map(mapEntry);
}

export async function cancelDirectoryLoads(requestScope: string, requestId: number): Promise<void> {
  await invokeFs('cancel_directory_loads', { requestScope, requestId });
}

export interface DirectorySignature {
  fingerprint: string;
  entry_count: number;
}

export async function getDirectorySignature(path: string, showHidden = false): Promise<DirectorySignature> {
  return invokeFs('get_directory_signature', { path, showHidden });
}

export async function estimateDirsSizeFast(paths: string[]): Promise<DirectorySizeEstimate[]> {
  if (!Array.isArray(paths) || paths.length === 0) return [];
  return invokeFs<DirectorySizeEstimate[]>('estimate_dirs_size_fast', { paths });
}

export async function startDirSizeTask(path: string): Promise<string> {
  return invokeFs<string>('start_dir_size_task', { path });
}

export async function getDirSizeTask(taskId: string): Promise<DirectorySizeTaskSnapshot | null> {
  return invokeFs<DirectorySizeTaskSnapshot | null>('get_dir_size_task', { taskId });
}

export async function cancelDirSizeTask(taskId: string): Promise<void> {
  return invokeFs('cancel_dir_size_task', { taskId });
}

export async function getAppIcon(path: string): Promise<string | null> {
  const iconPath = await invokeFs<string | null>('get_app_icon', { path });
  return iconPath ? getCachedAssetUrl(iconPath) : null;
}

export async function getHomeDir(): Promise<string> {
  return invokeFs('get_home_dir');
}

// ── File Operations ──

export async function copyFile(src: string, dst: string): Promise<string> {
  return invokeFs('copy_file', { src, dst });
}

export interface CopyResult {
  copied: string[];
  failed: MoveFailure[];
  conflicts: MoveConflict[];
  skippedConflicts: number;
}

export async function copyFiles(srcs: string[], dstDir: string, conflictStrategy: MoveConflictStrategy = 'abort'): Promise<CopyResult> {
  return invokeFs<CopyResult>('copy_files', { srcs, dstDir, conflictStrategy });
}

export async function previewCopyFileConflicts(srcs: string[], dstDir: string): Promise<MoveConflict[]> {
  return invokeFs<MoveConflict[]>('preview_copy_file_conflicts', { srcs, dstDir });
}

export async function previewMoveFileConflicts(srcs: string[], dstDir: string): Promise<MoveConflict[]> {
  return invokeFs<MoveConflict[]>('preview_move_file_conflicts', { srcs, dstDir });
}

export type TransferTaskKind = 'copy' | 'move';
export type TransferTaskStatus = 'queued' | 'running' | 'cancelling' | 'completed' | 'failed' | 'cancelled';

export interface TransferTaskSnapshot {
  id: string;
  kind: TransferTaskKind;
  status: TransferTaskStatus;
  totalItems: number;
  completedItems: number;
  totalBytes: number;
  completedBytes: number;
  currentName?: string | null;
  error?: string | null;
  startedAt: number;
  finishedAt?: number | null;
  copied: number;
  moved: number;
  copiedCrossDevice: number;
  failed: number;
  conflicts: number;
  skipped: number;
  skippedSameDir: number;
  skippedConflicts: number;
}

export async function startCopyFilesTask(
  srcs: string[],
  dstDir: string,
  conflictStrategy: MoveConflictStrategy = 'abort',
): Promise<string> {
  return invokeFs<string>('start_copy_files_task', { srcs, dstDir, conflictStrategy });
}

export async function startMoveFilesTask(
  srcs: string[],
  dstDir: string,
  conflictStrategy: MoveConflictStrategy = 'abort',
): Promise<string> {
  return invokeFs<string>('start_move_files_task', { srcs, dstDir, conflictStrategy });
}

export async function listTransferTasks(): Promise<TransferTaskSnapshot[]> {
  return invokeFs<TransferTaskSnapshot[]>('list_transfer_tasks');
}

export async function cancelTransferTask(taskId: string): Promise<void> {
  return invokeFs('cancel_transfer_task', { taskId });
}

export async function clearFinishedTransferTasks(): Promise<void> {
  return invokeFs('clear_finished_transfer_tasks');
}

export async function moveFile(src: string, dstDir: string): Promise<string> {
  return invokeFs('move_file', { src, dstDir });
}

export interface FileTransferPayload {
  paths: string[];
  cut: boolean;
  sourceWindow?: string;
  transferId?: string;
  previewName?: string;
  count?: number;
}

export async function setFileClipboard(paths: string[], cut: boolean): Promise<void> {
  return invokeFs('set_file_clipboard', { paths, cut });
}

export async function getFileClipboard(): Promise<FileTransferPayload | null> {
  return invokeFs<FileTransferPayload | null>('get_file_clipboard');
}

export async function clearFileClipboard(): Promise<void> {
  return invokeFs('clear_file_clipboard');
}

export interface FileDragMeta {
  sourceWindow?: string;
  transferId?: string;
  previewName?: string;
  count?: number;
}

export async function setFileDragPayload(
  paths: string[],
  cut: boolean,
  meta: FileDragMeta = {},
): Promise<void> {
  return invokeFs('set_file_drag_payload', {
    paths,
    cut,
    sourceWindow: meta.sourceWindow,
    transferId: meta.transferId,
    previewName: meta.previewName,
    count: meta.count,
  });
}

export async function getFileDragPayload(): Promise<FileTransferPayload | null> {
  return invokeFs<FileTransferPayload | null>('get_file_drag_payload');
}

export async function clearFileDragPayload(): Promise<void> {
  return invokeFs('clear_file_drag_payload');
}

export interface MoveFailure {
  src: string;
  error: string;
}

export interface MoveConflict {
  src: string;
  dst: string;
  name: string;
}

export interface MoveResult {
  moved: string[];
  copiedCrossDevice: string[];
  failed: MoveFailure[];
  conflicts: MoveConflict[];
  skippedSameDir: number;
  skippedConflicts: number;
}

export type MoveConflictStrategy = 'abort' | 'replace' | 'keepBoth' | 'skip';

export async function moveFiles(srcs: string[], dstDir: string, conflictStrategy: MoveConflictStrategy = 'abort'): Promise<MoveResult> {
  return invokeFs<MoveResult>('move_files', { srcs, dstDir, conflictStrategy });
}

export async function renameFile(path: string, newName: string): Promise<string> {
  return invokeFs('rename_file', { path, newName });
}

export async function deleteToTrash(path: string): Promise<void> {
  return invokeFs('delete_to_trash', { path });
}

export async function createFile(parentDir: string, name: string): Promise<string> {
  return invokeFs('create_file', { parentDir, name });
}

export async function createFolder(parentDir: string, name: string): Promise<string> {
  return invokeFs('create_folder', { parentDir, name });
}

export async function duplicateAsAlias(path: string): Promise<string> {
  return invokeFs('duplicate_as_alias', { path });
}

export interface FileHashResult {
  path: string;
  algorithm: string;
  value: string;
}

export async function calculateFileHash(path: string): Promise<FileHashResult> {
  return invokeFs<FileHashResult>('calculate_file_hash', { path });
}

export async function compressFiles(paths: string[], output: string): Promise<string> {
  return invokeFs('compress_files', { paths, output });
}

export async function decompressFile(path: string, outputDir: string): Promise<string> {
  return invokeFs('decompress_file', { path, outputDir });
}

export async function getFileInfo(path: string): Promise<FileItem> {
  const entry: RawFileEntry = await invokeFs('get_file_info', { path });
  return mapEntry(entry);
}

export interface OpenWithOption {
  name: string;
  path: string;
  isDefault: boolean;
}

export async function getOpenWithOptions(path: string): Promise<OpenWithOption[]> {
  return invokeFs<OpenWithOption[]>('get_open_with_options', { path });
}

export async function setDefaultOpenWith(path: string, appPath: string): Promise<string> {
  return invokeFs<string>('set_default_open_with', { path, appPath });
}

export async function pickApplication(): Promise<string | null> {
  return invokeFs<string | null>('pick_application');
}

export interface SaveRemoteConnectionInput {
  id?: string;
  name: string;
  protocol: RemoteConnectionProtocol;
  host: string;
  port?: number;
  username?: string;
  basePath?: string;
  authMethod?: RemoteAuthMethod;
  password?: string;
  privateKeyPath?: string;
  privateKeyPassphrase?: string;
}

export interface ListRemoteDirectoryInput {
  connectionId: string;
  remotePath: string;
  showHidden: boolean;
}

export async function listRemoteConnections(): Promise<RemoteConnection[]> {
  return invokeFs<RemoteConnection[]>('list_remote_connections');
}

export async function saveRemoteConnection(input: SaveRemoteConnectionInput): Promise<RemoteConnection> {
  return invokeFs<RemoteConnection>('save_remote_connection', { input });
}

export async function deleteRemoteConnection(connectionId: string): Promise<void> {
  return invokeFs('delete_remote_connection', { connectionId });
}

export async function testRemoteConnection(connectionId: string): Promise<void> {
  return withRemoteRequestTimeout(
    invokeFs('test_remote_connection', { connectionId }),
    '远程连接测试超时，请检查服务器地址、端口、账号凭据和网络。',
  );
}

export async function testRemoteConnectionInput(input: SaveRemoteConnectionInput): Promise<void> {
  return withRemoteRequestTimeout(
    invokeFs('test_remote_connection_input', { input }),
    '远程连接测试超时，请检查服务器地址、端口、账号凭据和网络。',
  );
}

export async function listRemoteDirectory(input: ListRemoteDirectoryInput): Promise<FileItem[]> {
  const entries = await withRemoteRequestTimeout(
    invokeFs<RawFileEntry[]>('list_remote_directory', { input }),
    '远程目录加载超时，请检查服务器地址、端口、账号凭据和网络。',
  );
  return entries.map(mapEntry);
}
