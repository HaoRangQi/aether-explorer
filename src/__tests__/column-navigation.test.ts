import { describe, expect, it } from 'vitest';
import {
  resolveColumnActionDirectory,
  resolveColumnPaneDirectory,
  resolveColumnPathsAfterFileSelection,
  resolveColumnPathsAfterFolderSelection,
} from '../lib/column-navigation';

describe('resolveColumnPathsAfterFolderSelection', () => {
  it('opens a folder from the root column as a single branch', () => {
    expect(resolveColumnPathsAfterFolderSelection([], '/Users/jane/Projects', 0)).toEqual([
      '/Users/jane/Projects',
    ]);
  });

  it('replaces stale descendants when selecting another folder from the root column', () => {
    const current = [
      '/Users/jane/Projects',
      '/Users/jane/Projects/AetherFlow',
      '/Users/jane/Projects/AetherFlow/tmp',
    ];

    expect(resolveColumnPathsAfterFolderSelection(current, '/Users/jane/Downloads', 0)).toEqual([
      '/Users/jane/Downloads',
    ]);
  });

  it('keeps ancestors and replaces descendants when selecting a sibling from a child column', () => {
    const current = [
      '/Users/jane/Projects',
      '/Users/jane/Projects/AetherFlow',
      '/Users/jane/Projects/AetherFlow/tmp',
    ];

    expect(resolveColumnPathsAfterFolderSelection(current, '/Users/jane/Projects/aether-explorer', 1)).toEqual([
      '/Users/jane/Projects',
      '/Users/jane/Projects/aether-explorer',
    ]);
  });

  it('falls back to parent-path inference for non-column callers', () => {
    const current = [
      '/Users/jane/Projects',
      '/Users/jane/Projects/AetherFlow',
    ];

    expect(resolveColumnPathsAfterFolderSelection(current, '/Users/jane/Projects/AetherFlow/tmp')).toEqual([
      '/Users/jane/Projects',
      '/Users/jane/Projects/AetherFlow',
      '/Users/jane/Projects/AetherFlow/tmp',
    ]);
  });
});

describe('resolveColumnPathsAfterFileSelection', () => {
  it('closes every child column when selecting a file from the root column', () => {
    const current = [
      '/Users/jane/Downloads/tmp',
      '/Users/jane/Downloads/tmp/nested',
    ];

    expect(resolveColumnPathsAfterFileSelection(current, '/Users/jane/Downloads/del.sh.zip', 0)).toEqual([]);
  });

  it('keeps ancestors and closes stale descendants when selecting a file from a child column', () => {
    const current = [
      '/Users/jane/Downloads/tmp',
      '/Users/jane/Downloads/tmp/nested',
      '/Users/jane/Downloads/tmp/nested/deeper',
    ];

    expect(resolveColumnPathsAfterFileSelection(current, '/Users/jane/Downloads/tmp/del.sh.zip', 1)).toEqual([
      '/Users/jane/Downloads/tmp',
    ]);
  });

  it('falls back to parent-path inference for non-column callers', () => {
    const current = [
      '/Users/jane/Downloads/tmp',
      '/Users/jane/Downloads/tmp/nested',
    ];

    expect(resolveColumnPathsAfterFileSelection(current, '/Users/jane/Downloads/tmp/nested/file.txt')).toEqual([
      '/Users/jane/Downloads/tmp',
      '/Users/jane/Downloads/tmp/nested',
    ]);
  });
});

describe('resolveColumnActionDirectory', () => {
  it('uses the last real column path when current path is a virtual root', () => {
    expect(resolveColumnActionDirectory('aether://favorites', 'column', [
      '/Users/jane/Projects',
    ])).toBe('/Users/jane/Projects');
  });

  it('uses the last remote column path when browsing a remote tree', () => {
    expect(resolveColumnActionDirectory('aether-remote://server/', 'column', [
      'aether-remote://server/Sites',
      'aether-remote://server/Sites/public',
    ])).toBe('aether-remote://server/Sites/public');
  });

  it('does not allow writes to a virtual root outside column mode', () => {
    expect(resolveColumnActionDirectory('aether://favorites', 'list', [])).toBe('');
  });
});

describe('resolveColumnPaneDirectory', () => {
  it('uses a real column parent path for blank pane actions', () => {
    expect(resolveColumnPaneDirectory('aether://favorites', '/Users/jane/Projects')).toBe('/Users/jane/Projects');
  });

  it('uses a remote column parent path for blank pane actions', () => {
    expect(resolveColumnPaneDirectory(
      'aether-remote://server/',
      'aether-remote://server/Sites',
    )).toBe('aether-remote://server/Sites');
  });

  it('falls back to the current real path when pane parent is absent', () => {
    expect(resolveColumnPaneDirectory('/Users/jane/Downloads', undefined)).toBe('/Users/jane/Downloads');
  });
});
