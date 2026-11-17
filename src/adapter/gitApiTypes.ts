/**
 * Minimal type contract for the built-in Git extension public API
 * (`vscode.extensions.getExtension('vscode.git').exports.getAPI(1)`).
 * Self-written subset of the documented API surface; only what this
 * extension consumes. Values of `Status` follow the built-in enum.
 */
import type { Event, Uri } from 'vscode';

export type APIState = 'uninitialized' | 'initialized';

export enum Status {
  INDEX_MODIFIED = 0,
  INDEX_ADDED = 1,
  INDEX_DELETED = 2,
  INDEX_RENAMED = 3,
  INDEX_COPIED = 4,
  MODIFIED = 5,
  DELETED = 6,
  UNTRACKED = 7,
  IGNORED = 8,
  INTENT_TO_ADD = 9,
  INTENT_TO_RENAME = 10,
  TYPE_CHANGED = 11,
  ADDED_BY_US = 12,
  ADDED_BY_THEM = 13,
  DELETED_BY_US = 14,
  DELETED_BY_THEM = 15,
  BOTH_ADDED = 16,
  BOTH_DELETED = 17,
  BOTH_MODIFIED = 18,
}

export interface Change {
  uri: Uri;
  originalUri: Uri;
  renameUri: Uri | undefined;
  status: Status;
}

export interface Branch {
  name?: string;
  commit?: string;
  upstream?: { name: string; remote: string };
  ahead?: number;
  behind?: number;
}

export interface Ref {
  /** 实测为数字枚举 RefType：Head=0, RemoteHead=1, Tag=2；字符串形式仅旧 mock 使用 */
  type: number | 'head' | 'remote' | 'tag';
  name?: string;
  commit?: string;
  remote?: string;
}

export interface Remote {
  name: string;
  fetchUrl?: string;
  pushUrl?: string;
  isReadOnly: boolean;
}

export interface DiffBetweenFile {
  uri: Uri;
  originalUri?: Uri;
  renameUri?: Uri;
  status?: number;
}

export interface Submodule {
  name: string;
  path: string;
  url: string;
}

export interface Worktree {
  name: string;
  path: string;
  ref: string;
  main: boolean;
}

export interface LogOptions {
  range?: string;
  maxEntries?: number;
  skip?: number;
  author?: string;
  grep?: string;
  shortStats?: boolean;
  reverse?: boolean;
  sortByAuthorDate?: boolean;
  maxParents?: number;
}

export interface LogCommit {
  hash: string;
  message: string;
  parents: string[];
  authorName?: string;
  authorEmail?: string;
  authorDate?: Date;
  commitDate?: Date;
  shortStats?: { files: number; insertions: number; deletions: number };
}

export interface Stash {
  hash: string;
  parents: string[];
  index: number;
  branchName: string;
  description: string;
  authorDate?: Date;
  commitDate?: Date;
}

export interface RepositoryState {
  HEAD: Branch | undefined;
  refs: Ref[];
  remotes: Remote[];
  submodules: Submodule[];
  worktrees: Worktree[];
  mergeChanges: Change[];
  indexChanges: Change[];
  workingTreeChanges: Change[];
  untrackedChanges: Change[];
  rebaseCommit?: { hash: string };
  onDidChange: Event<void>;
}

export interface CommitOptions {
  all?: boolean | 'tracked';
  amend?: boolean;
  signoff?: boolean;
  signCommit?: boolean;
  noVerify?: boolean;
  empty?: boolean;
  postCommitCommand?: string | null;
}

export enum ForcePushMode {
  Force = 0,
  ForceWithLease = 1,
}

export type RepositoryKind = 'repository' | 'submodule' | 'worktree';

export interface Repository {
  readonly rootUri: Uri;
  readonly kind: RepositoryKind;
  readonly state: RepositoryState;
  add(paths: string[]): Promise<void>;
  restore(paths: string[], options?: { staged?: boolean; ref?: string }): Promise<void>;
  commit(message: string, opts?: CommitOptions): Promise<void>;
  push(remote?: string, ref?: string, setUpstream?: boolean, force?: ForcePushMode): Promise<void>;
  checkout(treeish: string): Promise<void>;
  getBranches(query?: { remote?: boolean; sort?: string }): Promise<Ref[]>;
  createBranch(name: string, checkout?: boolean, ref?: string): Promise<void>;
  deleteBranch(name: string, force?: boolean): Promise<void>;
  diff(cached?: boolean): Promise<string>;
  /** With a path: patch of `git diff <ref> -- <path>` (ref '' = index → worktree). */
  diffWithHEAD(path?: string): Promise<string>;
  diffWith(ref: string | undefined, path?: string): Promise<string>;
  /** CAUTION: upstream runs `git diff --cached <ref> -- <path>` — NOT index→worktree. */
  diffIndexWith(ref?: string, path?: string): Promise<string>;
  /** Patch of `git diff --cached [-- path]` (HEAD → index). */
  diffIndexWithHEAD?(path?: string): Promise<string>;
  /**
   * Older API versions return a patch string; newer stable builds return
   * parsed name-status entries (and use a three-dot range internally).
   */
  diffBetween(ref1: string, ref2: string): Promise<string | DiffBetweenFile[]>;
  /** Present in newer builds: patch text of `git diff <ref1>...<ref2> [-- path]`. */
  diffBetweenPatch?(ref1: string, ref2: string, path?: string): Promise<string>;
  /** Present in newer builds; with the empty-tree oid it uses diff-tree (root-commit safe). */
  diffBetweenWithStats?(ref1: string, ref2: string, path?: string): Promise<DiffBetweenFile[]>;
  /** Present in newer builds: takes a raw range string (e.g. `a..b` or `<oid>^!`). */
  diffBetweenWithStats2?(range: string, path?: string): Promise<DiffBetweenFile[]>;
  buffer(ref: string, path: string): Promise<Buffer>;
  show(ref: string, path: string): Promise<string>;
  getCommit(ref: string): Promise<{ hash: string; message: string; parents: string[]; authorName?: string; authorEmail?: string; authorDate?: Date }>;
  // ---- P1 surface (feature-detect at runtime; absent on older builds) ----
  /** Local config value; '' when unset. */
  getConfig?(key: string): Promise<string>;
  getGlobalConfig?(key: string): Promise<string>;
  /** `hash-object -w --stdin`; returns the new blob oid. */
  hashObject?(content: Buffer): Promise<string>;
  log?(options?: LogOptions, cancellationToken?: unknown): Promise<LogCommit[]>;
  createStash?(options?: { message?: string; includeUntracked?: boolean; staged?: boolean }): Promise<void>;
  getStashes?(): Promise<Stash[]>;
  popStash?(index?: number): Promise<void>;
  applyStash?(index?: number): Promise<void>;
  /** WARNING: omitting index runs `stash clear` upstream — always pass an index. */
  dropStash?(index?: number): Promise<void>;
  merge?(ref: string): Promise<void>;
  mergeAbort?(): Promise<void>;
  rebase?(ref: string, options?: { rebaseMerges?: boolean; onto?: string }): Promise<void>;
  rebaseAbort?(): Promise<void>;
  rebaseContinue?(): Promise<void>;
  getBranchBase?(name: string): Promise<Ref | undefined>;
  getMergeBase?(ref1: string, ref2: string): Promise<string | undefined>;
  pull?(rebase?: boolean): Promise<void>;
  pushTo?(remote?: string, refspec?: string, setUpstream?: boolean, force?: ForcePushMode, tags?: boolean): Promise<void>;
  branch?(name: string, checkout?: boolean, ref?: string): Promise<void>;
  getRefs?(query?: { type?: 'head' | 'remote' | 'tag'; contains?: string }): Promise<Ref[]>;
}

export interface GitApi {
  readonly state: APIState;
  readonly repositories: Repository[];
  readonly onDidOpenRepository: Event<Repository>;
  readonly onDidCloseRepository: Event<Repository>;
  readonly onDidChangeState: Event<APIState>;
  toGitUri(uri: Uri, ref: string): Uri;
}

export interface GitExtensionExports {
  getAPI(version: 1): GitApi;
  enabled: boolean;
}

/** Shape of errors thrown by the built-in extension (GitError). */
export interface GitErrorLike {
  gitErrorCode?: string;
  gitCommand?: string;
  gitArgs?: string[];
  stderr?: string;
  message?: string;
  exitCode?: number;
}

export function asGitErrorLike(err: unknown): GitErrorLike {
  if (typeof err === 'object' && err !== null) {
    return err as GitErrorLike;
  }
  return { message: String(err) };
}