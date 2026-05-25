import { describe, expect, it } from 'vitest';
import {
  NATIVE_MENU_COMMAND_EVENT,
  resolveNativeMenuDisplayMode,
  type NativeMenuCommand,
} from '../lib/native-menu';

describe('NATIVE_MENU_COMMAND_EVENT', () => {
  it('matches the Rust-emitted native menu command event name', () => {
    expect(NATIVE_MENU_COMMAND_EVENT).toBe('aether-native-menu-command');
  });
});

describe('resolveNativeMenuDisplayMode', () => {
  it('maps native menu display commands to Explorer display modes', () => {
    expect(resolveNativeMenuDisplayMode('display-mode:list')).toBe('list');
    expect(resolveNativeMenuDisplayMode('display-mode:grid')).toBe('grid');
    expect(resolveNativeMenuDisplayMode('display-mode:column')).toBe('column');
  });

  it('ignores non-display native menu commands', () => {
    expect(resolveNativeMenuDisplayMode('refresh')).toBeNull();
    expect(resolveNativeMenuDisplayMode('toggle-hidden-files')).toBeNull();
    expect(resolveNativeMenuDisplayMode('toggle-inspector')).toBeNull();
    expect(resolveNativeMenuDisplayMode('open-settings')).toBeNull();
    expect(resolveNativeMenuDisplayMode('display-mode:gallery' as NativeMenuCommand)).toBeNull();
  });
});
