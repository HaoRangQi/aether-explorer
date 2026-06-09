import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(new URL('..', import.meta.url).pathname);

function readSourceTree(relativePath) {
  const absolutePath = resolve(root, relativePath);
  const stat = statSync(absolutePath);
  if (stat.isFile()) return readFileSync(absolutePath, 'utf8');

  return readdirSync(absolutePath)
    .filter((entry) => !entry.startsWith('.'))
    .map((entry) => readSourceTree(`${relativePath}/${entry}`))
    .join('\n');
}

const localeFiles = {
  zh: resolve(root, 'src/i18n/locales/zh.ts'),
  en: resolve(root, 'src/i18n/locales/en.ts'),
};

const requiredLocaleKeys = [
  'items',
  'image',
  'video',
  'audio',
  'archive',
  'code',
  'text',
  'file',
  'newFolder',
  'newFile',
  'aiAssistant',
  'aiHistory',
  'refresh',
  'sortByName',
  'sortByModified',
  'sortBy',
  'copyName',
  'quickLook',
  'revealInFinder',
  'copyPath',
  'openInNewTab',
  'showInspector',
  'openInTerminal',
  'useGroups',
  'disableGroups',
  'scrollToTop',
  'scrollToBottom',
  'display',
  'showCheckboxes',
  'showSort',
  'alias',
  'compress',
  'decompress',
  'contextMenuDisabled',
  'contextMenuDisabledAction',
  'contentPreview',
  'reading',
  'pdfLoading',
  'pdfPreviewFailed',
  'generatingPreview',
  'textPreviewUnavailable',
  'imagePreviewFailed',
  'filesCount',
  'openSystemSettings',
  'openSystemSettingsFailed',
  'openSettingsFailed',
  'retry',
  'permissionDeniedTitle',
  'notFoundTitle',
  'readFailedTitle',
  'permissionDeniedDescription',
  'notFoundDescription',
  'readFailedDescription',
  'permissionRetryBlockedDetail',
  'sizePermissionRequired',
  'fullDiskAccessOperationRequired',
  'permissionSteps',
  'newFileIndexed',
  'newFolderIndexed',
  'fileCreated',
  'fileCreateFailed',
  'folderCreated',
  'folderCreateFailed',
  'compressCompleted',
  'compressFailed',
  'decompressCompleted',
  'decompressFailed',
  'aliasCreated',
  'aliasCreateFailed',
  'extensionMissing',
  'extensionExecuted',
  'extensionCommandMissing',
  'extensionTerminalExecuted',
  'extensionUrlMissing',
  'extensionUrlOpened',
  'extensionUnsafeUrl',
  'extensionReserved',
  'extensionFailed',
  'importFailed',
];

const requiredExplorerUsages = [
  "t('explorer.aiAssistant'",
  "t('explorer.aiHistory'",
  "t('explorer.alias'",
  "t('explorer.compress'",
  "t('explorer.decompress'",
  "t('explorer.openInTerminal'",
  "t('explorer.revealInFinder'",
  "t('explorer.copyPath'",
  "t('explorer.pdfLoading'",
  "t('explorer.pdfPreviewFailed'",
  "t('explorer.generatingPreview'",
  "t('explorer.textPreviewUnavailable'",
  "t('explorer.imagePreviewFailed'",
  "t('explorer.contentPreview'",
  "t('explorer.reading'",
  "t('dialogs.permissionDeniedTitle'",
  "t('dialogs.notFoundTitle'",
  "t('dialogs.readFailedTitle'",
  "t('dialogs.openSystemSettingsFailed'",
  "t('dialogs.permissionRetryBlockedDetail'",
  "t('messages.fileCreated'",
  "t('messages.fileCreateFailed'",
  "t('messages.folderCreated'",
  "t('messages.folderCreateFailed'",
  "t('messages.extensionFailed'",
];

const requiredDialogKeys = [
  'openSystemSettingsFailed',
];

const requiredPermissionRecoveryUsages = [
  "t('dialogs.permissionRetryBlockedDetail'",
  "t('explorer.sizePermissionRequired'",
  "t('messages.fullDiskAccessOperationRequired'",
];

const requiredAIRenameKeys = [
  'title',
  'fileCount',
  'placeholder',
  'generating',
  'generatePlan',
  'retryHint',
  'emptyState',
  'trashWarning',
  'stepsSummary',
  'execute',
  'executing',
  'operations',
  'descriptions',
  'presets',
];

const requiredAIRenameUsages = [
  "t('aiRename.title'",
  "t('aiRename.fileCount'",
  "t('aiRename.placeholder'",
  "t('aiRename.generating'",
  "t('aiRename.generatePlan'",
  "t('aiRename.retryHint'",
  "t('aiRename.emptyState'",
  "t('aiRename.trashWarning'",
  "t('aiRename.stepsSummary'",
  "t('aiRename.execute'",
  "t('aiRename.executing'",
  "t('aiRename.presets.organizeByType'",
];

const requiredAppDiagnosticsKeys = [
  'startupPanicTitle',
  'startupPanicDescription',
  'dismiss',
  'viewDiagnostics',
];

const requiredAppDiagnosticsUsages = [
  "t('appDiagnostics.startupPanicTitle'",
  "t('appDiagnostics.startupPanicDescription'",
  "t('appDiagnostics.dismiss'",
  "t('appDiagnostics.viewDiagnostics'",
];

const requiredSettingsDiagnosticsKeys = [
  'copyInfo',
  'openLogs',
  'openConfig',
  'loadPanicLog',
  'openingConfig',
  'configOpened',
  'openConfigFailed',
];

const requiredSettingsDiagnosticsUsages = [
  "t('settings.diagnostics.copyInfo'",
  "t('settings.diagnostics.openLogs'",
  "t('settings.diagnostics.openConfig'",
  "t('settings.diagnostics.loadPanicLog'",
  "t('settings.diagnostics.openingConfig'",
  "t('settings.diagnostics.configOpened'",
  "t('settings.diagnostics.openConfigFailed'",
];

const requiredSettingsBackupKeys = [
  'title',
  'description',
  'export',
  'import',
  'resetAll',
  'exporting',
  'exported',
  'exportFailed',
  'importing',
  'imported',
  'importFailed',
  'resetConfirm',
  'resetDone',
  'resetFailed',
  'warning',
];

const requiredSettingsBackupUsages = [
  "t('settings.backup.title'",
  "t('settings.backup.description'",
  "t('settings.backup.export'",
  "t('settings.backup.import'",
  "t('settings.backup.resetAll'",
  "t('settings.backup.exporting'",
  "t('settings.backup.exported'",
  "t('settings.backup.exportFailed'",
  "t('settings.backup.importing'",
  "t('settings.backup.imported'",
  "t('settings.backup.importFailed'",
  "t('settings.backup.resetConfirm'",
  "t('settings.backup.resetDone'",
  "t('settings.backup.resetFailed'",
  "t('settings.backup.warning'",
];

const requiredSettingsViewKeys = [
  'featuresHeader',
  'aiHeader',
  'aboutHeader',
  'sidebarTitle',
  'configurationBadge',
  'categoryDescriptions',
  'cleanup',
  'permissions',
  'extensions',
  'fullDiskTitle',
  'openSystemSettings',
  'accessStatus',
  'enabledCount',
  'coreActions',
  'actionTypes',
  'addCustomAction',
  'availableVariables',
  'saveChanges',
  'addAction',
];

const requiredSettingsViewUsages = [
  "t('settings.featuresHeader'",
  "t('settings.aiHeader'",
  "t('settings.aboutHeader'",
  "t('settings.sidebarTitle'",
  "t('settings.configurationBadge'",
  "t(`settings.categoryDescriptions.${activeCategory}`",
  "t('settings.cleanup.cleaning'",
  "t('settings.cleanup.done'",
  "t('settings.cleanup.failed'",
  "t('settings.permissions.fullDiskTitle'",
  "t('settings.permissions.openSystemSettings'",
  "t('settings.permissions.openSystemSettingsFailed'",
  "t('settings.permissions.revealAppInFinder'",
  "t('settings.permissions.revealAppFailed'",
  "t('settings.permissions.copyEvidence'",
  "t('settings.permissions.copyEvidenceCopying'",
  "t('settings.permissions.copyEvidenceCopied'",
  "t('settings.permissions.copyEvidenceFailed'",
  "t('settings.permissions.copyEvidenceRequiresGranted'",
  "t(`settings.permissions.status.${resolvedStatus}`",
  "t('settings.permissions.recoveryTitle'",
  "t('settings.permissions.recoveryDescription'",
  "t('settings.permissions.recoverySteps'",
  "t('settings.permissions.probeEvidence'",
  "t('settings.permissions.probeHint'",
  "t('settings.permissions.noProbeEvidence'",
  "t('settings.permissions.probeReadable'",
  "t('settings.permissions.probeBlocked'",
  "t('settings.permissions.probeMissing'",
  "t('settings.extensions.description'",
  "t('settings.extensions.enabledCount'",
  "t('settings.extensions.importJson'",
  "t('settings.extensions.coreActionsTitle'",
  "t(`settings.extensions.coreActions.${action}`",
  "t('settings.extensions.customActionsTitle'",
  "t('settings.extensions.emptyCustomActions'",
  "t('settings.extensions.workingDirectoryCurrent'",
  "t('settings.extensions.commandMissing'",
  "t('settings.extensions.editAction'",
  "t('settings.extensions.addCustomAction'",
  "t('settings.extensions.availableVariables'",
  "t('settings.extensions.escapeHint'",
  "t('settings.extensions.saveChanges'",
  "t('settings.extensions.addAction'",
];

const requiredShortcutHelpKeys = [
  'title',
  'description',
  'sections',
  'items',
];

const requiredShortcutHelpUsages = [
  "t('shortcutHelp.title'",
  "t('shortcutHelp.description'",
  "t('shortcutHelp.sections.window'",
  "t('shortcutHelp.sections.navigation'",
  "t('shortcutHelp.sections.selection'",
  "t('shortcutHelp.sections.files'",
  "t('shortcutHelp.sections.view'",
  "t('shortcutHelp.sections.tools'",
  "t('shortcutHelp.items.showHelp'",
  "t('shortcutHelp.items.aiRename'",
];

function fail(message, details = []) {
  console.error(`i18n coverage check failed: ${message}`);
  for (const detail of details) {
    console.error(`- ${detail}`);
  }
  process.exit(1);
}

const missingLocaleKeys = [];
for (const [locale, filePath] of Object.entries(localeFiles)) {
  const source = readFileSync(filePath, 'utf8');
  for (const key of requiredLocaleKeys) {
    const pattern = new RegExp(`\\b${key}\\s*:`);
    if (!pattern.test(source)) {
      missingLocaleKeys.push(`${locale}: ${key}`);
    }
  }
  const aiRenameBlock = source.match(/aiRename:\s*\{[\s\S]*?\n {2}\},/);
  for (const key of requiredAIRenameKeys) {
    const pattern = new RegExp(`\\b${key}\\s*:`);
    if (!aiRenameBlock || !pattern.test(aiRenameBlock[0])) {
      missingLocaleKeys.push(`${locale}: aiRename.${key}`);
    }
  }
  const appDiagnosticsBlock = source.match(/appDiagnostics:\s*\{[\s\S]*?\n {2}\},/);
  for (const key of requiredAppDiagnosticsKeys) {
    const pattern = new RegExp(`\\b${key}\\s*:`);
    if (!appDiagnosticsBlock || !pattern.test(appDiagnosticsBlock[0])) {
      missingLocaleKeys.push(`${locale}: appDiagnostics.${key}`);
    }
  }
  const dialogsBlock = source.match(/dialogs:\s*\{[\s\S]*?\n {2}\},/);
  for (const key of requiredDialogKeys) {
    const pattern = new RegExp(`\\b${key}\\s*:`);
    if (!dialogsBlock || !pattern.test(dialogsBlock[0])) {
      missingLocaleKeys.push(`${locale}: dialogs.${key}`);
    }
  }
  const settingsDiagnosticsBlock = source.match(/diagnostics:\s*\{[\s\S]*?\n {4}\},/);
  for (const key of requiredSettingsDiagnosticsKeys) {
    const pattern = new RegExp(`\\b${key}\\s*:`);
    if (!settingsDiagnosticsBlock || !pattern.test(settingsDiagnosticsBlock[0])) {
      missingLocaleKeys.push(`${locale}: settings.diagnostics.${key}`);
    }
  }
  const settingsBackupBlock = source.match(/backup:\s*\{[\s\S]*?\n {4}\},/);
  for (const key of requiredSettingsBackupKeys) {
    const pattern = new RegExp(`\\b${key}\\s*:`);
    if (!settingsBackupBlock || !pattern.test(settingsBackupBlock[0])) {
      missingLocaleKeys.push(`${locale}: settings.backup.${key}`);
    }
  }
  for (const key of requiredSettingsViewKeys) {
    const pattern = new RegExp(`['"]?${key}['"]?\\s*:`);
    if (!pattern.test(source)) {
      missingLocaleKeys.push(`${locale}: settings.${key}`);
    }
  }
  const shortcutHelpBlock = source.match(/shortcutHelp:\s*\{[\s\S]*?\n {2}\},/);
  for (const key of requiredShortcutHelpKeys) {
    const pattern = new RegExp(`\\b${key}\\s*:`);
    if (!shortcutHelpBlock || !pattern.test(shortcutHelpBlock[0])) {
      missingLocaleKeys.push(`${locale}: shortcutHelp.${key}`);
    }
  }
}

if (missingLocaleKeys.length > 0) {
  fail('required locale keys are missing', missingLocaleKeys);
}

const explorerSource = [
  readSourceTree('src/components/ExplorerView.tsx'),
  readSourceTree('src/components/explorer'),
].join('\n');
const missingUsages = requiredExplorerUsages.filter((usage) => !explorerSource.includes(usage));

if (missingUsages.length > 0) {
  fail('ExplorerView high-risk strings are not routed through i18n', missingUsages);
}

const permissionRecoverySource = [
  readFileSync(resolve(root, 'src/lib/operation-permission-error.ts'), 'utf8'),
  readFileSync(resolve(root, 'src/components/explorer/useExplorerDirectoryData.ts'), 'utf8'),
  readFileSync(resolve(root, 'src/components/explorer/useExplorerInspector.ts'), 'utf8'),
].join('\n');
const missingPermissionRecoveryUsages = requiredPermissionRecoveryUsages.filter((usage) => !permissionRecoverySource.includes(usage));

if (missingPermissionRecoveryUsages.length > 0) {
  fail('Full Disk Access recovery strings are not routed through i18n', missingPermissionRecoveryUsages);
}

const aiRenameSource = readFileSync(resolve(root, 'src/components/AIRenamePanel.tsx'), 'utf8');
const missingAIRenameUsages = requiredAIRenameUsages.filter((usage) => !aiRenameSource.includes(usage));

if (missingAIRenameUsages.length > 0) {
  fail('AIRenamePanel high-risk strings are not routed through i18n', missingAIRenameUsages);
}

const appSource = readFileSync(resolve(root, 'src/App.tsx'), 'utf8');
const missingAppDiagnosticsUsages = requiredAppDiagnosticsUsages.filter((usage) => !appSource.includes(usage));

if (missingAppDiagnosticsUsages.length > 0) {
  fail('App diagnostics strings are not routed through i18n', missingAppDiagnosticsUsages);
}

const settingsSource = [
  readSourceTree('src/components/SettingsView.tsx'),
  readSourceTree('src/components/settings'),
].join('\n');
const missingSettingsDiagnosticsUsages = requiredSettingsDiagnosticsUsages.filter((usage) => !settingsSource.includes(usage));

if (missingSettingsDiagnosticsUsages.length > 0) {
  fail('Settings diagnostics strings are not routed through i18n', missingSettingsDiagnosticsUsages);
}

const missingSettingsBackupUsages = requiredSettingsBackupUsages.filter((usage) => !settingsSource.includes(usage));

if (missingSettingsBackupUsages.length > 0) {
  fail('Settings backup strings are not routed through i18n', missingSettingsBackupUsages);
}

const missingSettingsViewUsages = requiredSettingsViewUsages.filter((usage) => !settingsSource.includes(usage));

if (missingSettingsViewUsages.length > 0) {
  fail('SettingsView high-risk strings are not routed through i18n', missingSettingsViewUsages);
}

const missingShortcutHelpUsages = requiredShortcutHelpUsages.filter((usage) => !appSource.includes(usage));

if (missingShortcutHelpUsages.length > 0) {
  fail('Shortcut help strings are not routed through i18n', missingShortcutHelpUsages);
}

console.log(`i18n coverage check passed: ${requiredLocaleKeys.length} locale keys, ${requiredExplorerUsages.length} ExplorerView usages, ${requiredPermissionRecoveryUsages.length} Full Disk Access recovery usages, ${requiredAIRenameUsages.length} AIRenamePanel usages, ${requiredAppDiagnosticsUsages.length} app diagnostics usages, ${requiredSettingsDiagnosticsUsages.length} settings diagnostics usages, ${requiredSettingsBackupUsages.length} settings backup usages, ${requiredSettingsViewUsages.length} SettingsView high-risk usages, and ${requiredShortcutHelpUsages.length} shortcut help usages verified.`);
