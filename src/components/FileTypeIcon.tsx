import {
  AppWindowMac,
  FileArchive,
  FileCode2,
  FileIcon,
  FileImage,
  FileJson,
  FileMusic,
  FileVideoCamera,
  Sheet,
} from 'lucide-react';
import type { FileItem } from '../types';
import { getFileExtension, resolveFileIconVariant } from '../lib/file-icon';

type FileIconTarget = {
  type?: string;
  name?: string;
  thumbnail?: string | null;
};

interface FileTypeIconProps {
  file?: FileIconTarget | null;
  type?: FileItem['type'] | 'file';
  thumbnailOverride?: string;
  className?: string;
}

interface FinderBadgeProps {
  label: string;
  accent: string;
  detail?: string;
  className?: string;
}

function FinderBadge({ label, accent, detail = '#d7dee8', className = 'h-full w-full' }: FinderBadgeProps) {
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden="true">
      <path d="M15 6h24l12 12v35c0 3.3-2.7 6-6 6H15c-3.3 0-6-2.7-6-6V12c0-3.3 2.7-6 6-6z" fill="#f8fafc" />
      <path d="M39 6v12h12z" fill="#e6edf5" />
      <path d="M15 6h24l12 12" fill="none" stroke="#d5dde8" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M9 12c0-3.3 2.7-6 6-6h24v12h12v35c0 3.3-2.7 6-6 6H15c-3.3 0-6-2.7-6-6z" fill="none" stroke="#cfd8e3" strokeWidth="2.2" strokeLinejoin="round" />
      <rect x="15" y="22" width="24" height="4" rx="2" fill={detail} />
      <rect x="15" y="29" width="16" height="4" rx="2" fill={detail} />
      <rect x="10" y="40" width="44" height="14" rx="7" fill={accent} />
      <text
        x="32"
        y="50"
        textAnchor="middle"
        fontSize={label.length >= 5 ? '11' : '13'}
        fontWeight="800"
        fill="#ffffff"
        style={{ letterSpacing: '0.08em' }}
      >
        {label}
      </text>
    </svg>
  );
}

function SolidFolderIcon({ className = 'h-full w-full' }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden="true">
      <path d="M8 19c0-4.4 3.6-8 8-8h11.2c2.4 0 4.7 1 6.3 2.7l2.3 2.3H50c3.9 0 7 3.1 7 7v3H8z" fill="#9fc0ff" />
      <path d="M8 24c0-4.4 3.6-8 8-8h34c3.9 0 7 3.1 7 7v20c0 5.5-4.5 10-10 10H17c-5 0-9-4-9-9z" fill="#5c90ff" />
      <path d="M12 28h41c3.3 0 6 2.7 6 6v9c0 5-4 9-9 9H18c-5.5 0-10-4.5-10-10V32c0-2.2 1.8-4 4-4z" fill="#79a8ff" />
      <path d="M14 28h39c2.1 0 4 1.1 5 2.9l1.2 2.1H8.5l1.1-2.2c0.9-1.7 2.7-2.8 4.4-2.8z" fill="#c7dcff" opacity="0.95" />
      <path d="M18 18h12.2c1.3 0 2.6 0.5 3.5 1.5l1.8 1.8H16.5c-1.4 0-2.8 0.3-4 0.9V21c0-1.7 1.8-3 5.5-3z" fill="#d9e7ff" opacity="0.95" />
    </svg>
  );
}

function iconClassName(className?: string, colorClass?: string) {
  return [className || 'h-full w-full', colorClass || ''].filter(Boolean).join(' ');
}

function badgeLabel(name: string | undefined, fallback: string) {
  const extension = getFileExtension(name || '');
  if (!extension) return fallback;
  return extension.toUpperCase().slice(0, 5);
}

export default function FileTypeIcon({ file, type, thumbnailOverride, className }: FileTypeIconProps) {
  const resolvedType = file?.type || type || 'file';
  const thumbnail = thumbnailOverride || file?.thumbnail || '';
  const name = file?.name;

  if ((resolvedType === 'application' || resolvedType === 'image') && thumbnail) {
    return <img src={thumbnail} alt="" className={className || 'h-full w-full object-contain drop-shadow-sm'} draggable={false} />;
  }

  switch (resolveFileIconVariant({ type: resolvedType, name: file?.name })) {
    case 'folder-solid':
      return <SolidFolderIcon className={className} />;
    case 'document-badge':
      return <FinderBadge label={badgeLabel(name, 'DOC')} accent="#3b82f6" detail="#dbeafe" className={className} />;
    case 'presentation-badge':
      return <FinderBadge label={badgeLabel(name, 'PPT')} accent="#f97316" detail="#fed7aa" className={className} />;
    case 'spreadsheet-badge':
      return <FinderBadge label={badgeLabel(name, 'XLS')} accent="#16a34a" detail="#bbf7d0" className={className} />;
    case 'apk-badge':
      return <FinderBadge label={badgeLabel(name, 'APK')} accent="#10b981" detail="#a7f3d0" className={className} />;
    case 'installer-badge':
      return <FinderBadge label={badgeLabel(name, 'PKG')} accent="#d97706" detail="#fde68a" className={className} />;
    case 'disk-image-badge':
      return <FinderBadge label={badgeLabel(name, 'ISO')} accent="#6366f1" detail="#c7d2fe" className={className} />;
    case 'ebook-badge':
      return <FinderBadge label={badgeLabel(name, 'EPUB')} accent="#8b5cf6" detail="#ddd6fe" className={className} />;
    case 'design-badge':
      return <FinderBadge label={badgeLabel(name, 'PSD')} accent="#d946ef" detail="#f5d0fe" className={className} />;
    case 'archive-badge':
      return <FinderBadge label={badgeLabel(name, 'ZIP')} accent="#ca8a04" detail="#fef08a" className={className} />;
    case 'pdf-badge':
      return <FinderBadge label={badgeLabel(name, 'PDF')} accent="#ef4444" detail="#fecaca" className={className} />;
    case 'json':
      return <FileJson className={iconClassName(className, 'text-amber-500')} />;
    case 'image':
      return <FileImage className={iconClassName(className, 'text-sky-500')} />;
    case 'video':
      return <FileVideoCamera className={iconClassName(className, 'text-violet-500')} />;
    case 'audio':
      return <FileMusic className={iconClassName(className, 'text-pink-500')} />;
    case 'application':
      return <AppWindowMac className={iconClassName(className, 'text-icon')} />;
    case 'code':
      return <FileCode2 className={iconClassName(className, 'text-cyan-500')} />;
    case 'text':
      return <Sheet className={iconClassName(className, 'text-secondary-custom')} />;
    case 'generic':
      return <FileIcon className={iconClassName(className, 'text-secondary-custom')} />;
    default:
      if (resolvedType === 'archive') return <FileArchive className={iconClassName(className, 'text-yellow-500')} />;
      return <FileIcon className={iconClassName(className, 'text-secondary-custom')} />;
  }
}
