import { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Copy, ExternalLink, FolderSearch, RefreshCw, Shield } from 'lucide-react';
import type { TFunction } from 'i18next';
import type { AppIdentity } from '../../lib/app-identity';
import { isStableApplicationInstallPath } from '../../lib/app-identity';
import type {
  FullDiskAccessCheckOptions,
  FullDiskAccessCheckResult,
  FullDiskAccessProbeResult,
  FullDiskAccessStatus,
} from './useSettingsPermissions';
import { safeInvoke } from '../../lib/tauri-runtime';
import { normalizeAppError } from '../../lib/app-error';
import { collectFullDiskAccessAcceptanceEvidence } from '../../lib/full-disk-access-evidence';

interface PermissionsDiagnosticsSettingsProps {
  t: TFunction;
  permissionStatus: FullDiskAccessStatus | null;
  probeResults: FullDiskAccessProbeResult[];
  permissionCheckLoaded: boolean;
  permissionCheckLoading: boolean;
  checkPermissions: (options?: FullDiskAccessCheckOptions) => Promise<FullDiskAccessCheckResult>;
  appIdentity: AppIdentity | null;
  appIdentityError: string | null;
}

const statusTone: Record<FullDiskAccessStatus, string> = {
  granted: 'text-green-400 bg-green-400/10 border-green-400/20',
  denied: 'text-red-400 bg-red-400/10 border-red-400/20',
  unknown: 'text-amber-400 bg-amber-400/10 border-amber-400/20',
};

export default function PermissionsDiagnosticsSettings({
  t,
  permissionStatus,
  probeResults,
  permissionCheckLoaded,
  permissionCheckLoading,
  checkPermissions,
  appIdentity,
  appIdentityError,
}: PermissionsDiagnosticsSettingsProps) {
  useEffect(() => {
    if (!permissionCheckLoaded && !permissionCheckLoading) {
      void checkPermissions();
    }
  }, [checkPermissions, permissionCheckLoaded, permissionCheckLoading]);

  const [revealAppError, setRevealAppError] = useState<string | null>(null);
  const [revealAppLoading, setRevealAppLoading] = useState(false);
  const [copyEvidenceLoading, setCopyEvidenceLoading] = useState(false);
  const [copyEvidenceMessage, setCopyEvidenceMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const resolvedStatus = permissionStatus ?? 'unknown';
  const granted = resolvedStatus === 'granted';
  const appPath = appIdentity?.appPath ?? '';
  const stableInstallPath = isStableApplicationInstallPath(appPath);
  const StatusIcon = granted ? CheckCircle2 : AlertTriangle;
  const [openSettingsError, setOpenSettingsError] = useState<string | null>(null);

  const handleOpenSystemSettings = async () => {
    setOpenSettingsError(null);
    try {
      await safeInvoke('open_system_settings');
    } catch (err) {
      setOpenSettingsError(normalizeAppError(err).userMessage);
    }
  };

  const handleRevealAppInFinder = async () => {
    if (revealAppLoading) return;
    setRevealAppError(null);
    setRevealAppLoading(true);
    try {
      await safeInvoke('reveal_app_in_finder');
    } catch (err) {
      setRevealAppError(normalizeAppError(err).userMessage);
    } finally {
      setRevealAppLoading(false);
    }
  };

  const handleCopyPermissionEvidence = async () => {
    if (copyEvidenceLoading) return;
    setCopyEvidenceMessage(null);
    if (!granted) {
      setCopyEvidenceMessage({ kind: 'error', text: t('settings.permissions.copyEvidenceRequiresGranted') });
      return;
    }
    setCopyEvidenceLoading(true);
    try {
      const evidence = await collectFullDiskAccessAcceptanceEvidence();
      await navigator.clipboard.writeText(JSON.stringify(evidence, null, 2));
      setCopyEvidenceMessage({ kind: 'ok', text: t('settings.permissions.copyEvidenceCopied') });
    } catch (err) {
      setCopyEvidenceMessage({
        kind: 'error',
        text: t('settings.permissions.copyEvidenceFailed', { error: normalizeAppError(err).userMessage }),
      });
    } finally {
      setCopyEvidenceLoading(false);
    }
  };

  return (
    <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
      <section className="border border-on-surface/10 bg-surface-container/95 rounded-2xl p-8 shadow-sm space-y-7">
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_300px]">
          <div className="min-w-0 space-y-5">
            <div className="flex items-center gap-4">
              <div className="w-11 h-11 rounded-2xl bg-primary/15 flex items-center justify-center shadow-xl shadow-primary/10">
                <Shield className="w-5 h-5 text-primary" />
              </div>
              <div>
                <h3 className="text-[18px] font-black text-on-surface">{t('settings.permissions.fullDiskTitle')}</h3>
                <p className="text-[13px] text-on-surface/70 mt-1">{t('settings.permissions.fullDiskDescription')}</p>
              </div>
            </div>

            <div className={`inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-[12px] font-black ${statusTone[resolvedStatus]}`}>
              <StatusIcon className="w-4 h-4" />
              {permissionCheckLoading
                ? t('settings.permissions.checking')
                : t(`settings.permissions.status.${resolvedStatus}`)}
            </div>

            <div className="grid gap-3 text-[12px] text-on-surface/70 md:grid-cols-2">
              {appIdentity ? (
                [
                  [t('settings.permissions.appName'), appIdentity.appName],
                  [t('settings.permissions.bundleIdentifier'), appIdentity.bundleIdentifier],
                  [t('settings.permissions.appVersion'), appIdentity.version],
                  [t('settings.permissions.appPath'), appIdentity.appPath],
                ].map(([label, value]) => (
                  <div key={label} className="min-w-0 rounded-xl border border-on-surface/10 bg-on-surface/[0.04] px-4 py-3">
                    <p className="text-[10px] font-black uppercase text-on-surface/35">{label}</p>
                    <p className="mt-1 break-all font-mono text-[11px] leading-relaxed text-on-surface/75" title={value}>
                      {value || '-'}
                    </p>
                  </div>
                ))
              ) : (
                <p className="sm:col-span-3 text-[12px] text-on-surface/45">
                  {appIdentityError
                    ? t('settings.permissions.appIdentityFailed', { error: appIdentityError })
                    : t('settings.permissions.appIdentityLoading')}
                </p>
              )}
            </div>

            {appIdentity && appPath && !stableInstallPath && (
              <p className="rounded-xl border border-amber-400/20 bg-amber-400/[0.08] px-3 py-2 text-[12px] leading-relaxed text-amber-200/90">
                {t('settings.permissions.stableInstallHint', {
                  defaultValue: 'For more stable Full Disk Access persistence, move Aether Explorer to /Applications before granting access.',
                })}
              </p>
            )}
          </div>

          <aside className="rounded-2xl border border-on-surface/10 bg-on-surface/[0.035] p-4 space-y-3">
            <button
              type="button"
              onClick={handleOpenSystemSettings}
              className="inline-flex w-full items-center justify-center gap-2 px-5 py-3 bg-primary text-on-primary font-black rounded-xl text-[12px] whitespace-nowrap shadow-lg shadow-primary/20 hover:scale-[1.02] active:scale-95 transition-all"
            >
              <ExternalLink className="w-4 h-4" />
              {t('settings.permissions.openSystemSettings')}
            </button>
            <button
              type="button"
              onClick={handleRevealAppInFinder}
              disabled={revealAppLoading}
              className="inline-flex w-full items-center justify-center gap-2 px-5 py-3 bg-on-surface/[0.06] hover:bg-on-surface/[0.10] border border-on-surface/10 rounded-xl text-[12px] font-black text-on-surface transition-colors disabled:opacity-60"
            >
              <FolderSearch className={`w-4 h-4 ${revealAppLoading ? 'animate-pulse' : ''}`} />
              {t('settings.permissions.revealAppInFinder')}
            </button>
            <button
              type="button"
              onClick={() => { void checkPermissions({ force: true }); }}
              disabled={permissionCheckLoading}
              className="inline-flex w-full items-center justify-center gap-2 px-5 py-3 bg-on-surface/[0.06] hover:bg-on-surface/[0.10] border border-on-surface/10 rounded-xl text-[12px] font-black text-on-surface transition-colors disabled:opacity-60"
            >
              <RefreshCw className={`w-4 h-4 ${permissionCheckLoading ? 'animate-spin' : ''}`} />
              {permissionCheckLoaded ? t('settings.permissions.recheck') : t('settings.permissions.check')}
            </button>
            <button
              type="button"
              onClick={handleCopyPermissionEvidence}
              disabled={!granted || copyEvidenceLoading}
              title={!granted ? t('settings.permissions.copyEvidenceRequiresGranted') : undefined}
              className="inline-flex w-full items-center justify-center gap-2 px-5 py-3 bg-on-surface/[0.06] hover:bg-on-surface/[0.10] border border-on-surface/10 rounded-xl text-[12px] font-black text-on-surface transition-colors disabled:opacity-60"
            >
              <Copy className={`w-4 h-4 ${copyEvidenceLoading ? 'animate-pulse' : ''}`} />
              {copyEvidenceLoading
                ? t('settings.permissions.copyEvidenceCopying')
                : t('settings.permissions.copyEvidence')}
            </button>
            {openSettingsError && (
              <p className="rounded-xl bg-red-400/10 px-3 py-2 text-[12px] leading-relaxed text-red-400">
                {t('settings.permissions.openSystemSettingsFailed', { error: openSettingsError })}
              </p>
            )}
            {revealAppError && (
              <p className="rounded-xl bg-red-400/10 px-3 py-2 text-[12px] leading-relaxed text-red-400">
                {t('settings.permissions.revealAppFailed', { error: revealAppError })}
              </p>
            )}
            {copyEvidenceMessage && (
              <p className={`rounded-xl px-3 py-2 text-[12px] leading-relaxed ${copyEvidenceMessage.kind === 'error' ? 'bg-red-400/10 text-red-400' : 'bg-green-400/10 text-green-400'}`}>
                {copyEvidenceMessage.text}
              </p>
            )}
            {!granted && !copyEvidenceMessage && (
              <p className="rounded-xl bg-on-surface/[0.04] px-3 py-2 text-[12px] leading-relaxed text-on-surface/55">
                {t('settings.permissions.copyEvidenceRequiresGranted')}
              </p>
            )}
          </aside>
        </div>

        {!granted && (
          <div className="rounded-2xl border border-amber-400/25 bg-amber-400/[0.10] p-5 space-y-3">
            <h4 className="text-[13px] font-black text-on-surface">{t('settings.permissions.recoveryTitle')}</h4>
            <p className="text-[13px] leading-relaxed text-on-surface/70">{t('settings.permissions.recoveryDescription')}</p>
            <p className="text-[12px] leading-relaxed text-on-surface/55">{t('settings.permissions.recoverySteps')}</p>
          </div>
        )}

        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <h4 className="text-[12px] font-black text-on-surface/55 uppercase tracking-wider">{t('settings.permissions.probeEvidence')}</h4>
            <span className="text-[11px] text-on-surface/50">{t('settings.permissions.probeHint')}</span>
          </div>
          {probeResults.length === 0 ? (
            <p className="text-[13px] text-on-surface/55">{t('settings.permissions.noProbeEvidence')}</p>
          ) : (
            <div className="space-y-2">
              {probeResults.map((probe) => (
                <div key={`${probe.targetType}-${probe.path}`} className="flex flex-col gap-2 rounded-2xl border border-on-surface/10 bg-on-surface/[0.04] px-4 py-3 md:flex-row md:items-center md:justify-between">
                  <div className="min-w-0">
                    <p className="truncate font-mono text-[11px] text-on-surface/75">{probe.path}</p>
                    {probe.error && <p className="mt-1 text-[11px] text-on-surface/50">{probe.error}</p>}
                  </div>
                  <span className={`shrink-0 rounded-lg px-3 py-1 text-[11px] font-black ${probe.readable ? 'bg-green-400/10 text-green-400' : probe.exists ? 'bg-red-400/10 text-red-400' : 'bg-on-surface/5 text-on-surface/35'}`}>
                    {probe.readable
                      ? t('settings.permissions.probeReadable')
                      : probe.exists
                        ? t('settings.permissions.probeBlocked')
                        : t('settings.permissions.probeMissing')}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
