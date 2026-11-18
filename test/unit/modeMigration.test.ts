import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_LIST_ID } from '../../src/core/changelistModel';
import type { InclusionModel } from '../../src/core/inclusionModel';
import type { StatusService } from '../../src/core/statusService';
import type { ProtocolError } from '../../src/protocol/errors';
import type { ChangelistState, CommitMode, FileChange, RepoStatus } from '../../src/protocol/models';
import { ChangelistService } from '../../src/services/changelistService';
import type { ChangelistStorage } from '../../src/services/changelistService';
import type { HunkService } from '../../src/services/hunkService';

function change(repoId: string, path: string, kind: FileChange['kind'], staged = false): FileChange {
  return {
    repoId,
    path,
    uri: `file:///${repoId}/${path}`,
    indexStatus: staged ? 'M' : null,
    worktreeStatus: kind === 'untracked' ? '?' : 'M',
    kind,
    staged,
    conflicted: false,
  };
}

function status(repoId: string, changes: FileChange[]): RepoStatus {
  return {
    repo: { id: repoId, rootUri: `file:///${repoId}`, rootPath: `/${repoId}`, name: repoId, kind: 'repository' },
    branch: { detached: false, name: 'main' },
    changes,
    seq: 1,
  };
}

function setup(statuses: RepoStatus[], policy = { defaultSelectAll: false, selectUntracked: false }) {
  let saved: ChangelistState | undefined;
  let backedUp: ChangelistState | undefined;
  const storage: ChangelistStorage = {
    load: () => saved,
    save: async (state) => {
      saved = state;
    },
    backup: async (state) => {
      backedUp = state;
    },
  };
  let listener: ((snapshot: RepoStatus) => void) | undefined;
  const statusService = {
    all: () => statuses,
    snapshot: (repoId: string) => statuses.find((s) => s.repo.id === repoId),
    onStatusChanged: (cb: (snapshot: RepoStatus) => void) => {
      listener = cb;
      return () => {};
    },
    refresh: vi.fn(),
  } as unknown as StatusService;
  const inclusion = { stage: vi.fn(async () => {}) } as unknown as InclusionModel;
  const hunk = { stagePartial: vi.fn(async () => {}) } as unknown as HunkService;
  const service = new ChangelistService(statusService, inclusion, hunk, storage, () => policy);
  const modes: CommitMode[] = [];
  service.onModeChanged((mode) => modes.push(mode));
  return {
    service,
    inclusion,
    hunk,
    modes,
    saved: () => saved,
    backedUp: () => backedUp,
    fire: (snapshot: RepoStatus) => listener?.(snapshot),
  };
}

const R1_STAGED = status('r1', [change('r1', 's.txt', 'modified', true), change('r1', 'u.txt', 'untracked'), change('r1', 'w.txt', 'modified')]);
const R2_STAGED = status('r2', [change('r2', 't.txt', 'modified', true)]);

describe('ChangelistService mode migration', () => {
  it('requires confirmation and backs up before migrating', async () => {
    const { service, backedUp } = setup([R1_STAGED]);
    await expect(service.setMode('staging', false)).rejects.toMatchObject({ code: 'MODE_MIGRATION_REQUIRED' });
    expect(backedUp()).toBeUndefined();
    await service.setMode('changelist', true);
    expect(backedUp()).toBeUndefined();
  });

  it('staging→changelist converts index entries to checked without git operations', async () => {
    const { service, inclusion, modes, backedUp } = setup([R1_STAGED, R2_STAGED]);
    await service.setMode('staging', true);
    await service.setMode('changelist', true);
    const state = service.get();
    expect(state.mode).toBe('changelist');
    const def = state.lists.find((l) => l.id === DEFAULT_LIST_ID)!;
    expect(def.checked).toEqual(
      expect.arrayContaining([
        { repoId: 'r1', path: 's.txt' },
        { repoId: 'r2', path: 't.txt' },
      ]),
    );
    expect(def.checked.some((r) => r.path === 'w.txt' || r.path === 'u.txt')).toBe(false);
    expect(inclusion.stage).not.toHaveBeenCalled();
    expect(backedUp()?.mode).toBe('staging');
    expect(modes).toEqual(['staging', 'changelist']);
  });

  it('changelist→staging stages checked full files, partials and unversioned, then collapses', async () => {
    const { service, inclusion, hunk, modes, backedUp } = setup([R1_STAGED, R2_STAGED]);
    service.setIncluded([{ repoId: 'r1', path: 's.txt' }, { repoId: 'r2', path: 't.txt' }], true);
    const feature = service.create('Feature');
    service.move([{ repoId: 'r1', path: 's.txt' }], feature.id, true);
    service.setPartial('r1', 's.txt', { hunkIds: [0] });
    service.setIncluded([{ repoId: 'r1', path: 'u.txt' }], true);
    const preview = service.previewMigration('staging');
    expect(preview.listsToRemove).toBe(1);
    expect(preview.checkedToStage).toBe(3);
    expect(preview.partialsToStage).toBe(1);
    await service.setMode('staging', true);
    expect(inclusion.stage).toHaveBeenCalledWith('r2', ['t.txt']);
    expect(inclusion.stage).toHaveBeenCalledWith('r1', ['u.txt']);
    expect(hunk.stagePartial).toHaveBeenCalledWith('r1', 's.txt', { hunkIds: [0] });
    expect(backedUp()?.lists).toHaveLength(2);
    const state = service.get();
    expect(state.mode).toBe('staging');
    expect(state.lists).toHaveLength(1);
    expect(state.lists[0]?.files).toHaveLength(0);
    expect(state.unversionedChecked).toHaveLength(0);
    expect(modes).toEqual(['staging']);
  });

  it('move without force surfaces CHANGELIST_CONFLICT with owner context', async () => {
    const { service } = setup([R1_STAGED]);
    await service.setMode('changelist', true);
    const feature = service.create('Feature');
    try {
      service.move([{ repoId: 'r1', path: 's.txt' }], feature.id);
      expect.unreachable('move must throw');
    } catch (err) {
      const pe = err as ProtocolError;
      expect(pe.code).toBe('CHANGELIST_CONFLICT');
      expect(pe.conflictContext?.ownerListId).toBe(DEFAULT_LIST_ID);
    }
    expect(service.moveConflicts([{ repoId: 'r1', path: 's.txt' }], feature.id)).toHaveLength(1);
  });
});

describe('ChangelistService status sync and cleanup', () => {
  it('assigns new changes to the active list on status events and prunes vanished ones', () => {
    const { service, fire } = setup([R1_STAGED], { defaultSelectAll: true, selectUntracked: false });
    const feature = service.create('Feature');
    service.setActive(feature.id);
    fire(status('r1', [...R1_STAGED.changes, change('r1', 'fresh.txt', 'modified')]));
    const active = service.get().lists.find((l) => l.id === feature.id)!;
    expect(active.files.some((f) => f.path === 'fresh.txt')).toBe(true);
    expect(active.checked.some((f) => f.path === 'fresh.txt')).toBe(true);
    fire(status('r1', [change('r1', 'u.txt', 'untracked')]));
    expect(service.get().lists.find((l) => l.id === feature.id)?.files).toHaveLength(0);
  });

  it('setIncluded routes untracked refs to unversionedChecked', () => {
    const { service } = setup([R1_STAGED]);
    service.setIncluded([{ repoId: 'r1', path: 'u.txt' }], true);
    expect(service.get().unversionedChecked).toEqual([{ repoId: 'r1', path: 'u.txt' }]);
    service.setIncluded([{ repoId: 'r1', path: 'u.txt' }], false);
    expect(service.get().unversionedChecked).toHaveLength(0);
  });

  it('removeCommitted drops full paths and unchecks partial remainders', async () => {
    const { service } = setup([R1_STAGED]);
    await service.setMode('changelist', true);
    service.setPartial('r1', 's.txt', { hunkIds: [0] });
    service.removeCommitted('r1', [{ path: 's.txt', selection: { hunkIds: [0] } }]);
    const def = service.get().lists.find((l) => l.id === DEFAULT_LIST_ID)!;
    expect(def.files.some((f) => f.path === 's.txt')).toBe(true);
    expect(def.checked.some((f) => f.path === 's.txt')).toBe(false);
    expect(def.partial['r1:s.txt']).toBeUndefined();
    service.removeCommitted('r2', [{ path: 't.txt' }]);
    expect(service.get().lists.find((l) => l.id === DEFAULT_LIST_ID)?.files.some((f) => f.repoId === 'r2')).toBe(false);
  });

  it('persists state through the storage port', () => {
    const { service, saved } = setup([R1_STAGED]);
    service.create('Persisted');
    service.setIncluded([{ repoId: 'r1', path: 's.txt' }], true);
    service.dispose();
    expect(saved()?.lists.some((l) => l.name === 'Persisted')).toBe(true);
    expect(saved()?.mode).toBe('changelist');
  });
});