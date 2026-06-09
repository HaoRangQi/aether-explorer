interface AppIdentityEvidence {
  appName: string;
  bundleIdentifier: string;
  version: string;
  appPath: string;
}

type FullDiskAccessStatus = 'granted' | 'denied' | 'unknown';
type FullDiskAccessProbeTargetType = 'file' | 'directory';

interface FullDiskAccessProbeEvidence {
  path: string;
  targetType: FullDiskAccessProbeTargetType;
  exists: boolean;
  readable: boolean;
  error?: string | null;
}

interface FullDiskAccessEvidence {
  status: FullDiskAccessStatus;
  probes: FullDiskAccessProbeEvidence[];
}

type FullDiskAccessProbeContractKey = 'systemTccDb' | 'userTccDir' | 'userTccDb';

interface FullDiskAccessProbeContractMatch {
  key: FullDiskAccessProbeContractKey;
  user: string | null;
}

export interface FullDiskAccessAcceptanceEvidence {
  capturedAt: string;
  appIdentity: AppIdentityEvidence;
  fullDiskAccess: FullDiskAccessEvidence;
  runtime: {
    currentWindowLabel: string;
    userAgent: string;
    href: string;
  };
}

// Source of truth: src-tauri/src/commands/fs.rs::default_full_disk_access_probe_targets.
// Keep this exact path/type set aligned with the Rust FDA probe contract.
// Evidence is validated offline, so the username segment is intentionally pattern-matched.
function isValidMacosUserSegment(segment: string): boolean {
  return segment.length > 0 && segment !== '.' && segment !== '..';
}

function expectedFullDiskAccessProbeTargetType(path: string): 'file' | 'directory' | null {
  if (path === '/Library/Application Support/com.apple.TCC/TCC.db') {
    return 'file';
  }

  const userTccDir = /^\/Users\/([^/]+)\/Library\/Application Support\/com\.apple\.TCC$/.exec(path);
  if (userTccDir && isValidMacosUserSegment(userTccDir[1])) {
    return 'directory';
  }

  const userTccDb = /^\/Users\/([^/]+)\/Library\/Application Support\/com\.apple\.TCC\/TCC\.db$/.exec(path);
  if (userTccDb && isValidMacosUserSegment(userTccDb[1])) {
    return 'file';
  }

  return null;
}

function classifyDefaultFullDiskAccessProbe(probe: unknown): FullDiskAccessProbeContractMatch | null {
  if (!probe || typeof probe !== 'object') return null;
  const value = probe as Record<string, unknown>;
  if (typeof value.path !== 'string') return null;

  if (value.path === '/Library/Application Support/com.apple.TCC/TCC.db') {
    return value.targetType === 'file'
      ? { key: 'systemTccDb', user: null }
      : null;
  }

  const userTccDir = /^\/Users\/([^/]+)\/Library\/Application Support\/com\.apple\.TCC$/.exec(value.path);
  if (userTccDir && isValidMacosUserSegment(userTccDir[1])) {
    return value.targetType === 'directory'
      ? { key: 'userTccDir', user: userTccDir[1] }
      : null;
  }

  const userTccDb = /^\/Users\/([^/]+)\/Library\/Application Support\/com\.apple\.TCC\/TCC\.db$/.exec(value.path);
  if (userTccDb && isValidMacosUserSegment(userTccDb[1])) {
    return value.targetType === 'file'
      ? { key: 'userTccDb', user: userTccDb[1] }
      : null;
  }

  return null;
}

function hasCompleteDefaultFullDiskAccessProbeSet(probes: unknown[]): boolean {
  if (probes.length !== 3) return false;

  const counts = new Map<FullDiskAccessProbeContractKey, number>([
    ['systemTccDb', 0],
    ['userTccDir', 0],
    ['userTccDb', 0],
  ]);
  const users = new Set<string>();

  for (const probe of probes) {
    const classified = classifyDefaultFullDiskAccessProbe(probe);
    if (!classified) return false;
    counts.set(classified.key, (counts.get(classified.key) ?? 0) + 1);
    if (classified.user) users.add(classified.user);
  }

  return users.size === 1
    && Array.from(counts.values()).every(count => count === 1);
}

function hasValidFullDiskAccessProbeState(value: Record<string, unknown>): boolean {
  if (value.readable === true && value.exists !== true) return false;
  if (value.readable === true && value.error !== undefined && value.error !== null) return false;
  if (value.exists === false && value.error !== undefined && value.error !== null) return false;
  return true;
}

export function validateFullDiskAccessSmokeResult(result: { status: string; probes: unknown[] }): boolean {
  return ['granted', 'denied', 'unknown'].includes(result.status)
    && Array.isArray(result.probes)
    && result.probes.every((probe) => {
      if (!probe || typeof probe !== 'object') return false;
      const value = probe as Record<string, unknown>;
      const expectedTargetType = typeof value.path === 'string'
        ? expectedFullDiskAccessProbeTargetType(value.path)
        : null;
      return typeof value.path === 'string'
        && expectedTargetType !== null
        && (value.targetType === 'file' || value.targetType === 'directory')
        && value.targetType === expectedTargetType
        && typeof value.exists === 'boolean'
        && typeof value.readable === 'boolean'
        && (
          value.error === undefined
          || value.error === null
          || typeof value.error === 'string'
        )
        && hasValidFullDiskAccessProbeState(value);
    })
    && hasCompleteDefaultFullDiskAccessProbeSet(result.probes);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function validateAppIdentityEvidence(identity: AppIdentityEvidence): boolean {
  return isNonEmptyString(identity.appName)
    && isNonEmptyString(identity.bundleIdentifier)
    && isNonEmptyString(identity.version)
    && isNonEmptyString(identity.appPath);
}

function validateGrantedFullDiskAccessEvidence(result: FullDiskAccessEvidence): boolean {
  return result.status === 'granted'
    && result.probes.length > 0
    && result.probes.some(probe => probe.readable === true);
}

function getFullDiskAccessAcceptanceEvidenceError(
  evidence: FullDiskAccessAcceptanceEvidence,
): string | null {
  if (!Number.isFinite(Date.parse(evidence.capturedAt))) {
    return 'Full Disk Access acceptance evidence requires a valid capturedAt timestamp';
  }
  if (!validateAppIdentityEvidence(evidence.appIdentity)) {
    return 'Full Disk Access acceptance evidence requires complete app identity fields';
  }
  if (!validateFullDiskAccessSmokeResult(evidence.fullDiskAccess)) {
    return 'Full Disk Access acceptance evidence failed TCC-only validation: probes must contain the complete Rust default TCC probe path/type pairs';
  }
  if (!validateGrantedFullDiskAccessEvidence(evidence.fullDiskAccess)) {
    return 'Full Disk Access acceptance evidence requires granted access and at least one readable TCC probe';
  }
  if (!isNonEmptyString(evidence.runtime.currentWindowLabel)
    || !isNonEmptyString(evidence.runtime.userAgent)
    || !isNonEmptyString(evidence.runtime.href)
  ) {
    return 'Full Disk Access acceptance evidence requires complete runtime fields';
  }
  return null;
}

export function validateFullDiskAccessAcceptanceEvidence(
  evidence: FullDiskAccessAcceptanceEvidence,
): boolean {
  return getFullDiskAccessAcceptanceEvidenceError(evidence) === null;
}

export async function collectFullDiskAccessAcceptanceEvidence(): Promise<FullDiskAccessAcceptanceEvidence> {
  const { invoke } = await import('@tauri-apps/api/core');
  const { getCurrentWindow } = await import('@tauri-apps/api/window');
  const [appIdentity, fullDiskAccess] = await Promise.all([
    invoke<AppIdentityEvidence>('get_app_identity'),
    invoke<FullDiskAccessEvidence>('full_disk_access_status'),
  ]);

  const evidence = {
    capturedAt: new Date().toISOString(),
    appIdentity,
    fullDiskAccess,
    runtime: {
      currentWindowLabel: getCurrentWindow().label,
      userAgent: navigator.userAgent,
      href: window.location.href,
    },
  };

  const validationError = getFullDiskAccessAcceptanceEvidenceError(evidence);
  if (validationError) {
    throw new Error(validationError);
  }

  return evidence;
}
