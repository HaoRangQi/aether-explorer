import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import useExplorerDirectoryData from '../components/explorer/useExplorerDirectoryData';
import type { FileItem } from '../types';

const listDirectoryMock = vi.hoisted(() => vi.fn());
const checkFullDiskAccessPermissionMock = vi.hoisted(() => vi.fn());

vi.mock('../api/filesystem', () => ({
  cancelDirectoryLoads: vi.fn().mockResolvedValue(undefined),
  getDirectorySignature: vi.fn(),
  listDirectory: listDirectoryMock,
  listRemoteDirectory: vi.fn(),
}));

vi.mock('../lib/full-disk-access', () => ({
  FULL_DISK_ACCESS_POLL_INTERVAL_MS: 1000,
  checkFullDiskAccessPermission: checkFullDiskAccessPermissionMock,
  startFullDiskAccessPolling: ({ onResult }: {
    onResult: (result: { status: string; probes: unknown[] }) => void;
  }) => {
    void checkFullDiskAccessPermissionMock({ force: true }).then(onResult);
    return vi.fn();
  },
}));

const protectedPath = '/Users/jane/Documents';
const protectedRootInfo = { path: protectedPath, label: 'Documents' };
const emptyList: string[] = [];
const emptyTags: Record<string, string[]> = {};
const entry: FileItem = {
  id: 'report',
  name: 'report.txt',
  modified: '2026-06-09',
  path: `${protectedPath}/report.txt`,
  type: 'text',
};

const t = ((key: string, options?: Record<string, unknown>) => (
  String(options?.defaultValue ?? key)
)) as Parameters<typeof useExplorerDirectoryData>[0]['t'];

async function flushEffects(times = 1) {
  for (let index = 0; index < times; index += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

describe('Explorer FDA recovery auto retry', () => {
  let root: Root;
  let container: HTMLDivElement;
  let latest: ReturnType<typeof useExplorerDirectoryData> | null;

  beforeEach(() => {
    vi.restoreAllMocks();
    listDirectoryMock.mockReset();
    checkFullDiskAccessPermissionMock.mockReset();
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    latest = null;
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it('automatically retries the captured protected directory once after FDA becomes granted', async () => {
    let listAttempts = 0;
    listDirectoryMock.mockImplementation(() => {
      listAttempts += 1;
      return listAttempts === 1
        ? Promise.reject({
          kind: 'PermissionDenied',
          message: 'permission denied',
          path: protectedPath,
        })
        : Promise.resolve([entry]);
    });
    checkFullDiskAccessPermissionMock
      .mockResolvedValueOnce({ status: 'denied', probes: [] })
      .mockResolvedValueOnce({ status: 'granted', probes: [] });

    const resolveFavoriteItems = vi.fn().mockResolvedValue([]);
    const resolveTaggedItems = vi.fn().mockResolvedValue([]);
    const setColumnPaths = vi.fn();
    const showFeedback = vi.fn();
    const getProtectedRootForPath = (path: string) => (
      path === protectedPath || path.startsWith(`${protectedPath}/`)
        ? protectedRootInfo
        : null
    );
    const isLocalFilesystemPath = (path?: string | null) => Boolean(path?.startsWith('/'));

    function Harness() {
      latest = useExplorerDirectoryData({
        baseView: 'main',
        currentPath: protectedPath,
        directoryLoadScopes: {
          column: 'test:column',
          main: 'test:main',
        },
        favorites: emptyList,
        fileTags: emptyTags,
        getProtectedRootForPath,
        isActive: false,
        isLocalFilesystemPath,
        isRemoteRoot: false,
        isTagRoot: false,
        isVirtualRoot: false,
        recentItems: emptyList,
        resolveFavoriteItems,
        resolveTaggedItems,
        setColumnPaths,
        showFeedback,
        t,
        themeShowHiddenFiles: false,
      });
      return <div>{latest.files.length}</div>;
    }

    await act(async () => {
      root.render(<Harness />);
    });
    // Settle mount load, FDA classification, recovery polling, unblock, and final reload.
    await flushEffects(8);

    expect(checkFullDiskAccessPermissionMock).toHaveBeenNthCalledWith(1, { force: true });
    expect(checkFullDiskAccessPermissionMock).toHaveBeenNthCalledWith(2, { force: true });
    expect(listDirectoryMock).toHaveBeenCalledTimes(2);
    expect(latest?.files).toEqual([entry]);
    expect(latest?.loadError).toBe('');
    expect(latest?.isProtectedPathBlocked).toBe(false);
  });

  it('does not keep reopening FDA recovery if the automatic retry still fails', async () => {
    let listAttempts = 0;
    listDirectoryMock.mockImplementation(() => {
      listAttempts += 1;
      return Promise.reject({
        kind: 'PermissionDenied',
        message: 'permission denied',
        path: protectedPath,
      });
    });
    checkFullDiskAccessPermissionMock
      .mockResolvedValueOnce({ status: 'denied', probes: [] })
      .mockResolvedValue({ status: 'granted', probes: [] });

    const resolveFavoriteItems = vi.fn().mockResolvedValue([]);
    const resolveTaggedItems = vi.fn().mockResolvedValue([]);
    const setColumnPaths = vi.fn();
    const showFeedback = vi.fn();
    const getProtectedRootForPath = (path: string) => (
      path === protectedPath || path.startsWith(`${protectedPath}/`)
        ? protectedRootInfo
        : null
    );
    const isLocalFilesystemPath = (path?: string | null) => Boolean(path?.startsWith('/'));

    function Harness() {
      latest = useExplorerDirectoryData({
        baseView: 'main',
        currentPath: protectedPath,
        directoryLoadScopes: {
          column: 'test:column',
          main: 'test:main',
        },
        favorites: emptyList,
        fileTags: emptyTags,
        getProtectedRootForPath,
        isActive: false,
        isLocalFilesystemPath,
        isRemoteRoot: false,
        isTagRoot: false,
        isVirtualRoot: false,
        recentItems: emptyList,
        resolveFavoriteItems,
        resolveTaggedItems,
        setColumnPaths,
        showFeedback,
        t,
        themeShowHiddenFiles: false,
      });
      return <div>{latest.files.length}</div>;
    }

    await act(async () => {
      root.render(<Harness />);
    });
    // Settle mount load, FDA classification, recovery polling, unblock, and failed reload.
    await flushEffects(8);

    expect(listDirectoryMock).toHaveBeenCalledTimes(2);
    await flushEffects(4);
    expect(listDirectoryMock).toHaveBeenCalledTimes(2);
    expect(latest?.files).toEqual([]);
    expect(latest?.directoryErrorKind).toBe('generic');
    expect(latest?.isProtectedPathBlocked).toBe(false);
  });

  it('checks FDA before manual retry and does not relist while still denied', async () => {
    listDirectoryMock.mockRejectedValue({
      kind: 'PermissionDenied',
      message: 'permission denied',
      path: protectedPath,
    });
    checkFullDiskAccessPermissionMock.mockResolvedValue({ status: 'denied', probes: [] });

    const resolveFavoriteItems = vi.fn().mockResolvedValue([]);
    const resolveTaggedItems = vi.fn().mockResolvedValue([]);
    const setColumnPaths = vi.fn();
    const showFeedback = vi.fn();
    const getProtectedRootForPath = (path: string) => (
      path === protectedPath || path.startsWith(`${protectedPath}/`)
        ? protectedRootInfo
        : null
    );
    const isLocalFilesystemPath = (path?: string | null) => Boolean(path?.startsWith('/'));

    function Harness() {
      latest = useExplorerDirectoryData({
        baseView: 'main',
        currentPath: protectedPath,
        directoryLoadScopes: {
          column: 'test:column',
          main: 'test:main',
        },
        favorites: emptyList,
        fileTags: emptyTags,
        getProtectedRootForPath,
        isActive: false,
        isLocalFilesystemPath,
        isRemoteRoot: false,
        isTagRoot: false,
        isVirtualRoot: false,
        recentItems: emptyList,
        resolveFavoriteItems,
        resolveTaggedItems,
        setColumnPaths,
        showFeedback,
        t,
        themeShowHiddenFiles: false,
      });
      return <div>{latest.files.length}</div>;
    }

    await act(async () => {
      root.render(<Harness />);
    });
    // Settle initial load failure, FDA classification, and recovery polling.
    await flushEffects(8);

    expect(listDirectoryMock).toHaveBeenCalledTimes(1);
    expect(latest?.isProtectedPathBlocked).toBe(true);

    await act(async () => {
      latest?.retryProtectedPath();
      await Promise.resolve();
    });
    await flushEffects(4);

    expect(checkFullDiskAccessPermissionMock).toHaveBeenCalled();
    expect(listDirectoryMock).toHaveBeenCalledTimes(1);
    expect(latest?.isProtectedPathBlocked).toBe(true);
  });
});
