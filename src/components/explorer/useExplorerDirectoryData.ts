import type React from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { TFunction } from 'i18next';
import {
  cancelDirectoryLoads,
  getDirectorySignature,
  listDirectory,
  listRemoteDirectory,
} from '../../api/filesystem';
import { directoryErrorKind as classifyDirectoryError, normalizeAppError } from '../../lib/app-error';
import { resolveDirectorySignatureChange, shouldPollDirectorySignature } from '../../lib/directory-signature';
import { isRemotePath, parseRemotePath } from '../../lib/path-helpers';
import type { FileItem } from '../../types';
import { formatAppError } from './explorer-utils';
import type { DirectoryErrorKind, ProtectedRootInfo } from './explorer-types';
import {
  PROTECTED_ROOT_APPROVALS_KEY,
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
  const [approvedProtectedRoots, setApprovedProtectedRoots] = useState<string[]>(() => {
    try {
      const parsed = JSON.parse(sessionStorage.getItem(PROTECTED_ROOT_APPROVALS_KEY) || '[]');
      return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
    } catch {
      return [];
    }
  });
  const [blockedProtectedRoots, setBlockedProtectedRoots] = useState<string[]>([]);

  const remotePathParts = parseRemotePath(currentPath);
  const currentPathRef = useRef(currentPath);
  currentPathRef.current = currentPath;
  const remotePathPartsRef = useRef(remotePathParts);
  remotePathPartsRef.current = remotePathParts;
  const loadRequestSeqRef = useRef(Date.now());
  const columnLoadGenerationRef = useRef(Date.now());
  const pendingColumnLoadsRef = useRef<Map<string, number>>(new Map());

  const protectedRoot = getProtectedRootForPath(currentPath);
  const isProtectedPathBlocked = protectedRoot
    ? blockedProtectedRoots.includes(protectedRoot.path)
    : false;
  const needsProtectedPathConsent = false;

  const approveProtectedRoot = useCallback(() => {
    if (!protectedRoot) return;
    setApprovedProtectedRoots(prev => (prev.includes(protectedRoot.path) ? prev : [...prev, protectedRoot.path]));
    setBlockedProtectedRoots(prev => prev.filter(path => path !== protectedRoot.path));
    setDirectoryErrorKind(null);
    setLoadError('');
  }, [protectedRoot]);

  useEffect(() => {
    try {
      sessionStorage.setItem(PROTECTED_ROOT_APPROVALS_KEY, JSON.stringify(approvedProtectedRoots));
    } catch {
      // sessionStorage can be unavailable in unusual WebView states; in-memory approval still works.
    }
  }, [approvedProtectedRoots]);

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
      setApprovedProtectedRoots(prev => (prev.includes(protectedRoot.path) ? prev : [...prev, protectedRoot.path]));
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
      if (refreshColumnPath || requestId === loadRequestSeqRef.current) {
        setLoadError(appError.userMessage);
        setDirectoryErrorKind(classifyDirectoryError(appError));
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
    protectedRoot,
    recentItems,
    resolveFavoriteItems,
    resolveTaggedItems,
    showFeedback,
    t,
    themeShowHiddenFiles,
  ]);

  const retryProtectedPath = useCallback(() => {
    void refreshCurrentDir();
  }, [refreshCurrentDir]);

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
      setLoadError('PermissionDenied: 当前会话中已拦截重复权限请求，请先在系统设置确认授权后重试。');
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
        if (protectedRoot) {
          setApprovedProtectedRoots(prev => (prev.includes(protectedRoot.path) ? prev : [...prev, protectedRoot.path]));
          setBlockedProtectedRoots(prev => prev.filter(path => path !== protectedRoot.path));
        }
      })
      .catch(err => {
        if (cancelled || requestId !== loadRequestSeqRef.current) return;
        const appError = normalizeAppError(err);
        if (appError.kind === 'Cancelled') return;
        setFiles([]);
        setLoadError(appError.userMessage);
        const kind = classifyDirectoryError(appError);
        setDirectoryErrorKind(kind);
        if (kind === 'permission' && protectedRoot) {
          setBlockedProtectedRoots(prev => (prev.includes(protectedRoot.path) ? prev : [...prev, protectedRoot.path]));
          setApprovedProtectedRoots(prev => prev.filter(path => path !== protectedRoot.path));
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
    protectedRoot,
    remotePathParts,
    themeShowHiddenFiles,
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
    approveProtectedRoot,
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
    needsProtectedPathConsent,
    protectedRoot,
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
