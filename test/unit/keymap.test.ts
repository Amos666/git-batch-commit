import { describe, expect, it } from 'vitest';
import { resolveKey, TEXTAREA_ALLOWED } from '../../src/webview/state/keymap';
import type { KeyLike } from '../../src/webview/state/keymap';

function key(key: string, over: Partial<KeyLike> = {}): KeyLike {
  return { key, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...over };
}

describe('resolveKey (IDEA Commit tool window chords)', () => {
  it.each([
    ['Enter', { ctrlKey: true }, 'commit'],
    ['Enter', { metaKey: true }, 'commit'],
    ['k', { ctrlKey: true, altKey: true, shiftKey: true }, 'commitAndPush'],
    ['K', { ctrlKey: true, altKey: true, shiftKey: true }, 'commitAndPush'],
    ['p', { ctrlKey: true, altKey: true, shiftKey: true }, 'push'],
    ['d', { ctrlKey: true, altKey: true }, 'diff'],
    ['s', { ctrlKey: true, altKey: true }, 'addToVcs'],
    ['o', { ctrlKey: true, altKey: true }, 'toggleOptions'],
    ['c', { ctrlKey: true, altKey: true }, 'commit'],
    ['r', { ctrlKey: true, altKey: true }, 'refresh'],
    [' ', { ctrlKey: true }, 'pickChangelist'],
    ['m', { altKey: true, shiftKey: true }, 'moveChangelist'],
    ['Delete', {}, 'delete'],
    [' ', {}, 'toggleIncluded'],
  ] as const)('%s %j -> %s', (k, mods, expected) => {
    expect(resolveKey(key(k, mods))).toBe(expected);
  });

  it('ignores plain typing and unrelated chords', () => {
    expect(resolveKey(key('a'))).toBeNull();
    expect(resolveKey(key('Enter'))).toBeNull();
    expect(resolveKey(key('d', { ctrlKey: true }))).toBeNull();
    expect(resolveKey(key('k', { ctrlKey: true, altKey: true }))).toBeNull();
    expect(resolveKey(key('m', { altKey: true }))).toBeNull();
    expect(resolveKey(key('Delete', { shiftKey: true }))).toBeNull();
    expect(resolveKey(key(' ', { shiftKey: true }))).toBeNull();
    expect(resolveKey(key('F5'))).toBeNull();
  });

  it('only allows commit chords while the message textarea has focus', () => {
    expect([...TEXTAREA_ALLOWED].sort()).toEqual(['commit', 'commitAndPush', 'refresh', 'toggleOptions']);
  });
});