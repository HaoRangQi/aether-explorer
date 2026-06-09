import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

/**
 * Validates a packaged `.app` before clean-user Full Disk Access testing.
 *
 * This checks app-bundle metadata only. It does not prove FDA is granted,
 * mutate TCC, sign/notarize the app, or replace clean-user acceptance.
 */

const expected = {
  appName: 'Aether Explorer',
  bundleIdentifier: 'com.aether.explorer',
};

function usage() {
  console.error('Usage: node scripts/validate-macos-app-bundle.mjs [--require-signature] <path-to-app.app> [--signature-info path] [--entitlements-plist path]');
}

function parseArgs(argv) {
  const options = {
    appPath: '',
    entitlementsPlist: '',
    requireSignature: false,
    signatureInfo: '',
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--require-signature') {
      options.requireSignature = true;
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
    if (!options.appPath) {
      options.appPath = resolve(arg);
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  if (!options.appPath) {
    throw new Error('missing <path-to-app.app>');
  }
  return options;
}

function readText(filePath, label) {
  if (!existsSync(filePath)) {
    throw new Error(`Missing ${label}: ${filePath}`);
  }
  return readFileSync(filePath, 'utf8');
}

function extractPlistKeys(plist) {
  return Array.from(plist.matchAll(/<key>([^<]+)<\/key>/g), match => match[1]);
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

function hasPlistBooleanFalseAfterKey(plist, key) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`<key>${escaped}</key>\\s*<false\\s*/>`, 'm').test(plist);
}

function hasPlistBooleanTrueAfterKey(plist, key) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`<key>${escaped}</key>\\s*<true\\s*/>`, 'm').test(plist);
}

function getPlistValueKindAfterKey(plist, key) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`<key>${escaped}</key>\\s*<(true|false|string|integer|array|dict)\\b`, 'm').exec(plist);
  return match?.[1] ?? '';
}

function collectPlistShapeFailures(plist, label) {
  if (
    !plist.includes('<plist')
    || !plist.includes('</plist>')
    || !plist.includes('<dict>')
    || !plist.includes('</dict>')
  ) {
    return [`${label} must be a well-formed XML plist with a dict root.`];
  }
  return [];
}

function isSignedAppBundle(appPath) {
  return existsSync(resolve(appPath, 'Contents/_CodeSignature'));
}

function readSigningInfo(options, failures) {
  if (options.signatureInfo) {
    return readText(options.signatureInfo, 'code signing info');
  }

  const result = spawnSync('/usr/bin/codesign', ['-dv', options.appPath], {
    encoding: 'utf8',
  });
  if (result.error || result.status !== 0) {
    const detail = result.error?.message || result.stderr.trim() || `codesign exited with status ${result.status}`;
    failures.push(`Could not inspect code signing identity for release-candidate app bundle: ${detail}`);
    return '';
  }
  return `${result.stdout}\n${result.stderr}`.trim();
}

function extractSigningInfoField(signingInfo, field) {
  const escaped = field.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`^${escaped}=(.*)$`, 'm').exec(signingInfo);
  return match ? match[1].trim() : '';
}

function collectSigningIdentityFailures(signingInfo) {
  const failures = [];
  if (!signingInfo.trim()) {
    return ['Release-candidate validation requires inspectable code signing identity.'];
  }

  const signature = extractSigningInfoField(signingInfo, 'Signature');
  const flags = extractSigningInfoField(signingInfo, 'CodeDirectory');
  const teamIdentifier = extractSigningInfoField(signingInfo, 'TeamIdentifier');
  const signingIdentifier = extractSigningInfoField(signingInfo, 'Identifier');

  if (signature.toLowerCase() === 'adhoc' || /\bflags=0x[0-9a-f]+\([^)]*\badhoc\b/i.test(flags)) {
    failures.push('Release-candidate validation requires a stable Apple signing identity; ad-hoc signatures are not valid Full Disk Access release evidence.');
  }
  if (!teamIdentifier || teamIdentifier.trim().length === 0 || teamIdentifier === 'not set') {
    failures.push('Release-candidate validation requires a stable TeamIdentifier for Full Disk Access persistence.');
  }
  if (signingIdentifier !== expected.bundleIdentifier) {
    failures.push(`Code signature Identifier must be ${expected.bundleIdentifier} for Full Disk Access persistence across updates, got ${JSON.stringify(signingIdentifier)}.`);
  }
  return failures;
}

function readEntitlements(options, warnings, failures) {
  if (options.requireSignature && !isSignedAppBundle(options.appPath)) {
    failures.push('Release-candidate validation requires a signed app bundle with Contents/_CodeSignature.');
    return '';
  }

  if (options.entitlementsPlist) {
    return readText(options.entitlementsPlist, 'entitlements plist');
  }

  const result = spawnSync('/usr/bin/codesign', ['-d', '--entitlements', ':-', options.appPath], {
    encoding: 'utf8',
  });
  if (result.error || result.status !== 0) {
    const detail = result.error?.message || result.stderr.trim() || `codesign exited with status ${result.status}`;
    if (isSignedAppBundle(options.appPath)) {
      failures.push(`Could not inspect code signature entitlements for signed app bundle: ${detail}`);
      return '';
    }
    warnings.push('Could not inspect code signature entitlements with codesign; static Info.plist checks still ran.');
    return '';
  }
  if (!result.stdout.trim()) {
    warnings.push(options.requireSignature
      ? 'codesign reported no entitlements; no entitlement keys were present to validate. This can be valid for a non-sandbox FDA-first app.'
      : 'codesign reported no entitlements; static Info.plist checks still ran.');
    return '';
  }
  return result.stdout;
}

function collectInfoPlistFailures(infoPlist) {
  const failures = collectPlistShapeFailures(infoPlist, 'Info.plist');
  const bundleIdentifier = extractPlistString(infoPlist, 'CFBundleIdentifier');
  const bundleName = extractPlistString(infoPlist, 'CFBundleName');
  const displayName = extractPlistString(infoPlist, 'CFBundleDisplayName');
  const shortVersion = extractPlistString(infoPlist, 'CFBundleShortVersionString');
  const bundleVersion = extractPlistString(infoPlist, 'CFBundleVersion');

  if (bundleIdentifier !== expected.bundleIdentifier) {
    failures.push(`Info.plist CFBundleIdentifier must be ${expected.bundleIdentifier}, got ${JSON.stringify(bundleIdentifier)}.`);
  }
  if (bundleName !== expected.appName && displayName !== expected.appName) {
    failures.push(`Info.plist CFBundleName or CFBundleDisplayName must be ${expected.appName}.`);
  }
  if (!shortVersion) {
    failures.push('Info.plist must include CFBundleShortVersionString.');
  }
  if (!bundleVersion) {
    failures.push('Info.plist must include CFBundleVersion.');
  }

  const allowedInfoUsageKeys = new Set([
    'NSDesktopFolderUsageDescription',
    'NSDocumentsFolderUsageDescription',
    'NSDownloadsFolderUsageDescription',
  ]);
  for (const key of allowedInfoUsageKeys) {
    if (!infoPlist.includes(`<key>${key}</key>`)) {
      failures.push(`Info.plist must keep ${key} for macOS fallback permission copy.`);
    }
  }

  const usageKeys = extractPlistKeys(infoPlist).filter(key => key.startsWith('NS') && key.endsWith('UsageDescription'));
  for (const key of usageKeys) {
    if (!allowedInfoUsageKeys.has(key)) {
      failures.push(`Info.plist must not declare unexpected privacy usage key ${key}.`);
    }
  }
  return failures;
}

function collectEntitlementFailures(entitlementsPlist) {
  if (!entitlementsPlist) return [];
  const failures = collectPlistShapeFailures(entitlementsPlist, 'App entitlements');

  const forbiddenEntitlementKeys = [
    'com.apple.security.files.user-selected.read-write',
    'com.apple.security.files.downloads.read-write',
    'com.apple.security.files.bookmarks.app-scope',
    'com.apple.security.automation.apple-events',
  ];
  for (const key of forbiddenEntitlementKeys) {
    if (entitlementsPlist.includes(`<key>${key}</key>`)) {
      failures.push(`App entitlements must not declare ${key}.`);
    }
  }

  const sandboxValueKind = getPlistValueKindAfterKey(entitlementsPlist, 'com.apple.security.app-sandbox');
  if (sandboxValueKind === 'true' || hasPlistBooleanTrueAfterKey(entitlementsPlist, 'com.apple.security.app-sandbox')) {
    failures.push('App entitlements must not enable com.apple.security.app-sandbox.');
  } else if (sandboxValueKind && !hasPlistBooleanFalseAfterKey(entitlementsPlist, 'com.apple.security.app-sandbox')) {
    failures.push('App entitlements must keep com.apple.security.app-sandbox as the boolean false when present.');
  }

  const applicationIdentifier = extractPlistString(entitlementsPlist, 'com.apple.application-identifier');
  if (
    applicationIdentifier
    && applicationIdentifier !== expected.bundleIdentifier
    && !applicationIdentifier.endsWith(`.${expected.bundleIdentifier}`)
  ) {
    failures.push(`App entitlements com.apple.application-identifier must end with ${expected.bundleIdentifier}, got ${JSON.stringify(applicationIdentifier)}.`);
  }
  return failures;
}

function printFailures(failures) {
  console.error('macOS app bundle validation failed:');
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
}

let options;
try {
  options = parseArgs(process.argv.slice(2));
} catch (error) {
  usage();
  console.error(`macOS app bundle validation failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(2);
}

const warnings = [];
let failures = [];
try {
  if (!options.appPath.endsWith('.app')) {
    failures.push(`App path must end with .app: ${options.appPath}`);
  }
  const appDirectoryExists = existsSync(options.appPath) && statSync(options.appPath).isDirectory();
  if (!appDirectoryExists) {
    failures.push(`App bundle directory does not exist: ${options.appPath}`);
  }

  if (!appDirectoryExists) {
    printFailures(failures);
    process.exit(1);
  }

  const infoPlistPath = resolve(options.appPath, 'Contents/Info.plist');
  const infoPlist = readText(infoPlistPath, 'app Info.plist');
  failures.push(...collectInfoPlistFailures(infoPlist));
  if (options.requireSignature && isSignedAppBundle(options.appPath)) {
    // Validates signing identity stability for FDA persistence; this does not validate notarization or stapling.
    failures.push(...collectSigningIdentityFailures(readSigningInfo(options, failures)));
  }
  failures.push(...collectEntitlementFailures(readEntitlements(options, warnings, failures)));
} catch (error) {
  console.error(`macOS app bundle validation failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}

if (failures.length > 0) {
  printFailures(failures);
  process.exit(1);
}

for (const warning of warnings) {
  console.warn(`Warning: ${warning}`);
}

console.log(`macOS app bundle validation passed: ${options.appPath}`);
