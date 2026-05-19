import { load } from '@tauri-apps/plugin-store';
import type { AIOpSession } from '../types';
import type { AIFileOp } from './ai-service';

const STORE_OPTIONS = { autoSave: true };
const MAX_SESSIONS = 50;

function loadOpStore() {
  return load('ai-ops.json', STORE_OPTIONS);
}

export async function saveOpSession(session: AIOpSession): Promise<void> {
  const s = await loadOpStore();
  const existing: AIOpSession[] = (await s.get<AIOpSession[]>('sessions')) || [];
  const updated = [session, ...existing].slice(0, MAX_SESSIONS);
  await s.set('sessions', updated);
}

export async function loadOpSessions(): Promise<AIOpSession[]> {
  try {
    const s = await loadOpStore();
    return (await s.get<AIOpSession[]>('sessions')) || [];
  } catch {
    return [];
  }
}

export async function deleteOpSession(id: string): Promise<void> {
  const s = await loadOpStore();
  const existing: AIOpSession[] = (await s.get<AIOpSession[]>('sessions')) || [];
  await s.set('sessions', existing.filter(s => s.id !== id));
}

// 根据原始操作和执行结果推导反向操作
export function buildReverseOp(op: AIFileOp, resultPath?: string): { reverseOp?: AIFileOp; note?: string } {
  switch (op.type) {
    case 'rename': {
      // rename(oldPath, newName) → rename(newPath, originalName)
      const dir = op.path.split('/').slice(0, -1).join('/');
      const originalName = op.path.split('/').pop()!;
      const newPath = resultPath || `${dir}/${op.newName}`;
      return { reverseOp: { type: 'rename', path: newPath, newName: originalName } };
    }
    case 'move': {
      // move(path, targetDir) → move(targetDir/name, originalDir)
      const originalDir = op.path.split('/').slice(0, -1).join('/');
      const name = op.path.split('/').pop()!;
      const movedPath = resultPath || `${op.targetDir}/${name}`;
      return { reverseOp: { type: 'move', path: movedPath, targetDir: originalDir } };
    }
    case 'mkdir': {
      // mkdir(parentDir, name) → trash(parentDir/name)（仅当文件夹为空时安全）
      return { reverseOp: { type: 'trash', path: `${op.parentDir}/${op.name}` }, note: '回滚将把新建的空文件夹移至废纸篓' };
    }
    case 'compress': {
      // compress → trash(outputFile)（原文件未动，删压缩包即可）
      const outputPath = resultPath || op.outputName;
      return { reverseOp: { type: 'trash', path: outputPath }, note: '回滚将把压缩包移至废纸篓，原文件未受影响' };
    }
    case 'trash': {
      // 无法自动还原，需用户手动从废纸篓恢复
      return { note: '此操作无法自动回滚，请手动从废纸篓恢复' };
    }
  }
}
