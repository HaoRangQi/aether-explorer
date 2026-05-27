import { describe, expect, it } from 'vitest';
import { getFileExtension, resolveFileIconVariant } from '../lib/file-icon';

describe('getFileExtension', () => {
  it('returns lower-cased extensions', () => {
    expect(getFileExtension('Report.DOCX')).toBe('docx');
    expect(getFileExtension('archive.tar.gz')).toBe('gz');
  });

  it('returns an empty string when extension is absent', () => {
    expect(getFileExtension('README')).toBe('');
    expect(getFileExtension('.gitignore')).toBe('');
  });
});

describe('resolveFileIconVariant', () => {
  it('uses a solid folder variant for folders', () => {
    expect(resolveFileIconVariant({ type: 'folder', name: 'Projects' })).toBe('folder-solid');
  });

  it('maps common office and package suffixes to richer badge variants', () => {
    expect(resolveFileIconVariant({ type: 'text', name: 'proposal.docx' })).toBe('document-badge');
    expect(resolveFileIconVariant({ type: 'text', name: 'deck.pptx' })).toBe('presentation-badge');
    expect(resolveFileIconVariant({ type: 'text', name: 'budget.xlsx' })).toBe('spreadsheet-badge');
    expect(resolveFileIconVariant({ type: 'archive', name: 'android.apk' })).toBe('apk-badge');
    expect(resolveFileIconVariant({ type: 'archive', name: 'installer.pkg' })).toBe('installer-badge');
    expect(resolveFileIconVariant({ type: 'archive', name: 'disk.iso' })).toBe('disk-image-badge');
  });

  it('falls back to media and generic variants by file type', () => {
    expect(resolveFileIconVariant({ type: 'pdf', name: 'manual.pdf' })).toBe('pdf-badge');
    expect(resolveFileIconVariant({ type: 'image', name: 'cover.png' })).toBe('image');
    expect(resolveFileIconVariant({ type: 'application', name: 'Finder.app' })).toBe('application');
    expect(resolveFileIconVariant({ type: 'code', name: 'index.ts' })).toBe('code');
    expect(resolveFileIconVariant({ type: 'text', name: 'notes.txt' })).toBe('text');
    expect(resolveFileIconVariant({ type: 'file', name: 'unknown.bin' })).toBe('generic');
  });
});
