import { describe, expect, it, vi } from 'vitest';
import {
  buildMoveTaskDedupeKey,
  getPdfPreviewSrc,
  getRelativeTimeLabel,
  parseModifiedTimestamp,
  parseSizeToBytes,
} from '../components/explorer/explorer-utils';

vi.mock('@tauri-apps/api/core', () => ({
  convertFileSrc: (path: string) => `asset://${path}`,
}));

describe('parseModifiedTimestamp', () => {
  it('parses filesystem timestamps and falls back to zero', () => {
    expect(parseModifiedTimestamp('2026-05-31 18:20')).toBe(new Date('2026-05-31T18:20').getTime());
    expect(parseModifiedTimestamp('')).toBe(0);
    expect(parseModifiedTimestamp('not a date')).toBe(0);
  });
});

describe('parseSizeToBytes', () => {
  it('normalizes common size units to bytes', () => {
    expect(parseSizeToBytes('1 KB')).toBe(1024);
    expect(parseSizeToBytes('1.5 MB')).toBe(1.5 * 1024 * 1024);
    expect(parseSizeToBytes('2 G')).toBe(2 * 1024 * 1024 * 1024);
    expect(parseSizeToBytes('3 TB')).toBe(3 * 1024 * 1024 * 1024 * 1024);
    expect(parseSizeToBytes('42')).toBe(42);
  });

  it('falls back to zero for missing or invalid sizes', () => {
    expect(parseSizeToBytes('--')).toBe(0);
    expect(parseSizeToBytes('')).toBe(0);
    expect(parseSizeToBytes('unknown')).toBe(0);
  });
});

describe('getRelativeTimeLabel', () => {
  it('returns relative labels for recent timestamps', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-01T12:00:00'));

    expect(getRelativeTimeLabel('2026-06-01 11:59')).toBe('1 分钟前');
    expect(getRelativeTimeLabel('2026-06-01 11:40')).toBe('半小时内');
    expect(getRelativeTimeLabel('2026-06-01 11:15')).toBe('1 小时内');
    expect(getRelativeTimeLabel('2026-06-01 08:00')).toBe('今天');
    expect(getRelativeTimeLabel('2026-05-31 08:00')).toBe('昨天');
    expect(getRelativeTimeLabel('2026-05-28 08:00')).toBe('4 天前');

    vi.useRealTimers();
  });

  it('hides invalid, unknown, and older timestamps', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-01T12:00:00'));

    expect(getRelativeTimeLabel('未知')).toBe('');
    expect(getRelativeTimeLabel('not a date')).toBe('');
    expect(getRelativeTimeLabel('2026-05-20 08:00')).toBe('');

    vi.useRealTimers();
  });
});

describe('getPdfPreviewSrc', () => {
  it('adds pdf viewer parameters to the cached asset url', () => {
    expect(getPdfPreviewSrc('/tmp/file.pdf')).toBe('asset:///tmp/file.pdf#page=1&view=FitH&toolbar=0&navpanes=0&scrollbar=0');
  });
});

describe('buildMoveTaskDedupeKey', () => {
  it('sorts source paths while normalizing trailing slashes after dedupe', () => {
    expect(buildMoveTaskDedupeKey(['/b/', '/a', '/a/'], '/target/', 'replace')).toBe('replace::/target::/a\u001f/a\u001f/b');
  });

  it('keeps root paths normalized', () => {
    expect(buildMoveTaskDedupeKey(['/', ''], '', 'skip')).toBe('skip::/::/');
  });
});
