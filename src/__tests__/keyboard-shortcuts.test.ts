import { describe, expect, it } from 'vitest';
import {
  resolveAppShortcut,
  resolveExplorerShortcut,
  resolveNextTypeaheadQuery,
  resolveTypeaheadTarget,
  type ExplorerShortcutContext,
  type ShortcutEventLike,
} from '../lib/keyboard-shortcuts';

const defaultContext: ExplorerShortcutContext = {
  hasSelection: false,
  hasLastSelectedFile: false,
  lastSelectedFileIsFolder: false,
  spacePreviewEnabled: true,
};

function key(key: string, overrides: Partial<ShortcutEventLike> = {}): ShortcutEventLike {
  return { key, ...overrides };
}

function explorerShortcut(
  event: ShortcutEventLike,
  context: Partial<ExplorerShortcutContext> = {},
) {
  return resolveExplorerShortcut(event, { ...defaultContext, ...context });
}

describe('resolveAppShortcut', () => {
  it('maps app-level window shortcuts', () => {
    expect(resolveAppShortcut(key('n', { metaKey: true }))).toBe('newWindow');
    expect(resolveAppShortcut(key('n', { ctrlKey: true }))).toBe('newWindow');
    expect(resolveAppShortcut(key('W', { metaKey: true }))).toBe('closeTab');
    expect(resolveAppShortcut(key('W', { ctrlKey: true }))).toBe('closeTab');
  });

  it('maps question mark to shortcut help', () => {
    expect(resolveAppShortcut(key('?', { shiftKey: true }))).toBe('showShortcutHelp');
    expect(resolveAppShortcut(key('/', { shiftKey: true }))).toBe('showShortcutHelp');
  });

  it('ignores modified or non-command app shortcuts', () => {
    expect(resolveAppShortcut(key('n'))).toBeNull();
    expect(resolveAppShortcut(key('n', { metaKey: true, shiftKey: true }))).toBeNull();
    expect(resolveAppShortcut(key('n', { ctrlKey: true, altKey: true }))).toBeNull();
    expect(resolveAppShortcut(key('w', { metaKey: true, altKey: true }))).toBeNull();
    expect(resolveAppShortcut(key('w', { ctrlKey: true, shiftKey: true }))).toBeNull();
    expect(resolveAppShortcut(key('?'))).toBeNull();
    expect(resolveAppShortcut(key('?', { shiftKey: true, metaKey: true }))).toBeNull();
    expect(resolveAppShortcut(key('/', { shiftKey: true, ctrlKey: true }))).toBeNull();
  });
});

describe('resolveExplorerShortcut', () => {
  it('maps command shortcuts for selection and clipboard actions', () => {
    expect(explorerShortcut(key('a', { metaKey: true }))).toBe('selectAll');
    expect(explorerShortcut(key('a', { ctrlKey: true }))).toBe('selectAll');
    expect(explorerShortcut(key('A', { metaKey: true }))).toBe('selectAll');
    expect(explorerShortcut(key('c', { metaKey: true }), { hasSelection: true })).toBe('copy');
    expect(explorerShortcut(key('c', { ctrlKey: true }), { hasSelection: true })).toBe('copy');
    expect(explorerShortcut(key('C', { metaKey: true }), { hasSelection: true })).toBe('copy');
    expect(explorerShortcut(key('x', { metaKey: true }), { hasSelection: true })).toBe('cut');
    expect(explorerShortcut(key('X', { ctrlKey: true }), { hasSelection: true })).toBe('cut');
    expect(explorerShortcut(key('v', { metaKey: true }))).toBe('paste');
    expect(explorerShortcut(key('V', { ctrlKey: true }))).toBe('paste');
  });

  it('does not copy or cut without selected files', () => {
    expect(explorerShortcut(key('c', { metaKey: true }))).toBeNull();
    expect(explorerShortcut(key('x', { metaKey: true }))).toBeNull();
  });

  it('does not trigger clipboard actions with extra shortcut modifiers', () => {
    expect(explorerShortcut(key('c', { metaKey: true, shiftKey: true }), { hasSelection: true })).toBeNull();
    expect(explorerShortcut(key('x', { metaKey: true, altKey: true }), { hasSelection: true })).toBeNull();
    expect(explorerShortcut(key('v', { ctrlKey: true, shiftKey: true }))).toBeNull();
    expect(explorerShortcut(key('v', { ctrlKey: true, altKey: true }))).toBeNull();
  });

  it('maps refresh separately from AI rename', () => {
    expect(explorerShortcut(key('r', { metaKey: true }))).toBe('refresh');
    expect(explorerShortcut(key('r', { ctrlKey: true }))).toBe('refresh');
    expect(explorerShortcut(key('r', { metaKey: true, shiftKey: true }))).toBe('aiRename');
    expect(explorerShortcut(key('r', { ctrlKey: true, shiftKey: true }))).toBe('aiRename');
    expect(explorerShortcut(key('r', { metaKey: true, altKey: true }))).toBeNull();
    expect(explorerShortcut(key('r', { metaKey: true, shiftKey: true, altKey: true }))).toBeNull();
  });

  it('maps display-mode and hidden-file shortcuts', () => {
    expect(explorerShortcut(key('1', { metaKey: true }))).toBe('showListView');
    expect(explorerShortcut(key('1', { ctrlKey: true }))).toBe('showListView');
    expect(explorerShortcut(key('2', { metaKey: true }))).toBe('showGridView');
    expect(explorerShortcut(key('2', { ctrlKey: true }))).toBe('showGridView');
    expect(explorerShortcut(key('3', { metaKey: true }))).toBe('showColumnView');
    expect(explorerShortcut(key('3', { ctrlKey: true }))).toBe('showColumnView');
    expect(explorerShortcut(key('.', { metaKey: true, shiftKey: true }))).toBe('toggleHiddenFiles');
    expect(explorerShortcut(key('.', { ctrlKey: true, shiftKey: true }))).toBe('toggleHiddenFiles');
    expect(explorerShortcut(key('1', { metaKey: true, altKey: true }))).toBeNull();
    expect(explorerShortcut(key('2', { metaKey: true, shiftKey: true }))).toBeNull();
    expect(explorerShortcut(key('3', { metaKey: true, altKey: true }))).toBeNull();
    expect(explorerShortcut(key('.', { metaKey: true, shiftKey: true, altKey: true }))).toBeNull();
  });

  it('maps navigation shortcuts', () => {
    expect(explorerShortcut(key('[', { metaKey: true }))).toBe('back');
    expect(explorerShortcut(key('[', { ctrlKey: true }))).toBe('back');
    expect(explorerShortcut(key(']', { metaKey: true }))).toBe('forward');
    expect(explorerShortcut(key(']', { ctrlKey: true }))).toBe('forward');
    expect(explorerShortcut(key('ArrowUp', { metaKey: true }))).toBe('navigateParent');
    expect(explorerShortcut(key('ArrowUp', { ctrlKey: true }))).toBe('navigateParent');
    expect(explorerShortcut(key('ArrowDown', { metaKey: true }), { lastSelectedFileIsFolder: true })).toBe('openFolder');
    expect(explorerShortcut(key('ArrowDown', { ctrlKey: true }), { lastSelectedFileIsFolder: true })).toBe('openFolder');
    expect(explorerShortcut(key('ArrowDown', { metaKey: true }), { hasLastSelectedFile: true, lastSelectedFileIsFolder: false })).toBeNull();
    expect(explorerShortcut(key('ArrowDown', { ctrlKey: true }), { hasLastSelectedFile: true, lastSelectedFileIsFolder: false })).toBeNull();
  });

  it('does not trigger navigation shortcuts with extra modifiers', () => {
    expect(explorerShortcut(key('[', { metaKey: true, shiftKey: true }))).toBeNull();
    expect(explorerShortcut(key(']', { ctrlKey: true, altKey: true }))).toBeNull();
    expect(explorerShortcut(key('ArrowUp', { metaKey: true, altKey: true }))).toBeNull();
    expect(explorerShortcut(key('ArrowDown', { ctrlKey: true, shiftKey: true }), { lastSelectedFileIsFolder: true })).toBeNull();
  });

  it('maps delete and backspace according to selection state', () => {
    expect(explorerShortcut(key('Delete'), { hasSelection: true })).toBe('deleteSelection');
    expect(explorerShortcut(key('Backspace'), { hasSelection: true })).toBe('deleteSelection');
    expect(explorerShortcut(key('Delete'))).toBeNull();
    expect(explorerShortcut(key('Backspace'))).toBe('back');
    expect(explorerShortcut(key('Delete', { metaKey: true }), { hasSelection: true })).toBe('deleteSelection');
  });

  it('maps open, quick look, info, and escape actions', () => {
    expect(explorerShortcut(key('Enter'), { hasLastSelectedFile: true })).toBe('openSelection');
    expect(explorerShortcut(key(' '), { hasLastSelectedFile: true })).toBe('quickLook');
    expect(explorerShortcut(key(' '))).toBeNull();
    expect(explorerShortcut(key(' '), { hasLastSelectedFile: true, spacePreviewEnabled: false })).toBeNull();
    expect(explorerShortcut(key('i', { metaKey: true }), { hasLastSelectedFile: true })).toBe('showInfo');
    expect(explorerShortcut(key('Escape'))).toBe('escape');
    expect(explorerShortcut(key('Enter', { metaKey: true }), { hasLastSelectedFile: true })).toBeNull();
    expect(explorerShortcut(key('Enter', { shiftKey: true }), { hasLastSelectedFile: true })).toBeNull();
    expect(explorerShortcut(key(' ', { metaKey: true }), { hasLastSelectedFile: true })).toBeNull();
    expect(explorerShortcut(key(' ', { shiftKey: true }), { hasLastSelectedFile: true })).toBeNull();
    expect(explorerShortcut(key('Escape', { metaKey: true }))).toBeNull();
    expect(explorerShortcut(key('Escape', { altKey: true }))).toBeNull();
  });

  it('maps plain arrows to selection movement and ignores modified arrows', () => {
    expect(explorerShortcut(key('ArrowUp'))).toBe('selectPrevious');
    expect(explorerShortcut(key('ArrowLeft'))).toBe('selectPrevious');
    expect(explorerShortcut(key('ArrowDown'))).toBe('selectNext');
    expect(explorerShortcut(key('ArrowRight'))).toBe('selectNext');

    expect(explorerShortcut(key('ArrowUp', { shiftKey: true }))).toBeNull();
    expect(explorerShortcut(key('ArrowDown', { altKey: true }))).toBeNull();
    expect(explorerShortcut(key('ArrowLeft', { shiftKey: true }))).toBeNull();
    expect(explorerShortcut(key('ArrowRight', { altKey: true }))).toBeNull();
    expect(explorerShortcut(key('ArrowUp', { metaKey: true, shiftKey: true }))).toBeNull();
    expect(explorerShortcut(key('ArrowDown', { metaKey: true, altKey: true }), { lastSelectedFileIsFolder: true })).toBeNull();
  });

  it('maps letter and number keys to typeahead without command modifiers', () => {
    expect(explorerShortcut(key('a'))).toBe('typeahead');
    expect(explorerShortcut(key('中'))).toBe('typeahead');
    expect(explorerShortcut(key('7'))).toBe('typeahead');
    expect(explorerShortcut(key('a', { metaKey: true }))).toBe('selectAll');
    expect(explorerShortcut(key('a', { ctrlKey: true }))).toBe('selectAll');
    expect(explorerShortcut(key('a', { altKey: true }))).toBeNull();
    expect(explorerShortcut(key('a', { shiftKey: true }))).toBeNull();
    expect(explorerShortcut(key('a', { ctrlKey: true, altKey: true }))).toBeNull();
  });
});

describe('resolveNextTypeaheadQuery', () => {
  it('appends new typeahead keys and keeps repeated keys as a single-character query', () => {
    expect(resolveNextTypeaheadQuery('', 'a')).toBe('a');
    expect(resolveNextTypeaheadQuery('a', 'b')).toBe('ab');
    expect(resolveNextTypeaheadQuery('a', 'a')).toBe('a');
    expect(resolveNextTypeaheadQuery('中', '文')).toBe('中文');
  });
});

describe('resolveTypeaheadTarget', () => {
  const items = [
    { id: 'alpha', name: 'Alpha' },
    { id: 'archive', name: 'Archive' },
    { id: 'beta', name: 'Beta' },
    { id: 'app', name: 'Application' },
  ];

  it('cycles repeated single-character matches from the current item', () => {
    expect(resolveTypeaheadTarget(items, 'a')?.id).toBe('alpha');
    expect(resolveTypeaheadTarget(items, 'a', 'alpha')?.id).toBe('archive');
    expect(resolveTypeaheadTarget(items, 'a', 'archive')?.id).toBe('app');
    expect(resolveTypeaheadTarget(items, 'a', 'app')?.id).toBe('alpha');
  });

  it('keeps multi-character prefix matches stable instead of cycling from current selection', () => {
    expect(resolveTypeaheadTarget(items, 'ap', 'alpha')?.id).toBe('app');
    expect(resolveTypeaheadTarget(items, 'ar', 'app')?.id).toBe('archive');
  });

  it('falls back to the last activated item when there is no current selection', () => {
    expect(resolveTypeaheadTarget(items, 'a', undefined, 'archive')?.id).toBe('app');
  });

  it('returns undefined without a usable prefix or match', () => {
    expect(resolveTypeaheadTarget(items, '')).toBeUndefined();
    expect(resolveTypeaheadTarget(items, 'z')).toBeUndefined();
    expect(resolveTypeaheadTarget([], 'a')).toBeUndefined();
  });
});
