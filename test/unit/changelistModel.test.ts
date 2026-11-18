import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LIST_ID,
  collapseToStaging,
  createList,
  defaultChangelistState,
  findMoveConflicts,
  findOwner,
  indexToChecked,
  moveFiles,
  previewMigration,
  refKey,
  removeCommitted,
  removeList,
  renameList,
  setActive,
  setComment,
  setIncluded,
  setPartial,
  setUnversionedChecked,
  syncWithStatus,
} from '../../src/core/changelistModel';
import type { ProtocolError } from '../../src/protocol/errors';
import type { ChangelistState, FileChange, RepoStatus } from '../../src/protocol/models';

function change(path: string, kind: FileChange['kind'], extra?: Partial<FileChange>): FileChange {
  return {
    repoId: 'r1',
    path,
    uri: `file:///r1/${path}`,
    indexStatus: null,
    worktreeStatus: 'M',
    kind,
    staged: false,
    conflicted: false,
    ...extra,
  };
}

function status(changes: FileChange[], repoId = 'r1'): RepoStatus {
  return {
    repo: { id: repoId, rootUri: `file:///${repoId}`, rootPath: `/${repoId}`, name: repoId, kind: 'repository' },
    branch: { detached: false, name: 'main' },
    changes,
    seq: 1,
  };
}

function seeded(): ChangelistState {
  let state = defaultChangelistState();
  state = syncWithStatus(state, [status([change('a.txt', 'modified'), change('b.txt', 'modified')])], {
    defaultSelectAll: true,
    selectUntracked: false,
  }).state;
  return state;
}

describe('changelistModel lifecycle', () => {
  it('creates, renames, comments and activates lists with unique names', () => {
    let state = seeded();
    const { state: s1, list } = createList(state, 'cl-1', 'Feature X', 'note');
    state = s1;
    expect(list.name).toBe('Feature X');
    expect(() => createList(state, 'cl-2', 'Feature X')).toThrowError(/already exists/);
    expect(() => createList(state, 'cl-2', '   ')).toThrowError(/empty/);
    state = renameList(state, 'cl-1', 'Feature Y');
    state = setComment(state, 'cl-1', 'updated');
    state = setActive(state, 'cl-1');
    expect(state.activeId).toBe('cl-1');
    expect(state.lists.find((l) => l.id === 'cl-1')?.comment).toBe('updated');
    expect(() => renameList(state, 'cl-1', 'Changes')).toThrowError(/already exists/);
    expect(() => setActive(state, 'missing')).toThrowError(/not found/);
  });

  it('removing a non-default list moves its files/checked/partial into the default list', () => {
    let state = seeded();
    state = createList(state, 'cl-1', 'Feature').state;
    state = moveFiles(state, [{ repoId: 'r1', path: 'a.txt' }], 'cl-1', true);
    state = setPartial(state, 'r1', 'a.txt', { hunkIds: [0] });
    state = setActive(state, 'cl-1');
    state = removeList(state, 'cl-1');
    const def = state.lists.find((l) => l.id === DEFAULT_LIST_ID)!;
    expect(state.lists).toHaveLength(1);
    expect(state.activeId).toBe(DEFAULT_LIST_ID);
    expect(def.files.some((f) => f.path === 'a.txt')).toBe(true);
    expect(def.checked.some((f) => f.path === 'a.txt')).toBe(true);
    expect(def.partial[refKey({ repoId: 'r1', path: 'a.txt' })]).toEqual({ hunkIds: [0] });
    expect(() => removeList(state, DEFAULT_LIST_ID)).toThrowError(/default changelist/);
  });
});

describe('changelistModel move exclusivity', () => {
  it('reports conflicts and refuses non-forced moves across lists', () => {
    let state = seeded();
    state = createList(state, 'cl-1', 'Feature').state;
    const ref = { repoId: 'r1', path: 'a.txt' };
    const conflicts = findMoveConflicts(state, [ref], 'cl-1');
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]?.owner.id).toBe(DEFAULT_LIST_ID);
    try {
      moveFiles(state, [ref], 'cl-1');
      expect.unreachable('move must throw');
    } catch (err) {
      const pe = err as ProtocolError;
      expect(pe.code).toBe('CHANGELIST_CONFLICT');
      expect(pe.conflictContext).toEqual({
        repoId: 'r1',
        path: 'a.txt',
        ownerListId: DEFAULT_LIST_ID,
        ownerListName: 'Changes',
      });
    }
    state = moveFiles(state, [ref], 'cl-1', true);
    expect(findOwner(state, ref)?.id).toBe('cl-1');
    expect(state.lists.find((l) => l.id === DEFAULT_LIST_ID)?.files.some((f) => f.path === 'a.txt')).toBe(false);
    // checked state travels with the file
    expect(state.lists.find((l) => l.id === 'cl-1')?.checked.some((f) => f.path === 'a.txt')).toBe(true);
    // moving within the same list is a no-op, not a conflict
    expect(findMoveConflicts(state, [ref], 'cl-1')).toHaveLength(0);
  });
});

describe('changelistModel inclusion and partials', () => {
  it('toggles checked, clears partial on uncheck, and auto-checks on setPartial', () => {
    let state = seeded();
    const ref = { repoId: 'r1', path: 'a.txt' };
    state = setIncluded(state, [ref], false);
    expect(state.lists[0]?.checked).toHaveLength(1);
    state = setPartial(state, 'r1', 'a.txt', { hunkIds: [0], lines: { 0: [1] } });
    expect(state.lists[0]?.checked.some((f) => f.path === 'a.txt')).toBe(true);
    state = setIncluded(state, [ref], false);
    expect(state.lists[0]?.partial[refKey(ref)]).toBeUndefined();
    state = setPartial(state, 'r1', 'a.txt', { hunkIds: [0] });
    state = setPartial(state, 'r1', 'a.txt', null);
    expect(state.lists[0]?.partial[refKey(ref)]).toBeUndefined();
    expect(() => setPartial(state, 'r1', 'ghost.txt', { hunkIds: [0] })).toThrowError(/not in any changelist/);
  });

  it('batch check/uncheck of many refs stays consistent', () => {
    let state = defaultChangelistState();
    const refs = Array.from({ length: 5000 }, (_, i) => ({ repoId: 'r1', path: `f${i}.txt` }));
    state.lists[0]!.files = refs;
    state = setIncluded(state, refs, true);
    expect(state.lists[0]?.checked).toHaveLength(5000);
    // duplicate refs in one call must not double-check
    state = setIncluded(state, [refs[0]!, refs[0]!], true);
    expect(state.lists[0]?.checked).toHaveLength(5000);
    state = setIncluded(state, refs, false);
    expect(state.lists[0]?.checked).toHaveLength(0);
  });

  it('tracks unversioned checked separately', () => {
    let state = seeded();
    const ref = { repoId: 'r1', path: 'new.txt' };
    state = setUnversionedChecked(state, [ref], true);
    expect(state.unversionedChecked).toEqual([ref]);
    state = setUnversionedChecked(state, [ref], true);
    expect(state.unversionedChecked).toHaveLength(1);
    state = setUnversionedChecked(state, [ref], false);
    expect(state.unversionedChecked).toHaveLength(0);
  });
});

describe('changelistModel syncWithStatus', () => {
  it('assigns new tracked changes to the active list with auto-check per policy', () => {
    let state = seeded();
    state = createList(state, 'cl-1', 'Feature').state;
    state = setActive(state, 'cl-1');
    const result = syncWithStatus(
      state,
      [status([change('a.txt', 'modified'), change('b.txt', 'modified'), change('c.txt', 'modified')])],
      { defaultSelectAll: true, selectUntracked: false },
    );
    expect(result.changed).toBe(true);
    const active = result.state.lists.find((l) => l.id === 'cl-1')!;
    expect(active.files.map((f) => f.path)).toEqual(['c.txt']);
    expect(active.checked.map((f) => f.path)).toEqual(['c.txt']);
    const noCheck = syncWithStatus(state, [status([change('c.txt', 'modified')])], {
      defaultSelectAll: false,
      selectUntracked: false,
    });
    expect(noCheck.state.lists.find((l) => l.id === 'cl-1')?.checked).toHaveLength(0);
  });

  it('prunes vanished paths, conflicted files and their partials; keeps closed-repo refs', () => {
    let state = seeded();
    state = setPartial(state, 'r1', 'a.txt', { hunkIds: [0] });
    state = { ...state, unversionedChecked: [{ repoId: 'r1', path: 'u.txt' }] };
    state = syncWithStatus(state, [status([change('u.txt', 'untracked')], 'r2')], {
      defaultSelectAll: true,
      selectUntracked: false,
    }).state;
    // r2 status must not prune r1 refs
    expect(state.lists[0]?.files).toHaveLength(2);
    const result = syncWithStatus(
      state,
      [status([change('b.txt', 'modified'), change('a.txt', 'conflicted', { conflicted: true })])],
      { defaultSelectAll: true, selectUntracked: false },
    );
    expect(result.changed).toBe(true);
    expect(result.state.lists[0]?.files.map((f) => f.path)).toEqual(['b.txt']);
    expect(result.state.lists[0]?.partial[refKey({ repoId: 'r1', path: 'a.txt' })]).toBeUndefined();
    expect(result.state.unversionedChecked).toHaveLength(0);
  });

  it('auto-checks untracked files only when selectUntracked is on', () => {
    const state = seeded();
    const statuses = [status([change('a.txt', 'modified'), change('b.txt', 'modified'), change('u.txt', 'untracked')])];
    const off = syncWithStatus(state, statuses, { defaultSelectAll: true, selectUntracked: false });
    expect(off.state.unversionedChecked).toHaveLength(0);
    const on = syncWithStatus(state, statuses, { defaultSelectAll: true, selectUntracked: true });
    expect(on.state.unversionedChecked).toEqual([{ repoId: 'r1', path: 'u.txt' }]);
    expect(on.state.lists[0]?.files.some((f) => f.path === 'u.txt')).toBe(false);
  });

  it('is idempotent when nothing changed', () => {
    const state = seeded();
    const result = syncWithStatus(state, [status([change('a.txt', 'modified'), change('b.txt', 'modified')])], {
      defaultSelectAll: true,
      selectUntracked: false,
    });
    expect(result.changed).toBe(false);
  });
});

describe('changelistModel migration helpers', () => {
  it('previews both directions with correct counts', () => {
    let state = seeded();
    state = createList(state, 'cl-1', 'Feature').state;
    state = setPartial(state, 'r1', 'a.txt', { hunkIds: [0] });
    state = setUnversionedChecked(state, [{ repoId: 'r1', path: 'u.txt' }], true);
    const toStaging = previewMigration(state, 'staging', []);
    expect(toStaging).toEqual({ mode: 'staging', listsToRemove: 1, checkedToStage: 3, partialsToStage: 1, indexEntriesToChecked: 0 });
    const statuses = [
      status([change('s1.txt', 'modified', { staged: true, indexStatus: 'M' }), change('w.txt', 'modified')]),
    ];
    const toChangelist = previewMigration(state, 'changelist', statuses);
    expect(toChangelist.indexEntriesToChecked).toBe(1);
    expect(toChangelist.listsToRemove).toBe(0);
  });

  it('indexToChecked converts staged entries; collapseToStaging resets to a single default list', () => {
    const state = seeded();
    const statuses = [
      status([
        change('s1.txt', 'modified', { staged: true, indexStatus: 'M' }),
        change('w.txt', 'modified'),
        change('conf.txt', 'conflicted', { conflicted: true, staged: true }),
      ]),
    ];
    const migrated = indexToChecked(state, statuses);
    expect(migrated.mode).toBe('changelist');
    const def = migrated.lists.find((l) => l.isDefault)!;
    expect(def.checked.map((f) => f.path)).toContain('s1.txt');
    expect(def.files.some((f) => f.path === 'w.txt')).toBe(false);
    expect(def.files.some((f) => f.path === 'conf.txt')).toBe(false);
    const collapsed = collapseToStaging();
    expect(collapsed.mode).toBe('staging');
    expect(collapsed.lists).toHaveLength(1);
    expect(collapsed.lists[0]?.files).toHaveLength(0);
  });
});

describe('changelistModel removeCommitted', () => {
  it('removes fully committed paths and unchecks partial remainders', () => {
    let state = seeded();
    state = setPartial(state, 'r1', 'a.txt', { hunkIds: [0] });
    state = removeCommitted(state, 'r1', [{ path: 'b.txt' }, { path: 'a.txt', partial: true }]);
    const def = state.lists[0]!;
    expect(def.files.map((f) => f.path)).toEqual(['a.txt']);
    expect(def.checked).toHaveLength(0);
    expect(def.partial[refKey({ repoId: 'r1', path: 'a.txt' })]).toBeUndefined();
  });
});