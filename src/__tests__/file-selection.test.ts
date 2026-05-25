import { describe, expect, it } from 'vitest';
import {
  buildFileLookup,
  resolveAdjacentSelectedFile,
  resolveLastSelectedFile,
  resolveSelectedFiles,
} from '../lib/file-selection';
import type { FileItem } from '../types';

const makeFile = (id: string): FileItem => ({
  id,
  name: id,
  type: 'file',
  size: '--',
  modified: '',
  path: `/tmp/${id}`,
});

describe('file-selection', () => {
  it('resolves selected files in displayed file order', () => {
    const lookup = buildFileLookup([makeFile('a'), makeFile('b'), makeFile('c')]);

    expect(resolveSelectedFiles(['c', 'a'], lookup).map(file => file.id)).toEqual(['a', 'c']);
    expect(resolveSelectedFiles([], lookup)).toEqual([]);
    expect(resolveSelectedFiles(['a'], buildFileLookup([]))).toEqual([]);
  });

  it('ignores stale selected ids', () => {
    const lookup = buildFileLookup([makeFile('a')]);

    expect(resolveSelectedFiles(['missing', 'a'], lookup).map(file => file.id)).toEqual(['a']);
    expect(resolveSelectedFiles(['missing'], lookup)).toEqual([]);
    expect(resolveSelectedFiles(['a', 'missing', 'a'], lookup).map(file => file.id)).toEqual(['a']);
  });

  it('returns the last selected file by selection order', () => {
    const lookup = buildFileLookup([makeFile('a'), makeFile('b')]);

    expect(resolveLastSelectedFile(['b', 'a'], lookup)?.id).toBe('a');
  });

  it('returns undefined when the last selected id is stale', () => {
    const lookup = buildFileLookup([makeFile('a')]);

    expect(resolveLastSelectedFile(['a', 'missing'], lookup)).toBeUndefined();
    expect(resolveLastSelectedFile(['missing', 'a'], lookup)?.id).toBe('a');
    expect(resolveLastSelectedFile([], lookup)).toBeUndefined();
  });

  it('resolves adjacent files for keyboard selection movement', () => {
    const files = [makeFile('a'), makeFile('b'), makeFile('c')];

    expect(resolveAdjacentSelectedFile(files, [], 'next')?.id).toBe('a');
    expect(resolveAdjacentSelectedFile(files, [], 'previous')?.id).toBe('c');
    expect(resolveAdjacentSelectedFile(files, ['b'], 'next')?.id).toBe('c');
    expect(resolveAdjacentSelectedFile(files, ['b'], 'previous')?.id).toBe('a');
    expect(resolveAdjacentSelectedFile(files, ['a', 'c'], 'previous')?.id).toBe('b');
    expect(resolveAdjacentSelectedFile(files, ['c', 'a'], 'next')?.id).toBe('b');
    expect(resolveAdjacentSelectedFile(files, ['c'], 'next')?.id).toBe('c');
    expect(resolveAdjacentSelectedFile(files, ['a'], 'previous')?.id).toBe('a');
    expect(resolveAdjacentSelectedFile(files, ['missing'], 'next')?.id).toBe('a');
    expect(resolveAdjacentSelectedFile([], ['a'], 'next')).toBeUndefined();
  });

  it('falls back from stale keyboard selection by movement direction', () => {
    const files = [makeFile('a'), makeFile('b'), makeFile('c')];

    expect(resolveAdjacentSelectedFile(files, ['missing'], 'next')?.id).toBe('a');
    expect(resolveAdjacentSelectedFile(files, ['missing'], 'previous')?.id).toBe('c');
  });
});
