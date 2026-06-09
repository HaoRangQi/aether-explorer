import type React from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { TFunction } from 'i18next';
import {
  cancelDirectoryLoads,
  getDirectorySignature,
  listDirectory,
  listRemoteDirectory,
} from '../../api/filesystem';
import {
  directoryErrorKind as classifyDirectoryError,
  directoryErrorKindForFullDiskAccess,
  normalizeAppError,
  type AetherAppError,
} from '../../lib/app-error';
import { resolveDirectorySignatureChange, shouldPollDirectorySignature } from '../../lib/directory-signature';
import {
  FULL_DISK_ACCESS_POLL_INTERVAL_MS,
  checkFullDiskAccessPermission,
  startFullDiskAccessPolling,
} from '../../lib/full-disk-access';
import { isRemotePath, parseRemotePath } from '../../lib/path-helpers';
import type { FileItem } from '../../types';
import { formatAppError } from './explorer-utils';
import type { DirectoryErrorKind, ProtectedRootInfo } from './explorer-types';
import {
  REMOTE_DIRECTORY_TIMEOUT_MESSAGE,
  REMOTE_DIRECTORY_UI_TIMEOUT_MS,
} from './explorer-constants';

type DirectoryLoadScopes = {
  main: string;
  column: string;
};

type UseExplorerDirectoryDataInput = {
  baseView: string;
  currentPath: string;
  directoryLoadScopes: DirectoryLoadScopes;
  favorites: string[];
  fileTags: Record<string, string[]>;
  getProtectedRootForPath: (path: string) => ProtectedRootInfo | null;
  isActive: boolean;
  isLocalFilesystemPath: (path?: string | null) => boolean;
  isRemoteRoot: boolean;
  isTagRoot: boolean;
  isVirtualRoot: boolean;
  recentItems: string[];
  resolveFavoriteItems: (paths: string[]) => Promise<FileItem[]>;
  resolveTaggedItems: (tagId: string, tagMap: Record<string, string[]>) => Promise<FileItem[]>;
  setColumnPaths: React.Dispatch<React.SetStateAction<string[]>>;
  showFeedback: (message: string) => void;
  t: TFunction;
  themeShowHiddenFiles: boolean | undefined;
};

export default function useExplorerDirectoryData({
  baseView,
  currentPath,
  directoryLoadScopes,
  favorites,
  fileTags,
  getProtectedRootForPath,
  isActive,
  isLocalFilesystemPath,
  isRemoteRoot,
  isTagRoot,
  isVirtualRoot,
  recentItems,
  resolveFavoriteItems,
  resolveTaggedItems,
  setColumnPaths,
  showFeedback,
  t,
  themeShowHiddenFiles,
}: UseExplorerDirectoryDataInput) {
  const [files, setFiles] = useState<FileItem[]>([]);
  const [favoriteFiles, setFavoriteFiles] = useState<FileItem[]>([]);
  const [recentFiles, setRecentFiles] = useState<FileItem[]>([]);
  const [taggedFiles, setTaggedFiles] = useState<FileItem[]>([]);
  const [columnFilesCache, setColumnFilesCache] = useState<Record<string, FileItem[]>>({});
  const [columnLoadErrors, setColumnLoadErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [directoryErrorKind, setDirectoryErrorKind] = useState<DirectoryErrorKind | null>(null);
  const [blockedProtectedRoots, setBlockedProtectedRoots] = useState<string[]>([]);
  const pendingFullDiskAccessRetryPathRef = useRef<string | null>(null);
  const fullDiskAccessRetryInFlightRef = useRef(false);
  const autoRetryingProtectedPathRef = useRef<string | null>(null);

  const remotePathParts = parseRemotePath(currentPath);
  const currentPathRef = useRef(currentPath);
  currentPathRef.current = currentPath;
  const remotePathPartsRef = useRef(remotePathParts);
  remotePathPartsRef.current = remotePathParts;
  const loadRequestSeqRef = useRef(Date.now());
  const columnLoadGenerationRef = useRef(Date.now());
  const pendingColumnLoadsRef = useRef<Map<string, number>>(new Map());

  const protectedRoot = getProtectedRootForPath(currentPath);
  const protectedRootPath = protectedRoot?.path ?? '';
  const isProtectedPathBlocked = protectedRoot
    ? blockedProtectedRoots.includes(protectedRoot.path)
    : false;

  const classifyLocalDirectoryError = useCallback(async (
    appError: AetherAppError,
    targetPath: string,
  ): Promise<DirectoryErrorKind> => {
    const kind = classifyDirectoryError(appError);
    if (kind !== 'permission') return kind;
    const protectedFailure = Boolean(getProtectedRootForPath(appError.path || targetPath));
    if (!protectedFailure) return directoryErrorKindForFullDiskAccess(appError, null, false);
    const result = await checkFullDiskAccessPermission({ force: true });
    return directoryErrorKindForFullDiskAccess(appError, result.status, true);
  }, [getProtectedRootForPath]);

  const resetColumnState = useCallback(() => {
    columnLoadGenerationRef.current += 1;
    pendingColumnLoadsRef.current.clear();
    void cancelDirectoryLoads(directoryLoadScopes.column, columnLoadGenerationRef.current).catch(() => {});
    setColumnPaths([]);
    setColumnFilesCache({});
    setColumnLoadErrors({});
  }, [directoryLoadScopes.column, setColumnPaths]);

  const loadColumnFiles = useCallback((colPath: string) => {
    const remote = parseRemotePath(colPath);
    if (remote) {
      if (columnFilesCache[colPath]) return;
      const generation = columnLoadGenerationRef.current;
      if (pendingColumnLoadsRef.current.get(colPath) === generation) return;
      pendingColumnLoadsRef.current.set(colPath, generation);
      setColumnLoadErrors(prev => {
        if (!prev[colPath]) return prev;
        const next = { ...prev };
        delete next[colPath];
        return next;
      });
      listRemoteDirectory({
        connectionId: remote.connectionId,
        remotePath: remote.remotePath,
        showHidden: Boolean(themeShowHiddenFiles),
      }).then(entries => {
        if (generation !== columnLoadGenerationRef.current) return;
        setColumnFilesCache(prev => ({ ...prev, [colPath]: entries }));
        setColumnLoadErrors(prev => {
          if (!prev[colPath]) return prev;
          const next = { ...prev };
          delete next[colPath];
          return next;
        });
      }).catch(err => {
        if (generation !== columnLoadGenerationRef.current) return;
        setColumnLoadErrors(prev => ({ ...prev, [colPath]: normalizeAppError(err).userMessage }));
      }).finally(() => {
        if (pendingColumnLoadsRef.current.get(colPath) === generation) {
          pendingColumnLoadsRef.current.delete(colPath);
        }
      });
      return;
    }
    if (!isLocalFilesystemPath(colPath)) return;
    if (columnFilesCache[colPath]) return;
    const generation = columnLoadGenerationRef.current;
    if (pendingColumnLoadsRef.current.get(colPath) === generation) return;
    pendingColumnLoadsRef.current.set(colPath, generation);
    setColumnLoadErrors(prev => {
      if (!prev[colPath]) return prev;
      const next = { ...prev };
      delete next[colPath];
      return next;
    });
    listDirectory(colPath, themeShowHiddenFiles, {
      requestScope: directoryLoadScopes.column,
      requestId: generation,
    }).then(entries => {
      if (generation !== columnLoadGenerationRef.current) return;
      setColumnFilesCache(prev => ({ ...prev, [colPath]: entries }));
      setColumnLoadErrors(prev => {
        if (!prev[colPath]) return prev;
        const next = { ...prev };
        delete next[colPath];
        return next;
      });
    }).catch(err => {
      if (generation !== columnLoadGenerationRef.current) return;
      const appError = normalizeAppError(err);
      if (appError.kind === 'Cancelled') return;
      setColumnLoadErrors(prev => ({ ...prev, [colPath]: appError.userMessage }));
    }).finally(() => {
      if (pendingColumnLoadsRef.current.get(colPath) === generation) {
        pendingColumnLoadsRef.current.delete(colPath);
      }
    });
  }, [columnFilesCache, directoryLoadScopes.column, isLocalFilesystemPath, themeShowHiddenFiles]);

  const getColumnFiles = useCallback((parentPath: string | undefined, currentLevelFiles: FileItem[]) => {
    if (!parentPath) return currentLevelFiles;
    if (columnFilesCache[parentPath]) return columnFilesCache[parentPath];
    return [];
  }, [columnFilesCache]);

  const getDirectoryEntries = useCallback((targetPath: string) => {
    if (!targetPath) return [] as FileItem[];
    if (targetPath === currentPathRef.current && !isVirtualRoot) return files;
    return columnFilesCache[targetPath] || [];
  }, [columnFilesCache, files, isVirtualRoot]);

  const refreshCurrentDir = useCallback(async (fullRefresh = false, targetPath?: string) => {
    const refreshPath = targetPath && (isLocalFilesystemPath(targetPath) || isRemotePath(targetPath)) ? targetPath : '';
    const refreshColumnPath = Boolean(refreshPath && refreshPath !== currentPathRef.current);
    const requestId = refreshColumnPath ? 0 : ++loadRequestSeqRef.current;
    let remoteRefreshTimedOut = false;
    let remoteRefreshTimeoutId: number | undefined;
    const armRemoteRefreshTimeout = () => {
      if (!fullRefresh || refreshColumnPath || !remotePathPartsRef.current) return;
      remoteRefreshTimeoutId = window.setTimeout(() => {
        if (requestId !== loadRequestSeqRef.current) return;
        remoteRefreshTimedOut = true;
        setFiles([]);
        setLoadError(REMOTE_DIRECTORY_TIMEOUT_MESSAGE);
        setDirectoryErrorKind('generic');
        setLoading(false);
      }, REMOTE_DIRECTORY_UI_TIMEOUT_MS);
    };
    const clearRemoteRefreshTimeout = () => {
      if (remoteRefreshTimeoutId !== undefined) {
        window.clearTimeout(remoteRefreshTimeoutId);
        remoteRefreshTimeoutId = undefined;
      }
    };
    if (protectedRoot) {
      setBlockedProtectedRoots(prev => prev.filter(path => path !== protectedRoot.path));
    }
    if (fullRefresh && !refreshColumnPath) {
      setLoading(true);
      armRemoteRefreshTimeout();
    }
    try {
      if (refreshColumnPath) {
        const generation = columnLoadGenerationRef.current;
        const remote = parseRemotePath(refreshPath);
        const entries = remote
          ? await listRemoteDirectory({
            connectionId: remote.connectionId,
            remotePath: remote.remotePath,
            showHidden: Boolean(themeShowHiddenFiles),
          })
          : await listDirectory(refreshPath, themeShowHiddenFiles, {
            requestScope: directoryLoadScopes.column,
            requestId: generation,
          });
        if (generation !== columnLoadGenerationRef.current) return [] as FileItem[];
        setColumnFilesCache(prev => ({ ...prev, [refreshPath]: entries }));
        if (fullRefresh) showFeedback(t('messages.refreshed'));
        return entries;
      }

      const isFavoritesRoot = currentPathRef.current === 'aether://favorites';
      const isRecentRoot = currentPathRef.current === 'aether://recent';
      if (isFavoritesRoot) {
        const entries = await resolveFavoriteItems(favorites);
        if (requestId !== loadRequestSeqRef.current) return [] as FileItem[];
        setFavoriteFiles(entries);
        if (fullRefresh) {
          setLoading(false);
          showFeedback(t('messages.refreshed'));
        }
        return entries;
      }
      if (isRecentRoot) {
        const entries = await resolveFavoriteItems(recentItems);
        if (requestId !== loadRequestSeqRef.current) return [] as FileItem[];
        setRecentFiles(entries);
        if (fullRefresh) {
          setLoading(false);
          showFeedback(t('messages.refreshed'));
        }
        return entries;
      }
      if (isTagRoot) {
        const entries = await resolveTaggedItems(baseView, fileTags);
        if (requestId !== loadRequestSeqRef.current) return [] as FileItem[];
        setTaggedFiles(entries);
        if (fullRefresh) {
          setLoading(false);
          showFeedback(t('messages.refreshed'));
        }
        return entries;
      }
      if (remotePathPartsRef.current) {
        const remote = remotePathPartsRef.current;
        const entries = await listRemoteDirectory({
          connectionId: remote.connectionId,
          remotePath: remote.remotePath,
          showHidden: Boolean(themeShowHiddenFiles),
        });
        if (remoteRefreshTimedOut) return [] as FileItem[];
        clearRemoteRefreshTimeout();
        if (requestId !== loadRequestSeqRef.current) return [] as FileItem[];
        setFiles(entries);
        setLoadError('');
        setDirectoryErrorKind(null);
        setLoading(false);
        if (fullRefresh) {
          showFeedback(t('messages.refreshed'));
        }
        return entries;
      }
      const entries = await listDirectory(currentPathRef.current, themeShowHiddenFiles, {
        requestScope: directoryLoadScopes.main,
        requestId,
      });
      if (requestId !== loadRequestSeqRef.current) return [] as FileItem[];
      setFiles(entries);
      setLoadError('');
      setDirectoryErrorKind(null);
      if (pendingFullDiskAccessRetryPathRef.current === currentPathRef.current) {
        pendingFullDiskAccessRetryPathRef.current = null;
      }
      if (autoRetryingProtectedPathRef.current === currentPathRef.current) {
        autoRetryingProtectedPathRef.current = null;
      }
      if (fullRefresh) {
        setLoading(false);
        showFeedback(t('messages.refreshed'));
      }
      return entries;
    } catch (err) {
      if (remoteRefreshTimedOut) return [] as FileItem[];
      clearRemoteRefreshTimeout();
      if (fullRefresh && !refreshColumnPath) setLoading(false);
      const appError = normalizeAppError(err);
      if (appError.kind === 'Cancelled') return [] as FileItem[];
      const isRemoteRefresh = Boolean(refreshColumnPath ? parseRemotePath(refreshPath) : remotePathPartsRef.current);
      const kind = isRemoteRefresh
        ? classifyDirectoryError(appError)
        : await classifyLocalDirectoryError(appError, refreshColumnPath ? refreshPath : currentPathRef.current);
      if (refreshColumnPath || requestId === loadRequestSeqRef.current) {
        setLoadError(appError.userMessage);
        setDirectoryErrorKind(kind);
        if (!isRemoteRefresh && !refreshColumnPath && kind === 'permission') {
          const failedPath = currentPathRef.current;
          const failedProtectedRoot = getProtectedRootForPath(appError.path || failedPath);
          if (failedProtectedRoot) {
            setBlockedProtectedRoots(prev => (
              prev.includes(failedProtectedRoot.path) ? prev : [...prev, failedProtectedRoot.path]
            ));
            pendingFullDiskAccessRetryPathRef.current = autoRetryingProtectedPathRef.current === failedPath
              ? null
              : failedPath;
            if (autoRetryingProtectedPathRef.current === failedPath) {
              autoRetryingProtectedPathRef.current = null;
            }
          }
        } else if (pendingFullDiskAccessRetryPathRef.current === currentPathRef.current) {
          pendingFullDiskAccessRetryPathRef.current = null;
        }
        if (fullRefresh) {
          showFeedback(t('messages.refreshFailed', {
            error: appError.userMessage,
            defaultValue: '刷新失败：{{error}}',
          }));
        }
      }
      return [] as FileItem[];
    } finally {
      clearRemoteRefreshTimeout();
    }
  }, [
    baseView,
    directoryLoadScopes.column,
    directoryLoadScopes.main,
    favorites,
    fileTags,
    isLocalFilesystemPath,
    isTagRoot,
    classifyLocalDirectoryError,
    getProtectedRootForPath,
    protectedRoot,
    recentItems,
    resolveFavoriteItems,
    resolveTaggedItems,
    showFeedback,
    t,
    themeShowHiddenFiles,
  ]);

  const retryProtectedPath = useCallback(() => {
    const retryPath = currentPathRef.current;
    autoRetryingProtectedPathRef.current = null;
    pendingFullDiskAccessRetryPathRef.current = retryPath;
    const retryProtectedRoot = getProtectedRootForPath(retryPath);
    const retryPathBlocked = retryProtectedRoot
      ? blockedProtectedRoots.includes(retryProtectedRoot.path)
      : false;

    if (!retryPathBlocked) {
      void refreshCurrentDir();
      return;
    }

    void checkFullDiskAccessPermission({ force: true }).then(result => {
      if (result.status !== 'granted' || currentPathRef.current !== retryPath) return;
      pendingFullDiskAccessRetryPathRef.current = null;
      autoRetryingProtectedPathRef.current = retryPath;
      setBlockedProtectedRoots(prev => prev.filter(path => path !== retryProtectedRoot.path));
    });
  }, [blockedProtectedRoots, getProtectedRootForPath, refreshCurrentDir]);

  useEffect(() => {
    let cancelled = false;
    if (!currentPath || isVirtualRoot) return undefined;
    if (remotePathParts) {
      const requestId = ++loadRequestSeqRef.current;
      let timedOut = false;
      setLoading(true);
      setLoadError('');
      setDirectoryErrorKind(null);
      const timeoutId = window.setTimeout(() => {
        if (cancelled || requestId !== loadRequestSeqRef.current) return;
        timedOut = true;
        setFiles([]);
        setLoadError(REMOTE_DIRECTORY_TIMEOUT_MESSAGE);
        setDirectoryErrorKind('generic');
        setLoading(false);
      }, REMOTE_DIRECTORY_UI_TIMEOUT_MS);
      listRemoteDirectory({
        connectionId: remotePathParts.connectionId,
        remotePath: remotePathParts.remotePath,
        showHidden: Boolean(themeShowHiddenFiles),
      })
        .then(entries => {
          if (timedOut || cancelled || requestId !== loadRequestSeqRef.current) return;
          window.clearTimeout(timeoutId);
          setFiles(entries);
          setLoadError('');
          setDirectoryErrorKind(null);
          setLoading(false);
        })
        .catch(err => {
          if (timedOut || cancelled || requestId !== loadRequestSeqRef.current) return;
          window.clearTimeout(timeoutId);
          const appError = normalizeAppError(err);
          setFiles([]);
          setLoadError(appError.userMessage);
          setDirectoryErrorKind(classifyDirectoryError(appError));
          setLoading(false);
        })
        .finally(() => {
          window.clearTimeout(timeoutId);
          if (!cancelled && requestId === loadRequestSeqRef.current) setLoading(false);
        });
      return () => {
        cancelled = true;
        window.clearTimeout(timeoutId);
      };
    }
    if (isProtectedPathBlocked) {
      setFiles([]);
      setLoading(false);
      setDirectoryErrorKind('permission');
      setLoadError(t('dialogs.permissionRetryBlockedDetail', {
        defaultValue: 'Aether is waiting for Full Disk Access to change. Confirm the switch in System Settings, then retry.',
      }));
      return () => {
        cancelled = true;
      };
    }
    const requestId = ++loadRequestSeqRef.current;
    setLoading(true);
    setLoadError('');
    setDirectoryErrorKind(null);
    listDirectory(currentPath, themeShowHiddenFiles, {
      requestScope: directoryLoadScopes.main,
      requestId,
    })
      .then(entries => {
        if (cancelled || requestId !== loadRequestSeqRef.current) return;
        setFiles(entries);
        setLoadError('');
        setDirectoryErrorKind(null);
        if (pendingFullDiskAccessRetryPathRef.current === currentPath) {
          pendingFullDiskAccessRetryPathRef.current = null;
        }
        if (autoRetryingProtectedPathRef.current === currentPath) {
          autoRetryingProtectedPathRef.current = null;
        }
        if (protectedRoot) {
          setBlockedProtectedRoots(prev => prev.filter(path => path !== protectedRoot.path));
        }
      })
      .catch(async err => {
        if (cancelled || requestId !== loadRequestSeqRef.current) return;
        const appError = normalizeAppError(err);
        if (appError.kind === 'Cancelled') return;
        const kind = await classifyLocalDirectoryError(appError, currentPath);
        if (cancelled || requestId !== loadRequestSeqRef.current) return;
        setFiles([]);
        setLoadError(appError.userMessage);
        setDirectoryErrorKind(kind);
        if (kind === 'permission' && protectedRoot) {
          setBlockedProtectedRoots(prev => (prev.includes(protectedRoot.path) ? prev : [...prev, protectedRoot.path]));
          pendingFullDiskAccessRetryPathRef.current = autoRetryingProtectedPathRef.current === currentPath
            ? null
            : currentPath;
          if (autoRetryingProtectedPathRef.current === currentPath) {
            autoRetryingProtectedPathRef.current = null;
          }
        } else if (pendingFullDiskAccessRetryPathRef.current === currentPath) {
          pendingFullDiskAccessRetryPathRef.current = null;
        }
      })
      .finally(() => {
        if (!cancelled && requestId === loadRequestSeqRef.current) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [
    currentPath,
    directoryLoadScopes.main,
    isProtectedPathBlocked,
    isVirtualRoot,
    classifyLocalDirectoryError,
    protectedRoot,
    remotePathParts,
    t,
    themeShowHiddenFiles,
  ]);

  useEffect(() => {
    if (
      !currentPath
      || isRemoteRoot
      || isVirtualRoot
      || !protectedRootPath
      || !isProtectedPathBlocked
      || directoryErrorKind !== 'permission'
    ) {
      return undefined;
    }

    let cancelled = false;
    const retryCapturedDirectoryIfGranted = (resultStatus: string) => {
      const pendingPath = pendingFullDiskAccessRetryPathRef.current;
      if (!pendingPath || pendingPath !== currentPathRef.current) return;
      if (fullDiskAccessRetryInFlightRef.current) return;
      if (cancelled || resultStatus !== 'granted') return;
      fullDiskAccessRetryInFlightRef.current = true;
      const retryPath = currentPathRef.current;
      const retryProtectedRoot = getProtectedRootForPath(retryPath);
      if (!retryProtectedRoot) {
        fullDiskAccessRetryInFlightRef.current = false;
        return;
      }
      pendingFullDiskAccessRetryPathRef.current = null;
      autoRetryingProtectedPathRef.current = retryPath;
      setBlockedProtectedRoots(prev => prev.filter(path => path !== retryProtectedRoot.path));
      fullDiskAccessRetryInFlightRef.current = false;
    };

    const stopPolling = startFullDiskAccessPolling({
      intervalMs: FULL_DISK_ACCESS_POLL_INTERVAL_MS,
      checkOptions: { force: true },
      onResult: result => retryCapturedDirectoryIfGranted(result.status),
    });
    return () => {
      cancelled = true;
      stopPolling();
    };
  }, [
    currentPath,
    directoryErrorKind,
    isProtectedPathBlocked,
    isRemoteRoot,
    isVirtualRoot,
    getProtectedRootForPath,
    protectedRootPath,
  ]);

  useEffect(() => {
    if (currentPath !== 'aether://favorites') return;
    const requestId = ++loadRequestSeqRef.current;
    let cancelled = false;
    setLoading(true);
    setLoadError('');
    setDirectoryErrorKind(null);

    resolveFavoriteItems(favorites)
      .then(items => {
        if (cancelled || requestId !== loadRequestSeqRef.current) return;
        setFavoriteFiles(items);
      })
      .catch(err => {
        if (cancelled || requestId !== loadRequestSeqRef.current) return;
        setFavoriteFiles([]);
        setLoadError(formatAppError(err));
      })
      .finally(() => {
        if (!cancelled && requestId === loadRequestSeqRef.current) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [currentPath, favorites, resolveFavoriteItems]);

  useEffect(() => {
    if (currentPath !== 'aether://recent') return;
    const requestId = ++loadRequestSeqRef.current;
    let cancelled = false;
    setLoading(true);
    setLoadError('');
    setDirectoryErrorKind(null);

    resolveFavoriteItems(recentItems)
      .then(items => {
        if (cancelled || requestId !== loadRequestSeqRef.current) return;
        setRecentFiles(items);
      })
      .catch(err => {
        if (cancelled || requestId !== loadRequestSeqRef.current) return;
        setRecentFiles([]);
        setLoadError(formatAppError(err));
      })
      .finally(() => {
        if (!cancelled && requestId === loadRequestSeqRef.current) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [currentPath, recentItems, resolveFavoriteItems]);

  useEffect(() => {
    if (!isTagRoot) return;
    const requestId = ++loadRequestSeqRef.current;
    let cancelled = false;
    setLoading(true);
    setLoadError('');
    setDirectoryErrorKind(null);

    resolveTaggedItems(baseView, fileTags)
      .then(items => {
        if (cancelled || requestId !== loadRequestSeqRef.current) return;
        setTaggedFiles(items);
      })
      .catch(err => {
        if (cancelled || requestId !== loadRequestSeqRef.current) return;
        setTaggedFiles([]);
        setLoadError(formatAppError(err));
      })
      .finally(() => {
        if (!cancelled && requestId === loadRequestSeqRef.current) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [baseView, fileTags, isTagRoot, resolveTaggedItems]);

  useEffect(() => {
    if (isRemoteRoot || !shouldPollDirectorySignature(isActive, currentPath, isVirtualRoot)) return;
    let cancelled = false;
    let lastSignature: string | null = null;

    const checkDirectoryChange = async () => {
      try {
        const signature = await getDirectorySignature(currentPath, themeShowHiddenFiles);
        if (cancelled) return;
        const signatureChange = resolveDirectorySignatureChange(lastSignature, signature.fingerprint);
        lastSignature = signatureChange.nextFingerprint;
        if (signatureChange.shouldRefresh) {
          void refreshCurrentDir();
        }
      } catch {
        // 轮询失败不阻断目录浏览；主加载流程会负责展示权限 / 不存在等错误。
      }
    };

    void checkDirectoryChange();
    const interval = window.setInterval(checkDirectoryChange, 2500);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [currentPath, isActive, isRemoteRoot, isVirtualRoot, refreshCurrentDir, themeShowHiddenFiles]);

  return {
    columnFilesCache,
    columnLoadErrors,
    directoryErrorKind,
    favoriteFiles,
    files,
    getColumnFiles,
    getDirectoryEntries,
    isProtectedPathBlocked,
    loadColumnFiles,
    loadError,
    loading,
    recentFiles,
    refreshCurrentDir,
    resetColumnState,
    retryProtectedPath,
    setColumnFilesCache,
    setFavoriteFiles,
    setFiles,
    setRecentFiles,
    setTaggedFiles,
    taggedFiles,
  };
}
