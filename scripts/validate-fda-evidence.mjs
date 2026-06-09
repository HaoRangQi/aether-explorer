import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function usage() {
  console.error('Usage: node scripts/validate-fda-evidence.mjs <evidence.json>');
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

// Source of truth: src-tauri/src/commands/fs.rs::default_full_disk_access_probe_targets.
// Keep this exact path/type set aligned with the Rust FDA probe contract.
// Evidence is validated offline, so the username segment is intentionally pattern-matched.
function isValidMacosUserSegment(segment) {
  return segment.length > 0 && segment !== '.' && segment !== '..';
}

function expectedFullDiskAccessProbeTargetType(path) {
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

function classifyDefaultFullDiskAccessProbe(probe) {
  if (!isRecord(probe) || !isNonEmptyString(probe.path)) {
    return null;
  }
  if (probe.path === '/Library/Application Support/com.apple.TCC/TCC.db') {
    return probe.targetType === 'file'
      ? { key: 'systemTccDb', user: null }
      : null;
  }

  const userTccDir = /^\/Users\/([^/]+)\/Library\/Application Support\/com\.apple\.TCC$/.exec(probe.path);
  if (userTccDir && isValidMacosUserSegment(userTccDir[1])) {
    return probe.targetType === 'directory'
      ? { key: 'userTccDir', user: userTccDir[1] }
      : null;
  }

  const userTccDb = /^\/Users\/([^/]+)\/Library\/Application Support\/com\.apple\.TCC\/TCC\.db$/.exec(probe.path);
  if (userTccDb && isValidMacosUserSegment(userTccDb[1])) {
    return probe.targetType === 'file'
      ? { key: 'userTccDb', user: userTccDb[1] }
      : null;
  }

  return null;
}

function validateDefaultFullDiskAccessProbeSet(probes) {
  const errors = [];
  if (!Array.isArray(probes)) return errors;

  if (probes.length !== 3) {
    errors.push(`fullDiskAccess.probes must contain exactly the three default TCC probes, got ${probes.length}`);
  }

  const counts = new Map([
    ['systemTccDb', 0],
    ['userTccDir', 0],
    ['userTccDb', 0],
  ]);
  const users = new Set();

  for (const probe of probes) {
    const classified = classifyDefaultFullDiskAccessProbe(probe);
    if (!classified) continue;
    counts.set(classified.key, (counts.get(classified.key) ?? 0) + 1);
    if (classified.user) users.add(classified.user);
  }

  for (const [key, count] of counts) {
    if (count !== 1) {
      errors.push(`fullDiskAccess.probes must include exactly one ${key} default TCC probe, got ${count}`);
    }
  }

  if (users.size > 1) {
    errors.push('fullDiskAccess.probes user TCC paths must belong to the same macOS user');
  }

  return errors;
}

function validateProbe(probe, index) {
  const errors = [];
  if (!isRecord(probe)) {
    return [`fullDiskAccess.probes[${index}] must be an object`];
  }
  const expectedTargetType = isNonEmptyString(probe.path)
    ? expectedFullDiskAccessProbeTargetType(probe.path)
    : null;
  if (!isNonEmptyString(probe.path)) {
    errors.push(`fullDiskAccess.probes[${index}].path must be a non-empty string`);
  } else if (expectedTargetType === null) {
    errors.push(`fullDiskAccess.probes[${index}].path is not a TCC-only FDA probe path: ${probe.path}`);
  }
  if (probe.targetType !== 'file' && probe.targetType !== 'directory') {
    errors.push(`fullDiskAccess.probes[${index}].targetType must be "file" or "directory"`);
  } else if (expectedTargetType && probe.targetType !== expectedTargetType) {
    errors.push(`fullDiskAccess.probes[${index}].targetType must be "${expectedTargetType}" for TCC probe path: ${probe.path}`);
  }
  if (typeof probe.exists !== 'boolean') {
    errors.push(`fullDiskAccess.probes[${index}].exists must be boolean`);
  }
  if (typeof probe.readable !== 'boolean') {
    errors.push(`fullDiskAccess.probes[${index}].readable must be boolean`);
  }
  if (probe.error !== undefined && probe.error !== null && typeof probe.error !== 'string') {
    errors.push(`fullDiskAccess.probes[${index}].error must be string, null, or omitted`);
  }
  if (probe.readable === true && probe.exists !== true) {
    errors.push(`fullDiskAccess.probes[${index}].readable cannot be true when exists is false`);
  }
  if (probe.readable === true && probe.error !== undefined && probe.error !== null) {
    errors.push(`fullDiskAccess.probes[${index}].error must be null or omitted when readable is true`);
  }
  if (probe.exists === false && probe.error !== undefined && probe.error !== null) {
    errors.push(`fullDiskAccess.probes[${index}].error must be null or omitted when exists is false`);
  }
  return errors;
}

function validateEvidence(evidence) {
  const errors = [];
  const warnings = [];

  if (!isRecord(evidence)) {
    return { errors: ['Evidence must be a JSON object'], warnings };
  }

  if (!isNonEmptyString(evidence.capturedAt) || !Number.isFinite(Date.parse(evidence.capturedAt))) {
    errors.push('capturedAt must be a valid ISO-like timestamp string');
  }

  if (!isRecord(evidence.appIdentity)) {
    errors.push('appIdentity must be an object');
  } else {
    for (const key of ['appName', 'bundleIdentifier', 'version', 'appPath']) {
      if (!isNonEmptyString(evidence.appIdentity[key])) {
        errors.push(`appIdentity.${key} must be a non-empty string`);
      }
    }
    if (
      isNonEmptyString(evidence.appIdentity.appPath)
      && !evidence.appIdentity.appPath.endsWith('.app')
    ) {
      warnings.push(`appIdentity.appPath is not an .app bundle path: ${evidence.appIdentity.appPath}. This can be normal for dev builds; release acceptance should use the .app bundle.`);
    }
  }

  if (!isRecord(evidence.fullDiskAccess)) {
    errors.push('fullDiskAccess must be an object');
  } else {
    if (evidence.fullDiskAccess.status !== 'granted') {
      errors.push(`fullDiskAccess.status must be "granted" for release acceptance evidence, got ${JSON.stringify(evidence.fullDiskAccess.status)}`);
    }
    if (!Array.isArray(evidence.fullDiskAccess.probes)) {
      errors.push('fullDiskAccess.probes must be an array');
    } else {
      if (evidence.fullDiskAccess.probes.length === 0) {
        errors.push('fullDiskAccess.probes must include at least one TCC probe');
      }
      evidence.fullDiskAccess.probes.forEach((probe, index) => {
        errors.push(...validateProbe(probe, index));
      });
      errors.push(...validateDefaultFullDiskAccessProbeSet(evidence.fullDiskAccess.probes));
      if (!evidence.fullDiskAccess.probes.some((probe) => isRecord(probe) && probe.readable === true)) {
        errors.push('fullDiskAccess.probes must include at least one readable probe when status is granted');
      }
    }
  }

  if (!isRecord(evidence.runtime)) {
    errors.push('runtime must be an object');
  } else {
    for (const key of ['currentWindowLabel', 'userAgent', 'href']) {
      if (!isNonEmptyString(evidence.runtime[key])) {
        errors.push(`runtime.${key} must be a non-empty string`);
      }
    }
  }

  return { errors, warnings };
}

const input = process.argv[2];
if (!input) {
  usage();
  process.exit(2);
}

let evidence;
const filePath = resolve(process.cwd(), input);
try {
  evidence = JSON.parse(readFileSync(filePath, 'utf8'));
} catch (error) {
  console.error(`FDA evidence validation failed: could not read JSON from ${filePath}`);
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

const { errors, warnings } = validateEvidence(evidence);
if (errors.length > 0) {
  console.error(`FDA evidence validation failed: ${filePath}`);
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exit(1);
}

for (const warning of warnings) {
  console.warn(`Warning: ${warning}`);
}

console.log(`FDA evidence validation passed: ${filePath}`);
console.log(`- app: ${evidence.appIdentity.appName} (${evidence.appIdentity.bundleIdentifier}) ${evidence.appIdentity.version}`);
console.log(`- path: ${evidence.appIdentity.appPath}`);
console.log(`- capturedAt: ${evidence.capturedAt}`);
console.log(`- probes: ${evidence.fullDiskAccess.probes.length}`);
