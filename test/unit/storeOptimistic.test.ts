import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RepoStatus } from '../../src/protocol/models';
import type { ProtocolError } from '../../src/protocol/errors';

const requestMock = vi.fn();
vi.mock('../../src/webview/bridge', () => ({
  request: (...args: unknown[]) => requestMock(...args),
  onEvent: () => () => {},
}));

import { usePanelStore } from '../../src/webview/store';

function change(path: string, over: Partial<RepoStatus['changes'][number]> = {}): RepoStatus['changes'][number] {
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

function status(changes: RepoStatus['changes']): RepoStatus {
  return {
    repo: { id: 'r1', rootUri: 'file:///repo', rootPath: '/repo', name: 'repo', kind: 'repository' },
    branch: { name: 'main', detached: false },
    changes,
    seq: 1,
  };
}

describe('stagePaths optimistic batch update', () => {
  beforeEach(() => {
    requestMock.mockReset();
    usePanelStore.setState({
      repos: { r1: status([change('a.txt'), change('b.txt'), change('c.txt', { conflicted: true, worktreeStatus: 'U' })]) },
      repoOrder: ['r1'],
      lastError: null,
    });
  });

  it('stages selected paths immediately, before the host request settles', async () => {
    let resolve!: (v: unknown) => void;
    requestMock.mockReturnValue(new Promise((r) => (resolve = r)));
    const done = usePanelStore.getState().stagePaths('r1', ['a.txt', 'b.txt'], true);
    const changes = usePanelStore.getState().repos.r1!.changes;
    expect(changes.find((c) => c.path === 'a.txt')?.staged).toBe(true);
    expect(changes.find((c) => c.path === 'a.txt')?.indexStatus).toBe('M');
    expect(changes.find((c) => c.path === 'b.txt')?.staged).toBe(true);
    resolve(undefined);
    await done;
    expect(usePanelStore.getState().repos.r1!.changes.find((c) => c.path === 'a.txt')?.staged).toBe(true);
  });

  it('leaves unselected and conflicted paths untouched', async () => {
    requestMock.mockResolvedValue(undefined);
    await usePanelStore.getState().stagePaths('r1', ['a.txt', 'c.txt'], true);
    const changes = usePanelStore.getState().repos.r1!.changes;
    expect(changes.find((c) => c.path === 'b.txt')?.staged).toBe(false);
    expect(changes.find((c) => c.path === 'c.txt')?.staged).toBe(false);
  });

  it('rolls back the optimistic state when the host request fails', async () => {
    const err: ProtocolError = { code: 'GENERIC', message: 'boom', actions: [] };
    requestMock.mockRejectedValue(err);
    await usePanelStore.getState().stagePaths('r1', ['a.txt'], true);
    const state = usePanelStore.getState();
    expect(state.repos.r1!.changes.find((c) => c.path === 'a.txt')?.staged).toBe(false);
    expect(state.lastError?.message).toBe('boom');
  });

  it('optimistic unstage clears staged flag and indexStatus', async () => {
    usePanelStore.setState({
      repos: { r1: status([change('a.txt', { staged: true, indexStatus: 'M' })]) },
    });
    let resolve!: (v: unknown) => void;
    requestMock.mockReturnValue(new Promise((r) => (resolve = r)));
    const done = usePanelStore.getState().stagePaths('r1', ['a.txt'], false);
    const c = usePanelStore.getState().repos.r1!.changes[0]!;
    expect(c.staged).toBe(false);
    expect(c.indexStatus).toBeNull();
    resolve(undefined);
    await done;
  });
});