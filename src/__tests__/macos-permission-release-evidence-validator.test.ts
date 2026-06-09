import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';

const validatorPath = path.join(process.cwd(), 'scripts/validate-macos-permission-release-evidence.mjs');
const tempDirs: string[] = [];

const validInfoPlist = `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0">
<dict>
  <key>CFBundleIdentifier</key>
  <string>com.aether.explorer</string>
  <key>CFBundleName</key>
  <string>Aether Explorer</string>
  <key>CFBundleDisplayName</key>
  <string>Aether Explorer</string>
  <key>CFBundleShortVersionString</key>
  <string>0.4.4</string>
  <key>CFBundleVersion</key>
  <string>44</string>
  <key>NSDesktopFolderUsageDescription</key>
  <string>Aether Explorer needs Desktop access.</string>
  <key>NSDocumentsFolderUsageDescription</key>
  <string>Aether Explorer needs Documents access.</string>
  <key>NSDownloadsFolderUsageDescription</key>
  <string>Aether Explorer needs Downloads access.</string>
</dict>
</plist>
`;

const validEntitlements = `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0">
<dict>
  <key>com.apple.security.app-sandbox</key>
  <false/>
</dict>
</plist>
`;

const stableSignatureInfo = `Executable=/Applications/Aether Explorer.app/Contents/MacOS/aether-explorer
Identifier=com.aether.explorer
Format=app bundle with Mach-O thin (arm64)
CodeDirectory v=20500 size=12345 flags=0x10000(runtime) hashes=100+7 location=embedded
Signature size=9000
Authority=Developer ID Application: Aether Explorer (TEAMID1234)
Authority=Developer ID Certification Authority
Authority=Apple Root CA
Info.plist=bound
TeamIdentifier=TEAMID1234
Sealed Resources version=2 rules=13 files=42
`;

function validEvidence(appPath: string, overrides: Record<string, unknown> = {}) {
  return {
    capturedAt: '2026-06-09T00:00:00.000Z',
    appIdentity: {
      appName: 'Aether Explorer',
      bundleIdentifier: 'com.aether.explorer',
      version: '0.4.4',
      appPath,
    },
    fullDiskAccess: {
      status: 'granted',
      probes: [
        {
          path: '/Library/Application Support/com.apple.TCC/TCC.db',
          targetType: 'file',
          exists: true,
          readable: true,
        },
        {
          path: '/Users/jane/Library/Application Support/com.apple.TCC',
          targetType: 'directory',
          exists: true,
          readable: true,
        },
        {
          path: '/Users/jane/Library/Application Support/com.apple.TCC/TCC.db',
          targetType: 'file',
          exists: true,
          readable: true,
        },
      ],
    },
    runtime: {
      currentWindowLabel: 'main',
      userAgent: 'Mozilla/5.0',
      href: 'tauri://localhost/',
    },
    ...overrides,
  };
}

function createFixture(evidenceOverrides: Record<string, unknown> | ((appPath: string) => Record<string, unknown>) = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'aether-macos-release-evidence-'));
  tempDirs.push(root);
  const appPath = path.join(root, 'Aether Explorer.app');
  mkdirSync(path.join(appPath, 'Contents/_CodeSignature'), { recursive: true });
  writeFileSync(path.join(appPath, 'Contents/Info.plist'), validInfoPlist);

  const entitlementsPath = path.join(root, 'Entitlements.plist');
  writeFileSync(entitlementsPath, validEntitlements);
  const signatureInfoPath = path.join(root, 'codesign-dv.txt');
  writeFileSync(signatureInfoPath, stableSignatureInfo);
  const evidencePath = path.join(root, 'fda-evidence.json');
  const resolvedEvidenceOverrides = typeof evidenceOverrides === 'function'
    ? evidenceOverrides(appPath)
    : evidenceOverrides;
  writeFileSync(evidencePath, JSON.stringify(validEvidence(appPath, resolvedEvidenceOverrides), null, 2));
  return { appPath, entitlementsPath, evidencePath, signatureInfoPath };
}

function runValidator(args: string[]) {
  return spawnSync(process.execPath, [validatorPath, ...args], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });
}

function runFixture(evidenceOverrides: Parameters<typeof createFixture>[0] = {}) {
  const fixture = createFixture(evidenceOverrides);
  const result = runValidator([
    '--app',
    fixture.appPath,
    '--evidence',
    fixture.evidencePath,
    '--signature-info',
    fixture.signatureInfoPath,
    '--entitlements-plist',
    fixture.entitlementsPath,
  ]);
  return { ...fixture, result };
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe('validate-macos-permission-release-evidence script', () => {
  it('accepts matching release app and FDA evidence identities', () => {
    const { result } = runFixture();

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('macOS permission release evidence validation passed');
  });

  it('rejects FDA evidence captured from a different bundle id', () => {
    const { result } = runFixture({
      appIdentity: {
        appName: 'Aether Explorer',
        bundleIdentifier: 'com.example.other',
        version: '0.4.4',
        appPath: '/Applications/Aether Explorer.app',
      },
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('appIdentity.bundleIdentifier must match app bundle');
  });

  it('rejects FDA evidence captured from a different version', () => {
    const { result } = runFixture((appPath) => ({
      appIdentity: {
        appName: 'Aether Explorer',
        bundleIdentifier: 'com.aether.explorer',
        version: '0.4.5',
        appPath,
      },
    }));

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('appIdentity.version must match app bundle');
  });

  it('rejects FDA evidence captured from a different app path', () => {
    const { result } = runFixture({
      appIdentity: {
        appName: 'Aether Explorer',
        bundleIdentifier: 'com.aether.explorer',
        version: '0.4.4',
        appPath: '/Applications/Aether Explorer.app',
      },
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('appIdentity.appPath must resolve to the validated app bundle');
  });

  it('rejects FDA evidence with a missing app identity before comparing bundles', () => {
    const { result } = runFixture({
      appIdentity: null,
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('FDA evidence validation failed');
    expect(result.stderr).toContain('appIdentity must be an object');
  });

  it('rejects FDA evidence that did not grant Full Disk Access', () => {
    const { result } = runFixture((appPath) => ({
      appIdentity: {
        appName: 'Aether Explorer',
        bundleIdentifier: 'com.aether.explorer',
        version: '0.4.4',
        appPath,
      },
      fullDiskAccess: {
        status: 'denied',
        probes: [
          {
            path: '/Library/Application Support/com.apple.TCC/TCC.db',
            targetType: 'file',
            exists: true,
            readable: false,
          },
          {
            path: '/Users/jane/Library/Application Support/com.apple.TCC',
            targetType: 'directory',
            exists: true,
            readable: false,
          },
          {
            path: '/Users/jane/Library/Application Support/com.apple.TCC/TCC.db',
            targetType: 'file',
            exists: true,
            readable: false,
          },
        ],
      },
    }));

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('FDA evidence validation failed');
  });
});
