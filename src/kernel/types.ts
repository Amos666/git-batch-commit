/**
 * Host-side git kernel contract. Deliberately vscode-free: plain string
 * paths (repo-relative posix), plain Buffers, unsubscribe-function events.
 * The UI and all services depend only on this contract, so the built-in
 * Git API implementation can be swapped for a self-owned kernel later.
 */
import type { CommitAuthor, KernelCapabilities } from '../protocol/models';

export enum KernelStatus {
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

export interface KernelChange {
  /** repo-relative posix path */
  path: string;
  /** absolute file URI string, for editor navigation */
  uri: string;
  origPath?: string;
  origUri?: string;
  renamePath?: string;
  status: KernelStatus;
}

export interface KernelBranch {
  name?: string;
  commit?: string;
  upstream?: { name: string; remote: string };
  ahead?: number;
  behind?: number;
}

export interface KernelRef {
  /** RefType enum: Head=0, RemoteHead=1, Tag=2; string form kept for mocks */
  type: number | 'head' | 'remote' | 'tag';
  name?: string;
  commit?: string;
  remote?: string;
}

export interface KernelDiffFile {
  path: string;
  origPath?: string;
  renamePath?: string;
  status?: number;
}

export interface KernelCommitOptions {
  all?: boolean | 'tracked';
  amend?: boolean;
  signoff?: boolean;
  signCommit?: boolean;
  noVerify?: boolean;
  empty?: boolean;
  postCommitCommand?: string | null;
  author?: CommitAuthor;
}

export interface KernelLogOptions {
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

export interface KernelLogCommit {
  hash: string;
  message: string;
  parents: string[];
  authorName?: string;
  authorEmail?: string;
  authorDate?: Date;
  commitDate?: Date;
  shortStats?: { files: number; insertions: number; deletions: number };
}

export interface KernelStash {
  hash: string;
  parents: string[];
  index: number;
  branchName: string;
  description: string;
  authorDate?: Date;
  commitDate?: Date;
}

export interface KernelRepoState {
  HEAD: KernelBranch | undefined;
  refs: KernelRef[];
  /** configured remotes (git config), even before any fetch created tracking refs */
  remotes: { name: string }[];
  mergeChanges: KernelChange[];
  indexChanges: KernelChange[];
  workingTreeChanges: KernelChange[];
  untrackedChanges: KernelChange[];
  rebaseCommit?: { hash: string };
  onDidChange(cb: () => void): () => void;
}

export type Unsubscribe = () => void;

export interface KernelRepo {
  readonly rootPath: string;
  readonly rootUri: string;
  readonly kind: 'repository' | 'submodule' | 'worktree';
  readonly state: KernelRepoState;
  /** All path arguments are repo-relative posix paths. */
  add(paths: string[]): Promise<void>;
  restore(paths: string[], options?: { staged?: boolean; ref?: string }): Promise<void>;
  commit(message: string, opts?: KernelCommitOptions): Promise<void>;
  push(remote?: string, ref?: string, setUpstream?: boolean, force?: number): Promise<void>;
  checkout(treeish: string): Promise<void>;
  getBranches(query?: { remote?: boolean; sort?: string }): Promise<KernelRef[]>;
  createBranch(name: string, checkout?: boolean, ref?: string): Promise<void>;
  deleteBranch(name: string, force?: boolean): Promise<void>;
  diff(cached?: boolean): Promise<string>;
  diffWithHEAD(path?: string): Promise<string>;
  diffWith(ref: string | undefined, path?: string): Promise<string>;
  /** CAUTION: built-in semantics run `git diff --cached <ref> -- <path>`. */
  diffIndexWith(ref?: string, path?: string): Promise<string>;
  diffIndexWithHEAD?(path?: string): Promise<string>;
  diffBetween(ref1: string, ref2: string): Promise<string | KernelDiffFile[]>;
  diffBetweenPatch?(ref1: string, ref2: string, path?: string): Promise<string>;
  diffBetweenWithStats?(ref1: string, ref2: string, path?: string): Promise<KernelDiffFile[]>;
  diffBetweenWithStats2?(range: string, path?: string): Promise<KernelDiffFile[]>;
  buffer(ref: string, path: string): Promise<Buffer>;
  show(ref: string, path: string): Promise<string>;
  getCommit(ref: string): Promise<KernelLogCommit>;
  getConfig?(key: string): Promise<string>;
  getGlobalConfig?(key: string): Promise<string>;
  hashObject?(content: Buffer): Promise<string>;
  log?(options?: KernelLogOptions, cancellationToken?: unknown): Promise<KernelLogCommit[]>;
  createStash?(options?: { message?: string; includeUntracked?: boolean; staged?: boolean }): Promise<void>;
  getStashes?(): Promise<KernelStash[]>;
  popStash?(index?: number): Promise<void>;
  applyStash?(index?: number): Promise<void>;
  dropStash?(index?: number): Promise<void>;
  merge?(ref: string): Promise<void>;
  mergeAbort?(): Promise<void>;
  rebase?(ref: string, options?: { rebaseMerges?: boolean; onto?: string }): Promise<void>;
  rebaseAbort?(): Promise<void>;
  rebaseContinue?(): Promise<void>;
  getBranchBase?(name: string): Promise<KernelRef | undefined>;
  getMergeBase?(ref1: string, ref2: string): Promise<string | undefined>;
  pull?(rebase?: boolean): Promise<void>;
  pushTo?(remote?: string, refspec?: string, setUpstream?: boolean, force?: number, tags?: boolean): Promise<void>;
  branch?(name: string, checkout?: boolean, ref?: string): Promise<void>;
  getRefs?(query?: { type?: 'head' | 'remote' | 'tag'; contains?: string }): Promise<KernelRef[]>;
  /** Force a status rescan (git status); absent on kernels that push state eagerly. */
  refresh?(): Promise<void>;
}

export interface GitKernel {
  readonly repositories: KernelRepo[];
  readonly capabilities: KernelCapabilities;
  onDidOpenRepository(cb: (repo: KernelRepo) => void): Unsubscribe;
  onDidCloseRepository(cb: (repo: KernelRepo) => void): Unsubscribe;
  dispose(): void;
}