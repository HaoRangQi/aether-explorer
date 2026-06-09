import { describe, expect, it } from 'vitest';
import {
  AetherAppError,
  directoryErrorKind,
  directoryErrorKindForFullDiskAccess,
  normalizeAppError,
} from '../lib/app-error';

describe('normalizeAppError', () => {
  it('keeps already-normalized errors', () => {
    const original = new AetherAppError({
      kind: 'PermissionDenied',
      message: '权限不足',
      path: '/Users/jane/Documents',
    });

    expect(normalizeAppError(original)).toBe(original);
  });

  it('normalizes structured payloads from future Rust commands', () => {
    const error = normalizeAppError({
      kind: 'NotFound',
      message: '目录不存在',
      path: '/missing',
      detail: { command: 'list_directory' },
    });

    expect(error.kind).toBe('NotFound');
    expect(error.path).toBe('/missing');
    expect(error.userMessage).toBe('目录不存在：/missing');
    expect(error.detail.command).toBe('list_directory');
  });

  it('uses fallback messages for structured payloads without message text', () => {
    const error = normalizeAppError({
      kind: 'InvalidPath',
      path: '/bad',
    });

    expect(error.kind).toBe('InvalidPath');
    expect(error.userMessage).toBe('路径或文件名无效：/bad');
  });

  it('uses message text from structured payloads with unknown kinds', () => {
    const error = normalizeAppError({
      kind: 'FutureKind',
      message: 'No space left on device',
      path: '/Volumes/USB',
      detail: { command: 'copy_files' },
    });

    expect(error.kind).toBe('DiskFull');
    expect(error.userMessage).toBe('No space left on device：/Volumes/USB');
    expect(error.detail.command).toBe('copy_files');
  });

  it('classifies legacy Rust string errors', () => {
    const permissionError = normalizeAppError('PermissionDenied: 无法读取目录 /Users/jane/Documents');
    expect(permissionError.kind).toBe('PermissionDenied');
    expect(permissionError.userMessage).toBe('无法读取目录 /Users/jane/Documents');
    expect(normalizeAppError('NotFound: 目录不存在 /tmp/missing').kind).toBe('NotFound');
    expect(normalizeAppError('No space left on device').kind).toBe('DiskFull');
    expect(normalizeAppError('resource busy').kind).toBe('Busy');
    expect(normalizeAppError('路径解析失败 /bad/path').kind).toBe('InvalidPath');
    expect(normalizeAppError('解压目标已存在，已停止以避免覆盖').kind).toBe('Conflict');
    expect(normalizeAppError('外置卷无法移至废纸篓，操作已取消').kind).toBe('TrashUnsupported');
    expect(normalizeAppError('Cancelled: 用户取消操作').kind).toBe('Cancelled');
  });

  it('normalizes TrashUnsupported structured payloads', () => {
    const error = normalizeAppError({
      kind: 'TrashUnsupported',
      message: '该外置卷无法移至废纸篓，操作已取消',
      path: '/Volumes/USB/a.txt',
    });

    expect(error.kind).toBe('TrashUnsupported');
    expect(error.path).toBe('/Volumes/USB/a.txt');
    expect(error.userMessage).toBe('该外置卷无法移至废纸篓，操作已取消：/Volumes/USB/a.txt');
  });

  it('falls back to Internal for unknown errors', () => {
    const error = normalizeAppError(new Error('unexpected'));
    expect(error.kind).toBe('Internal');
    expect(error.userMessage).toBe('unexpected');
  });
});

describe('directoryErrorKind', () => {
  it('maps app errors to explorer directory states', () => {
    expect(directoryErrorKind(new AetherAppError({ kind: 'PermissionDenied', message: '权限不足' }))).toBe('permission');
    expect(directoryErrorKind(new AetherAppError({ kind: 'NotFound', message: '不存在' }))).toBe('notFound');
    expect(directoryErrorKind(new AetherAppError({ kind: 'Internal', message: '失败' }))).toBe('generic');
  });

  it('only treats permission errors as FDA recovery when FDA is not granted', () => {
    const permissionError = new AetherAppError({ kind: 'PermissionDenied', message: '权限不足' });

    expect(directoryErrorKindForFullDiskAccess(permissionError, 'denied')).toBe('permission');
    expect(directoryErrorKindForFullDiskAccess(permissionError, 'unknown')).toBe('permission');
    expect(directoryErrorKindForFullDiskAccess(permissionError, null)).toBe('permission');
    expect(directoryErrorKindForFullDiskAccess(permissionError, 'granted')).toBe('generic');
    expect(directoryErrorKindForFullDiskAccess(permissionError, 'denied', false)).toBe('generic');
    expect(directoryErrorKindForFullDiskAccess(new AetherAppError({ kind: 'NotFound', message: '不存在' }), 'granted')).toBe('notFound');
  });
});
