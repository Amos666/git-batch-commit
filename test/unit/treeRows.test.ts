import { describe, expect, it } from 'vitest';
import type { ChangelistState, FileChange, RepoStatus } from '../../src/protocol/models';
import { buildRows, groupChanges, headerKeys } from '../../src/webview/treeRows';
import type { Row, RowInput } from '../../src/webview/treeRows';

function change(path: string, over: Partial<FileChange> = {}): FileChange {
  return {
    repoId: 'r1',
    path,
    uri: `file:///repo/${path}`,
    indexStatus: null,
    worktreeStatus: 'M',
    kind: 'modified',
    staged: false,
    conflicted: false,
    ...over,
  };
}

function status(repoId: string, changes: FileChange[]): RepoStatus {
  return {
    repo: { id: repoId, rootUri: `file:///${repoId}`, rootPath: `/${repoId}`, name: repoId, kind: 'repository' },
    branch: { name: 'main', detached: false },
    changes: changes.map((c) => ({ ...c, repoId })),
    seq: 1,
  };
}

const VIEW = { groupByDirectory: true, showUnversioned: true };

function input(over: Partial<RowInput> = {}): RowInput {
  return {
    repoOrder: ['r1'],
    repos: { r1: status('r1', []) },
    mode: 'staging',
    changelists: null,
    viewOptions: VIEW,
    collapsed: {},
    ...over,
  };
}

function changelists(over: Partial<ChangelistState> = {}): ChangelistState {
  return {
    version: 1,
    mode: 'changelist',
    activeId: 'default',
    lists: [{ id: 'default', name: 'Changes', comment: '', isDefault: true, files: [], checked: [], partial: {} }],
    unversionedChecked: [],
    ...over,
  };
}

const kinds = (rows: Row[]): string[] =>
  rows.map((r) => (r.kind === 'group' ? `group:${r.group}` : r.kind === 'list' ? `list:${r.listId}` : `${r.kind}:${r.key}`));

describe('groupChanges', () => {
  const s = status('r1', [
    change('conflict.txt', { conflicted: true, worktreeStatus: 'U' }),
    change('staged.txt', { staged: true, indexStatus: 'M', worktreeStatus: null }),
    change('partial.txt', { staged: true, indexStatus: 'M' }),
    change('worktree.txt'),
    change('new.txt', { kind: 'untracked', worktreeStatus: '?' }),
  ]);

  it('splits conflicts / staged / changes / unversioned', () => {
    expect(groupChanges(s, 'conflicts').map((c) => c.path)).toEqual(['conflict.txt']);
    expect(groupChanges(s, 'staged').map((c) => c.path)).toEqual(['staged.txt', 'partial.txt']);
    expect(groupChanges(s, 'unversioned').map((c) => c.path)).toEqual(['new.txt']);
  });

  it('keeps partially-staged files in the worktree Changes group too', () => {
    expect(groupChanges(s, 'changes').map((c) => c.path)).toEqual(['partial.txt', 'worktree.txt']);
  });
});

describe('buildRows staging mode', () => {
  const repos = {
    r1: status('r1', [
      change('conflict.txt', { conflicted: true, worktreeStatus: 'U' }),
      change('staged.txt', { staged: true, indexStatus: 'M', worktreeStatus: null }),
      change('src/b.txt'),
      change('src/a.txt'),
      change('aaa.txt'),
      change('new.txt', { kind: 'untracked', worktreeStatus: '?' }),
    ]),
  };

  it('orders groups Merge Conflicts / Staged / Changes / Unversioned Files', () => {
    const rows = buildRows(input({ repos }));
    const groups = rows.filter((r) => r.kind === 'group').map((r) => (r.kind === 'group' ? r.group : ''));
    expect(groups).toEqual(['conflicts', 'staged', 'changes', 'unversioned']);
  });

  it('hides unversioned when the view option is off', () => {
    const rows = buildRows(input({ repos, viewOptions: { ...VIEW, showUnversioned: false } }));
    expect(rows.some((r) => r.kind === 'group' && r.group === 'unversioned')).toBe(false);
  });

  it('marks staged rows included and groups by directory', () => {
    const rows = buildRows(input({ repos }));
    const files = rows.filter((r) => r.kind === 'node' && r.node.type === 'file');
    const staged = files.find((r) => r.kind === 'node' && r.node.path === 'staged.txt');
    expect(staged?.kind === 'node' && staged.included).toBe(true);
    expect(rows.some((r) => r.kind === 'node' && r.node.type === 'dir' && r.node.path === 'src')).toBe(true);
  });

  it('collapsing a group hides its children but keeps the header', () => {
    const rows = buildRows(input({ repos, collapsed: { 'g:r1:changes': true } }));
    expect(rows.some((r) => r.key === 'g:r1:changes')).toBe(true);
    expect(rows.some((r) => r.kind === 'node' && r.node.path === 'src/a.txt')).toBe(false);
  });

  it('flat mode lists full paths sorted within each group, no directory rows', () => {
    const rows = buildRows(input({ repos, viewOptions: { ...VIEW, groupByDirectory: false } }));
    expect(rows.some((r) => r.kind === 'node' && r.node.type === 'dir')).toBe(false);
    const byPrefix = new Map<string, string[]>();
    for (const r of rows) {
      if (r.kind === 'node') {
        const arr = byPrefix.get(r.keyPrefix) ?? [];
        arr.push(r.node.path);
        byPrefix.set(r.keyPrefix, arr);
      }
    }
    expect(byPrefix.size).toBeGreaterThan(1);
    for (const paths of byPrefix.values()) {
      expect(paths).toEqual([...paths].sort((a, b) => a.localeCompare(b)));
    }
    expect(byPrefix.get('g:r1:changes')).toEqual(['aaa.txt', 'src/a.txt', 'src/b.txt']);
  });

  it('renders root project rows for single and multi-repo workspaces', () => {
    const single = buildRows(input({ repos }));
    expect(single.filter((r) => r.kind === 'repo').map((r) => (r.kind === 'repo' ? r.repoId : ''))).toEqual(['r1']);
    const multi = buildRows(input({ repoOrder: ['r1', 'r2'], repos: { ...repos, r2: status('r2', [change('b.txt')]) } }));
    expect(multi.filter((r) => r.kind === 'repo').map((r) => (r.kind === 'repo' ? r.repoId : ''))).toEqual(['r1', 'r2']);
  });

  it('emits a root row plus an empty row for a clean repo in staging mode', () => {
    const rows = buildRows(input());
    expect(rows.map((r) => r.kind)).toEqual(['repo', 'empty']);
    expect(rows[0]).toMatchObject({ kind: 'repo', key: 'repo:r1', repoId: 'r1', total: 0, checked: 0, selectable: true });
    expect(rows[1]).toEqual({ kind: 'empty', key: 'empty:r1', repoId: 'r1' });
  });
});

describe('buildRows changelist mode', () => {
  const repos = {
    r1: status('r1', [
      change('a.txt'),
      change('b.txt'),
      change('conflict.txt', { conflicted: true, worktreeStatus: 'U' }),
      change('new.txt', { kind: 'untracked', worktreeStatus: '?' }),
    ]),
  };
  const lists = changelists({
    lists: [
      {
        id: 'default',
        name: 'Changes',
        comment: 'work in progress',
        isDefault: true,
        files: [{ repoId: 'r1', path: 'a.txt' }, { repoId: 'r1', path: 'b.txt' }, { repoId: 'r1', path: 'conflict.txt' }],
        checked: [{ repoId: 'r1', path: 'a.txt' }],
        partial: { 'r1:b.txt': { hunkIds: [1] } },
      },
      { id: 'other', name: 'Later', comment: '', isDefault: false, files: [], checked: [], partial: {} },
    ],
  });

  it('renders Merge Conflicts first, then lists, then Unversioned Files', () => {
    const rows = buildRows(input({ repos, mode: 'changelist', changelists: lists }));
    const headers = rows.filter((r) => r.kind === 'group' || r.kind === 'list');
    expect(kinds(headers)).toEqual(['group:conflicts', 'list:default', 'list:other', 'group:unversioned']);
  });

  it('conflicted files never appear inside a changelist', () => {
    const rows = buildRows(input({ repos, mode: 'changelist', changelists: lists }));
    const listFiles = rows.filter((r) => r.kind === 'node' && r.keyPrefix === 'cl:default:r1');
    expect(listFiles.map((r) => (r.kind === 'node' ? r.node.path : ''))).toEqual(['a.txt', 'b.txt']);
    const conflictRows = rows.filter((r) => r.kind === 'node' && r.keyPrefix === 'mc:r1');
    expect(conflictRows.map((r) => (r.kind === 'node' ? r.node.path : ''))).toEqual(['conflict.txt']);
  });

  it('computes list totals, checked counts, active flag and partial badges', () => {
    const rows = buildRows(input({ repos, mode: 'changelist', changelists: lists }));
    const header = rows.find((r) => r.kind === 'list' && r.listId === 'default');
    expect(header).toMatchObject({ total: 2, checked: 1, isActive: true, comment: 'work in progress' });
    const other = rows.find((r) => r.kind === 'list' && r.listId === 'other');
    expect(other).toMatchObject({ isActive: false, total: 0 });
    const b = rows.find((r) => r.kind === 'node' && r.node.path === 'b.txt');
    expect(b?.kind === 'node' && b.partial).toBe(true);
    expect(b?.kind === 'node' && b.selection).toEqual({ hunkIds: [1] });
    const a = rows.find((r) => r.kind === 'node' && r.node.path === 'a.txt');
    expect(a?.kind === 'node' && a.included).toBe(true);
  });

  it('counts unversioned checks from unversionedChecked', () => {
    const rows = buildRows(input({
      repos,
      mode: 'changelist',
      changelists: { ...lists, unversionedChecked: [{ repoId: 'r1', path: 'new.txt' }] },
    }));
    const uv = rows.find((r) => r.kind === 'group' && r.group === 'unversioned');
    expect(uv).toMatchObject({ total: 1, checked: 1 });
  });

  it('hides Unversioned Files when the view option is off', () => {
    const rows = buildRows(input({ repos, mode: 'changelist', changelists: lists, viewOptions: { ...VIEW, showUnversioned: false } }));
    expect(rows.some((r) => r.kind === 'group' && r.group === 'unversioned')).toBe(false);
  });

  it('groups list files under repo sub-rows in multi-repo workspaces', () => {
    const multiLists = changelists({
      lists: [{
        id: 'default', name: 'Changes', comment: '', isDefault: true,
        files: [{ repoId: 'r1', path: 'a.txt' }, { repoId: 'r2', path: 'z.txt' }],
        checked: [], partial: {},
      }],
    });
    const rows = buildRows(input({
      repoOrder: ['r1', 'r2'],
      repos: { ...repos, r2: status('r2', [change('z.txt')]) },
      mode: 'changelist',
      changelists: multiLists,
    }));
    const repoRows = rows.filter((r) => r.kind === 'repo' && r.key.startsWith('cl:default:'));
    expect(repoRows.map((r) => (r.kind === 'repo' ? r.repoId : ''))).toEqual(['r1', 'r2']);
    const z = rows.find((r) => r.kind === 'node' && r.node.path === 'z.txt');
    expect(z?.kind === 'node' && z.depth).toBe(1);
  });

  it('headerKeys returns exactly the collapsible headers', () => {
    const keys = headerKeys(input({ repos, mode: 'changelist', changelists: lists }));
    expect(keys).toEqual(['mcrepo:r1', 'mc:r1', 'cl:default', 'cl:default:r1', 'cl:other', 'uvrepo:r1', 'uv:r1']);
  });
});

describe('project (repo) rows in multi-repo workspaces', () => {
  const repos = {
    r1: status('r1', [
      change('a.txt'),
      change('staged.txt', { staged: true, indexStatus: 'M', worktreeStatus: null }),
      change('conflict.txt', { conflicted: true, worktreeStatus: 'U' }),
      change('new.txt', { kind: 'untracked', worktreeStatus: '?' }),
    ]),
    r2: status('r2', [change('z.txt')]),
  };
  const multi = { repoOrder: ['r1', 'r2'], repos };

  it('single-repo changelist mode shows the root project node under the list', () => {
    const lists = changelists({
      lists: [{ id: 'default', name: 'Changes', comment: '', isDefault: true, files: [{ repoId: 'r1', path: 'a.txt' }], checked: [], partial: {} }],
    });
    const rows = buildRows(input({ repos: { r1: status('r1', [change('a.txt')]) }, mode: 'changelist', changelists: lists }));
    expect(kinds(rows)).toEqual(['list:default', 'repo:cl:default:r1', 'node:cl:default:r1:a.txt']);
    const root = rows.find((r) => r.kind === 'repo');
    expect(root).toMatchObject({ total: 1, checked: 0, selectable: true });
  });

  it('staging project rows count non-conflicted files and staged checks, refs cover the whole project', () => {
    const rows = buildRows(input(multi));
    const r1 = rows.find((r) => r.kind === 'repo' && r.key === 'repo:r1');
    expect(r1).toMatchObject({ total: 3, checked: 1, selectable: true });
    expect(r1?.kind === 'repo' && r1.refs).toEqual([
      { repoId: 'r1', path: 'a.txt' },
      { repoId: 'r1', path: 'staged.txt' },
      { repoId: 'r1', path: 'new.txt' },
    ]);
    const r2 = rows.find((r) => r.kind === 'repo' && r.key === 'repo:r2');
    expect(r2).toMatchObject({ total: 1, checked: 0, selectable: true });
  });

  it('collapsing a staging project row hides its groups but keeps the header', () => {
    const rows = buildRows(input({ ...multi, collapsed: { 'repo:r1': true } }));
    expect(rows.some((r) => r.key === 'repo:r1')).toBe(true);
    expect(rows.some((r) => r.kind === 'group' && r.repoId === 'r1')).toBe(false);
    expect(rows.some((r) => r.kind === 'node' && r.repoId === 'r1')).toBe(false);
    expect(rows.some((r) => r.kind === 'group' && r.repoId === 'r2')).toBe(true);
  });

  it('changelist project rows scope refs to list + repo; conflicts project row is not selectable', () => {
    const lists = changelists({
      lists: [{
        id: 'default', name: 'Changes', comment: '', isDefault: true,
        files: [{ repoId: 'r1', path: 'a.txt' }, { repoId: 'r2', path: 'z.txt' }, { repoId: 'r1', path: 'conflict.txt' }],
        checked: [{ repoId: 'r1', path: 'a.txt' }],
        partial: {},
      }],
      unversionedChecked: [{ repoId: 'r1', path: 'new.txt' }],
    });
    const rows = buildRows(input({ ...multi, mode: 'changelist', changelists: lists }));
    const lr1 = rows.find((r) => r.kind === 'repo' && r.key === 'cl:default:r1');
    expect(lr1).toMatchObject({ total: 1, checked: 1, selectable: true });
    expect(lr1?.kind === 'repo' && lr1.refs).toEqual([{ repoId: 'r1', path: 'a.txt' }]);
    const mc = rows.find((r) => r.kind === 'repo' && r.key === 'mcrepo:r1');
    expect(mc).toMatchObject({ total: 1, checked: 0, selectable: false });
    expect(mc?.kind === 'repo' && mc.refs).toEqual([]);
    const uv = rows.find((r) => r.kind === 'repo' && r.key === 'uvrepo:r1');
    expect(uv).toMatchObject({ total: 1, checked: 1, selectable: true });
    expect(uv?.kind === 'repo' && uv.refs).toEqual([{ repoId: 'r1', path: 'new.txt' }]);
  });

  it('collapsing changelist project rows hides their subtrees', () => {
    const lists = changelists({
      lists: [{
        id: 'default', name: 'Changes', comment: '', isDefault: true,
        files: [{ repoId: 'r1', path: 'a.txt' }, { repoId: 'r2', path: 'z.txt' }],
        checked: [], partial: {},
      }],
    });
    const rows = buildRows(input({
      ...multi,
      mode: 'changelist',
      changelists: lists,
      collapsed: { 'mcrepo:r1': true, 'cl:default:r1': true, 'uvrepo:r1': true },
    }));
    expect(rows.some((r) => r.key === 'mcrepo:r1')).toBe(true);
    expect(rows.some((r) => r.key === 'mc:r1')).toBe(false);
    expect(rows.some((r) => r.key === 'uv:r1')).toBe(false);
    expect(rows.some((r) => r.kind === 'node' && r.repoId === 'r1')).toBe(false);
    expect(rows.some((r) => r.kind === 'node' && r.node.path === 'z.txt')).toBe(true);
  });

  it('headerKeys includes project rows so Collapse All covers them', () => {
    const keys = headerKeys(input(multi));
    expect(keys).toContain('repo:r1');
    expect(keys).toContain('repo:r2');
    const rows = buildRows(input({ ...multi, collapsed: Object.fromEntries(keys.map((k) => [k, true])) }));
    expect(rows.every((r) => r.kind === 'repo')).toBe(true);
  });
});