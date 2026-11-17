import { create } from 'zustand';
import type { ProtocolError, RecoveryAction } from '../protocol/errors';
import type { BranchRef, DiffSide, HunkInfo, InitResult, LogEntry, PanelSettings, ShelfEntry, StashEntry } from '../protocol/messages';
import type { CommitResult, OperationState, PanelState, RepoStatus } from '../protocol/models';
import { onEvent, request } from './bridge';

export interface CommitOptions {
  amend: boolean;
  noVerify: boolean;
  signoff: boolean;
}

export interface BranchPickerState {
  repoId: string;
  branches: BranchRef[];
  error?: string;
  busy: boolean;
  newBranch: string;
  renaming: string | null;
  renameTo: string;
  confirmDelete: string | null;
}

export interface HunkPickerState {
  repoId: string;
  path: string;
  side: 'worktree' | 'staged';
  hunks: HunkInfo[];
  binary: boolean;
  selected: Record<number, boolean>;
  busy: boolean;
  error?: string;
}

export interface StashPanelState {
  repoId: string;
  entries: StashEntry[];
  busy: boolean;
  error?: string;
  message: string;
  includeUntracked: boolean;
  stagedOnly: boolean;
  confirmDrop: number | null;
  confirmPop: number | null;
}

export interface ShelfPanelState {
  repoId: string;
  entries: ShelfEntry[];
  busy: boolean;
  error?: string;
  name: string;
  /** create form: tracked change paths opted in for shelving */
  selected: Record<string, boolean>;
  confirmCreate: boolean;
  unshelve: { id: string; selected: Record<string, boolean>; removeAfter: boolean } | null;
  confirmDelete: string | null;
}

export interface LogPanelState {
  repoId: string;
  entries: LogEntry[];
  hasMore: boolean;
  busy: boolean;
  error?: string;
  author: string;
  grep: string;
  confirm: { kind: 'cherry-pick' | 'revert'; oid: string } | null;
}

interface PanelStore {
  panelState: PanelState;
  settings: PanelSettings | null;
  repos: Record<string, RepoStatus>;
  repoOrder: string[];
  message: string;
  committing: boolean;
  results: CommitResult[] | null;
  operations: Record<string, OperationState>;
  lastError: ProtocolError | null;
  confirmNoVerify: boolean;
  autoStaged: Record<string, boolean>;
  collapsedDirs: Record<string, boolean>;
  options: CommitOptions;
  history: string[] | null;
  historyOpen: boolean;
  branchPicker: BranchPickerState | null;
  hunkPicker: HunkPickerState | null;
  stashPanel: StashPanelState | null;
  shelfPanel: ShelfPanelState | null;
  logPanel: LogPanelState | null;
  abortConfirm: string | null;
  undoConfirm: string | null;

  init: () => Promise<void>;
  applyStatus: (status: RepoStatus) => void;
  removeRepo: (repoId: string) => void;
  setPanelState: (state: PanelState) => void;
  setOperation: (op: OperationState) => void;
  setMessage: (message: string) => void;
  dismissError: () => void;
  toggleCollapse: (key: string) => void;
  toggleStaged: (repoId: string, path: string, target: boolean) => Promise<void>;
  stagePaths: (repoId: string, paths: string[], target: boolean) => Promise<void>;
  stageAll: (repoId: string) => Promise<void>;
  unstageAll: (repoId: string) => Promise<void>;
  setOption: (key: keyof CommitOptions, value: boolean) => void;
  toggleHistory: () => Promise<void>;
  pickHistory: (message: string) => void;
  openBranchPicker: (repoId: string) => Promise<void>;
  closeBranchPicker: () => void;
  checkoutBranch: (name: string) => Promise<void>;
  setBranchField: (field: 'newBranch' | 'renameTo', value: string) => void;
  createBranch: () => Promise<void>;
  startRename: (name: string | null) => void;
  confirmRename: () => Promise<void>;
  requestDeleteBranch: (name: string | null) => void;
  confirmDeleteBranch: () => Promise<void>;
  compareBranch: (name: string) => Promise<void>;
  pullRepo: (repoId: string) => Promise<void>;
  pushRepo: (repoId: string) => Promise<void>;
  openHunkPicker: (repoId: string, path: string, side: 'worktree' | 'staged') => Promise<void>;
  closeHunkPicker: () => void;
  toggleHunk: (id: number) => void;
  setAllHunks: (target: boolean) => void;
  applyHunks: () => Promise<void>;
  openStashPanel: (repoId: string) => Promise<void>;
  closeStashPanel: () => void;
  setStashField: (field: 'message' | 'includeUntracked' | 'stagedOnly', value: string | boolean) => void;
  createStash: () => Promise<void>;
  applyStash: (index: number) => Promise<void>;
  requestPopStash: (index: number | null) => void;
  popStash: (index: number) => Promise<void>;
  requestDropStash: (index: number | null) => void;
  dropStash: (index: number) => Promise<void>;
  openShelfPanel: (repoId: string) => Promise<void>;
  closeShelfPanel: () => void;
  setShelfName: (name: string) => void;
  toggleShelfFile: (path: string) => void;
  requestShelfCreate: () => void;
  cancelShelfCreate: () => void;
  confirmShelfCreate: () => Promise<void>;
  openUnshelve: (id: string | null) => void;
  toggleUnshelveFile: (path: string) => void;
  setUnshelveRemoveAfter: (value: boolean) => void;
  doUnshelve: () => Promise<void>;
  requestShelfDelete: (id: string | null) => void;
  confirmShelfDelete: () => Promise<void>;
  openLogPanel: (repoId: string) => Promise<void>;
  closeLogPanel: () => void;
  setLogField: (field: 'author' | 'grep', value: string) => void;
  reloadLog: () => Promise<void>;
  loadMoreLog: () => Promise<void>;
  requestLogAction: (kind: 'cherry-pick' | 'revert', oid: string) => void;
  cancelLogAction: () => void;
  confirmLogAction: () => Promise<void>;
  requestAbortMerge: (repoId: string | null) => void;
  confirmAbortMerge: () => Promise<void>;
  requestUndoCommit: (repoId: string | null) => void;
  confirmUndoCommit: () => Promise<void>;
  openMergeEditor: (repoId: string, path: string) => Promise<void>;
  commit: (opts?: { pushAfter?: boolean; confirmed?: boolean; noVerify?: boolean }) => Promise<void>;
  cancelRemaining: () => void;
  openDiff: (repoId: string, path: string, side: DiffSide, force?: boolean) => Promise<void>;
  showCommit: (repoId: string, oid: string) => Promise<void>;
  runAction: (action: RecoveryAction, error: ProtocolError, repoId?: string) => Promise<void>;
}

function stagedPaths(status: RepoStatus): string[] {
  return status.changes.filter((c) => c.staged && !c.conflicted).map((c) => c.path);
}

function sendMetric(name: string, ms: number): void {
  void request('ui.metric', { name, ms }).catch(() => {});
}

// 浮层互斥：同一时刻只保留一个，避免叠满整个面板
const OVERLAY_RESET = { branchPicker: null, hunkPicker: null, stashPanel: null, shelfPanel: null, logPanel: null, abortConfirm: null, undoConfirm: null };

export const usePanelStore = create<PanelStore>((set, get) => ({
  panelState: 'initializing',
  settings: null,
  repos: {},
  repoOrder: [],
  message: '',
  committing: false,
  results: null,
  operations: {},
  lastError: null,
  confirmNoVerify: false,
  autoStaged: {},
  collapsedDirs: {},
  options: { amend: false, noVerify: false, signoff: false },
  history: null,
  historyOpen: false,
  branchPicker: null,
  hunkPicker: null,
  stashPanel: null,
  shelfPanel: null,
  logPanel: null,
  abortConfirm: null,
  undoConfirm: null,

  init: async () => {
    const started = performance.now();
    try {
      const result: InitResult = await request('panel.init', undefined);
      const repos: Record<string, RepoStatus> = {};
      for (const status of result.repos) {
        repos[status.repo.id] = status;
      }
      set({
        panelState: result.panelState,
        settings: result.settings,
        repos,
        repoOrder: result.repos.map((r) => r.repo.id),
      });
      sendMetric('panel.init', performance.now() - started);
      for (const status of result.repos) {
        void maybeAutoStage(status);
      }
      if (result.panelState === 'ready' && !get().message) {
        void request('commit.template', undefined)
          .then((template) => {
            if (template && !usePanelStore.getState().message) {
              set({ message: template });
            }
          })
          .catch(() => {});
      }
    } catch (err) {
      set({ lastError: err as ProtocolError });
    }
  },

  applyStatus: (status) => {
    const { repos, repoOrder } = get();
    const isNew = !repos[status.repo.id];
    set({
      repos: { ...repos, [status.repo.id]: status },
      repoOrder: isNew ? [...repoOrder, status.repo.id] : repoOrder,
    });
    if (isNew) {
      void maybeAutoStage(status);
    }
  },

  removeRepo: (repoId) => {
    const { repos, repoOrder, operations, branchPicker, hunkPicker, stashPanel, shelfPanel, logPanel, abortConfirm, undoConfirm } = get();
    const next = { ...repos };
    delete next[repoId];
    const nextOps = { ...operations };
    delete nextOps[repoId];
    set({
      repos: next,
      repoOrder: repoOrder.filter((id) => id !== repoId),
      operations: nextOps,
      branchPicker: branchPicker?.repoId === repoId ? null : branchPicker,
      hunkPicker: hunkPicker?.repoId === repoId ? null : hunkPicker,
      stashPanel: stashPanel?.repoId === repoId ? null : stashPanel,
      shelfPanel: shelfPanel?.repoId === repoId ? null : shelfPanel,
      logPanel: logPanel?.repoId === repoId ? null : logPanel,
      abortConfirm: abortConfirm === repoId ? null : abortConfirm,
      undoConfirm: undoConfirm === repoId ? null : undoConfirm,
    });
  },

  setPanelState: (panelState) => set({ panelState }),

  setOperation: (op) => {
    const operations = { ...get().operations };
    if (op.phase === 'done' || op.phase === 'failed' || op.phase === 'cancelled') {
      delete operations[op.repoId];
    } else {
      operations[op.repoId] = op;
    }
    set({ operations });
  },

  setMessage: (message) => set({ message }),
  dismissError: () => set({ lastError: null, confirmNoVerify: false }),

  toggleCollapse: (key) => {
    const collapsedDirs = { ...get().collapsedDirs };
    if (collapsedDirs[key]) {
      delete collapsedDirs[key];
    } else {
      collapsedDirs[key] = true;
    }
    set({ collapsedDirs });
  },

  toggleStaged: async (repoId, path, target) => {
    const snapshot = get().repos[repoId];
    if (!snapshot) {
      return;
    }
    const optimistic: RepoStatus = {
      ...snapshot,
      changes: snapshot.changes.map((c) =>
        c.path === path
          ? { ...c, staged: target, indexStatus: target ? (c.worktreeStatus ?? c.indexStatus ?? 'M') : null }
          : c,
      ),
    };
    set({ repos: { ...get().repos, [repoId]: optimistic } });
    try {
      if (target) {
        await request('index.stage', { repoId, paths: [path] });
      } else {
        await request('index.unstage', { repoId, paths: [path] });
      }
    } catch (err) {
      set({ repos: { ...get().repos, [repoId]: snapshot }, lastError: err as ProtocolError });
    }
  },

  // 批量勾选乐观更新：勾选即时响应，git 完成后由状态事件对账，失败回滚
  stagePaths: async (repoId, paths, target) => {
    if (paths.length === 0) {
      return;
    }
    const snapshot = get().repos[repoId];
    if (snapshot) {
      const selected = new Set(paths);
      const optimistic: RepoStatus = {
        ...snapshot,
        changes: snapshot.changes.map((c) =>
          selected.has(c.path) && !c.conflicted
            ? { ...c, staged: target, indexStatus: target ? (c.worktreeStatus ?? c.indexStatus ?? 'M') : null }
            : c,
        ),
      };
      set({ repos: { ...get().repos, [repoId]: optimistic } });
    }
    try {
      if (target) {
        await request('index.stage', { repoId, paths });
      } else {
        await request('index.unstage', { repoId, paths });
      }
    } catch (err) {
      if (snapshot) {
        set({ repos: { ...get().repos, [repoId]: snapshot } });
      }
      set({ lastError: err as ProtocolError });
    }
  },

  stageAll: async (repoId) => {
    try {
      await request('index.stageAll', { repoId });
    } catch (err) {
      set({ lastError: err as ProtocolError });
    }
  },

  unstageAll: async (repoId) => {
    try {
      await request('index.unstageAll', { repoId });
    } catch (err) {
      set({ lastError: err as ProtocolError });
    }
  },

  setOption: (key, value) => set({ options: { ...get().options, [key]: value } }),

  toggleHistory: async () => {
    if (get().historyOpen) {
      set({ historyOpen: false });
      return;
    }
    try {
      const history = await request('history.list', undefined);
      set({ history, historyOpen: true });
    } catch (err) {
      set({ lastError: err as ProtocolError });
    }
  },

  pickHistory: (message) => set({ message, historyOpen: false }),

  openBranchPicker: async (repoId) => {
    if (get().branchPicker?.repoId === repoId) {
      set({ branchPicker: null });
      return;
    }
    try {
      const branches = await request('branch.list', { repoId });
      set({ ...OVERLAY_RESET, branchPicker: { repoId, branches, busy: false, newBranch: '', renaming: null, renameTo: '', confirmDelete: null } });
    } catch (err) {
      set({
        ...OVERLAY_RESET,
        branchPicker: {
          repoId, branches: [], error: (err as ProtocolError).message,
          busy: false, newBranch: '', renaming: null, renameTo: '', confirmDelete: null,
        },
      });
    }
  },

  closeBranchPicker: () => set({ branchPicker: null }),

  checkoutBranch: async (name) => {
    const picker = get().branchPicker;
    if (!picker) {
      return;
    }
    try {
      await request('branch.checkout', { repoId: picker.repoId, name });
      set({ branchPicker: null });
    } catch (err) {
      set({ branchPicker: { ...picker, error: (err as ProtocolError).message } });
    }
  },

  setBranchField: (field, value) => {
    const picker = get().branchPicker;
    if (picker) {
      set({ branchPicker: { ...picker, [field]: value } });
    }
  },

  createBranch: async () => {
    const picker = get().branchPicker;
    const name = picker?.newBranch.trim();
    if (!picker || picker.busy || !name) {
      return;
    }
    set({ branchPicker: { ...picker, busy: true, error: undefined } });
    try {
      await request('branch.create', { repoId: picker.repoId, name, checkout: true });
      set({ branchPicker: null });
    } catch (err) {
      const current = get().branchPicker;
      if (current) {
        set({ branchPicker: { ...current, busy: false, error: (err as ProtocolError).message } });
      }
    }
  },

  startRename: (name) => {
    const picker = get().branchPicker;
    if (picker) {
      set({ branchPicker: { ...picker, renaming: name, renameTo: name ?? '', confirmDelete: null, error: undefined } });
    }
  },

  confirmRename: async () => {
    const picker = get().branchPicker;
    const to = picker?.renameTo.trim();
    if (!picker || picker.busy || !picker.renaming || !to || to === picker.renaming) {
      return;
    }
    set({ branchPicker: { ...picker, busy: true, error: undefined } });
    try {
      await request('branch.rename', { repoId: picker.repoId, from: picker.renaming, to });
      const branches = await request('branch.list', { repoId: picker.repoId });
      const current = get().branchPicker;
      if (current) {
        set({ branchPicker: { ...current, branches, busy: false, renaming: null, renameTo: '' } });
      }
    } catch (err) {
      const current = get().branchPicker;
      if (current) {
        set({ branchPicker: { ...current, busy: false, error: (err as ProtocolError).message } });
      }
    }
  },

  requestDeleteBranch: (name) => {
    const picker = get().branchPicker;
    if (picker) {
      set({ branchPicker: { ...picker, confirmDelete: name, renaming: null, error: undefined } });
    }
  },

  confirmDeleteBranch: async () => {
    const picker = get().branchPicker;
    if (!picker || picker.busy || !picker.confirmDelete) {
      return;
    }
    set({ branchPicker: { ...picker, busy: true, error: undefined, confirmDelete: null } });
    try {
      await request('branch.delete', { repoId: picker.repoId, name: picker.confirmDelete });
      const branches = await request('branch.list', { repoId: picker.repoId });
      const current = get().branchPicker;
      if (current) {
        set({ branchPicker: { ...current, branches, busy: false } });
      }
    } catch (err) {
      const current = get().branchPicker;
      if (current) {
        set({ branchPicker: { ...current, busy: false, error: (err as ProtocolError).message } });
      }
    }
  },

  compareBranch: async (name) => {
    const picker = get().branchPicker;
    if (!picker || picker.busy) {
      return;
    }
    set({ branchPicker: { ...picker, busy: true, error: undefined } });
    try {
      await request('branch.compare', { repoId: picker.repoId, name });
      set({ branchPicker: null });
    } catch (err) {
      const current = get().branchPicker;
      if (current) {
        set({ branchPicker: { ...current, busy: false, error: (err as ProtocolError).message } });
      }
    }
  },

  pullRepo: async (repoId) => {
    if (get().operations[repoId]) {
      return;
    }
    try {
      await request('repo.pull', { repoId });
    } catch (err) {
      set({ lastError: err as ProtocolError });
    }
  },

  pushRepo: async (repoId) => {
    if (get().operations[repoId]) {
      return;
    }
    try {
      await request('repo.push', { repoId });
    } catch (err) {
      set({ lastError: err as ProtocolError });
    }
  },

  openHunkPicker: async (repoId, path, side) => {
    set({ ...OVERLAY_RESET, hunkPicker: { repoId, path, side, hunks: [], binary: false, selected: {}, busy: true } });
    try {
      const result = await request('hunk.list', { repoId, path, side });
      const current = get().hunkPicker;
      if (!current || current.repoId !== repoId || current.path !== path) {
        return;
      }
      set({
        hunkPicker: {
          ...current,
          hunks: result.hunks,
          binary: result.binary,
          selected: Object.fromEntries(result.hunks.map((h) => [h.id, true])),
          busy: false,
        },
      });
    } catch (err) {
      const current = get().hunkPicker;
      if (current) {
        set({ hunkPicker: { ...current, busy: false, error: (err as ProtocolError).message } });
      }
    }
  },

  closeHunkPicker: () => set({ hunkPicker: null }),

  toggleHunk: (id) => {
    const picker = get().hunkPicker;
    if (!picker) {
      return;
    }
    set({ hunkPicker: { ...picker, selected: { ...picker.selected, [id]: !picker.selected[id] } } });
  },

  setAllHunks: (target) => {
    const picker = get().hunkPicker;
    if (!picker) {
      return;
    }
    set({
      hunkPicker: { ...picker, selected: Object.fromEntries(picker.hunks.map((h) => [h.id, target])) },
    });
  },

  applyHunks: async () => {
    const picker = get().hunkPicker;
    if (!picker || picker.busy) {
      return;
    }
    const hunkIds = picker.hunks.filter((h) => picker.selected[h.id]).map((h) => h.id);
    if (hunkIds.length === 0) {
      set({ hunkPicker: null });
      return;
    }
    set({ hunkPicker: { ...picker, busy: true, error: undefined } });
    try {
      if (picker.side === 'worktree') {
        await request('hunk.stage', { repoId: picker.repoId, path: picker.path, hunkIds });
      } else {
        await request('hunk.unstage', { repoId: picker.repoId, path: picker.path, hunkIds });
      }
      set({ hunkPicker: null });
    } catch (err) {
      const current = get().hunkPicker;
      if (current) {
        set({ hunkPicker: { ...current, busy: false, error: (err as ProtocolError).message } });
      }
    }
  },

  openStashPanel: async (repoId) => {
    if (get().stashPanel?.repoId === repoId) {
      set({ stashPanel: null });
      return;
    }
    set({
      ...OVERLAY_RESET,
      stashPanel: {
        repoId, entries: [], busy: true, message: '', includeUntracked: false, stagedOnly: false,
        confirmDrop: null, confirmPop: null,
      },
    });
    try {
      const entries = await request('stash.list', { repoId });
      const current = get().stashPanel;
      if (current?.repoId === repoId) {
        set({ stashPanel: { ...current, entries, busy: false } });
      }
    } catch (err) {
      const current = get().stashPanel;
      if (current) {
        set({ stashPanel: { ...current, busy: false, error: (err as ProtocolError).message } });
      }
    }
  },

  closeStashPanel: () => set({ stashPanel: null }),

  setStashField: (field, value) => {
    const panel = get().stashPanel;
    if (!panel) {
      return;
    }
    set({ stashPanel: { ...panel, [field]: value } });
  },

  createStash: async () => {
    const panel = get().stashPanel;
    if (!panel || panel.busy) {
      return;
    }
    set({ stashPanel: { ...panel, busy: true, error: undefined } });
    try {
      await request('stash.create', {
        repoId: panel.repoId,
        message: panel.message.trim() || undefined,
        includeUntracked: panel.includeUntracked || undefined,
        staged: panel.stagedOnly || undefined,
      });
      const entries = await request('stash.list', { repoId: panel.repoId });
      const current = get().stashPanel;
      if (current) {
        set({ stashPanel: { ...current, entries, busy: false, message: '' } });
      }
    } catch (err) {
      const current = get().stashPanel;
      if (current) {
        set({ stashPanel: { ...current, busy: false, error: (err as ProtocolError).message } });
      }
    }
  },

  applyStash: async (index) => {
    const panel = get().stashPanel;
    if (!panel || panel.busy) {
      return;
    }
    set({ stashPanel: { ...panel, busy: true, error: undefined, confirmDrop: null, confirmPop: null } });
    try {
      await request('stash.apply', { repoId: panel.repoId, index });
      const current = get().stashPanel;
      if (current) {
        set({ stashPanel: { ...current, busy: false } });
      }
    } catch (err) {
      const current = get().stashPanel;
      if (current) {
        set({ stashPanel: { ...current, busy: false, error: (err as ProtocolError).message } });
      }
    }
  },

  requestPopStash: (index) => {
    const panel = get().stashPanel;
    if (panel) {
      set({ stashPanel: { ...panel, confirmPop: index, confirmDrop: null } });
    }
  },

  popStash: async (index) => {
    const panel = get().stashPanel;
    if (!panel || panel.busy) {
      return;
    }
    set({ stashPanel: { ...panel, busy: true, error: undefined, confirmPop: null } });
    try {
      await request('stash.pop', { repoId: panel.repoId, index });
      const entries = await request('stash.list', { repoId: panel.repoId });
      const current = get().stashPanel;
      if (current) {
        set({ stashPanel: { ...current, entries, busy: false } });
      }
    } catch (err) {
      const current = get().stashPanel;
      if (current) {
        set({ stashPanel: { ...current, busy: false, error: (err as ProtocolError).message } });
      }
    }
  },

  requestDropStash: (index) => {
    const panel = get().stashPanel;
    if (panel) {
      set({ stashPanel: { ...panel, confirmDrop: index, confirmPop: null } });
    }
  },

  dropStash: async (index) => {
    const panel = get().stashPanel;
    if (!panel || panel.busy) {
      return;
    }
    set({ stashPanel: { ...panel, busy: true, error: undefined, confirmDrop: null } });
    try {
      await request('stash.drop', { repoId: panel.repoId, index });
      const entries = await request('stash.list', { repoId: panel.repoId });
      const current = get().stashPanel;
      if (current) {
        set({ stashPanel: { ...current, entries, busy: false } });
      }
    } catch (err) {
      const current = get().stashPanel;
      if (current) {
        set({ stashPanel: { ...current, busy: false, error: (err as ProtocolError).message } });
      }
    }
  },

  openShelfPanel: async (repoId) => {
    if (get().shelfPanel?.repoId === repoId) {
      set({ shelfPanel: null });
      return;
    }
    const status = get().repos[repoId];
    const selected: Record<string, boolean> = {};
    for (const c of status?.changes ?? []) {
      if (!c.conflicted && c.kind !== 'untracked') {
        selected[c.path] = true;
      }
    }
    set({
      ...OVERLAY_RESET,
      shelfPanel: { repoId, entries: [], busy: true, name: '', selected, confirmCreate: false, unshelve: null, confirmDelete: null },
    });
    try {
      const entries = await request('shelf.list', { repoId });
      const current = get().shelfPanel;
      if (current?.repoId === repoId) {
        set({ shelfPanel: { ...current, entries, busy: false } });
      }
    } catch (err) {
      const current = get().shelfPanel;
      if (current) {
        set({ shelfPanel: { ...current, busy: false, error: (err as ProtocolError).message } });
      }
    }
  },

  closeShelfPanel: () => set({ shelfPanel: null }),

  setShelfName: (name) => {
    const panel = get().shelfPanel;
    if (panel) {
      set({ shelfPanel: { ...panel, name } });
    }
  },

  toggleShelfFile: (path) => {
    const panel = get().shelfPanel;
    if (panel) {
      set({ shelfPanel: { ...panel, selected: { ...panel.selected, [path]: !panel.selected[path] } } });
    }
  },

  requestShelfCreate: () => {
    const panel = get().shelfPanel;
    if (!panel || panel.busy) {
      return;
    }
    if (!panel.name.trim()) {
      set({ shelfPanel: { ...panel, error: '请输入 Shelf 名称' } });
      return;
    }
    if (!Object.values(panel.selected).some(Boolean)) {
      set({ shelfPanel: { ...panel, error: '至少选择一个文件' } });
      return;
    }
    set({ shelfPanel: { ...panel, confirmCreate: true, error: undefined } });
  },

  cancelShelfCreate: () => {
    const panel = get().shelfPanel;
    if (panel) {
      set({ shelfPanel: { ...panel, confirmCreate: false } });
    }
  },

  confirmShelfCreate: async () => {
    const panel = get().shelfPanel;
    if (!panel || panel.busy) {
      return;
    }
    const paths = Object.entries(panel.selected).filter(([, v]) => v).map(([p]) => p);
    set({ shelfPanel: { ...panel, busy: true, error: undefined } });
    try {
      await request('shelf.create', { repoId: panel.repoId, name: panel.name.trim(), paths });
      await reloadShelfEntries(panel.repoId);
      const current = get().shelfPanel;
      if (current) {
        const selected: Record<string, boolean> = {};
        for (const c of get().repos[panel.repoId]?.changes ?? []) {
          if (!c.conflicted && c.kind !== 'untracked') {
            selected[c.path] = true;
          }
        }
        set({ shelfPanel: { ...current, busy: false, name: '', selected, confirmCreate: false } });
      }
    } catch (err) {
      const current = get().shelfPanel;
      if (current) {
        set({ shelfPanel: { ...current, busy: false, confirmCreate: false, error: (err as ProtocolError).message } });
      }
    }
  },

  openUnshelve: (id) => {
    const panel = get().shelfPanel;
    if (!panel) {
      return;
    }
    if (!id) {
      set({ shelfPanel: { ...panel, unshelve: null } });
      return;
    }
    const entry = panel.entries.find((e) => e.id === id);
    if (!entry) {
      return;
    }
    const selected: Record<string, boolean> = {};
    for (const f of entry.files) {
      selected[f] = true;
    }
    set({ shelfPanel: { ...panel, unshelve: { id, selected, removeAfter: false }, confirmDelete: null } });
  },

  toggleUnshelveFile: (path) => {
    const panel = get().shelfPanel;
    if (panel?.unshelve) {
      set({
        shelfPanel: {
          ...panel,
          unshelve: { ...panel.unshelve, selected: { ...panel.unshelve.selected, [path]: !panel.unshelve.selected[path] } },
        },
      });
    }
  },

  setUnshelveRemoveAfter: (value) => {
    const panel = get().shelfPanel;
    if (panel?.unshelve) {
      set({ shelfPanel: { ...panel, unshelve: { ...panel.unshelve, removeAfter: value } } });
    }
  },

  doUnshelve: async () => {
    const panel = get().shelfPanel;
    if (!panel?.unshelve || panel.busy) {
      return;
    }
    const u = panel.unshelve;
    const entry = panel.entries.find((e) => e.id === u.id);
    const paths = Object.entries(u.selected).filter(([, v]) => v).map(([p]) => p);
    if (!entry || paths.length === 0) {
      set({ shelfPanel: { ...panel, error: '至少选择一个恢复文件' } });
      return;
    }
    set({ shelfPanel: { ...panel, busy: true, error: undefined } });
    try {
      await request('shelf.unshelve', {
        repoId: panel.repoId,
        id: u.id,
        paths: paths.length === entry.files.length ? undefined : paths,
        removeAfter: u.removeAfter || undefined,
      });
      await reloadShelfEntries(panel.repoId);
      const current = get().shelfPanel;
      if (current) {
        set({ shelfPanel: { ...current, busy: false, unshelve: null } });
      }
    } catch (err) {
      const current = get().shelfPanel;
      if (current) {
        set({ shelfPanel: { ...current, busy: false, error: (err as ProtocolError).message } });
      }
    }
  },

  requestShelfDelete: (id) => {
    const panel = get().shelfPanel;
    if (panel) {
      set({ shelfPanel: { ...panel, confirmDelete: id } });
    }
  },

  confirmShelfDelete: async () => {
    const panel = get().shelfPanel;
    if (!panel?.confirmDelete || panel.busy) {
      return;
    }
    const id = panel.confirmDelete;
    set({ shelfPanel: { ...panel, busy: true, error: undefined } });
    try {
      await request('shelf.delete', { repoId: panel.repoId, id });
      await reloadShelfEntries(panel.repoId);
      const current = get().shelfPanel;
      if (current) {
        set({
          shelfPanel: {
            ...current,
            busy: false,
            confirmDelete: null,
            unshelve: current.unshelve?.id === id ? null : current.unshelve,
          },
        });
      }
    } catch (err) {
      const current = get().shelfPanel;
      if (current) {
        set({ shelfPanel: { ...current, busy: false, error: (err as ProtocolError).message } });
      }
    }
  },

  openLogPanel: async (repoId) => {
    if (get().logPanel?.repoId === repoId) {
      set({ logPanel: null });
      return;
    }
    set({ ...OVERLAY_RESET, logPanel: { repoId, entries: [], hasMore: false, busy: true, author: '', grep: '', confirm: null } });
    try {
      const page = await request('log.list', { repoId });
      const current = get().logPanel;
      if (current?.repoId === repoId) {
        set({ logPanel: { ...current, entries: page.entries, hasMore: page.hasMore, busy: false } });
      }
    } catch (err) {
      const current = get().logPanel;
      if (current) {
        set({ logPanel: { ...current, busy: false, error: (err as ProtocolError).message } });
      }
    }
  },

  closeLogPanel: () => set({ logPanel: null }),

  setLogField: (field, value) => {
    const panel = get().logPanel;
    if (panel) {
      set({ logPanel: { ...panel, [field]: value } });
    }
  },

  reloadLog: async () => {
    const panel = get().logPanel;
    if (!panel || panel.busy) {
      return;
    }
    set({ logPanel: { ...panel, busy: true, error: undefined } });
    try {
      const page = await request('log.list', {
        repoId: panel.repoId,
        author: panel.author.trim() || undefined,
        grep: panel.grep.trim() || undefined,
      });
      const current = get().logPanel;
      if (current) {
        set({ logPanel: { ...current, entries: page.entries, hasMore: page.hasMore, busy: false } });
      }
    } catch (err) {
      const current = get().logPanel;
      if (current) {
        set({ logPanel: { ...current, busy: false, error: (err as ProtocolError).message } });
      }
    }
  },

  loadMoreLog: async () => {
    const panel = get().logPanel;
    if (!panel || panel.busy || !panel.hasMore) {
      return;
    }
    set({ logPanel: { ...panel, busy: true, error: undefined } });
    try {
      const page = await request('log.list', {
        repoId: panel.repoId,
        skip: panel.entries.length,
        author: panel.author.trim() || undefined,
        grep: panel.grep.trim() || undefined,
      });
      const current = get().logPanel;
      if (current) {
        set({
          logPanel: { ...current, entries: [...current.entries, ...page.entries], hasMore: page.hasMore, busy: false },
        });
      }
    } catch (err) {
      const current = get().logPanel;
      if (current) {
        set({ logPanel: { ...current, busy: false, error: (err as ProtocolError).message } });
      }
    }
  },

  requestLogAction: (kind, oid) => {
    const panel = get().logPanel;
    if (panel && !panel.busy) {
      set({ logPanel: { ...panel, confirm: { kind, oid }, error: undefined } });
    }
  },

  cancelLogAction: () => {
    const panel = get().logPanel;
    if (panel) {
      set({ logPanel: { ...panel, confirm: null } });
    }
  },

  confirmLogAction: async () => {
    const panel = get().logPanel;
    if (!panel?.confirm || panel.busy) {
      return;
    }
    const { kind, oid } = panel.confirm;
    set({ logPanel: { ...panel, busy: true, confirm: null, error: undefined } });
    try {
      await request(kind === 'cherry-pick' ? 'log.cherryPick' : 'log.revert', { repoId: panel.repoId, oid });
      const done = get().logPanel;
      if (done) {
        set({ logPanel: { ...done, busy: false } });
      }
      await get().reloadLog();
    } catch (err) {
      const current = get().logPanel;
      if (current) {
        set({ logPanel: { ...current, busy: false, error: (err as ProtocolError).message } });
      }
      set({ lastError: err as ProtocolError });
    }
  },

  requestAbortMerge: (repoId) => set(repoId ? { ...OVERLAY_RESET, abortConfirm: repoId } : { abortConfirm: null }),

  confirmAbortMerge: async () => {
    const repoId = get().abortConfirm;
    if (!repoId) {
      return;
    }
    set({ abortConfirm: null });
    try {
      await request('merge.abort', { repoId });
    } catch (err) {
      set({ lastError: err as ProtocolError });
    }
  },

  requestUndoCommit: (repoId) => set(repoId ? { ...OVERLAY_RESET, undoConfirm: repoId } : { undoConfirm: null }),

  confirmUndoCommit: async () => {
    const repoId = get().undoConfirm;
    if (!repoId) {
      return;
    }
    set({ undoConfirm: null });
    try {
      await request('commit.undo', { repoId });
    } catch (err) {
      set({ lastError: err as ProtocolError });
    }
  },

  openMergeEditor: async (repoId, path) => {
    try {
      await request('merge.openEditor', { repoId, path });
    } catch (err) {
      set({ lastError: err as ProtocolError });
    }
  },

  commit: async (opts) => {
    const { repos, repoOrder, message, committing, options } = get();
    if (committing) {
      return;
    }
    const noVerify = opts?.noVerify ?? options.noVerify;
    if (noVerify && !opts?.confirmed) {
      set({ confirmNoVerify: true });
      return;
    }
    const amend = options.amend;
    let repoIds = repoOrder.filter((id) => {
      const status = repos[id];
      return status && stagedPaths(status).length > 0;
    });
    if (repoIds.length === 0 && amend && repoOrder.length === 1 && repoOrder[0]) {
      repoIds = [repoOrder[0]];
    }
    if (repoIds.length === 0) {
      return;
    }
    if (!amend && !message.trim()) {
      return;
    }
    // amend rewrites HEAD; the staged-set contract does not apply
    const expectedStaged: Record<string, string[]> | undefined = amend
      ? undefined
      : Object.fromEntries(repoIds.map((id) => [id, stagedPaths(repos[id] as RepoStatus)]));
    set({ committing: true, results: null, lastError: null, confirmNoVerify: false });
    const started = performance.now();
    try {
      const results = await request('commit.run', {
        repoIds,
        message,
        amend: amend || undefined,
        signoff: options.signoff || undefined,
        noVerify: noVerify || undefined,
        pushAfter: opts?.pushAfter,
        expectedStaged,
      });
      sendMetric('commit.roundtrip', performance.now() - started);
      const allOk = results.every((r) => r.ok);
      set({
        results,
        committing: false,
        message: allOk && get().settings?.clearMessageOnSuccess ? '' : get().message,
        options: allOk ? { ...get().options, amend: false } : get().options,
      });
    } catch (err) {
      set({ committing: false, lastError: err as ProtocolError });
    }
  },

  cancelRemaining: () => {
    void request('batch.cancelRemaining', undefined).catch(() => {});
  },

  openDiff: async (repoId, path, side, force) => {
    try {
      await request('diff.open', { repoId, path, side, force });
    } catch (err) {
      set({ lastError: err as ProtocolError });
    }
  },

  showCommit: async (repoId, oid) => {
    try {
      await request('commit.show', { repoId, oid });
    } catch (err) {
      set({ lastError: err as ProtocolError });
    }
  },

  runAction: async (action, error, repoId) => {
    try {
      switch (action) {
        case 'showGitOutput':
          await request('ui.showGitOutput', undefined);
          break;
        case 'retryInTerminal':
          if (repoId) {
            await request('ui.retryInTerminal', { repoId, command: error.terminalCommand ?? 'git status' });
          }
          break;
        case 'openGitSettings':
        case 'enableGitExtension':
          await request('ui.openGitSettings', undefined);
          break;
        case 'skipHooksRetry':
          set({ confirmNoVerify: true });
          break;
        case 'retry':
          await get().commit({ confirmed: true });
          break;
        case 'forceOpenDiff':
          if (error.diffContext) {
            const { repoId: rid, path, side } = error.diffContext;
            await get().openDiff(rid, path, side, true);
            set({ lastError: null });
          }
          break;
        case 'openMergeEditor': {
          const target = repoId ?? get().repoOrder[0];
          const status = target ? get().repos[target] : undefined;
          const conflicted = status?.changes.find((c) => c.conflicted);
          if (target && conflicted) {
            await get().openDiff(target, conflicted.path, 'worktree');
          } else {
            await request('ui.showGitOutput', undefined);
          }
          break;
        }
        case 'abortSequencer': {
          const target = repoId ?? get().logPanel?.repoId ?? get().repoOrder[0];
          if (target) {
            get().requestAbortMerge(target);
          }
          break;
        }
      }
    } catch (err) {
      set({ lastError: err as ProtocolError });
    }
  },
}));

async function reloadShelfEntries(repoId: string): Promise<void> {
  const entries = await request('shelf.list', { repoId });
  const current = usePanelStore.getState().shelfPanel;
  if (current?.repoId === repoId) {
    usePanelStore.setState({ shelfPanel: { ...current, entries } });
  }
}

async function maybeAutoStage(status: RepoStatus): Promise<void> {
  const store = usePanelStore.getState();
  const settings = store.settings;
  if (!settings?.defaultSelectAll || store.autoStaged[status.repo.id]) {
    return;
  }
  usePanelStore.setState({ autoStaged: { ...store.autoStaged, [status.repo.id]: true } });
  const tracked = status.changes.filter(
    (c) => !c.staged && !c.conflicted && c.worktreeStatus !== null && c.worktreeStatus !== '?',
  );
  const untracked = settings.selectUntracked
    ? status.changes.filter((c) => c.kind === 'untracked' && !c.staged)
    : [];
  const paths = [...tracked, ...untracked].map((c) => c.path);
  if (paths.length > 0) {
    try {
      await request('index.stage', { repoId: status.repo.id, paths });
    } catch {
      // state events will reconcile; surfacing an error here on every load is noise
    }
  }
}

export function subscribeEvents(): () => void {
  const store = usePanelStore.getState();
  const offs = [
    onEvent('status.changed', ({ status }) => usePanelStore.getState().applyStatus(status)),
    onEvent('repo.closed', ({ repoId }) => usePanelStore.getState().removeRepo(repoId)),
    onEvent('operation.progress', ({ operation }) => usePanelStore.getState().setOperation(operation)),
    onEvent('panel.state', ({ panelState }) => usePanelStore.getState().setPanelState(panelState)),
    onEvent('ui.command', ({ command }) => {
      if (command === 'commit') {
        void usePanelStore.getState().commit();
      }
    }),
  ];
  void store.init();
  return () => offs.forEach((off) => off());
}