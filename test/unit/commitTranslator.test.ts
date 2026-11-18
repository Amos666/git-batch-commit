import { describe, expect, it, vi } from 'vitest';
import { RepoRegistry } from '../../src/adapter/repoRegistry';
import { CommitTranslator, parseStagedPaths } from '../../src/core/commitTranslator';
import type { TranslationState } from '../../src/core/commitTranslator';
import { parseHunks } from '../../src/core/hunkDiff';
import { InclusionModel } from '../../src/core/inclusionModel';
import type { MiniRunner } from '../../src/core/miniRunner';
import type { GitKernel, KernelRepo } from '../../src/kernel/types';
import type { ProtocolError } from '../../src/protocol/errors';
import type { HunkService } from '../../src/services/hunkService';

const ROOT = '/repo';

interface MockState {
  working: string[];
  untracked: string[];
  index: string[];
  merge: string[];
}

function setup(state: MockState, porcelain: string[]) {
  const calls: string[] = [];
  const repo = {
    rootPath: ROOT,
    rootUri: `file://${ROOT}`,
    kind: 'repository',
    state: {
      HEAD: { name: 'main', commit: 'abc', detached: false },
      mergeChanges: state.merge.map((path) => ({ path })),
      workingTreeChanges: state.working.map((path) => ({ path })),
      untrackedChanges: state.untracked.map((path) => ({ path })),
      indexChanges: state.index.map((path) => ({ path })),
      onDidChange: () => () => {},
    },
    add: async (paths: string[]) => {
      calls.push(`add:${paths.length}`);
    },
    restore: async (paths: string[]) => {
      calls.push(`restore:${paths.join(',')}`);
    },
  } as unknown as KernelRepo;
  const kernel: GitKernel = {
    repositories: [repo],
    capabilities: {
      stagedDiff: true,
      hashObject: true,
      stash: true,
      log: true,
      rootCommitStats: true,
      commitAuthor: true,
      commitCleanup: false,
    },
    onDidOpenRepository: () => () => {},
    onDidCloseRepository: () => () => {},
    dispose: () => {},
  };
  const registry = new RepoRegistry(kernel);
  const inclusion = new InclusionModel(registry);
  const queue = [...porcelain];
  const mini = {
    run: async (_root: string, req: { cmd: string }) => {
      expect(req.cmd).toBe('status-porcelain');
      const next = queue.length > 1 ? queue.shift()! : queue[0]!;
      return { stdout: Buffer.from(next), stderr: Buffer.alloc(0) };
    },
  } as unknown as MiniRunner;
  const hunk = {
    list: vi.fn(async () => ({
      side: 'worktree' as const,
      binary: false,
      hunks: parseHunks(['@@ -1,2 +1,2 @@', ' a', '-b', '+B'].join('\n')),
    })),
    stagePartial: vi.fn(async () => {}),
  } as unknown as HunkService;
  const translator = new CommitTranslator(registry, inclusion, hunk, mini);
  const repoId = registry.all()[0]!.id;
  return { translator, repoId, calls, hunk, tx: { indexModified: false } as TranslationState };
}

const CONFIRM_OK = async () => true;

describe('parseStagedPaths', () => {
  it('parses porcelain -z entries and skips rename origin tokens', () => {
    const raw = 'M  mod.txt\0A  added.txt\0R  new.txt\0old.txt\0D  gone.txt\0MM both.txt\0';
    expect(parseStagedPaths(Buffer.from(raw))).toEqual(['mod.txt', 'added.txt', 'new.txt', 'gone.txt', 'both.txt']);
  });

  it('ignores worktree-only entries', () => {
    expect(parseStagedPaths(Buffer.from(' M work.txt\0?? untracked.txt\0'))).toEqual([]);
  });

  it('ignores submodule dirty-content entries', () => {
    expect(parseStagedPaths(Buffer.from(' m sub\0 ? sub2\0'))).toEqual([]);
  });
});

describe('CommitTranslator', () => {
  it('stages fully included tracked and untracked paths and flags indexModified', async () => {
    const { translator, repoId, calls, tx } = setup(
      { working: ['m.txt'], untracked: ['u.txt'], index: [], merge: [] },
      ['', 'M  m.txt\0A  u.txt\0'],
    );
    await translator.translate(repoId, [{ path: 'm.txt' }, { path: 'u.txt' }], { confirmExclusion: CONFIRM_OK, tx });
    expect(calls).toEqual(['add:2']);
    expect(tx.indexModified).toBe(true);
  });

  it('chunks add calls at 500 paths', async () => {
    const paths = Array.from({ length: 1200 }, (_, i) => `f${i}.txt`);
    const post = paths.map((p) => `A  ${p}\0`).join('');
    const { translator, repoId, calls } = setup(
      { working: [], untracked: paths, index: [], merge: [] },
      ['', post],
    );
    await translator.translate(repoId, paths.map((path) => ({ path })), { confirmExclusion: CONFIRM_OK, tx: { indexModified: false } });
    expect(calls).toEqual(['add:500', 'add:500', 'add:200']);
  });

  it('excludes externally staged entries after confirmation, before staging the checked set', async () => {
    const { translator, repoId, calls, tx } = setup(
      { working: ['m.txt'], untracked: [], index: ['external.txt'], merge: [] },
      ['M  external.txt\0', 'M  m.txt\0'],
    );
    const asked: string[][] = [];
    await translator.translate(repoId, [{ path: 'm.txt' }], {
      confirmExclusion: async (paths) => {
        asked.push(paths);
        return true;
      },
      tx,
    });
    expect(asked).toEqual([['external.txt']]);
    expect(calls).toEqual(['restore:external.txt', 'add:1']);
    expect(tx.indexModified).toBe(true);
  });

  it('declining the exclusion aborts without touching the index', async () => {
    const { translator, repoId, calls, tx } = setup(
      { working: ['m.txt'], untracked: [], index: ['external.txt'], merge: [] },
      ['M  external.txt\0'],
    );
    await expect(
      translator.translate(repoId, [{ path: 'm.txt' }], { confirmExclusion: async () => false, tx }),
    ).rejects.toMatchObject({ code: 'GENERIC' });
    expect(calls).toEqual([]);
    expect(tx.indexModified).toBe(false);
  });

  it('blocks missing paths with INCLUDED_MISMATCH before any mutation', async () => {
    const { translator, repoId, calls, tx } = setup({ working: ['m.txt'], untracked: [], index: [], merge: [] }, ['']);
    await expect(
      translator.translate(repoId, [{ path: 'ghost.txt' }], { confirmExclusion: CONFIRM_OK, tx }),
    ).rejects.toMatchObject({ code: 'INCLUDED_MISMATCH' });
    expect(calls).toEqual([]);
    expect(tx.indexModified).toBe(false);
  });

  it('blocks duplicate paths and unresolved conflicts', async () => {
    const dup = setup({ working: ['m.txt'], untracked: [], index: [], merge: [] }, ['']);
    await expect(
      dup.translator.translate(dup.repoId, [{ path: 'm.txt' }, { path: 'm.txt' }], { confirmExclusion: CONFIRM_OK, tx: dup.tx }),
    ).rejects.toMatchObject({ code: 'INCLUDED_MISMATCH' });
    const conflicted = setup({ working: [], untracked: [], index: [], merge: ['c.txt'] }, ['']);
    await expect(
      conflicted.translator.translate(conflicted.repoId, [{ path: 'c.txt' }], { confirmExclusion: CONFIRM_OK, tx: conflicted.tx }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('routes partial selections through hunk.stagePartial after fresh-patch validation', async () => {
    const { translator, repoId, calls, hunk, tx } = setup(
      { working: ['m.txt'], untracked: [], index: [], merge: [] },
      ['', 'M  m.txt\0'],
    );
    const selection = { hunkIds: [0], lines: { 0: [1] } };
    await translator.translate(repoId, [{ path: 'm.txt', selection }], { confirmExclusion: CONFIRM_OK, tx });
    expect(hunk.list).toHaveBeenCalledWith(repoId, 'm.txt', 'worktree');
    expect(hunk.stagePartial).toHaveBeenCalledWith(repoId, 'm.txt', selection);
    expect(calls).toEqual([]);
    expect(tx.indexModified).toBe(true);
  });

  it('rejects stale hunk ids with HUNK_CONFLICT before any mutation', async () => {
    const { translator, repoId, calls, hunk, tx } = setup(
      { working: ['m.txt'], untracked: [], index: [], merge: [] },
      [''],
    );
    await expect(
      translator.translate(repoId, [{ path: 'm.txt', selection: { hunkIds: [42] } }], { confirmExclusion: CONFIRM_OK, tx }),
    ).rejects.toMatchObject({ code: 'HUNK_CONFLICT' });
    expect(hunk.stagePartial).not.toHaveBeenCalled();
    expect(calls).toEqual([]);
    expect(tx.indexModified).toBe(false);
  });

  it('flags indexModified when the final race guard trips after staging', async () => {
    const { translator, repoId, tx } = setup(
      { working: ['m.txt'], untracked: [], index: [], merge: [] },
      ['', 'M  other.txt\0'],
    );
    try {
      await translator.translate(repoId, [{ path: 'm.txt' }], { confirmExclusion: CONFIRM_OK, tx });
      expect.unreachable('race must block');
    } catch (err) {
      expect((err as ProtocolError).code).toBe('INCLUDED_MISMATCH');
      expect((err as ProtocolError).actions).toContain('retry');
    }
    expect(tx.indexModified).toBe(true);
  });

  it('tolerates checked submodule dirty content that git cannot stage from the parent', async () => {
    const { translator, repoId, calls, tx } = setup(
      { working: ['m.txt', 'sub'], untracked: [], index: [], merge: [] },
      [' m sub\0', 'M  m.txt\0 m sub\0'],
    );
    await translator.translate(repoId, [{ path: 'm.txt' }, { path: 'sub' }], { confirmExclusion: CONFIRM_OK, tx });
    expect(calls).toEqual(['add:2']);
    expect(tx.indexModified).toBe(true);
  });

  it('rejects an empty checked set with NO_CHANGES', async () => {
    const { translator, repoId } = setup({ working: [], untracked: [], index: [], merge: [] }, ['']);
    await expect(translator.translate(repoId, [], { confirmExclusion: CONFIRM_OK, tx: { indexModified: false } })).rejects.toMatchObject({
      code: 'NO_CHANGES',
    });
  });
});