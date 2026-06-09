import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const readSource = (relativePath: string) => readFileSync(path.join(process.cwd(), relativePath), 'utf-8');

describe('macOS permission UX wiring', () => {
  const settingsPermissionsSource = readSource('src/components/settings/useSettingsPermissions.ts');
  const permissionsPanelSource = readSource('src/components/settings/PermissionsDiagnosticsSettings.tsx');
  const startupPermissionPromptPath = 'src/components/StartupPermissionPrompt.tsx';
  const startupPermissionPromptSource = existsSync(path.join(process.cwd(), startupPermissionPromptPath))
    ? readSource(startupPermissionPromptPath)
    : '';
  const appIdentitySource = readSource('src/lib/app-identity.ts');
  const fullDiskAccessCoordinatorSource = readSource('src/lib/full-disk-access.ts');
  const fullDiskAccessEvidencePath = 'src/lib/full-disk-access-evidence.ts';
  const fullDiskAccessEvidenceSource = existsSync(path.join(process.cwd(), fullDiskAccessEvidencePath))
    ? readSource(fullDiskAccessEvidencePath)
    : '';
  const appSource = readSource('src/App.tsx');
  const smokeSource = readSource('src/lib/smoke.ts');
  const explorerViewSource = readSource('src/components/ExplorerView.tsx');
  const explorerDirectoryDataSource = readSource('src/components/explorer/useExplorerDirectoryData.ts');
  const explorerInspectorSource = readSource('src/components/explorer/useExplorerInspector.ts');
  const operationPermissionErrorSource = readSource('src/lib/operation-permission-error.ts');
  const explorerShellSource = readSource('src/components/explorer/ExplorerShell.tsx');
  const explorerConstantsSource = readSource('src/components/explorer/explorer-constants.ts');
  const explorerUtilsSource = readSource('src/components/explorer/explorer-utils.ts');
  const i18nCoverageSource = readSource('scripts/check-i18n-coverage.mjs');
  const englishLocaleSource = readSource('src/i18n/locales/en.ts');
  const chineseLocaleSource = readSource('src/i18n/locales/zh.ts');
  const tauriLibSource = readSource('src-tauri/src/lib.rs');
  const diagnosticsSource = readSource('src-tauri/src/commands/diagnostics.rs');
  const entitlementsSource = readSource('src-tauri/Entitlements.plist');
  const infoPlistSource = readSource('src-tauri/Info.plist');

  it('checks one Full Disk Access status instead of probing protected folders individually', () => {
    expect(fullDiskAccessCoordinatorSource).toContain('full_disk_access_status');
    expect(fullDiskAccessCoordinatorSource).not.toContain('list_directory');
    expect(fullDiskAccessCoordinatorSource).not.toContain('/Documents');
    expect(fullDiskAccessCoordinatorSource).not.toContain('/Desktop');
    expect(fullDiskAccessCoordinatorSource).not.toContain('/Downloads');
    expect(fullDiskAccessCoordinatorSource).not.toContain('/.Trash');
    expect(fullDiskAccessCoordinatorSource).not.toContain('/Applications');
  });

  it('routes startup permission setup through the FDA registration command without a skip button', () => {
    expect(fullDiskAccessCoordinatorSource).toContain('register_full_disk_access');
    expect(appSource).toContain('checkFullDiskAccessPermissions({ force: true, registration: true })');
    expect(appSource).toContain('Full Disk Access startup probe failed');
    expect(appSource).not.toContain('preflight_file_permissions');
    expect(tauriLibSource).not.toContain('preflight_file_permissions');
    expect(appSource).not.toContain("t('appPermissions.later')");
  });

  it('skips the blocking startup FDA prompt only in development runtime', () => {
    expect(appSource).toContain('const isDevelopmentRuntime = import.meta.env.DEV === true;');
    expect(appSource).toContain('if (isDevelopmentRuntime || !isTauriRuntime()) return;');
    expect(appSource).toContain('if (!isTauriRuntime() || isDevelopmentRuntime || !startupPermissionPromptOpen) return undefined;');
    expect(fullDiskAccessCoordinatorSource).not.toContain('import.meta.env.DEV');
    expect(tauriLibSource).toContain('commands::fs::full_disk_access_status');
    expect(tauriLibSource).toContain('commands::fs::register_full_disk_access');
  });

  it('does not expose denied-state bypass copy or actions', () => {
    for (const source of [
      appSource,
      startupPermissionPromptSource,
      permissionsPanelSource,
      explorerShellSource,
      explorerDirectoryDataSource,
      englishLocaleSource,
      chineseLocaleSource,
    ]) {
      expect(source).not.toContain('Scan Anyway');
      expect(source).not.toContain('scanAnyway');
      expect(source).not.toContain('Remind Me Later');
      expect(source).not.toContain('remindMeLater');
      expect(source).not.toContain('Open Anyway');
      expect(source).not.toContain('openAnyway');
      expect(source).not.toContain('continueDespiteDenied');
      expect(source).not.toContain('ignorePermissionDenied');
    }
  });

  it('shows the exact app identity in the startup Full Disk Access setup', () => {
    expect(appSource).toContain('useAppIdentity');
    expect(appIdentitySource).toContain('inFlightAppIdentity');
    expect(appIdentitySource).toContain('useSyncExternalStore');
    expect(startupPermissionPromptSource).toContain('appPermissions.bundleIdentifier');
    expect(startupPermissionPromptSource).toContain('appPermissions.appPath');
    expect(startupPermissionPromptSource).toContain('appPermissions.stableInstallHint');
    expect(appSource).toContain('reveal_app_in_finder');
    expect(startupPermissionPromptSource).toContain('appPermissions.revealAppInFinder');
    expect(startupPermissionPromptSource).toContain('appPermissions.openSettingsFailed');
    expect(appSource).toContain('setStartupOpenSettingsError(normalizeAppError(err).userMessage)');
    expect(settingsPermissionsSource).toContain('useAppIdentity');
  });

  it('keeps startup Full Disk Access setup in an owned component', () => {
    expect(existsSync(path.join(process.cwd(), startupPermissionPromptPath))).toBe(true);
    expect(appSource).toContain("import StartupPermissionPrompt from './components/StartupPermissionPrompt'");
    expect(appSource).toContain('<StartupPermissionPrompt');
    expect(startupPermissionPromptSource).toContain('onOpenSystemSettings');
    expect(startupPermissionPromptSource).toContain('onRevealApp');
    expect(startupPermissionPromptSource).toContain('onCheckAuthorization');
    expect(startupPermissionPromptSource).toContain('liquidGlassEnabled');
  });

  it('shares one frontend FDA coordinator between startup and settings', () => {
    expect(fullDiskAccessCoordinatorSource).toContain('inFlightCheck');
    expect(fullDiskAccessCoordinatorSource).toContain('FULL_DISK_ACCESS_CHECK_CACHE_TTL_MS');
    expect(fullDiskAccessCoordinatorSource).toContain('startFullDiskAccessPolling');
    expect(fullDiskAccessCoordinatorSource).toContain('force?: boolean');
    expect(fullDiskAccessCoordinatorSource).toContain('useSyncExternalStore');
    expect(settingsPermissionsSource).toContain('useFullDiskAccessPermission');
    expect(settingsPermissionsSource).not.toContain('useState<FullDiskAccessStatus');
    expect(settingsPermissionsSource).not.toContain('useState<FullDiskAccessProbeResult');
    expect(appSource).toContain('useFullDiskAccessPermission');
  });

  it('does not use cached startup completion as the authorization source of truth', () => {
    expect(appSource).not.toContain('localStorage.getItem(STARTUP_PERMISSION_PREFLIGHT_STATE_KEY)');
    expect(appSource).toContain('checkFullDiskAccessPermissions({ force: true, registration: true })');
  });

  it('polls FDA status only while the startup permission setup is visible', () => {
    expect(fullDiskAccessCoordinatorSource).toContain('FULL_DISK_ACCESS_POLL_INTERVAL_MS');
    expect(fullDiskAccessCoordinatorSource).toContain('pollingSubscribers');
    expect(fullDiskAccessCoordinatorSource).toContain('window.setInterval');
    expect(fullDiskAccessCoordinatorSource).toContain('window.clearInterval');
    expect(appSource).toContain('startupPermissionPromptOpen');
    expect(appSource).toContain('startFullDiskAccessPolling({');
    expect(appSource).toContain('checkOptions: { force: true }');
    expect(appSource).toContain('onResult: (result)');
    expect(startupPermissionPromptSource).toContain('appPermissions.autoCheckHint');
  });

  it('renders a single recovery surface for Full Disk Access', () => {
    expect(permissionsPanelSource).toContain('permissionStatus');
    expect(permissionsPanelSource).toContain('open_system_settings');
    expect(appIdentitySource).toContain('get_app_identity');
    expect(permissionsPanelSource).toContain('settings.permissions.bundleIdentifier');
    expect(permissionsPanelSource).toContain('settings.permissions.appPath');
    expect(permissionsPanelSource).toContain('settings.permissions.stableInstallHint');
    expect(diagnosticsSource).toContain('Result<AppIdentity, AppError>');
    expect(permissionsPanelSource).toContain('revealAppLoading');
    expect(permissionsPanelSource).not.toContain('permChecks.map');
    expect(permissionsPanelSource).not.toContain('accessStatus');
  });

  it('lets users reveal the exact app target for Full Disk Access recovery', () => {
    expect(permissionsPanelSource).toContain('reveal_app_in_finder');
    expect(permissionsPanelSource).toContain('settings.permissions.revealAppInFinder');
    expect(permissionsPanelSource).toContain('settings.permissions.openSystemSettingsFailed');
    expect(permissionsPanelSource).toContain('setOpenSettingsError(normalizeAppError(err).userMessage)');
    expect(permissionsPanelSource).not.toContain("safeInvoke('open_system_settings').catch(() => {})");
    expect(tauriLibSource).toContain('commands::diagnostics::reveal_app_in_finder');
    expect(tauriLibSource).toContain('commands::diagnostics::get_app_identity');
    expect(diagnosticsSource).toContain('resolve_app_reveal_path');
    expect(diagnosticsSource).toContain('bundle_identifier');
    expect(diagnosticsSource).toContain('app_path');
  });

  it('does not route every permission error into FDA recovery', () => {
    expect(explorerDirectoryDataSource).toContain('checkFullDiskAccessPermission({ force: true })');
    expect(explorerDirectoryDataSource).toContain('directoryErrorKindForFullDiskAccess');
    expect(explorerDirectoryDataSource).toContain('getProtectedRootForPath(appError.path || targetPath)');
    expect(explorerShellSource).toContain("!isRemoteRoot && directoryErrorKind === 'permission'");
  });

  it('removes the legacy protected-path consent gate while keeping retry blocking', () => {
    for (const source of [
      explorerViewSource,
      explorerDirectoryDataSource,
      explorerShellSource,
      explorerConstantsSource,
      explorerUtilsSource,
      i18nCoverageSource,
      englishLocaleSource,
      chineseLocaleSource,
    ]) {
      expect(source).not.toContain('PROTECTED_ROOT_APPROVALS_KEY');
      expect(source).not.toContain('approvedProtectedRoots');
      expect(source).not.toContain('approveProtectedRoot');
      expect(source).not.toContain('needsProtectedPathConsent');
      expect(source).not.toContain('protectedPathTitle');
      expect(source).not.toContain('protectedPathDescription');
      expect(source).not.toContain('continueAccess');
      expect(source).not.toContain('backHome');
    }
    expect(explorerDirectoryDataSource).toContain('blockedProtectedRoots');
    expect(explorerDirectoryDataSource).toContain('isProtectedPathBlocked');
    expect(explorerDirectoryDataSource).toContain('retryProtectedPath');
    expect(explorerShellSource).toContain("t('dialogs.retry'");
    expect(explorerShellSource).toContain("!isRemoteRoot && directoryErrorKind === 'permission'");
  });

  it('retries the captured protected directory once after FDA recovery', () => {
    expect(explorerDirectoryDataSource).toContain('startFullDiskAccessPolling({');
    expect(explorerDirectoryDataSource).toContain('FULL_DISK_ACCESS_POLL_INTERVAL_MS');
    expect(explorerDirectoryDataSource).toContain('pendingFullDiskAccessRetryPathRef');
    expect(explorerDirectoryDataSource).toContain('fullDiskAccessRetryInFlightRef');
    expect(explorerDirectoryDataSource).toContain('autoRetryingProtectedPathRef');
    expect(explorerDirectoryDataSource).toContain("resultStatus !== 'granted'");
    expect(explorerDirectoryDataSource).toContain('const retryProtectedRoot = getProtectedRootForPath(retryPath)');
    expect(explorerDirectoryDataSource).toContain('setBlockedProtectedRoots(prev => prev.filter(path => path !== retryProtectedRoot.path))');
    expect(explorerDirectoryDataSource).not.toContain('await refreshCurrentDir(false, retryPath)');
  });

  it('forces a fresh FDA check before manual protected directory retry', () => {
    expect(explorerDirectoryDataSource).toContain('const retryPathBlocked = retryProtectedRoot');
    expect(explorerDirectoryDataSource).toContain('checkFullDiskAccessPermission({ force: true }).then(result =>');
    expect(explorerDirectoryDataSource).toContain("if (result.status !== 'granted' || currentPathRef.current !== retryPath) return;");
    expect(explorerDirectoryDataSource).toContain('setBlockedProtectedRoots(prev => prev.filter(path => path !== retryProtectedRoot.path))');
  });

  it('localizes protected directory retry blocked copy', () => {
    expect(explorerDirectoryDataSource).toContain("t('dialogs.permissionRetryBlockedDetail'");
    expect(explorerDirectoryDataSource).not.toContain('当前会话中已拦截重复权限请求');
    expect(englishLocaleSource).toContain('permissionRetryBlockedDetail');
    expect(chineseLocaleSource).toContain('permissionRetryBlockedDetail');
    expect(i18nCoverageSource).toContain('permissionRetryBlockedDetail');
    expect(i18nCoverageSource).toContain("t('dialogs.permissionRetryBlockedDetail'");
  });

  it('uses actionable localized Explorer FDA recovery copy', () => {
    expect(englishLocaleSource).toContain('stable app identity');
    expect(englishLocaleSource).toContain('Reveal Aether in Finder');
    expect(englishLocaleSource).toContain('confirm the exact app target');
    expect(englishLocaleSource).toContain('Aether Explorer');
    expect(chineseLocaleSource).toContain('稳定 app 身份');
    expect(chineseLocaleSource).toContain('在 Finder 中显示 Aether');
    expect(chineseLocaleSource).toContain('Aether Explorer');
    expect(explorerShellSource).not.toContain('无权访问此目录');
    expect(explorerShellSource).not.toContain('此目录被 macOS 隐私策略保护');
    expect(explorerShellSource).toContain('This location is protected by macOS privacy');
    expect(explorerShellSource).toContain("t('dialogs.openSystemSettingsFailed'");
    expect(explorerShellSource).toContain('setOpenSettingsError(normalizeAppError(err).userMessage)');
    expect(explorerShellSource).not.toContain("safeInvoke('open_system_settings').catch(() => {})");
  });

  it('keeps shared FDA recovery fallbacks locale-neutral', () => {
    expect(operationPermissionErrorSource).toContain("t('messages.fullDiskAccessOperationRequired'");
    expect(explorerInspectorSource).toContain("t('explorer.sizePermissionRequired'");
    expect(operationPermissionErrorSource).not.toContain('需要开启完全磁盘访问权限后才能操作');
    expect(explorerInspectorSource).not.toContain('需要开启完全磁盘访问权限后才能统计');
    expect(i18nCoverageSource).toContain('requiredPermissionRecoveryUsages');
    expect(i18nCoverageSource).toContain("t('messages.fullDiskAccessOperationRequired'");
    expect(i18nCoverageSource).toContain("t('explorer.sizePermissionRequired'");
  });

  it('routes protected folder size scan failures through the shared FDA coordinator', () => {
    expect(explorerInspectorSource).toContain('checkFullDiskAccessPermission({ force: true })');
    expect(explorerInspectorSource).toContain('getProtectedRootForPath');
    expect(explorerInspectorSource).toContain('sizePermissionRequired');
    expect(explorerInspectorSource).toContain("snapshot.status === 'failed'");
    expect(explorerInspectorSource).toContain('resolveDirectorySizeErrorMessage');
  });

  it('forces user-driven FDA recovery probes instead of serving the short cache', () => {
    expect(appSource).toContain('checkFullDiskAccessPermissions({ force: true, registration: true })');
    expect(permissionsPanelSource).toContain('checkPermissions({ force: true })');
    expect(readSource('src/lib/operation-permission-error.ts')).toContain('checkFullDiskAccessPermission({ force: true })');
  });

  it('keeps the dev smoke script wired to the FDA command path', () => {
    expect(smokeSource).toContain('full_disk_access_status returns status/probes');
    expect(smokeSource).toContain('full_disk_access_status');
    expect(smokeSource).toContain('permissionEvidence');
    expect(fullDiskAccessEvidenceSource).toContain('get_app_identity');
    expect(smokeSource).toContain('validateFullDiskAccessAcceptanceEvidence');
  });

  it('keeps FDA acceptance evidence available outside the dev-only smoke runner', () => {
    expect(existsSync(path.join(process.cwd(), fullDiskAccessEvidencePath))).toBe(true);
    expect(smokeSource).toContain("from './full-disk-access-evidence'");
    expect(smokeSource).toContain('function setupAetherPermissionEvidence()');
    expect(smokeSource).toContain('setupAetherPermissionEvidence();');
    expect(smokeSource).toContain('if (!import.meta.env.DEV) return;');
    expect(smokeSource.indexOf('setupAetherPermissionEvidence();')).toBeGreaterThan(
      smokeSource.indexOf('setupAetherSmokeDevtools();'),
    );
    expect(fullDiskAccessEvidenceSource).toContain('collectFullDiskAccessAcceptanceEvidence');
    expect(fullDiskAccessEvidenceSource).toContain('validateFullDiskAccessAcceptanceEvidence');
    expect(fullDiskAccessEvidenceSource).toContain('full_disk_access_status');
    expect(fullDiskAccessEvidenceSource).toContain('get_app_identity');
  });

  it('lets Settings copy Full Disk Access acceptance evidence without DevTools', () => {
    expect(permissionsPanelSource).toContain("from '../../lib/full-disk-access-evidence'");
    expect(permissionsPanelSource).toContain('collectFullDiskAccessAcceptanceEvidence');
    expect(permissionsPanelSource).toContain('navigator.clipboard.writeText');
    expect(permissionsPanelSource).toContain('disabled={!granted || copyEvidenceLoading}');
    expect(permissionsPanelSource).toContain('settings.permissions.copyEvidence');
    expect(permissionsPanelSource).toContain('settings.permissions.copyEvidenceCopied');
    expect(permissionsPanelSource).toContain('settings.permissions.copyEvidenceFailed');
    expect(permissionsPanelSource).toContain('settings.permissions.copyEvidenceRequiresGranted');
    expect(fullDiskAccessEvidenceSource).toContain("result.status === 'granted'");
    expect(fullDiskAccessEvidenceSource).toContain('result.probes.length > 0');
    expect(fullDiskAccessEvidenceSource).toContain('readable === true');
  });

  it('does not declare extra macOS privacy domains before the v1 core path supports them', () => {
    expect(entitlementsSource).toContain('com.apple.security.app-sandbox');
    expect(entitlementsSource).toContain('<false/>');
    expect(entitlementsSource).not.toContain('com.apple.security.files.user-selected.read-write');
    expect(entitlementsSource).not.toContain('com.apple.security.files.downloads.read-write');
    expect(entitlementsSource).not.toContain('com.apple.security.files.bookmarks.app-scope');
    expect(entitlementsSource).not.toContain('com.apple.security.automation.apple-events');
    expect(infoPlistSource).toContain('NSDesktopFolderUsageDescription');
    expect(infoPlistSource).toContain('NSDocumentsFolderUsageDescription');
    expect(infoPlistSource).toContain('NSDownloadsFolderUsageDescription');
    expect(infoPlistSource).not.toContain('NSRemovableVolumesUsageDescription');
    expect(infoPlistSource).not.toContain('NSFileProviderDomainUsageDescription');
    expect(infoPlistSource).not.toContain('NSAppleEventsUsageDescription');
  });
});
