import { motion } from 'motion/react';
import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { Monitor, Terminal, RefreshCw, Upload, Plus, Folder, X } from 'lucide-react';

export default function FeaturesSettings(props: any) {
  const { t, theme, onThemeChange, terminalApps, setTerminalApps } = props;

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <section className="bg-primary/5 rounded-[32px] p-10 border border-primary/10 space-y-8">
        <h3 className="text-[18px] font-black text-on-surface flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-2xl bg-primary/10 flex items-center justify-center">
            <Monitor className="w-5 h-5 text-primary" />
          </div>
          窗口与标签页
        </h3>

        <div className="space-y-2">
          <div className="flex items-center justify-between p-6 bg-primary/5 rounded-2xl border border-transparent hover:border-primary/20 transition-all group">
            <div className="space-y-1">
              <h4 className="text-[15px] font-bold text-on-surface">Cmd+N 新建独立窗口</h4>
              <p className="text-[12px] text-on-surface/50">开启后 Cmd+N / 加号会新建独立窗口；关闭时默认新建标签页。拖出标签页始终会分离成窗口。</p>
            </div>
            <button
              onClick={() => onThemeChange({ ...theme, enableMultiWindow: !theme.enableMultiWindow })}
              className={`w-14 h-8 rounded-full p-1.5 transition-colors duration-300 flex items-center ${theme.enableMultiWindow ? 'bg-primary' : 'bg-on-surface/[0.1]'}`}
            >
              <motion.div animate={{ x: theme.enableMultiWindow ? 24 : 0 }} className="w-5 h-5 rounded-full shadow-lg bg-white" />
            </button>
          </div>

          <div className="flex items-center justify-between p-6 bg-primary/5 rounded-2xl border border-transparent hover:border-primary/20 transition-all group">
            <div className="space-y-1">
              <h4 className="text-[15px] font-bold text-on-surface">使用系统右键菜单</h4>
              <p className="text-[12px] text-on-surface/50">关闭应用内自定义右键菜单，交给 WebView / macOS 默认菜单；文件操作仍可通过工具栏、快捷键和预览面板完成。</p>
            </div>
            <button
              onClick={() => onThemeChange({ ...theme, useSystemContextMenu: !theme.useSystemContextMenu })}
              className={`w-14 h-8 rounded-full p-1.5 transition-colors duration-300 flex items-center ${theme.useSystemContextMenu ? 'bg-primary' : 'bg-on-surface/[0.1]'}`}
            >
              <motion.div animate={{ x: theme.useSystemContextMenu ? 24 : 0 }} className="w-5 h-5 rounded-full shadow-lg bg-white" />
            </button>
          </div>

          <div className="flex items-center justify-between p-6 bg-primary/5 rounded-2xl border border-transparent hover:border-primary/20 transition-all group">
            <div className="space-y-1">
              <h4 className="text-[15px] font-bold text-on-surface">空格键预览</h4>
              <p className="text-[12px] text-on-surface/50">按空格键调用 macOS Quick Look 快速预览选中文件。</p>
            </div>
            <button
              onClick={() => onThemeChange({ ...theme, enableSpacePreview: theme.enableSpacePreview === false })}
              className={`w-14 h-8 rounded-full p-1.5 transition-colors duration-300 flex items-center ${theme.enableSpacePreview !== false ? 'bg-primary' : 'bg-on-surface/[0.1]'}`}
            >
              <motion.div animate={{ x: theme.enableSpacePreview !== false ? 24 : 0 }} className={`w-5 h-5 rounded-full shadow-lg ${theme.enableSpacePreview !== false ? 'bg-on-primary' : 'bg-on-surface/30'}`} />
            </button>
          </div>

          <div className="flex items-center justify-between p-6 bg-primary/5 rounded-2xl border border-transparent hover:border-primary/20 transition-all group">
            <div className="space-y-1">
              <h4 className="text-[15px] font-bold text-on-surface">开发者控制台</h4>
              <p className="text-[12px] text-on-surface/50">开启后在底部状态栏右下角显示「控制台」按钮，点击即可打开 WebView 开发者工具。正式版本中也能使用。</p>
            </div>
            <button
              onClick={() => onThemeChange({ ...theme, enableDevTools: !theme.enableDevTools })}
              className={`w-14 h-8 rounded-full p-1.5 transition-colors duration-300 flex items-center ${theme.enableDevTools ? 'bg-primary' : 'bg-on-surface/[0.1]'}`}
            >
              <motion.div animate={{ x: theme.enableDevTools ? 24 : 0 }} className="w-5 h-5 rounded-full shadow-lg bg-white" />
            </button>
          </div>
        </div>
      </section>

      <section className="bg-primary/5 rounded-[32px] p-10 border border-primary/10 space-y-6">
        <h3 className="text-[18px] font-black text-on-surface">快捷键参考</h3>
        <div className="grid grid-cols-2 gap-3 text-[13px]">
          {[
            ['Cmd+A', '全选'],
            ['Cmd+C', '复制到文件剪贴板'],
            ['Cmd+N', '新建窗口（需开启多窗口）'],
            ['Cmd+W', '关闭标签'],
            ['Delete', '移至废纸篓'],
            ['Enter', '打开文件'],
            ['Space', 'Quick Look'],
            ['Cmd+I', '文件简介'],
            ['Cmd+Shift+R', 'AI 批量重命名'],
          ].map(([key, desc]) => (
            <div key={key} className="flex items-center gap-3 px-4 py-3 bg-primary/5 rounded-xl">
              <kbd className="px-2 py-1 bg-primary/10 border border-primary/20 rounded-md text-[11px] font-mono font-bold text-primary whitespace-nowrap">{key}</kbd>
              <span className="text-on-surface/60">{desc}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="bg-primary/5 rounded-[32px] p-10 border border-primary/10 space-y-6">
        <h3 className="text-[18px] font-black text-on-surface flex items-center gap-3">
          <Terminal className="w-5 h-5 text-primary" /> 终端偏好
        </h3>
        <label className="space-y-2 block">
          <span className="text-[12px] font-black text-on-surface/50 uppercase tracking-wider">默认终端</span>
          <div className="flex gap-2">
            <select
              value={theme.terminalApp || 'Terminal'}
              onChange={(e) => onThemeChange({ ...theme, terminalApp: e.target.value })}
              className="flex-1 bg-primary/5 border border-primary/20 rounded-2xl px-5 py-4 text-[14px] text-on-surface font-bold outline-none focus:border-primary"
            >
              {terminalApps.map(app => <option key={app} value={app}>{app}</option>)}
            </select>
            <button
              onClick={() => {
                invoke<string[]>('list_terminal_apps').then(apps => setTerminalApps(apps.length ? apps : ['Terminal', 'iTerm']));
              }}
              className="px-4 bg-primary/10 hover:bg-primary/20 rounded-2xl text-[12px] font-bold text-primary transition-colors"
              title={t('tooltips.refreshTerminalList')}
            >
              <RefreshCw className="w-4 h-4" />
            </button>
            <button
              onClick={async () => {
                try {
                  const result = await open({ multiple: false, directory: false, filters: [{ name: '应用', extensions: ['app'] }] });
                  if (result && typeof result === 'string') {
                    const appName = result.split('/').pop()?.replace('.app', '') || result;
                    if (!terminalApps.includes(appName)) {
                      const newApps = [...terminalApps, appName];
                      setTerminalApps(newApps);
                      onThemeChange({ ...theme, terminalApp: appName });
                    } else {
                      onThemeChange({ ...theme, terminalApp: appName });
                    }
                  }
                } catch {}
              }}
              className="px-4 bg-primary/10 hover:bg-primary/20 rounded-2xl text-[12px] font-bold text-primary transition-colors"
              title={t('tooltips.selectTerminalApp')}
            >
              <Upload className="w-4 h-4" />
            </button>
          </div>
        </label>

        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-[12px] font-black text-on-surface/50 uppercase tracking-wider">启动后执行脚本</span>
            <button
              onClick={() => {
                const scripts = [...(theme.terminalScripts || []), { script: '', enabled: true }];
                onThemeChange({ ...theme, terminalScripts: scripts });
              }}
              className="px-3 py-1.5 bg-primary/10 hover:bg-primary/20 rounded-xl text-[11px] font-bold text-primary transition-colors flex items-center gap-1.5"
            >
              <Plus className="w-3.5 h-3.5" /> 添加行
            </button>
          </div>
          {(theme.terminalScripts || []).length === 0 ? (
            <p className="text-[12px] text-on-surface/30 py-3">未配置脚本。点击"添加行"开始。</p>
          ) : (
            (theme.terminalScripts || []).map((item, idx) => (
              <div key={idx} className="flex gap-2 items-center">
                <input
                  type="checkbox"
                  checked={item.enabled}
                  onChange={() => {
                    const scripts = [...(theme.terminalScripts || [])];
                    scripts[idx] = { ...scripts[idx], enabled: !scripts[idx].enabled };
                    onThemeChange({ ...theme, terminalScripts: scripts });
                  }}
                  className="w-3.5 h-3.5 accent-primary cursor-pointer shrink-0"
                />
                <input
                  value={item.script}
                  onChange={(e) => {
                    const scripts = [...(theme.terminalScripts || [])];
                    scripts[idx] = { ...scripts[idx], script: e.target.value };
                    onThemeChange({ ...theme, terminalScripts: scripts });
                  }}
                  placeholder={`第 ${idx + 1} 行：例如 npm run dev`}
                  className={`flex-1 bg-primary/5 border border-primary/20 rounded-xl px-4 py-3 text-[13px] font-mono outline-none focus:border-primary ${item.enabled ? 'text-on-surface' : 'text-on-surface/30 line-through'}`}
                />
                <button
                  onClick={async () => {
                    try {
                      const result = await open({ multiple: false, directory: false, filters: [{ name: '脚本', extensions: ['sh', 'bash', 'zsh', 'command', 'py', 'js', 'ts'] }] });
                      if (result && typeof result === 'string') {
                        const scripts = [...(theme.terminalScripts || [])];
                        scripts[idx] = { ...scripts[idx], script: result };
                        onThemeChange({ ...theme, terminalScripts: scripts });
                      }
                    } catch {}
                  }}
                  className="p-2.5 bg-primary/10 hover:bg-primary/20 rounded-xl text-primary transition-colors shrink-0"
                  title={t('tooltips.selectScriptFile')}
                >
                  <Folder className="w-4 h-4" />
                </button>
                <button
                  onClick={() => {
                    const scripts = (theme.terminalScripts || []).filter((_, i) => i !== idx);
                    onThemeChange({ ...theme, terminalScripts: scripts.length ? scripts : undefined });
                  }}
                  className="p-2.5 hover:bg-red-500/10 rounded-xl text-on-surface/40 hover:text-red-500 transition-colors shrink-0"
                  title={t('tooltips.deleteThisLine')}
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            ))
          )}
          {((theme.terminalScripts || []).length > 0) && (
            <p className="text-[11px] text-on-surface/30">每行按顺序依次执行。勾选框控制启用/禁用。</p>
          )}
        </div>

        <label className="space-y-2 block">
          <span className="text-[12px] font-black text-on-surface/50 uppercase tracking-wider">自定义命令（高级，可选）</span>
          <input
            value={theme.customTerminalCommand || ''}
            onChange={(e) => onThemeChange({ ...theme, customTerminalCommand: e.target.value })}
            placeholder={t('placeholders.beforeEnterDir')}
            className="w-full bg-primary/5 border border-primary/20 rounded-2xl px-5 py-4 text-[13px] text-on-surface font-mono outline-none focus:border-primary"
          />
        </label>
      </section>
    </div>
  );
}
