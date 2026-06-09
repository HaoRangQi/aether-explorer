import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

/**
 * Validates a release-candidate macOS app and saved Full Disk Access evidence
 * as one read-only gate. This proves consistency between artifacts; it does
 * not grant FDA, mutate TCC, sign/notarize, launch the app, or prove the human
 * clean-user procedure was honestly performed.
 */

function usage() {
  console.error('Usage: node scripts/validate-macos-permission-release-evidence.mjs --app <path-to-app.app> --evidence <fda-evidence.json> [--signature-info path] [--entitlements-plist path]');
}

function parseArgs(argv) {
  const options = {
    appPath: '',
    evidencePath: '',
    signatureInfo: '',
    entitlementsPlist: '',
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--app') {
      const value = argv[index + 1];
      if (!value) throw new Error('--app requires a path');
      options.appPath = resolve(value);
      index += 1;
      continue;
    }
    if (arg === '--evidence') {
      const value = argv[index + 1];
      if (!value) throw new Error('--evidence requires a path');
      options.evidencePath = resolve(value);
      index += 1;
      continue;
    }
    if (arg === '--signature-info') {
      const value = argv[index + 1];
      if (!value) throw new Error('--signature-info requires a path');
      options.signatureInfo = resolve(value);
      index += 1;
      continue;
    }
    if (arg === '--entitlements-plist') {
      const value = argv[index + 1];
      if (!value) throw new Error('--entitlements-plist requires a path');
      options.entitlementsPlist = resolve(value);
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  if (!options.appPath) throw new Error('missing --app <path-to-app.app>');
  if (!options.evidencePath) throw new Error('missing --evidence <fda-evidence.json>');
  return options;
}

function decodePlistString(value) {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function extractPlistString(plist, key) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`<key>${escaped}</key>\\s*<string>([\\s\\S]*?)</string>`, 'm').exec(plist);
  return match ? decodePlistString(match[1].trim()) : '';
}

function canonicalPath(filePath) {
  try {
    return realpathSync(filePath);
  } catch {
    return resolve(filePath);
  }
}

function runRequiredValidator(label, args) {
  const result = spawnSync(process.execPath, args, {
    cwd: process.cwd(),
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    console.error(`${label} failed.`);
    if (result.stdout.trim()) console.error(result.stdout.trim());
    if (result.stderr.trim()) console.error(result.stderr.trim());
    process.exit(1);
  }
}

function readAppIdentity(appPath) {
  const infoPlistPath = resolve(appPath, 'Contents/Info.plist');
  const infoPlist = readFileSync(infoPlistPath, 'utf8');
  return {
    appName: extractPlistString(infoPlist, 'CFBundleDisplayName')
      || extractPlistString(infoPlist, 'CFBundleName'),
    bundleIdentifier: extractPlistString(infoPlist, 'CFBundleIdentifier'),
    version: extractPlistString(infoPlist, 'CFBundleShortVersionString'),
    appPath: canonicalPath(appPath),
  };
}

function readEvidence(evidencePath) {
  return JSON.parse(readFileSync(evidencePath, 'utf8'));
}

function collectIdentityFailures(appIdentity, evidenceIdentity) {
  const failures = [];
  if (!evidenceIdentity || typeof evidenceIdentity !== 'object' || Array.isArray(evidenceIdentity)) {
    return ['evidence.appIdentity must be an object'];
  }
  if (evidenceIdentity.appName !== appIdentity.appName) {
    failures.push(`appIdentity.appName must match app bundle, expected ${JSON.stringify(appIdentity.appName)}, got ${JSON.stringify(evidenceIdentity.appName)}.`);
  }
  if (evidenceIdentity.bundleIdentifier !== appIdentity.bundleIdentifier) {
    failures.push(`appIdentity.bundleIdentifier must match app bundle, expected ${JSON.stringify(appIdentity.bundleIdentifier)}, got ${JSON.stringify(evidenceIdentity.bundleIdentifier)}.`);
  }
  if (evidenceIdentity.version !== appIdentity.version) {
    failures.push(`appIdentity.version must match app bundle, expected ${JSON.stringify(appIdentity.version)}, got ${JSON.stringify(evidenceIdentity.version)}.`);
  }
  if (canonicalPath(String(evidenceIdentity.appPath ?? '')) !== appIdentity.appPath) {
    failures.push(`appIdentity.appPath must resolve to the validated app bundle, expected ${JSON.stringify(appIdentity.appPath)}, got ${JSON.stringify(evidenceIdentity.appPath)}.`);
  }
  return failures;
}

let options;
try {
  options = parseArgs(process.argv.slice(2));
} catch (error) {
  usage();
  console.error(`macOS permission release evidence validation failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(2);
}

if (!existsSync(options.appPath) || !statSync(options.appPath).isDirectory()) {
  console.error(`macOS permission release evidence validation failed: app bundle does not exist: ${options.appPath}`);
  process.exit(1);
}
if (!existsSync(options.evidencePath) || !statSync(options.evidencePath).isFile()) {
  console.error(`macOS permission release evidence validation failed: evidence file does not exist: ${options.evidencePath}`);
  process.exit(1);
}

const appValidatorArgs = [
  resolve('scripts/validate-macos-app-bundle.mjs'),
  '--require-signature',
  options.appPath,
];
if (options.signatureInfo) {
  appValidatorArgs.push('--signature-info', options.signatureInfo);
}
if (options.entitlementsPlist) {
  appValidatorArgs.push('--entitlements-plist', options.entitlementsPlist);
}

runRequiredValidator('macOS app bundle validation', appValidatorArgs);
runRequiredValidator('FDA evidence validation', [
  resolve('scripts/validate-fda-evidence.mjs'),
  options.evidencePath,
]);

let appIdentity;
let evidence;
try {
  appIdentity = readAppIdentity(options.appPath);
  evidence = readEvidence(options.evidencePath);
} catch (error) {
  console.error(`macOS permission release evidence validation failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}

const failures = collectIdentityFailures(appIdentity, evidence.appIdentity);
if (failures.length > 0) {
  console.error('macOS permission release evidence validation failed:');
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log('macOS permission release evidence validation passed.');
console.log(`- app: ${appIdentity.appName} (${appIdentity.bundleIdentifier}) ${appIdentity.version}`);
console.log(`- path: ${appIdentity.appPath}`);
console.log(`- evidence: ${options.evidencePath}`);
