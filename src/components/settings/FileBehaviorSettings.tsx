import { motion } from 'motion/react';
import { ArrowRightLeft, BadgeCheck, Copy, Eye, EyeOff, File as FileIcon, FileDown, FileUp, Folder, HardDrive, HelpCircle, History, Layout, Loader2, RotateCw, X } from 'lucide-react';

const AI_HISTORY_RETENTION_OPTIONS = [3, 7, 15, 30, 90];

export default function FileBehaviorSettings(props: any) {
  const { t, theme, onThemeChange, showFolderSizeInList, backupStatus, handleResetDefaultHome, handlePickDefaultHome, handleExportSettingsBackup, handleImportSettingsBackup, handleResetAllSettingsData } = props;

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <section className="bg-primary/5 rounded-[32px] p-10 border border-primary/10 space-y-8">
        <h3 className="text-[18px] font-black text-on-surface flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-2xl bg-primary/10 flex items-center justify-center">
            <HardDrive className="w-5 h-5 text-primary" />
          </div>
          {t('settings.filesHeader')}
        </h3>
        
        <div className="space-y-2">
          <div className="flex items-center justify-between p-6 bg-primary/5 rounded-2xl border border-transparent hover:border-primary/20 transition-all group gap-6">
            <div className="space-y-1 min-w-0">
              <h4 className="text-[15px] font-bold text-on-surface flex items-center gap-2">
                <Folder className="w-4 h-4 text-primary" />
                {t('settings.defaultHomePath', '默认首页')}
              </h4>
              <p className="text-[12px] font-mono text-on-surface/50 truncate">
                {(() => {
                  const v = theme.defaultHomePath || 'aether://favorites';
                  if (v === 'aether://favorites') return t('settings.defaultHomeFavorites', '我的收藏');
                  if (v === 'aether://recent') return t('settings.defaultHomeRecent', '最近使用');
                  return v;
                })()}
              </p>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              <button
                onClick={handleResetDefaultHome}
                className="px-4 py-2 rounded-2xl bg-primary/10 text-primary text-[12px] font-black hover:bg-primary/20 transition-colors"
              >
                {t('settings.resetDefaultHome', '恢复我的收藏')}
              </button>
              <button
                onClick={handlePickDefaultHome}
                className="px-4 py-2 rounded-2xl bg-primary text-on-primary text-[12px] font-black hover:bg-primary/90 transition-colors"
              >
                {t('settings.chooseDefaultHome', '选择目录')}
              </button>
            </div>
          </div>

          {/* 跨窗口拖拽默认动作 */}
          <div className="flex items-center justify-between p-6 bg-primary/5 rounded-2xl border border-transparent hover:border-primary/20 transition-all group gap-6">
            <div className="space-y-1 min-w-0">
              <h4 className="text-[15px] font-bold text-on-surface flex items-center gap-2">
                <ArrowRightLeft className="w-4 h-4 text-primary" />
                {t('settings.crossWindowDrop', '跨窗口拖拽默认动作')}
              </h4>
              <p className="text-[12px] text-on-surface/50">
                {t('settings.crossWindowDropDesc', '把文件从一个 Aether 窗口拖到另一个窗口时的默认行为；修饰键随时可临时覆盖（⌘ 切换、⌥ 强制复制、⇧ 强制移动）。')}
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0 p-1 bg-primary/5 rounded-2xl border border-primary/10">
              {(['copy', 'move', 'ask'] as const).map((mode) => {
                const active = (theme.crossWindowDropDefault || 'copy') === mode;
                const icon = mode === 'copy' ? <Copy className="w-3.5 h-3.5" />
                  : mode === 'move' ? <ArrowRightLeft className="w-3.5 h-3.5" />
                  : <HelpCircle className="w-3.5 h-3.5" />;
                const label = mode === 'copy' ? t('settings.crossWindowDropCopy', '复制')
                  : mode === 'move' ? t('settings.crossWindowDropMove', '移动')
                  : t('settings.crossWindowDropAsk', '每次询问');
                return (
                  <button
                    key={mode}
                    onClick={() => onThemeChange({ ...theme, crossWindowDropDefault: mode })}
                    className={`px-3 py-1.5 rounded-xl text-[12px] font-black flex items-center gap-1.5 transition-all ${
                      active
                        ? 'bg-primary text-on-primary shadow-md shadow-primary/20'
                        : 'text-on-surface/60 hover:text-on-surface hover:bg-primary/10'
                    }`}
                    title={label}
                  >
                    {icon}
                    {label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex items-center justify-between p-6 bg-primary/5 rounded-2xl border border-transparent hover:border-primary/20 transition-all group gap-6">
            <div className="space-y-1 min-w-0">
              <h4 className="text-[15px] font-bold text-on-surface flex items-center gap-2">
                <History className="w-4 h-4 text-primary" />
                {t('settings.aiHistoryRetention', '操作历史保留时长')}
              </h4>
              <p className="text-[12px] text-on-surface/50">
                {t('settings.aiHistoryRetentionDesc', '用于控制本地操作历史保存周期（含 AI 与人工操作）。默认 7 天，最长 90 天。')}
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0 p-1 bg-primary/5 rounded-2xl border border-primary/10">
              {AI_HISTORY_RETENTION_OPTIONS.map(days => {
                const active = (theme.aiOpsHistoryRetentionDays || 7) === days;
                return (
                  <button
                    key={days}
                    onClick={() => onThemeChange({ ...theme, aiOpsHistoryRetentionDays: days })}
                    className={`px-3 py-1.5 rounded-xl text-[12px] font-black transition-all ${
                      active
                        ? 'bg-primary text-on-primary shadow-md shadow-primary/20'
                        : 'text-on-surface/60 hover:text-on-surface hover:bg-primary/10'
                    }`}
                  >
                    {days} 天
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex items-center justify-between p-6 bg-primary/5 rounded-2xl border border-transparent hover:border-primary/20 transition-all group">
            <div className="space-y-1">
              <h4 className="text-[15px] font-bold text-on-surface flex items-center gap-2">
                {theme.showHiddenFiles ? <Eye className="w-4 h-4 text-primary" /> : <EyeOff className="w-4 h-4 text-on-surface/40" />}
                {t('settings.showHiddenFiles', '显示隐藏项')}
              </h4>
              <p className="text-[12px] text-on-surface/50">在文件浏览器中显示以点(.)开头的文件或系统受限项目。</p>
            </div>
            <button
              onClick={() => onThemeChange({ ...theme, showHiddenFiles: !theme.showHiddenFiles })}
              className={`w-14 h-8 rounded-full p-1.5 transition-colors duration-300 flex items-center ${theme.showHiddenFiles ? 'bg-primary' : 'bg-on-surface/[0.1]'}`}
            >
              <motion.div animate={{ x: theme.showHiddenFiles ? 24 : 0 }} className={`w-5 h-5 rounded-full shadow-lg ${theme.showHiddenFiles ? 'bg-on-primary' : 'bg-on-surface/30'}`} />
            </button>
          </div>

          <div className="flex items-center justify-between p-6 bg-primary/5 rounded-2xl border border-transparent hover:border-primary/20 transition-all group">
            <div className="space-y-1">
              <h4 className="text-[15px] font-bold text-on-surface flex items-center gap-2">
                <FileIcon className="w-4 h-4 text-primary" />
                {t('settings.showFolderSizeInList', '列表显示文件夹大小（快速估算）')}
              </h4>
              <p className="text-[12px] text-on-surface/50">
                {t('settings.showFolderSizeInListDesc', '在“大小”列显示文件夹的粗略大小，优先保证流畅，不做高精度深度统计。')}
              </p>
            </div>
            <button
              onClick={() => onThemeChange({ ...theme, showFolderSizeInList: !showFolderSizeInList })}
              className={`w-14 h-8 rounded-full p-1.5 transition-colors duration-300 flex items-center ${showFolderSizeInList ? 'bg-primary' : 'bg-on-surface/[0.1]'}`}
            >
              <motion.div animate={{ x: showFolderSizeInList ? 24 : 0 }} className={`w-5 h-5 rounded-full shadow-lg ${showFolderSizeInList ? 'bg-on-primary' : 'bg-on-surface/30'}`} />
            </button>
          </div>

          <div className="flex items-center justify-between p-6 bg-primary/5 rounded-2xl border border-transparent hover:border-primary/20 transition-all group">
            <div className="space-y-1">
              <h4 className="text-[15px] font-bold text-on-surface flex items-center gap-2">
                <Layout className="w-4 h-4 text-primary" />
                {t('settings.showPreviewPanel', '侧边预览面板')}
              </h4>
              <p className="text-[12px] text-on-surface/50">点击文件时自动展开右侧多媒体预览与属性分析面板。</p>
            </div>
            <button 
              onClick={() => onThemeChange({ ...theme, showPreviewPanel: !theme.showPreviewPanel })}
              className={`w-14 h-8 rounded-full p-1.5 transition-colors duration-300 flex items-center ${theme.showPreviewPanel ? 'bg-primary' : 'bg-on-surface/[0.1]'}`}
            >
              <motion.div animate={{ x: theme.showPreviewPanel ? 24 : 0 }} className={`w-5 h-5 rounded-full shadow-lg ${theme.showPreviewPanel ? 'bg-on-primary' : 'bg-on-surface/30'}`} />
            </button>
          </div>
        </div>
      </section>

      {/* 数据导出/导入 */}
      <section className="bg-primary/5 rounded-[32px] p-10 border border-primary/10 space-y-8">
        <h3 className="text-[17px] font-bold text-on-surface flex items-center gap-2">
          <ArrowRightLeft className="w-4 h-4 text-primary" /> {t('settings.backup.title')}
        </h3>
        <p className="text-[13px] text-on-surface/40 leading-relaxed">
          {t('settings.backup.description')}
        </p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <button
            onClick={handleExportSettingsBackup}
            disabled={backupStatus.loading}
            className="flex items-center justify-center gap-3 px-6 py-5 bg-primary/10 hover:bg-primary/20 rounded-2xl text-[14px] font-bold text-primary transition-all disabled:opacity-60"
          >
            <FileDown className="w-5 h-5" />
            {t('settings.backup.export')}
          </button>
          <button
            onClick={handleImportSettingsBackup}
            disabled={backupStatus.loading}
            className="flex items-center justify-center gap-3 px-6 py-5 bg-primary/10 hover:bg-primary/20 rounded-2xl text-[14px] font-bold text-primary transition-all disabled:opacity-60"
          >
            <FileUp className="w-5 h-5" />
            {t('settings.backup.import')}
          </button>
          <button
            onClick={handleResetAllSettingsData}
            disabled={backupStatus.loading}
            className="flex items-center justify-center gap-3 px-6 py-5 bg-red-500/10 hover:bg-red-500/15 rounded-2xl text-[14px] font-bold text-red-500 transition-all disabled:opacity-60"
          >
            <RotateCw className="w-5 h-5" />
            {t('settings.backup.resetAll')}
          </button>
        </div>
        {backupStatus.message && (
          <div className={`rounded-2xl border px-5 py-4 flex items-center gap-3 ${
            backupStatus.kind === 'error'
              ? 'bg-red-500/10 border-red-500/20 text-red-500'
              : 'bg-primary/5 border-primary/10 text-on-surface/70'
          }`}>
            {backupStatus.loading ? <Loader2 className="w-5 h-5 text-primary animate-spin shrink-0" /> : backupStatus.kind === 'error' ? <X className="w-5 h-5 shrink-0" /> : <BadgeCheck className="w-5 h-5 text-primary shrink-0" />}
            <span className="text-[13px] font-bold leading-relaxed">{backupStatus.message}</span>
          </div>
        )}
        <p className="text-[11px] text-on-surface/25">{t('settings.backup.warning')}</p>
      </section>
    </div>
  );
}
