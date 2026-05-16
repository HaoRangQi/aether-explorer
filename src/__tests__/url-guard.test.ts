import { describe, it, expect } from 'vitest';
import {
  isSafeShellOpenUrl,
  isValidWallpaperUrl,
  shellEscape,
  validateShellFragment,
} from '../lib/url-guard';

describe('isSafeShellOpenUrl', () => {
  it('accepts http/https/mailto', () => {
    expect(isSafeShellOpenUrl('http://example.com')).toBe(true);
    expect(isSafeShellOpenUrl('https://github.com/a/b')).toBe(true);
    expect(isSafeShellOpenUrl('mailto:user@example.com')).toBe(true);
  });

  it('rejects dangerous schemes', () => {
    expect(isSafeShellOpenUrl('javascript:alert(1)')).toBe(false);
    expect(isSafeShellOpenUrl('data:text/html,<script>')).toBe(false);
    expect(isSafeShellOpenUrl('file:///etc/passwd')).toBe(false);
    expect(isSafeShellOpenUrl('about:blank')).toBe(false);
    expect(isSafeShellOpenUrl('vbscript:msgbox')).toBe(false);
  });

  it('rejects malformed inputs', () => {
    expect(isSafeShellOpenUrl('')).toBe(false);
    expect(isSafeShellOpenUrl('not a url')).toBe(false);
    expect(isSafeShellOpenUrl(null as unknown as string)).toBe(false);
    expect(isSafeShellOpenUrl(undefined as unknown as string)).toBe(false);
  });

  it('rejects macOS private schemes', () => {
    expect(isSafeShellOpenUrl('x-apple-systempreferences:com.apple.preference.security')).toBe(false);
  });
});

describe('isValidWallpaperUrl', () => {
  it('accepts empty string as "clear wallpaper"', () => {
    expect(isValidWallpaperUrl('')).toBe(true);
  });

  it('accepts http/https/asset', () => {
    expect(isValidWallpaperUrl('https://cdn.example.com/wp.jpg')).toBe(true);
    expect(isValidWallpaperUrl('http://localhost/x.png')).toBe(true);
    expect(isValidWallpaperUrl('asset://localhost/Users/jane/wp.jpg')).toBe(true);
  });

  it('rejects javascript / data URLs', () => {
    expect(isValidWallpaperUrl('javascript:alert(1)')).toBe(false);
    expect(isValidWallpaperUrl('data:image/png;base64,xxx')).toBe(false);
  });

  it('rejects css-injection attempts', () => {
    expect(isValidWallpaperUrl('https://x.com/img.jpg); url(evil')).toBe(false);
    expect(isValidWallpaperUrl('https://x.com/img.jpg\n)')).toBe(false);
    expect(isValidWallpaperUrl('https://x.com/img.jpg;')).toBe(false);
  });
});

describe('shellEscape', () => {
  it('wraps in single quotes', () => {
    expect(shellEscape('hello')).toBe("'hello'");
    expect(shellEscape('')).toBe("''");
  });

  it('escapes single quotes via POSIX trick', () => {
    expect(shellEscape("it's")).toBe("'it'\\''s'");
    expect(shellEscape("'")).toBe("''\\'''");
  });

  it('keeps shell-meta chars inside quotes safe', () => {
    expect(shellEscape('$(rm -rf /)')).toBe("'$(rm -rf /)'");
    expect(shellEscape('`whoami`')).toBe("'`whoami`'");
    expect(shellEscape('foo;bar')).toBe("'foo;bar'");
    expect(shellEscape('foo && bar')).toBe("'foo && bar'");
  });
});

describe('validateShellFragment', () => {
  it('returns trimmed string for safe input', () => {
    expect(validateShellFragment('npm run dev')).toBe('npm run dev');
    expect(validateShellFragment('  ls -la  ')).toBe('ls -la');
  });

  it('returns null for forbidden tokens', () => {
    expect(validateShellFragment('rm -rf /; echo ok')).toBeNull();
    expect(validateShellFragment('cat file | grep x')).toBeNull();
    expect(validateShellFragment('curl `evil`')).toBeNull();
    expect(validateShellFragment('echo $(whoami)')).toBeNull();
    expect(validateShellFragment('x > /etc/passwd')).toBeNull();
    expect(validateShellFragment('x < /etc/passwd')).toBeNull();
    expect(validateShellFragment('cmd1\ncmd2')).toBeNull();
  });

  it('returns null for empty / invalid input', () => {
    expect(validateShellFragment('')).toBeNull();
    expect(validateShellFragment('   ')).toBeNull();
    expect(validateShellFragment(null as unknown as string)).toBeNull();
  });
});
