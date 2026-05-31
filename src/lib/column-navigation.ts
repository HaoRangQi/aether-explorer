import { getParentPath, isRemotePath, isVirtualPath } from './path-helpers';

function isValidColumnIndex(value: number | undefined, maxIndex: number): value is number {
  return typeof value === 'number'
    && Number.isInteger(value)
    && value >= 0
    && value <= maxIndex;
}

function inferSourceColumnIndex(currentColumnPaths: string[], selectedFolderPath: string): number {
  const parentPath = getParentPath(selectedFolderPath);
  const parentIndex = currentColumnPaths.indexOf(parentPath);
  return parentIndex >= 0 ? parentIndex + 1 : 0;
}

function isActionablePanePath(path: string | undefined): path is string {
  return Boolean(path) && !isVirtualPath(path);
}

export function resolveColumnPathsAfterFolderSelection(
  currentColumnPaths: string[],
  selectedFolderPath: string,
  sourceColumnIndex?: number,
): string[] {
  if (!selectedFolderPath) return currentColumnPaths;

  const resolvedColumnIndex = isValidColumnIndex(sourceColumnIndex, currentColumnPaths.length)
    ? sourceColumnIndex
    : inferSourceColumnIndex(currentColumnPaths, selectedFolderPath);

  if (currentColumnPaths[resolvedColumnIndex] === selectedFolderPath) {
    return currentColumnPaths;
  }

  return [
    ...currentColumnPaths.slice(0, resolvedColumnIndex),
    selectedFolderPath,
  ];
}

export function resolveColumnPathsAfterFileSelection(
  currentColumnPaths: string[],
  selectedFilePath: string,
  sourceColumnIndex?: number,
): string[] {
  if (!selectedFilePath) return currentColumnPaths;

  const resolvedColumnIndex = isValidColumnIndex(sourceColumnIndex, currentColumnPaths.length)
    ? sourceColumnIndex
    : inferSourceColumnIndex(currentColumnPaths, selectedFilePath);

  return currentColumnPaths.slice(0, resolvedColumnIndex);
}

export function resolveColumnActionDirectory(
  currentPath: string,
  displayMode: string,
  columnPaths: string[],
): string {
  if (displayMode === 'column') {
    const currentIsRemote = isRemotePath(currentPath);
    const lastRealColumnPath = [...columnPaths]
      .reverse()
      .find(path => isActionablePanePath(path) && isRemotePath(path) === currentIsRemote);
    if (lastRealColumnPath) return lastRealColumnPath;
  }

  return isActionablePanePath(currentPath) ? currentPath : '';
}

export function resolveColumnPaneDirectory(currentPath: string, parentPath: string | undefined): string {
  if (isActionablePanePath(parentPath)) return parentPath;
  return isActionablePanePath(currentPath) ? currentPath : '';
}
