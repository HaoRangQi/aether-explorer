import { useEffect, useSyncExternalStore } from 'react';
import { isTauriRuntime, safeInvoke } from './tauri-runtime';

export interface AppIdentity {
  appName: string;
  bundleIdentifier: string;
  version: string;
  appPath: string;
}

export interface AppIdentitySnapshot {
  appIdentity: AppIdentity | null;
  appIdentityError: string | null;
  appIdentityLoaded: boolean;
  appIdentityLoading: boolean;
}

let snapshot: AppIdentitySnapshot = {
  appIdentity: null,
  appIdentityError: null,
  appIdentityLoaded: false,
  appIdentityLoading: false,
};

let inFlightAppIdentity: Promise<AppIdentity | null> | null = null;
const listeners = new Set<() => void>();

function emitSnapshot() {
  listeners.forEach(listener => listener());
}

function setSnapshot(next: Partial<AppIdentitySnapshot>) {
  snapshot = { ...snapshot, ...next };
  emitSnapshot();
}

export function getAppIdentitySnapshot(): AppIdentitySnapshot {
  return snapshot;
}

export function subscribeAppIdentity(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export async function loadAppIdentity(): Promise<AppIdentity | null> {
  if (!isTauriRuntime()) {
    setSnapshot({
      appIdentityLoaded: true,
      appIdentityLoading: false,
    });
    return null;
  }
  if (inFlightAppIdentity) return inFlightAppIdentity;
  if (snapshot.appIdentity) return snapshot.appIdentity;

  setSnapshot({
    appIdentityLoading: true,
    appIdentityError: null,
  });

  inFlightAppIdentity = safeInvoke<AppIdentity>('get_app_identity')
    .then(identity => {
      setSnapshot({
        appIdentity: identity,
        appIdentityError: null,
        appIdentityLoaded: true,
        appIdentityLoading: false,
      });
      return identity;
    })
    .catch(error => {
      const message = error instanceof Error ? error.message : String(error);
      setSnapshot({
        appIdentity: null,
        appIdentityError: message,
        appIdentityLoaded: true,
        appIdentityLoading: false,
      });
      return null;
    })
    .finally(() => {
      inFlightAppIdentity = null;
    });

  return inFlightAppIdentity;
}

export function isStableApplicationInstallPath(appPath: string): boolean {
  return appPath.startsWith('/Applications/') || appPath.startsWith('/System/Applications/');
}

export function useAppIdentity() {
  const state = useSyncExternalStore(
    subscribeAppIdentity,
    getAppIdentitySnapshot,
    getAppIdentitySnapshot,
  );

  useEffect(() => {
    void loadAppIdentity();
  }, []);

  return state;
}
