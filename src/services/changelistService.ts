import { randomUUID } from 'node:crypto';
import {
  collapseToStaging,
  createList,
  defaultChangelistState,
  findMoveConflicts,
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
} from '../core/changelistModel';
import type { SyncPolicy } from '../core/changelistModel';
import type { IncludedEntry } from '../core/commitTranslator';
import { Emitter } from '../core/events';
import type { InclusionModel } from '../core/inclusionModel';
import type { StatusService } from '../core/statusService';
import { makeError } from '../protocol/errors';
import type { ChangelistDescriptor, ChangelistFileRef, ChangelistState, CommitMode, ModeMigrationPreview, PartialSelection } from '../protocol/models';
import type { HunkService } from './hunkService';

export interface ChangelistStorage {
  load(): ChangelistState | undefined;
  save(state: ChangelistState): Promise<void>;
  backup(state: ChangelistState): Promise<void>;
}

const CHUNK = 500;
const SAVE_DEBOUNCE_MS = 250;

/** Project-level changelist state (IDEA workspace.xml semantics), synced with live statuses. */
export class ChangelistService {
  private state: ChangelistState;
  private saveTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly changed = new Emitter<ChangelistState>();
  private readonly modeChanged = new Emitter<CommitMode>();
  private readonly unsubs: (() => void)[] = [];

  readonly onChanged = this.changed.event;
  readonly onModeChanged = this.modeChanged.event;

  constructor(
    private readonly status: StatusService,
    private readonly inclusion: InclusionModel,
    private readonly hunk: HunkService,
    private readonly storage: ChangelistStorage,
    private readonly policy: () => SyncPolicy,
  ) {
    this.state = storage.load() ?? defaultChangelistState();
    const initial = syncWithStatus(this.state, status.all(), policy());
    this.state = initial.state;
    this.unsubs.push(
      status.onStatusChanged((snapshot) => {
        const result = syncWithStatus(this.state, [snapshot], this.policy());
        if (result.changed) {
          this.state = result.state;
          this.changed.fire(this.state);
          this.scheduleSave();
        }
      }),
    );
  }

  get(): ChangelistState {
    return this.state;
  }

  create(name: string, comment = ''): ChangelistDescriptor {
    const result = createList(this.state, randomUUID(), name, comment);
    this.commitState(result.state);
    return result.list;
  }

  rename(id: string, name: string): void {
    this.commitState(renameList(this.state, id, name));
  }

  remove(id: string): void {
    this.commitState(removeList(this.state, id));
  }

  setActive(id: string): void {
    this.commitState(setActive(this.state, id));
  }

  setComment(id: string, comment: string): void {
    this.commitState(setComment(this.state, id, comment));
  }

  move(refs: ChangelistFileRef[], targetId: string, force = false): void {
    this.commitState(moveFiles(this.state, refs, targetId, force));
  }

  moveConflicts(refs: ChangelistFileRef[], targetId: string) {
    return findMoveConflicts(this.state, refs, targetId);
  }

  setIncluded(refs: ChangelistFileRef[], included: boolean): void {
    const untracked: ChangelistFileRef[] = [];
    const tracked: ChangelistFileRef[] = [];
    // one snapshot + path lookup per repo: snapshot() remaps the full status,
    // so calling it per ref is O(refs × changes) and blocks the host on big repos
    const kindByRepo = new Map<string, Map<string, string>>();
    for (const ref of refs) {
      let kinds = kindByRepo.get(ref.repoId);
      if (!kinds) {
        kinds = new Map();
        const snapshot = this.status.snapshot(ref.repoId);
        for (const change of snapshot?.changes ?? []) {
          kinds.set(change.path, change.kind);
        }
        kindByRepo.set(ref.repoId, kinds);
      }
      if (kinds.get(ref.path) === 'untracked') {
        untracked.push(ref);
      } else {
        tracked.push(ref);
      }
    }
    let next = this.state;
    if (tracked.length > 0) {
      next = setIncluded(next, tracked, included);
    }
    if (untracked.length > 0) {
      next = setUnversionedChecked(next, untracked, included);
    }
    this.commitState(next);
  }

  setPartial(repoId: string, path: string, selection: PartialSelection | null): void {
    this.commitState(setPartial(this.state, repoId, path, selection));
  }

  previewMigration(mode: CommitMode): ModeMigrationPreview {
    return previewMigration(this.state, mode, this.status.all());
  }

  async setMode(mode: CommitMode, confirm: boolean): Promise<void> {
    if (mode === this.state.mode) {
      return;
    }
    if (!confirm) {
      throw makeError('MODE_MIGRATION_REQUIRED', 'Switching the commit mode requires confirmation');
    }
    const statuses = this.status.all();
    await this.storage.backup(this.state);
    if (mode === 'staging') {
      for (const list of this.state.lists) {
        const byRepo = new Map<string, string[]>();
        for (const ref of list.checked) {
          if (list.partial[refKey(ref)]) {
            continue;
          }
          const paths = byRepo.get(ref.repoId) ?? [];
          paths.push(ref.path);
          byRepo.set(ref.repoId, paths);
        }
        for (const [repoId, paths] of byRepo) {
          for (let i = 0; i < paths.length; i += CHUNK) {
            await this.inclusion.stage(repoId, paths.slice(i, i + CHUNK));
          }
        }
        for (const [key, selection] of Object.entries(list.partial)) {
          const sep = key.indexOf(':');
          await this.hunk.stagePartial(key.slice(0, sep), key.slice(sep + 1), selection);
        }
      }
      const unversioned = new Map<string, string[]>();
      for (const ref of this.state.unversionedChecked) {
        const paths = unversioned.get(ref.repoId) ?? [];
        paths.push(ref.path);
        unversioned.set(ref.repoId, paths);
      }
      for (const [repoId, paths] of unversioned) {
        for (let i = 0; i < paths.length; i += CHUNK) {
          await this.inclusion.stage(repoId, paths.slice(i, i + CHUNK));
        }
      }
      this.state = collapseToStaging();
    } else {
      this.state = indexToChecked(this.state, statuses);
    }
    await this.persistNow();
    this.changed.fire(this.state);
    this.modeChanged.fire(mode);
    this.status.refresh();
  }

  /** Post-commit: committed paths leave the lists; partial files keep the remainder, unchecked. */
  removeCommitted(repoId: string, entries: IncludedEntry[]): void {
    if (entries.length === 0) {
      return;
    }
    this.state = removeCommitted(
      this.state,
      repoId,
      entries.map((e) => ({ path: e.path, partial: e.selection !== undefined })),
    );
    void this.persistNow();
    this.changed.fire(this.state);
  }

  private commitState(next: ChangelistState): void {
    this.state = next;
    this.changed.fire(next);
    this.scheduleSave();
  }

  private scheduleSave(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
    }
    this.saveTimer = setTimeout(() => {
      this.saveTimer = undefined;
      void this.storage.save(this.state).catch(() => {});
    }, SAVE_DEBOUNCE_MS);
  }

  private async persistNow(): Promise<void> {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = undefined;
    }
    await this.storage.save(this.state);
  }

  dispose(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = undefined;
      void this.storage.save(this.state).catch(() => {});
    }
    for (const unsub of this.unsubs) {
      unsub();
    }
    this.changed.dispose();
    this.modeChanged.dispose();
  }
}