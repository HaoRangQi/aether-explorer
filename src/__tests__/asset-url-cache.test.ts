import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearAssetUrlCache,
  getAssetUrlCacheSize,
  getCachedAssetUrl,
} from '../lib/asset-url-cache';

const convertFileSrcMock = vi.fn((path: string) => `asset://${path}`);

vi.mock('@tauri-apps/api/core', () => ({
  convertFileSrc: (path: string) => convertFileSrcMock(path),
}));

describe('asset URL cache', () => {
  beforeEach(() => {
    clearAssetUrlCache();
    convertFileSrcMock.mockClear();
  });

  it('reuses cached URLs for the same path', () => {
    expect(getCachedAssetUrl('/tmp/a.png')).toBe('asset:///tmp/a.png');
    expect(getCachedAssetUrl('/tmp/a.png')).toBe('asset:///tmp/a.png');
    expect(convertFileSrcMock).toHaveBeenCalledTimes(1);
    expect(getAssetUrlCacheSize()).toBe(1);
  });

  it('evicts the least recently used URL when over limit', () => {
    getCachedAssetUrl('/tmp/a.png', 2);
    getCachedAssetUrl('/tmp/b.png', 2);
    getCachedAssetUrl('/tmp/a.png', 2);
    getCachedAssetUrl('/tmp/c.png', 2);

    expect(getAssetUrlCacheSize()).toBe(2);
    expect(getCachedAssetUrl('/tmp/a.png', 2)).toBe('asset:///tmp/a.png');
    expect(convertFileSrcMock).toHaveBeenCalledTimes(3);
    expect(getCachedAssetUrl('/tmp/b.png', 2)).toBe('asset:///tmp/b.png');
    expect(convertFileSrcMock).toHaveBeenCalledTimes(4);
  });

  it('returns converted URLs without retaining entries when limit is zero', () => {
    expect(getCachedAssetUrl('/tmp/a.png', 0)).toBe('asset:///tmp/a.png');
    expect(getAssetUrlCacheSize()).toBe(0);
    expect(getCachedAssetUrl('/tmp/a.png', 0)).toBe('asset:///tmp/a.png');
    expect(convertFileSrcMock).toHaveBeenCalledTimes(2);
  });

  it('rebuilds cached URLs after the cache is cleared', () => {
    expect(getCachedAssetUrl('/tmp/a.png')).toBe('asset:///tmp/a.png');
    expect(getAssetUrlCacheSize()).toBe(1);

    clearAssetUrlCache();

    expect(getAssetUrlCacheSize()).toBe(0);
    expect(getCachedAssetUrl('/tmp/a.png')).toBe('asset:///tmp/a.png');
    expect(convertFileSrcMock).toHaveBeenCalledTimes(2);
  });

  it('returns remote URLs unchanged without caching them', () => {
    const remotePath = 'aether-remote://server/Sites/logo.png';

    expect(getCachedAssetUrl(remotePath)).toBe(remotePath);
    expect(getAssetUrlCacheSize()).toBe(0);
    expect(convertFileSrcMock).not.toHaveBeenCalled();
  });
});
