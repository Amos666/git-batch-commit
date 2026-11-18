import type { ProtocolError } from '../../../protocol/errors';
import type { RepoStatus } from '../../../protocol/models';
import { DEFAULT_OPTIONS } from '../types';
import type { Slice } from '../types';

export const coreSlice: Slice = (set, get, ctx) => ({
  panelState: 'initializing',
  settings: null,
  capabilities: null,
  checksAvailability: [],
  repos: {},
  repoOrder: [],
  operations: {},
  lastError: null,
  indexModifiedRepos: [],
  protocolMismatch: false,
  optionsState: DEFAULT_OPTIONS,
  checksRunning: [],

  init: async () => {
    const started = performance.now();
    try {
      const result = await ctx.request('panel.init', undefined);
      const repos: Record<string, RepoStatus> = {};
      for (const status of result.repos) {
        repos[status.repo.id] = status;
      }
      set({
        panelState: result.panelState,
        unavailableReason: result.unavailableReason,
        settings: result.settings,
        capabilities: result.capabilities,
        checksAvailability: result.checks,
        changelists: result.changelists,
        mode: result.changelists.mode,
        repos,
        repoOrder: result.repos.map((r) => r.repo.id),
      });
      ctx.metric('panel.init', performance.now() - started);
      const first = result.repos[0];
      if (first) {
        set({
          shelfTab: { repoId: first.repo.id, entries: [], busy: false },
          stashTab: { repoId: first.repo.id, entries: [], busy: false },
          logView: { repoId: first.repo.id, entries: [], hasMore: false, busy: false, author: '', grep: '', confirm: null },
        });
      }
      void ctx.request('options.get', undefined)
        .then((options) => set({ optionsState: options }))
        .catch(() => {});
      if (result.panelState === 'ready' && !get().message) {
        void ctx.request('commit.template', undefined)
          .then((template) => {
            if (template && !get().message) {
              set({ message: template });
            }
          })
          .catch(() => {});
      }
    } catch (err) {
      const error = err as ProtocolError;
      if (error.code === 'PROTOCOL_MISMATCH') {
        set({ protocolMismatch: true });
      } else {
        set({ lastError: error });
      }
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
      const first = get().shelfTab;
      if (!first) {
        set({
          shelfTab: { repoId: status.repo.id, entries: [], busy: false },
          stashTab: { repoId: status.repo.id, entries: [], busy: false },
          logView: { repoId: status.repo.id, entries: [], hasMore: false, busy: false, author: '', grep: '', confirm: null },
        });
      }
    }
  },

  removeRepo: (repoId) => {
    const { repos, repoOrder, operations, branchPicker, shelfTab, stashTab, logView, dialog, indexModifiedRepos } = get();
    const next = { ...repos };
    delete next[repoId];
    const nextOps = { ...operations };
    delete nextOps[repoId];
    const fallback = repoOrder.find((id) => id !== repoId);
    set({
      repos: next,
      repoOrder: repoOrder.filter((id) => id !== repoId),
      operations: nextOps,
      indexModifiedRepos: indexModifiedRepos.filter((id) => id !== repoId),
      branchPicker: branchPicker?.repoId === repoId ? null : branchPicker,
      shelfTab: shelfTab?.repoId === repoId ? (fallback ? { repoId: fallback, entries: [], busy: false } : null) : shelfTab,
      stashTab: stashTab?.repoId === repoId ? (fallback ? { repoId: fallback, entries: [], busy: false } : null) : stashTab,
      logView: logView?.repoId === repoId ? (fallback ? { repoId: fallback, entries: [], hasMore: false, busy: false, author: '', grep: '', confirm: null } : null) : logView,
      dialog: dialog && 'repoId' in dialog && dialog.repoId === repoId ? null : dialog,
    });
  },

  setPanelState: (panelState, reason) => set({ panelState, unavailableReason: reason }),

  setOperation: (op) => {
    const operations = { ...get().operations };
    if (op.phase === 'done' || op.phase === 'failed' || op.phase === 'cancelled') {
      delete operations[op.repoId];
    } else {
      operations[op.repoId] = op;
    }
    set({ operations });
  },

  dismissError: () => set({ lastError: null }),

  dismissIndexModified: (repoId) =>
    set({ indexModifiedRepos: get().indexModifiedRepos.filter((id) => id !== repoId) }),

  refresh: async (repoId) => {
    try {
      const statuses = await ctx.request('status.refresh', repoId ? { repoId } : {});
      for (const status of statuses) {
        get().applyStatus(status);
      }
    } catch (err) {
      set({ lastError: err as ProtocolError });
    }
  },

  reloadWindow: async () => {
    await ctx.request('ui.reloadWindow', undefined);
  },
});