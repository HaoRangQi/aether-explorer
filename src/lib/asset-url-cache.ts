import { convertFileSrc } from '@tauri-apps/api/core';
import { isRemotePath } from './path-helpers';

const DEFAULT_ASSET_URL_CACHE_LIMIT = 512;

const assetUrlCache = new Map<string, string>();

export function getCachedAssetUrl(path: string, limit = DEFAULT_ASSET_URL_CACHE_LIMIT): string {
  if (isRemotePath(path)) return path;

  const cached = assetUrlCache.get(path);
  if (cached) {
    assetUrlCache.delete(path);
    assetUrlCache.set(path, cached);
    return cached;
  }

  const url = convertFileSrc(path);
  assetUrlCache.set(path, url);
  while (assetUrlCache.size > limit) {
    const oldest = assetUrlCache.keys().next().value;
    if (oldest === undefined) break;
    assetUrlCache.delete(oldest);
  }
  return url;
}

export function getAssetUrlCacheSize(): number {
  return assetUrlCache.size;
}

export function clearAssetUrlCache(): void {
  assetUrlCache.clear();
}
