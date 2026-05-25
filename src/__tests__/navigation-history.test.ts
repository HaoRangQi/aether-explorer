import { describe, it, expect } from 'vitest';
import {
  EMPTY_NAVIGATION_HISTORY,
  goBack,
  goForward,
  navigateHistory,
  type NavigationHistory,
} from '../lib/navigation-history';

describe('navigateHistory', () => {
  it('pushes the current path onto back stack and clears forward stack', () => {
    const history: NavigationHistory = {
      backStack: ['/Users/jane'],
      forwardStack: ['/Users/jane/Downloads'],
    };

    const result = navigateHistory('/Users/jane/Documents', '/Users/jane/Pictures', history);

    expect(result).toEqual({
      path: '/Users/jane/Pictures',
      history: {
        backStack: ['/Users/jane', '/Users/jane/Documents'],
        forwardStack: [],
      },
      changed: true,
    });
  });

  it('trims target paths before navigation', () => {
    const result = navigateHistory('/Users/jane', '  /Applications  ', EMPTY_NAVIGATION_HISTORY);

    expect(result.path).toBe('/Applications');
    expect(result.history.backStack).toEqual(['/Users/jane']);
  });

  it('does not change history for replace navigation', () => {
    const history: NavigationHistory = {
      backStack: ['/Users/jane'],
      forwardStack: ['/Applications'],
    };

    const result = navigateHistory('/Users/jane/Documents', '  /Users/jane/Desktop  ', history, { replace: true });

    expect(result).toEqual({
      path: '/Users/jane/Desktop',
      history,
      changed: true,
    });
  });

  it('does not push an empty current path', () => {
    const result = navigateHistory('', '/Users/jane', EMPTY_NAVIGATION_HISTORY);

    expect(result).toEqual({
      path: '/Users/jane',
      history: EMPTY_NAVIGATION_HISTORY,
      changed: true,
    });
  });

  it('ignores empty or same-path navigation', () => {
    const history: NavigationHistory = {
      backStack: ['/Users/jane'],
      forwardStack: [],
    };

    expect(navigateHistory('/Users/jane', '   ', history)).toEqual({
      path: '/Users/jane',
      history,
      changed: false,
    });
    expect(navigateHistory('/Users/jane', '/Users/jane', history)).toEqual({
      path: '/Users/jane',
      history,
      changed: false,
    });
    expect(navigateHistory('/Users/jane', '  /Users/jane  ', history)).toEqual({
      path: '/Users/jane',
      history,
      changed: false,
    });
  });

  it('does not mutate the existing history stacks', () => {
    const history: NavigationHistory = {
      backStack: ['/Users/jane'],
      forwardStack: ['/Applications'],
    };

    const result = navigateHistory('/Users/jane/Documents', '/Users/jane/Pictures', history);

    expect(history).toEqual({
      backStack: ['/Users/jane'],
      forwardStack: ['/Applications'],
    });
    expect(result.history).not.toBe(history);
    expect(result.history.backStack).not.toBe(history.backStack);
    expect(result.history.forwardStack).not.toBe(history.forwardStack);
  });
});

describe('goBack', () => {
  it('moves the current path to forward stack and returns the previous path', () => {
    const result = goBack('/Users/jane/Pictures', {
      backStack: ['/Users/jane', '/Users/jane/Documents'],
      forwardStack: ['/Applications'],
    });

    expect(result).toEqual({
      path: '/Users/jane/Documents',
      history: {
        backStack: ['/Users/jane'],
        forwardStack: ['/Users/jane/Pictures', '/Applications'],
      },
      changed: true,
    });
  });

  it('returns null without history or current path', () => {
    expect(goBack('/Users/jane', EMPTY_NAVIGATION_HISTORY)).toBeNull();
    expect(goBack('', { backStack: ['/Users/jane'], forwardStack: [] })).toBeNull();
  });

  it('does not mutate the existing history stacks', () => {
    const history: NavigationHistory = {
      backStack: ['/Users/jane', '/Users/jane/Documents'],
      forwardStack: ['/Applications'],
    };

    const result = goBack('/Users/jane/Pictures', history);

    expect(history).toEqual({
      backStack: ['/Users/jane', '/Users/jane/Documents'],
      forwardStack: ['/Applications'],
    });
    expect(result?.history).not.toBe(history);
    expect(result?.history.backStack).not.toBe(history.backStack);
    expect(result?.history.forwardStack).not.toBe(history.forwardStack);
  });
});

describe('goForward', () => {
  it('moves the current path to back stack and returns the next path', () => {
    const result = goForward('/Users/jane/Documents', {
      backStack: ['/Users/jane'],
      forwardStack: ['/Users/jane/Pictures', '/Applications'],
    });

    expect(result).toEqual({
      path: '/Users/jane/Pictures',
      history: {
        backStack: ['/Users/jane', '/Users/jane/Documents'],
        forwardStack: ['/Applications'],
      },
      changed: true,
    });
  });

  it('returns null without history or current path', () => {
    expect(goForward('/Users/jane', EMPTY_NAVIGATION_HISTORY)).toBeNull();
    expect(goForward('', { backStack: [], forwardStack: ['/Users/jane'] })).toBeNull();
  });

  it('does not mutate the existing history stacks', () => {
    const history: NavigationHistory = {
      backStack: ['/Users/jane'],
      forwardStack: ['/Users/jane/Pictures', '/Applications'],
    };

    const result = goForward('/Users/jane/Documents', history);

    expect(history).toEqual({
      backStack: ['/Users/jane'],
      forwardStack: ['/Users/jane/Pictures', '/Applications'],
    });
    expect(result?.history).not.toBe(history);
    expect(result?.history.backStack).not.toBe(history.backStack);
    expect(result?.history.forwardStack).not.toBe(history.forwardStack);
  });
});
