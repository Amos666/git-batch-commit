import { describe, expect, it } from 'vitest';
import { applyHunks, applyLineSelection, countNewSideLines, parseHunks } from '../../src/core/hunkDiff';
import type { ProtocolError } from '../../src/protocol/errors';

const REPLACE_PATCH = [
  'diff --git a/f.txt b/f.txt',
  '--- a/f.txt',
  '+++ b/f.txt',
  '@@ -1,5 +1,5 @@',
  ' a',
  '-b',
  '+B',
  ' c',
  '-d',
  '+D',
  ' e',
].join('\n');

const BASE = 'a\nb\nc\nd\ne\n';

function apply(patch: string, base: string, hunkIds: number[], lines?: Record<number, number[]>): string {
  const hunks = parseHunks(patch);
  const filtered = applyLineSelection(hunks, { hunkIds, lines });
  return applyHunks(base, filtered, new Set(filtered.map((h) => h.id)));
}

describe('applyLineSelection', () => {
  it('counts new-side lines including context but not deletions', () => {
    const [hunk] = parseHunks(REPLACE_PATCH);
    expect(countNewSideLines(hunk!)).toBe(5);
  });

  it('selecting one addition of a replace block keeps the other base line as context', () => {
    // offsets: a=0 B=1 c=2 D=3 e=4 — take only B
    expect(apply(REPLACE_PATCH, BASE, [0], { 0: [1] })).toBe('a\nB\nc\nd\ne\n');
    expect(apply(REPLACE_PATCH, BASE, [0], { 0: [3] })).toBe('a\nb\nc\nD\ne\n');
  });

  it('selecting all new-side lines equals the full hunk', () => {
    expect(apply(REPLACE_PATCH, BASE, [0], { 0: [0, 1, 2, 3, 4] })).toBe('a\nB\nc\nD\ne\n');
    expect(apply(REPLACE_PATCH, BASE, [0])).toBe('a\nB\nc\nD\ne\n');
  });

  it('selecting only context lines drops the hunk entirely (base unchanged)', () => {
    expect(apply(REPLACE_PATCH, BASE, [0], { 0: [0, 2, 4] })).toBe(BASE);
  });

  it('unselected hunks are ignored', () => {
    expect(apply(REPLACE_PATCH, BASE, [], {})).toBe(BASE);
  });

  it('pure additions are independently selectable', () => {
    const patch = ['@@ -1,2 +1,4 @@', ' a', '+x', '+y', ' b'].join('\n');
    // offsets: a=0 x=1 y=2 b=3
    expect(apply(patch, 'a\nb\n', [0], { 0: [2] })).toBe('a\ny\nb\n');
  });

  it('pure deletions always apply when the hunk is selected', () => {
    const patch = ['@@ -1,3 +1,2 @@', ' a', '-gone', ' b'].join('\n');
    expect(apply(patch, 'a\ngone\nb\n', [0], { 0: [0, 1] })).toBe('a\nb\n');
  });

  it('recomputes hunk header counts after filtering', () => {
    const [hunk] = parseHunks(REPLACE_PATCH);
    const [filtered] = applyLineSelection([hunk!], { hunkIds: [0], lines: { 0: [1] } });
    expect(filtered?.oldLines).toBe(5);
    expect(filtered?.newLines).toBe(5);
    expect(filtered?.header).toBe('@@ -1,5 +1,5 @@');
    expect(filtered?.lines).toEqual([' a', '-b', '+B', ' c', ' d', ' e']);
  });

  it('keeps no-newline markers attached to kept lines only', () => {
    const patch = ['@@ -1,2 +1,2 @@', ' x', '-y', '\\ No newline at end of file', '+y', '+z'].join('\n');
    const base = 'x\ny';
    // offsets: x=0 y=1 z=2; keeping y includes its newline (the worktree line ends with \n)
    expect(apply(patch, base, [0], { 0: [0, 1] })).toBe('x\ny\n');
    expect(apply(patch, base, [0], { 0: [0, 2] })).toBe('x\ny\nz\n');
    expect(apply(patch, base, [0], { 0: [0] })).toBe('x\ny');
  });

  it('rejects unknown hunk ids and out-of-range offsets with HUNK_CONFLICT', () => {
    const hunks = parseHunks(REPLACE_PATCH);
    expect(() => applyLineSelection(hunks, { hunkIds: [9] })).toThrowError(
      expect.objectContaining({ code: 'HUNK_CONFLICT' }) as unknown as Error,
    );
    expect(() => applyLineSelection(hunks, { hunkIds: [0], lines: { 0: [5] } })).toThrowError(
      expect.objectContaining({ code: 'HUNK_CONFLICT' }) as unknown as Error,
    );
    expect(() => applyLineSelection(hunks, { hunkIds: [0], lines: { 0: [-1] } })).toThrowError(
      expect.objectContaining({ code: 'HUNK_CONFLICT' }) as unknown as Error,
    );
    try {
      applyLineSelection(hunks, { hunkIds: [9] });
    } catch (err) {
      expect((err as ProtocolError).actions).toContain('retry');
    }
  });
});