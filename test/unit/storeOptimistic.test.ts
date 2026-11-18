import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChangelistState, KernelCapabilities, RepoStatus } from '../../src/protocol/models';
import type { ProtocolError } from '../../src/protocol/errors';
import { createStore } from '../../src/webview/state/createStore';
import { includedByRepo } from '../../src/webview/state/slices/commit';
import type { PanelStoreInstance } from '../../src/webview/state/createStore';
import { createMemoryTransport } from '../../src/webview/transport/memoryTransport';
import type { MemoryTransport } from '../../src/webview/transport/memoryTransport';

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

const CAPABILITIES: KernelCapabilities = {
  stagedDiff: true,
  hashObject: true,
  stash: true,
  log: true,
  rootCommitStats: true,
  commitAuthor: true,
  commitCleanup: false,
};

function changelistState(over: Partial<ChangelistState> = {}): ChangelistState {
  return {
    version: 1,
    mode: 'changelist',
    activeId: 'default',
    lists: [{ id: 'default', name: 'Changes', comment: '', isDefault: true, files: [], checked: [], partial: {} }],
    unversionedChecked: [],
    ...over,
  };
}

const emptyInit = {
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
  capabilities: CAPABILITIES,
  checks: [],
  changelists: changelistState({ mode: 'staging' }),
};

describe('staging-mode setIncluded optimistic update', () => {
  let instance: PanelStoreInstance;
  let transport: MemoryTransport;
  const stageMock = vi.fn();
  const unstageMock = vi.fn();

  beforeEach(() => {
    stageMock.mockReset();
    unstageMock.mockReset();
    transport = createMemoryTransport({
      'index.stage': stageMock,
      'index.unstage': unstageMock,
      'panel.init': async () => emptyInit,
    });
    instance = createStore(transport);
    instance.store.setState({
      mode: 'staging',
      repos: { r1: status([change('a.txt'), change('b.txt'), change('c.txt', { conflicted: true, worktreeStatus: 'U' })]) },
      repoOrder: ['r1'],
      lastError: null,
    });
  });

  it('stages selected paths immediately, before the host request settles', async () => {
    let resolve!: (v: unknown) => void;
    stageMock.mockReturnValue(new Promise((r) => (resolve = r)));
    const done = instance.store.getState().setIncluded([{ repoId: 'r1', path: 'a.txt' }, { repoId: 'r1', path: 'b.txt' }], true);
    const changes = instance.store.getState().repos.r1!.changes;
    expect(changes.find((c) => c.path === 'a.txt')?.staged).toBe(true);
    expect(changes.find((c) => c.path === 'a.txt')?.indexStatus).toBe('M');
    expect(changes.find((c) => c.path === 'b.txt')?.staged).toBe(true);
    resolve(undefined);
    await done;
    expect(instance.store.getState().repos.r1!.changes.find((c) => c.path === 'a.txt')?.staged).toBe(true);
    expect(stageMock).toHaveBeenCalledWith({ repoId: 'r1', paths: ['a.txt', 'b.txt'] });
  });

  it('leaves unselected and conflicted paths untouched', async () => {
    stageMock.mockResolvedValue(undefined);
    await instance.store.getState().setIncluded([{ repoId: 'r1', path: 'a.txt' }, { repoId: 'r1', path: 'c.txt' }], true);
    const changes = instance.store.getState().repos.r1!.changes;
    expect(changes.find((c) => c.path === 'b.txt')?.staged).toBe(false);
    expect(changes.find((c) => c.path === 'c.txt')?.staged).toBe(false);
  });

  it('rolls back the optimistic state when the host request fails', async () => {
    const err: ProtocolError = { code: 'GENERIC', message: 'boom', actions: [] };
    stageMock.mockRejectedValue(err);
    await instance.store.getState().setIncluded([{ repoId: 'r1', path: 'a.txt' }], true);
    const state = instance.store.getState();
    expect(state.repos.r1!.changes.find((c) => c.path === 'a.txt')?.staged).toBe(false);
    expect(state.lastError?.message).toBe('boom');
  });

  it('optimistic unstage clears staged flag and indexStatus', async () => {
    instance.store.setState({
      repos: { r1: status([change('a.txt', { staged: true, indexStatus: 'M' })]) },
    });
    let resolve!: (v: unknown) => void;
    unstageMock.mockReturnValue(new Promise((r) => (resolve = r)));
    const done = instance.store.getState().setIncluded([{ repoId: 'r1', path: 'a.txt' }], false);
    const c = instance.store.getState().repos.r1!.changes[0]!;
    expect(c.staged).toBe(false);
    expect(c.indexStatus).toBeNull();
    resolve(undefined);
    await done;
    expect(unstageMock).toHaveBeenCalledWith({ repoId: 'r1', paths: ['a.txt'] });
  });

  it('reconciles optimistic state with host status events', () => {
    const off = instance.subscribeEvents();
    stageMock.mockResolvedValue(undefined);
    const updated = status([change('a.txt', { staged: true, indexStatus: 'M' })]);
    transport.emit('status.changed', { status: { ...updated, seq: 99 } });
    expect(instance.store.getState().repos.r1!.changes[0]?.staged).toBe(true);
    off();
    instance.store.setState({ repos: {} });
    transport.emit('status.changed', { status: { ...updated, seq: 100 } });
    expect(instance.store.getState().repos.r1).toBeUndefined();
  });
});

describe('changelist-mode setIncluded optimistic update', () => {
  let instance: PanelStoreInstance;
  let transport: MemoryTransport;
  const inclusionMock = vi.fn();
  const listMock = vi.fn();
  const base = changelistState({
    lists: [
      {
        id: 'default',
        name: 'Changes',
        comment: '',
        isDefault: true,
        files: [{ repoId: 'r1', path: 'a.txt' }, { repoId: 'r1', path: 'b.txt' }],
        checked: [],
        partial: {},
      },
    ],
  });

  beforeEach(() => {
    inclusionMock.mockReset();
    listMock.mockReset();
    listMock.mockResolvedValue(base);
    transport = createMemoryTransport({
      'inclusion.set': inclusionMock,
      'changelist.list': listMock,
      'panel.init': async () => ({ ...emptyInit, changelists: base }),
    });
    instance = createStore(transport);
    instance.store.setState({
      mode: 'changelist',
      changelists: base,
      repos: { r1: status([change('a.txt'), change('b.txt')]) },
      repoOrder: ['r1'],
      lastError: null,
    });
  });

  it('checks the file optimistically without touching the index', async () => {
    let resolve!: (v: unknown) => void;
    inclusionMock.mockReturnValue(new Promise((r) => (resolve = r)));
    const done = instance.store.getState().setIncluded([{ repoId: 'r1', path: 'a.txt' }], true);
    const state = instance.store.getState();
    expect(state.changelists?.lists[0]?.checked).toEqual([{ repoId: 'r1', path: 'a.txt' }]);
    expect(state.repos.r1!.changes.find((c) => c.path === 'a.txt')?.staged).toBe(false);
    resolve(undefined);
    await done;
    expect(inclusionMock).toHaveBeenCalledWith({ refs: [{ repoId: 'r1', path: 'a.txt' }], included: true });
  });

  it('unchecks optimistically and refetches host state on failure', async () => {
    instance.store.setState({
      changelists: { ...base, lists: [{ ...base.lists[0]!, checked: [{ repoId: 'r1', path: 'a.txt' }] }] },
    });
    const err: ProtocolError = { code: 'GENERIC', message: 'nope', actions: [] };
    inclusionMock.mockRejectedValue(err);
    let resolveList!: (v: ChangelistState) => void;
    listMock.mockReturnValue(new Promise((r) => (resolveList = r)));
    await instance.store.getState().setIncluded([{ repoId: 'r1', path: 'a.txt' }], false);
    expect(instance.store.getState().changelists?.lists[0]?.checked).toEqual([]);
    await vi.waitFor(() => expect(listMock).toHaveBeenCalled());
    resolveList({ ...base, lists: [{ ...base.lists[0]!, checked: [{ repoId: 'r1', path: 'a.txt' }] }] });
    await vi.waitFor(() =>
      expect(instance.store.getState().changelists?.lists[0]?.checked).toEqual([{ repoId: 'r1', path: 'a.txt' }]),
    );
    expect(instance.store.getState().lastError?.message).toBe('nope');
  });

  it('tracks unversioned checks separately', async () => {
    inclusionMock.mockResolvedValue(undefined);
    instance.store.setState({
      repos: { r1: status([change('new.txt', { kind: 'untracked', worktreeStatus: '?' })]) },
    });
    await instance.store.getState().setIncluded([{ repoId: 'r1', path: 'new.txt' }], true);
    expect(instance.store.getState().changelists?.unversionedChecked).toEqual([{ repoId: 'r1', path: 'new.txt' }]);
  });
});
describe('changelist-mode setIncluded optimistic update', () => {
  let instance: PanelStoreInstance;
  let transport: MemoryTransport;
  const inclusionMock = vi.fn();

  beforeEach(() => {
    inclusionMock.mockReset();
    inclusionMock.mockResolvedValue(undefined);
    transport = createMemoryTransport({
      'inclusion.set': inclusionMock,
      'panel.init': async () => emptyInit,
    });
    instance = createStore(transport);
    instance.store.setState({
      mode: 'changelist',
      repos: { r1: status([change('a.txt'), change('b.txt'), change('new.txt', { kind: 'untracked', worktreeStatus: '?' })]) },
      repoOrder: ['r1'],
      lastError: null,
      changelists: changelistState({
        lists: [{ id: 'default', name: 'Changes', comment: '', isDefault: true, files: [{ repoId: 'r1', path: 'a.txt' }, { repoId: 'r1', path: 'b.txt' }], checked: [], partial: {} }],
      }),
    });
  });

  it('tracked refs go to list.checked only, never unversionedChecked (no duplicate commit entries)', async () => {
    let resolve!: (v: unknown) => void;
    inclusionMock.mockReturnValue(new Promise((r) => (resolve = r)));
    const refs = [{ repoId: 'r1', path: 'a.txt' }, { repoId: 'r1', path: 'b.txt' }];
    const done = instance.store.getState().setIncluded(refs, true);
    const state = instance.store.getState();
    expect(state.changelists!.lists[0]!.checked).toEqual(refs);
    expect(state.changelists!.unversionedChecked).toEqual([]);
    const included = includedByRepo(state);
    expect(included.r1!.map((e) => e.path)).toEqual(['a.txt', 'b.txt']);
    resolve(undefined);
    await done;
  });

  it('untracked refs go to unversionedChecked only', async () => {
    await instance.store.getState().setIncluded([{ repoId: 'r1', path: 'new.txt' }], true);
    const state = instance.store.getState();
    expect(state.changelists!.lists[0]!.checked).toEqual([]);
    expect(state.changelists!.unversionedChecked).toEqual([{ repoId: 'r1', path: 'new.txt' }]);
    expect(includedByRepo(state).r1!.map((e) => e.path)).toEqual(['new.txt']);
  });

  it('unchecking clears both checked and unversionedChecked', async () => {
    await instance.store.getState().setIncluded([{ repoId: 'r1', path: 'a.txt' }, { repoId: 'r1', path: 'new.txt' }], true);
    await instance.store.getState().setIncluded([{ repoId: 'r1', path: 'a.txt' }, { repoId: 'r1', path: 'new.txt' }], false);
    const state = instance.store.getState();
    expect(state.changelists!.lists[0]!.checked).toEqual([]);
    expect(state.changelists!.unversionedChecked).toEqual([]);
  });
});
