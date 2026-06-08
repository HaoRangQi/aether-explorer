import { useState } from 'react';
import type { ThemeSettings, AIProviderConfig } from '../../types';
import { fetchModels, testProviderConnection } from '../../lib/ai-service';

type UseSettingsAiProvidersArgs = {
  theme: ThemeSettings;
  onThemeChange: (theme: ThemeSettings) => void;
};

export function useSettingsAiProviders({
  theme,
  onThemeChange,
}: UseSettingsAiProvidersArgs) {
  const [aiTestStatus, setAiTestStatus] = useState<Record<string, 'idle' | 'testing' | 'ok' | 'fail'>>({});
  const [aiTestError, setAiTestError] = useState<Record<string, string>>({});
  const [aiModels, setAiModels] = useState<Record<string, string[]>>({});
  const [aiModelLoading, setAiModelLoading] = useState<Record<string, boolean>>({});
  const [aiModelDropdown, setAiModelDropdown] = useState<string | null>(null);
  const [aiModelSearch, setAiModelSearch] = useState('');

  const aiProviders = theme.aiProviders || [];
  const updateProviders = (providers: AIProviderConfig[]) => onThemeChange({ ...theme, aiProviders: providers });

  const addProvider = (type: 'claude' | 'openai' | 'ollama') => {
    const defaults: Record<string, Partial<AIProviderConfig>> = {
      claude: { name: 'Claude', baseUrl: 'https://api.anthropic.com', model: 'claude-sonnet-4-20250514' },
      openai: { name: 'OpenAI', baseUrl: 'https://api.openai.com', model: 'gpt-4o' },
      ollama: { name: 'Ollama (本地)', baseUrl: 'http://localhost:11434', model: 'llama3' },
    };
    const d = defaults[type]!;
    const id = `${type}-${Date.now()}`;
    const newProvider: AIProviderConfig = { id, type, enabled: true, name: d.name!, baseUrl: d.baseUrl, model: d.model };
    const updated = [...aiProviders, newProvider];
    onThemeChange({ ...theme, aiProviders: updated, aiActiveProvider: theme.aiActiveProvider || id });
  };

  const handleTestProvider = async (provider: AIProviderConfig) => {
    setAiTestStatus(s => ({ ...s, [provider.id]: 'testing' }));
    const result = await testProviderConnection(provider);
    setAiTestStatus(s => ({ ...s, [provider.id]: result.ok ? 'ok' : 'fail' }));
    if (result.error) setAiTestError(s => ({ ...s, [provider.id]: result.error! }));
  };

  const handleFetchModels = async (provider: AIProviderConfig) => {
    setAiModelLoading(s => ({ ...s, [provider.id]: true }));
    const result = await fetchModels(provider);
    setAiModelLoading(s => ({ ...s, [provider.id]: false }));
    if (result.error) {
      setAiTestError(s => ({ ...s, [provider.id]: result.error! }));
    } else {
      setAiModels(s => ({ ...s, [provider.id]: result.models }));
    }
  };

  return {
    aiProviders,
    updateProviders,
    addProvider,
    aiTestStatus,
    aiTestError,
    aiModels,
    aiModelLoading,
    aiModelDropdown,
    setAiModelDropdown,
    aiModelSearch,
    setAiModelSearch,
    handleFetchModels,
    handleTestProvider,
  };
}
