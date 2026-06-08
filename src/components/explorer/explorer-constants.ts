export const TAG_COLORS: Record<string, string> = {
  'tag-red': '#ff5f56',
  'tag-orange': '#ffbd2e',
  'tag-yellow': '#fcd430',
  'tag-green': '#27c93f',
  'tag-blue': '#007aff',
  'tag-purple': '#bf5af2',
  'tag-gray': '#8e8e93',
};

export const SORT_DEFAULT_DIRECTION: Record<string, 'asc' | 'desc'> = {
  modified: 'desc',
  size: 'desc',
};

export const INTERNAL_FILE_DRAG_MIME = 'application/x-aether-file-paths';
export const FILE_DRAG_START_EVENT = 'aether-file-drag-start';
export const FILE_DRAG_END_EVENT = 'aether-file-drag-end';
export const FILE_DRAG_END_AT_EVENT = 'aether-file-drag-end-at';
export const FILE_DROP_STARTED_EVENT = 'aether-file-drop-started';
export const FILE_DROP_ACCEPTED_EVENT = 'aether-file-drop-accepted';
export const TAURI_DRAG_DROP_EVENT = 'tauri://drag-drop';
export const TAURI_DRAG_ENTER_EVENT = 'tauri://drag-enter';
export const TAURI_DRAG_LEAVE_EVENT = 'tauri://drag-leave';
export const INCOMING_DRAG_VISIBLE_MS = 12000;
export const FEEDBACK_VISIBLE_MS = 3200;
export const OPEN_WITH_SUBMENU_CLOSE_DELAY_MS = 220;
export const LARGE_BATCH_OPERATION_THRESHOLD = 5000;
export const MOVE_TASK_DEDUPE_WINDOW_MS = 1500;
export const APP_ICON_CACHE_LIMIT = 256;
export const FOLDER_SIZE_ESTIMATE_CACHE_TTL_MS = 30_000;
export const FOLDER_SIZE_ESTIMATE_BATCH_SIZE = 24;
export const FOLDER_SIZE_ESTIMATE_DEBOUNCE_MS = 60;
export const DIR_SIZE_POLL_INTERVAL_MS = 180;
export const FAVORITES_VIRTUAL_PATH = 'aether://favorites';
export const RECENT_VIRTUAL_PATH = 'aether://recent';
export const TAGS_VIRTUAL_PREFIX = 'aether://tags/';
export const OPEN_WITH_SELECT_PLACEHOLDER = '__aether-open-with-placeholder__';
export const OPEN_WITH_SELECT_OTHER = '__aether-open-with-other__';
export const OPEN_WITH_APPS = ['Finder', 'Preview', 'TextEdit', 'Safari', 'Google Chrome', 'Visual Studio Code'];
export const PROTECTED_ROOT_APPROVALS_KEY = 'aether-protected-root-approvals';
export const REMOTE_DIRECTORY_UI_TIMEOUT_MS = 5000;
export const REMOTE_DIRECTORY_TIMEOUT_MESSAGE = '远程目录加载超时（5 秒）。请检查服务器地址、端口、账号凭据和网络。';
