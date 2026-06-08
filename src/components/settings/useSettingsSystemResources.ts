import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { getVersion } from '@tauri-apps/api/app';

const DEFAULT_FONTS = ['Inter', 'System Default', 'Arial', 'Segoe UI', 'Roboto', 'Times New Roman'];
const FALLBACK_FONTS = ['Inter', 'System Default', 'Arial', 'Helvetica', 'Times New Roman', 'Courier'];
const DEFAULT_TERMINAL_APPS = ['Terminal', 'iTerm'];

export function useSettingsSystemResources() {
  const [appVersion, setAppVersion] = useState(import.meta.env.VITE_APP_VERSION || '');
  const [availableFonts, setAvailableFonts] = useState<string[]>(DEFAULT_FONTS);
  const [terminalApps, setTerminalApps] = useState<string[]>(DEFAULT_TERMINAL_APPS);

  useEffect(() => {
    let cancelled = false;
    getVersion()
      .then(version => {
        if (!cancelled) setAppVersion(version || import.meta.env.VITE_APP_VERSION || '');
      })
      .catch(() => {
        if (!cancelled) setAppVersion(import.meta.env.VITE_APP_VERSION || '');
      });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    invoke<string[]>('list_fonts')
      .then(fonts => {
        if (!cancelled) setAvailableFonts(['Inter', 'System Default', ...fonts]);
      })
      .catch(() => {
        if (!cancelled) setAvailableFonts(FALLBACK_FONTS);
      });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    invoke<string[]>('list_terminal_apps')
      .then(apps => {
        if (!cancelled) setTerminalApps(apps.length ? apps : DEFAULT_TERMINAL_APPS);
      })
      .catch(() => {
        if (!cancelled) setTerminalApps(DEFAULT_TERMINAL_APPS);
      });
    return () => { cancelled = true; };
  }, []);

  return {
    appVersion,
    availableFonts,
    terminalApps,
    setTerminalApps,
  };
}
