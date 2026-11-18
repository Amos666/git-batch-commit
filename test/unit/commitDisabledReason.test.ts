import { describe, expect, it } from 'vitest';
import type { ChangelistState, FileChange, RepoStatus } from '../../src/protocol/models';
import { commitDisabledReason } from '../../src/webview/state/slices/commit';
import type { PanelStore } from '../../src/webview/state/types';

function change(repoId: string, path: string, partial: Partial<FileChange> = {}): FileChange {
  return {
    repoId,
    path,
    uri: `file:///${repoId}/${path}`,
    indexStatus: null,
    worktreeStatus: 'M',
    kind: 'modified',
    staged: false,
    conflicted: false,
    ...partial,
  };
}

function status(repoId: string, changes: FileChange[]): RepoStatus {
  return {
    repo: { id: repoId, rootUri: `file:///${repoId}`, rootPath: `/${repoId}`, name: repoId, kind: 'repository' },
    branch: { detached: false, name: 'main', oid: 'a'.repeat(40) },
    changes,
    seq: 1,
  };
}

function changelists(checked: { repoId: string; path: string }[], unversionedChecked: { repoId: string; path: string }[] = []): ChangelistState {
  return {
    version: 1,
    mode: 'changelist',
    activeId: 'default',
    lists: [{ id: 'default', name: 'Changes', comment: '', isDefault: true, files: checked, checked, partial: {} }],
    unversionedChecked,
  };
}

function store(partial: Partial<PanelStore>): PanelStore {
  return {
    mode: 'changelist',
    committing: false,
    checksRunning: [],
    amend: false,
    message: 'msg',
    repoOrder: [],
    repos: {},
    changelists: undefined,
    ...partial,
  } as PanelStore;
}

const R1 = status('r1', [change('r1', 'a.txt')]);
const R2_CONFLICT = status('r2', [change('r2', 'c.txt', { conflicted: true, kind: 'modified' })]);

describe('commitDisabledReason', () => {
  it('reports committing first', () => {
    expect(commitDisabledReason(store({ committing: true }))).toBe('committing');
  });

  it('reports running checks before file-based reasons', () => {
    expect(commitDisabledReason(store({ checksRunning: ['todo'] }))).toBe('checksRunning');
  });

  it('unrelated conflicted repo does not block the batch (changelist)', () => {
    const s = store({
      repoOrder: ['r1', 'r2'],
      repos: { r1: R1, r2: R2_CONFLICT },
      changelists: changelists([{ repoId: 'r1', path: 'a.txt' }]),
    });
    expect(commitDisabledReason(s)).toBeNull();
  });

  it('conflicts in a commit-target repo block (changelist)', () => {
    const s = store({
      repoOrder: ['r1', 'r2'],
      repos: { r1: R1, r2: R2_CONFLICT },
      changelists: changelists([
        { repoId: 'r1', path: 'a.txt' },
        { repoId: 'r2', path: 'c.txt' },
      ]),
    });
    expect(commitDisabledReason(s)).toBe('conflicted');
  });

  it('nothing checked surfaces conflicts before noChanges', () => {
    const s = store({ repoOrder: ['r2'], repos: { r2: R2_CONFLICT }, changelists: changelists([]) });
    expect(commitDisabledReason(s)).toBe('conflicted');
  });

  it('no checked files and no amend → noChanges; checked but empty message → noMessage', () => {
    const base = { repoOrder: ['r1'], repos: { r1: R1 }, changelists: changelists([]) };
    expect(commitDisabledReason(store(base))).toBe('noChanges');
    expect(commitDisabledReason(store({ ...base, changelists: changelists([{ repoId: 'r1', path: 'a.txt' }]), message: '  ' }))).toBe('noMessage');
  });

  it('amend with empty checked set is allowed when a HEAD exists', () => {
    const s = store({ repoOrder: ['r1'], repos: { r1: R1 }, changelists: changelists([]), amend: true, message: '' });
    expect(commitDisabledReason(s)).toBeNull();
  });

  it('staging mode scopes conflicts to repos with staged files', () => {
    const r1Staged = status('r1', [change('r1', 'a.txt', { staged: true, indexStatus: 'M' })]);
    const ok = store({ mode: 'staging', repoOrder: ['r1', 'r2'], repos: { r1: r1Staged, r2: R2_CONFLICT } });
    expect(commitDisabledReason(ok)).toBeNull();
    const r1ConflictedStaged = status('r1', [change('r1', 'a.txt', { staged: true, indexStatus: 'M', conflicted: true })]);
    const blocked = store({ mode: 'staging', repoOrder: ['r1'], repos: { r1: r1ConflictedStaged } });
    expect(commitDisabledReason(blocked)).toBe('conflicted');
  });
});