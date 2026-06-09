import { useCallback, useSyncExternalStore } from 'react';
import { safeInvoke } from './tauri-runtime';

export type FullDiskAccessStatus = 'granted' | 'denied' | 'unknown';

export interface FullDiskAccessProbeResult {
  path: string;
  targetType: 'file' | 'directory';
  exists: boolean;
  readable: boolean;
  error?: string | null;
}

export interface FullDiskAccessCheckResult {
  status: FullDiskAccessStatus;
  probes: FullDiskAccessProbeResult[];
}

export interface FullDiskAccessPermissionSnapshot {
  permissionStatus: FullDiskAccessStatus | null;
  probeResults: FullDiskAccessProbeResult[];
  permissionCheckLoaded: boolean;
  permissionCheckLoading: boolean;
  permissionCheckError: string | null;
}

export interface FullDiskAccessCheckOptions {
  /**
   * Uses the registration command so macOS can list the app in Full Disk Access.
   * This is still only a TCC-gated probe; it cannot grant permission by itself.
   * Registration probes also bypass the cache so macOS sees the current app identity.
   */
  registration?: boolean;
  /**
   * Bypasses the short de-dupe cache for user-driven recovery and error
   * classification where a stale FDA status would be misleading.
   */
  force?: boolean;
}

const UNKNOWN_FULL_DISK_ACCESS_RESULT: FullDiskAccessCheckResult = {
  status: 'unknown',
  probes: [],
};
const FULL_DISK_ACCESS_CHECK_CACHE_TTL_MS = 2_500;
export const FULL_DISK_ACCESS_POLL_INTERVAL_MS = 1_000;

let snapshot: FullDiskAccessPermissionSnapshot = {
  permissionStatus: null,
  probeResults: [],
  permissionCheckLoaded: false,
  permissionCheckLoading: false,
  permissionCheckError: null,
};

let inFlightCheck: Promise<FullDiskAccessCheckResult> | null = null;
let lastCheckResult: FullDiskAccessCheckResult | null = null;
let lastCheckAt = 0;
const listeners = new Set<() => void>();
type FullDiskAccessPollingSubscriber = {
  intervalMs: number;
  checkOptions: FullDiskAccessCheckOptions;
  onResult: (result: FullDiskAccessCheckResult) => void;
};

const pollingSubscribers = new Map<number, FullDiskAccessPollingSubscriber>();
let nextPollingSubscriberId = 1;
let pollingIntervalId: number | null = null;
let pollingIntervalMs = FULL_DISK_ACCESS_POLL_INTERVAL_MS;
let pollingInFlight = false;

function emitSnapshot() {
  listeners.forEach(listener => listener());
}

function setSnapshot(next: Partial<FullDiskAccessPermissionSnapshot>) {
  snapshot = { ...snapshot, ...next };
  emitSnapshot();
}

export function getFullDiskAccessPermissionSnapshot(): FullDiskAccessPermissionSnapshot {
  return snapshot;
}

export function subscribeFullDiskAccessPermission(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export async function checkFullDiskAccessPermission(
  options: FullDiskAccessCheckOptions = {},
): Promise<FullDiskAccessCheckResult> {
  if (inFlightCheck) return inFlightCheck;
  const now = Date.now();
  const shouldBypassCache = options.force === true || options.registration === true;
  if (
    !shouldBypassCache
    && lastCheckResult
    && now - lastCheckAt < FULL_DISK_ACCESS_CHECK_CACHE_TTL_MS
  ) {
    return lastCheckResult;
  }

  setSnapshot({
    permissionCheckLoading: true,
    permissionCheckError: null,
  });

  const command = options.registration ? 'register_full_disk_access' : 'full_disk_access_status';
  inFlightCheck = safeInvoke<FullDiskAccessCheckResult>(command)
    .then(result => {
      setSnapshot({
        permissionStatus: result.status,
        probeResults: result.probes,
        permissionCheckLoaded: true,
        permissionCheckLoading: false,
        permissionCheckError: null,
      });
      lastCheckResult = result;
      lastCheckAt = Date.now();
      return result;
    })
    .catch(error => {
      const message = error instanceof Error ? error.message : String(error);
      setSnapshot({
        permissionStatus: UNKNOWN_FULL_DISK_ACCESS_RESULT.status,
        probeResults: UNKNOWN_FULL_DISK_ACCESS_RESULT.probes,
        permissionCheckLoaded: true,
        permissionCheckLoading: false,
        permissionCheckError: message,
      });
      lastCheckResult = UNKNOWN_FULL_DISK_ACCESS_RESULT;
      lastCheckAt = Date.now();
      return UNKNOWN_FULL_DISK_ACCESS_RESULT;
    })
    .finally(() => {
      inFlightCheck = null;
    });

  return inFlightCheck;
}

function resolvePollingIntervalMs(): number {
  return Math.min(
    ...Array.from(pollingSubscribers.values(), subscriber => subscriber.intervalMs),
  );
}

function resolvePollingCheckOptions(): FullDiskAccessCheckOptions {
  const subscribers = Array.from(pollingSubscribers.values());
  return {
    force: subscribers.some(subscriber => subscriber.checkOptions.force === true),
    registration: subscribers.some(subscriber => subscriber.checkOptions.registration === true),
  };
}

function stopFullDiskAccessPollingTimer() {
  if (pollingIntervalId !== null) {
    window.clearInterval(pollingIntervalId);
    pollingIntervalId = null;
  }
}

async function runFullDiskAccessPollingProbe() {
  if (pollingInFlight || pollingSubscribers.size === 0) return;
  pollingInFlight = true;
  try {
    const result = await checkFullDiskAccessPermission(resolvePollingCheckOptions());
    for (const [subscriberId, subscriber] of Array.from(pollingSubscribers.entries())) {
      if (pollingSubscribers.get(subscriberId) !== subscriber) continue;
      subscriber.onResult(result);
    }
  } finally {
    pollingInFlight = false;
  }
}

function restartFullDiskAccessPollingTimer(intervalMs: number) {
  stopFullDiskAccessPollingTimer();
  pollingIntervalMs = intervalMs;
  pollingIntervalId = window.setInterval(
    () => { void runFullDiskAccessPollingProbe(); },
    pollingIntervalMs,
  );
}

export function startFullDiskAccessPolling({
  intervalMs = FULL_DISK_ACCESS_POLL_INTERVAL_MS,
  checkOptions = { force: true },
  onResult,
}: {
  intervalMs?: number;
  checkOptions?: FullDiskAccessCheckOptions;
  onResult: (result: FullDiskAccessCheckResult) => void;
}): () => void {
  const subscriberId = nextPollingSubscriberId;
  nextPollingSubscriberId += 1;
  const normalizedIntervalMs = Number.isFinite(intervalMs) && intervalMs > 0
    ? intervalMs
    : FULL_DISK_ACCESS_POLL_INTERVAL_MS;
  const wasIdle = pollingSubscribers.size === 0;

  pollingSubscribers.set(subscriberId, {
    intervalMs: normalizedIntervalMs,
    checkOptions,
    onResult,
  });

  const nextIntervalMs = resolvePollingIntervalMs();
  if (wasIdle || pollingIntervalId === null || nextIntervalMs !== pollingIntervalMs) {
    restartFullDiskAccessPollingTimer(nextIntervalMs);
  }
  if (wasIdle) {
    void runFullDiskAccessPollingProbe();
  }

  return () => {
    pollingSubscribers.delete(subscriberId);
    if (pollingSubscribers.size === 0) {
      stopFullDiskAccessPollingTimer();
      pollingIntervalMs = FULL_DISK_ACCESS_POLL_INTERVAL_MS;
      return;
    }
    const remainingIntervalMs = resolvePollingIntervalMs();
    if (remainingIntervalMs !== pollingIntervalMs) {
      restartFullDiskAccessPollingTimer(remainingIntervalMs);
    }
  };
}

export function useFullDiskAccessPermission() {
  const state = useSyncExternalStore(
    subscribeFullDiskAccessPermission,
    getFullDiskAccessPermissionSnapshot,
    getFullDiskAccessPermissionSnapshot,
  );

  const checkPermissions = useCallback((options?: FullDiskAccessCheckOptions) =>
    checkFullDiskAccessPermission(options), []);

  return {
    ...state,
    checkPermissions,
  };
}
