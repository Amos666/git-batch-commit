import * as path from 'node:path';
import { Status } from './gitApiTypes';
import type { Branch, Change } from './gitApiTypes';
import type { BranchInfo, ChangeKind, FileChange, RepoDescriptor, RepoStatus, StatusLetter } from '../protocol/models';

export interface StateMapperInput {
  descriptor: RepoDescriptor;
  head: Branch | undefined;
  mergeChanges: Change[];
  indexChanges: Change[];
  workingTreeChanges: Change[];
  untrackedChanges: Change[];
}

const INDEX_LETTERS = new Map<Status, StatusLetter>([
  [Status.INDEX_MODIFIED, 'M'],
  [Status.INDEX_ADDED, 'A'],
  [Status.INDEX_DELETED, 'D'],
  [Status.INDEX_RENAMED, 'R'],
  [Status.INDEX_COPIED, 'C'],
]);

const WORKTREE_LETTERS = new Map<Status, StatusLetter>([
  [Status.MODIFIED, 'M'],
  [Status.DELETED, 'D'],
  [Status.UNTRACKED, '?'],
  [Status.IGNORED, '!'],
  [Status.INTENT_TO_ADD, 'A'],
  [Status.INTENT_TO_RENAME, 'R'],
  [Status.TYPE_CHANGED, 'T'],
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

function relativePath(rootPath: string, fsPath: string): string {
  const rel = path.relative(rootPath, fsPath);
  return rel.split(path.sep).join('/');
}

export function mapBranch(head: Branch | undefined): BranchInfo {
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
  const rootPath = descriptor.rootPath;
  const byPath = new Map<string, FileChange>();

  const ensure = (fsPath: string): FileChange => {
    const p = relativePath(rootPath, fsPath);
    let entry = byPath.get(p);
    if (!entry) {
      entry = {
        repoId: descriptor.id,
        path: p,
        uri: '',
        indexStatus: null,
        worktreeStatus: null,
        kind: 'modified',
        staged: false,
        conflicted: false,
      };
      byPath.set(p, entry);
    }
    return entry;
  };

  for (const change of input.mergeChanges) {
    const entry = ensure(change.uri.fsPath);
    entry.uri = change.uri.toString();
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
    const entry = ensure(change.uri.fsPath);
    entry.uri = change.uri.toString();
    if (!entry.conflicted) {
      entry.indexStatus = letter;
      entry.staged = true;
      entry.kind = kindFromLetter(letter);
    }
    if ((letter === 'R' || letter === 'C') && change.originalUri) {
      entry.origPath = relativePath(rootPath, change.originalUri.fsPath);
    }
  }

  for (const change of input.workingTreeChanges) {
    const letter = WORKTREE_LETTERS.get(change.status);
    if (!letter || letter === '!') {
      continue;
    }
    const entry = ensure(change.uri.fsPath);
    entry.uri = change.uri.toString();
    if (!entry.conflicted) {
      entry.worktreeStatus = letter;
      if (!entry.staged) {
        entry.kind = kindFromLetter(letter);
      }
    }
    if ((letter === 'R') && change.originalUri) {
      entry.origPath = relativePath(rootPath, change.originalUri.fsPath);
    }
  }

  for (const change of input.untrackedChanges) {
    const entry = ensure(change.uri.fsPath);
    entry.uri = change.uri.toString();
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