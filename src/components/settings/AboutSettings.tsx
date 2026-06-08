import { AnimatePresence, motion } from 'motion/react';
import { BadgeCheck, Copy, DownloadCloud, ExternalLink, FileText, Folder, Loader2, RefreshCw, RotateCw, Trash2, X } from 'lucide-react';
import { safeShellOpen } from '../../lib/url-guard';

const ISSUE_URL = 'https://github.com/HaoRangQi/aether-explorer/issues/new/choose';

export default function AboutSettings(props: any) {
  const { t, appVersion, diagnosticsStatus, lastPanicLog, updateStatus, cleanupStatus, formatBytes, handleCopyDiagnostics, handleOpenLogsDir, handleOpenConfigDir, handleReadLastPanicLog, handleCopyPanicLog, handleCheckUpdates, handleDownloadUpdate, handleCleanup } = props;

  return (
    <div className="-mt-8 space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <section className="bg-primary/5 rounded-[32px] p-10 border border-primary/10 space-y-8">
        <div className="flex items-start justify-between gap-8">
          <div className="flex items-center gap-5">
            <div className="w-16 h-16 rounded-2xl bg-primary text-on-primary flex items-center justify-center shadow-xl shadow-primary/20">
              <span className="text-[20px] font-black">AE</span>
            </div>
            <div>
              <h3 className="text-[24px] font-black text-on-surface tracking-tight">Aether Explorer</h3>
              <p className="text-[13px] text-on-surface/45 mt-1">macOS 文件管理器 · Tauri v2 / React / Rust</p>
            </div>
          </div>
          <span className="px-4 py-2 rounded-full bg-primary/10 text-primary text-[11px] font-black uppercase tracking-widest">v{appVersion || '0.0.0'}</span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[
            ['构建渠道', 'Developer Preview'],
            ['更新策略', 'GitHub Release'],
            ['运行环境', 'macOS Desktop'],
          ].map(([label, value]) => (
            <div key={label} className="rounded-2xl bg-primary/5 border border-primary/10 px-5 py-4">
              <p className="text-[11px] font-black text-on-surface/35 uppercase tracking-wider">{label}</p>
              <p className="text-[15px] font-black text-on-surface mt-2">{value}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="bg-primary/5 rounded-[32px] p-10 border border-primary/10 space-y-6">
        <div className="flex items-start justify-between gap-6">
          <div className="flex items-center gap-4 min-w-0">
            <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center shrink-0">
              <FileText className="w-6 h-6 text-primary" />
            </div>
            <div className="min-w-0">
              <h3 className="text-[18px] font-black text-on-surface">{t('settings.diagnostics.title')}</h3>
              <p className="text-[12px] text-on-surface/45 mt-1 leading-relaxed">{t('settings.diagnostics.description')}</p>
            </div>
          </div>
          {diagnosticsStatus.loading && <Loader2 className="w-5 h-5 text-primary animate-spin shrink-0" />}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <button
            onClick={handleCopyDiagnostics}
            disabled={diagnosticsStatus.loading}
            className="px-5 py-4 rounded-2xl bg-primary/10 text-primary text-[12px] font-black flex items-center justify-center gap-2 hover:bg-primary/20 transition-colors disabled:opacity-60"
          >
            <Copy className="w-4 h-4" />
            {t('settings.diagnostics.copyInfo')}
          </button>
          <button
            onClick={handleOpenLogsDir}
            disabled={diagnosticsStatus.loading}
            className="px-5 py-4 rounded-2xl bg-primary/10 text-primary text-[12px] font-black flex items-center justify-center gap-2 hover:bg-primary/20 transition-colors disabled:opacity-60"
          >
            <Folder className="w-4 h-4" />
            {t('settings.diagnostics.openLogs')}
          </button>
          <button
            onClick={handleOpenConfigDir}
            disabled={diagnosticsStatus.loading}
            className="px-5 py-4 rounded-2xl bg-primary/10 text-primary text-[12px] font-black flex items-center justify-center gap-2 hover:bg-primary/20 transition-colors disabled:opacity-60"
          >
            <Folder className="w-4 h-4" />
            {t('settings.diagnostics.openConfig')}
          </button>
          <button
            onClick={handleReadLastPanicLog}
            disabled={diagnosticsStatus.loading}
            className="px-5 py-4 rounded-2xl bg-primary/10 text-primary text-[12px] font-black flex items-center justify-center gap-2 hover:bg-primary/20 transition-colors disabled:opacity-60"
          >
            <FileText className="w-4 h-4" />
            {t('settings.diagnostics.loadPanicLog')}
          </button>
          <button
            onClick={() => safeShellOpen(ISSUE_URL).catch(() => {})}
            className="px-5 py-4 rounded-2xl bg-primary text-on-primary text-[12px] font-black flex items-center justify-center gap-2 shadow-lg shadow-primary/20 hover:bg-primary/90 transition-colors"
          >
            <ExternalLink className="w-4 h-4" />
            {t('settings.diagnostics.openIssue')}
          </button>
        </div>

        {diagnosticsStatus.message && (
          <div className={`rounded-2xl border px-5 py-4 flex items-center gap-3 ${
            diagnosticsStatus.kind === 'error'
              ? 'bg-red-500/10 border-red-500/20 text-red-500'
              : 'bg-primary/5 border-primary/10 text-on-surface/70'
          }`}>
            {diagnosticsStatus.kind === 'error' ? <X className="w-5 h-5 shrink-0" /> : <BadgeCheck className="w-5 h-5 text-primary shrink-0" />}
            <span className="text-[13px] font-bold leading-relaxed">{diagnosticsStatus.message}</span>
          </div>
        )}

        {lastPanicLog !== null && (
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <h4 className="text-[12px] font-black text-on-surface/45 uppercase tracking-widest">{t('settings.diagnostics.lastPanicLog')}</h4>
              {lastPanicLog && (
                <button
                  onClick={handleCopyPanicLog}
                  className="px-3 py-2 rounded-xl bg-primary/10 text-primary text-[11px] font-black flex items-center gap-1.5 hover:bg-primary/20 transition-colors"
                >
                  <Copy className="w-3.5 h-3.5" />
                  {t('settings.diagnostics.copyPanicLog')}
                </button>
              )}
            </div>
            <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-words rounded-2xl bg-on-surface/[0.04] border border-primary/10 p-4 text-[11px] leading-relaxed text-on-surface/65 font-mono">
              {lastPanicLog || t('settings.diagnostics.noPanicLog')}
            </pre>
          </div>
        )}
      </section>

      <section className="bg-primary/5 rounded-[32px] p-10 border border-primary/10 space-y-6">
        <div className="flex items-center justify-between gap-6">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center">
              <DownloadCloud className="w-6 h-6 text-primary" />
            </div>
            <div>
              <h3 className="text-[18px] font-black text-on-surface">{t('settings.update.title')}</h3>
              <p className="text-[12px] text-on-surface/45 mt-1">{t('settings.update.description')}</p>
            </div>
          </div>
          <button
            onClick={handleCheckUpdates}
            disabled={['checking', 'downloading', 'installing', 'restarting'].includes(updateStatus.state)}
            className="px-5 py-3 rounded-2xl bg-primary text-on-primary text-[12px] font-black flex items-center gap-2 shadow-xl shadow-primary/20 disabled:opacity-60 whitespace-nowrap shrink-0"
          >
            <RefreshCw className={`w-4 h-4 ${updateStatus.state === 'checking' ? 'animate-spin' : ''}`} />
            {updateStatus.state === 'checking' ? t('settings.update.checkingButton') : t('settings.update.checkButton')}
          </button>
        </div>

        <div className="rounded-2xl bg-primary/5 border border-primary/10 px-5 py-4 flex items-center gap-3">
          {(['checking', 'downloading', 'installing', 'restarting'] as const).includes(updateStatus.state as any) ? (
            <Loader2 className="w-5 h-5 text-primary animate-spin shrink-0" />
          ) : updateStatus.state === 'error' ? (
            <X className="w-5 h-5 text-red-500 shrink-0" />
          ) : (
            <BadgeCheck className="w-5 h-5 text-primary shrink-0" />
          )}
          <span className="text-[13px] font-bold text-on-surface/70">
            {updateStatus.state === 'idle' ? t('settings.update.idleHint') : updateStatus.message}
          </span>
        </div>

        <AnimatePresence mode="wait">
          {(updateStatus.state === 'downloading' || updateStatus.state === 'installing' || updateStatus.state === 'restarting') && (
            <motion.div
              key="progress"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              className="space-y-3"
            >
              <div className="flex items-center justify-between text-[11px] font-black text-on-surface/55 uppercase tracking-widest">
                <span>
                  {updateStatus.state === 'downloading'
                    ? t('settings.update.downloading')
                    : updateStatus.state === 'installing'
                    ? t('settings.update.installing')
                    : t('settings.update.restarting')}
                </span>
                <span className="text-on-surface tabular-nums">
                  {(() => {
                    const total = updateStatus.contentLength;
                    const done = updateStatus.downloaded;
                    if (updateStatus.state === 'installing' || updateStatus.state === 'restarting') return '100%';
                    if (total > 0) return `${Math.min(100, Math.round((done / total) * 100))}%`;
                    return formatBytes(done);
                  })()}
                </span>
              </div>
              <div className="relative h-2 rounded-full bg-primary/10 overflow-hidden">
                <motion.div
                  className="absolute inset-y-0 left-0 bg-primary rounded-full"
                  initial={{ width: '0%' }}
                  animate={{
                    width:
                      updateStatus.state === 'installing' || updateStatus.state === 'restarting'
                        ? '100%'
                        : updateStatus.contentLength > 0
                        ? `${Math.min(100, (updateStatus.downloaded / updateStatus.contentLength) * 100)}%`
                        : '20%',
                  }}
                  transition={{ duration: updateStatus.state === 'downloading' && updateStatus.contentLength === 0 ? 1.2 : 0.4, ease: 'easeOut', repeat: updateStatus.state === 'downloading' && updateStatus.contentLength === 0 ? Infinity : 0, repeatType: 'reverse' }}
                />
              </div>
              {updateStatus.state === 'downloading' && updateStatus.contentLength > 0 && (
                <p className="text-[11px] text-on-surface/45 tabular-nums">
                  {formatBytes(updateStatus.downloaded)} / {formatBytes(updateStatus.contentLength)}
                </p>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        {updateStatus.state === 'available' && (
          <>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="rounded-2xl bg-primary/5 border border-primary/10 px-4 py-3">
              <p className="text-[11px] font-black text-on-surface/35 uppercase tracking-widest">{t('settings.update.currentVersion')}</p>
              <p className="text-[13px] font-black text-on-surface mt-1 truncate">{updateStatus.currentVersion || t('settings.update.unknown')}</p>
            </div>
            <div className="rounded-2xl bg-primary/5 border border-primary/10 px-4 py-3">
              <p className="text-[11px] font-black text-on-surface/35 uppercase tracking-widest">{t('settings.update.latestVersion')}</p>
              <p className="text-[13px] font-black text-on-surface mt-1 truncate">{updateStatus.latestVersion || t('settings.update.unknown')}</p>
            </div>
          </div>
          {updateStatus.notes && (
            <div className="rounded-2xl bg-primary/5 border border-primary/10 px-4 py-3 max-h-40 overflow-y-auto">
              <p className="text-[11px] font-black text-on-surface/35 uppercase tracking-widest mb-2">{t('settings.update.releaseNotes')}</p>
              <p className="text-[12px] text-on-surface/75 whitespace-pre-wrap leading-relaxed">{updateStatus.notes}</p>
            </div>
          )}
          <div className="flex gap-3">
            <button
              onClick={handleDownloadUpdate}
              className="flex-1 py-3 rounded-2xl bg-green-500 text-white text-[13px] font-black flex items-center justify-center gap-2 shadow-lg shadow-green-500/20 hover:bg-green-400 transition-colors"
            >
              <DownloadCloud className="w-4 h-4" /> {t('settings.update.downloadAndInstall')}
            </button>
            <button
              onClick={() => updateStatus.releaseUrl && safeShellOpen(updateStatus.releaseUrl).catch(() => {})}
              className="flex-1 py-3 rounded-2xl bg-primary text-on-primary text-[13px] font-black flex items-center justify-center gap-2 shadow-lg shadow-primary/20 hover:bg-primary/80 transition-colors"
            >
              <ExternalLink className="w-4 h-4" /> {t('settings.update.viewRelease')}
            </button>
          </div>
          </>
        )}

        {updateStatus.state === 'restarting' && (
          <div className="flex items-center justify-center gap-2 py-3 text-[12px] font-black text-primary">
            <RotateCw className="w-4 h-4 animate-spin" />
            {t('settings.update.restartingHint')}
          </div>
        )}
      </section>

      <section className="bg-primary/5 rounded-[32px] p-10 border border-primary/10 space-y-6">
        <div className="flex items-center justify-between gap-6">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center">
              <Trash2 className="w-6 h-6 text-primary" />
            </div>
            <div>
              <h3 className="text-[18px] font-black text-on-surface">清理缓存</h3>
              <p className="text-[12px] text-on-surface/45 mt-1">清理应用产生的临时文件、缓存数据和拖拽传输记录，释放存储空间。</p>
            </div>
          </div>
          <button
            onClick={handleCleanup}
            disabled={cleanupStatus.cleaning}
            className="px-5 py-3 rounded-2xl bg-primary text-on-primary text-[12px] font-black flex items-center gap-2 shadow-xl shadow-primary/20 disabled:opacity-60 whitespace-nowrap shrink-0"
          >
            <Trash2 className={`w-4 h-4 ${cleanupStatus.cleaning ? 'animate-pulse' : ''}`} />
            {cleanupStatus.cleaning ? '清理中' : '立即清理'}
          </button>
        </div>
        {cleanupStatus.message && (
          <div className="rounded-2xl bg-primary/5 border border-primary/10 px-5 py-4 flex items-center gap-3">
            <BadgeCheck className="w-5 h-5 text-primary" />
            <span className="text-[13px] font-bold text-on-surface/70">
              {cleanupStatus.message}
            </span>
          </div>
        )}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="rounded-2xl bg-primary/5 border border-primary/10 px-4 py-3">
            <p className="text-[11px] font-black text-on-surface/35 uppercase tracking-widest">缓存类型</p>
            <p className="text-[13px] font-black text-on-surface mt-1">拖拽传输 · 临时数据</p>
          </div>
          <div className="rounded-2xl bg-primary/5 border border-primary/10 px-4 py-3">
            <p className="text-[11px] font-black text-on-surface/35 uppercase tracking-widest">存储位置</p>
            <p className="text-[13px] font-black text-on-surface mt-1">LocalStorage · SessionStorage</p>
          </div>
          <div className="rounded-2xl bg-primary/5 border border-primary/10 px-4 py-3">
            <p className="text-[11px] font-black text-on-surface/35 uppercase tracking-widest">清理策略</p>
            <p className="text-[13px] font-black text-on-surface mt-1">保留设置 · 清理缓存</p>
          </div>
        </div>
      </section>
    </div>
  );
}
