import type { DirectorySizeTaskStatus, FileHashResult } from '../../api/filesystem';
import type { FileItem } from '../../types';

export interface DirectorySizeInfo {
  path: string;
  bytes: number;
  formatted: string;
  allocated_bytes?: number;
  formatted_allocated?: string;
  file_count: number;
  skipped_count?: number;
  isApproximate?: boolean;
  status?: DirectorySizeTaskStatus;
  error?: string | null;
}

export interface HashDialogState {
  file: FileItem;
  loading: boolean;
  result: FileHashResult | null;
  error: string;
}
