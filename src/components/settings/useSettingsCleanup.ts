import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type { TFunction } from 'i18next';
import { normalizeAppError } from '../../lib/app-error';

export function useSettingsCleanup(t: TFunction) {
  const [cleanupStatus, setCleanupStatus] = useState({ cleaning: false, message: '' });
  const resetTimerRef = useRef<number | null>(null);

  useEffect(() => () => {
    if (resetTimerRef.current) {
      window.clearTimeout(resetTimerRef.current);
    }
  }, []);

  const handleCleanup = async () => {
    if (resetTimerRef.current) {
      window.clearTimeout(resetTimerRef.current);
      resetTimerRef.current = null;
    }
    setCleanupStatus({ cleaning: true, message: t('settings.cleanup.cleaning') });

    try {
      const keysToRemove: string[] = [];
      for (let i = 0; i < localStorage.length; i += 1) {
        const key = localStorage.key(i);
        if (key && (key.startsWith('aether-dragging-') || key.includes('-cache-') || key.includes('-temp-'))) {
          keysToRemove.push(key);
        }
      }
      keysToRemove.forEach(key => localStorage.removeItem(key));
      sessionStorage.clear();

      try {
        await invoke('clear_app_cache');
      } catch {
        // optional backend cleanup
      }

      setCleanupStatus({
        cleaning: false,
        message: t('settings.cleanup.done', { count: keysToRemove.length }),
      });
      resetTimerRef.current = window.setTimeout(() => {
        setCleanupStatus({ cleaning: false, message: '' });
        resetTimerRef.current = null;
      }, 3000);
    } catch (err) {
      setCleanupStatus({
        cleaning: false,
        message: t('settings.cleanup.failed', { error: normalizeAppError(err).userMessage }),
      });
    }
  };

  return {
    cleanupStatus,
    handleCleanup,
  };
}
