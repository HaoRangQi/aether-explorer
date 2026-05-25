export interface DirectorySignatureChange {
  nextFingerprint: string;
  shouldRefresh: boolean;
}

export function shouldPollDirectorySignature(
  isActive: boolean,
  currentPath: string,
  isVirtualRoot: boolean,
): boolean {
  return isActive && Boolean(currentPath) && !isVirtualRoot;
}

export function resolveDirectorySignatureChange(
  previousFingerprint: string | null,
  nextFingerprint: string,
): DirectorySignatureChange {
  return {
    nextFingerprint,
    shouldRefresh: Boolean(previousFingerprint && nextFingerprint !== previousFingerprint),
  };
}
