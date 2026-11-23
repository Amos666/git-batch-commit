import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PushCommitFile, PushFilesResult, PushPreviewEntry, PushRunRequest, PushRunResult, RepoStatus } from '../../src/protocol/models';
import { createStore } from '../../src/webview/state/createStore';
import type { PanelStoreInstance } from '../../src/webview/state/createStore';
import { createMemoryTransport } from '../../src/webview/transport/memoryTransport';
import type { MemoryTransport } from '../../src/webview/transport/memoryTransport';

function status(id: string, branch: RepoStatus['branch']): RepoStatus {
  return {
    repo: { id, rootUri: `file:///${id}`, rootPath: `/${id}`, name: id, kind: 'repository' },
    branch,
    changes: [],
    seq: 1,
  };
}

const R1 = status('r1', { name: 'main', detached: false, upstream: 'origin/main', ahead: 2 });
const R2 = status('r2', { name: 'main', detached: false, upstream: 'origin/main', ahead: 0 });
const R3 = status('r3', { name: 'main', detached: false });
const DETACHED = status('r4', { detached: true, oid: 'abc1234' });

function previewEntry(repoId: string, over: Partial<PushPreviewEntry> = {}): PushPreviewEntry {
  return {
    repoId,
    branch: 'main',
    upstream: 'origin/main',
    ahead: 1,
    remotes: ['origin'],
    commits: [{ hash: 'a'.repeat(40), message: 'outgoing' }],
    hasMore: false,
    ...over,
  };
}

describe('Push dialog (IDEA semantics)', () => {
  let instance: PanelStoreInstance;
  let transport: MemoryTransport;
  const pushRun = vi.fn<(params: PushRunRequest) => Promise<PushRunResult[]>>();
  const pushCommitFiles = vi.fn<(params: { repoId: string; hash?: string }) => Promise<PushFilesResult>>();
  const pushFileDiff = vi.fn<(params: { repoId: string; file: PushCommitFile; from: string; to: string }) => Promise<void>>();

  beforeEach(() => {
    pushRun.mockReset();
    pushRun.mockImplementation(async (params) => params.repoIds.map((repoId) => ({ repoId, ok: true })));
    pushCommitFiles.mockReset();
    pushCommitFiles.mockImplementation(async (params) => ({
      from: 'c'.repeat(40),
      to: params.hash ?? 'HEAD',
      files: [{ path: 'src/app.ts', status: 5 }],
    }));
    pushFileDiff.mockReset();
    pushFileDiff.mockImplementation(async () => {});
    transport = createMemoryTransport({
      'push.run': pushRun,
      'push.commitFiles': pushCommitFiles,
      'push.fileDiff': pushFileDiff,
      'push.preview': async (params) =>
        params.repoIds.map((id) =>
          id === 'r3' ? previewEntry(id, { upstream: undefined, ahead: undefined }) : previewEntry(id),
        ),
    });
    instance = createStore(transport);
    instance.store.setState({
      repos: { r1: R1, r2: R2, r3: R3, r4: DETACHED },
      repoOrder: ['r1', 'r2', 'r3', 'r4'],
      lastError: null,
    });
  });

  const dialog = () => {
    const d = instance.store.getState().dialog;
    if (d?.kind !== 'push') {
      throw new Error('push dialog not open');
    }
    return d;
  };

  it('lists roots with a branch, default-checks ahead>0 plus the explicit scope', async () => {
    instance.store.getState().requestPush(['r2']);
    const d = dialog();
    expect(d.repoIds).toEqual(['r1', 'r2', 'r3']);
    expect(d.checked).toEqual({ r1: true, r2: true, r3: false });
    await vi.waitFor(() => expect(dialog().previewLoading).toBe(false));
  });

  it('includeAhead=false checks only the given scope (partial commit failure)', () => {
    instance.store.getState().requestPush(['r2'], false);
    expect(dialog().checked).toEqual({ r1: false, r2: true, r3: false });
  });

  it('preview auto-selects the only remote for roots without upstream', async () => {
    instance.store.getState().requestPush(['r3']);
    await vi.waitFor(() => expect(dialog().remoteChoice.r3).toBe('origin'));
    expect(dialog().preview.r3?.commits).toHaveLength(1);
  });

  it('confirmPush sends one batch with targets and closes on full success', async () => {
    instance.store.getState().requestPush(['r1', 'r3']);
    await vi.waitFor(() => expect(dialog().previewLoading).toBe(false));
    await instance.store.getState().confirmPush();
    expect(pushRun).toHaveBeenCalledTimes(1);
    const params = pushRun.mock.calls[0]![0];
    expect(params.repoIds).toEqual(['r1', 'r3']);
    expect(params.targets).toEqual({ r3: { remote: 'origin', branch: 'main' } });
    expect(instance.store.getState().dialog).toBeNull();
  });

  it('edits the push target of a root that already has an upstream', async () => {
    instance.store.getState().requestPush(['r1']);
    await vi.waitFor(() => expect(dialog().previewLoading).toBe(false));
    instance.store.getState().setPushRemote('r1', 'backup');
    instance.store.getState().setPushBranch('r1', 'release');
    await instance.store.getState().confirmPush();
    expect(pushRun.mock.calls[0]![0].targets).toEqual({ r1: { remote: 'backup', branch: 'release' } });
  });

  it('a branch-only override keeps the upstream remote', async () => {
    instance.store.getState().requestPush(['r1']);
    await vi.waitFor(() => expect(dialog().previewLoading).toBe(false));
    instance.store.getState().setPushBranch('r1', 'topic');
    await instance.store.getState().confirmPush();
    expect(pushRun.mock.calls[0]![0].targets).toEqual({ r1: { remote: 'origin', branch: 'topic' } });
  });

  it('a cleared branch field falls back to the upstream branch', async () => {
    instance.store.getState().requestPush(['r1']);
    await vi.waitFor(() => expect(dialog().previewLoading).toBe(false));
    instance.store.getState().setPushRemote('r1', 'backup');
    instance.store.getState().setPushBranch('r1', '   ');
    await instance.store.getState().confirmPush();
    expect(pushRun.mock.calls[0]![0].targets).toEqual({ r1: { remote: 'backup', branch: 'main' } });
  });

  it('a failed repo keeps the dialog open with per-repo results; retry re-pushes only that repo', async () => {
    pushRun.mockImplementation(async (params) =>
      params.repoIds.map((repoId) =>
        repoId === 'r1'
          ? { repoId, ok: false, error: { code: 'PUSH_REJECTED', message: 'rejected', actions: [] } }
          : { repoId, ok: true },
      ),
    );
    instance.store.getState().requestPush(['r1', 'r2']);
    await vi.waitFor(() => expect(dialog().previewLoading).toBe(false));
    await instance.store.getState().confirmPush();
    const d = dialog();
    expect(d.results.r1?.ok).toBe(false);
    expect(d.results.r2?.ok).toBe(true);
    expect(instance.store.getState().dialogBusy).toBe(false);

    pushRun.mockImplementation(async (params) => params.repoIds.map((repoId) => ({ repoId, ok: true })));
    await instance.store.getState().retryPushRepo('r1');
    expect(pushRun).toHaveBeenLastCalledWith(expect.objectContaining({ repoIds: ['r1'] }));
    expect(instance.store.getState().dialog).toBeNull();
  });

  it('refuses to push a no-upstream root without a remote choice', async () => {
    transport.handlers['push.preview'] = async (params) =>
      params.repoIds.map((id) => previewEntry(id, { upstream: undefined, remotes: ['origin', 'backup'] }));
    instance.store.getState().requestPush(['r3']);
    await vi.waitFor(() => expect(dialog().previewLoading).toBe(false));
    await instance.store.getState().confirmPush();
    expect(pushRun).not.toHaveBeenCalled();
    expect(instance.store.getState().dialogError).toBeTruthy();
    instance.store.getState().setPushRemote('r3', 'backup');
    await instance.store.getState().confirmPush();
    expect(pushRun.mock.calls[0]![0].targets).toEqual({ r3: { remote: 'backup', branch: 'main' } });
  });

  it('defers to host resolution when the preview lists no remotes (stale after git remote add)', async () => {
    transport.handlers['push.preview'] = async (params) =>
      params.repoIds.map((id) => previewEntry(id, { upstream: undefined, remotes: [] }));
    instance.store.getState().requestPush(['r3']);
    await vi.waitFor(() => expect(dialog().previewLoading).toBe(false));
    await instance.store.getState().confirmPush();
    expect(pushRun).toHaveBeenCalledTimes(1);
    expect(pushRun.mock.calls[0]![0].targets).toEqual({});
    expect(instance.store.getState().dialog).toBeNull();
  });

  it('empty selection is rejected with a visible error', async () => {
    instance.store.getState().requestPush([], false);
    await instance.store.getState().confirmPush();
    expect(pushRun).not.toHaveBeenCalled();
    expect(instance.store.getState().dialogError).toBeTruthy();
  });

  it('force push requires confirmation and passes force-with-lease flag', async () => {
    instance.store.getState().requestPush(['r1']);
    await vi.waitFor(() => expect(dialog().previewLoading).toBe(false));
    instance.store.getState().requestForcePush();
    expect(dialog().forceConfirm).toBe(true);
    expect(pushRun).not.toHaveBeenCalled();
    instance.store.getState().cancelForcePush();
    expect(dialog().forceConfirm).toBe(false);
    instance.store.getState().requestForcePush();
    await instance.store.getState().confirmForcePush();
    expect(pushRun.mock.calls[0]![0].force).toBe(true);
  });

  it('tags option is forwarded to the batch', async () => {
    instance.store.getState().requestPush(['r1']);
    await vi.waitFor(() => expect(dialog().previewLoading).toBe(false));
    instance.store.getState().setPushTags(true);
    await instance.store.getState().confirmPush();
    expect(pushRun.mock.calls[0]![0].tags).toBe(true);
  });

  it('selecting a commit loads its files; reselection hits the cache', async () => {
    instance.store.getState().requestPush(['r1']);
    await vi.waitFor(() => expect(dialog().previewLoading).toBe(false));
    const hash = 'a'.repeat(40);
    instance.store.getState().selectPushFiles('r1', hash);
    await vi.waitFor(() => expect(dialog().filesLoading).toBe(false));
    expect(pushCommitFiles).toHaveBeenCalledWith({ repoId: 'r1', hash });
    expect(dialog().selected).toEqual({ repoId: 'r1', hash });
    expect(dialog().files?.files).toEqual([{ path: 'src/app.ts', status: 5 }]);

    instance.store.getState().selectPushFiles('r1');
    await vi.waitFor(() => expect(dialog().filesLoading).toBe(false));
    instance.store.getState().selectPushFiles('r1', hash);
    expect(dialog().filesLoading).toBe(false);
    expect(dialog().files?.files).toEqual([{ path: 'src/app.ts', status: 5 }]);
    expect(pushCommitFiles).toHaveBeenCalledTimes(2);
  });

  it('whole-repo selection requests the outgoing range without a hash', async () => {
    instance.store.getState().requestPush(['r1']);
    await vi.waitFor(() => expect(dialog().previewLoading).toBe(false));
    instance.store.getState().selectPushFiles('r1');
    await vi.waitFor(() => expect(dialog().filesLoading).toBe(false));
    expect(pushCommitFiles).toHaveBeenCalledWith({ repoId: 'r1', hash: undefined });
    expect(dialog().files?.to).toBe('HEAD');
  });

  it('a stale files response never overwrites a newer selection', async () => {
    let resolveFirst: (value: PushFilesResult) => void = () => {};
    pushCommitFiles.mockImplementationOnce(
      () =>
        new Promise<PushFilesResult>((resolve) => {
          resolveFirst = resolve;
        }),
    );
    instance.store.getState().requestPush(['r1']);
    await vi.waitFor(() => expect(dialog().previewLoading).toBe(false));
    instance.store.getState().selectPushFiles('r1', 'a'.repeat(40));
    instance.store.getState().selectPushFiles('r1', 'b'.repeat(40));
    await vi.waitFor(() => expect(dialog().files?.to).toBe('b'.repeat(40)));
    resolveFirst({ from: 'c'.repeat(40), to: 'a'.repeat(40), files: [{ path: 'stale.ts' }] });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(dialog().files?.to).toBe('b'.repeat(40));
    expect(dialog().files?.files).toEqual([{ path: 'src/app.ts', status: 5 }]);
  });

  it('files errors surface in the pane without closing the dialog', async () => {
    pushCommitFiles.mockRejectedValue({ code: 'GENERIC', message: 'diff failed' });
    instance.store.getState().requestPush(['r1']);
    await vi.waitFor(() => expect(dialog().previewLoading).toBe(false));
    instance.store.getState().selectPushFiles('r1', 'a'.repeat(40));
    await vi.waitFor(() => expect(dialog().filesLoading).toBe(false));
    expect(dialog().filesError).toBe('diff failed');
    expect(instance.store.getState().dialog?.kind).toBe('push');
  });

  it('openPushFileDiff forwards the file with the comparison refs', async () => {
    instance.store.getState().requestPush(['r1']);
    await vi.waitFor(() => expect(dialog().previewLoading).toBe(false));
    const hash = 'a'.repeat(40);
    instance.store.getState().selectPushFiles('r1', hash);
    await vi.waitFor(() => expect(dialog().filesLoading).toBe(false));
    const file: PushCommitFile = { path: 'src/app.ts', status: 5 };
    await instance.store.getState().openPushFileDiff(file);
    expect(pushFileDiff).toHaveBeenCalledWith({ repoId: 'r1', file, from: 'c'.repeat(40), to: hash });
  });

  it('loadPushBranches caches the remote branch list tagged with its remote', async () => {
    instance.store.getState().requestPush(['r1']);
    await vi.waitFor(() => expect(dialog().previewLoading).toBe(false));
    const remoteBranches = vi.fn(async (params: { repoId: string; remote: string }) =>
      params.remote === 'backup' ? { branches: ['backup-main'] } : { branches: ['main', 'release'] },
    );
    transport.handlers['push.remoteBranches'] = remoteBranches;
    instance.store.getState().loadPushBranches('r1', 'origin');
    await vi.waitFor(() => expect(dialog().branchOptions.r1).toEqual({ remote: 'origin', branches: ['main', 'release'] }));
    instance.store.getState().loadPushBranches('r1', 'backup');
    await vi.waitFor(() => expect(dialog().branchOptions.r1).toEqual({ remote: 'backup', branches: ['backup-main'] }));
    expect(remoteBranches).toHaveBeenCalledWith({ repoId: 'r1', remote: 'backup' });
  });

  it('a remoteBranches failure keeps the editor usable as a free input', async () => {
    instance.store.getState().requestPush(['r1']);
    await vi.waitFor(() => expect(dialog().previewLoading).toBe(false));
    transport.handlers['push.remoteBranches'] = async () => {
      throw { code: 'GENERIC', message: 'not listed' };
    };
    instance.store.getState().loadPushBranches('r1', 'origin');
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(dialog().branchOptions.r1).toBeUndefined();
    expect(instance.store.getState().dialog?.kind).toBe('push');
  });
});