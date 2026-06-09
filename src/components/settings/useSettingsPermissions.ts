import type { TFunction } from 'i18next';
import { useFullDiskAccessPermission } from '../../lib/full-disk-access';
import { useAppIdentity } from '../../lib/app-identity';

export type {
  FullDiskAccessCheckOptions,
  FullDiskAccessCheckResult,
  FullDiskAccessProbeResult,
  FullDiskAccessStatus,
} from '../../lib/full-disk-access';

export type { AppIdentity } from '../../lib/app-identity';

export function useSettingsPermissions(_t: TFunction) {
  const permission = useFullDiskAccessPermission();
  const identity = useAppIdentity();

  return {
    ...permission,
    ...identity,
  };
}
