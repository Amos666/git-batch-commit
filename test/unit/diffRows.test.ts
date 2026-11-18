import { describe, expect, it } from 'vitest';
import { buildDiffRows } from '../../src/core/diffRows';
import type { DiffRow } from '../../src/core/diffRows';
import { syntheticAddHunk } from '../../src/core/hunkDiff';
import type { HunkInfo } from '../../src/protocol/messages';

function hunk(partial: Partial<HunkInfo> & Pick<HunkInfo, 'lines'>): HunkInfo {
  return {
    id: 0,
    header: '@@',
    oldStart: 1,
    oldLines: 1,
    newStart: 1,
    newLines: 1,
    ...partial,
  };
}

describe('buildDiffRows', () => {
  it('identical texts without hunks produce numbered equal rows', () => {
    const rows = buildDiffRows('a\nb\n', 'a\nb\n', []);
    expect(rows).toEqual([
      { kind: 'equal', oldNo: 1, newNo: 1, text: 'a' },
      { kind: 'equal', oldNo: 2, newNo: 2, text: 'b' },
    ]);
  });

  it('pairs replace blocks and assigns new-side offsets', () => {
    const h = hunk({ oldStart: 1, oldLines: 3, newStart: 1, newLines: 3, lines: [' a', '-b', '+B', ' c'] });
    const rows = buildDiffRows('a\nb\nc\n', 'a\nB\nc\n', [h]);
    expect(rows.map((r) => r.kind)).toEqual(['hunk', 'change', 'change', 'change']);
    const changes = rows.filter((r) => r.kind === 'change');
    expect(changes[0]).toMatchObject({ change: 'ctx', old: { no: 1 }, new: { no: 1, offset: 0 } });
    expect(changes[1]).toMatchObject({ change: 'replace', old: { no: 2, text: 'b' }, new: { no: 2, text: 'B', offset: 1 } });
    expect(changes[2]).toMatchObject({ change: 'ctx', old: { no: 3 }, new: { no: 3, offset: 2 } });
  });

  it('renders pure additions with an empty old pane', () => {
    const h = hunk({ oldStart: 1, oldLines: 1, newStart: 1, newLines: 2, lines: [' a', '+x'] });
    const rows = buildDiffRows('a\n', 'a\nx\n', [h]);
    const add = rows.find((r): r is Extract<DiffRow, { kind: 'change' }> => r.kind === 'change' && r.change === 'add');
    expect(add?.old).toBeUndefined();
    expect(add).toMatchObject({ new: { no: 2, text: 'x', offset: 1 } });
  });

  it('renders pure deletions with an empty new pane', () => {
    const h = hunk({ oldStart: 1, oldLines: 2, newStart: 1, newLines: 1, lines: [' a', '-x'] });
    const rows = buildDiffRows('a\nx\n', 'a\n', [h]);
    const del = rows.find((r): r is Extract<DiffRow, { kind: 'change' }> => r.kind === 'change' && r.change === 'del');
    expect(del?.new).toBeUndefined();
    expect(del).toMatchObject({ old: { no: 2, text: 'x' } });
  });

  it('pairs only min(dels, adds) in uneven replace blocks', () => {
    const h = hunk({ oldStart: 1, oldLines: 2, newStart: 1, newLines: 1, lines: ['-b', '-c', '+B'] });
    const rows = buildDiffRows('b\nc\n', 'B\n', [h]);
    const changes = rows.filter((r) => r.kind === 'change');
    expect(changes.map((r) => r.change)).toEqual(['replace', 'del']);
    expect(changes[0]).toMatchObject({ old: { text: 'b' }, new: { text: 'B', offset: 0 } });
    expect(changes[1]).toMatchObject({ old: { no: 2, text: 'c' } });
  });

  it('copies unchanged regions between hunks with correct numbers', () => {
    const h1 = hunk({ id: 0, oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: ['-a', '+A'] });
    const h2 = hunk({ id: 1, oldStart: 4, oldLines: 1, newStart: 4, newLines: 1, lines: ['-d', '+D'] });
    const rows = buildDiffRows('a\nb\nc\nd\n', 'A\nb\nc\nD\n', [h1, h2]);
    const equals = rows.filter((r) => r.kind === 'equal');
    expect(equals).toEqual([
      { kind: 'equal', oldNo: 2, newNo: 2, text: 'b' },
      { kind: 'equal', oldNo: 3, newNo: 3, text: 'c' },
    ]);
    expect(rows.filter((r) => r.kind === 'hunk').map((r) => r.hunkId)).toEqual([0, 1]);
  });

  it('renders an untracked file as a whole-file add', () => {
    const rows = buildDiffRows('', 'x\ny\n', [syntheticAddHunk('x\ny\n')]);
    expect(rows[0]).toMatchObject({ kind: 'hunk', hunkId: 0 });
    const adds = rows.filter((r) => r.kind === 'change');
    expect(adds).toHaveLength(2);
    expect(adds[0]).toMatchObject({ change: 'add', new: { no: 1, text: 'x', offset: 0 } });
    expect(adds[1]).toMatchObject({ change: 'add', new: { no: 2, text: 'y', offset: 1 } });
  });

  it('renders a deleted file as all deletions', () => {
    const h = hunk({ oldStart: 1, oldLines: 2, newStart: 0, newLines: 0, lines: ['-x', '-y'] });
    const rows = buildDiffRows('x\ny\n', '', [h]);
    const changes = rows.filter((r) => r.kind === 'change');
    expect(changes.map((r) => r.change)).toEqual(['del', 'del']);
    expect(changes.every((r) => r.new === undefined)).toBe(true);
  });
});