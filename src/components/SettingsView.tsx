import { useState } from 'react';
import { Monitor, Palette, HardDrive, Shield, Puzzle, Sparkles, Info } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import SettingsShell, { type SettingsCategoryNavItem } from './settings/SettingsShell';
import AppearanceSettings from './settings/AppearanceSettings';
import FileBehaviorSettings from './settings/FileBehaviorSettings';
import PermissionsDiagnosticsSettings from './settings/PermissionsDiagnosticsSettings';
import ExtensionSettings from './settings/ExtensionSettings';
import FeaturesSettings from './settings/FeaturesSettings';
import AiProviderSettings from './settings/AiProviderSettings';
import AboutSettings from './settings/AboutSettings';
import {
  AVAILABLE_LANGUAGE_SLOTS,
  BUILT_IN_LANGUAGES,
} from './settings/settings-view-constants';
import type {
  SettingsCategory,
  SettingsViewProps,
} from './settings/settings-view-types';
import {
  formatBytes,
  resolveCurrentAppearance,
} from './settings/settings-view-utils';
import { useSettingsAiProviders } from './settings/useSettingsAiProviders';
import { useSettingsBackup } from './settings/useSettingsBackup';
import { useSettingsCleanup } from './settings/useSettingsCleanup';
import { useSettingsDiagnostics } from './settings/useSettingsDiagnostics';
import { useSettingsAppearance } from './settings/useSettingsAppearance';
import { useSettingsExtensions } from './settings/useSettingsExtensions';
import { useSettingsPermissions } from './settings/useSettingsPermissions';
import { useSettingsSystemResources } from './settings/useSettingsSystemResources';
import { useSettingsUpdate } from './settings/useSettingsUpdate';
export type { SettingsCategory } from './settings/settings-view-types';

export default function SettingsView({ theme, onThemeChange, initialCategory = 'appearance', favorites = [], fileTags = {}, recentItems = [], onImport, onResetAllData, onNavigateToHome }: SettingsViewProps) {
  const { t, i18n } = useTranslation();
  const [activeCategory, setActiveCategory] = useState<SettingsCategory>(initialCategory);
  const showFolderSizeInList = theme.showFolderSizeInList !== false;
  const { appVersion, availableFonts, terminalApps, setTerminalApps } = useSettingsSystemResources();
  const {
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
  } = useSettingsAppearance({
    i18n,
    t,
    theme,
    onThemeChange,
    onNavigateToHome,
  });
  const {
    addExtension,
    editingExtensionId,
    handleDeleteExtension,
    isNewActionValid,
    newActionLabel,
    newActionType,
    newCommand,
    newTerminalApp,
    newTerminalArgs,
    newUrlTemplate,
    newWorkingDirectory,
    populateActionForm,
    resetActionForm,
    setNewActionLabel,
    setNewActionType,
    setNewCommand,
    setNewTerminalApp,
    setNewTerminalArgs,
    setNewUrlTemplate,
    setNewWorkingDirectory,
    toggleExtension,
  } = useSettingsExtensions({
    t,
    theme,
    onThemeChange,
  });
  const { cleanupStatus, handleCleanup } = useSettingsCleanup(t);

  const categories: SettingsCategoryNavItem[] = [
    { id: 'appearance', label: t('settings.appearanceHeader'), icon: Palette },
    { id: 'files', label: t('settings.filesHeader'), icon: HardDrive },
    { id: 'permissions', label: t('settings.privacyHeader'), icon: Shield },
    { id: 'extensions', label: t('settings.extensionsHeader'), icon: Puzzle },
    { id: 'features', label: t('settings.featuresHeader'), icon: Monitor },
    { id: 'ai', label: t('settings.aiHeader'), icon: Sparkles },
    { id: 'about', label: t('settings.aboutHeader'), icon: Info },
  ];

  const {
    backupStatus,
    handleExportSettingsBackup,
    handleImportSettingsBackup,
    handleResetAllSettingsData,
    handleExportExtensions,
    handleImportExtensions,
  } = useSettingsBackup({
    t,
    theme,
    favorites,
    fileTags,
    recentItems,
    appVersion,
    onImport,
    onResetAllData,
    onThemeChange,
  });
  const {
    updateStatus,
    handleCheckUpdates,
    handleDownloadUpdate,
  } = useSettingsUpdate(t);
  const {
    diagnosticsStatus,
    lastPanicLog,
    handleCopyDiagnostics,
    handleOpenLogsDir,
    handleOpenConfigDir,
    handleReadLastPanicLog,
    handleCopyPanicLog,
  } = useSettingsDiagnostics({
    t,
    theme,
    appVersion,
    selectedLanguage,
  });
  const {
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
  } = useSettingsAiProviders({ theme, onThemeChange });
  const {
    permissionStatus,
    probeResults,
    permissionCheckLoaded,
    permissionCheckLoading,
    checkPermissions,
    appIdentity,
    appIdentityError,
  } = useSettingsPermissions(t);

  const renderAppearanceCategory = () => (
    <AppearanceSettings
      t={t}
      theme={theme}
      onThemeChange={onThemeChange}
      handleLiquidGlassToggle={handleLiquidGlassToggle}
      isTogglingLiquidGlass={isTogglingLiquidGlass}
      liquidGlassMessage={liquidGlassMessage}
      liquidGlassStatus={liquidGlassStatus}
      resolveCurrentAppearance={resolveCurrentAppearance}
      handleFileUpload={handleFileUpload}
      wallpaperUrlDraft={wallpaperUrlDraft}
      setWallpaperUrlDraft={setWallpaperUrlDraft}
      handleWallpaperUrlChange={handleWallpaperUrlChange}
      wallpaperUrlError={wallpaperUrlError}
      setWallpaperUrlError={setWallpaperUrlError}
      showMediaGridControls={showMediaGridControls}
      setShowMediaGridControls={setShowMediaGridControls}
      availableFonts={availableFonts}
      setShowLanguageManager={setShowLanguageManager}
      applyLanguage={applyLanguage}
      selectedLanguage={selectedLanguage}
      toggleFollowSystemLanguage={toggleFollowSystemLanguage}
      systemLanguage={systemLanguage}
      showLanguageManager={showLanguageManager}
      visibleLanguages={visibleLanguages}
    />
  );

  const renderFeaturesCategory = () => (
    <FeaturesSettings
      t={t}
      theme={theme}
      onThemeChange={onThemeChange}
      terminalApps={terminalApps}
      setTerminalApps={setTerminalApps}
    />
  );

  const renderAICategory = () => (
    <AiProviderSettings
      theme={theme}
      onThemeChange={onThemeChange}
      aiProviders={aiProviders}
      updateProviders={updateProviders}
      addProvider={addProvider}
      aiTestStatus={aiTestStatus}
      aiTestError={aiTestError}
      aiModels={aiModels}
      aiModelLoading={aiModelLoading}
      aiModelDropdown={aiModelDropdown}
      setAiModelDropdown={setAiModelDropdown}
      aiModelSearch={aiModelSearch}
      setAiModelSearch={setAiModelSearch}
      handleFetchModels={handleFetchModels}
      handleTestProvider={handleTestProvider}
    />
  );

  const renderAboutCategory = () => (
    <AboutSettings
      t={t}
      appVersion={appVersion}
      diagnosticsStatus={diagnosticsStatus}
      lastPanicLog={lastPanicLog}
      updateStatus={updateStatus}
      cleanupStatus={cleanupStatus}
      formatBytes={formatBytes}
      handleCopyDiagnostics={handleCopyDiagnostics}
      handleOpenLogsDir={handleOpenLogsDir}
      handleOpenConfigDir={handleOpenConfigDir}
      handleReadLastPanicLog={handleReadLastPanicLog}
      handleCopyPanicLog={handleCopyPanicLog}
      handleCheckUpdates={handleCheckUpdates}
      handleDownloadUpdate={handleDownloadUpdate}
      handleCleanup={handleCleanup}
    />
  );

  const renderFilesCategory = () => (
    <FileBehaviorSettings
      t={t}
      theme={theme}
      onThemeChange={onThemeChange}
      showFolderSizeInList={showFolderSizeInList}
      backupStatus={backupStatus}
      handleResetDefaultHome={handleResetDefaultHome}
      handlePickDefaultHome={handlePickDefaultHome}
      handleExportSettingsBackup={handleExportSettingsBackup}
      handleImportSettingsBackup={handleImportSettingsBackup}
      handleResetAllSettingsData={handleResetAllSettingsData}
    />
  );

  const renderPermissionsCategory = () => (
    <PermissionsDiagnosticsSettings
      t={t}
      permissionStatus={permissionStatus}
      probeResults={probeResults}
      permissionCheckLoaded={permissionCheckLoaded}
      permissionCheckLoading={permissionCheckLoading}
      checkPermissions={checkPermissions}
      appIdentity={appIdentity}
      appIdentityError={appIdentityError}
    />
  );

  const renderExtensionsCategory = () => (
    <ExtensionSettings
      t={t}
      theme={theme}
      terminalApps={terminalApps}
      newActionLabel={newActionLabel}
      setNewActionLabel={setNewActionLabel}
      newActionType={newActionType}
      setNewActionType={setNewActionType}
      newTerminalApp={newTerminalApp}
      setNewTerminalApp={setNewTerminalApp}
      newTerminalArgs={newTerminalArgs}
      setNewTerminalArgs={setNewTerminalArgs}
      newCommand={newCommand}
      setNewCommand={setNewCommand}
      newUrlTemplate={newUrlTemplate}
      setNewUrlTemplate={setNewUrlTemplate}
      newWorkingDirectory={newWorkingDirectory}
      setNewWorkingDirectory={setNewWorkingDirectory}
      editingExtensionId={editingExtensionId}
      handleImportExtensions={handleImportExtensions}
      handleExportExtensions={handleExportExtensions}
      resetActionForm={resetActionForm}
      populateActionForm={populateActionForm}
      handleDeleteExtension={handleDeleteExtension}
      toggleExtension={toggleExtension}
      addExtension={addExtension}
      isNewActionValid={isNewActionValid}
    />
  );

  const activeCategoryLabel = categories.find(category => category.id === activeCategory)?.label;
  const activeCategoryContent =
    activeCategory === 'appearance' ? renderAppearanceCategory() :
    activeCategory === 'files' ? renderFilesCategory() :
    activeCategory === 'permissions' ? renderPermissionsCategory() :
    activeCategory === 'extensions' ? renderExtensionsCategory() :
    activeCategory === 'features' ? renderFeaturesCategory() :
    activeCategory === 'ai' ? renderAICategory() :
    renderAboutCategory();

  return (
    <SettingsShell
      activeCategory={activeCategory}
      categories={categories}
      sidebarTitle={t('settings.sidebarTitle')}
      configurationBadge={t('settings.configurationBadge', { category: activeCategoryLabel })}
      categoryDescription={t(`settings.categoryDescriptions.${activeCategory}`, { defaultValue: t('settings.categoryDescriptions.default') })}
      onCategoryChange={setActiveCategory}
    >
      {activeCategoryContent}
    </SettingsShell>
  );
}
