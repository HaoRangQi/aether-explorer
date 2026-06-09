import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';

const validatorPath = path.join(process.cwd(), 'scripts/validate-macos-permission-model.mjs');
const tempDirs: string[] = [];

const validEntitlements = `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0">
<dict>
  <key>com.apple.security.app-sandbox</key>
  <false/>
</dict>
</plist>
`;

const validInfoPlist = `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0">
<dict>
  <key>NSDesktopFolderUsageDescription</key>
  <string>Aether Explorer needs Desktop access.</string>
  <key>NSDocumentsFolderUsageDescription</key>
  <string>Aether Explorer needs Documents access.</string>
  <key>NSDownloadsFolderUsageDescription</key>
  <string>Aether Explorer needs Downloads access.</string>
</dict>
</plist>
`;

const validFsCommands = `
use std::path::Path;

pub(crate) enum FullDiskAccessProbeKind {
    File,
    Directory,
}

pub(crate) struct FullDiskAccessProbeTarget {
    pub(crate) path: PathBuf,
    pub(crate) kind: FullDiskAccessProbeKind,
}

pub(crate) fn default_full_disk_access_probe_targets(home: &str) -> Vec<FullDiskAccessProbeTarget> {
    let home = PathBuf::from(home);
    vec![
        FullDiskAccessProbeTarget {
            path: PathBuf::from("/Library/Application Support/com.apple.TCC/TCC.db"),
            kind: FullDiskAccessProbeKind::File,
        },
        FullDiskAccessProbeTarget {
            path: home.join("Library/Application Support/com.apple.TCC"),
            kind: FullDiskAccessProbeKind::Directory,
        },
        FullDiskAccessProbeTarget {
            path: home.join("Library/Application Support/com.apple.TCC/TCC.db"),
            kind: FullDiskAccessProbeKind::File,
        },
    ]
}

pub(crate) fn full_disk_access_status() -> FullDiskAccessCheckResult {
    full_disk_access_status_for_home(&dirs_fun())
}

pub(crate) fn register_full_disk_access() -> FullDiskAccessCheckResult {
    full_disk_access_status()
}

pub(crate) fn rename_file(path: String, new_name: String) -> Result<String, AppError> {
    Ok(format!("{}/{}", path, new_name))
}

pub(crate) fn delete_to_trash(path: String) -> Result<(), AppError> {
    trash::delete(&path).map_err(|e| trash_delete_error(&path, e.to_string()))
}

pub(crate) fn trash_delete_error(path: &str, error: impl Into<String>) -> AppError {
    AppError::internal_at(format!("trash failed: {}", error.into()), Some(path.to_string()))
}
`;

const validTransferCommands = `
use std::fs;
use std::path::Path;

fn remove_path(path: &Path) -> std::io::Result<()> {
    let metadata = fs::symlink_metadata(path)?;
    if metadata.is_dir() && !metadata.file_type().is_symlink() {
        fs::remove_dir_all(path)
    } else {
        fs::remove_file(path)
    }
}

pub(crate) fn copy_path_with_progress(src: &Path, dst: &Path) -> Result<(), String> {
    fs::copy(src, dst).map(|_| ()).map_err(|e| e.to_string())
}

pub(crate) fn move_path(src: &Path, dst: &Path) -> Result<(), String> {
    fs::rename(src, dst).map_err(|e| e.to_string())
}
`;

function validTauriConfig(overrides: Record<string, unknown> = {}) {
  return {
    productName: 'Aether Explorer',
    version: '0.4.4',
    identifier: 'com.aether.explorer',
    bundle: {
      active: true,
      macOS: {
        entitlements: 'Entitlements.plist',
        infoPlist: 'Info.plist',
      },
    },
    ...overrides,
  };
}

function createFixture({
  entitlements = validEntitlements,
  infoPlist = validInfoPlist,
  fsCommands = validFsCommands,
  transferCommands = validTransferCommands,
  tauriConfig = validTauriConfig(),
}: {
  entitlements?: string;
  infoPlist?: string;
  fsCommands?: string;
  transferCommands?: string;
  tauriConfig?: Record<string, unknown>;
} = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'aether-macos-permissions-'));
  tempDirs.push(root);
  mkdirSync(path.join(root, 'src-tauri'), { recursive: true });
  mkdirSync(path.join(root, 'src-tauri/src/commands'), { recursive: true });
  writeFileSync(path.join(root, 'src-tauri/Entitlements.plist'), entitlements);
  writeFileSync(path.join(root, 'src-tauri/Info.plist'), infoPlist);
  writeFileSync(path.join(root, 'src-tauri/tauri.conf.json'), JSON.stringify(tauriConfig, null, 2));
  writeFileSync(path.join(root, 'src-tauri/src/commands/fs.rs'), fsCommands);
  writeFileSync(path.join(root, 'src-tauri/src/commands/transfer.rs'), transferCommands);
  return root;
}

function runValidator(root = process.cwd()) {
  return spawnSync(process.execPath, [validatorPath, '--root', root], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe('validate-macos-permission-model script', () => {
  it('accepts the current project macOS permission model', () => {
    const result = runValidator();

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('macOS permission model validation passed');
  });

  it('rejects sandbox directory authorization entitlements', () => {
    const root = createFixture({
      // Forbidden permission-domain keys must not appear at all, regardless of value.
      entitlements: validEntitlements.replace(
        '</dict>',
        '  <key>com.apple.security.files.user-selected.read-write</key>\n  <true/>\n</dict>',
      ),
    });

    const result = runValidator(root);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('must not declare com.apple.security.files.user-selected.read-write');
  });

  it('rejects app sandbox enabled', () => {
    const root = createFixture({
      entitlements: validEntitlements.replace('<false/>', '<true/>'),
    });

    const result = runValidator(root);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('must declare exactly one com.apple.security.app-sandbox key set to false');
  });

  it('rejects duplicate app sandbox declarations', () => {
    const root = createFixture({
      entitlements: validEntitlements.replace(
        '</dict>',
        '  <key>com.apple.security.app-sandbox</key>\n  <true/>\n</dict>',
      ),
    });

    const result = runValidator(root);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('must declare exactly one com.apple.security.app-sandbox key set to false');
  });

  it('rejects Apple Events entitlement', () => {
    const root = createFixture({
      entitlements: validEntitlements.replace(
        '</dict>',
        '  <key>com.apple.security.automation.apple-events</key>\n  <true/>\n</dict>',
      ),
    });

    const result = runValidator(root);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('must not declare com.apple.security.automation.apple-events');
  });

  it('rejects unexpected privacy usage descriptions', () => {
    const root = createFixture({
      infoPlist: validInfoPlist.replace(
        '</dict>',
        '  <key>NSAppleEventsUsageDescription</key>\n  <string>Not part of the core permission model.</string>\n</dict>',
      ),
    });

    const result = runValidator(root);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('must not declare unexpected privacy usage key NSAppleEventsUsageDescription');
  });

  it('rejects missing required folder usage descriptions', () => {
    const root = createFixture({
      infoPlist: validInfoPlist.replace(
        '  <key>NSDownloadsFolderUsageDescription</key>\n  <string>Aether Explorer needs Downloads access.</string>\n',
        '',
      ),
    });

    const result = runValidator(root);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('must keep NSDownloadsFolderUsageDescription');
  });

  it('rejects unstable app identity fields', () => {
    const root = createFixture({
      tauriConfig: validTauriConfig({
        productName: 'Other App',
        identifier: 'com.example.other',
      }),
    });

    const result = runValidator(root);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('productName must be "Aether Explorer"');
    expect(result.stderr).toContain('identifier must be "com.aether.explorer"');
  });

  it('rejects Tauri config that points at the wrong permission files', () => {
    const root = createFixture({
      tauriConfig: validTauriConfig({
        bundle: {
          active: true,
          macOS: {
            entitlements: 'OtherEntitlements.plist',
            infoPlist: 'Info.plist',
          },
        },
      }),
    });

    const result = runValidator(root);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('bundle.macOS.entitlements must point to Entitlements.plist');
  });

  it('rejects FDA probes outside the TCC-only contract', () => {
    const root = createFixture({
      fsCommands: validFsCommands.replace(
        'Library/Application Support/com.apple.TCC/TCC.db',
        'Documents',
      ),
    });

    const result = runValidator(root);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('must keep default_full_disk_access_probe_targets to the three TCC-only probe literals');
  });

  it('rejects register_full_disk_access implementations that diverge from the TCC probe', () => {
    const root = createFixture({
      fsCommands: validFsCommands.replace(
        `pub(crate) fn register_full_disk_access() -> FullDiskAccessCheckResult {
    full_disk_access_status()
}`,
        `pub(crate) fn register_full_disk_access() -> FullDiskAccessCheckResult {
    open_system_settings_and_register()
}`,
      ),
    });

    const result = runValidator(root);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('register_full_disk_access must delegate directly to full_disk_access_status()');
  });

  it('rejects AppleScript or Finder automation in core copy and move operations', () => {
    const root = createFixture({
      transferCommands: validTransferCommands.replace(
        'fs::copy(src, dst).map(|_| ()).map_err(|e| e.to_string())',
        'std::process::Command::new("osascript").args(["-e", "tell application \\"Finder\\" to duplicate POSIX file \\"/tmp/a\\""]).output().map(|_| ()).map_err(|e| e.to_string())',
      ),
    });

    const result = runValidator(root);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('src-tauri/src/commands/transfer.rs must not contain AppleScript or Finder automation');
  });

  it('rejects security-scoped directory authorization fallbacks in core copy and move operations', () => {
    const root = createFixture({
      transferCommands: validTransferCommands.replace(
        'fs::rename(src, dst).map_err(|e| e.to_string())',
        'startAccessingSecurityScopedResource(); NSOpenPanel::new(); bookmarkData(); fs::rename(src, dst).map_err(|e| e.to_string())',
      ),
    });

    const result = runValidator(root);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('src-tauri/src/commands/transfer.rs must not contain directory authorization fallback APIs');
  });

  it('rejects AppleScript, Finder automation, or automatic TCC reset in trash operations', () => {
    const root = createFixture({
      fsCommands: validFsCommands.replace(
        'trash::delete(&path).map_err(|e| trash_delete_error(&path, e.to_string()))',
        'std::process::Command::new("tccutil").args(["reset", "All"]).output(); std::process::Command::new("osascript").args(["-e", "tell application \\"System Events\\" to empty the trash"]).output().map(|_| ()).map_err(|e| trash_delete_error(&path, e.to_string()))',
      ),
    });

    const result = runValidator(root);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('src-tauri/src/commands/fs.rs delete_to_trash must not contain AppleScript or Finder automation');
    expect(result.stderr).toContain('src-tauri/src/commands/fs.rs delete_to_trash must not contain automatic TCC reset commands');
  });

  it('rejects core file-operation helpers that hide forbidden automation', () => {
    const root = createFixture({
      fsCommands: `${validFsCommands.replace(
        'trash::delete(&path).map_err(|e| trash_delete_error(&path, e.to_string()))',
        'trash_with_helper(&path).map_err(|e| trash_delete_error(&path, e.to_string()))',
      )}

fn trash_with_helper(path: &str) -> Result<(), String> {
    std::process::Command::new("osascript")
        .args(["-e", "tell application \\"Finder\\" to delete POSIX file \\"/tmp/a\\""])
        .output()
        .map(|_| ())
        .map_err(|e| e.to_string())
}
`,
    });

    const result = runValidator(root);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('src-tauri/src/commands/fs.rs core file-operation commands must not contain AppleScript or Finder automation');
  });
});
