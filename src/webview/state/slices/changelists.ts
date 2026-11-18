import type { ProtocolError } from '../../../protocol/errors';
import type { ChangelistFileRef, RepoStatus } from '../../../protocol/models';
import { refKey } from '../types';
import type { Slice } from '../types';

function sameRef(a: ChangelistFileRef, b: ChangelistFileRef): boolean {
  return a.repoId === b.repoId && a.path === b.path;
}

export const changelistsSlice: Slice = (set, get, ctx) => {
  const fail = (err: unknown): void => {
    const error = err as ProtocolError;
    if (get().dialog) {
      set({ dialogBusy: false, dialogError: error.message });
    } else {
      set({ dialogBusy: false, lastError: error });
    }
  };

  const optimisticIncluded = (refs: ChangelistFileRef[], included: boolean): void => {
    const state = get().changelists;
    if (!state) {
      return;
    }
    const keys = new Set(refs.map((r) => refKey(r.repoId, r.path)));
    // mirror the host routing: list-owned (tracked) refs go to list.checked,
    // everything else is unversioned — never both, or commits see duplicates
    const owned = new Set(state.lists.flatMap((l) => l.files.map((f) => refKey(f.repoId, f.path))));
    const lists = state.lists.map((list) => {
      const checkedKeys = new Set(list.checked.map((c) => refKey(c.repoId, c.path)));
      return {
        ...list,
        checked: included
          ? [...list.checked, ...list.files.filter((f) => keys.has(refKey(f.repoId, f.path)) && !checkedKeys.has(refKey(f.repoId, f.path)))]
          : list.checked.filter((c) => !keys.has(refKey(c.repoId, c.path))),
      };
    });
    const unversionedRefs = refs.filter((r) => !owned.has(refKey(r.repoId, r.path)));
    const unversionedChecked = included
      ? [...state.unversionedChecked, ...unversionedRefs.filter((r) => !state.unversionedChecked.some((c) => sameRef(c, r)))]
      : state.unversionedChecked.filter((c) => !keys.has(refKey(c.repoId, c.path)));
    set({ changelists: { ...state, lists, unversionedChecked } });
  };

  const stagingToggle = async (refs: ChangelistFileRef[], included: boolean): Promise<void> => {
    const byRepo = new Map<string, string[]>();
    for (const ref of refs) {
      const status = get().repos[ref.repoId];
      const change = status?.changes.find((c) => c.path === ref.path);
      if (!change || change.conflicted) {
        continue;
      }
      const arr = byRepo.get(ref.repoId) ?? [];
      arr.push(ref.path);
      byRepo.set(ref.repoId, arr);
    }
    const snapshots: Record<string, RepoStatus> = {};
    const repos = { ...get().repos };
    for (const [repoId, paths] of byRepo) {
      const snapshot = repos[repoId];
      if (!snapshot) {
        continue;
      }
      snapshots[repoId] = snapshot;
      const selected = new Set(paths);
      repos[repoId] = {
        ...snapshot,
        changes: snapshot.changes.map((c) =>
          selected.has(c.path) && !c.conflicted
            ? { ...c, staged: included, indexStatus: included ? (c.worktreeStatus ?? c.indexStatus ?? 'M') : null }
            : c,
        ),
      };
    }
    set({ repos });
    try {
      for (const [repoId, paths] of byRepo) {
        await ctx.request(included ? 'index.stage' : 'index.unstage', { repoId, paths });
      }
    } catch (err) {
      set({ repos: { ...get().repos, ...snapshots } });
      fail(err);
    }
  };

  return {
    changelists: null,
    mode: 'changelist',

    applyChangelists: (state) => set({ changelists: state, mode: state.mode }),
    applyMode: (mode) => set({ mode }),

    setIncluded: async (refs, included) => {
      if (refs.length === 0) {
        return;
      }
      if (get().mode === 'staging') {
        await stagingToggle(refs, included);
        return;
      }
      optimisticIncluded(refs, included);
      try {
        await ctx.request('inclusion.set', { refs, included });
      } catch (err) {
        fail(err);
        void ctx.request('changelist.list', undefined).then((state) => set({ changelists: state })).catch(() => {});
      }
    },

    toggleIncluded: async (ref) => {
      const s = get();
      let included: boolean;
      if (s.mode === 'staging') {
        included = s.repos[ref.repoId]?.changes.find((c) => c.path === ref.path)?.staged ?? false;
      } else {
        const key = refKey(ref.repoId, ref.path);
        const inList = s.changelists?.lists.some((l) => l.checked.some((c) => refKey(c.repoId, c.path) === key)) ?? false;
        const inUnversioned = s.changelists?.unversionedChecked.some((c) => refKey(c.repoId, c.path) === key) ?? false;
        included = inList || inUnversioned;
      }
      await s.setIncluded([ref], !included);
    },

    setPartial: async (repoId, path, selection) => {
      try {
        await ctx.request('inclusion.setPartial', { repoId, path, selection });
      } catch (err) {
        fail(err);
      }
    },

    createChangelist: async (name, comment) => {
      set({ dialogBusy: true });
      try {
        await ctx.request('changelist.create', { name, comment: comment || undefined });
        set({ dialog: null, dialogBusy: false });
      } catch (err) {
        fail(err);
      }
    },

    renameChangelist: async (id, name) => {
      set({ dialogBusy: true });
      try {
        await ctx.request('changelist.rename', { id, name });
        set({ dialog: null, dialogBusy: false });
      } catch (err) {
        fail(err);
      }
    },

    removeChangelist: async (id) => {
      set({ dialogBusy: true });
      try {
        await ctx.request('changelist.remove', { id });
        set({ dialog: null, dialogBusy: false });
      } catch (err) {
        fail(err);
      }
    },

    setActiveChangelist: async (id) => {
      try {
        await ctx.request('changelist.setActive', { id });
        set({ dialog: null });
      } catch (err) {
        fail(err);
      }
    },

    setChangelistComment: async (id, comment) => {
      set({ dialogBusy: true });
      try {
        await ctx.request('changelist.setComment', { id, comment });
        set({ dialog: null, dialogBusy: false });
      } catch (err) {
        fail(err);
      }
    },

    moveFiles: async (refs, targetId, force) => {
      try {
        await ctx.request('changelist.move', { refs, targetId, force });
        set({ dialog: null, dialogBusy: false });
      } catch (err) {
        const error = err as ProtocolError;
        if (error.code === 'CHANGELIST_CONFLICT' && error.conflictContext && !force) {
          set({
            dialogBusy: false,
            dialog: { kind: 'changelistConflict', refs, targetId, conflict: error.conflictContext },
          });
          return;
        }
        fail(err);
      }
    },

    requestModeSwitch: async (mode) => {
      if (mode === get().mode) {
        return;
      }
      try {
        const preview = await ctx.request('mode.previewMigration', { mode });
        set({ dialog: { kind: 'modeSwitch', mode, preview }, dialogBusy: false, dialogError: undefined });
      } catch (err) {
        fail(err);
      }
    },

    confirmModeSwitch: async () => {
      const dialog = get().dialog;
      if (dialog?.kind !== 'modeSwitch' || get().dialogBusy) {
        return;
      }
      set({ dialogBusy: true });
      try {
        await ctx.request('mode.set', { mode: dialog.mode, confirm: true });
        set({ dialog: null, dialogBusy: false });
      } catch (err) {
        fail(err);
      }
    },
  };
};