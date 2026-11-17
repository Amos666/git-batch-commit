import type { ProtocolError } from './errors';
import type { CommitRequest, CommitResult, OperationState, PanelState, RepoStatus } from './models';

export const PROTOCOL_VERSION = 1;

export interface PanelSettings {
  defaultSelectAll: boolean;
  selectUntracked: boolean;
  clearMessageOnSuccess: boolean;
  stopOnFirstRepoError: boolean;
  refreshDebounceMs: number;
}

export interface InitResult {
  panelState: PanelState;
  repos: RepoStatus[];
  settings: PanelSettings;
  extensionVersion: string;
}

export interface BranchRef {
  name: string;
  remote?: string;
  commit?: string;
  current: boolean;
}

export type DiffSide = 'head' | 'staged' | 'worktree';

export interface HunkInfo {
  id: number;
  header: string;
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: string[];
}

export interface HunkListResult {
  side: 'worktree' | 'staged';
  binary: boolean;
  hunks: HunkInfo[];
}

export interface StashEntry {
  index: number;
  hash: string;
  description: string;
  branchName: string;
  date?: number;
}

export interface ShelfEntry {
  id: string;
  name: string;
  /** epoch ms */
  createdAt: number;
  /** branch at save time; unshelve applies to the current branch */
  branch: string;
  files: string[];
}

export interface LogEntry {
  hash: string;
  message: string;
  authorName?: string;
  /** epoch ms */
  authorDate?: number;
}

export interface LogPage {
  entries: LogEntry[];
  hasMore: boolean;
}

export interface RequestMap {
  'panel.init': { params: undefined; result: InitResult };
  'status.get': { params: { repoId?: string }; result: RepoStatus[] };
  'index.stage': { params: { repoId: string; paths: string[] }; result: void };
  'index.unstage': { params: { repoId: string; paths: string[] }; result: void };
  'index.stageAll': { params: { repoId: string }; result: void };
  'index.unstageAll': { params: { repoId: string }; result: void };
  'commit.run': { params: CommitRequest; result: CommitResult[] };
  'commit.show': { params: { repoId: string; oid: string }; result: void };
  'commit.undo': { params: { repoId: string }; result: void };
  'commit.template': { params: undefined; result: string | null };
  'history.list': { params: undefined; result: string[] };
  'batch.cancelRemaining': { params: undefined; result: void };
  'diff.open': { params: { repoId: string; path: string; side: DiffSide; force?: boolean }; result: void };
  'hunk.list': { params: { repoId: string; path: string; side: 'worktree' | 'staged' }; result: HunkListResult };
  'hunk.stage': { params: { repoId: string; path: string; hunkIds: number[] }; result: void };
  'hunk.unstage': { params: { repoId: string; path: string; hunkIds: number[] }; result: void };
  'stash.list': { params: { repoId: string }; result: StashEntry[] };
  'stash.create': { params: { repoId: string; message?: string; includeUntracked?: boolean; staged?: boolean }; result: void };
  'stash.apply': { params: { repoId: string; index: number }; result: void };
  'stash.pop': { params: { repoId: string; index: number }; result: void };
  'stash.drop': { params: { repoId: string; index: number }; result: void };
  'shelf.list': { params: { repoId: string }; result: ShelfEntry[] };
  'shelf.create': { params: { repoId: string; name: string; paths: string[] }; result: ShelfEntry };
  'shelf.unshelve': { params: { repoId: string; id: string; paths?: string[]; removeAfter?: boolean }; result: void };
  'shelf.delete': { params: { repoId: string; id: string }; result: void };
  'branch.list': { params: { repoId: string }; result: BranchRef[] };
  'branch.checkout': { params: { repoId: string; name: string }; result: void };
  'branch.create': { params: { repoId: string; name: string; checkout?: boolean; ref?: string }; result: void };
  'branch.delete': { params: { repoId: string; name: string }; result: void };
  'branch.rename': { params: { repoId: string; from: string; to: string }; result: void };
  'branch.compare': { params: { repoId: string; name: string }; result: void };
  'repo.pull': { params: { repoId: string }; result: void };
  'repo.push': { params: { repoId: string }; result: void };
  'log.list': { params: { repoId: string; skip?: number; author?: string; grep?: string }; result: LogPage };
  'log.cherryPick': { params: { repoId: string; oid: string }; result: void };
  'log.revert': { params: { repoId: string; oid: string }; result: void };
  'merge.abort': { params: { repoId: string }; result: void };
  'merge.openEditor': { params: { repoId: string; path: string }; result: void };
  'ui.showGitOutput': { params: undefined; result: void };
  'ui.retryInTerminal': { params: { repoId: string; command: string }; result: void };
  'ui.openGitSettings': { params: undefined; result: void };
  'ui.focus': { params: { focused: boolean }; result: void };
  'ui.metric': { params: { name: string; ms: number }; result: void };
}

export type Method = keyof RequestMap;

export interface Request<M extends Method = Method> {
  v: typeof PROTOCOL_VERSION;
  id: string;
  method: M;
  params: RequestMap[M]['params'];
}

export type Response =
  | { v: typeof PROTOCOL_VERSION; id: string; ok: true; result: unknown }
  | { v: typeof PROTOCOL_VERSION; id: string; ok: false; error: ProtocolError };

export interface EventMap {
  'status.changed': { status: RepoStatus };
  'repo.opened': { status: RepoStatus };
  'repo.closed': { repoId: string };
  'operation.progress': { operation: OperationState };
  'panel.state': { panelState: PanelState };
  'ui.command': { command: 'commit' };
}

export type EventName = keyof EventMap;

export interface HostEvent<E extends EventName = EventName> {
  v: typeof PROTOCOL_VERSION;
  event: E;
  seq: number;
  payload: EventMap[E];
}

export type WebviewMessage = Request | { v: typeof PROTOCOL_VERSION; ready: true };
export type HostMessage = Response | HostEvent;

export function isRequest(msg: unknown): msg is Request {
  return (
    typeof msg === 'object' && msg !== null &&
    (msg as { v?: unknown }).v === PROTOCOL_VERSION &&
    typeof (msg as { id?: unknown }).id === 'string' &&
    typeof (msg as { method?: unknown }).method === 'string'
  );
}

export function isResponse(msg: unknown): msg is Response {
  return (
    typeof msg === 'object' && msg !== null &&
    (msg as { v?: unknown }).v === PROTOCOL_VERSION &&
    typeof (msg as { id?: unknown }).id === 'string' &&
    typeof (msg as { ok?: unknown }).ok === 'boolean'
  );
}

export function isHostEvent(msg: unknown): msg is HostEvent {
  return (
    typeof msg === 'object' && msg !== null &&
    (msg as { v?: unknown }).v === PROTOCOL_VERSION &&
    typeof (msg as { event?: unknown }).event === 'string'
  );
}