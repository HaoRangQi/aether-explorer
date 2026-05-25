import { describe, expect, it } from 'vitest';
import {
  resolveDirectorySignatureChange,
  shouldPollDirectorySignature,
} from '../lib/directory-signature';

describe('shouldPollDirectorySignature', () => {
  it('polls only for active real paths', () => {
    expect(shouldPollDirectorySignature(true, '/Users/jane', false)).toBe(true);
    expect(shouldPollDirectorySignature(false, '/Users/jane', false)).toBe(false);
    expect(shouldPollDirectorySignature(true, '', false)).toBe(false);
    expect(shouldPollDirectorySignature(true, 'aether://favorites', true)).toBe(false);
  });
});

describe('resolveDirectorySignatureChange', () => {
  it('records the first fingerprint without refreshing', () => {
    expect(resolveDirectorySignatureChange(null, 'sig-a')).toEqual({
      nextFingerprint: 'sig-a',
      shouldRefresh: false,
    });
    expect(resolveDirectorySignatureChange(null, '')).toEqual({
      nextFingerprint: '',
      shouldRefresh: false,
    });
  });

  it('does not refresh when the previous fingerprint is empty', () => {
    expect(resolveDirectorySignatureChange('', 'sig-a')).toEqual({
      nextFingerprint: 'sig-a',
      shouldRefresh: false,
    });
  });

  it('does not refresh when the fingerprint is unchanged', () => {
    expect(resolveDirectorySignatureChange('sig-a', 'sig-a')).toEqual({
      nextFingerprint: 'sig-a',
      shouldRefresh: false,
    });
  });

  it('refreshes when the fingerprint changes', () => {
    expect(resolveDirectorySignatureChange('sig-a', 'sig-b')).toEqual({
      nextFingerprint: 'sig-b',
      shouldRefresh: true,
    });
    expect(resolveDirectorySignatureChange('sig-a', '')).toEqual({
      nextFingerprint: '',
      shouldRefresh: true,
    });
  });
});
