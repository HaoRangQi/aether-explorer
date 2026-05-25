export type AppErrorKind =
  | 'PermissionDenied'
  | 'NotFound'
  | 'DiskFull'
  | 'Busy'
  | 'InvalidPath'
  | 'Conflict'
  | 'Cancelled'
  | 'TrashUnsupported'
  | 'Internal';

export interface AppErrorPayload {
  kind: AppErrorKind;
  message: string;
  path?: string;
  detail?: Record<string, unknown>;
}

export class AetherAppError extends Error {
  kind: AppErrorKind;
  path?: string;
  detail: Record<string, unknown>;

  constructor(payload: AppErrorPayload) {
    super(payload.message);
    this.name = 'AetherAppError';
    this.kind = payload.kind;
    this.path = payload.path;
    this.detail = payload.detail || {};
  }

  get userMessage(): string {
    if (this.path) return `${this.message}：${this.path}`;
    return this.message;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object';
}

function fromKindString(kind: unknown): AppErrorKind | null {
  if (typeof kind !== 'string') return null;
  const known: AppErrorKind[] = [
    'PermissionDenied',
    'NotFound',
    'DiskFull',
    'Busy',
    'InvalidPath',
    'Conflict',
    'Cancelled',
    'TrashUnsupported',
    'Internal',
  ];
  return known.includes(kind as AppErrorKind) ? kind as AppErrorKind : null;
}

function classifyMessage(message: string): AppErrorKind {
  if (/PermissionDenied|permission denied|权限|not allowed|denied/i.test(message)) return 'PermissionDenied';
  if (/NotFound|not found|不存在|no such file/i.test(message)) return 'NotFound';
  if (/DiskFull|No space left|磁盘.*满|空间不足/i.test(message)) return 'DiskFull';
  if (/Busy|resource busy|文件被占用|占用/i.test(message)) return 'Busy';
  if (/InvalidPath|非法路径|路径解析失败|不安全路径|文件名/i.test(message)) return 'InvalidPath';
  if (/Conflict|冲突|已存在|覆盖/i.test(message)) return 'Conflict';
  if (/TrashUnsupported|外置卷.*废纸篓|external volume.*trash/i.test(message)) return 'TrashUnsupported';
  if (/Cancelled|cancelled|canceled|取消/i.test(message)) return 'Cancelled';
  return 'Internal';
}

function cleanMessage(message: string, kind: AppErrorKind): string {
  return message
    .replace(new RegExp(`^${kind}:\\s*`), '')
    .trim() || fallbackMessage(kind);
}

function fallbackMessage(kind: AppErrorKind): string {
  switch (kind) {
    case 'PermissionDenied': return '权限不足';
    case 'NotFound': return '路径不存在';
    case 'DiskFull': return '磁盘空间不足';
    case 'Busy': return '文件正在被占用';
    case 'InvalidPath': return '路径或文件名无效';
    case 'Conflict': return '存在文件冲突';
    case 'Cancelled': return '操作已取消';
    case 'TrashUnsupported': return '外置卷无法移至废纸篓';
    case 'Internal': return '操作失败';
  }
}

export function normalizeAppError(error: unknown): AetherAppError {
  if (error instanceof AetherAppError) return error;

  if (isRecord(error)) {
    const kind = fromKindString(error.kind);
    if (kind) {
      const message = typeof error.message === 'string'
        ? error.message
        : fallbackMessage(kind);
      const path = typeof error.path === 'string' ? error.path : undefined;
      const detail = isRecord(error.detail) ? error.detail : {};
      return new AetherAppError({ kind, message, path, detail });
    }
    if (typeof error.message === 'string') {
      const inferredKind = classifyMessage(error.message);
      const path = typeof error.path === 'string' ? error.path : undefined;
      const detail = isRecord(error.detail) ? error.detail : {};
      return new AetherAppError({
        kind: inferredKind,
        message: cleanMessage(error.message, inferredKind),
        path,
        detail,
      });
    }
  }

  const message = error instanceof Error
    ? error.message
    : typeof error === 'string'
      ? error
      : String(error);
  const kind = classifyMessage(message);
  return new AetherAppError({
    kind,
    message: cleanMessage(message, kind),
  });
}

export function directoryErrorKind(error: AetherAppError): 'permission' | 'notFound' | 'generic' {
  if (error.kind === 'PermissionDenied') return 'permission';
  if (error.kind === 'NotFound') return 'notFound';
  return 'generic';
}
