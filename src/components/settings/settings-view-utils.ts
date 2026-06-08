import type { ThemeSettings } from '../../types';
import type { ResolvedAppearance } from './settings-view-types';

export function resolveCurrentAppearance(mode: ThemeSettings['mode']): ResolvedAppearance {
  if (mode !== 'auto') return mode;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function formatBytes(bytes: number): string {
  if (!bytes || bytes < 0) return '0 B';
  const units = ['B', 'K', 'M', 'G'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value >= 100 || unit === 0 ? 0 : 1)} ${units[unit]}`;
}

export function countFileTagEntries(fileTags?: Record<string, string[]>): number {
  return fileTags ? Object.keys(fileTags).length : 0;
}
