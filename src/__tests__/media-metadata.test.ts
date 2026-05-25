import { describe, expect, it } from 'vitest';
import { formatMediaDuration } from '../lib/media-metadata';

describe('formatMediaDuration', () => {
  it('formats sub-hour durations', () => {
    expect(formatMediaDuration(0)).toBe('0:00');
    expect(formatMediaDuration(9.9)).toBe('0:09');
    expect(formatMediaDuration(59.999)).toBe('0:59');
    expect(formatMediaDuration(65)).toBe('1:05');
    expect(formatMediaDuration(3599.9)).toBe('59:59');
  });

  it('formats hour durations', () => {
    expect(formatMediaDuration(3600)).toBe('1:00:00');
    expect(formatMediaDuration(3725.8)).toBe('1:02:05');
  });

  it('returns empty string for invalid durations', () => {
    expect(formatMediaDuration(Number.NaN)).toBe('');
    expect(formatMediaDuration(Number.POSITIVE_INFINITY)).toBe('');
    expect(formatMediaDuration(Number.NEGATIVE_INFINITY)).toBe('');
    expect(formatMediaDuration(-1)).toBe('');
  });
});
