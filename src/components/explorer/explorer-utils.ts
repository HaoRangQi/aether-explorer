import type { DirectorySizeTaskSnapshot, MoveConflictStrategy, TransferTaskSnapshot } from '../../api/filesystem';
import { getCachedAssetUrl } from '../../lib/asset-url-cache';
import { normalizeAppError } from '../../lib/app-error';
import { getParentPath } from '../../lib/path-helpers';
import type { FileItem, OperationEffect, OperationStatus } from '../../types';
import type { DirectorySizeInfo } from './preview-panel-types';

export function formatAppError(error: unknown): string {
  return normalizeAppError(error).userMessage;
}

export function parseModifiedTimestamp(value?: string): number {
  if (!value) return 0;
  const ts = new Date(value.replace(' ', 'T')).getTime();
  return Number.isNaN(ts) ? 0 : ts;
}

export function parseSizeToBytes(size?: string): number {
  if (!size || size === '--') return 0;
  const normalized = size.trim().toUpperCase();
  const parsed = Number.parseFloat(normalized);
  if (!Number.isFinite(parsed)) return 0;
  if (/(?:^|\s)(?:T|TB)$/.test(normalized)) return parsed * 1024 * 1024 * 1024 * 1024;
  if (/(?:^|\s)(?:G|GB)$/.test(normalized)) return parsed * 1024 * 1024 * 1024;
  if (/(?:^|\s)(?:M|MB)$/.test(normalized)) return parsed * 1024 * 1024;
  if (/(?:^|\s)(?:K|KB)$/.test(normalized)) return parsed * 1024;
  return parsed;
}

// 将 "YYYY-MM-DD HH:mm" 转为相对时间标签，超出 7 天返回空字符串
export function getRelativeTimeLabel(modified: string): string {
  if (!modified || modified === '未知') return '';
  const date = new Date(modified.replace(' ', 'T'));
  if (isNaN(date.getTime())) return '';
  const diffMs = Date.now() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return '刚刚';
  if (diffMin <= 10) return `${diffMin} 分钟前`;
  if (diffMin < 30) return '半小时内';
  if (diffMin < 60) return '1 小时内';
  const diffDays = Math.floor(diffMs / 86400000);
  if (diffDays < 1) return '今天';
  if (diffDays < 2) return '昨天';
  if (diffDays <= 7) return `${diffDays} 天前`;
  return '';
}

export function buildTimestampTextFileName(date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
  ].join('') + '.txt';
}

export function getPdfPreviewSrc(path: string) {
  return `${getCachedAssetUrl(path)}#page=1&view=FitH&toolbar=0&navpanes=0&scrollbar=0`;
}

export function buildMoveTaskDedupeKey(paths: string[], targetPath: string, strategy: MoveConflictStrategy): string {
  const normalizedTarget = targetPath && targetPath !== '/'
    ? targetPath.replace(/\/+$/, '')
    : targetPath || '/';
  const normalizedPaths = Array.from(new Set(paths.filter(Boolean)))
    .map(path => (path && path !== '/' ? path.replace(/\/+$/, '') : path || '/'))
    .sort();
  return `${strategy}::${normalizedTarget}::${normalizedPaths.join('\u001f')}`;
}

export function buildMoveRefreshPaths(paths: string[], targetPath: string): string[] {
  const refreshPaths = new Set<string>();
  if (targetPath) refreshPaths.add(targetPath);
  paths
    .filter(Boolean)
    .map(path => getParentPath(path))
    .forEach(path => refreshPaths.add(path));
  return Array.from(refreshPaths);
}

export function getNameFromPath(path: string): string {
  const parts = path.split('/').filter(Boolean);
  return parts[parts.length - 1] || path || '/';
}

export function makeFileItemsFromPaths(paths: string[]): FileItem[] {
  return paths.map(path => ({
    id: path,
    name: getNameFromPath(path),
    type: 'file',
    size: '--',
    modified: '',
    path,
  }));
}

export function makeFolderItemFromPath(path: string): FileItem {
  return {
    id: path,
    name: getNameFromPath(path),
    type: 'folder',
    size: '--',
    modified: '',
    path,
  };
}

export function resolveOperationStatusByEffects(effects: OperationEffect[]): OperationStatus {
  const okCount = effects.filter(effect => effect.status === 'ok').length;
  const failCount = effects.filter(effect => effect.status === 'fail').length;
  if (failCount > 0 && okCount > 0) return 'partial';
  if (failCount > 0 && okCount === 0) return 'failed';
  return 'success';
}

export function resolveTransferTaskOperationStatus(task: TransferTaskSnapshot | null): OperationStatus {
  if (!task) return 'failed';
  if (task.status === 'cancelled') return 'failed';
  if (task.status === 'failed') {
    const completed = task.moved + task.copied + task.copiedCrossDevice;
    return completed > 0 ? 'partial' : 'failed';
  }
  if (task.failed > 0 || task.skipped > 0) return 'partial';
  return 'success';
}

export function resolveTransferTaskVolumeHint(task: TransferTaskSnapshot | null): 'same-volume' | 'cross-volume' | 'mixed' | undefined {
  if (!task) return undefined;
  if (task.copiedCrossDevice > 0 && task.moved > 0) return 'mixed';
  if (task.copiedCrossDevice > 0) return 'cross-volume';
  return 'same-volume';
}

export function getBaseNameFromPath(path: string): string {
  const parts = path.split('/').filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : path;
}

export function joinDirAndName(dir: string, name: string): string {
  if (dir === '/') return `/${name}`;
  return `${dir.replace(/\/+$/, '')}/${name}`;
}

export function buildMoveEffects(paths: string[], targetDir: string, includeReverse: boolean): OperationEffect[] {
  return paths.map(path => {
    const name = getBaseNameFromPath(path);
    const originalDir = path.split('/').slice(0, -1).join('/') || '/';
    const movedPath = joinDirAndName(targetDir, name);
    return {
      op: { type: 'move', path, targetDir },
      status: 'ok',
      reverseOp: includeReverse
        ? { type: 'move', path: movedPath, targetDir: originalDir }
        : undefined,
    } satisfies OperationEffect;
  });
}

export function canUndoTransferMove(task: TransferTaskSnapshot | null, expectedCount: number): boolean {
  if (!task) return false;
  if (task.status !== 'completed') return false;
  if (task.copiedCrossDevice > 0) return false;
  if (task.failed > 0 || task.skipped > 0) return false;
  return task.moved === expectedCount;
}

export function getItemDirectory(file: FileItem): string {
  return file.type === 'folder' ? file.path : file.path.split('/').slice(0, -1).join('/') || '/';
}

export function buildTemplateValues(file: FileItem, currentPath: string) {
  return {
    path: file.path,
    dir: getItemDirectory(file),
    name: file.name,
    currentPath,
  };
}

export function directorySizeInfoFromTaskSnapshot(snapshot: DirectorySizeTaskSnapshot): DirectorySizeInfo {
  return {
    path: snapshot.path,
    bytes: snapshot.bytes,
    formatted: snapshot.formatted,
    allocated_bytes: snapshot.allocatedBytes,
    formatted_allocated: snapshot.formattedAllocated,
    file_count: snapshot.fileCount,
    skipped_count: snapshot.skippedCount,
    isApproximate: snapshot.isApproximate,
    status: snapshot.status,
    error: snapshot.error,
  };
}
