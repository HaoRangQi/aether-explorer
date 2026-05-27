export type FileIconVariant =
  | 'folder-solid'
  | 'document-badge'
  | 'presentation-badge'
  | 'spreadsheet-badge'
  | 'apk-badge'
  | 'installer-badge'
  | 'disk-image-badge'
  | 'ebook-badge'
  | 'design-badge'
  | 'archive-badge'
  | 'pdf-badge'
  | 'json'
  | 'text'
  | 'image'
  | 'video'
  | 'audio'
  | 'application'
  | 'code'
  | 'generic';

const DOCUMENT_EXTENSIONS = new Set(['doc', 'docx', 'odt', 'pages', 'rtf', 'wps']);
const PRESENTATION_EXTENSIONS = new Set(['ppt', 'pptx', 'key', 'keynote', 'odp', 'dps']);
const SPREADSHEET_EXTENSIONS = new Set(['csv', 'tsv', 'xls', 'xlsx', 'numbers', 'ods', 'et']);
const APK_EXTENSIONS = new Set(['apk']);
const INSTALLER_EXTENSIONS = new Set(['dmg', 'pkg']);
const DISK_IMAGE_EXTENSIONS = new Set(['iso']);
const EBOOK_EXTENSIONS = new Set(['epub']);
const DESIGN_EXTENSIONS = new Set(['psd', 'ai', 'fig', 'sketch', 'xd']);
const ARCHIVE_EXTENSIONS = new Set(['zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz', 'tgz']);

export function getFileExtension(name = ''): string {
  const trimmed = name.trim();
  const lastDotIndex = trimmed.lastIndexOf('.');
  if (lastDotIndex <= 0 || lastDotIndex === trimmed.length - 1) {
    return '';
  }
  return trimmed.slice(lastDotIndex + 1).toLowerCase();
}

export function resolveFileIconVariant(file: { type?: string; name?: string }): FileIconVariant {
  const type = (file.type || 'file').toLowerCase();
  const extension = getFileExtension(file.name || '');

  if (type === 'folder') return 'folder-solid';

  if (DOCUMENT_EXTENSIONS.has(extension)) return 'document-badge';
  if (PRESENTATION_EXTENSIONS.has(extension)) return 'presentation-badge';
  if (SPREADSHEET_EXTENSIONS.has(extension)) return 'spreadsheet-badge';
  if (APK_EXTENSIONS.has(extension)) return 'apk-badge';
  if (INSTALLER_EXTENSIONS.has(extension)) return 'installer-badge';
  if (DISK_IMAGE_EXTENSIONS.has(extension)) return 'disk-image-badge';
  if (EBOOK_EXTENSIONS.has(extension)) return 'ebook-badge';
  if (DESIGN_EXTENSIONS.has(extension)) return 'design-badge';
  if (type === 'pdf' || extension === 'pdf') return 'pdf-badge';
  if (type === 'archive' || ARCHIVE_EXTENSIONS.has(extension)) return 'archive-badge';
  if (extension === 'json') return 'json';

  switch (type) {
    case 'image':
      return 'image';
    case 'video':
      return 'video';
    case 'audio':
      return 'audio';
    case 'application':
      return 'application';
    case 'code':
      return 'code';
    case 'text':
      return 'text';
    default:
      return 'generic';
  }
}
