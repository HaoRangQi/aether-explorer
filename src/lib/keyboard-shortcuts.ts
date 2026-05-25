export interface ShortcutEventLike {
  key: string;
  metaKey?: boolean;
  ctrlKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
}

export type AppShortcutAction = 'newWindow' | 'closeTab' | 'showShortcutHelp';

export type ExplorerShortcutAction =
  | 'aiRename'
  | 'selectAll'
  | 'copy'
  | 'cut'
  | 'paste'
  | 'showInfo'
  | 'refresh'
  | 'showListView'
  | 'showGridView'
  | 'showColumnView'
  | 'toggleHiddenFiles'
  | 'back'
  | 'forward'
  | 'navigateParent'
  | 'openFolder'
  | 'deleteSelection'
  | 'openSelection'
  | 'quickLook'
  | 'selectPrevious'
  | 'selectNext'
  | 'typeahead'
  | 'escape';

export interface ExplorerShortcutContext {
  hasSelection: boolean;
  hasLastSelectedFile: boolean;
  lastSelectedFileIsFolder: boolean;
  spacePreviewEnabled: boolean;
}

export function resolveNextTypeaheadQuery(currentQuery: string, key: string): string {
  return currentQuery === key ? key : `${currentQuery}${key}`;
}

export interface TypeaheadItem {
  id: string;
  name: string;
}

export function resolveTypeaheadTarget<T extends TypeaheadItem>(
  items: T[],
  prefix: string,
  currentId?: string,
  lastActivatedId?: string,
): T | undefined {
  const normalizedPrefix = prefix.trim().toLowerCase();
  if (!normalizedPrefix || items.length === 0) return undefined;

  const matchesPrefix = (item: T) => item.name.toLowerCase().startsWith(normalizedPrefix);
  const matches = items.filter(matchesPrefix);
  if (matches.length === 0) return undefined;

  if (normalizedPrefix.length > 1) {
    return matches[0];
  }

  const anchorId = currentId || lastActivatedId;
  const currentIndex = anchorId
    ? items.findIndex(item => item.id === anchorId)
    : -1;
  const startIndex = currentIndex >= 0 ? (currentIndex + 1) % items.length : 0;
  const ordered = [
    ...items.slice(startIndex),
    ...items.slice(0, startIndex),
  ];

  return ordered.find(matchesPrefix) || matches[0];
}

function isCommand(event: ShortcutEventLike): boolean {
  return Boolean(event.metaKey || event.ctrlKey);
}

function isPlainCommand(event: ShortcutEventLike): boolean {
  return isCommand(event) && !event.shiftKey && !event.altKey;
}

export function resolveAppShortcut(event: ShortcutEventLike): AppShortcutAction | null {
  if (
    !event.metaKey
    && !event.ctrlKey
    && event.shiftKey
    && !event.altKey
    && (event.key === '?' || event.key === '/')
  ) {
    return 'showShortcutHelp';
  }

  if (!isPlainCommand(event)) return null;

  switch (event.key.toLowerCase()) {
    case 'n':
      return 'newWindow';
    case 'w':
      return 'closeTab';
    default:
      return null;
  }
}

export function resolveExplorerShortcut(
  event: ShortcutEventLike,
  context: ExplorerShortcutContext,
): ExplorerShortcutAction | null {
  const key = event.key;
  const lowerKey = key.toLowerCase();

  if (isCommand(event) && event.shiftKey && !event.altKey && lowerKey === 'r') {
    return 'aiRename';
  }

  if (isCommand(event) && event.shiftKey && !event.altKey && key === '.') {
    return 'toggleHiddenFiles';
  }

  if (isPlainCommand(event)) {
    switch (lowerKey) {
      case '1':
        return 'showListView';
      case '2':
        return 'showGridView';
      case '3':
        return 'showColumnView';
      case 'a':
        return 'selectAll';
      case 'c':
        return context.hasSelection ? 'copy' : null;
      case 'x':
        return context.hasSelection ? 'cut' : null;
      case 'v':
        return 'paste';
      case 'i':
        return context.hasLastSelectedFile ? 'showInfo' : null;
      case 'r':
        return 'refresh';
      case '[':
        return 'back';
      case ']':
        return 'forward';
      case 'delete':
      case 'backspace':
        return context.hasSelection ? 'deleteSelection' : null;
      default:
        break;
    }
  }

  if (isCommand(event) && !event.shiftKey && !event.altKey && key === 'ArrowUp') {
    return 'navigateParent';
  }

  if (
    isCommand(event)
    && !event.shiftKey
    && !event.altKey
    && key === 'ArrowDown'
    && context.lastSelectedFileIsFolder
  ) {
    return 'openFolder';
  }

  if (!isCommand(event) && !event.altKey && !event.shiftKey) {
    switch (key) {
      case 'Backspace':
        return context.hasSelection ? 'deleteSelection' : 'back';
      case 'Delete':
        return context.hasSelection ? 'deleteSelection' : null;
      case 'Enter':
        return context.hasLastSelectedFile ? 'openSelection' : null;
      case ' ':
        return context.hasLastSelectedFile && context.spacePreviewEnabled ? 'quickLook' : null;
      case 'ArrowUp':
      case 'ArrowLeft':
        return 'selectPrevious';
      case 'ArrowDown':
      case 'ArrowRight':
        return 'selectNext';
      case 'Escape':
        return 'escape';
      default:
        if (key.length === 1 && /^[\p{L}\p{N}]$/u.test(key)) {
          return 'typeahead';
        }
    }
  }

  return null;
}
