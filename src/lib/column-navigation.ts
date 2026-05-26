import { getParentPath, isVirtualPath } from './path-helpers';

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
    const lastRealColumnPath = [...columnPaths].reverse().find(path => !isVirtualPath(path));
    if (lastRealColumnPath) return lastRealColumnPath;
  }

  return currentPath && !isVirtualPath(currentPath) ? currentPath : '';
}

export function resolveColumnPaneDirectory(currentPath: string, parentPath: string | undefined): string {
  if (parentPath && !isVirtualPath(parentPath)) return parentPath;
  return currentPath && !isVirtualPath(currentPath) ? currentPath : '';
}
