import { useCallback, useState } from 'react';
import { confirm as tauriConfirm, open, save } from '@tauri-apps/plugin-dialog';
import { readTextFile, writeTextFile } from '@tauri-apps/plugin-fs';
import type { TFunction } from 'i18next';
import type { ThemeSettings } from '../../types';
import {
  buildSettingsBackup,
  sanitizeImportedContextMenuExtensions,
  sanitizeImportedSettingsBackup,
  type ImportedSettingsBackup,
} from '../../lib/settings';
import { normalizeAppError } from '../../lib/app-error';
import { DEFAULT_BACKUP_STATUS } from './settings-view-constants';
import type { BackupStatus } from './settings-view-types';
import { countFileTagEntries } from './settings-view-utils';

type UseSettingsBackupArgs = {
  t: TFunction;
  theme: ThemeSettings;
  favorites: string[];
  fileTags: Record<string, string[]>;
  recentItems: string[];
  appVersion: string;
  onImport?: (data: ImportedSettingsBackup) => void;
  onResetAllData?: () => void;
  onThemeChange: (theme: ThemeSettings) => void;
};

export function useSettingsBackup({
  t,
  theme,
  favorites,
  fileTags,
  recentItems,
  appVersion,
  onImport,
  onResetAllData,
  onThemeChange,
}: UseSettingsBackupArgs) {
  const [backupStatus, setBackupStatus] = useState<BackupStatus>(DEFAULT_BACKUP_STATUS);

  const buildImportConfirmMessage = useCallback((backup: ImportedSettingsBackup): string => {
    const lines: string[] = [];
    if (backup.theme) {
      lines.push(t('settings.importConfirm.theme'));
    }
    if (backup.favorites) {
      lines.push(t('settings.importConfirm.favorites', {
        imported: backup.favorites.length,
        current: favorites.length,
      }));
    }
    if (backup.fileTags) {
      lines.push(t('settings.importConfirm.fileTags', {
        imported: countFileTagEntries(backup.fileTags),
        current: countFileTagEntries(fileTags),
      }));
    }
    if (backup.recentItems) {
      lines.push(t('settings.importConfirm.recentItems', {
        imported: backup.recentItems.length,
        current: recentItems.length,
      }));
    }

    return [
      t('settings.importConfirm.title'),
      '',
      t('settings.importConfirm.intro'),
      ...lines.map(line => `- ${line}`),
      '',
      t('settings.importConfirm.warning'),
    ].join('\n');
  }, [favorites.length, fileTags, recentItems.length, t]);

  const handleExportSettingsBackup = useCallback(async () => {
    setBackupStatus({ loading: true, kind: 'idle', message: t('settings.backup.exporting') });
    try {
      const path = await save({
        defaultPath: `aether-backup-${new Date().toISOString().slice(0, 10)}.json`,
        filters: [{ name: 'JSON', extensions: ['json'] }],
      });
      if (!path) {
        setBackupStatus(DEFAULT_BACKUP_STATUS);
        return;
      }
      const data = buildSettingsBackup({
        theme,
        favorites,
        fileTags,
        recentItems,
        appVersion: appVersion || import.meta.env.VITE_APP_VERSION || '0.0.0',
      });
      await writeTextFile(path, JSON.stringify(data, null, 2));
      setBackupStatus({ loading: false, kind: 'ok', message: t('settings.backup.exported') });
    } catch (err) {
      setBackupStatus({
        loading: false,
        kind: 'error',
        message: t('settings.backup.exportFailed', { error: normalizeAppError(err).userMessage }),
      });
    }
  }, [appVersion, favorites, fileTags, recentItems, t, theme]);

  const handleImportSettingsBackup = useCallback(async () => {
    setBackupStatus({ loading: true, kind: 'idle', message: t('settings.backup.importing') });
    try {
      const path = await open({
        multiple: false,
        filters: [{ name: 'JSON', extensions: ['json'] }],
      });
      if (!path || typeof path !== 'string') {
        setBackupStatus(DEFAULT_BACKUP_STATUS);
        return;
      }
      const raw = await readTextFile(path);
      const data = JSON.parse(raw);
      const sanitized = sanitizeImportedSettingsBackup(data);
      const shouldImport = await tauriConfirm(buildImportConfirmMessage(sanitized), {
        title: t('settings.backup.import'),
        kind: 'warning',
      });
      if (!shouldImport) {
        setBackupStatus(DEFAULT_BACKUP_STATUS);
        return;
      }
      onImport?.(sanitized);
      setBackupStatus({ loading: false, kind: 'ok', message: t('settings.backup.imported') });
    } catch (err) {
      setBackupStatus({
        loading: false,
        kind: 'error',
        message: t('settings.backup.importFailed', { error: normalizeAppError(err).userMessage }),
      });
    }
  }, [buildImportConfirmMessage, onImport, t]);

  const handleResetAllSettingsData = useCallback(async () => {
    const ok = await tauriConfirm(t('settings.backup.resetConfirm'), {
      title: t('settings.backup.resetAll'),
      kind: 'warning',
    });
    if (!ok) return;
    try {
      onResetAllData?.();
      setBackupStatus({ loading: false, kind: 'ok', message: t('settings.backup.resetDone') });
    } catch (err) {
      setBackupStatus({
        loading: false,
        kind: 'error',
        message: t('settings.backup.resetFailed', { error: normalizeAppError(err).userMessage }),
      });
    }
  }, [onResetAllData, t]);

  const handleExportExtensions = useCallback(async () => {
    const path = await save({
      defaultPath: 'aether-context-menu.json',
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (!path) return;
    const payload = JSON.stringify(theme.contextMenuExtensions || [], null, 2);
    try {
      await writeTextFile(path, payload);
    } catch (err) {
      console.error('导出失败', err);
    }
  }, [theme.contextMenuExtensions]);

  const handleImportExtensions = useCallback(async () => {
    const selected = await open({
      multiple: false,
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (!selected || typeof selected !== 'string') return;
    try {
      const content = await readTextFile(selected);
      const parsed = JSON.parse(content);
      const normalized = sanitizeImportedContextMenuExtensions(parsed);
      onThemeChange({ ...theme, contextMenuExtensions: normalized });
    } catch (err) {
      console.error('导入失败', err);
    }
  }, [onThemeChange, theme]);

  return {
    backupStatus,
    handleExportSettingsBackup,
    handleImportSettingsBackup,
    handleResetAllSettingsData,
    handleExportExtensions,
    handleImportExtensions,
  };
}
