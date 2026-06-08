import { motion } from 'motion/react';
import { ChevronDown, Trash2, Sparkles, RefreshCw, Loader2 } from 'lucide-react';
import { getProviderApiUrl } from '../../lib/ai-service';

export default function AiProviderSettings(props: any) {
  const { theme, onThemeChange, aiProviders, updateProviders, addProvider, aiTestStatus, aiTestError, aiModels, aiModelLoading, aiModelDropdown, setAiModelDropdown, aiModelSearch, setAiModelSearch, handleFetchModels, handleTestProvider } = props;

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* 添加服务商 */}
      <div className="flex items-center gap-3">
        <span className="text-[12px] font-black text-on-surface/40 uppercase tracking-wider">添加服务商</span>
        <div className="flex gap-2">
          {[
            { type: 'claude' as const, label: 'Claude' },
            { type: 'openai' as const, label: 'OpenAI / 中转站' },
            { type: 'ollama' as const, label: 'Ollama 本地' },
          ].map(item => (
            <button
              key={item.type}
              onClick={() => addProvider(item.type)}
              className="px-4 py-2 bg-primary/10 hover:bg-primary/20 rounded-xl text-[12px] font-bold text-primary transition-colors"
            >
              + {item.label}
            </button>
          ))}
        </div>
      </div>

      {aiProviders.length === 0 && (
        <div className="text-center py-16 text-on-surface/25">
          <Sparkles className="w-10 h-10 mx-auto mb-4 opacity-30" />
          <p className="text-[14px] font-medium">尚未配置 AI 服务</p>
          <p className="text-[12px] mt-2">点击上方按钮添加一个服务商，用于 AI 批量重命名等智能功能</p>
        </div>
      )}

      {/* Provider 列表 */}
      {aiProviders.map((provider, idx) => (
        <section key={provider.id} className={`rounded-[28px] p-8 border space-y-5 transition-all ${theme.aiActiveProvider === provider.id ? 'bg-primary/10 border-primary/30' : 'bg-primary/5 border-primary/10'}`}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <button
                onClick={() => onThemeChange({ ...theme, aiActiveProvider: provider.id })}
                className={`w-4 h-4 rounded-full border-2 transition-colors ${theme.aiActiveProvider === provider.id ? 'border-primary bg-primary' : 'border-on-surface/20 hover:border-primary/50'}`}
              >
                {theme.aiActiveProvider === provider.id && <div className="w-1.5 h-1.5 rounded-full bg-white mx-auto mt-[3px]" />}
              </button>
              <input
                value={provider.name}
                onChange={e => { const p = [...aiProviders]; p[idx] = { ...p[idx], name: e.target.value }; updateProviders(p); }}
                className="text-[15px] font-black text-on-surface bg-transparent outline-none border-b border-transparent focus:border-primary/30 w-48"
              />
              <span className="text-[10px] font-bold text-on-surface/30 uppercase bg-primary/5 px-2 py-0.5 rounded">{provider.type}</span>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => { const p = [...aiProviders]; p[idx] = { ...p[idx], enabled: !p[idx].enabled }; updateProviders(p); }}
                className={`w-9 h-5 rounded-full p-0.5 transition-colors ${provider.enabled ? 'bg-primary' : 'bg-on-surface/15'}`}
              >
                <motion.div animate={{ x: provider.enabled ? 16 : 0 }} className="w-4 h-4 rounded-full bg-white shadow" />
              </button>
              <button
                onClick={() => updateProviders(aiProviders.filter((_, i) => i !== idx))}
                className="p-1.5 hover:bg-red-500/10 rounded-lg text-on-surface/30 hover:text-red-500 transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          <div className="space-y-6">
            {provider.type !== 'ollama' && (
              <label className="space-y-2 block">
                <span className="text-[11px] font-black text-on-surface/30 uppercase tracking-[0.2em]">API Key</span>
                <input
                  type="password"
                  value={provider.apiKey || ''}
                  onChange={e => { const p = [...aiProviders]; p[idx] = { ...p[idx], apiKey: e.target.value || undefined }; updateProviders(p); }}
                  placeholder={provider.type === 'claude' ? 'sk-ant-...' : 'sk-...'}
                  className="w-full bg-primary/5 border border-primary/20 rounded-2xl px-5 py-4 text-[13px] font-mono outline-none focus:border-primary focus:ring-4 focus:ring-primary/10 transition-all"
                />
              </label>
            )}
            <label className="space-y-2 block">
              <span className="text-[11px] font-black text-on-surface/30 uppercase tracking-[0.2em]">Base URL</span>
              <input
                value={provider.baseUrl || ''}
                onChange={e => { const p = [...aiProviders]; p[idx] = { ...p[idx], baseUrl: e.target.value }; updateProviders(p); }}
                placeholder={provider.type === 'ollama' ? 'http://localhost:11434' : provider.type === 'claude' ? 'https://api.anthropic.com' : 'https://api.openai.com'}
                className="w-full bg-primary/5 border border-primary/20 rounded-2xl px-5 py-4 text-[13px] font-mono outline-none focus:border-primary focus:ring-4 focus:ring-primary/10 transition-all"
              />
              <p className="text-[11px] text-on-surface/25 font-mono mt-1.5 pl-1">→ {getProviderApiUrl(provider)}</p>
            </label>

            <div className="space-y-2">
              <span className="text-[11px] font-black text-on-surface/30 uppercase tracking-[0.2em]">模型</span>
              <div className="flex gap-3">
                <div className="flex-1 relative">
                  <button
                    onClick={() => { setAiModelDropdown(aiModelDropdown === provider.id ? null : provider.id); setAiModelSearch(''); }}
                    className="w-full bg-primary/5 border border-primary/20 rounded-2xl px-5 py-4 text-[13px] text-on-surface font-bold outline-none text-left flex items-center justify-between transition-all hover:border-primary/40"
                  >
                    <span className={provider.model ? 'text-on-surface' : 'text-on-surface/30'}>{provider.model || '选择模型...'}</span>
                    <ChevronDown className={`w-4 h-4 text-on-surface/30 transition-transform ${aiModelDropdown === provider.id ? 'rotate-180' : ''}`} />
                  </button>
                  {aiModelDropdown === provider.id && (
                    <div className="absolute top-full left-0 right-0 mt-2 z-50 bg-surface/95 backdrop-blur-3xl border border-primary/20 rounded-2xl shadow-2xl overflow-hidden">
                      <div className="p-3 border-b border-primary/10">
                        <input
                          value={aiModelSearch}
                          onChange={e => setAiModelSearch(e.target.value)}
                          placeholder="搜索模型..."
                          autoFocus
                          className="w-full bg-primary/5 border border-primary/10 rounded-xl px-4 py-2.5 text-[12px] outline-none focus:border-primary"
                        />
                      </div>
                      <div className="max-h-[240px] overflow-y-auto p-2 space-y-0.5">
                        {(aiModels[provider.id] || [])
                          .filter(m => !aiModelSearch || m.toLowerCase().includes(aiModelSearch.toLowerCase()))
                          .map(m => (
                            <button
                              key={m}
                              onClick={() => { const p = [...aiProviders]; p[idx] = { ...p[idx], model: m }; updateProviders(p); setAiModelDropdown(null); }}
                              className={`w-full text-left px-4 py-2.5 rounded-xl text-[12px] font-mono transition-colors ${provider.model === m ? 'bg-primary/20 text-primary font-bold' : 'text-on-surface/70 hover:bg-primary/10'}`}
                            >
                              {m}
                            </button>
                          ))}
                        {(aiModels[provider.id] || []).filter(m => !aiModelSearch || m.toLowerCase().includes(aiModelSearch.toLowerCase())).length === 0 && (
                          <p className="text-[12px] text-on-surface/30 text-center py-4">
                            {(aiModels[provider.id] || []).length === 0 ? '点击「获取模型」拉取列表' : '无匹配结果'}
                          </p>
                        )}
                      </div>
                    </div>
                  )}
                </div>
                <button
                  onClick={() => handleFetchModels(provider)}
                  disabled={aiModelLoading[provider.id]}
                  className="px-5 bg-primary/10 hover:bg-primary/20 rounded-2xl text-[13px] font-bold text-primary transition-all flex items-center gap-2 disabled:opacity-50 shrink-0"
                >
                  {aiModelLoading[provider.id] ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                  获取模型
                </button>
              </div>
            </div>

            <div className="flex items-center gap-4 pt-2">
              <button
                onClick={() => handleTestProvider(provider)}
                disabled={aiTestStatus[provider.id] === 'testing'}
                className="px-5 py-3 bg-primary/10 hover:bg-primary/20 rounded-2xl text-[13px] font-bold text-primary transition-all flex items-center gap-2 disabled:opacity-50"
              >
                {aiTestStatus[provider.id] === 'testing' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                测试连接
              </button>
              {aiTestStatus[provider.id] === 'ok' && <span className="text-[12px] text-green-500 font-bold">✓ 连接成功</span>}
              {aiTestStatus[provider.id] === 'fail' && (
                <p className="text-[12px] text-red-500 font-medium leading-relaxed break-all flex-1">{aiTestError[provider.id]}</p>
              )}
            </div>
          </div>
        </section>
      ))}

      {/* 使用说明 */}
      <div className="rounded-2xl bg-primary/5 border border-primary/10 p-6 space-y-3">
        <h4 className="text-[13px] font-black text-on-surface/50">使用说明</h4>
        <ul className="text-[12px] text-on-surface/40 space-y-1.5 list-disc list-inside">
          <li>选中多个文件后按 <kbd className="px-1.5 py-0.5 bg-primary/10 rounded text-primary font-mono text-[10px]">⌘⇧R</kbd> 触发 AI 批量重命名</li>
          <li>也可通过右键菜单或工具栏「更多」菜单触发</li>
          <li>中转站：选择 OpenAI 类型，将 Base URL 改为中转站地址即可</li>
          <li>本地模型：确保 Ollama 已启动，填入正确的地址和模型名</li>
          <li>圆点标记 = 当前激活的服务商，AI 功能将使用该服务商</li>
        </ul>
      </div>
    </div>
  );
}
