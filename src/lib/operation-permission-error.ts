import type { TFunction } from 'i18next';
import { directoryErrorKindForFullDiskAccess, normalizeAppError } from './app-error';
import { checkFullDiskAccessPermission } from './full-disk-access';

export interface OperationProtectedRootInfo {
  path: string;
  label: string;
}

export interface FormatOperationPermissionErrorInput {
  error: unknown;
  getProtectedRootForPath: (path: string) => OperationProtectedRootInfo | null;
  pathHints?: Array<string | null | undefined>;
  t: TFunction;
}

function uniqueNonEmpty(values: Array<string | null | undefined>): string[] {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value))));
}

export async function formatOperationPermissionError({
  error,
  getProtectedRootForPath,
  pathHints = [],
  t,
}: FormatOperationPermissionErrorInput): Promise<string> {
  const appError = normalizeAppError(error);
  if (appError.kind !== 'PermissionDenied') return appError.userMessage;

  const candidatePaths = uniqueNonEmpty([appError.path, ...pathHints]);
  const protectedRoot = candidatePaths
    .map(path => getProtectedRootForPath(path))
    .find((root): root is OperationProtectedRootInfo => Boolean(root));
  if (!protectedRoot) return appError.userMessage;

  const result = await checkFullDiskAccessPermission({ force: true });
  return directoryErrorKindForFullDiskAccess(appError, result.status, true) === 'permission'
    ? t('messages.fullDiskAccessOperationRequired', {
      root: protectedRoot.label,
      defaultValue: `Full Disk Access is required to operate on “${protectedRoot.label}”. Enable it in System Settings, then retry.`,
    })
    : appError.userMessage;
}
