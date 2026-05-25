export interface NavigationHistory {
  backStack: string[];
  forwardStack: string[];
}

export interface NavigationResult {
  path: string;
  history: NavigationHistory;
  changed: boolean;
}

export const EMPTY_NAVIGATION_HISTORY: NavigationHistory = {
  backStack: [],
  forwardStack: [],
};

export function navigateHistory(
  currentPath: string,
  path: string,
  history: NavigationHistory,
  options?: { replace?: boolean },
): NavigationResult {
  const nextPath = path.trim();
  if (!nextPath || nextPath === currentPath) {
    return { path: currentPath, history, changed: false };
  }

  if (options?.replace || !currentPath) {
    return { path: nextPath, history, changed: true };
  }

  return {
    path: nextPath,
    history: {
      backStack: [...history.backStack, currentPath],
      forwardStack: [],
    },
    changed: true,
  };
}

export function goBack(
  currentPath: string,
  history: NavigationHistory,
): NavigationResult | null {
  if (history.backStack.length === 0 || !currentPath) return null;

  const previousPath = history.backStack[history.backStack.length - 1];
  return {
    path: previousPath,
    history: {
      backStack: history.backStack.slice(0, -1),
      forwardStack: [currentPath, ...history.forwardStack],
    },
    changed: true,
  };
}

export function goForward(
  currentPath: string,
  history: NavigationHistory,
): NavigationResult | null {
  if (history.forwardStack.length === 0 || !currentPath) return null;

  const nextPath = history.forwardStack[0];
  return {
    path: nextPath,
    history: {
      backStack: [...history.backStack, currentPath],
      forwardStack: history.forwardStack.slice(1),
    },
    changed: true,
  };
}
