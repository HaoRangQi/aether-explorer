import type { FileItem } from '../types';

export interface FileLookup {
  fileById: Map<string, FileItem>;
  fileIndexById: Map<string, number>;
}

export function buildFileLookup(files: FileItem[]): FileLookup {
  return {
    fileById: new Map(files.map(file => [file.id, file])),
    fileIndexById: new Map(files.map((file, index) => [file.id, index])),
  };
}

export function resolveSelectedFiles(selectedFileIds: string[], lookup: FileLookup): FileItem[] {
  const uniqueIds = new Set(selectedFileIds);
  return Array.from(uniqueIds)
    .map(id => lookup.fileById.get(id))
    .filter((file): file is FileItem => Boolean(file))
    .sort((a, b) => (lookup.fileIndexById.get(a.id) ?? 0) - (lookup.fileIndexById.get(b.id) ?? 0));
}

export function resolveLastSelectedFile(selectedFileIds: string[], lookup: FileLookup): FileItem | undefined {
  return lookup.fileById.get(selectedFileIds[selectedFileIds.length - 1]);
}

export function resolveAdjacentSelectedFile(
  files: FileItem[],
  selectedFileIds: string[],
  direction: 'next' | 'previous',
): FileItem | undefined {
  if (files.length === 0) return undefined;

  const lastSelectedId = selectedFileIds[selectedFileIds.length - 1];
  const currentIndex = lastSelectedId
    ? files.findIndex(file => file.id === lastSelectedId)
    : -1;

  if (currentIndex === -1) {
    return direction === 'next' ? files[0] : files[files.length - 1];
  }

  const nextIndex = direction === 'next'
    ? Math.min(currentIndex + 1, files.length - 1)
    : Math.max(currentIndex - 1, 0);

  return files[nextIndex];
}
