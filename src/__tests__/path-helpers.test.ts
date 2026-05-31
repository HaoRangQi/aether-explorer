import { describe, it, expect } from 'vitest';
import {
  getPathLeaf,
  getParentPath,
  isRemotePath,
  isVirtualPath,
  buildRemotePath,
  parseRemotePath,
  normalizeRemoteDirectoryPath,
  getInitialTabs,
  commonParent,
} from '../lib/path-helpers';

describe('getPathLeaf', () => {
  it('returns last segment', () => {
    expect(getPathLeaf('/Users/jane/Pictures')).toBe('Pictures');
    expect(getPathLeaf('/Applications/Safari.app')).toBe('Safari.app');
  });

  it('handles trailing slash', () => {
    expect(getPathLeaf('/Users/jane/')).toBe('jane');
  });

  it('handles root', () => {
    expect(getPathLeaf('/')).toBe('/');
  });

  it('defaults to "首页" on empty', () => {
    expect(getPathLeaf('')).toBe('首页');
    expect(getPathLeaf(undefined)).toBe('首页');
    expect(getPathLeaf(null)).toBe('首页');
  });
});

describe('isVirtualPath', () => {
  it('recognizes aether:// prefix', () => {
    expect(isVirtualPath('aether://favorites')).toBe(true);
    expect(isVirtualPath('aether://recent')).toBe(true);
    expect(isVirtualPath('aether://tags/red')).toBe(true);
  });

  it('rejects real paths', () => {
    expect(isVirtualPath('/Users/jane')).toBe(false);
    expect(isVirtualPath('')).toBe(false);
    expect(isVirtualPath(undefined)).toBe(false);
  });
});

describe('remote path helpers', () => {
  it('recognizes remote paths separately from virtual paths', () => {
    expect(isRemotePath('aether-remote://conn-1/')).toBe(true);
    expect(isVirtualPath('aether-remote://conn-1/')).toBe(false);
    expect(isRemotePath('aether://favorites')).toBe(false);
  });

  it('builds and parses remote paths', () => {
    const path = buildRemotePath('server 1', '/Sites/public/');

    expect(path).toBe('aether-remote://server%201/Sites/public');
    expect(parseRemotePath(path)).toEqual({
      connectionId: 'server 1',
      remotePath: '/Sites/public',
    });
  });

  it('encodes remote path segments without treating slashes as one segment', () => {
    const path = buildRemotePath('server/1', '/Sites/My Files/#draft?.txt');

    expect(path).toBe('aether-remote://server%2F1/Sites/My%20Files/%23draft%3F.txt');
    expect(parseRemotePath(path)).toEqual({
      connectionId: 'server/1',
      remotePath: '/Sites/My Files/#draft?.txt',
    });
  });

  it('rejects malformed remote path escapes', () => {
    expect(parseRemotePath('aether-remote://server/%E0%A4%A')).toBeNull();
  });

  it('normalizes remote directory paths', () => {
    expect(normalizeRemoteDirectoryPath('')).toBe('/');
    expect(normalizeRemoteDirectoryPath('foo//bar/')).toBe('/foo/bar');
    expect(normalizeRemoteDirectoryPath('/foo/bar/')).toBe('/foo/bar');
  });
});

describe('getParentPath', () => {
  it('returns parent directory for filesystem paths', () => {
    expect(getParentPath('/Users/jane/Pictures')).toBe('/Users/jane');
    expect(getParentPath('/Users/jane/Pictures/')).toBe('/Users/jane/Pictures');
    expect(getParentPath('/Users')).toBe('/');
    expect(getParentPath('/')).toBe('/');
    expect(getParentPath('')).toBe('/');
  });

  it('returns parent directory for remote paths', () => {
    expect(getParentPath('aether-remote://conn/Sites/public')).toBe('aether-remote://conn/Sites');
    expect(getParentPath('aether-remote://conn/Sites')).toBe('aether-remote://conn/');
    expect(getParentPath('aether-remote://conn/')).toBe('aether-remote://conn/');
  });
});

describe('getInitialTabs', () => {
  it('uses URL ?path and ?label when provided', () => {
    const tabs = getInitialTabs('/home', new URLSearchParams('?path=/foo/bar&label=Custom'));
    expect(tabs).toHaveLength(1);
    expect(tabs[0].initialPath).toBe('/foo/bar');
    expect(tabs[0].currentPath).toBe('/foo/bar');
    expect(tabs[0].label).toBe('Custom');
  });

  it('falls back to last segment when label missing', () => {
    const tabs = getInitialTabs('/home', new URLSearchParams('?path=/Users/jane/Pictures'));
    expect(tabs[0].label).toBe('Pictures');
  });

  it('uses defaultHomePath when no URL params', () => {
    const tabs = getInitialTabs('/Users/jane', new URLSearchParams(''));
    expect(tabs[0].id).toBe('desktop');
    expect(tabs[0].initialPath).toBe('/Users/jane');
    expect(tabs[0].label).toBe('jane');
  });

  it('hides label for virtual home paths', () => {
    const tabs = getInitialTabs('aether://favorites', new URLSearchParams(''));
    expect(tabs[0].label).toBeUndefined();
    expect(tabs[0].labelTranslationKey).toBe('tabs.favorites');

    const recentTabs = getInitialTabs('aether://recent', new URLSearchParams(''));
    expect(recentTabs[0].label).toBeUndefined();
    expect(recentTabs[0].labelTranslationKey).toBe('tabs.recent');
  });

  it('does not expose unknown virtual paths as filesystem-style labels', () => {
    const tabs = getInitialTabs('aether://tags/red', new URLSearchParams(''));

    expect(tabs[0].label).toBeUndefined();
    expect(tabs[0].labelTranslationKey).toBe('tabs.home');
    expect(tabs[0].initialPath).toBe('aether://tags/red');
    expect(tabs[0].currentPath).toBe('aether://tags/red');
  });
});

describe('commonParent', () => {
  it('returns empty for empty input', () => {
    expect(commonParent([])).toBe('');
  });

  it('returns parent of single path', () => {
    expect(commonParent(['/a/b/c.txt'])).toBe('/a/b');
    expect(commonParent(['/a'])).toBe('/');
  });

  it('finds shared prefix of multiple paths', () => {
    expect(commonParent([
      '/Users/jane/Pictures/a.jpg',
      '/Users/jane/Pictures/b.jpg',
      '/Users/jane/Pictures/sub/c.jpg',
    ])).toBe('/Users/jane/Pictures');
    expect(commonParent([
      '/Users/jane/Pictures/',
      '/Users/jane/Pictures/sub/c.jpg',
    ])).toBe('/Users/jane/Pictures');
  });

  it('returns / when paths diverge at root', () => {
    expect(commonParent(['/a/x', '/b/y'])).toBe('/');
  });
});
