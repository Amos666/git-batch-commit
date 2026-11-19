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
  /** changelist translation touched the index before a failure: UI shows "review Staged" banner */
  indexModified?: boolean;
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

export type PanelState = 'ready' | 'initializing' | 'backend-unavailable';

export type UnavailableReason = 'extension-disabled' | 'git-not-found' | 'init-timeout';

/** Feature flags of the active git kernel; UI renders availability from these, never from kernel identity. */
export interface KernelCapabilities {
  stagedDiff: boolean;
  hashObject: boolean;
  stash: boolean;
  log: boolean;
  rootCommitStats: boolean;
  commitAuthor: boolean;
  commitCleanup: boolean;
}

export type CheckId =
  | 'reformat'
  | 'optimizeImports'
  | 'rearrange'
  | 'cleanup'
  | 'copyright'
  | 'dependencies'
  | 'analyze'
  | 'todo'
  | 'runConfiguration'
  | 'afterCommitUpload';

export type CheckStatus = 'ok' | 'issues' | 'unavailable' | 'skipped';

export interface CheckResult {
  id: CheckId;
  status: CheckStatus;
  details?: string;
}

export interface CheckReport {
  results: CheckResult[];
}

export interface CheckAvailability {
  id: CheckId;
  available: boolean;
  limited?: boolean;
}

/** Hunk ids plus optional per-hunk included line offsets (0-based within hunk new-side lines). */
export interface PartialSelection {
  hunkIds: number[];
  lines?: Record<number, number[]>;
}

export interface ChangelistFileRef {
  repoId: string;
  path: string;
}

export interface ChangelistDescriptor {
  id: string;
  name: string;
  comment: string;
  isDefault: boolean;
  files: ChangelistFileRef[];
  checked: ChangelistFileRef[];
  /** keyed `${repoId}:${path}` */
  partial: Record<string, PartialSelection>;
}

export type CommitMode = 'changelist' | 'staging';

export interface ChangelistState {
  version: 1;
  mode: CommitMode;
  activeId: string;
  lists: ChangelistDescriptor[];
  unversionedChecked: ChangelistFileRef[];
}

export interface ModeMigrationPreview {
  mode: CommitMode;
  listsToRemove: number;
  checkedToStage: number;
  partialsToStage: number;
  indexEntriesToChecked: number;
}

export interface CommitAuthor {
  name: string;
  email: string;
}

export interface CommitOptionsV2 {
  amend?: boolean;
  signoff?: boolean;
  noVerify?: boolean;
  author?: CommitAuthor;
}

export interface PushTarget {
  remote: string;
  branch: string;
}

export interface PushRunRequest {
  repoIds: string[];
  /** explicit targets for roots without upstream (remote chosen in the Push dialog) */
  targets?: Record<string, PushTarget>;
  tags?: boolean;
  /** force-with-lease */
  force?: boolean;
}

export interface PushRunResult {
  repoId: string;
  ok: boolean;
  skipped?: 'cancelled';
  error?: import('./errors').ProtocolError;
}

export interface PushPreviewCommit {
  hash: string;
  message: string;
  authorName?: string;
  /** epoch ms */
  authorDate?: number;
}

export interface PushPreviewEntry {
  repoId: string;
  branch?: string;
  upstream?: string;
  ahead?: number;
  remotes: string[];
  commits: PushPreviewCommit[];
  hasMore: boolean;
  /** kernel lacks log capability */
  previewUnavailable?: boolean;
}

export interface CommitRequestV2 {
  repoIds: string[];
  message: string;
  options: CommitOptionsV2;
  /** changelist mode: included set snapshot for race validation */
  expectedIncluded?: Record<string, { path: string; selection?: PartialSelection }[]>;
  /** staging mode legacy: expected index set */
  expectedStaged?: Record<string, string[]>;
}

export interface CommitOptionsState {
  author?: CommitAuthor;
  signoff: boolean;
  runHooks: boolean;
  checks: Partial<Record<CheckId, boolean>>;
  runAfterCommit: boolean;
}