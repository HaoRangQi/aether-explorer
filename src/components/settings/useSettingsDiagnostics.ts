import { useCallback, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type { TFunction } from 'i18next';
import type { ThemeSettings } from '../../types';
import { normalizeAppError } from '../../lib/app-error';
import { DEFAULT_DIAGNOSTICS_STATUS } from './settings-view-constants';
import type { DiagnosticsStatus } from './settings-view-types';

type UseSettingsDiagnosticsArgs = {
  t: TFunction;
  theme: ThemeSettings;
  appVersion: string;
  selectedLanguage: string;
};

export function useSettingsDiagnostics({
  t,
  theme,
  appVersion,
  selectedLanguage,
}: UseSettingsDiagnosticsArgs) {
  const [diagnosticsStatus, setDiagnosticsStatus] = useState<DiagnosticsStatus>(DEFAULT_DIAGNOSTICS_STATUS);
  const [lastPanicLog, setLastPanicLog] = useState<string | null>(null);

  const buildDiagnosticsReport = useCallback(async () => {
    const logsDir = await invoke<string>('get_logs_dir').catch(() => t('settings.diagnostics.unavailable'));
    const configDir = await invoke<string>('get_config_dir').catch(() => t('settings.diagnostics.unavailable'));
    const payload = {
      app: 'Aether Explorer',
      version: appVersion || import.meta.env.VITE_APP_VERSION || '0.0.0',
      platform: navigator.platform,
      userAgent: navigator.userAgent,
      language: selectedLanguage,
      systemLanguage: navigator.language,
      logsDir,
      configDir,
      settings: {
        mode: theme.mode,
        accentColor: theme.accentColor,
        showHiddenFiles: Boolean(theme.showHiddenFiles),
        showPreviewPanel: Boolean(theme.showPreviewPanel),
        enableMultiWindow: Boolean(theme.enableMultiWindow),
        crossWindowDropDefault: theme.crossWindowDropDefault || 'copy',
        terminalApp: theme.terminalApp || 'Terminal',
        contextMenuExtensions: theme.contextMenuExtensions?.length || 0,
        aiProviders: theme.aiProviders?.map(provider => ({
          id: provider.id,
          name: provider.name,
          type: provider.type,
          enabled: provider.enabled,
          hasApiKey: Boolean(provider.apiKey),
          active: theme.aiActiveProvider === provider.id,
        })) || [],
      },
    };
    return JSON.stringify(payload, null, 2);
  }, [appVersion, selectedLanguage, t, theme]);

  const copyTextToClipboard = useCallback(async (text: string) => {
    await navigator.clipboard.writeText(text);
  }, []);

  const handleCopyDiagnostics = useCallback(async () => {
    setDiagnosticsStatus({ loading: true, kind: 'idle', message: t('settings.diagnostics.collecting') });
    try {
      await copyTextToClipboard(await buildDiagnosticsReport());
      setDiagnosticsStatus({ loading: false, kind: 'ok', message: t('settings.diagnostics.copied') });
    } catch (err) {
      setDiagnosticsStatus({
        loading: false,
        kind: 'error',
        message: t('settings.diagnostics.copyFailed', { error: normalizeAppError(err).userMessage }),
      });
    }
  }, [buildDiagnosticsReport, copyTextToClipboard, t]);

  const handleOpenLogsDir = useCallback(async () => {
    setDiagnosticsStatus({ loading: true, kind: 'idle', message: t('settings.diagnostics.openingLogs') });
    try {
      await invoke('open_logs_dir');
      setDiagnosticsStatus({ loading: false, kind: 'ok', message: t('settings.diagnostics.logsOpened') });
    } catch (err) {
      setDiagnosticsStatus({
        loading: false,
        kind: 'error',
        message: t('settings.diagnostics.openLogsFailed', { error: normalizeAppError(err).userMessage }),
      });
    }
  }, [t]);

  const handleOpenConfigDir = useCallback(async () => {
    setDiagnosticsStatus({ loading: true, kind: 'idle', message: t('settings.diagnostics.openingConfig') });
    try {
      await invoke('open_config_dir');
      setDiagnosticsStatus({ loading: false, kind: 'ok', message: t('settings.diagnostics.configOpened') });
    } catch (err) {
      setDiagnosticsStatus({
        loading: false,
        kind: 'error',
        message: t('settings.diagnostics.openConfigFailed', { error: normalizeAppError(err).userMessage }),
      });
    }
  }, [t]);

  const handleReadLastPanicLog = useCallback(async () => {
    setDiagnosticsStatus({ loading: true, kind: 'idle', message: t('settings.diagnostics.readingPanicLog') });
    try {
      const log = await invoke<string | null>('read_last_panic_log');
      setLastPanicLog(log);
      setDiagnosticsStatus({
        loading: false,
        kind: log ? 'ok' : 'idle',
        message: log ? t('settings.diagnostics.panicLogLoaded') : t('settings.diagnostics.noPanicLog'),
      });
    } catch (err) {
      setDiagnosticsStatus({
        loading: false,
        kind: 'error',
        message: t('settings.diagnostics.readPanicLogFailed', { error: normalizeAppError(err).userMessage }),
      });
    }
  }, [t]);

  const handleCopyPanicLog = useCallback(async () => {
    if (!lastPanicLog) return;
    try {
      await copyTextToClipboard(lastPanicLog);
      setDiagnosticsStatus({ loading: false, kind: 'ok', message: t('settings.diagnostics.panicLogCopied') });
    } catch (err) {
      setDiagnosticsStatus({
        loading: false,
        kind: 'error',
        message: t('settings.diagnostics.copyFailed', { error: normalizeAppError(err).userMessage }),
      });
    }
  }, [copyTextToClipboard, lastPanicLog, t]);

  return {
    diagnosticsStatus,
    lastPanicLog,
    handleCopyDiagnostics,
    handleOpenLogsDir,
    handleOpenConfigDir,
    handleReadLastPanicLog,
    handleCopyPanicLog,
  };
}
