import { makeError } from '../protocol/errors';
import type {
  ChangelistDescriptor,
  ChangelistFileRef,
  ChangelistState,
  CommitMode,
  ModeMigrationPreview,
  PartialSelection,
  RepoStatus,
} from '../protocol/models';

export const DEFAULT_LIST_ID = 'default';

/** Fresh project-level changelist state (IDEA workspace.xml semantics). */
export function defaultChangelistState(): ChangelistState {
  return {
    version: 1,
    mode: 'changelist',
    activeId: DEFAULT_LIST_ID,
    lists: [
      {
        id: DEFAULT_LIST_ID,
        name: 'Changes',
        comment: '',
        isDefault: true,
        files: [],
        checked: [],
        partial: {},
      },
    ],
    unversionedChecked: [],
  };
}

export function refKey(ref: ChangelistFileRef): string {
  return `${ref.repoId}:${ref.path}`;
}

function sameRef(a: ChangelistFileRef, b: ChangelistFileRef): boolean {
  return a.repoId === b.repoId && a.path === b.path;
}

function clone(state: ChangelistState): ChangelistState {
  return {
    ...state,
    lists: state.lists.map((l) => ({
      ...l,
      files: [...l.files],
      checked: [...l.checked],
      partial: { ...l.partial },
    })),
    unversionedChecked: [...state.unversionedChecked],
  };
}

export function findList(state: ChangelistState, id: string): ChangelistDescriptor {
  const list = state.lists.find((l) => l.id === id);
  if (!list) {
    throw makeError('GENERIC', `Changelist not found: ${id}`);
  }
  return list;
}

export function findOwner(state: ChangelistState, ref: ChangelistFileRef): ChangelistDescriptor | undefined {
  return state.lists.find((l) => l.files.some((f) => sameRef(f, ref)));
}

function assertUniqueName(state: ChangelistState, name: string, exceptId?: string): void {
  const trimmed = name.trim();
  if (!trimmed) {
    throw makeError('GENERIC', 'Changelist name cannot be empty');
  }
  if (state.lists.some((l) => l.id !== exceptId && l.name === trimmed)) {
    throw makeError('GENERIC', `A changelist named "${trimmed}" already exists`);
  }
}

export function createList(state: ChangelistState, id: string, name: string, comment = ''): { state: ChangelistState; list: ChangelistDescriptor } {
  assertUniqueName(state, name);
  const next = clone(state);
  const list: ChangelistDescriptor = {
    id,
    name: name.trim(),
    comment,
    isDefault: false,
    files: [],
    checked: [],
    partial: {},
  };
  next.lists.push(list);
  return { state: next, list };
}

export function renameList(state: ChangelistState, id: string, name: string): ChangelistState {
  findList(state, id);
  assertUniqueName(state, name, id);
  const next = clone(state);
  findList(next, id).name = name.trim();
  return next;
}

/** Non-default removal moves the list's files into the default list (IDEA behavior). */
export function removeList(state: ChangelistState, id: string): ChangelistState {
  const list = findList(state, id);
  if (list.isDefault) {
    throw makeError('GENERIC', 'The default changelist cannot be deleted');
  }
  const next = clone(state);
  const target = findList(next, DEFAULT_LIST_ID);
  const removed = findList(next, id);
  for (const ref of removed.files) {
    if (!target.files.some((f) => sameRef(f, ref))) {
      target.files.push(ref);
    }
  }
  for (const ref of removed.checked) {
    if (!target.checked.some((f) => sameRef(f, ref))) {
      target.checked.push(ref);
    }
  }
  for (const [key, sel] of Object.entries(removed.partial)) {
    target.partial[key] = sel;
  }
  next.lists = next.lists.filter((l) => l.id !== id);
  if (next.activeId === id) {
    next.activeId = DEFAULT_LIST_ID;
  }
  return next;
}

export function setActive(state: ChangelistState, id: string): ChangelistState {
  findList(state, id);
  return { ...clone(state), activeId: id };
}

export function setComment(state: ChangelistState, id: string, comment: string): ChangelistState {
  findList(state, id);
  const next = clone(state);
  findList(next, id).comment = comment;
  return next;
}

export interface MoveConflict {
  ref: ChangelistFileRef;
  owner: ChangelistDescriptor;
}

/** Refs that already belong to a different list (IDEA asks before moving them). */
export function findMoveConflicts(state: ChangelistState, refs: ChangelistFileRef[], targetId: string): MoveConflict[] {
  const conflicts: MoveConflict[] = [];
  for (const ref of refs) {
    const owner = findOwner(state, ref);
    if (owner && owner.id !== targetId) {
      conflicts.push({ ref, owner });
    }
  }
  return conflicts;
}

export function moveFiles(state: ChangelistState, refs: ChangelistFileRef[], targetId: string, force = false): ChangelistState {
  const target = findList(state, targetId);
  const conflicts = findMoveConflicts(state, refs, targetId);
  if (conflicts.length > 0 && !force) {
    const first = conflicts[0] as MoveConflict;
    const error = makeError(
      'CHANGELIST_CONFLICT',
      `File is already in changelist "${first.owner.name}". Move it to "${target.name}"?`,
    );
    error.conflictContext = {
      repoId: first.ref.repoId,
      path: first.ref.path,
      ownerListId: first.owner.id,
      ownerListName: first.owner.name,
    };
    throw error;
  }
  const next = clone(state);
  const dest = findList(next, targetId);
  for (const ref of refs) {
    for (const list of next.lists) {
      if (list.id === targetId) {
        continue;
      }
      const wasChecked = list.checked.some((f) => sameRef(f, ref));
      list.files = list.files.filter((f) => !sameRef(f, ref));
      list.checked = list.checked.filter((f) => !sameRef(f, ref));
      delete list.partial[refKey(ref)];
      if (wasChecked && !dest.checked.some((f) => sameRef(f, ref))) {
        dest.checked.push(ref);
      }
    }
    if (!dest.files.some((f) => sameRef(f, ref))) {
      dest.files.push(ref);
    }
  }
  return next;
}

/** Toggle inclusion for list-owned refs. Untracked refs are handled via unversionedChecked. */
export function setIncluded(state: ChangelistState, refs: ChangelistFileRef[], included: boolean): ChangelistState {
  const next = clone(state);
  // index ownership + checked keys once: per-ref scans of files/checked are
  // O(refs × files) and freeze the host on select-all in large repos
  const ownerByKey = new Map<string, (typeof next.lists)[number]>();
  const checkedKeys = new Map<string, Set<string>>();
  for (const list of next.lists) {
    checkedKeys.set(list.id, new Set(list.checked.map(refKey)));
    for (const f of list.files) {
      ownerByKey.set(refKey(f), list);
    }
  }
  const removedByList = new Map<string, Set<string>>();
  for (const ref of refs) {
    const key = refKey(ref);
    const owner = ownerByKey.get(key);
    if (!owner) {
      continue;
    }
    const keys = checkedKeys.get(owner.id) as Set<string>;
    if (included && !keys.has(key)) {
      keys.add(key);
      owner.checked.push(ref);
    } else if (!included && keys.has(key)) {
      keys.delete(key);
      let removed = removedByList.get(owner.id);
      if (!removed) {
        removed = new Set();
        removedByList.set(owner.id, removed);
      }
      removed.add(key);
      delete owner.partial[key];
    }
  }
  for (const list of next.lists) {
    const removed = removedByList.get(list.id);
    if (removed) {
      list.checked = list.checked.filter((f) => !removed.has(refKey(f)));
    }
  }
  return next;
}

export function setUnversionedChecked(state: ChangelistState, refs: ChangelistFileRef[], included: boolean): ChangelistState {
  const next = clone(state);
  for (const ref of refs) {
    const has = next.unversionedChecked.some((f) => sameRef(f, ref));
    if (included && !has) {
      next.unversionedChecked.push(ref);
    } else if (!included && has) {
      next.unversionedChecked = next.unversionedChecked.filter((f) => !sameRef(f, ref));
    }
  }
  return next;
}

export function setPartial(state: ChangelistState, repoId: string, path: string, selection: PartialSelection | null): ChangelistState {
  const ref = { repoId, path };
  const owner = findOwner(state, ref);
  if (!owner) {
    throw makeError('GENERIC', `File is not in any changelist: ${path}`);
  }
  const next = clone(state);
  const list = findList(next, owner.id);
  const key = refKey(ref);
  if (selection) {
    list.partial[key] = selection;
    if (!list.checked.some((f) => sameRef(f, ref))) {
      list.checked.push(ref);
    }
  } else {
    delete list.partial[key];
  }
  return next;
}

export interface SyncPolicy {
  defaultSelectAll: boolean;
  selectUntracked: boolean;
}

/**
 * Reconcile lists with fresh statuses: prune vanished/conflicted paths,
 * assign new tracked changes to the active list, auto-check per policy.
 * Only repos present in `statuses` are pruned (a closed repo keeps its refs).
 */
export function syncWithStatus(state: ChangelistState, statuses: RepoStatus[], policy: SyncPolicy): { state: ChangelistState; changed: boolean } {
  const byRepo = new Map<string, Map<string, { kind: string; conflicted: boolean }>>();
  for (const status of statuses) {
    const map = new Map<string, { kind: string; conflicted: boolean }>();
    for (const change of status.changes) {
      map.set(change.path, { kind: change.kind, conflicted: change.conflicted });
    }
    byRepo.set(status.repo.id, map);
  }
  const next = clone(state);
  let changed = false;
  const owned = new Set<string>();
  for (const list of next.lists) {
    const keep = list.files.filter((ref) => {
      const repo = byRepo.get(ref.repoId);
      if (!repo) {
        return true;
      }
      const info = repo.get(ref.path);
      return info !== undefined && info.kind !== 'untracked' && !info.conflicted;
    });
    if (keep.length !== list.files.length) {
      changed = true;
    }
    const keepKeys = new Set(keep.map(refKey));
    list.files = keep;
    const checked = list.checked.filter((ref) => keepKeys.has(refKey(ref)));
    if (checked.length !== list.checked.length) {
      changed = true;
    }
    list.checked = checked;
    for (const key of Object.keys(list.partial)) {
      if (!keepKeys.has(key)) {
        delete list.partial[key];
        changed = true;
      }
    }
    for (const ref of keep) {
      owned.add(refKey(ref));
    }
  }
  const active = findList(next, next.activeId);
  const unversionedPresent = new Set<string>();
  for (const status of statuses) {
    for (const change of status.changes) {
      const ref = { repoId: status.repo.id, path: change.path };
      if (change.kind === 'untracked') {
        unversionedPresent.add(refKey(ref));
        continue;
      }
      if (change.conflicted || owned.has(refKey(ref))) {
        continue;
      }
      active.files.push(ref);
      owned.add(refKey(ref));
      if (policy.defaultSelectAll) {
        active.checked.push(ref);
      }
      changed = true;
    }
  }
  const knownRepos = new Set(statuses.map((s) => s.repo.id));
  const uvChecked = next.unversionedChecked.filter((ref) => !knownRepos.has(ref.repoId) || unversionedPresent.has(refKey(ref)));
  if (uvChecked.length !== next.unversionedChecked.length) {
    changed = true;
  }
  next.unversionedChecked = uvChecked;
  if (policy.selectUntracked) {
    for (const key of unversionedPresent) {
      if (!next.unversionedChecked.some((ref) => refKey(ref) === key)) {
        const [repoId, ...rest] = key.split(':');
        next.unversionedChecked.push({ repoId: repoId as string, path: rest.join(':') });
        changed = true;
      }
    }
  }
  return { state: next, changed };
}

export function previewMigration(state: ChangelistState, target: CommitMode, statuses: RepoStatus[]): ModeMigrationPreview {
  if (target === 'staging') {
    return {
      mode: target,
      listsToRemove: state.lists.filter((l) => !l.isDefault).length,
      checkedToStage: state.lists.reduce((n, l) => n + l.checked.length, 0) + state.unversionedChecked.length,
      partialsToStage: state.lists.reduce((n, l) => n + Object.keys(l.partial).length, 0),
      indexEntriesToChecked: 0,
    };
  }
  let staged = 0;
  for (const status of statuses) {
    staged += status.changes.filter((c) => c.staged && !c.conflicted && c.kind !== 'untracked').length;
  }
  return { mode: target, listsToRemove: 0, checkedToStage: 0, partialsToStage: 0, indexEntriesToChecked: staged };
}

/** After changelist→staging migration: changelist UI hidden, single empty default list. */
export function collapseToStaging(): ChangelistState {
  const next = defaultChangelistState();
  next.mode = 'staging';
  return next;
}

/** After staging→changelist migration: current index entries become checked in the default list. */
export function indexToChecked(state: ChangelistState, statuses: RepoStatus[]): ChangelistState {
  const next = clone(state);
  next.mode = 'changelist';
  const def = findList(next, DEFAULT_LIST_ID);
  for (const status of statuses) {
    for (const change of status.changes) {
      if (!change.staged || change.conflicted || change.kind === 'untracked') {
        continue;
      }
      const ref = { repoId: status.repo.id, path: change.path };
      if (!def.files.some((f) => sameRef(f, ref))) {
        def.files.push(ref);
      }
      if (!def.checked.some((f) => sameRef(f, ref))) {
        def.checked.push(ref);
      }
    }
  }
  return next;
}

/** Post-commit cleanup: committed paths leave the lists; partial files keep the remainder, unchecked. */
export function removeCommitted(state: ChangelistState, repoId: string, entries: { path: string; partial?: boolean }[]): ChangelistState {
  const next = clone(state);
  for (const entry of entries) {
    const ref = { repoId, path: entry.path };
    const key = refKey(ref);
    for (const list of next.lists) {
      if (entry.partial) {
        delete list.partial[key];
        list.checked = list.checked.filter((f) => !sameRef(f, ref));
      } else {
        list.files = list.files.filter((f) => !sameRef(f, ref));
        list.checked = list.checked.filter((f) => !sameRef(f, ref));
        delete list.partial[key];
      }
    }
    if (!entry.partial) {
      next.unversionedChecked = next.unversionedChecked.filter((f) => !sameRef(f, ref));
    }
  }
  return next;
}