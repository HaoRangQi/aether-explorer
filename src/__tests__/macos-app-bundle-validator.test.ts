import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';

const validatorPath = path.join(process.cwd(), 'scripts/validate-macos-app-bundle.mjs');
const tempDirs: string[] = [];

const validInfoPlist = `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0">
<dict>
  <key>CFBundleIdentifier</key>
  <string>com.aether.explorer</string>
  <key>CFBundleName</key>
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

const adhocSignatureInfo = `Executable=/Applications/Aether Explorer.app/Contents/MacOS/aether-explorer
Identifier=aether_explorer-47b64d31333604c2
Format=app bundle with Mach-O thin (arm64)
CodeDirectory v=20400 size=178024 flags=0x20002(adhoc,linker-signed) hashes=5559+0 location=embedded
Signature=adhoc
Info.plist=not bound
TeamIdentifier=not set
Sealed Resources=none
Internal requirements=none
`;

function createAppFixture({
  appName = 'Aether Explorer.app',
  infoPlist = validInfoPlist,
  entitlements = validEntitlements,
  signed = false,
  signatureInfo = stableSignatureInfo,
}: {
  appName?: string;
  infoPlist?: string;
  entitlements?: string;
  signed?: boolean;
  signatureInfo?: string;
} = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'aether-macos-app-bundle-'));
  tempDirs.push(root);
  const appPath = path.join(root, appName);
  mkdirSync(path.join(appPath, 'Contents'), { recursive: true });
  if (signed) {
    mkdirSync(path.join(appPath, 'Contents/_CodeSignature'), { recursive: true });
  }
  writeFileSync(path.join(appPath, 'Contents/Info.plist'), infoPlist);
  const entitlementsPath = path.join(root, 'Entitlements.plist');
  writeFileSync(entitlementsPath, entitlements);
  const signatureInfoPath = path.join(root, 'codesign-dv.txt');
  writeFileSync(signatureInfoPath, signatureInfo);
  return { appPath, entitlementsPath, signatureInfoPath };
}

function runValidator(args: string[]) {
  return spawnSync(process.execPath, [validatorPath, ...args], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });
}

function runFixture(options: Parameters<typeof createAppFixture>[0] = {}) {
  const fixture = createAppFixture(options);
  const result = runValidator([
    fixture.appPath,
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

describe('validate-macos-app-bundle script', () => {
  it('accepts packaged app metadata aligned with the FDA-first permission model', () => {
    const { appPath, result } = runFixture();

    expect(result.status).toBe(0);
    expect(result.stdout).toContain(`macOS app bundle validation passed: ${appPath}`);
  });

  it('keeps unsigned local app bundles warning-only in default mode', () => {
    const { appPath } = createAppFixture();
    const result = runValidator([appPath]);

    expect(result.status).toBe(0);
    expect(result.stderr).toContain('static Info.plist checks still ran');
    expect(result.stdout).toContain(`macOS app bundle validation passed: ${appPath}`);
  });

  it('rejects unsigned app bundles in release-candidate mode', () => {
    const { appPath } = createAppFixture();
    const result = runValidator(['--require-signature', appPath]);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Release-candidate validation requires a signed app bundle');
  });

  it('accepts release-candidate validation with a signature marker and explicit valid entitlements fixture', () => {
    const fixture = createAppFixture({ signed: true });
    const result = runValidator([
      '--require-signature',
      fixture.appPath,
      '--signature-info',
      fixture.signatureInfoPath,
      '--entitlements-plist',
      fixture.entitlementsPath,
    ]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain(`macOS app bundle validation passed: ${fixture.appPath}`);
  });

  it('rejects ad-hoc signing identities in release-candidate mode', () => {
    const fixture = createAppFixture({ signed: true, signatureInfo: adhocSignatureInfo });
    const result = runValidator([
      '--require-signature',
      fixture.appPath,
      '--signature-info',
      fixture.signatureInfoPath,
      '--entitlements-plist',
      fixture.entitlementsPath,
    ]);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('ad-hoc signatures are not valid Full Disk Access release evidence');
    expect(result.stderr).toContain('requires a stable TeamIdentifier');
    expect(result.stderr).toContain('Code signature Identifier must be com.aether.explorer');
  });

  it('rejects release signing identities with missing TeamIdentifier', () => {
    const fixture = createAppFixture({
      signed: true,
      signatureInfo: stableSignatureInfo.replace('TeamIdentifier=TEAMID1234', ''),
    });
    const result = runValidator([
      '--require-signature',
      fixture.appPath,
      '--signature-info',
      fixture.signatureInfoPath,
      '--entitlements-plist',
      fixture.entitlementsPath,
    ]);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('requires a stable TeamIdentifier');
  });

  it('rejects release signing identities with empty TeamIdentifier', () => {
    const fixture = createAppFixture({
      signed: true,
      signatureInfo: stableSignatureInfo.replace('TeamIdentifier=TEAMID1234', 'TeamIdentifier='),
    });
    const result = runValidator([
      '--require-signature',
      fixture.appPath,
      '--signature-info',
      fixture.signatureInfoPath,
      '--entitlements-plist',
      fixture.entitlementsPath,
    ]);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('requires a stable TeamIdentifier');
  });

  it('rejects release signing identities with mismatched code signing identifiers', () => {
    const fixture = createAppFixture({
      signed: true,
      signatureInfo: stableSignatureInfo.replace('Identifier=com.aether.explorer', 'Identifier=com.example.other'),
    });
    const result = runValidator([
      '--require-signature',
      fixture.appPath,
      '--signature-info',
      fixture.signatureInfoPath,
      '--entitlements-plist',
      fixture.entitlementsPath,
    ]);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Code signature Identifier must be com.aether.explorer for Full Disk Access persistence');
  });

  it('rejects missing app bundles before looking for nested plists', () => {
    const missingPath = path.join(tmpdir(), 'aether-missing-app.app');
    const result = runValidator([missingPath]);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('App bundle directory does not exist');
  });

  it('rejects bundle paths that are not .app directories', () => {
    const { result } = runFixture({ appName: 'Aether Explorer' });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('App path must end with .app');
  });

  it('rejects unstable bundle identity', () => {
    const { result } = runFixture({
      infoPlist: validInfoPlist.replace('com.aether.explorer', 'com.example.other'),
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('CFBundleIdentifier must be com.aether.explorer');
  });

  it('rejects packaged apps without version metadata', () => {
    const { result } = runFixture({
      infoPlist: validInfoPlist
        .replace('  <key>CFBundleShortVersionString</key>\n  <string>0.4.4</string>\n', '')
        .replace('  <key>CFBundleVersion</key>\n  <string>44</string>\n', ''),
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Info.plist must include CFBundleShortVersionString');
    expect(result.stderr).toContain('Info.plist must include CFBundleVersion');
  });

  it('rejects malformed Info.plist content', () => {
    const { result } = runFixture({
      infoPlist: validInfoPlist.replace('</plist>', ''),
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Info.plist must be a well-formed XML plist');
  });

  it('rejects unexpected macOS privacy usage domains', () => {
    const { result } = runFixture({
      infoPlist: validInfoPlist.replace(
        '</dict>',
        '  <key>NSAppleEventsUsageDescription</key>\n  <string>Not part of the core permission model.</string>\n</dict>',
      ),
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('must not declare unexpected privacy usage key NSAppleEventsUsageDescription');
  });

  it('rejects sandbox directory authorization entitlements', () => {
    const { result } = runFixture({
      entitlements: validEntitlements.replace(
        '</dict>',
        '  <key>com.apple.security.files.user-selected.read-write</key>\n  <false/>\n</dict>',
      ),
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('must not declare com.apple.security.files.user-selected.read-write');
  });

  it('rejects app sandbox being enabled in packaged entitlements', () => {
    const { result } = runFixture({
      entitlements: validEntitlements.replace('<false/>', '<true/>'),
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('must not enable com.apple.security.app-sandbox');
  });

  it('rejects app sandbox entitlement values that are not boolean false', () => {
    const { result } = runFixture({
      entitlements: validEntitlements.replace('<false/>', '<string>false</string>'),
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('must keep com.apple.security.app-sandbox as the boolean false');
  });

  it('rejects mismatched signed application identifiers when present', () => {
    const { result } = runFixture({
      entitlements: validEntitlements.replace(
        '</dict>',
        '  <key>com.apple.application-identifier</key>\n  <string>TEAMID.com.example.other</string>\n</dict>',
      ),
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('com.apple.application-identifier must end with com.aether.explorer');
  });

  it('rejects signed app bundles when codesign entitlements cannot be inspected', () => {
    const { appPath } = createAppFixture({ signed: true });
    const result = runValidator([appPath]);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Could not inspect code signature entitlements for signed app bundle');
  });

  it('rejects missing explicit entitlements plist fixtures', () => {
    const { appPath } = createAppFixture();
    const result = runValidator([
      appPath,
      '--entitlements-plist',
      path.join(tmpdir(), 'missing-entitlements.plist'),
    ]);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Missing entitlements plist');
  });
});
