import { motion } from 'motion/react';
import { Code2, Copy, ExternalLink, FileDown, FileUp, Fingerprint, Pencil, Plus, Puzzle, Settings2, Sparkles, Terminal, Trash2 } from 'lucide-react';
import type { ContextMenuAction } from '../../types';
import type { ComponentType } from 'react';

const CORE_CONTEXT_ACTIONS = ['open', 'rename', 'copyTo', 'moveTo', 'compress', 'decompress', 'quickLook', 'revealInFinder', 'copyPath', 'openTerminal', 'trash'] as const;

const ACTION_TYPE_ICONS = {
  terminal: Terminal,
  shell: Code2,
  url: ExternalLink,
  placeholder: Sparkles,
  'ai-assistant': Sparkles,
  'ai-history': Sparkles,
  'calculate-hash': Fingerprint,
} satisfies Record<NonNullable<ContextMenuAction['actionType']>, ComponentType<{ className?: string }>>;

export default function ExtensionSettings(props: any) {
  const { t, theme, terminalApps, newActionLabel, setNewActionLabel, newActionType, setNewActionType, newTerminalApp, setNewTerminalApp, newTerminalArgs, setNewTerminalArgs, newCommand, setNewCommand, newUrlTemplate, setNewUrlTemplate, newWorkingDirectory, setNewWorkingDirectory, editingExtensionId, handleImportExtensions, handleExportExtensions, resetActionForm, populateActionForm, handleDeleteExtension, toggleExtension, addExtension, isNewActionValid } = props;

  const getActionTypeMeta = (type: NonNullable<ContextMenuAction['actionType']>) => ({
    label: t(`settings.extensions.actionTypes.${type}.label`),
    description: t(`settings.extensions.actionTypes.${type}.description`),
    icon: ACTION_TYPE_ICONS[type],
  });

    const extensions = theme.contextMenuExtensions || [];
    const currentActionMeta = getActionTypeMeta(newActionType);
    const CurrentActionIcon = currentActionMeta.icon;

    return (
      <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
        <section className="bg-primary/5 rounded-[32px] p-10 border border-primary/10 space-y-10">
          <header className="flex items-start justify-between gap-6">
            <div className="space-y-2">
              <h3 className="text-[20px] font-black text-on-surface flex items-center gap-4">
                <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center">
                  <Puzzle className="w-6 h-6 text-primary" />
                </div>
                {t('settings.contextMenuExt', '右键菜单扩展')}
              </h3>
              <p className="text-[13px] text-on-surface/55 font-bold max-w-2xl leading-relaxed">{t('settings.extensions.description')}</p>
            </div>
            <div className="bg-primary/10 px-4 py-2 rounded-2xl flex items-center gap-2 shrink-0">
              <div className="w-2 h-2 rounded-full bg-primary" />
              <span className="text-[11px] font-black text-primary uppercase tracking-widest">{t('settings.extensions.enabledCount', { count: extensions.filter(ext => ext.enabled).length })}</span>
            </div>
          </header>

          <div className="flex flex-wrap gap-3">
            <button onClick={handleImportExtensions} className="px-4 py-2 rounded-2xl bg-primary/10 text-primary text-[11px] font-black flex items-center gap-2 hover:bg-primary/20 transition-colors">
              <FileUp className="w-4 h-4" /> {t('settings.extensions.importJson')}
            </button>
            <button onClick={handleExportExtensions} className="px-4 py-2 rounded-2xl bg-primary/10 text-primary text-[11px] font-black flex items-center gap-2 hover:bg-primary/20 transition-colors">
              <FileDown className="w-4 h-4" /> {t('settings.extensions.exportJson')}
            </button>
            <button onClick={() => navigator.clipboard.writeText(JSON.stringify(extensions, null, 2)).catch(() => {})} className="px-4 py-2 rounded-2xl bg-primary/10 text-primary text-[11px] font-black flex items-center gap-2 hover:bg-primary/20 transition-colors">
              <Copy className="w-4 h-4" /> {t('settings.extensions.copyConfig')}
            </button>
            <button onClick={resetActionForm} className="px-4 py-2 rounded-2xl bg-primary/5 text-on-surface text-[11px] font-black flex items-center gap-2 hover:bg-primary/10 transition-colors">
              {t('settings.extensions.cancelEdit')}
            </button>
          </div>

          <div className="rounded-[28px] bg-surface/40 border border-primary/10 p-6 space-y-5">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-2xl bg-primary/10 flex items-center justify-center text-primary">
                <Settings2 className="w-5 h-5" />
              </div>
              <div>
                <h4 className="text-[15px] font-black text-on-surface">{t('settings.extensions.coreActionsTitle')}</h4>
                <p className="text-[12px] text-on-surface/45 mt-1">{t('settings.extensions.coreActionsDescription')}</p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {CORE_CONTEXT_ACTIONS.map(action => (
                <span key={action} className="px-3 py-2 rounded-xl bg-primary/5 border border-primary/10 text-[12px] font-black text-on-surface/65">{t(`settings.extensions.coreActions.${action}`)}</span>
              ))}
            </div>
          </div>

          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h4 className="text-[15px] font-black text-on-surface">{t('settings.extensions.customActionsTitle')}</h4>
              <span className="text-[11px] font-black text-on-surface/35 uppercase tracking-widest">{t('settings.extensions.templateVariables')}: {'{path}'} {'{dir}'} {'{name}'} {'{currentPath}'}</span>
            </div>
            {extensions.length === 0 ? (
              <div className="rounded-[24px] bg-primary/5 border border-dashed border-primary/20 px-8 py-10 text-center">
                <p className="text-[13px] font-bold text-on-surface/45">{t('settings.extensions.emptyCustomActions')}</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-4">
                {extensions.map((ext) => {
                  const actionType = ext.actionType || 'placeholder';
                  const meta = getActionTypeMeta(actionType);
                  const Icon = meta.icon;
                  const detail = actionType === 'terminal'
                    ? `${ext.terminalApp || theme.terminalApp || 'Terminal'} · ${ext.workingDirectory === 'current' ? t('settings.extensions.workingDirectoryCurrent') : t('settings.extensions.workingDirectorySelection')} · ${ext.terminalArgs || t('settings.extensions.openDirectoryOnly')}`
                    : actionType === 'shell'
                      ? `${ext.terminalApp || theme.terminalApp || 'Terminal'} · ${ext.command || t('settings.extensions.commandMissing')}`
                      : actionType === 'url'
                        ? ext.urlTemplate || t('settings.extensions.urlTemplateMissing')
                        : meta.description;
                  return (
                    <div
                      key={ext.id}
                      className={`flex items-center justify-between gap-6 px-6 py-5 rounded-[24px] border transition-all duration-300 group ${ext.enabled ? 'bg-primary/10 border-primary/20' : 'bg-primary/5 border-transparent opacity-65'}`}
                    >
                      <div className="flex items-center gap-5 min-w-0">
                        <div className={`w-12 h-12 rounded-xl flex items-center justify-center transition-all shadow-sm shrink-0 ${ext.enabled ? 'bg-primary text-on-primary' : 'bg-primary/20 text-on-surface'}`}>
                          <Icon className="w-5 h-5" />
                        </div>
                        <div className="space-y-1 min-w-0">
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="text-[15px] font-black text-on-surface truncate">{ext.label}</span>
                            <span className="text-[9px] font-black bg-on-surface/10 text-on-surface/60 px-2 py-0.5 rounded-full uppercase tracking-widest shrink-0">{meta.label}</span>
                          </div>
                          <p className="text-[11px] text-on-surface/50 font-bold truncate">{detail}</p>
                        </div>
                      </div>

                      <div className="flex items-center gap-4 shrink-0">
                        {!ext.isSystem && (
                          <button
                            onClick={() => populateActionForm(ext)}
                            className="p-3 text-on-surface/25 hover:text-primary hover:bg-primary/10 rounded-xl transition-all opacity-0 group-hover:opacity-100"
                            aria-label={t('settings.extensions.editAction', { label: ext.label })}
                          >
                            <Pencil className="w-5 h-5" />
                          </button>
                        )}
                        {!ext.isSystem && (
                          <button
                            onClick={() => handleDeleteExtension(ext.id, ext.label)}
                            className="p-3 text-on-surface/25 hover:text-red-500 hover:bg-red-500/10 rounded-xl transition-all opacity-0 group-hover:opacity-100"
                            aria-label={t('settings.extensions.deleteAction', { label: ext.label })}
                          >
                            <Trash2 className="w-5 h-5" />
                          </button>
                        )}
                        {ext.isSystem && (
                          <span className="text-[9px] font-black text-on-surface/25 uppercase tracking-widest px-2 py-1 bg-on-surface/5 rounded-lg">{t('settings.extensions.systemBuiltIn')}</span>
                        )}
                        <button
                          onClick={() => toggleExtension(ext.id)}
                          className={`w-14 h-8 rounded-full p-1.5 transition-colors duration-300 flex items-center ${ext.enabled ? 'bg-primary' : 'bg-on-surface/[0.2]'}`}
                          aria-label={ext.enabled ? t('settings.extensions.disableAction', { label: ext.label }) : t('settings.extensions.enableAction', { label: ext.label })}
                        >
                          <motion.div animate={{ x: ext.enabled ? 24 : 0 }} className={`w-5 h-5 rounded-full shadow-lg ${ext.enabled ? 'bg-on-primary' : 'bg-on-surface/40'}`} />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="p-8 bg-primary/5 rounded-[32px] border-2 border-dashed border-primary/20 space-y-7">
            <div className="flex items-start gap-5">
              <div className="w-14 h-14 rounded-2xl bg-primary/15 flex items-center justify-center text-primary shrink-0">
                <Plus className="w-7 h-7" />
              </div>
              <div>
                <h4 className="text-[16px] font-black text-on-surface">{t('settings.extensions.addCustomAction')}</h4>
                <p className="text-[12px] text-on-surface/45 mt-1 leading-relaxed">{t('settings.extensions.addCustomActionDescription')}</p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <label className="space-y-2">
                <span className="text-[11px] font-black text-on-surface/45 uppercase tracking-wider">{t('settings.extensions.menuLabel')}</span>
                <input
                  type="text"
                  value={newActionLabel}
                  onChange={(e) => setNewActionLabel(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && addExtension()}
                  placeholder={t('placeholders.terminalScriptExample1')}
                  className="w-full bg-white/5 border border-primary/20 rounded-2xl px-5 py-4 text-[13px] font-bold outline-none focus:ring-4 focus:ring-primary/10 transition-all"
                />
              </label>
              <label className="space-y-2">
                <span className="text-[11px] font-black text-on-surface/45 uppercase tracking-wider">{t('settings.extensions.actionType')}</span>
                <select
                  value={newActionType}
                  onChange={(e) => setNewActionType(e.target.value as NonNullable<ContextMenuAction['actionType']>)}
                  className="w-full bg-white/5 border border-primary/20 rounded-2xl px-5 py-4 text-[13px] font-bold text-on-surface outline-none focus:ring-4 focus:ring-primary/10 transition-all"
                >
                  {Object.keys(ACTION_TYPE_ICONS).filter((type) => !type.startsWith('ai-') && type !== 'calculate-hash').map((type) => <option key={type} value={type}>{getActionTypeMeta(type as NonNullable<ContextMenuAction['actionType']>).label}</option>)}
                </select>
              </label>
            </div>

            <div className="rounded-[24px] bg-surface/40 border border-primary/10 p-5 space-y-5">
              <div className="flex items-start gap-4">
                <div className="w-11 h-11 rounded-2xl bg-primary/10 text-primary flex items-center justify-center shrink-0">
                  <CurrentActionIcon className="w-5 h-5" />
                </div>
                <div>
                  <h5 className="text-[13px] font-black text-on-surface">{currentActionMeta.label}</h5>
                  <p className="text-[12px] text-on-surface/45 mt-1 leading-relaxed">{currentActionMeta.description}</p>
                </div>
              </div>

              {(newActionType === 'terminal' || newActionType === 'shell') && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                  <label className="space-y-2">
                    <span className="text-[11px] font-black text-on-surface/45 uppercase tracking-wider">{t('settings.extensions.terminalApp')}</span>
                    <select
                      value={newTerminalApp}
                      onChange={(e) => setNewTerminalApp(e.target.value)}
                      className="w-full bg-white/5 border border-primary/20 rounded-2xl px-5 py-4 text-[13px] font-bold text-on-surface outline-none focus:ring-4 focus:ring-primary/10 transition-all"
                    >
                      {terminalApps.map(app => <option key={app} value={app}>{app}</option>)}
                    </select>
                  </label>
                  <label className="space-y-2">
                    <span className="text-[11px] font-black text-on-surface/45 uppercase tracking-wider">{t('settings.extensions.workingDirectory')}</span>
                    <select
                      value={newWorkingDirectory}
                      onChange={(e) => setNewWorkingDirectory(e.target.value as 'selection' | 'current')}
                      className="w-full bg-white/5 border border-primary/20 rounded-2xl px-5 py-4 text-[13px] font-bold text-on-surface outline-none focus:ring-4 focus:ring-primary/10 transition-all"
                    >
                      <option value="selection">{t('settings.extensions.workingDirectorySelection')}</option>
                      <option value="current">{t('settings.extensions.workingDirectoryCurrent')}</option>
                    </select>
                  </label>
                </div>
              )}

              {newActionType === 'terminal' && (
                <label className="space-y-2 block">
                  <span className="text-[11px] font-black text-on-surface/45 uppercase tracking-wider">{t('settings.extensions.terminalArgs')}</span>
                  <input
                    value={newTerminalArgs}
                    onChange={(e) => setNewTerminalArgs(e.target.value)}
                    placeholder={t('placeholders.terminalScriptExample2')}
                    className="w-full bg-white/5 border border-primary/20 rounded-2xl px-5 py-4 text-[13px] font-mono text-on-surface outline-none focus:ring-4 focus:ring-primary/10 transition-all"
                  />
                </label>
              )}

              {newActionType === 'shell' && (
                <label className="space-y-2 block">
                  <span className="text-[11px] font-black text-on-surface/45 uppercase tracking-wider">{t('settings.extensions.commandTemplate')}</span>
                  <input
                    value={newCommand}
                    onChange={(e) => setNewCommand(e.target.value)}
                    placeholder={t('placeholders.terminalScriptExample3')}
                    className="w-full bg-white/5 border border-primary/20 rounded-2xl px-5 py-4 text-[13px] font-mono text-on-surface outline-none focus:ring-4 focus:ring-primary/10 transition-all"
                  />
                </label>
              )}

              {newActionType === 'url' && (
                <label className="space-y-2 block">
                  <span className="text-[11px] font-black text-on-surface/45 uppercase tracking-wider">{t('settings.extensions.urlTemplate')}</span>
                  <input
                    value={newUrlTemplate}
                    onChange={(e) => setNewUrlTemplate(e.target.value)}
                    placeholder={t('placeholders.searchUrlExample')}
                    className="w-full bg-white/5 border border-primary/20 rounded-2xl px-5 py-4 text-[13px] font-mono text-on-surface outline-none focus:ring-4 focus:ring-primary/10 transition-all"
                  />
                </label>
              )}

              <div className="rounded-2xl bg-primary/5 border border-primary/10 px-5 py-4">
                <p className="text-[11px] font-bold text-on-surface/45 leading-relaxed">{t('settings.extensions.availableVariables')}: <span className="font-mono text-primary">{'{path}'}</span> {t('settings.extensions.variablePath')}, <span className="font-mono text-primary">{'{dir}'}</span> {t('settings.extensions.variableDir')}, <span className="font-mono text-primary">{'{name}'}</span> {t('settings.extensions.variableName')}, <span className="font-mono text-primary">{'{currentPath}'}</span> {t('settings.extensions.variableCurrentPath')}.</p>
                <p className="mt-2 text-[11px] font-bold text-on-surface/40 leading-relaxed">{t('settings.extensions.escapeHint')}</p>
              </div>
            </div>

            <div className="flex justify-end">
              <button
                onClick={addExtension}
                disabled={!isNewActionValid()}
                className="px-8 py-4 bg-primary text-on-primary font-black rounded-2xl shadow-xl shadow-primary/20 disabled:opacity-50 disabled:shadow-none transition-all uppercase tracking-widest text-[12px]"
              >
                {editingExtensionId ? t('settings.extensions.saveChanges') : t('settings.extensions.addAction')}
              </button>
            </div>
          </div>
        </section>
      </div>
    );
}
