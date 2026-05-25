import React, { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useDebouncedValue } from '../lib/use-debounced-value';

function Probe({
  value,
  delayMs,
  onValue,
}: {
  value: string;
  delayMs: number;
  onValue: (value: string) => void;
}) {
  const debouncedValue = useDebouncedValue(value, delayMs);

  useEffect(() => {
    onValue(debouncedValue);
  }, [debouncedValue, onValue]);

  return React.createElement('div', null, debouncedValue);
}

describe('useDebouncedValue', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.useFakeTimers();
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
    vi.useRealTimers();
  });

  const renderProbe = (value: string, delayMs: number, onValue: (value: string) => void) => {
    act(() => {
      root.render(React.createElement(Probe, { value, delayMs, onValue }));
    });
  };

  it('keeps the previous value until the delay has elapsed', () => {
    const seen: string[] = [];
    const recordValue = (value: string) => seen.push(value);

    renderProbe('a', 150, recordValue);
    renderProbe('ab', 150, recordValue);

    expect(seen).toEqual(['a']);

    act(() => {
      vi.advanceTimersByTime(149);
    });
    expect(seen).toEqual(['a']);

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(seen).toEqual(['a', 'ab']);
  });

  it('cancels pending updates when value changes again', () => {
    const seen: string[] = [];
    const recordValue = (value: string) => seen.push(value);

    renderProbe('a', 150, recordValue);
    renderProbe('ab', 150, recordValue);
    act(() => {
      vi.advanceTimersByTime(100);
    });
    renderProbe('abc', 150, recordValue);

    act(() => {
      vi.advanceTimersByTime(149);
    });
    expect(seen).toEqual(['a']);

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(seen).toEqual(['a', 'abc']);
  });
});
