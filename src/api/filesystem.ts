import { invoke } from '@tauri-apps/api/core';
import { convertFileSrc } from '@tauri-apps/api/core';
import type { FileItem } from '../types';

interface RawFileEntry {
  name: string;
  path: string;
  is_dir: boolean;
  size: string;
  modified: string;
  created?: string;
  added?: string;
  lastOpened?: string;
  type: string;
  iconPath?: string;
  childCount?: number;
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
    childCount: item.childCount,
    path: item.path,
  };

  // Generate asset URL for image thumbnails and macOS app bundle icons.
  if (item.type === 'image') {
    mapped.thumbnail = convertFileSrc(item.path);
  } else if (item.type === 'application' && item.iconPath) {
    mapped.thumbnail = convertFileSrc(item.iconPath);
  }

  return mapped;
}

export async function listDirectory(dirPath: string, showHidden = false): Promise<FileItem[]> {
  const entries: RawFileEntry[] = await invoke('list_directory', {
    dirPath,
    showHidden,
  });
  return entries.map(mapEntry);
}

export async function getHomeDir(): Promise<string> {
  return invoke('get_home_dir');
}

// ── File Operations ──

export async function copyFile(src: string, dst: string): Promise<string> {
  return invoke('copy_file', { src, dst });
}

export interface CopyResult {
  copied: string[];
  failed: MoveFailure[];
  conflicts: MoveConflict[];
}

export async function copyFiles(srcs: string[], dstDir: string, conflictStrategy: MoveConflictStrategy = 'abort'): Promise<CopyResult> {
  return invoke<CopyResult>('copy_files', { srcs, dstDir, conflictStrategy });
}

export async function moveFile(src: string, dstDir: string): Promise<string> {
  return invoke('move_file', { src, dstDir });
}

export interface FileTransferPayload {
  paths: string[];
  cut: boolean;
}

export async function setFileClipboard(paths: string[], cut: boolean): Promise<void> {
  return invoke('set_file_clipboard', { paths, cut });
}

export async function getFileClipboard(): Promise<FileTransferPayload | null> {
  return invoke<FileTransferPayload | null>('get_file_clipboard');
}

export async function clearFileClipboard(): Promise<void> {
  return invoke('clear_file_clipboard');
}

export async function setFileDragPayload(paths: string[], cut: boolean): Promise<void> {
  return invoke('set_file_drag_payload', { paths, cut });
}

export async function getFileDragPayload(): Promise<FileTransferPayload | null> {
  return invoke<FileTransferPayload | null>('get_file_drag_payload');
}

export async function clearFileDragPayload(): Promise<void> {
  return invoke('clear_file_drag_payload');
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
  failed: MoveFailure[];
  conflicts: MoveConflict[];
  skippedSameDir: number;
}

export type MoveConflictStrategy = 'abort' | 'replace' | 'keepBoth';

export async function moveFiles(srcs: string[], dstDir: string, conflictStrategy: MoveConflictStrategy = 'abort'): Promise<MoveResult> {
  return invoke<MoveResult>('move_files', { srcs, dstDir, conflictStrategy });
}

export async function renameFile(path: string, newName: string): Promise<string> {
  return invoke('rename_file', { path, newName });
}

export async function deleteToTrash(path: string): Promise<void> {
  return invoke('delete_to_trash', { path });
}

export async function createFile(parentDir: string, name: string): Promise<string> {
  return invoke('create_file', { parentDir, name });
}

export async function createFolder(parentDir: string, name: string): Promise<string> {
  return invoke('create_folder', { parentDir, name });
}

export async function makeAlias(path: string): Promise<string> {
  return invoke('make_alias', { path });
}

export async function compressFiles(paths: string[], output: string): Promise<string> {
  return invoke('compress_files', { paths, output });
}

export async function decompressFile(path: string, outputDir: string): Promise<string> {
  return invoke('decompress_file', { path, outputDir });
}

export async function getFileInfo(path: string): Promise<FileItem> {
  const entry: RawFileEntry = await invoke('get_file_info', { path });
  return mapEntry(entry);
}
