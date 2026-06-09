import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TFunction } from 'i18next';

const safeInvokeMock = vi.hoisted(() => vi.fn());

vi.mock('../lib/tauri-runtime', () => ({
  safeInvoke: safeInvokeMock,
}));

const t = ((key: string, options?: Record<string, unknown>) => (
  `${key}:${String(options?.root ?? '')}`
)) as TFunction;

const getProtectedRootForPath = (path: string) => (
  path === '/Users/jane/Documents' || path.startsWith('/Users/jane/Documents/')
    ? { path: '/Users/jane/Documents', label: 'Documents' }
    : null
);

async function loadFormatter() {
  vi.resetModules();
  return import('../lib/operation-permission-error');
}

describe('operation permission error formatting', () => {
  beforeEach(() => {
    safeInvokeMock.mockReset();
  });

  it('shows FDA recovery copy for protected operation permission failures while FDA is missing', async () => {
    safeInvokeMock.mockResolvedValueOnce({ status: 'denied', probes: [] });
    const { formatOperationPermissionError } = await loadFormatter();

    await expect(formatOperationPermissionError({
      error: 'Operation not permitted',
      getProtectedRootForPath,
      pathHints: ['/Users/jane/Documents/report.txt'],
      t,
    })).resolves.toBe('messages.fullDiskAccessOperationRequired:Documents');
    expect(safeInvokeMock).toHaveBeenCalledWith('full_disk_access_status');
  });

  it('keeps regular permission errors generic when FDA is already granted', async () => {
    safeInvokeMock.mockResolvedValueOnce({ status: 'granted', probes: [] });
    const { formatOperationPermissionError } = await loadFormatter();

    await expect(formatOperationPermissionError({
      error: 'Operation not permitted',
      getProtectedRootForPath,
      pathHints: ['/Users/jane/Documents/report.txt'],
      t,
    })).resolves.toBe('Operation not permitted');
  });

  it('does not turn unprotected permission failures into FDA recovery', async () => {
    const { formatOperationPermissionError } = await loadFormatter();

    await expect(formatOperationPermissionError({
      error: 'Permission denied',
      getProtectedRootForPath,
      pathHints: ['/tmp/report.txt'],
      t,
    })).resolves.toBe('Permission denied');
    expect(safeInvokeMock).not.toHaveBeenCalled();
  });
});
