import { describe, expect, it } from 'vitest';
import type { Uri } from 'vscode';
import { Status } from '../../src/adapter/gitApiTypes';
import type { Change } from '../../src/adapter/gitApiTypes';
import { mapBranch, mapRepoStatus } from '../../src/adapter/stateMapper';
import type { StateMapperInput } from '../../src/adapter/stateMapper';
import type { RepoDescriptor } from '../../src/protocol/models';

const ROOT = '/repo';

const descriptor: RepoDescriptor = {
  id: 'r1',
  rootUri: 'file:///repo',
  rootPath: ROOT,
  name: 'repo',
  kind: 'repository',
};

function uri(fsPath: string): Uri {
  return { fsPath, toString: () => `file://${fsPath}` } as unknown as Uri;
}

function change(relPath: string, status: Status, originalRel?: string): Change {
  return {
    uri: uri(`${ROOT}/${relPath}`),
    originalUri: uri(`${ROOT}/${originalRel ?? relPath}`),
    renameUri: undefined,
    status,
  };
}

function input(partial: Partial<StateMapperInput>): StateMapperInput {
  return {
    descriptor,
    head: { name: 'main', commit: 'abc1234', upstream: { remote: 'origin', name: 'main' }, ahead: 2, behind: 0 },
    mergeChanges: [],
    indexChanges: [],
    workingTreeChanges: [],
    untrackedChanges: [],
    ...partial,
  };
}

describe('mapRepoStatus', () => {
  it('merges partially staged file into one entry', () => {
    const status = mapRepoStatus(
      input({
        indexChanges: [change('a.ts', Status.INDEX_MODIFIED)],
        workingTreeChanges: [change('a.ts', Status.MODIFIED)],
      }),
      1,
    );
    expect(status.changes).toHaveLength(1);
    const entry = status.changes[0];
    expect(entry?.path).toBe('a.ts');
    expect(entry?.indexStatus).toBe('M');
    expect(entry?.worktreeStatus).toBe('M');
    expect(entry?.staged).toBe(true);
    expect(entry?.kind).toBe('modified');
  });

  it('maps untracked files', () => {
    const status = mapRepoStatus(input({ untrackedChanges: [change('new.txt', Status.UNTRACKED)] }), 1);
    const entry = status.changes[0];
    expect(entry?.kind).toBe('untracked');
    expect(entry?.worktreeStatus).toBe('?');
    expect(entry?.staged).toBe(false);
  });

  it('maps index rename with original path', () => {
    const status = mapRepoStatus(input({ indexChanges: [change('new.ts', Status.INDEX_RENAMED, 'old.ts')] }), 1);
    const entry = status.changes[0];
    expect(entry?.kind).toBe('renamed');
    expect(entry?.indexStatus).toBe('R');
    expect(entry?.origPath).toBe('old.ts');
    expect(entry?.staged).toBe(true);
  });

  it('marks merge conflicts and keeps them out of staged', () => {
    const status = mapRepoStatus(
      input({
        mergeChanges: [change('conflict.ts', Status.BOTH_MODIFIED)],
        indexChanges: [change('conflict.ts', Status.INDEX_MODIFIED)],
      }),
      1,
    );
    const entry = status.changes[0];
    expect(entry?.conflicted).toBe(true);
    expect(entry?.kind).toBe('conflicted');
    expect(entry?.indexStatus).toBe('U');
  });

  it('handles special file names (spaces, unicode)', () => {
    const status = mapRepoStatus(
      input({ workingTreeChanges: [change('中文 文件.txt', Status.MODIFIED)] }),
      1,
    );
    expect(status.changes[0]?.path).toBe('中文 文件.txt');
  });

  it('sorts changes by path and assigns seq', () => {
    const status = mapRepoStatus(
      input({
        workingTreeChanges: [change('z.ts', Status.MODIFIED), change('a.ts', Status.MODIFIED)],
      }),
      42,
    );
    expect(status.changes.map((c) => c.path)).toEqual(['a.ts', 'z.ts']);
    expect(status.seq).toBe(42);
  });

  it('ignores ignored entries', () => {
    const status = mapRepoStatus(input({ workingTreeChanges: [change('x.log', Status.IGNORED)] }), 1);
    expect(status.changes).toHaveLength(0);
  });
});

describe('mapBranch', () => {
  it('maps normal branch with upstream', () => {
    const info = mapBranch({ name: 'main', commit: 'abc', upstream: { remote: 'origin', name: 'main' }, ahead: 1, behind: 2 });
    expect(info).toEqual({ name: 'main', detached: false, oid: 'abc', upstream: 'origin/main', ahead: 1, behind: 2 });
  });

  it('detects detached HEAD', () => {
    const info = mapBranch({ commit: 'abc1234567' });
    expect(info.detached).toBe(true);
    expect(info.name).toBeUndefined();
  });

  it('handles unborn HEAD', () => {
    const info = mapBranch(undefined);
    expect(info.detached).toBe(false);
    expect(info.oid).toBeUndefined();
  });
});