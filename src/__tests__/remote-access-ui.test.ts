import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const readSource = (relativePath: string) => readFileSync(path.join(process.cwd(), relativePath), 'utf-8');

const appSource = readSource('src/App.tsx');
const sidebarSource = readSource('src/components/Sidebar.tsx');
const remoteDialogSource = readSource('src/components/RemoteConnectionDialog.tsx');
const explorerSource = readSource('src/components/ExplorerView.tsx');
const explorerShellSource = readSource('src/components/explorer/ExplorerShell.tsx');
const explorerDirectoryDataSource = readSource('src/components/explorer/useExplorerDirectoryData.ts');
const explorerKeyboardSource = readSource('src/components/explorer/useExplorerKeyboard.ts');
const explorerSelectionSource = readSource('src/components/explorer/useExplorerSelection.ts');
const explorerStateSource = readSource('src/components/explorer/useExplorerState.ts');
const explorerConstantsSource = readSource('src/components/explorer/explorer-constants.ts');
const filesystemSource = readSource('src/api/filesystem.ts');

describe('remote access UI wiring', () => {
  it('loads the add-connection dialog synchronously so clicks cannot disappear behind an empty lazy fallback', () => {
    expect(appSource).toContain("import RemoteConnectionDialog from './components/RemoteConnectionDialog';");
    expect(appSource).not.toContain("lazy(() => import('./components/RemoteConnectionDialog'))");
    expect(appSource).not.toContain('{remoteDialogOpen && (\n          <Suspense fallback={null}>');
  });

  it('routes add buttons through a concrete button click handler', () => {
    expect(sidebarSource).toContain('const handleAddRemoteConnection = (event: MouseEvent<HTMLButtonElement>) => {');
    expect(sidebarSource).toContain('event.preventDefault();');
    expect(sidebarSource).toContain('event.stopPropagation();');
    expect(sidebarSource).toContain('onClick={handleAddRemoteConnection}');
    expect(sidebarSource).toContain('type="button"');
  });

  it('keeps the remote dialog above local explorer overlays', () => {
    expect(remoteDialogSource).toContain('z-[150]');
  });

  it('exposes SFTP private-key controls in the add-connection dialog', () => {
    expect(remoteDialogSource).toContain("authMethod: 'password'");
    expect(remoteDialogSource).toContain("authMethod: 'private-key'");
    expect(remoteDialogSource).toContain('const selected = await open({');
    expect(remoteDialogSource).toContain('multiple: false');
    expect(remoteDialogSource).toContain('directory: false');
    expect(remoteDialogSource).toContain('defaultPath');
    expect(remoteDialogSource).toContain("'.ssh'");
    expect(remoteDialogSource).toContain('私钥文件');
    expect(remoteDialogSource).toContain('口令');
  });

  it('does not auto-capitalize or visually uppercase remote connection input values', () => {
    expect(remoteDialogSource).toContain('REMOTE_TEXT_INPUT_PROPS');
    expect(remoteDialogSource).toContain("autoCapitalize: 'none'");
    expect(remoteDialogSource).toContain("autoCorrect: 'off'");
    expect(remoteDialogSource).toContain('spellCheck: false');
    expect(remoteDialogSource).toContain('normal-case');
  });

  it('lets saved remote connections be edited from the sidebar', () => {
    expect(sidebarSource).toContain('onEditRemoteConnection?: (connection: RemoteConnection) => void;');
    expect(sidebarSource).toContain('handleEditRemoteConnection');
    expect(sidebarSource).toContain('编辑');
    expect(appSource).toContain('editingRemoteConnection');
    expect(appSource).toContain('onEditRemoteConnection={handleEditRemoteConnection}');
    expect(appSource).toContain('connection={editingRemoteConnection}');
  });

  it('lets saved remote connections be deleted from the edit dialog', () => {
    expect(filesystemSource).toContain('delete_remote_connection');
    expect(remoteDialogSource).toContain('onDelete');
    expect(remoteDialogSource).toContain('删除连接');
    expect(appSource).toContain('handleDeleteRemoteConnection');
    expect(appSource).toContain('onDelete={handleDeleteRemoteConnection}');
  });

  it('supports testing a remote connection before saving', () => {
    expect(filesystemSource).toContain('test_remote_connection_input');
    expect(remoteDialogSource).toContain('createRemoteConnectionDraftId');
    expect(remoteDialogSource).toContain('id: connection?.id || createRemoteConnectionDraftId()');
    expect(remoteDialogSource).toContain('onTest');
    expect(remoteDialogSource).toContain('测试连接');
    expect(remoteDialogSource).toContain('测试中...');
    expect(remoteDialogSource).toContain('连接成功');
  });

  it('shows explicit remote loading and error feedback', () => {
    expect(explorerSource).toContain("loadingRemoteConnectionName");
    expect(explorerSource).toContain("remoteConnectionDisplayName");
    expect(explorerSource).toContain("showBlockingLoading");
    expect(explorerShellSource).toContain("正在连接远程服务器");
    expect(explorerShellSource).toContain("远程目录加载失败");
    expect(explorerDirectoryDataSource).toContain("setLoading(false);");
  });

  it('does not leave remote directory browsing in an infinite loading state', () => {
    expect(filesystemSource).toContain('REMOTE_REQUEST_TIMEOUT_MS');
    expect(filesystemSource).toContain('Promise.race');
    expect(filesystemSource).toContain('远程目录加载超时');
    expect(filesystemSource).toContain('远程连接测试超时');
    expect(explorerSource).toContain('useMemo(() => parseRemotePath(currentPath), [currentPath])');
    expect(explorerSource).not.toContain('const remotePathParts = parseRemotePath(currentPath);');
    expect(explorerStateSource).toContain('const hasDisplayableFiles = displayedFiles.length > 0;');
    expect(explorerStateSource).toContain('const showBlockingLoading = loading && (!isRemoteRoot || !hasDisplayableFiles);');
    expect(explorerConstantsSource).toContain('REMOTE_DIRECTORY_UI_TIMEOUT_MS = 5000');
    expect(explorerConstantsSource).toContain('REMOTE_DIRECTORY_TIMEOUT_MESSAGE');
    expect(explorerDirectoryDataSource).toContain('timedOut = true');
    expect(explorerDirectoryDataSource).toContain('if (timedOut || cancelled || requestId !== loadRequestSeqRef.current) return;');
  });

  it('does not leave the remote connection test button spinning forever', () => {
    expect(remoteDialogSource).toContain('REMOTE_TEST_UI_TIMEOUT_MS = 5000');
    expect(remoteDialogSource).toContain('REMOTE_TEST_TIMEOUT_MESSAGE');
    expect(remoteDialogSource).toContain('timedOut = true');
    expect(remoteDialogSource).toContain('if (!timedOut) setTesting(false);');
  });

  it('lets remote folders navigate instead of being trapped in column expansion', () => {
    expect(explorerKeyboardSource).toContain("file.type === 'folder' || file.type === 'remote-unknown'");
    expect(explorerSelectionSource).toContain('if (isRemotePath(file.path)) {\n          navigateToPath(file.path);');
  });

  it('keeps remote backend operations on a strict short timeout budget', () => {
    const remoteBackendSource = readSource('src-tauri/src/remote.rs');
    expect(remoteBackendSource).toContain('REMOTE_OPERATION_TIMEOUT_SECS: u64 = 5');
    expect(remoteBackendSource).toContain('REMOTE_IO_STEP_TIMEOUT_SECS: u64 = 2');
    expect(remoteBackendSource).toContain('REMOTE_CONNECT_ATTEMPT_TIMEOUT_MS: u64 = 500');
    expect(remoteBackendSource).toContain('session.set_timeout(remote_io_step_timeout().as_millis() as u32)');
    expect(remoteBackendSource).toContain('.passive_stream_builder');
  });

  it('tries resolved remote socket addresses inside the operation budget instead of only the first address', () => {
    const remoteBackendSource = readSource('src-tauri/src/remote.rs');
    expect(remoteBackendSource).toContain('fn resolve_remote_socket_addrs(');
    expect(remoteBackendSource).toContain('Vec<SocketAddr>');
    expect(remoteBackendSource).toContain('for addr in addrs');
    expect(remoteBackendSource).toContain('connect_timeout(&addr, remote_connect_attempt_timeout(remaining))');
    expect(remoteBackendSource).not.toContain('addrs.next().ok_or_else');
  });

  it('keeps SFTP browsing hot by caching the initialized SFTP subsystem', () => {
    const remoteBackendSource = readSource('src-tauri/src/remote.rs');
    expect(remoteBackendSource).toContain('use ssh2::{ErrorCode as SshErrorCode, MethodType, Session, Sftp};');
    expect(remoteBackendSource).toContain('sftp: Arc<Sftp>');
    expect(remoteBackendSource).toContain('sftp_credential_signature');
    expect(remoteBackendSource).toContain('fn connect_sftp_client(');
    expect(remoteBackendSource).toContain('let sftp = session.sftp()');
    expect(remoteBackendSource).toContain('list_sftp_directory_with_client');
  });

  it('configures modern SFTP algorithm preferences and explains key exchange failures', () => {
    const remoteBackendSource = readSource('src-tauri/src/remote.rs');
    expect(remoteBackendSource).toContain('SFTP_KEX_PREFS');
    expect(remoteBackendSource).toContain('curve25519-sha256');
    expect(remoteBackendSource).toContain('SFTP_HOSTKEY_PREFS');
    expect(remoteBackendSource).toContain('rsa-sha2-256');
    expect(remoteBackendSource).toContain('SFTP_CIPHER_PREFS');
    expect(remoteBackendSource).toContain('aes128-ctr');
    expect(remoteBackendSource).toContain('SFTP_MAC_PREFS');
    expect(remoteBackendSource).toContain('hmac-sha2-256');
    expect(remoteBackendSource).toContain('apply_sftp_algorithm_preferences(&session)?');
    expect(remoteBackendSource).toContain('SSH 算法协商失败');
    expect(remoteBackendSource).toContain('Unable to exchange encryption keys');
  });

  it('tests SFTP connections without reading the whole remote directory', () => {
    const remoteBackendSource = readSource('src-tauri/src/remote.rs');
    expect(remoteBackendSource).toContain('fn test_sftp_connection(');
    expect(remoteBackendSource).toContain('sftp.stat(Path::new(&base_path))');
    expect(remoteBackendSource).not.toContain('let remote_path = connection.base_path.clone();\n        list_remote_directory_impl(&connection, &remote_path, false, Some(&credential)).map(|_| ())');
  });

  it('avoids per-entry remote directory probes while listing SFTP and FTP folders', () => {
    const remoteBackendSource = readSource('src-tauri/src/remote.rs');
    expect(remoteBackendSource).not.toContain('sftp.opendir(Path::new(&child_path)).is_ok()');
    expect(remoteBackendSource).not.toContain('let is_dir = ftp.cwd(&child_path).is_ok();');
    expect(remoteBackendSource).toContain('ftp.mlsd(None)');
    expect(remoteBackendSource).toContain('remote-unknown');
  });
});
