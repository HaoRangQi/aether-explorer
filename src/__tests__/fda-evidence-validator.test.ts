import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';

const validatorPath = path.join(process.cwd(), 'scripts/validate-fda-evidence.mjs');
const tempDirs: string[] = [];

function writeEvidenceFile(evidence: unknown): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'aether-fda-evidence-'));
  tempDirs.push(dir);
  const filePath = path.join(dir, 'evidence.json');
  writeFileSync(filePath, JSON.stringify(evidence, null, 2));
  return filePath;
}

function runValidator(evidence: unknown) {
  return spawnSync(process.execPath, [validatorPath, writeEvidenceFile(evidence)], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });
}

function validEvidence(overrides: Partial<Record<string, unknown>> = {}) {
  return {
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

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe('validate-fda-evidence script', () => {
  it('accepts granted FDA evidence with TCC-only probes', () => {
    const result = runValidator(validEvidence());

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('FDA evidence validation passed');
  });

  it('rejects acceptance evidence that is not granted', () => {
    const result = runValidator(validEvidence({
      fullDiskAccess: {
        status: 'denied',
        probes: [
          {
            path: '/Library/Application Support/com.apple.TCC/TCC.db',
            targetType: 'file',
            exists: true,
            readable: false,
          },
        ],
      },
    }));

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('fullDiskAccess.status must be "granted"');
  });

  it('rejects user-content probes masquerading as FDA evidence', () => {
    const result = runValidator(validEvidence({
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
    }));

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('is not a TCC-only FDA probe path');
  });

  it.each([
    '/Library/Application Support/com.apple.TCC',
    '/Users/jane/Desktop',
    '/Users/jane/Downloads',
    '/Users/./Library/Application Support/com.apple.TCC',
    '/Users/../Library/Application Support/com.apple.TCC',
    '/Users/jane/Library/Mobile Documents/com~apple~CloudDocs',
    '/Users/jane/Library/Application Support/com.apple.TCC/not-a-probe/nested',
  ])('rejects non-FDA probe path %s', (probePath) => {
    const result = runValidator(validEvidence({
      fullDiskAccess: {
        status: 'granted',
        probes: [
          {
            path: probePath,
            targetType: 'directory',
            exists: true,
            readable: true,
          },
        ],
      },
    }));

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('is not a TCC-only FDA probe path');
  });

  it.each([
    {
      path: '/Library/Application Support/com.apple.TCC/TCC.db',
      targetType: 'directory',
      expectedType: 'file',
    },
    {
      path: '/Users/jane/Library/Application Support/com.apple.TCC',
      targetType: 'file',
      expectedType: 'directory',
    },
    {
      path: '/Users/jane/Library/Application Support/com.apple.TCC/TCC.db',
      targetType: 'directory',
      expectedType: 'file',
    },
  ])('rejects FDA probe path/type mismatch %#', ({ path: probePath, targetType, expectedType }) => {
    const result = runValidator(validEvidence({
      fullDiskAccess: {
        status: 'granted',
        probes: [
          {
            path: probePath,
            targetType,
            exists: true,
            readable: true,
          },
        ],
      },
    }));

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(`targetType must be "${expectedType}" for TCC probe path`);
  });

  it('rejects FDA evidence missing a default TCC probe', () => {
    const result = runValidator(validEvidence({
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
        ],
      },
    }));

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('must contain exactly the three default TCC probes');
    expect(result.stderr).toContain('must include exactly one userTccDb default TCC probe');
  });

  it('rejects FDA evidence with duplicate default TCC probes', () => {
    const result = runValidator(validEvidence({
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
        ],
      },
    }));

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('must include exactly one systemTccDb default TCC probe, got 2');
    expect(result.stderr).toContain('must include exactly one userTccDb default TCC probe, got 0');
  });

  it('rejects FDA evidence whose user TCC probes come from different users', () => {
    const result = runValidator(validEvidence({
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
            path: '/Users/other/Library/Application Support/com.apple.TCC/TCC.db',
            targetType: 'file',
            exists: true,
            readable: true,
          },
        ],
      },
    }));

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('user TCC paths must belong to the same macOS user');
  });

  it.each([
    {
      probe: {
        path: '/Library/Application Support/com.apple.TCC/TCC.db',
        targetType: 'file',
        exists: false,
        readable: true,
      },
      message: 'readable cannot be true when exists is false',
    },
    {
      probe: {
        path: '/Library/Application Support/com.apple.TCC/TCC.db',
        targetType: 'file',
        exists: true,
        readable: true,
        error: 'permission denied',
      },
      message: 'error must be null or omitted when readable is true',
    },
    {
      probe: {
        path: '/Library/Application Support/com.apple.TCC/TCC.db',
        targetType: 'file',
        exists: false,
        readable: false,
        error: 'not found',
      },
      message: 'error must be null or omitted when exists is false',
    },
  ])('rejects impossible FDA probe state %#', ({ probe, message }) => {
    const result = runValidator(validEvidence({
      fullDiskAccess: {
        status: 'granted',
        probes: [
          probe,
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
    }));

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(message);
  });

  it('rejects evidence with missing runtime identity fields', () => {
    const result = runValidator(validEvidence({
      runtime: {
        currentWindowLabel: 'main',
        userAgent: '',
        href: 'tauri://localhost/',
      },
    }));

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('runtime.userAgent must be a non-empty string');
  });
});
