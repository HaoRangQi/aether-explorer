import { invoke } from '@tauri-apps/api/core';
import { PhysicalPosition, PhysicalSize } from '@tauri-apps/api/dpi';
import { emit, emitTo, listen, type EventCallback, type EventName, type UnlistenFn } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import type { Window } from '@tauri-apps/api/window';

export const isTauriRuntime = (): boolean =>
  typeof window !== 'undefined' && typeof (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ !== 'undefined';

const previewWindowLabel = 'browser-preview';

type WindowLike = Pick<
  Window,
  | 'label'
  | 'close'
  | 'minimize'
  | 'outerPosition'
  | 'outerSize'
  | 'scaleFactor'
  | 'setFocus'
  | 'show'
  | 'startDragging'
  | 'toggleMaximize'
  | 'unminimize'
>;

const noopPromise = async () => {};

export const currentWindowLabel = (): string =>
  isTauriRuntime() ? getCurrentWindow().label : previewWindowLabel;

export const safeCurrentWindow = (): WindowLike => {
  if (isTauriRuntime()) return getCurrentWindow();
  return {
    label: previewWindowLabel,
    close: noopPromise,
    minimize: noopPromise,
    outerPosition: async () => new PhysicalPosition(window.screenX, window.screenY),
    outerSize: async () => new PhysicalSize(window.outerWidth, window.outerHeight),
    scaleFactor: async () => window.devicePixelRatio || 1,
    setFocus: noopPromise,
    show: noopPromise,
    startDragging: noopPromise,
    toggleMaximize: noopPromise,
    unminimize: noopPromise,
  };
};

export async function safeListen<T>(
  event: EventName,
  handler: EventCallback<T>,
): Promise<UnlistenFn> {
  if (!isTauriRuntime()) return () => {};
  return listen(event, handler);
}

export async function safeEmit<T>(event: EventName, payload?: T): Promise<void> {
  if (!isTauriRuntime()) return;
  await emit(event, payload);
}

export async function safeEmitTo<T>(target: string, event: EventName, payload?: T): Promise<void> {
  if (!isTauriRuntime()) return;
  await emitTo(target, event, payload);
}

export async function safeInvoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  if (!isTauriRuntime()) {
    throw new Error(`Tauri runtime is unavailable for command: ${command}`);
  }
  return invoke<T>(command, args);
}
