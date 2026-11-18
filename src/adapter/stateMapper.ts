import { KernelStatus } from '../kernel/types';
import type { KernelBranch, KernelChange } from '../kernel/types';
import type { BranchInfo, ChangeKind, FileChange, RepoDescriptor, RepoStatus, StatusLetter } from '../protocol/models';

export interface StateMapperInput {
  descriptor: RepoDescriptor;
  head: KernelBranch | undefined;
  mergeChanges: KernelChange[];
  indexChanges: KernelChange[];
  workingTreeChanges: KernelChange[];
  untrackedChanges: KernelChange[];
}

const INDEX_LETTERS = new Map<KernelStatus, StatusLetter>([
  [KernelStatus.INDEX_MODIFIED, 'M'],
  [KernelStatus.INDEX_ADDED, 'A'],
  [KernelStatus.INDEX_DELETED, 'D'],
  [KernelStatus.INDEX_RENAMED, 'R'],
  [KernelStatus.INDEX_COPIED, 'C'],
]);

const WORKTREE_LETTERS = new Map<KernelStatus, StatusLetter>([
  [KernelStatus.MODIFIED, 'M'],
  [KernelStatus.DELETED, 'D'],
  [KernelStatus.UNTRACKED, '?'],
  [KernelStatus.IGNORED, '!'],
  [KernelStatus.INTENT_TO_ADD, 'A'],
  [KernelStatus.INTENT_TO_RENAME, 'R'],
  [KernelStatus.TYPE_CHANGED, 'T'],
]);

function kindFromLetter(letter: StatusLetter): ChangeKind {
  switch (letter) {
    case 'A': return 'added';
    case 'D': return 'deleted';
    case 'R': return 'renamed';
    case 'C': return 'copied';
    case '?': return 'untracked';
    case 'U': return 'conflicted';
    default: return 'modified';
  }
}

export function mapBranch(head: KernelBranch | undefined): BranchInfo {
  if (!head) {
    return { detached: false };
  }
  return {
    name: head.name,
    detached: head.name === undefined && head.commit !== undefined,
    oid: head.commit,
    upstream: head.upstream ? `${head.upstream.remote}/${head.upstream.name}` : undefined,
    ahead: head.ahead,
    behind: head.behind,
  };
}

export function mapRepoStatus(input: StateMapperInput, seq: number): RepoStatus {
  const { descriptor } = input;
  const byPath = new Map<string, FileChange>();

  const ensure = (change: KernelChange): FileChange => {
    let entry = byPath.get(change.path);
    if (!entry) {
      entry = {
        repoId: descriptor.id,
        path: change.path,
        uri: change.uri,
        indexStatus: null,
        worktreeStatus: null,
        kind: 'modified',
        staged: false,
        conflicted: false,
      };
      byPath.set(change.path, entry);
    }
    return entry;
  };

  for (const change of input.mergeChanges) {
    const entry = ensure(change);
    entry.uri = change.uri;
    entry.conflicted = true;
    entry.kind = 'conflicted';
    entry.indexStatus = 'U';
    entry.worktreeStatus = 'U';
  }

  for (const change of input.indexChanges) {
    const letter = INDEX_LETTERS.get(change.status);
    if (!letter) {
      continue;
    }
    const entry = ensure(change);
    entry.uri = change.uri;
    if (!entry.conflicted) {
      entry.indexStatus = letter;
      entry.staged = true;
      entry.kind = kindFromLetter(letter);
    }
    if ((letter === 'R' || letter === 'C') && change.origPath) {
      entry.origPath = change.origPath;
    }
  }

  for (const change of input.workingTreeChanges) {
    const letter = WORKTREE_LETTERS.get(change.status);
    if (!letter || letter === '!') {
      continue;
    }
    const entry = ensure(change);
    entry.uri = change.uri;
    if (!entry.conflicted) {
      entry.worktreeStatus = letter;
      if (!entry.staged) {
        entry.kind = kindFromLetter(letter);
      }
    }
    if (letter === 'R' && change.origPath) {
      entry.origPath = change.origPath;
    }
  }

  for (const change of input.untrackedChanges) {
    const entry = ensure(change);
    entry.uri = change.uri;
    entry.worktreeStatus = '?';
    if (!entry.conflicted && !entry.staged) {
      entry.kind = 'untracked';
    }
  }

  return {
    repo: descriptor,
    branch: mapBranch(input.head),
    changes: [...byPath.values()].sort((a, b) => a.path.localeCompare(b.path)),
    seq,
  };
}