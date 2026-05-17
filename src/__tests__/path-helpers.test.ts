import { describe, it, expect } from 'vitest';
import {
  getPathLeaf,
  isVirtualPath,
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
  });

  it('returns / when paths diverge at root', () => {
    expect(commonParent(['/a/x', '/b/y'])).toBe('/');
  });
});
