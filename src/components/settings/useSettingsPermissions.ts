import { useCallback, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type { TFunction } from 'i18next';

export function useSettingsPermissions(t: TFunction) {
  const [permChecks, setPermChecks] = useState<{path: string; label: string; ok: boolean | null}[]>([]);
  const [permChecksLoaded, setPermChecksLoaded] = useState(false);

  const checkPermissions = useCallback(async () => {
    try {
      const home = await invoke<string>('get_home_dir');
      const dirs = [
        { path: `${home}/Documents`, label: t('settings.permissions.documents') },
        { path: `${home}/Desktop`, label: t('settings.permissions.desktop') },
        { path: `${home}/Downloads`, label: t('settings.permissions.downloads') },
        { path: `${home}/.Trash`, label: t('settings.permissions.trash') },
        { path: '/Applications', label: t('settings.permissions.applications') },
      ];
      const results = await Promise.all(dirs.map(async d => {
        try {
          await invoke('list_directory', { dirPath: d.path, showHidden: false });
          return { ...d, ok: true };
        } catch {
          return { ...d, ok: false };
        }
      }));
      setPermChecks(results);
      setPermChecksLoaded(true);
    } catch {
      setPermChecks([]);
      setPermChecksLoaded(true);
    }
  }, [t]);

  return {
    permChecks,
    permChecksLoaded,
    checkPermissions,
  };
}
