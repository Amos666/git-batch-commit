export type ChangeKind =
  | 'modified'
  | 'added'
  | 'deleted'
  | 'renamed'
  | 'copied'
  | 'untracked'
  | 'conflicted';

export type StatusLetter = 'M' | 'A' | 'D' | 'R' | 'C' | 'T' | 'U' | '?' | '!';

export interface RepoDescriptor {
  id: string;
  rootUri: string;
  rootPath: string;
  name: string;
  kind: 'repository' | 'submodule' | 'worktree';
}

export interface FileChange {
  repoId: string;
  /** repo-relative posix path */
  path: string;
  uri: string;
  origPath?: string;
  indexStatus: StatusLetter | null;
  worktreeStatus: StatusLetter | null;
  kind: ChangeKind;
  staged: boolean;
  conflicted: boolean;
}

export interface BranchInfo {
  name?: string;
  detached: boolean;
  oid?: string;
  upstream?: string;
  ahead?: number;
  behind?: number;
}

export interface RepoStatus {
  repo: RepoDescriptor;
  branch: BranchInfo;
  changes: FileChange[];
  seq: number;
}

export interface CommitRequest {
  repoIds: string[];
  message: string;
  amend?: boolean;
  signoff?: boolean;
  noVerify?: boolean;
  pushAfter?: boolean;
  /** repo-relative paths expected to be staged; validated before commit */
  expectedStaged?: Record<string, string[]>;
}

export interface CommitResult {
  repoId: string;
  ok: boolean;
  commitOid?: string;
  branch?: string;
  skipped?: 'cancelled' | 'stopped-after-error';
  error?: import('./errors').ProtocolError;
  durationMs: number;
}

export type OperationPhase = 'idle' | 'validating' | 'committing' | 'pushing' | 'done' | 'failed' | 'cancelled';

export interface OperationState {
  id: string;
  repoId: string;
  kind: 'commit' | 'commitAndPush' | 'stage' | 'unstage' | 'checkout' | 'pull' | 'push';
  phase: OperationPhase;
  startedAt: number;
  message?: string;
}

export type PanelState = 'ready' | 'git-extension-unavailable' | 'initializing';