import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FullDiskAccessCheckResult } from '../lib/full-disk-access';

const safeInvokeMock = vi.hoisted(() => vi.fn());

vi.mock('../lib/tauri-runtime', () => ({
  safeInvoke: safeInvokeMock,
}));

const grantedResult: FullDiskAccessCheckResult = {
  status: 'granted',
  probes: [{
    path: '/Library/Application Support/com.apple.TCC/TCC.db',
    targetType: 'file',
    exists: true,
    readable: true,
  }],
};

const deniedResult: FullDiskAccessCheckResult = {
  status: 'denied',
  probes: [{
    path: '/Users/jane/Library/Application Support/com.apple.TCC',
    targetType: 'directory',
    exists: true,
    readable: false,
    error: 'permission denied',
  }],
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function loadCoordinator() {
  vi.resetModules();
  return import('../lib/full-disk-access');
}

describe('Full Disk Access coordinator', () => {
  beforeEach(() => {
    safeInvokeMock.mockReset();
    vi.restoreAllMocks();
    vi.useRealTimers();
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('single-flights concurrent permission checks', async () => {
    const pending = deferred<FullDiskAccessCheckResult>();
    safeInvokeMock.mockReturnValueOnce(pending.promise);
    const { checkFullDiskAccessPermission } = await loadCoordinator();

    const first = checkFullDiskAccessPermission();
    const second = checkFullDiskAccessPermission();

    expect(safeInvokeMock).toHaveBeenCalledTimes(1);
    expect(safeInvokeMock).toHaveBeenCalledWith('full_disk_access_status');

    pending.resolve(grantedResult);

    await expect(first).resolves.toEqual(grantedResult);
    await expect(second).resolves.toEqual(grantedResult);
  });

  it('uses a one second default polling interval for visible recovery surfaces', async () => {
    const { FULL_DISK_ACCESS_POLL_INTERVAL_MS } = await loadCoordinator();

    expect(FULL_DISK_ACCESS_POLL_INTERVAL_MS).toBe(1_000);
  });

  it('caches non-registration checks for the short polling window', async () => {
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(1_000);
    safeInvokeMock.mockResolvedValueOnce(grantedResult);
    const { checkFullDiskAccessPermission } = await loadCoordinator();

    await expect(checkFullDiskAccessPermission()).resolves.toEqual(grantedResult);
    expect(safeInvokeMock).toHaveBeenCalledTimes(1);

    nowSpy.mockReturnValue(2_000);
    await expect(checkFullDiskAccessPermission()).resolves.toEqual(grantedResult);
    expect(safeInvokeMock).toHaveBeenCalledTimes(1);

    nowSpy.mockReturnValue(4_000);
    safeInvokeMock.mockResolvedValueOnce(deniedResult);
    await expect(checkFullDiskAccessPermission()).resolves.toEqual(deniedResult);
    expect(safeInvokeMock).toHaveBeenCalledTimes(2);
  });

  it('lets registration checks bypass the non-registration cache', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_000);
    safeInvokeMock.mockResolvedValueOnce(grantedResult);
    const { checkFullDiskAccessPermission } = await loadCoordinator();
    await checkFullDiskAccessPermission();

    safeInvokeMock.mockResolvedValueOnce(deniedResult);
    await expect(checkFullDiskAccessPermission({ registration: true })).resolves.toEqual(deniedResult);

    expect(safeInvokeMock).toHaveBeenCalledTimes(2);
    expect(safeInvokeMock).toHaveBeenNthCalledWith(2, 'register_full_disk_access');
  });

  it('lets forced checks bypass the short cache without changing the command', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_000);
    safeInvokeMock.mockResolvedValueOnce(grantedResult);
    const { checkFullDiskAccessPermission } = await loadCoordinator();
    await checkFullDiskAccessPermission();

    safeInvokeMock.mockResolvedValueOnce(deniedResult);
    await expect(checkFullDiskAccessPermission({ force: true })).resolves.toEqual(deniedResult);

    expect(safeInvokeMock).toHaveBeenCalledTimes(2);
    expect(safeInvokeMock).toHaveBeenNthCalledWith(2, 'full_disk_access_status');
  });

  it('allows forced registration checks to bypass cache and use the registration command', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_000);
    safeInvokeMock.mockResolvedValueOnce(grantedResult);
    const { checkFullDiskAccessPermission } = await loadCoordinator();
    await checkFullDiskAccessPermission();

    safeInvokeMock.mockResolvedValueOnce(deniedResult);
    await expect(checkFullDiskAccessPermission({ force: true, registration: true })).resolves.toEqual(deniedResult);

    expect(safeInvokeMock).toHaveBeenCalledTimes(2);
    expect(safeInvokeMock).toHaveBeenNthCalledWith(2, 'register_full_disk_access');
  });

  it('single-flights forced and default checks while a probe is in flight', async () => {
    const pending = deferred<FullDiskAccessCheckResult>();
    safeInvokeMock.mockReturnValueOnce(pending.promise);
    const { checkFullDiskAccessPermission } = await loadCoordinator();

    const forced = checkFullDiskAccessPermission({ force: true });
    const defaultCheck = checkFullDiskAccessPermission();

    expect(safeInvokeMock).toHaveBeenCalledTimes(1);
    expect(safeInvokeMock).toHaveBeenCalledWith('full_disk_access_status');

    pending.resolve(grantedResult);

    await expect(forced).resolves.toEqual(grantedResult);
    await expect(defaultCheck).resolves.toEqual(grantedResult);
  });

  it('records unknown snapshot state when the backend check fails', async () => {
    safeInvokeMock.mockRejectedValueOnce(new Error('backend unavailable'));
    const {
      checkFullDiskAccessPermission,
      getFullDiskAccessPermissionSnapshot,
    } = await loadCoordinator();

    await expect(checkFullDiskAccessPermission()).resolves.toEqual({
      status: 'unknown',
      probes: [],
    });

    expect(getFullDiskAccessPermissionSnapshot()).toMatchObject({
      permissionStatus: 'unknown',
      probeResults: [],
      permissionCheckLoaded: true,
      permissionCheckLoading: false,
      permissionCheckError: 'backend unavailable',
    });
  });

  it('notifies subscribers and stops after unsubscribe', async () => {
    safeInvokeMock.mockResolvedValueOnce(grantedResult);
    const {
      checkFullDiskAccessPermission,
      subscribeFullDiskAccessPermission,
    } = await loadCoordinator();
    const listener = vi.fn();

    const unsubscribe = subscribeFullDiskAccessPermission(listener);
    await checkFullDiskAccessPermission();

    expect(listener).toHaveBeenCalled();

    listener.mockClear();
    unsubscribe();
    safeInvokeMock.mockResolvedValueOnce(deniedResult);
    await checkFullDiskAccessPermission({ registration: true });

    expect(listener).not.toHaveBeenCalled();
  });

  it('shares one polling timer across active subscribers', async () => {
    vi.useFakeTimers();
    safeInvokeMock.mockResolvedValue(grantedResult);
    const { startFullDiskAccessPolling } = await loadCoordinator();
    const firstSubscriber = vi.fn();
    const secondSubscriber = vi.fn();

    const stopFirst = startFullDiskAccessPolling({
      intervalMs: 1_000,
      checkOptions: { force: true },
      onResult: firstSubscriber,
    });

    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(0);

    expect(safeInvokeMock).toHaveBeenCalledTimes(1);
    expect(firstSubscriber).toHaveBeenCalledWith(grantedResult);

    const stopSecond = startFullDiskAccessPolling({
      intervalMs: 500,
      checkOptions: { force: true },
      onResult: secondSubscriber,
    });

    await vi.advanceTimersByTimeAsync(500);

    expect(safeInvokeMock).toHaveBeenCalledTimes(2);
    expect(firstSubscriber).toHaveBeenCalledTimes(2);
    expect(secondSubscriber).toHaveBeenCalledTimes(1);

    stopFirst();
    await vi.advanceTimersByTimeAsync(500);

    expect(safeInvokeMock).toHaveBeenCalledTimes(3);
    expect(firstSubscriber).toHaveBeenCalledTimes(2);
    expect(secondSubscriber).toHaveBeenCalledTimes(2);

    stopSecond();
    await vi.advanceTimersByTimeAsync(1_000);

    expect(safeInvokeMock).toHaveBeenCalledTimes(3);
  });

  it('updates hook consumers and keeps the check callback stable', async () => {
    safeInvokeMock.mockResolvedValueOnce(grantedResult);
    const coordinator = await loadCoordinator();
    const statuses: Array<string | null> = [];
    const checkCallbacks: unknown[] = [];
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root: Root = createRoot(container);

    function Probe() {
      const state = coordinator.useFullDiskAccessPermission();
      statuses.push(state.permissionStatus);
      checkCallbacks.push(state.checkPermissions);
      return React.createElement('div', null, state.permissionStatus);
    }

    try {
      act(() => {
        root.render(React.createElement(Probe));
      });

      await act(async () => {
        await coordinator.checkFullDiskAccessPermission();
      });

      expect(statuses).toContain('granted');
      expect(checkCallbacks.length).toBeGreaterThan(1);
      expect(checkCallbacks.every(callback => callback === checkCallbacks[0])).toBe(true);
    } finally {
      act(() => {
        root.unmount();
      });
      container.remove();
    }
  });
});
