import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChangelistState, CheckReport, CommitResult, RepoStatus } from '../../src/protocol/models';
import { createStore } from '../../src/webview/state/createStore';
import type { PanelStoreInstance } from '../../src/webview/state/createStore';
import { createMemoryTransport } from '../../src/webview/transport/memoryTransport';
import type { MemoryTransport } from '../../src/webview/transport/memoryTransport';

function status(repoId: string, paths: string[]): RepoStatus {
  return {
    repo: { id: repoId, rootUri: `file:///${repoId}`, rootPath: `/${repoId}`, name: repoId, kind: 'repository' },
    branch: { name: 'main', detached: false, oid: 'abc' },
    changes: paths.map((path) => ({
      repoId,
      path,
      uri: `file:///${repoId}/${path}`,
      indexStatus: null,
      worktreeStatus: 'M',
      kind: 'modified',
      staged: false,
      conflicted: false,
    })),
    seq: 1,
  };
}

function changelists(checked: { repoId: string; path: string }[]): ChangelistState {
  return {
    version: 1,
    mode: 'changelist',
    activeId: 'default',
    lists: [{ id: 'default', name: 'Changes', comment: '', isDefault: true, files: checked, checked, partial: {} }],
    unversionedChecked: [],
  };
}

const REPORT: CheckReport = { results: [{ id: 'todo', status: 'issues', details: '1 TODO item(s)' }] };

describe('post-commit checks scope', () => {
  let instance: PanelStoreInstance;
  let transport: MemoryTransport;
  const commitMock = vi.fn();
  const checksMock = vi.fn();

  beforeEach(() => {
    commitMock.mockReset();
    checksMock.mockReset();
    checksMock.mockResolvedValue(REPORT);
    transport = createMemoryTransport({
      'commit.run': commitMock,
      'checks.run': checksMock,
      'panel.init': async () => ({
        panelState: 'ready' as const,
        repos: [],
        settings: {
          defaultSelectAll: false,
          selectUntracked: false,
          clearMessageOnSuccess: true,
          stopOnFirstRepoError: true,
          refreshDebounceMs: 250,
        },
        extensionVersion: 'test',
        capabilities: {
          stagedDiff: true,
          hashObject: true,
          stash: true,
          log: true,
          rootCommitStats: true,
          commitAuthor: true,
          commitCleanup: false,
        },
        checks: [],
        changelists: changelists([]),
      }),
    });
    instance = createStore(transport);
    instance.store.setState({
      mode: 'changelist',
      message: 'msg',
      optionsState: { signoff: false, runHooks: true, checks: { todo: true }, runAfterCommit: true },
      repoOrder: ['r1', 'r2'],
      repos: { r1: status('r1', ['a.txt', 'b.txt']), r2: status('r2', ['c.txt']) },
      changelists: changelists([
        { repoId: 'r1', path: 'a.txt' },
        { repoId: 'r1', path: 'b.txt' },
        { repoId: 'r2', path: 'c.txt' },
      ]),
    });
  });

  it('scans the committed set even after the host prunes the checked refs', async () => {
    commitMock.mockImplementation(async (): Promise<CommitResult[]> => {
      // onCommitted prunes committed paths before the post-commit checks run
      instance.store.setState({ changelists: changelists([]) });
      return [{ repoId: 'r1', ok: true, commitOid: 'x', durationMs: 1 }];
    });
    instance.store.setState({
      changelists: changelists([
        { repoId: 'r1', path: 'a.txt' },
        { repoId: 'r1', path: 'b.txt' },
      ]),
    });
    await instance.store.getState().commit();
    expect(checksMock).toHaveBeenCalledWith({
      repoIds: ['r1'],
      checkIds: ['todo'],
      refs: [
        { repoId: 'r1', path: 'a.txt' },
        { repoId: 'r1', path: 'b.txt' },
      ],
    });
    expect(instance.store.getState().dialog).toMatchObject({
      kind: 'checksReport',
      postCommit: true,
      repoIds: ['r1'],
      report: REPORT,
    });
  });

  it('still reports for the ok repos when another repo fails', async () => {
    commitMock.mockResolvedValue([
      { repoId: 'r1', ok: true, commitOid: 'x', durationMs: 1 },
      { repoId: 'r2', ok: false, error: { code: 'HOOK_FAILED', message: 'hook', actions: [] }, durationMs: 1 },
    ] satisfies CommitResult[]);
    await instance.store.getState().commit();
    expect(checksMock).toHaveBeenCalledWith({
      repoIds: ['r1'],
      checkIds: ['todo'],
      refs: [
        { repoId: 'r1', path: 'a.txt' },
        { repoId: 'r1', path: 'b.txt' },
      ],
    });
    const s = instance.store.getState();
    expect(s.dialog).toMatchObject({ kind: 'checksReport', postCommit: true, repoIds: ['r1'] });
    expect(s.lastError).toMatchObject({ code: 'HOOK_FAILED', repoId: 'r2' });
  });

  it('skips the post-commit report when checks find no issues', async () => {
    checksMock.mockResolvedValue({ results: [{ id: 'todo', status: 'ok', details: '' }] } satisfies CheckReport);
    commitMock.mockResolvedValue([{ repoId: 'r1', ok: true, commitOid: 'x', durationMs: 1 }] satisfies CommitResult[]);
    instance.store.setState({ changelists: changelists([{ repoId: 'r1', path: 'a.txt' }]) });
    await instance.store.getState().commit();
    expect(checksMock).toHaveBeenCalled();
    expect(instance.store.getState().dialog).toBeNull();
    expect(instance.store.getState().checksRunning).toEqual([]);
  });
});