import { useEffect, useMemo, useState } from 'react';
import type { TFunction, i18n as I18nInstance } from 'i18next';
import { open } from '@tauri-apps/plugin-dialog';
import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import type { ThemeSettings } from '../../types';
import { isValidWallpaperUrl } from '../../lib/url-guard';
import { normalizeAppError } from '../../lib/app-error';
import {
  AVAILABLE_LANGUAGE_SLOTS,
  BUILT_IN_LANGUAGES,
} from './settings-view-constants';
import type { NativeLiquidGlassStatus } from './settings-view-types';
import { resolveCurrentAppearance } from './settings-view-utils';

type UseSettingsAppearanceArgs = {
  i18n: I18nInstance;
  t: TFunction;
  theme: ThemeSettings;
  onThemeChange: (theme: ThemeSettings) => void;
  onNavigateToHome?: () => void;
};

export function useSettingsAppearance({
  i18n,
  t,
  theme,
  onThemeChange,
  onNavigateToHome,
}: UseSettingsAppearanceArgs) {
  const [showLanguageManager, setShowLanguageManager] = useState(false);
  const [showMediaGridControls, setShowMediaGridControls] = useState(false);
  const [wallpaperUrlError, setWallpaperUrlError] = useState('');
  const [wallpaperUrlDraft, setWallpaperUrlDraft] = useState(theme.wallpaperUrl || '');
  const [liquidGlassStatus, setLiquidGlassStatus] = useState<NativeLiquidGlassStatus | null>(null);
  const [liquidGlassMessage, setLiquidGlassMessage] = useState('');
  const [isTogglingLiquidGlass, setIsTogglingLiquidGlass] = useState(false);

  useEffect(() => {
    setWallpaperUrlDraft(theme.wallpaperUrl || '');
  }, [theme.wallpaperUrl]);

  const selectedLanguage = theme.language || i18n.language || 'zh';
  const languageOptions = theme.languageOptions || BUILT_IN_LANGUAGES;
  const visibleLanguages = useMemo(() => (
    [
      ...languageOptions,
      ...AVAILABLE_LANGUAGE_SLOTS.filter(
        slot => !languageOptions.some(language => language.code === slot.code),
      ),
    ]
  ), [languageOptions]);
  const systemLanguage = navigator.language.toLowerCase().startsWith('zh') ? 'zh' : 'en';

  const handleFileUpload = async () => {
    const selected = await open({
      multiple: false,
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'] }],
    });
    if (selected && typeof selected === 'string') {
      onThemeChange({
        ...theme,
        wallpaperUrl: convertFileSrc(selected),
        wallpaperBlur: 0,
        blurIntensity: 0,
      });
    }
  };

  const handleWallpaperUrlChange = (url: string) => {
    setWallpaperUrlDraft(url);
    const trimmedUrl = url.trim();
    if (!trimmedUrl) {
      setWallpaperUrlError('');
      onThemeChange({ ...theme, wallpaperUrl: undefined });
      return;
    }
    if (!isValidWallpaperUrl(trimmedUrl)) {
      setWallpaperUrlError(t('settings.wallpaperUrlInvalid'));
      return;
    }
    setWallpaperUrlError('');
    onThemeChange({
      ...theme,
      wallpaperUrl: trimmedUrl,
      wallpaperBlur: 0,
      blurIntensity: 0,
    });
  };

  const handlePickDefaultHome = async () => {
    const selected = await open({ multiple: false, directory: true });
    if (selected && typeof selected === 'string') {
      onThemeChange({ ...theme, defaultHomePath: selected });
    }
  };

  const handleResetDefaultHome = () => {
    onThemeChange({ ...theme, defaultHomePath: 'aether://favorites' });
    onNavigateToHome?.();
  };

  const applyLanguage = (code: string) => {
    i18n.changeLanguage(code);
    onThemeChange({ ...theme, language: code, followSystemLanguage: false, languageOptions });
  };

  const toggleFollowSystemLanguage = () => {
    const nextFollow = !theme.followSystemLanguage;
    const nextLanguage = nextFollow ? systemLanguage : selectedLanguage;
    i18n.changeLanguage(nextLanguage);
    onThemeChange({
      ...theme,
      followSystemLanguage: nextFollow,
      language: nextLanguage,
      languageOptions,
    });
  };

  const handleLiquidGlassToggle = async () => {
    const nextEnabled = theme.enableLiquidGlass !== true;
    const appearance = resolveCurrentAppearance(theme.mode);
    setIsTogglingLiquidGlass(true);
    setLiquidGlassMessage('');

    try {
      const status = await invoke<NativeLiquidGlassStatus>('set_native_liquid_glass_enabled', {
        enabled: nextEnabled,
        appearance,
      });
      setLiquidGlassStatus(status);

      if (nextEnabled && !status.applied) {
        setLiquidGlassMessage(
          status.reason
            || t('settings.liquidGlassUnsupported', '当前系统不支持原生 Liquid Glass，需要 macOS 26 或更新版本。'),
        );
        onThemeChange({ ...theme, enableLiquidGlass: false });
        return;
      }

      setLiquidGlassMessage(
        nextEnabled
          ? t('settings.liquidGlassApplied', '原生 Liquid Glass 已启用。')
          : t('settings.liquidGlassDisabled', '原生 Liquid Glass 已关闭。'),
      );
      onThemeChange({ ...theme, enableLiquidGlass: nextEnabled });
    } catch (err) {
      setLiquidGlassMessage(t('settings.liquidGlassToggleFailed', {
        error: normalizeAppError(err).userMessage,
        defaultValue: '切换原生 Liquid Glass 失败：{{error}}',
      }));
      if (nextEnabled) {
        onThemeChange({ ...theme, enableLiquidGlass: false });
      }
    } finally {
      setIsTogglingLiquidGlass(false);
    }
  };

  return {
    applyLanguage,
    handleFileUpload,
    handleLiquidGlassToggle,
    handlePickDefaultHome,
    handleResetDefaultHome,
    handleWallpaperUrlChange,
    isTogglingLiquidGlass,
    liquidGlassMessage,
    liquidGlassStatus,
    selectedLanguage,
    setShowLanguageManager,
    setShowMediaGridControls,
    setWallpaperUrlDraft,
    setWallpaperUrlError,
    showLanguageManager,
    showMediaGridControls,
    systemLanguage,
    toggleFollowSystemLanguage,
    visibleLanguages,
    wallpaperUrlDraft,
    wallpaperUrlError,
  };
}
