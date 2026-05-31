import { FormEvent, useMemo, useState } from 'react';
import type { SetStateAction } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { BadgeCheck, FileKey2, Globe2, KeyRound, Loader2, Lock, Server, Trash2, X } from 'lucide-react';
import type { RemoteConnection, RemoteConnectionProtocol } from '../types';
import { getHomeDir } from '../api/filesystem';
import {
  createRemoteConnectionDraftId,
  DEFAULT_REMOTE_PORT,
  normalizeRemoteConnectionDraft,
  protocolLabel,
  validateRemoteConnectionDraft,
  type RemoteConnectionDraft,
} from '../lib/remote-connections';

interface RemoteConnectionDialogProps {
  connection?: RemoteConnection | null;
  onClose: () => void;
  onSave: (input: RemoteConnectionDraft) => Promise<RemoteConnection>;
  onTest: (input: RemoteConnectionDraft) => Promise<void>;
  onDelete?: (connectionId: string) => Promise<void>;
}

const PRIMARY_PROTOCOLS: RemoteConnectionProtocol[] = ['sftp', 'ftp', 'webdav-https', 'webdav-http'];
const SSH_DIRECTORY_NAME = '.ssh';
const REMOTE_TEST_UI_TIMEOUT_MS = 5000;
const REMOTE_TEST_TIMEOUT_MESSAGE = '远程连接测试超时（5 秒）。请检查服务器地址、端口、账号凭据和网络。';
const TEXT_INPUT_CLASS = 'w-full h-10 rounded-lg border border-custom px-3 text-[13px] text-on-surface normal-case outline-none focus:border-primary';
const REMOTE_TEXT_INPUT_PROPS = {
  autoCapitalize: 'none',
  autoCorrect: 'off',
  spellCheck: false,
} as const;

const FUTURE_PROTOCOLS = [
  'SMB',
  'AFP',
  'NFS',
  'OneDrive',
  'Google Drive',
  '百度网盘',
];

function draftFromConnection(connection?: RemoteConnection | null): RemoteConnectionDraft {
  const protocol = connection?.protocol || 'sftp';
  return {
    id: connection?.id || createRemoteConnectionDraftId(),
    protocol,
    name: connection?.name || '',
    host: connection?.host || '',
    port: connection?.port || DEFAULT_REMOTE_PORT[protocol],
    username: connection?.username || '',
    basePath: connection?.basePath || '/',
    authMethod: connection?.authMethod || 'password',
    password: '',
    privateKeyPath: connection?.privateKeyPath || '',
    privateKeyPassphrase: '',
  };
}

export default function RemoteConnectionDialog({ connection, onClose, onSave, onTest, onDelete }: RemoteConnectionDialogProps) {
  const [draft, setDraft] = useState<RemoteConnectionDraft>(() => draftFromConnection(connection));
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState('');
  const [testStatus, setTestStatus] = useState<{ kind: 'idle' | 'testing' | 'ok' | 'error'; message: string }>({ kind: 'idle', message: '' });
  const validation = useMemo(() => validateRemoteConnectionDraft(draft), [draft]);
  const editing = Boolean(connection);

  const setDraftAndResetStatus = (updater: SetStateAction<RemoteConnectionDraft>) => {
    setTestStatus({ kind: 'idle', message: '' });
    setDraft(updater);
  };

  const setProtocol = (protocol: RemoteConnectionProtocol) => {
    setDraftAndResetStatus(prev => ({
      ...prev,
      protocol,
      port: DEFAULT_REMOTE_PORT[protocol],
      name: prev.name || protocolLabel(protocol),
      authMethod: protocol === 'sftp' ? prev.authMethod || 'password' : 'password',
      privateKeyPath: protocol === 'sftp' ? prev.privateKeyPath : '',
      privateKeyPassphrase: protocol === 'sftp' ? prev.privateKeyPassphrase : '',
    }));
  };

  const pickPrivateKeyFile = async () => {
    let defaultPath = `~/${SSH_DIRECTORY_NAME}`;
    try {
      const homeDir = await getHomeDir();
      defaultPath = `${homeDir}/${SSH_DIRECTORY_NAME}`;
    } catch {
      // Browser preview cannot resolve the Tauri home directory; keep the macOS-friendly fallback.
    }
    const selected = await open({
      multiple: false,
      directory: false,
      defaultPath,
    });
    if (selected && typeof selected === 'string') {
      setDraftAndResetStatus(prev => ({ ...prev, privateKeyPath: selected }));
    }
  };

  const testConnection = async () => {
    setError('');
    const result = validateRemoteConnectionDraft(draft);
    if (!result.ok) {
      setTestStatus({ kind: 'error', message: Object.values(result.errors)[0] || '连接配置不完整' });
      return;
    }
    setTesting(true);
    setTestStatus({ kind: 'testing', message: '正在测试连接...' });
    let timedOut = false;
    const timeoutId = window.setTimeout(() => {
      timedOut = true;
      setTestStatus({ kind: 'error', message: REMOTE_TEST_TIMEOUT_MESSAGE });
      setTesting(false);
    }, REMOTE_TEST_UI_TIMEOUT_MS);
    try {
      await onTest(normalizeRemoteConnectionDraft(draft));
      if (timedOut) return;
      setTestStatus({ kind: 'ok', message: '连接成功' });
    } catch (err) {
      if (timedOut) return;
      setTestStatus({ kind: 'error', message: err instanceof Error ? err.message : '测试连接失败' });
    } finally {
      window.clearTimeout(timeoutId);
      if (!timedOut) setTesting(false);
    }
  };

  const deleteConnection = async () => {
    if (!connection?.id || !onDelete || deleting) return;
    const confirmed = window.confirm(`确定要删除远程连接“${connection.name}”吗？`);
    if (!confirmed) return;
    setError('');
    setDeleting(true);
    try {
      await onDelete(connection.id);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : '删除远程连接失败');
    } finally {
      setDeleting(false);
    }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    const result = validateRemoteConnectionDraft(draft);
    if (!result.ok) return;
    setSaving(true);
    try {
      await onSave(normalizeRemoteConnectionDraft(draft));
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存远程连接失败');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[150] flex items-center justify-center bg-black/35 backdrop-blur-sm" role="dialog" aria-modal="true">
      <form onSubmit={submit} className="w-[520px] max-w-[calc(100vw-32px)] rounded-2xl border border-custom bg-surface/95 shadow-2xl shadow-custom p-5 space-y-5">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-primary/12 text-primary flex items-center justify-center shrink-0">
              <Globe2 className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <h2 className="text-[16px] font-black text-on-surface leading-tight">{editing ? '编辑远程访问' : '远程访问'}</h2>
              <p className="text-[11px] text-on-surface/45 mt-0.5 truncate">{editing ? '修改连接配置或重新测试连接' : '添加 SFTP、FTP 或 WebDAV 连接'}</p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="p-2 rounded-lg text-on-surface/45 hover:text-on-surface hover:bg-hover-custom" aria-label="关闭">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="grid grid-cols-2 gap-2">
          {PRIMARY_PROTOCOLS.map(protocol => {
            const active = draft.protocol === protocol;
            return (
              <button
                key={protocol}
                type="button"
                onClick={() => setProtocol(protocol)}
                className={`h-11 rounded-lg border px-3 text-left transition-colors flex items-center gap-2 ${active ? 'border-primary bg-primary text-on-primary' : 'border-custom bg-panel-custom text-on-surface/75 hover:bg-hover-custom'}`}
              >
                <Globe2 className="w-4 h-4 shrink-0" />
                <span className="text-[13px] font-black truncate">{protocolLabel(protocol)}</span>
              </button>
            );
          })}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <label className="space-y-1.5">
            <span className="text-[11px] font-black text-on-surface/45 uppercase">名称</span>
            <input
              {...REMOTE_TEXT_INPUT_PROPS}
              value={draft.name}
              onChange={event => setDraftAndResetStatus(prev => ({ ...prev, name: event.target.value }))}
              className={`${TEXT_INPUT_CLASS} bg-panel-custom`}
              placeholder="工作服务器"
            />
          </label>
          <label className="space-y-1.5">
            <span className="text-[11px] font-black text-on-surface/45 uppercase">服务器</span>
            <input
              {...REMOTE_TEXT_INPUT_PROPS}
              value={draft.host}
              onChange={event => setDraftAndResetStatus(prev => ({ ...prev, host: event.target.value }))}
              className={`${TEXT_INPUT_CLASS} bg-panel-custom`}
              placeholder="example.com"
            />
          </label>
          <label className="space-y-1.5">
            <span className="text-[11px] font-black text-on-surface/45 uppercase">端口</span>
            <input
              type="number"
              autoCorrect="off"
              spellCheck={false}
              min={1}
              max={65535}
              value={draft.port || ''}
              onChange={event => setDraftAndResetStatus(prev => ({ ...prev, port: Number(event.target.value) }))}
              className={`${TEXT_INPUT_CLASS} bg-panel-custom`}
            />
          </label>
          <label className="space-y-1.5">
            <span className="text-[11px] font-black text-on-surface/45 uppercase">起始路径</span>
            <input
              {...REMOTE_TEXT_INPUT_PROPS}
              value={draft.basePath || ''}
              onChange={event => setDraftAndResetStatus(prev => ({ ...prev, basePath: event.target.value }))}
              className={`${TEXT_INPUT_CLASS} bg-panel-custom`}
              placeholder="/"
            />
          </label>
          <label className="space-y-1.5">
            <span className="text-[11px] font-black text-on-surface/45 uppercase">用户名</span>
            <input
              {...REMOTE_TEXT_INPUT_PROPS}
              value={draft.username || ''}
              onChange={event => setDraftAndResetStatus(prev => ({ ...prev, username: event.target.value }))}
              className={`${TEXT_INPUT_CLASS} bg-panel-custom`}
              placeholder={draft.protocol === 'ftp' ? 'anonymous' : 'user'}
            />
          </label>
        </div>

        {draft.protocol === 'sftp' && (
          <div className="space-y-3 rounded-lg border border-custom bg-panel-custom p-3">
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setDraftAndResetStatus(prev => ({ ...prev, authMethod: 'password', privateKeyPassphrase: '' }))}
                className={`h-10 rounded-lg border px-3 text-left transition-colors flex items-center gap-2 ${draft.authMethod !== 'private-key' ? 'border-primary bg-primary text-on-primary' : 'border-custom bg-surface/70 text-on-surface/65 hover:bg-hover-custom'}`}
              >
                <KeyRound className="w-4 h-4 shrink-0" />
                <span className="text-[12px] font-black truncate">密码登录</span>
              </button>
              <button
                type="button"
                onClick={() => setDraftAndResetStatus(prev => ({ ...prev, authMethod: 'private-key', password: '' }))}
                className={`h-10 rounded-lg border px-3 text-left transition-colors flex items-center gap-2 ${draft.authMethod === 'private-key' ? 'border-primary bg-primary text-on-primary' : 'border-custom bg-surface/70 text-on-surface/65 hover:bg-hover-custom'}`}
              >
                <FileKey2 className="w-4 h-4 shrink-0" />
                <span className="text-[12px] font-black truncate">使用密钥文件</span>
              </button>
            </div>

            {draft.authMethod === 'private-key' ? (
              <div className="grid grid-cols-[1fr_auto] gap-2">
                <label className="space-y-1.5 min-w-0">
                  <span className="text-[11px] font-black text-on-surface/45 uppercase">私钥文件</span>
                  <input
                    {...REMOTE_TEXT_INPUT_PROPS}
                    value={draft.privateKeyPath || ''}
                    onChange={event => setDraftAndResetStatus(prev => ({ ...prev, privateKeyPath: event.target.value }))}
                    className={`${TEXT_INPUT_CLASS} bg-surface/80`}
                    placeholder="~/.ssh/id_ed25519"
                  />
                </label>
                <button
                  type="button"
                  onClick={pickPrivateKeyFile}
                  className="self-end h-10 px-3 rounded-lg border border-custom bg-surface/80 text-[12px] font-black text-on-surface/70 hover:bg-hover-custom"
                >
                  浏览
                </button>
                <label className="space-y-1.5 col-span-2">
                  <span className="text-[11px] font-black text-on-surface/45 uppercase">口令</span>
                  <input
                    type="password"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    value={draft.privateKeyPassphrase || ''}
                    onChange={event => setDraftAndResetStatus(prev => ({ ...prev, privateKeyPassphrase: event.target.value }))}
                    className={`${TEXT_INPUT_CLASS} bg-surface/80`}
                    placeholder={connection?.hasPrivateKeyPassphrase ? '留空则保留已保存口令' : '私钥无口令可留空'}
                  />
                </label>
              </div>
            ) : (
              <label className="space-y-1.5 block">
                <span className="text-[11px] font-black text-on-surface/45 uppercase">密码</span>
                <input
                  type="password"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  value={draft.password || ''}
                  onChange={event => setDraftAndResetStatus(prev => ({ ...prev, password: event.target.value }))}
                  className={`${TEXT_INPUT_CLASS} bg-surface/80`}
                  placeholder={connection?.hasPassword ? '留空则保留已保存密码' : '保存到 Keychain'}
                />
              </label>
            )}
          </div>
        )}

        {draft.protocol !== 'sftp' && (
          <label className="space-y-1.5 block">
            <span className="text-[11px] font-black text-on-surface/45 uppercase">密码</span>
            <input
              type="password"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              value={draft.password || ''}
              onChange={event => setDraftAndResetStatus(prev => ({ ...prev, password: event.target.value }))}
              className={`${TEXT_INPUT_CLASS} bg-panel-custom`}
              placeholder={connection?.hasPassword ? '留空则保留已保存密码' : '保存到 Keychain'}
            />
          </label>
        )}

        <div className="rounded-lg border border-custom bg-panel-custom p-3">
          <div className="flex items-center gap-2 text-[12px] font-bold text-on-surface/65">
            <Lock className="w-4 h-4 text-primary" />
            密码和私钥口令只保存到 macOS Keychain，不进入配置导出。
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {FUTURE_PROTOCOLS.map(name => (
              <span key={name} className="px-2 py-1 rounded-md bg-on-surface/[0.04] text-[10px] font-bold text-on-surface/35">
                {name} 后续支持
              </span>
            ))}
          </div>
        </div>

        {(error || !validation.ok || testStatus.kind !== 'idle') && (
          <div className={`rounded-lg border px-3 py-2 text-[12px] font-bold ${
            error || testStatus.kind === 'error' || !validation.ok
              ? 'border-red-500/20 bg-red-500/10 text-red-500'
              : 'border-primary/20 bg-primary/10 text-primary'
          }`}>
            {error || testStatus.message || Object.values(validation.errors)[0]}
          </div>
        )}

        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={testConnection}
            disabled={saving || testing || deleting || !validation.ok}
            className="h-10 px-4 rounded-lg border border-custom bg-panel-custom text-[13px] font-black text-on-surface/70 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 hover:bg-hover-custom"
          >
            {testing ? <Loader2 className="w-4 h-4 animate-spin" /> : testStatus.kind === 'ok' ? <BadgeCheck className="w-4 h-4 text-primary" /> : <Server className="w-4 h-4" />}
            {testing ? '测试中...' : '测试连接'}
          </button>
          <div className="flex items-center justify-end gap-2">
            {editing && onDelete && connection?.id && (
              <button
                type="button"
                onClick={() => { void deleteConnection(); }}
                disabled={saving || testing || deleting}
                className="h-10 px-4 rounded-lg border border-red-500/20 bg-red-500/10 text-[13px] font-black text-red-500 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 hover:bg-red-500/15"
              >
                {deleting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                {deleting ? '删除中...' : '删除连接'}
              </button>
            )}
            <button type="button" onClick={onClose} disabled={deleting} className="h-10 px-4 rounded-lg text-[13px] font-black text-on-surface/55 hover:bg-hover-custom disabled:opacity-50 disabled:cursor-not-allowed">
              取消
            </button>
            <button
              type="submit"
              disabled={saving || testing || deleting || !validation.ok}
              className="h-10 px-4 rounded-lg bg-primary text-on-primary text-[13px] font-black disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              <Server className="w-4 h-4" />
              {saving ? '保存中...' : editing ? '保存更改' : '保存并添加'}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
