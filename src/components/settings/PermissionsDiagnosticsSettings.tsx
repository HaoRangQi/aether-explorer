import { invoke } from '@tauri-apps/api/core';
import { Shield } from 'lucide-react';

export default function PermissionsDiagnosticsSettings(props: any) {
  const { t, permChecks, permChecksLoaded, checkPermissions } = props;

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <section className="bg-primary/5 rounded-[32px] p-10 border border-primary/10 space-y-8">
        <div className="flex items-center justify-between p-8 bg-primary/5 rounded-[40px] border-2 border-primary/10">
          <div className="space-y-2">
            <h3 className="text-[18px] font-black text-on-surface flex items-center gap-4">
              <div className="w-12 h-12 rounded-full bg-primary/20 flex items-center justify-center shadow-xl shadow-primary/10">
                <Shield className="w-6 h-6 text-primary" />
              </div>
              {t('settings.permissions.fullDiskTitle')}
            </h3>
            <p className="text-[14px] text-on-surface/50 max-w-md">{t('settings.permissions.fullDiskDescription')}</p>
          </div>
          <button
            onClick={() => invoke('open_system_settings').catch(() => {})}
            className="px-6 py-3 bg-primary text-on-primary font-black rounded-2xl text-[13px] whitespace-nowrap shrink-0 shadow-lg shadow-primary/20 hover:scale-[1.02] active:scale-95 transition-all uppercase tracking-widest"
          >
            {t('settings.permissions.openSystemSettings')}
          </button>
        </div>

        {/* Permission check results */}
        <div className="space-y-3">
          <div className="flex items-center justify-between px-2">
            <h4 className="text-[13px] font-bold text-on-surface/40 uppercase tracking-wider">{t('settings.permissions.accessStatus')}</h4>
            <button
              onClick={checkPermissions}
              className="px-4 py-2 bg-primary/10 hover:bg-primary/20 rounded-xl text-[12px] font-bold text-primary transition-colors"
            >
              {permChecksLoaded ? t('settings.permissions.recheck') : t('settings.permissions.check')}
            </button>
          </div>
          {!permChecksLoaded ? (
            <p className="text-[13px] text-on-surface/30 px-2">{t('settings.permissions.checkHint')}</p>
          ) : (
            permChecks.map(p => (
              <div key={p.path} className="flex items-center justify-between px-6 py-4 bg-primary/5 rounded-2xl border border-transparent">
                <div className="space-y-1">
                  <span className="text-[14px] font-bold text-on-surface">{p.label}</span>
                  <p className="text-[11px] text-on-surface/30 font-mono">{p.path}</p>
                </div>
                {p.ok ? (
                  <span className="text-[11px] font-black text-green-400 bg-green-400/10 px-4 py-1 rounded-full">{t('settings.permissions.accessible')}</span>
                ) : p.ok === false ? (
                  <span className="text-[11px] font-black text-red-400 bg-red-400/10 px-4 py-1 rounded-full">{t('settings.permissions.denied')}</span>
                ) : (
                  <span className="text-[11px] font-black text-on-surface/20 bg-on-surface/5 px-4 py-1 rounded-full">{t('settings.permissions.checking')}</span>
                )}
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  );
}
