import { describe, expect, it } from 'vitest';
import {
  fingerprintPanicLog,
  shouldShowStartupPanicPrompt,
} from '../lib/startup-diagnostics';

describe('fingerprintPanicLog', () => {
  it('returns stable fingerprints for the same log', () => {
    const log = '[1] RUST PANIC\nmessage: boom';

    expect(fingerprintPanicLog(log)).toBe(fingerprintPanicLog(log));
  });

  it('changes when log content changes', () => {
    expect(fingerprintPanicLog('panic one')).not.toBe(fingerprintPanicLog('panic two'));
  });
});

describe('shouldShowStartupPanicPrompt', () => {
  it('does not show for missing or blank logs', () => {
    expect(shouldShowStartupPanicPrompt(null, null)).toBe(false);
    expect(shouldShowStartupPanicPrompt('', null)).toBe(false);
    expect(shouldShowStartupPanicPrompt('   ', null)).toBe(false);
  });

  it('shows when a panic log has not been acknowledged', () => {
    expect(shouldShowStartupPanicPrompt('panic', null)).toBe(true);
  });

  it('does not show when the same panic log was already acknowledged', () => {
    const log = 'panic';

    expect(shouldShowStartupPanicPrompt(log, fingerprintPanicLog(log))).toBe(false);
  });

  it('shows when a different panic log appears after an acknowledgement', () => {
    expect(shouldShowStartupPanicPrompt('panic two', fingerprintPanicLog('panic one'))).toBe(true);
  });
});
