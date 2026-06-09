import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  collectFullDiskAccessAcceptanceEvidence,
  validateFullDiskAccessAcceptanceEvidence,
  validateFullDiskAccessSmokeResult,
} from '../lib/smoke';

const tauriMocks = vi.hoisted(() => ({
  invoke: vi.fn(),
}));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: tauriMocks.invoke,
}));

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({ label: 'main' }),
}));

function defaultTccProbes(readable = true): Array<{
  path: string;
  targetType: 'file' | 'directory';
  exists: boolean;
  readable: boolean;
}> {
  return [
    {
      path: '/Library/Application Support/com.apple.TCC/TCC.db',
      targetType: 'file',
      exists: true,
      readable,
    },
    {
      path: '/Users/jane/Library/Application Support/com.apple.TCC',
      targetType: 'directory',
      exists: true,
      readable,
    },
    {
      path: '/Users/jane/Library/Application Support/com.apple.TCC/TCC.db',
      targetType: 'file',
      exists: true,
      readable,
    },
  ];
}

describe('validateFullDiskAccessSmokeResult', () => {
  it('accepts TCC-only Full Disk Access probe results', () => {
    expect(validateFullDiskAccessSmokeResult({
      status: 'granted',
      probes: defaultTccProbes(),
    })).toBe(true);
  });

  it('rejects user-content folder probes masquerading as FDA checks', () => {
    expect(validateFullDiskAccessSmokeResult({
      status: 'denied',
      probes: [
        {
          path: '/Users/jane/Documents',
          targetType: 'directory',
          exists: true,
          readable: false,
        },
      ],
    })).toBe(false);
  });

  it('rejects arbitrary nested files under the TCC directory', () => {
    expect(validateFullDiskAccessSmokeResult({
      status: 'granted',
      probes: [
        {
          path: '/Users/jane/Library/Application Support/com.apple.TCC/not-a-probe/nested',
          targetType: 'file',
          exists: true,
          readable: true,
        },
      ],
    })).toBe(false);
  });

  it('rejects the system TCC directory because it is not a default FDA probe', () => {
    expect(validateFullDiskAccessSmokeResult({
      status: 'granted',
      probes: [
        {
          path: '/Library/Application Support/com.apple.TCC',
          targetType: 'directory',
          exists: true,
          readable: true,
        },
      ],
    })).toBe(false);
  });

  it('rejects TCC probe path/type mismatches', () => {
    expect(validateFullDiskAccessSmokeResult({
      status: 'granted',
      probes: [
        {
          path: '/Library/Application Support/com.apple.TCC/TCC.db',
          targetType: 'directory',
          exists: true,
          readable: true,
        },
      ],
    })).toBe(false);
    expect(validateFullDiskAccessSmokeResult({
      status: 'granted',
      probes: [
        {
          path: '/Users/jane/Library/Application Support/com.apple.TCC',
          targetType: 'file',
          exists: true,
          readable: true,
        },
      ],
    })).toBe(false);
  });

  it('rejects partial FDA probe sets', () => {
    expect(validateFullDiskAccessSmokeResult({
      status: 'granted',
      probes: defaultTccProbes().slice(0, 2),
    })).toBe(false);
  });

  it('rejects traversal-shaped macOS user segments in TCC probe paths', () => {
    for (const probePath of [
      '/Users/./Library/Application Support/com.apple.TCC',
      '/Users/../Library/Application Support/com.apple.TCC',
    ]) {
      expect(validateFullDiskAccessSmokeResult({
        status: 'granted',
        probes: [
          defaultTccProbes()[0],
          {
            path: probePath,
            targetType: 'directory',
            exists: true,
            readable: true,
          },
          defaultTccProbes()[2],
        ],
      })).toBe(false);
    }
  });

  it('rejects mixed-user FDA probe sets', () => {
    expect(validateFullDiskAccessSmokeResult({
      status: 'granted',
      probes: [
        defaultTccProbes()[0],
        defaultTccProbes()[1],
        {
          path: '/Users/other/Library/Application Support/com.apple.TCC/TCC.db',
          targetType: 'file',
          exists: true,
          readable: true,
        },
      ],
    })).toBe(false);
  });

  it.each([
    {
      probe: {
        path: '/Library/Application Support/com.apple.TCC/TCC.db',
        targetType: 'file' as const,
        exists: false,
        readable: true,
      },
    },
    {
      probe: {
        path: '/Library/Application Support/com.apple.TCC/TCC.db',
        targetType: 'file' as const,
        exists: true,
        readable: true,
        error: 'permission denied',
      },
    },
    {
      probe: {
        path: '/Library/Application Support/com.apple.TCC/TCC.db',
        targetType: 'file' as const,
        exists: false,
        readable: false,
        error: 'not found',
      },
    },
  ])('rejects impossible FDA probe state %#', ({ probe }) => {
    expect(validateFullDiskAccessSmokeResult({
      status: 'granted',
      probes: [
        probe,
        defaultTccProbes()[1],
        defaultTccProbes()[2],
      ],
    })).toBe(false);
  });
});

describe('collectFullDiskAccessAcceptanceEvidence', () => {
  beforeEach(() => {
    tauriMocks.invoke.mockReset();
  });

  it('rejects copyable evidence when the FDA command returns user-content probes', async () => {
    tauriMocks.invoke.mockImplementation(async (command: string) => {
      if (command === 'get_app_identity') {
        return {
          appName: 'Aether Explorer',
          bundleIdentifier: 'com.aether.explorer',
          version: '0.4.4',
          appPath: '/Applications/Aether Explorer.app',
        };
      }

      if (command === 'full_disk_access_status') {
        return {
          status: 'granted',
          probes: [
            {
              path: '/Users/jane/Documents',
              targetType: 'directory',
              exists: true,
              readable: true,
            },
          ],
        };
      }

      throw new Error(`Unexpected command: ${command}`);
    });

    await expect(collectFullDiskAccessAcceptanceEvidence()).rejects.toThrow('TCC-only validation');
    expect(tauriMocks.invoke).toHaveBeenCalledWith('get_app_identity');
    expect(tauriMocks.invoke).toHaveBeenCalledWith('full_disk_access_status');
  });

  it('rejects copyable evidence until Full Disk Access is granted', async () => {
    tauriMocks.invoke.mockImplementation(async (command: string) => {
      if (command === 'get_app_identity') {
        return {
          appName: 'Aether Explorer',
          bundleIdentifier: 'com.aether.explorer',
          version: '0.4.4',
          appPath: '/Applications/Aether Explorer.app',
        };
      }

      if (command === 'full_disk_access_status') {
        return {
          status: 'unknown',
          probes: defaultTccProbes(false),
        };
      }

      throw new Error(`Unexpected command: ${command}`);
    });

    await expect(collectFullDiskAccessAcceptanceEvidence()).rejects.toThrow('requires granted access');
  });
});

describe('validateFullDiskAccessAcceptanceEvidence', () => {
  it('accepts copyable FDA acceptance evidence with app identity and TCC probes', () => {
    expect(validateFullDiskAccessAcceptanceEvidence({
      capturedAt: '2026-06-08T20:30:00.000Z',
      appIdentity: {
        appName: 'Aether Explorer',
        bundleIdentifier: 'com.aether.explorer',
        version: '0.4.4',
        appPath: '/Applications/Aether Explorer.app',
      },
      fullDiskAccess: {
        status: 'granted',
        probes: defaultTccProbes(),
      },
      runtime: {
        currentWindowLabel: 'main',
        userAgent: 'Mozilla/5.0',
        href: 'tauri://localhost/',
      },
    })).toBe(true);
  });

  it('rejects FDA acceptance evidence that uses user-content probes', () => {
    expect(validateFullDiskAccessAcceptanceEvidence({
      capturedAt: '2026-06-08T20:30:00.000Z',
      appIdentity: {
        appName: 'Aether Explorer',
        bundleIdentifier: 'com.aether.explorer',
        version: '0.4.4',
        appPath: '/Applications/Aether Explorer.app',
      },
      fullDiskAccess: {
        status: 'granted',
        probes: [
          {
            path: '/Users/jane/Documents',
            targetType: 'directory',
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
    })).toBe(false);
  });

  it('rejects FDA acceptance evidence with mismatched TCC probe target types', () => {
    expect(validateFullDiskAccessAcceptanceEvidence({
      capturedAt: '2026-06-08T20:30:00.000Z',
      appIdentity: {
        appName: 'Aether Explorer',
        bundleIdentifier: 'com.aether.explorer',
        version: '0.4.4',
        appPath: '/Applications/Aether Explorer.app',
      },
      fullDiskAccess: {
        status: 'granted',
        probes: [
          {
            path: '/Users/jane/Library/Application Support/com.apple.TCC/TCC.db',
            targetType: 'directory',
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
    })).toBe(false);
  });

  it('rejects FDA acceptance evidence missing a default probe', () => {
    expect(validateFullDiskAccessAcceptanceEvidence({
      capturedAt: '2026-06-08T20:30:00.000Z',
      appIdentity: {
        appName: 'Aether Explorer',
        bundleIdentifier: 'com.aether.explorer',
        version: '0.4.4',
        appPath: '/Applications/Aether Explorer.app',
      },
      fullDiskAccess: {
        status: 'granted',
        probes: defaultTccProbes().slice(0, 2),
      },
      runtime: {
        currentWindowLabel: 'main',
        userAgent: 'Mozilla/5.0',
        href: 'tauri://localhost/',
      },
    })).toBe(false);
  });

  it('rejects FDA acceptance evidence whose user probes belong to different users', () => {
    expect(validateFullDiskAccessAcceptanceEvidence({
      capturedAt: '2026-06-08T20:30:00.000Z',
      appIdentity: {
        appName: 'Aether Explorer',
        bundleIdentifier: 'com.aether.explorer',
        version: '0.4.4',
        appPath: '/Applications/Aether Explorer.app',
      },
      fullDiskAccess: {
        status: 'granted',
        probes: [
          defaultTccProbes()[0],
          defaultTccProbes()[1],
          {
            path: '/Users/other/Library/Application Support/com.apple.TCC/TCC.db',
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
    })).toBe(false);
  });

  it('rejects FDA acceptance evidence with impossible readable probe state', () => {
    expect(validateFullDiskAccessAcceptanceEvidence({
      capturedAt: '2026-06-08T20:30:00.000Z',
      appIdentity: {
        appName: 'Aether Explorer',
        bundleIdentifier: 'com.aether.explorer',
        version: '0.4.4',
        appPath: '/Applications/Aether Explorer.app',
      },
      fullDiskAccess: {
        status: 'granted',
        probes: [
          {
            path: '/Library/Application Support/com.apple.TCC/TCC.db',
            targetType: 'file',
            exists: false,
            readable: true,
          },
          defaultTccProbes()[1],
          defaultTccProbes()[2],
        ],
      },
      runtime: {
        currentWindowLabel: 'main',
        userAgent: 'Mozilla/5.0',
        href: 'tauri://localhost/',
      },
    })).toBe(false);
  });

  it('rejects FDA acceptance evidence that is not granted', () => {
    expect(validateFullDiskAccessAcceptanceEvidence({
      capturedAt: '2026-06-08T20:30:00.000Z',
      appIdentity: {
        appName: 'Aether Explorer',
        bundleIdentifier: 'com.aether.explorer',
        version: '0.4.4',
        appPath: '/Applications/Aether Explorer.app',
      },
      fullDiskAccess: {
        status: 'denied',
        probes: defaultTccProbes(false),
      },
      runtime: {
        currentWindowLabel: 'main',
        userAgent: 'Mozilla/5.0',
        href: 'tauri://localhost/',
      },
    })).toBe(false);
  });

  it('rejects granted FDA acceptance evidence without a readable probe', () => {
    expect(validateFullDiskAccessAcceptanceEvidence({
      capturedAt: '2026-06-08T20:30:00.000Z',
      appIdentity: {
        appName: 'Aether Explorer',
        bundleIdentifier: 'com.aether.explorer',
        version: '0.4.4',
        appPath: '/Applications/Aether Explorer.app',
      },
      fullDiskAccess: {
        status: 'granted',
        probes: defaultTccProbes(false),
      },
      runtime: {
        currentWindowLabel: 'main',
        userAgent: 'Mozilla/5.0',
        href: 'tauri://localhost/',
      },
    })).toBe(false);
  });
});
