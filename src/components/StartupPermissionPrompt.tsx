import { motion } from 'motion/react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, FolderSearch } from 'lucide-react';
import type { AppIdentity } from '../lib/app-identity';
import { isStableApplicationInstallPath } from '../lib/app-identity';

interface StartupPermissionPromptProps {
  liquidGlassEnabled: boolean;
  appIdentity: AppIdentity | null;
  appIdentityError: string | null;
  permissionCheckLoading: boolean;
  openSettingsError: string | null;
  revealAppLoading: boolean;
  revealAppError: string | null;
  onOpenSystemSettings: () => void;
  onRevealApp: () => void;
  onCheckAuthorization: () => void;
}

export default function StartupPermissionPrompt({
  liquidGlassEnabled,
  appIdentity,
  appIdentityError,
  permissionCheckLoading,
  openSettingsError,
  revealAppLoading,
  revealAppError,
  onOpenSystemSettings,
  onRevealApp,
  onCheckAuthorization,
}: StartupPermissionPromptProps) {
  const { t } = useTranslation();
  const appPath = appIdentity?.appPath ?? '';
  const stableInstallPath = isStableApplicationInstallPath(appPath);

  return (
    <motion.div
      className="fixed inset-0 z-[119] flex items-center justify-center bg-black/35 backdrop-blur-sm px-6"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      <motion.div
        initial={{ scale: 0.96, y: 12, opacity: 0 }}
        animate={{ scale: 1, y: 0, opacity: 1 }}
        exit={{ scale: 0.96, y: 12, opacity: 0 }}
        className={`${liquidGlassEnabled ? 'liquid-glass' : 'border border-primary/15 bg-surface/95'} w-full max-w-[640px] rounded-3xl shadow-2xl shadow-black/20 overflow-hidden`}
      >
        <div className="flex items-start gap-4 p-6">
          <div className="w-11 h-11 rounded-2xl bg-primary/15 flex items-center justify-center shrink-0">
            <AlertTriangle className="w-5 h-5 text-primary" />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="text-[17px] font-black text-on-surface">{t('appPermissions.startupTitle')}</h3>
            <p className="text-[13px] text-on-surface/55 mt-2 leading-relaxed">
              {t('appPermissions.startupDescription')}
            </p>
            <p className="text-[12px] text-on-surface/35 mt-3 leading-relaxed">
              {t('appPermissions.systemBehaviorHint')}
            </p>
            <p className="text-[12px] text-on-surface/35 mt-2 leading-relaxed">
              {t('appPermissions.autoCheckHint')}
            </p>
            <div className="mt-4 grid gap-2 text-[12px] text-on-surface/70 sm:grid-cols-2">
              {appIdentity ? (
                [
                  [t('appPermissions.appName'), appIdentity.appName],
                  [t('appPermissions.bundleIdentifier'), appIdentity.bundleIdentifier],
                  [t('appPermissions.appVersion'), appIdentity.version],
                  [t('appPermissions.appPath'), appIdentity.appPath],
                ].map(([label, value]) => (
                  <div key={label} className="min-w-0 rounded-xl border border-on-surface/10 bg-on-surface/[0.04] px-3 py-2">
                    <p className="text-[10px] font-black uppercase text-on-surface/35">{label}</p>
                    <p className="mt-1 truncate font-mono text-[11px] text-on-surface/75" title={value}>
                      {value || '-'}
                    </p>
                  </div>
                ))
              ) : (
                <p className="sm:col-span-2 text-[12px] text-on-surface/45">
                  {appIdentityError
                    ? t('appPermissions.appIdentityFailed', { error: appIdentityError })
                    : t('appPermissions.appIdentityLoading')}
                </p>
              )}
            </div>
            {appIdentity && appPath && !stableInstallPath && (
              <p className="mt-3 rounded-xl border border-amber-400/20 bg-amber-400/[0.08] px-3 py-2 text-[12px] leading-relaxed text-amber-200/90">
                {t('appPermissions.stableInstallHint')}
              </p>
            )}
            {openSettingsError && (
              <p className="mt-3 text-[12px] text-red-400">
                {t('appPermissions.openSettingsFailed', { error: openSettingsError })}
              </p>
            )}
            {revealAppError && (
              <p className="mt-3 text-[12px] text-red-400">
                {t('appPermissions.revealAppFailed', { error: revealAppError })}
              </p>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-3 p-6">
          <button
            onClick={onOpenSystemSettings}
            disabled={permissionCheckLoading}
            className="px-5 py-3 rounded-2xl bg-primary/10 text-primary text-[12px] font-black hover:bg-primary/20 transition-colors disabled:opacity-50"
          >
            {t('appPermissions.openSettings')}
          </button>
          <button
            onClick={onRevealApp}
            disabled={revealAppLoading}
            className="inline-flex items-center gap-2 px-5 py-3 rounded-2xl bg-primary/10 text-primary text-[12px] font-black hover:bg-primary/20 transition-colors disabled:opacity-50"
          >
            <FolderSearch className={`w-4 h-4 ${revealAppLoading ? 'animate-pulse' : ''}`} />
            {t('appPermissions.revealAppInFinder')}
          </button>
          <button
            onClick={onCheckAuthorization}
            disabled={permissionCheckLoading}
            className="px-5 py-3 rounded-2xl bg-primary text-on-primary text-[12px] font-black shadow-lg shadow-primary/20 hover:bg-primary/90 transition-colors disabled:opacity-60"
          >
            {permissionCheckLoading ? t('appPermissions.requesting') : t('appPermissions.continue')}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}
