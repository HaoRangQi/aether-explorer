import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { getVersion } from '@tauri-apps/api/app';

const SYSTEM_DEFAULT_FONT_LABEL = 'System Default';
const DEFAULT_FONTS = [SYSTEM_DEFAULT_FONT_LABEL, 'Inter', 'Arial', 'Segoe UI', 'Roboto', 'Times New Roman'];
const FALLBACK_FONTS = [SYSTEM_DEFAULT_FONT_LABEL, 'Inter', 'Arial', 'Helvetica', 'Times New Roman', 'Courier'];
const DEFAULT_TERMINAL_APPS = ['Terminal', 'iTerm'];

function uniqueFonts(fonts: string[]): string[] {
  const seen = new Set<string>();
  return fonts.filter(font => {
    const key = font.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

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
        if (!cancelled) setAvailableFonts(uniqueFonts([SYSTEM_DEFAULT_FONT_LABEL, 'Inter', ...fonts]));
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
