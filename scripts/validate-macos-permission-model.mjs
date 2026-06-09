import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Validates Aether's source-level macOS FDA-first permission model.
 *
 * This is a preflight, not a substitute for clean-user Full Disk Access testing.
 * It enforces the static config boundary: non-sandbox app identity, no
 * directory-scoped sandbox entitlements, no Apple Events entitlement, and no
 * unexpected macOS privacy domains beyond the three folder descriptions kept
 * for system fallback copy.
 */

function parseArgs(argv) {
  const options = { root: resolve(new URL('..', import.meta.url).pathname) };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--root') {
      const value = argv[index + 1];
      if (!value) {
        throw new Error('--root requires a path');
      }
      options.root = resolve(value);
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

function readProjectFile(root, relativePath) {
  const filePath = resolve(root, relativePath);
  if (!existsSync(filePath)) {
    throw new Error(`Missing required file: ${relativePath}`);
  }
  return readFileSync(filePath, 'utf8');
}

function readJson(root, relativePath) {
  try {
    return JSON.parse(readProjectFile(root, relativePath));
  } catch (error) {
    throw new Error(`Invalid JSON in ${relativePath}: ${error instanceof Error ? error.message : String(error)}`, {
      cause: error,
    });
  }
}

function extractPlistBooleanValuesForKey(plist, key) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return Array.from(
    plist.matchAll(new RegExp(`<key>${escaped}</key>\\s*<(true|false)\\s*/>`, 'gm')),
    match => match[1] === 'true',
  );
}

function extractPlistKeys(plist) {
  return Array.from(plist.matchAll(/<key>([^<]+)<\/key>/g), match => match[1]);
}

function extractRustFunction(source, functionName) {
  const range = extractRustFunctionRange(source, functionName);
  return range ? source.slice(range.bodyStart, range.end) : null;
}

function extractRustFunctionRange(source, functionName) {
  const match = new RegExp(`(?:pub\\(crate\\)\\s+)?fn\\s+${functionName}\\s*\\(`).exec(source);
  if (!match) return null;

  const bodyStart = source.indexOf('{', match.index);
  if (bodyStart === -1) return null;

  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    const char = source[index];
    if (char === '{') depth += 1;
    if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        return {
          start: match.index,
          bodyStart,
          end: index + 1,
        };
      }
    }
  }

  return null;
}

function stripRustFunctions(source, functionNames) {
  let stripped = source;
  for (const functionName of functionNames) {
    const range = extractRustFunctionRange(stripped, functionName);
    if (!range) continue;
    stripped = `${stripped.slice(0, range.start)}${stripped.slice(range.end)}`;
  }
  return stripped;
}

function collectRustStringLiterals(source) {
  return Array.from(source.matchAll(/"(?:\\.|[^"\\])*"/g), (match) => {
    try {
      return JSON.parse(match[0]);
    } catch {
      return match[0].slice(1, -1);
    }
  });
}

function countOccurrences(source, fragment) {
  return source.split(fragment).length - 1;
}

function sameStringSet(left, right) {
  const sortedLeft = [...left].sort();
  const sortedRight = [...right].sort();
  return sortedLeft.length === sortedRight.length
    && sortedLeft.every((value, index) => value === sortedRight[index]);
}

const coreAppleScriptAutomationFragments = [
  'Command::new("osascript")',
  'Command::new(\'osascript\')',
  'tell application "Finder"',
  "tell application 'Finder'",
  'System Events',
  'NSAppleScript',
];

const directoryAuthorizationFallbackFragments = [
  'NSOpenPanel',
  'NSSavePanel',
  'choose folder',
  'choose file',
  'security-scoped',
  'securityScoped',
  'startAccessingSecurityScopedResource',
  'stopAccessingSecurityScopedResource',
  'bookmarkData',
  'NSURLBookmarkCreationWithSecurityScope',
  'NSURLBookmarkResolutionWithSecurityScope',
];

const automaticTccResetFragments = [
  'Command::new("tccutil")',
  'Command::new(\'tccutil\')',
  'tccutil reset',
];

function containsAnyFragment(source, fragments) {
  return fragments.some(fragment => source.includes(fragment));
}

function validateCorePermissionAntiPatterns(failures, label, source) {
  if (containsAnyFragment(source, coreAppleScriptAutomationFragments)) {
    failures.push(`${label} must not contain AppleScript or Finder automation in the core file-operation permission path.`);
  }

  if (containsAnyFragment(source, directoryAuthorizationFallbackFragments)) {
    failures.push(`${label} must not contain directory authorization fallback APIs in the core FDA-first permission path.`);
  }

  if (containsAnyFragment(source, automaticTccResetFragments)) {
    failures.push(`${label} must not contain automatic TCC reset commands.`);
  }
}

function collectFailures({ root }) {
  const failures = [];
  const tauriConfig = readJson(root, 'src-tauri/tauri.conf.json');
  const entitlements = readProjectFile(root, 'src-tauri/Entitlements.plist');
  const infoPlist = readProjectFile(root, 'src-tauri/Info.plist');
  const fsCommands = readProjectFile(root, 'src-tauri/src/commands/fs.rs');
  const transferCommands = readProjectFile(root, 'src-tauri/src/commands/transfer.rs');

  if (tauriConfig.productName !== 'Aether Explorer') {
    failures.push(`src-tauri/tauri.conf.json productName must be "Aether Explorer", got ${JSON.stringify(tauriConfig.productName)}.`);
  }
  if (tauriConfig.identifier !== 'com.aether.explorer') {
    failures.push(`src-tauri/tauri.conf.json identifier must be "com.aether.explorer", got ${JSON.stringify(tauriConfig.identifier)}.`);
  }
  if (tauriConfig.bundle?.active !== true) {
    failures.push('src-tauri/tauri.conf.json bundle.active must be true.');
  }
  if (tauriConfig.bundle?.macOS?.entitlements !== 'Entitlements.plist') {
    failures.push('src-tauri/tauri.conf.json bundle.macOS.entitlements must point to Entitlements.plist.');
  }
  if (tauriConfig.bundle?.macOS?.infoPlist !== 'Info.plist') {
    failures.push('src-tauri/tauri.conf.json bundle.macOS.infoPlist must point to Info.plist.');
  }

  const appSandboxValues = extractPlistBooleanValuesForKey(entitlements, 'com.apple.security.app-sandbox');
  if (appSandboxValues.length !== 1 || appSandboxValues[0] !== false) {
    failures.push('src-tauri/Entitlements.plist must declare exactly one com.apple.security.app-sandbox key set to false.');
  }

  const forbiddenEntitlementKeys = [
    // Directory-scoped sandbox authorization conflicts with the FDA-first core path.
    'com.apple.security.files.user-selected.read-write',
    'com.apple.security.files.downloads.read-write',
    'com.apple.security.files.bookmarks.app-scope',
    // Apple Events would introduce a separate system permission domain.
    'com.apple.security.automation.apple-events',
  ];
  for (const key of forbiddenEntitlementKeys) {
    if (entitlements.includes(`<key>${key}</key>`)) {
      failures.push(`src-tauri/Entitlements.plist must not declare ${key}.`);
    }
  }

  const allowedInfoUsageKeys = new Set([
    // Kept as macOS fallback/system copy; FDA status still comes from TCC probes.
    'NSDesktopFolderUsageDescription',
    'NSDocumentsFolderUsageDescription',
    'NSDownloadsFolderUsageDescription',
  ]);
  for (const key of allowedInfoUsageKeys) {
    if (!infoPlist.includes(`<key>${key}</key>`)) {
      failures.push(`src-tauri/Info.plist must keep ${key} for macOS fallback permission copy.`);
    }
  }

  const usageKeys = extractPlistKeys(infoPlist).filter(key => key.startsWith('NS') && key.endsWith('UsageDescription'));
  for (const key of usageKeys) {
    if (!allowedInfoUsageKeys.has(key)) {
      failures.push(`src-tauri/Info.plist must not declare unexpected privacy usage key ${key}.`);
    }
  }

  const defaultProbeFunction = extractRustFunction(fsCommands, 'default_full_disk_access_probe_targets');
  if (!defaultProbeFunction) {
    failures.push('src-tauri/src/commands/fs.rs must define default_full_disk_access_probe_targets.');
  } else {
    const expectedProbeLiterals = [
      '/Library/Application Support/com.apple.TCC/TCC.db',
      'Library/Application Support/com.apple.TCC',
      'Library/Application Support/com.apple.TCC/TCC.db',
    ];
    const actualProbeLiterals = collectRustStringLiterals(defaultProbeFunction);
    if (!sameStringSet(actualProbeLiterals, expectedProbeLiterals)) {
      failures.push('src-tauri/src/commands/fs.rs must keep default_full_disk_access_probe_targets to the three TCC-only probe literals.');
    }

    if (
      countOccurrences(defaultProbeFunction, 'FullDiskAccessProbeKind::File') !== 2
      || countOccurrences(defaultProbeFunction, 'FullDiskAccessProbeKind::Directory') !== 1
    ) {
      failures.push('src-tauri/src/commands/fs.rs must keep default FDA probes as two TCC files and one TCC directory.');
    }
  }

  const registerFunction = extractRustFunction(fsCommands, 'register_full_disk_access');
  if (!registerFunction) {
    failures.push('src-tauri/src/commands/fs.rs must define register_full_disk_access.');
  } else {
    const registerBody = registerFunction.slice(1, -1).trim().replace(/;$/, '');
    if (registerBody !== 'full_disk_access_status()' && registerBody !== 'return full_disk_access_status()') {
      failures.push('src-tauri/src/commands/fs.rs register_full_disk_access must delegate directly to full_disk_access_status().');
    }
  }

  validateCorePermissionAntiPatterns(
    failures,
    'src-tauri/src/commands/transfer.rs',
    transferCommands,
  );

  const fsCoreCommandSource = stripRustFunctions(fsCommands, [
    // These are optional macOS integration helpers, not core copy/move/rename/trash permission paths.
    'export_workspace_app_icon',
    'list_open_with_paths',
    'pick_application_path',
    'resolve_default_open_with_path',
  ]);
  validateCorePermissionAntiPatterns(
    failures,
    'src-tauri/src/commands/fs.rs core file-operation commands',
    fsCoreCommandSource,
  );

  for (const functionName of ['rename_file', 'delete_to_trash', 'trash_delete_error']) {
    const functionSource = extractRustFunction(fsCommands, functionName);
    if (!functionSource) {
      failures.push(`src-tauri/src/commands/fs.rs must define ${functionName}.`);
      continue;
    }
    validateCorePermissionAntiPatterns(
      failures,
      `src-tauri/src/commands/fs.rs ${functionName}`,
      functionSource,
    );
  }

  return failures;
}

let options;
try {
  options = parseArgs(process.argv.slice(2));
} catch (error) {
  console.error(`macOS permission model validation failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(2);
}

let failures;
try {
  failures = collectFailures(options);
} catch (error) {
  console.error(`macOS permission model validation failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}

if (failures.length > 0) {
  console.error('macOS permission model validation failed:');
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log(`macOS permission model validation passed: ${options.root}`);
