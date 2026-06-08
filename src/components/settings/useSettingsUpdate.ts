import { useCallback, useState } from 'react';
import { getVersion } from '@tauri-apps/api/app';
import { check } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';
import type { TFunction } from 'i18next';
import { normalizeAppError } from '../../lib/app-error';
import { DEFAULT_UPDATE_STATUS } from './settings-view-constants';
import type { UpdateStatus } from './settings-view-types';

export function useSettingsUpdate(t: TFunction) {
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>(DEFAULT_UPDATE_STATUS);

  const handleCheckUpdates = useCallback(async () => {
    setUpdateStatus({
      ...DEFAULT_UPDATE_STATUS,
      state: 'checking',
      message: t('settings.update.checking'),
    });
    try {
      const currentVersion = (await getVersion().catch(() => '')) || '0.1.0';
      const update = await check();
      if (!update) {
        setUpdateStatus({
          ...DEFAULT_UPDATE_STATUS,
          state: 'current',
          currentVersion,
          latestVersion: currentVersion,
          message: t('settings.update.alreadyLatest', { version: currentVersion }),
        });
        return;
      }
      const latestVersion = update.version || '';
      const releaseUrl = `https://github.com/HaoRangQi/aether-explorer/releases/tag/v${latestVersion}`;
      setUpdateStatus({
        ...DEFAULT_UPDATE_STATUS,
        state: 'available',
        currentVersion: update.currentVersion || currentVersion,
        latestVersion,
        releaseUrl,
        notes: update.body || '',
        pubDate: update.date || '',
        message: t('settings.update.foundNew', { version: latestVersion }),
      });
    } catch (err) {
      setUpdateStatus({
        ...DEFAULT_UPDATE_STATUS,
        state: 'error',
        message: t('settings.update.checkFailed', { error: normalizeAppError(err).userMessage }),
      });
    }
  }, [t]);

  const handleDownloadUpdate = useCallback(async () => {
    try {
      const update = await check();
      if (!update) {
        setUpdateStatus(prev => ({
          ...prev,
          state: 'current',
          message: t('settings.update.noUpdateOnDownload'),
        }));
        return;
      }
      setUpdateStatus(prev => ({
        ...prev,
        state: 'downloading',
        downloaded: 0,
        contentLength: 0,
        message: t('settings.update.preparing'),
      }));
      let downloaded = 0;
      let contentLength = 0;
      await update.downloadAndInstall(event => {
        switch (event.event) {
          case 'Started':
            contentLength = event.data.contentLength ?? 0;
            setUpdateStatus(prev => ({
              ...prev,
              state: 'downloading',
              downloaded: 0,
              contentLength,
              message: t('settings.update.downloading'),
            }));
            break;
          case 'Progress':
            downloaded += event.data.chunkLength ?? 0;
            setUpdateStatus(prev => ({
              ...prev,
              state: 'downloading',
              downloaded,
              message: t('settings.update.downloading'),
            }));
            break;
          case 'Finished':
            setUpdateStatus(prev => ({
              ...prev,
              state: 'installing',
              downloaded: prev.contentLength || downloaded,
              message: t('settings.update.installing'),
            }));
            break;
        }
      });
      setUpdateStatus(prev => ({
        ...prev,
        state: 'restarting',
        message: t('settings.update.restarting'),
      }));
      await relaunch();
    } catch (err) {
      setUpdateStatus(prev => ({
        ...prev,
        state: 'error',
        message: t('settings.update.installFailed', { error: normalizeAppError(err).userMessage }),
      }));
    }
  }, [t]);

  return {
    updateStatus,
    handleCheckUpdates,
    handleDownloadUpdate,
  };
}
