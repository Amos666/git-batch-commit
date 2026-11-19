import type { ProtocolError, RecoveryAction } from '../../protocol/errors';
import type {
  BranchRef,
  DiffSide,
  LogEntry,
  PanelSettings,
  ShelfEntry,
  StashEntry,
} from '../../protocol/messages';
import type { Method, RequestMap } from '../../protocol/messages';
import type {
  ChangelistFileRef,
  ChangelistState,
  CheckAvailability,
  CheckId,
  CheckReport,
  CommitMode,
  CommitOptionsState,
  CommitResult,
  KernelCapabilities,
  ModeMigrationPreview,
  OperationState,
  PanelState,
  PartialSelection,
  PushCommitFile,
  PushFilesResult,
  PushPreviewEntry,
  PushRunResult,
  RepoStatus,
  UnavailableReason,
} from '../../protocol/models';

export const refKey = (repoId: string, path: string): string => `${repoId}:${path}`;
export const splitRefKey = (key: string): ChangelistFileRef => {
  const i = key.indexOf(':');
  return { repoId: key.slice(0, i), path: key.slice(i + 1) };
};

export type TabId = 'commit' | 'shelf' | 'stash';

export interface ViewOptions {
  groupByDirectory: boolean;
  showUnversioned: boolean;
}

export type MenuTarget =
  | { kind: 'file'; repoId: string; path: string; x: number; y: number }
  | { kind: 'dir'; repoId: string; paths: string[]; x: number; y: number }
  | { kind: 'changelist'; id: string; x: number; y: number }
  | { kind: 'unversioned'; repoId: string; x: number; y: number }
  | { kind: 'shelfEntry'; repoId: string; id: string; x: number; y: number }
  | { kind: 'shelfFile'; repoId: string; id: string; path: string; x: number; y: number }
  | { kind: 'stashEntry'; repoId: string; index: number; x: number; y: number };

export type Dialog =
  | { kind: 'rollback'; refs: ChangelistFileRef[] }
  | { kind: 'deleteFiles'; refs: ChangelistFileRef[] }
  | { kind: 'shelve'; repoId: string; refs: ChangelistFileRef[]; name: string; selected: Record<string, boolean> }
  | { kind: 'unshelve'; repoId: string; id: string; files: string[]; selected: Record<string, boolean>; removeAfter: boolean; targetListId: string }
  | { kind: 'stashCreate'; repoId: string; message: string; includeUntracked: boolean; stagedOnly: boolean }
  | { kind: 'moveChangelist'; refs: ChangelistFileRef[]; targetId: string }
  | { kind: 'newChangelist'; name: string; comment: string }
  | { kind: 'renameChangelist'; id: string; name: string }
  | { kind: 'editComment'; id: string; comment: string }
  | { kind: 'deleteChangelist'; id: string }
  | { kind: 'modeSwitch'; mode: CommitMode; preview: ModeMigrationPreview }
  | { kind: 'changelistConflict'; refs: ChangelistFileRef[]; targetId: string; conflict: NonNullable<ProtocolError['conflictContext']> }
  | {
      kind: 'push';
      /** all roots with a branch, in tree order */
      repoIds: string[];
      checked: Record<string, boolean>;
      expanded: Record<string, boolean>;
      /** repoId → remote for roots without upstream */
      remoteChoice: Record<string, string>;
      preview: Record<string, PushPreviewEntry>;
      previewLoading: boolean;
      results: Record<string, PushRunResult>;
      tags: boolean;
      forceConfirm?: boolean;
      /** left-tree selection driving the right-hand changed-files pane */
      selected?: { repoId: string; hash?: string };
      files?: PushFilesResult;
      filesLoading: boolean;
      filesError?: string;
      filesCache: Record<string, PushFilesResult>;
    }
  | { kind: 'amendPushed' }
  | { kind: 'checksReport'; report: CheckReport; pushAfter: boolean; postCommit?: boolean; repoIds?: string[] }
  | { kind: 'abortMerge'; repoId: string }
  | { kind: 'undoCommit'; repoId: string }
  | { kind: 'skipHooks'; pushAfter: boolean }
  | { kind: 'pickChangelist' }
  | { kind: 'dropStash'; repoId: string; index: number }
  | { kind: 'popStash'; repoId: string; index: number }
  | { kind: 'deleteShelf'; repoId: string; id: string };

export interface BranchPickerState {
  repoId: string;
  branches: BranchRef[];
  error?: string;
  busy: boolean;
  search: string;
  newBranch: string;
  renaming: string | null;
  renameTo: string;
  confirmDelete: string | null;
}

export interface ShelfTabState {
  repoId: string;
  entries: ShelfEntry[];
  busy: boolean;
  error?: string;
}

export interface StashTabState {
  repoId: string;
  entries: StashEntry[];
  busy: boolean;
  error?: string;
}

export interface LogViewState {
  repoId: string;
  entries: LogEntry[];
  hasMore: boolean;
  busy: boolean;
  error?: string;
  author: string;
  grep: string;
  confirm: { kind: 'cherry-pick' | 'revert'; oid: string } | null;
}

export interface PanelStore {
  // core
  panelState: PanelState;
  unavailableReason?: UnavailableReason;
  settings: PanelSettings | null;
  capabilities: KernelCapabilities | null;
  checksAvailability: CheckAvailability[];
  repos: Record<string, RepoStatus>;
  repoOrder: string[];
  operations: Record<string, OperationState>;
  lastError: ProtocolError | null;
  /** repos whose index was left translated after a failed commit (banner) */
  indexModifiedRepos: string[];
  protocolMismatch: boolean;

  // ui
  activeTab: TabId;
  viewOptions: ViewOptions;
  collapsed: Record<string, boolean>;
  highlighted: string[];
  contextMenu: MenuTarget | null;
  dialog: Dialog | null;
  dialogBusy: boolean;
  dialogError?: string;
  optionsOpen: boolean;

  // changelists / mode
  changelists: ChangelistState | null;
  mode: CommitMode;

  // commit
  message: string;
  history: string[] | null;
  historyOpen: boolean;
  amend: boolean;
  optionsState: CommitOptionsState;
  committing: boolean;
  checksRunning: CheckId[];
  results: CommitResult[] | null;

  // overlays
  branchPicker: BranchPickerState | null;
  shelfTab: ShelfTabState | null;
  stashTab: StashTabState | null;
  logView: LogViewState | null;

  // core actions
  init: () => Promise<void>;
  applyStatus: (status: RepoStatus) => void;
  removeRepo: (repoId: string) => void;
  setPanelState: (state: PanelState, reason?: UnavailableReason) => void;
  setOperation: (op: OperationState) => void;
  dismissError: () => void;
  dismissIndexModified: (repoId: string) => void;
  refresh: (repoId?: string) => Promise<void>;
  reloadWindow: () => Promise<void>;

  // ui actions
  setActiveTab: (tab: TabId) => void;
  toggleViewOption: (key: keyof ViewOptions) => void;
  toggleCollapse: (key: string) => void;
  expandAll: () => void;
  collapseAll: () => void;
  highlight: (keys: string[], additive?: boolean) => void;
  clearHighlight: () => void;
  openContextMenu: (target: MenuTarget) => void;
  closeContextMenu: () => void;
  openDialog: (dialog: Dialog) => void;
  closeDialog: () => void;
  patchDialog: (patch: Partial<Dialog>) => void;
  toggleOptions: () => void;

  // changelist actions
  applyChangelists: (state: ChangelistState) => void;
  applyMode: (mode: CommitMode) => void;
  setIncluded: (refs: ChangelistFileRef[], included: boolean) => Promise<void>;
  toggleIncluded: (ref: ChangelistFileRef) => Promise<void>;
  setPartial: (repoId: string, path: string, selection: PartialSelection | null) => Promise<void>;
  createChangelist: (name: string, comment: string) => Promise<void>;
  renameChangelist: (id: string, name: string) => Promise<void>;
  removeChangelist: (id: string) => Promise<void>;
  setActiveChangelist: (id: string) => Promise<void>;
  setChangelistComment: (id: string, comment: string) => Promise<void>;
  moveFiles: (refs: ChangelistFileRef[], targetId: string, force?: boolean) => Promise<void>;
  requestModeSwitch: (mode: CommitMode) => Promise<void>;
  confirmModeSwitch: () => Promise<void>;

  // commit actions
  setMessage: (message: string) => void;
  toggleHistory: () => Promise<void>;
  pickHistory: (message: string) => void;
  setAmend: (amend: boolean) => Promise<void>;
  setOptions: (patch: Partial<CommitOptionsState>) => Promise<void>;
  applyOptions: (options: CommitOptionsState) => void;
  commit: (opts?: { pushAfter?: boolean; skipChecks?: boolean; noVerify?: boolean }) => Promise<void>;
  confirmAmendPushed: () => Promise<void>;
  cancelRemaining: () => void;
  openDiff: (repoId: string, path: string, side: DiffSide, force?: boolean) => Promise<void>;
  showCommit: (repoId: string, oid: string) => Promise<void>;
  runAction: (action: RecoveryAction, error: ProtocolError, repoId?: string) => Promise<void>;

  // file actions
  rollbackFiles: (refs: ChangelistFileRef[]) => Promise<void>;
  deleteFiles: (refs: ChangelistFileRef[]) => Promise<void>;
  openFile: (repoId: string, path: string) => Promise<void>;
  revealFile: (repoId: string, path: string) => Promise<void>;
  copyText: (text: string) => Promise<void>;

  // branch actions
  openBranchPicker: (repoId: string) => Promise<void>;
  closeBranchPicker: () => void;
  setBranchField: (field: 'newBranch' | 'renameTo' | 'search', value: string) => void;
  checkoutBranch: (name: string) => Promise<void>;
  createBranch: () => Promise<void>;
  startRename: (name: string | null) => void;
  confirmRename: () => Promise<void>;
  requestDeleteBranch: (name: string | null) => void;
  confirmDeleteBranch: () => Promise<void>;
  compareBranch: (name: string) => Promise<void>;
  pullRepo: (repoId: string) => Promise<void>;
  pushRepo: (repoId: string) => Promise<void>;
  requestPush: (checkedIds: string[], includeAhead?: boolean) => void;
  confirmPush: () => Promise<void>;
  togglePushRepo: (repoId: string) => void;
  togglePushExpand: (repoId: string) => void;
  setPushRemote: (repoId: string, remote: string) => void;
  setPushTags: (tags: boolean) => void;
  requestForcePush: () => void;
  cancelForcePush: () => void;
  confirmForcePush: () => Promise<void>;
  retryPushRepo: (repoId: string) => Promise<void>;
  selectPushFiles: (repoId: string, hash?: string) => void;
  openPushFileDiff: (file: PushCommitFile) => Promise<void>;

  // shelf actions
  openShelfTab: (repoId?: string) => Promise<void>;
  reloadShelf: () => Promise<void>;
  requestShelve: (repoId: string, refs: ChangelistFileRef[]) => void;
  confirmShelve: () => Promise<void>;
  requestUnshelve: (repoId: string, id: string) => void;
  unshelveSingleFile: (repoId: string, id: string, path: string) => void;
  confirmUnshelve: () => Promise<void>;
  restoreShelf: (repoId: string, id: string) => Promise<void>;
  requestDeleteShelf: (repoId: string, id: string) => void;
  confirmDeleteShelf: () => Promise<void>;

  // stash actions
  openStashTab: (repoId?: string) => Promise<void>;
  reloadStash: () => Promise<void>;
  requestStashCreate: (repoId: string) => void;
  confirmStashCreate: () => Promise<void>;
  applyStash: (repoId: string, index: number) => Promise<void>;
  requestPopStash: (repoId: string, index: number) => void;
  confirmPopStash: () => Promise<void>;
  requestDropStash: (repoId: string, index: number) => void;
  confirmDropStash: () => Promise<void>;

  // log actions
  openLogView: (repoId?: string) => Promise<void>;
  setLogField: (field: 'author' | 'grep', value: string) => void;
  reloadLog: () => Promise<void>;
  loadMoreLog: () => Promise<void>;
  requestLogAction: (kind: 'cherry-pick' | 'revert', oid: string) => void;
  cancelLogAction: () => void;
  confirmLogAction: () => Promise<void>;

  // sequencer
  requestAbortMerge: (repoId: string) => void;
  confirmAbortMerge: () => Promise<void>;
  requestUndoCommit: (repoId: string) => void;
  confirmUndoCommit: () => Promise<void>;
  openMergeEditor: (repoId: string, path: string) => Promise<void>;
}

export interface SliceCtx {
  request: <M extends Method>(method: M, params: RequestMap[M]['params']) => Promise<RequestMap[M]['result']>;
  metric: (name: string, ms: number) => void;
}

export type SetFn = (partial: Partial<PanelStore> | ((s: PanelStore) => Partial<PanelStore>)) => void;
export type Slice = (set: SetFn, get: () => PanelStore, ctx: SliceCtx) => Partial<PanelStore>;

export const DEFAULT_OPTIONS: CommitOptionsState = {
  signoff: false,
  runHooks: true,
  checks: {},
  runAfterCommit: false,
};