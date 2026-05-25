import React, { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getPrefersReducedMotion, usePrefersReducedMotion } from '../lib/use-prefers-reduced-motion';

type MatchMediaListener = () => void;

function installMatchMedia(matches: boolean) {
  let currentMatches = matches;
  const listeners = new Set<MatchMediaListener>();
  const mediaQuery = {
    get matches() {
      return currentMatches;
    },
    media: '(prefers-reduced-motion: reduce)',
    onchange: null,
    addEventListener: vi.fn((_event: string, listener: MatchMediaListener) => {
      listeners.add(listener);
    }),
    removeEventListener: vi.fn((_event: string, listener: MatchMediaListener) => {
      listeners.delete(listener);
    }),
    dispatchEvent: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
  } as unknown as MediaQueryList;

  window.matchMedia = vi.fn(() => mediaQuery);

  return {
    setMatches(nextMatches: boolean) {
      currentMatches = nextMatches;
      listeners.forEach(listener => listener());
    },
    mediaQuery,
  };
}

function Probe({ onValue }: { onValue: (value: boolean) => void }) {
  const value = usePrefersReducedMotion();
  useEffect(() => {
    onValue(value);
  }, [onValue, value]);
  return React.createElement('div', null, String(value));
}

describe('usePrefersReducedMotion', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    vi.restoreAllMocks();
  });

  it('reads the current system preference', () => {
    installMatchMedia(true);
    expect(getPrefersReducedMotion()).toBe(true);
  });

  it('falls back to false when matchMedia is unavailable', () => {
    const originalMatchMedia = window.matchMedia;
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: undefined,
      writable: true,
    });

    expect(getPrefersReducedMotion()).toBe(false);

    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: originalMatchMedia,
      writable: true,
    });
  });

  it('updates when the media query changes', () => {
    const matchMedia = installMatchMedia(false);
    const seen: boolean[] = [];

    act(() => {
      root.render(React.createElement(Probe, { onValue: value => seen.push(value) }));
    });

    expect(seen).toEqual([false]);

    act(() => {
      matchMedia.setMatches(true);
    });

    expect(seen).toEqual([false, true]);
  });
});
