export const STARTUP_PANIC_LOG_SEEN_KEY = 'aether-startup-panic-log-seen';

export function fingerprintPanicLog(log: string): string {
  let hash = 5381;
  for (let index = 0; index < log.length; index += 1) {
    hash = ((hash << 5) + hash) ^ log.charCodeAt(index);
  }
  return `${log.length}:${hash >>> 0}`;
}

export function shouldShowStartupPanicPrompt(log: string | null | undefined, seenFingerprint: string | null | undefined): boolean {
  if (!log || !log.trim()) return false;
  return fingerprintPanicLog(log) !== seenFingerprint;
}
