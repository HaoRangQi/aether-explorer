import { describe, expect, it } from 'vitest';
import {
  createRemoteConnectionDraftId,
  DEFAULT_REMOTE_PORT,
  normalizeRemoteConnectionDraft,
  protocolLabel,
  validateRemoteConnectionDraft,
} from '../lib/remote-connections';

describe('remote connection helpers', () => {
  it('creates a stable draft id shape so test-save-open can reuse the same SFTP cache key', () => {
    const draftId = createRemoteConnectionDraftId(123);

    expect(draftId).toMatch(/^remote-draft-[a-z0-9]+-[a-z0-9]+$/);
    expect(normalizeRemoteConnectionDraft({
      id: draftId,
      protocol: 'sftp',
      name: 'Deploy',
      host: 'debian.local',
    }).id).toBe(draftId);
  });

  it('normalizes defaults by protocol', () => {
    expect(normalizeRemoteConnectionDraft({
      protocol: 'sftp',
      name: '  Work Server ',
      host: ' example.com ',
    })).toMatchObject({
      protocol: 'sftp',
      name: 'Work Server',
      host: 'example.com',
      port: DEFAULT_REMOTE_PORT.sftp,
      basePath: '/',
    });

    expect(normalizeRemoteConnectionDraft({
      protocol: 'webdav-https',
      name: 'DAV',
      host: 'dav.example.com',
    }).port).toBe(443);
  });

  it('validates required fields and port range', () => {
    const result = validateRemoteConnectionDraft({
      protocol: 'ftp',
      name: '',
      host: '',
      port: 70000,
    });

    expect(result.ok).toBe(false);
    expect(result.errors.name).toBeTruthy();
    expect(result.errors.host).toBeTruthy();
    expect(result.errors.port).toBeTruthy();
  });

  it('normalizes SFTP private-key authentication without leaking passphrases into connection config', () => {
    expect(normalizeRemoteConnectionDraft({
      protocol: 'sftp',
      name: 'Deploy',
      host: 'debian.local',
      authMethod: 'private-key',
      privateKeyPath: '  ~/.ssh/codex_debian  ',
      privateKeyPassphrase: 'secret',
      password: 'ignored',
    })).toMatchObject({
      protocol: 'sftp',
      authMethod: 'private-key',
      privateKeyPath: '~/.ssh/codex_debian',
      privateKeyPassphrase: 'secret',
      password: undefined,
    });

    expect(normalizeRemoteConnectionDraft({
      protocol: 'ftp',
      name: 'FTP',
      host: 'ftp.example.com',
      authMethod: 'private-key',
      privateKeyPath: '~/.ssh/id_rsa',
      privateKeyPassphrase: 'secret',
    })).toMatchObject({
      protocol: 'ftp',
      authMethod: 'password',
      privateKeyPath: undefined,
      privateKeyPassphrase: undefined,
    });
  });

  it('requires a private key path when SFTP uses private-key authentication', () => {
    const result = validateRemoteConnectionDraft({
      protocol: 'sftp',
      name: 'Deploy',
      host: 'debian.local',
      authMethod: 'private-key',
      privateKeyPath: '',
    });

    expect(result.ok).toBe(false);
    expect(result.errors.privateKeyPath).toBe('请选择私钥文件');
  });

  it('labels supported protocols', () => {
    expect(protocolLabel('sftp')).toBe('SFTP');
    expect(protocolLabel('webdav-http')).toBe('WebDAV HTTP');
  });
});
