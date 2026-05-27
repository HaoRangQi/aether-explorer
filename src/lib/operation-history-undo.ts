import {
  createFile,
  createFolder,
  deleteToTrash,
  getFileInfo,
  moveFile,
  renameFile,
} from '../api/filesystem';
import type { OperationEffect, OperationSession } from '../types';
import { normalizeAppError } from './app-error';
import { getOperationSession, updateOperationSessionUndoStatus } from './operation-history';

export interface UndoOperationSessionResult {
  status: 'undone' | 'undo_partial' | 'undo_failed';
  total: number;
  succeeded: number;
  failed: number;
  reason?: string;
}

function isEffectUndoable(effect: OperationEffect): boolean {
  return effect.status === 'ok' && Boolean(effect.reverseOp);
}

async function applyReverseEffect(effect: OperationEffect): Promise<void> {
  const reverse = effect.reverseOp!;
  switch (reverse.type) {
    case 'rename':
      await renameFile(reverse.path, reverse.newName);
      return;
    case 'move':
      await moveFile(reverse.path, reverse.targetDir);
      return;
    case 'trash':
      await deleteToTrash(reverse.path);
      return;
    case 'mkdir':
      await createFolder(reverse.parentDir, reverse.name);
      return;
    case 'create_file':
      await createFile(reverse.parentDir, reverse.name);
      return;
    case 'copy':
    case 'compress':
      throw new Error('不支持自动撤销该类型操作');
  }
}

function getParentDir(path: string): string {
  if (!path || path === '/') return '/';
  const normalized = path.endsWith('/') && path !== '/' ? path.slice(0, -1) : path;
  const splitIndex = normalized.lastIndexOf('/');
  if (splitIndex <= 0) return '/';
  return normalized.slice(0, splitIndex);
}

function getBaseName(path: string): string {
  if (!path || path === '/') return '';
  const normalized = path.endsWith('/') && path !== '/' ? path.slice(0, -1) : path;
  const splitIndex = normalized.lastIndexOf('/');
  return splitIndex >= 0 ? normalized.slice(splitIndex + 1) : normalized;
}

function joinPath(parentDir: string, name: string): string {
  const cleanName = name.replace(/^\/+/, '');
  if (!cleanName) return parentDir || '/';
  if (parentDir === '/' || !parentDir) return `/${cleanName}`;
  return `${parentDir.replace(/\/+$/, '')}/${cleanName}`;
}

async function inspectPath(path: string): Promise<{ exists: boolean; isFolder?: boolean; error?: string }> {
  try {
    const info = await getFileInfo(path);
    return {
      exists: true,
      isFolder: info.type === 'folder',
    };
  } catch (error) {
    const appError = normalizeAppError(error);
    if (appError.kind === 'NotFound') {
      return { exists: false };
    }
    return {
      exists: false,
      error: appError.userMessage,
    };
  }
}

async function validateReverseEffect(effect: OperationEffect): Promise<string | null> {
  const reverse = effect.reverseOp;
  if (!reverse) return '缺少可执行的撤销动作';

  switch (reverse.type) {
    case 'rename': {
      const source = await inspectPath(reverse.path);
      if (source.error) return `无法访问源文件：${source.error}`;
      if (!source.exists) return `源文件不存在（可能已被移动或重命名）：${reverse.path}`;

      const parentDir = getParentDir(reverse.path);
      const parent = await inspectPath(parentDir);
      if (parent.error) return `无法访问目标目录：${parent.error}`;
      if (!parent.exists || !parent.isFolder) return `目标目录不可用：${parentDir}`;

      const targetPath = joinPath(parentDir, reverse.newName);
      const target = await inspectPath(targetPath);
      if (target.error) return `无法检查目标名称：${target.error}`;
      if (target.exists) return `目标名称已存在，无法撤销重命名：${targetPath}`;
      return null;
    }
    case 'move': {
      const source = await inspectPath(reverse.path);
      if (source.error) return `无法访问源项目：${source.error}`;
      if (!source.exists) return `源项目不存在（可能已被移动或删除）：${reverse.path}`;

      const targetDir = await inspectPath(reverse.targetDir);
      if (targetDir.error) return `无法访问目标目录：${targetDir.error}`;
      if (!targetDir.exists || !targetDir.isFolder) return `目标目录不可用：${reverse.targetDir}`;

      const destination = joinPath(reverse.targetDir, getBaseName(reverse.path));
      const destinationState = await inspectPath(destination);
      if (destinationState.error) return `无法检查目标路径：${destinationState.error}`;
      if (destinationState.exists) return `目标路径已存在，无法撤销移动：${destination}`;
      return null;
    }
    case 'trash': {
      const source = await inspectPath(reverse.path);
      if (source.error) return `无法访问待撤销项目：${source.error}`;
      if (!source.exists) return `待撤销项目不存在：${reverse.path}`;
      return null;
    }
    case 'mkdir': {
      const parent = await inspectPath(reverse.parentDir);
      if (parent.error) return `无法访问目标目录：${parent.error}`;
      if (!parent.exists || !parent.isFolder) return `目标目录不可用：${reverse.parentDir}`;

      const target = await inspectPath(joinPath(reverse.parentDir, reverse.name));
      if (target.error) return `无法检查目标路径：${target.error}`;
      if (target.exists) return `目标已存在，无法撤销创建目录：${joinPath(reverse.parentDir, reverse.name)}`;
      return null;
    }
    case 'create_file': {
      const parent = await inspectPath(reverse.parentDir);
      if (parent.error) return `无法访问目标目录：${parent.error}`;
      if (!parent.exists || !parent.isFolder) return `目标目录不可用：${reverse.parentDir}`;

      const target = await inspectPath(joinPath(reverse.parentDir, reverse.name));
      if (target.error) return `无法检查目标路径：${target.error}`;
      if (target.exists) return `目标已存在，无法撤销创建文件：${joinPath(reverse.parentDir, reverse.name)}`;
      return null;
    }
    case 'copy':
    case 'compress':
      return '该操作类型不支持自动撤销';
  }
}

function summarizeUndoFailures(failures: string[], succeeded: number, failed: number): string | undefined {
  if (failed <= 0) return undefined;
  const uniqueFailures = Array.from(new Set(failures.map(item => item.trim()).filter(Boolean)));
  const preview = uniqueFailures.slice(0, 2).join('；');
  const suffix = uniqueFailures.length > 2 ? ` 等 ${uniqueFailures.length} 项原因` : '';
  if (succeeded <= 0) {
    return preview ? `撤销失败：${preview}${suffix}` : '撤销失败';
  }
  return preview
    ? `部分撤销：成功 ${succeeded} 项，失败 ${failed} 项。${preview}${suffix}`
    : `部分撤销：成功 ${succeeded} 项，失败 ${failed} 项`;
}

function resolveUndoStatus(total: number, failed: number): UndoOperationSessionResult['status'] {
  if (total === 0) return 'undo_failed';
  if (failed === 0) return 'undone';
  if (failed === total) return 'undo_failed';
  return 'undo_partial';
}

export function isSessionUndoable(session: OperationSession): boolean {
  if (!session.canUndo) return false;
  const effects = session.effects.filter(isEffectUndoable);
  return effects.length > 0;
}

export async function undoOperationSession(sessionId: string): Promise<UndoOperationSessionResult> {
  const session = await getOperationSession(sessionId);
  if (!session) {
    return {
      status: 'undo_failed',
      total: 0,
      succeeded: 0,
      failed: 0,
      reason: '未找到对应的操作记录',
    };
  }
  if (!isSessionUndoable(session)) {
    return {
      status: 'undo_failed',
      total: 0,
      succeeded: 0,
      failed: 0,
      reason: session.reasonNotUndoable || '该操作不可撤销',
    };
  }

  const reversible = session.effects.filter(isEffectUndoable).reverse();
  let failed = 0;
  const failureReasons: string[] = [];

  for (const effect of reversible) {
    try {
      const invalidReason = await validateReverseEffect(effect);
      if (invalidReason) {
        failed += 1;
        failureReasons.push(invalidReason);
        continue;
      }
      await applyReverseEffect(effect);
    } catch (error) {
      failed += 1;
      failureReasons.push(normalizeAppError(error).userMessage);
    }
  }

  const total = reversible.length;
  const succeeded = total - failed;
  const status = resolveUndoStatus(total, failed);
  const reason = summarizeUndoFailures(failureReasons, succeeded, failed);
  await updateOperationSessionUndoStatus(session.id, status, reason);
  return {
    status,
    total,
    succeeded,
    failed,
    reason,
  };
}
