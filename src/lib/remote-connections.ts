import type { RemoteAuthMethod, RemoteConnectionProtocol } from '../types';

export const REMOTE_PROTOCOLS: RemoteConnectionProtocol[] = [
  'sftp',
  'ftp',
  'webdav-https',
  'webdav-http',
];

export const DEFAULT_REMOTE_PORT: Record<RemoteConnectionProtocol, number> = {
  sftp: 22,
  ftp: 21,
  'webdav-https': 443,
  'webdav-http': 80,
};

export interface RemoteConnectionDraft {
  id?: string;
  protocol: RemoteConnectionProtocol;
  name: string;
  host: string;
  port?: number;
  username?: string;
  basePath?: string;
  authMethod?: RemoteAuthMethod;
  password?: string;
  privateKeyPath?: string;
  privateKeyPassphrase?: string;
}

export interface RemoteConnectionValidationResult {
  ok: boolean;
  errors: Partial<Record<keyof RemoteConnectionDraft, string>>;
}

export function createRemoteConnectionDraftId(seed = Date.now()): string {
  return `remote-draft-${seed.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function normalizeRemoteConnectionDraft(draft: RemoteConnectionDraft): RemoteConnectionDraft {
  const protocol = REMOTE_PROTOCOLS.includes(draft.protocol) ? draft.protocol : 'sftp';
  const authMethod: RemoteAuthMethod =
    protocol === 'sftp' && draft.authMethod === 'private-key' ? 'private-key' : 'password';
  return {
    id: draft.id?.trim() || undefined,
    protocol,
    name: draft.name.trim(),
    host: draft.host.trim(),
    port: Number.isFinite(draft.port) && draft.port ? Number(draft.port) : DEFAULT_REMOTE_PORT[protocol],
    username: draft.username?.trim() || undefined,
    basePath: draft.basePath?.trim() || '/',
    authMethod,
    password: authMethod === 'password' && draft.password ? draft.password : undefined,
    privateKeyPath: authMethod === 'private-key' ? draft.privateKeyPath?.trim() || undefined : undefined,
    privateKeyPassphrase: authMethod === 'private-key' && draft.privateKeyPassphrase ? draft.privateKeyPassphrase : undefined,
  };
}

export function validateRemoteConnectionDraft(draft: RemoteConnectionDraft): RemoteConnectionValidationResult {
  const normalized = normalizeRemoteConnectionDraft(draft);
  const errors: RemoteConnectionValidationResult['errors'] = {};

  if (!REMOTE_PROTOCOLS.includes(normalized.protocol)) {
    errors.protocol = '不支持的协议';
  }
  if (!normalized.name) {
    errors.name = '请输入连接名称';
  }
  if (!normalized.host) {
    errors.host = '请输入服务器地址';
  }
  if (!normalized.port || normalized.port < 1 || normalized.port > 65535) {
    errors.port = '端口需在 1-65535 之间';
  }
  if (normalized.protocol === 'sftp' && normalized.authMethod === 'private-key' && !normalized.privateKeyPath) {
    errors.privateKeyPath = '请选择私钥文件';
  }

  return { ok: Object.keys(errors).length === 0, errors };
}

export function protocolLabel(protocol: RemoteConnectionProtocol): string {
  switch (protocol) {
    case 'sftp':
      return 'SFTP';
    case 'ftp':
      return 'FTP';
    case 'webdav-https':
      return 'WebDAV HTTPS';
    case 'webdav-http':
      return 'WebDAV HTTP';
  }
}
