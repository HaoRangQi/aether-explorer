import type { LanguageOption } from '../../types';
import type { BackupStatus, DiagnosticsStatus, UpdateStatus } from './settings-view-types';

export const BUILT_IN_LANGUAGES: LanguageOption[] = [
  { code: 'zh', label: '简体中文', nativeLabel: '简体中文', source: 'built-in', completeness: 100, enabled: true },
  { code: 'en', label: 'English', nativeLabel: 'English', source: 'built-in', completeness: 100, enabled: true },
];

export const AVAILABLE_LANGUAGE_SLOTS: LanguageOption[] = [
  { code: 'ja', label: 'Japanese', nativeLabel: '日本語', source: 'available', completeness: 0, enabled: false },
  { code: 'ko', label: 'Korean', nativeLabel: '한국어', source: 'available', completeness: 0, enabled: false },
  { code: 'de', label: 'German', nativeLabel: 'Deutsch', source: 'available', completeness: 0, enabled: false },
];

export const DEFAULT_UPDATE_STATUS: UpdateStatus = {
  state: 'idle',
  currentVersion: '',
  latestVersion: '',
  releaseUrl: '',
  notes: '',
  pubDate: '',
  downloaded: 0,
  contentLength: 0,
  message: '尚未检查更新。',
};

export const DEFAULT_DIAGNOSTICS_STATUS: DiagnosticsStatus = {
  loading: false,
  message: '',
  kind: 'idle',
};

export const DEFAULT_BACKUP_STATUS: BackupStatus = {
  loading: false,
  message: '',
  kind: 'idle',
};
