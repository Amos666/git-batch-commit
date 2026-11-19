import type { ProtocolError } from './errors';
import type {
  ChangelistDescriptor,
  ChangelistFileRef,
  ChangelistState,
  CheckAvailability,
  CheckId,
  CheckReport,
  CommitMode,
  CommitOptionsState,
  CommitRequest,
  CommitRequestV2,
  CommitResult,
  KernelCapabilities,
  ModeMigrationPreview,
  OperationState,
  PanelState,
  PartialSelection,
  PushCommitFile,
  PushFilesResult,
  PushPreviewEntry,
  PushRunRequest,
  PushRunResult,
  RepoStatus,
  UnavailableReason,
} from './models';

export const PROTOCOL_VERSION = 2;

export interface PanelSettings {
  defaultSelectAll: boolean;
  selectUntracked: boolean;
  clearMessageOnSuccess: boolean;
  stopOnFirstRepoError: boolean;
  refreshDebounceMs: number;
}

export interface InitResult {
  panelState: PanelState;
  unavailableReason?: UnavailableReason;
  repos: RepoStatus[];
  settings: PanelSettings;
  extensionVersion: string;
  capabilities: KernelCapabilities;
  checks: CheckAvailability[];
  changelists: ChangelistState;
}

export interface BranchRef {
  name: string;
  remote?: string;
  commit?: string;
  current?: boolean;
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

export interface DiffDataResult {
  side: DiffSide;
  binary: boolean;
  tooLarge: boolean;
  oldText: string;
  newText: string;
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
  'status.refresh': { params: { repoId?: string }; result: RepoStatus[] };
  'index.stage': { params: { repoId: string; paths: string[] }; result: void };
  'index.unstage': { params: { repoId: string; paths: string[] }; result: void };
  'index.stageAll': { params: { repoId: string }; result: void };
  'index.unstageAll': { params: { repoId: string }; result: void };
  'commit.run': { params: CommitRequest | CommitRequestV2; result: CommitResult[] };
  'commit.show': { params: { repoId: string; oid: string }; result: void };
  'commit.isPushed': { params: { repoId: string }; result: { pushed: boolean } };
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
  'repo.push': { params: { repoId: string; remote?: string }; result: void };
  'push.preview': { params: { repoIds: string[] }; result: PushPreviewEntry[] };
  'push.commitFiles': { params: { repoId: string; hash?: string }; result: PushFilesResult };
  'push.fileDiff': { params: { repoId: string; file: PushCommitFile; from: string; to: string }; result: void };
  'push.run': { params: PushRunRequest; result: PushRunResult[] };
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
  'ui.reloadWindow': { params: undefined; result: void };
  'changelist.list': { params: undefined; result: ChangelistState };
  'changelist.create': { params: { name: string; comment?: string }; result: ChangelistDescriptor };
  'changelist.rename': { params: { id: string; name: string }; result: void };
  'changelist.remove': { params: { id: string }; result: void };
  'changelist.setActive': { params: { id: string }; result: void };
  'changelist.setComment': { params: { id: string; comment: string }; result: void };
  'changelist.move': { params: { refs: ChangelistFileRef[]; targetId: string; force?: boolean }; result: void };
  'mode.get': { params: undefined; result: { mode: CommitMode } };
  'mode.previewMigration': { params: { mode: CommitMode }; result: ModeMigrationPreview };
  'mode.set': { params: { mode: CommitMode; confirm: boolean }; result: void };
  'inclusion.set': { params: { refs: ChangelistFileRef[]; included: boolean }; result: void };
  'inclusion.setPartial': { params: { repoId: string; path: string; selection: PartialSelection | null }; result: void };
  'index.stagePartial': { params: { repoId: string; path: string; selection: PartialSelection }; result: void };
  'index.unstagePartial': { params: { repoId: string; path: string; selection: PartialSelection }; result: void };
  'diff.data': { params: { repoId: string; path: string; side: DiffSide; force?: boolean }; result: DiffDataResult };
  'options.get': { params: undefined; result: CommitOptionsState };
  'options.set': { params: Partial<CommitOptionsState>; result: void };
  'checks.run': { params: { repoIds: string[]; checkIds: CheckId[]; refs?: ChangelistFileRef[] }; result: CheckReport };
  'files.rollback': { params: { repoId: string; paths: string[] }; result: void };
  'files.delete': { params: { repoId: string; paths: string[] }; result: void };
  'files.open': { params: { repoId: string; path: string }; result: void };
  'files.reveal': { params: { repoId: string; path: string }; result: void };
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
  'panel.state': { panelState: PanelState; unavailableReason?: UnavailableReason };
  'changelists.changed': { state: ChangelistState };
  'mode.changed': { mode: CommitMode };
  'options.changed': { options: CommitOptionsState };
  'checks.progress': { checkId: CheckId; status: 'running' | 'done' };
  'ui.command': {
    command:
      | 'commit'
      | 'commitAndPush'
      | 'push'
      | 'diff'
      | 'addToVcs'
      | 'moveChangelist'
      | 'toggleOptions'
      | 'setActiveChangelist'
      | 'refresh'
      | 'rollback';
  };
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

/** Legacy webviews send the v1 flat commit shape; normalize to the v2 request. */
export function normalizeCommitRequest(params: CommitRequest | CommitRequestV2): CommitRequestV2 {
  if ('options' in params) {
    return params;
  }
  return {
    repoIds: params.repoIds,
    message: params.message,
    options: {
      amend: params.amend,
      signoff: params.signoff,
      noVerify: params.noVerify,
    },
    expectedStaged: params.expectedStaged,
  };
}