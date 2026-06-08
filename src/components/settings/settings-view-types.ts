import type { ThemeSettings } from '../../types';

export type SettingsCategory = 'appearance' | 'files' | 'permissions' | 'extensions' | 'features' | 'ai' | 'about';

export interface SettingsViewProps {
  theme: ThemeSettings;
  onThemeChange: (theme: ThemeSettings) => void;
  initialCategory?: SettingsCategory;
  favorites?: string[];
  fileTags?: Record<string, string[]>;
  recentItems?: string[];
  onImport?: (data: {
    theme?: ThemeSettings;
    favorites?: string[];
    fileTags?: Record<string, string[]>;
    recentItems?: string[];
  }) => void;
  onResetAllData?: () => void;
  onNavigateToHome?: () => void;
}

export type NativeLiquidGlassStatus = {
  requested: boolean;
  supported: boolean;
  applied: boolean;
  reason?: string | null;
};

export type ResolvedAppearance = 'light' | 'dark';

export type UpdateStatus = {
  state: 'idle' | 'checking' | 'current' | 'available' | 'downloading' | 'installing' | 'restarting' | 'error';
  currentVersion: string;
  latestVersion: string;
  releaseUrl?: string;
  notes?: string;
  pubDate?: string;
  downloaded: number;
  contentLength: number;
  message: string;
};

export type DiagnosticsStatus = {
  loading: boolean;
  message: string;
  kind: 'idle' | 'ok' | 'error';
};

export type BackupStatus = {
  loading: boolean;
  message: string;
  kind: 'idle' | 'ok' | 'error';
};
