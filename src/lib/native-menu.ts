import type { DisplayMode } from '../types';

export const NATIVE_MENU_COMMAND_EVENT = 'aether-native-menu-command';

export type NativeMenuCommand =
  | 'open-settings'
  | 'refresh'
  | 'toggle-hidden-files'
  | 'toggle-inspector'
  | `display-mode:${DisplayMode}`;

export function resolveNativeMenuDisplayMode(command: NativeMenuCommand): DisplayMode | null {
  switch (command) {
    case 'display-mode:list':
      return 'list';
    case 'display-mode:grid':
      return 'grid';
    case 'display-mode:column':
      return 'column';
    default:
      return null;
  }
}
