import type { ProtocolError } from '../../../protocol/errors';
import type { ChangelistFileRef } from '../../../protocol/models';
import { STRINGS } from '../../strings/en';
import type { Slice } from '../types';

export const shelfSlice: Slice = (set, get, ctx) => {
  const fail = (err: unknown): void => {
    const error = err as ProtocolError;
    if (get().dialog) {
      set({ dialogBusy: false, dialogError: error.message });
    } else {
      set({ shelfTab: get().shelfTab ? { ...get().shelfTab!, busy: false, error: error.message } : null, lastError: error });
    }
  };

  const reload = async (repoId: string): Promise<void> => {
    const entries = await ctx.request('shelf.list', { repoId });
    const tab = get().shelfTab;
    if (tab?.repoId === repoId) {
      set({ shelfTab: { ...tab, entries, busy: false } });
    }
  };

  return {
    shelfTab: null,

    openShelfTab: async (repoId) => {
      const current = get().shelfTab;
      const target = repoId ?? current?.repoId ?? get().repoOrder[0];
      if (!target) {
        return;
      }
      set({ shelfTab: { repoId: target, entries: current?.repoId === target ? current.entries : [], busy: true } });
      try {
        await reload(target);
      } catch (err) {
        fail(err);
      }
    },

    reloadShelf: async () => {
      const tab = get().shelfTab;
      if (!tab) {
        return;
      }
      try {
        await reload(tab.repoId);
      } catch (err) {
        fail(err);
      }
    },

    requestShelve: (repoId, refs) => {
      const status = get().repos[repoId];
      const selected: Record<string, boolean> = {};
      for (const ref of refs) {
        const change = status?.changes.find((c) => c.path === ref.path);
        if (change && !change.conflicted && change.kind !== 'untracked') {
          selected[ref.path] = true;
        }
      }
      if (refs.length === 0 && status) {
        for (const c of status.changes) {
          if (!c.conflicted && c.kind !== 'untracked') {
            selected[c.path] = true;
          }
        }
      }
      set({
        dialog: { kind: 'shelve', repoId, refs, name: STRINGS.dialogs.shelveDefaultName, selected },
        dialogBusy: false,
        dialogError: undefined,
        contextMenu: null,
      });
    },

    confirmShelve: async () => {
      const dialog = get().dialog;
      if (dialog?.kind !== 'shelve' || get().dialogBusy) {
        return;
      }
      const name = dialog.name.trim();
      const paths = Object.entries(dialog.selected).filter(([, v]) => v).map(([p]) => p);
      if (!name) {
        set({ dialogError: STRINGS.shelf.nameRequired });
        return;
      }
      if (paths.length === 0) {
        set({ dialogError: STRINGS.shelf.filesRequired });
        return;
      }
      set({ dialogBusy: true });
      try {
        await ctx.request('shelf.create', { repoId: dialog.repoId, name, paths });
        await reload(dialog.repoId);
        set({ dialog: null, dialogBusy: false });
      } catch (err) {
        fail(err);
      }
    },

    requestUnshelve: (repoId, id) => {
      const entry = get().shelfTab?.entries.find((e) => e.id === id);
      if (!entry) {
        return;
      }
      const selected: Record<string, boolean> = {};
      for (const f of entry.files) {
        selected[f] = true;
      }
      set({
        dialog: {
          kind: 'unshelve',
          repoId,
          id,
          files: entry.files,
          selected,
          removeAfter: false,
          targetListId: get().changelists?.activeId ?? 'default',
        },
        dialogBusy: false,
        dialogError: undefined,
        contextMenu: null,
      });
    },

    unshelveSingleFile: (repoId, id, path) => {
      get().requestUnshelve(repoId, id);
      const dialog = get().dialog;
      if (dialog?.kind === 'unshelve') {
        const selected: Record<string, boolean> = {};
        for (const f of dialog.files) {
          selected[f] = f === path;
        }
        set({ dialog: { ...dialog, selected } });
      }
    },

    confirmUnshelve: async () => {
      const dialog = get().dialog;
      if (dialog?.kind !== 'unshelve' || get().dialogBusy) {
        return;
      }
      const paths = Object.entries(dialog.selected).filter(([, v]) => v).map(([p]) => p);
      if (paths.length === 0) {
        set({ dialogError: STRINGS.shelf.unshelveFilesRequired });
        return;
      }
      set({ dialogBusy: true });
      try {
        await ctx.request('shelf.unshelve', {
          repoId: dialog.repoId,
          id: dialog.id,
          paths: paths.length === dialog.files.length ? undefined : paths,
          removeAfter: dialog.removeAfter || undefined,
        });
        const activeId = get().changelists?.activeId;
        if (get().mode === 'changelist' && activeId && dialog.targetListId !== activeId) {
          const refs: ChangelistFileRef[] = paths.map((path) => ({ repoId: dialog.repoId, path }));
          await ctx.request('changelist.move', { refs, targetId: dialog.targetListId, force: true }).catch(() => {});
        }
        await reload(dialog.repoId);
        set({ dialog: null, dialogBusy: false });
      } catch (err) {
        fail(err);
      }
    },

    restoreShelf: async (repoId, id) => {
      try {
        await ctx.request('shelf.unshelve', { repoId, id, removeAfter: true });
        await reload(repoId);
      } catch (err) {
        fail(err);
      }
    },

    requestDeleteShelf: (repoId, id) =>
      set({ dialog: { kind: 'deleteShelf', repoId, id }, dialogBusy: false, dialogError: undefined, contextMenu: null }),

    confirmDeleteShelf: async () => {
      const dialog = get().dialog;
      if (dialog?.kind !== 'deleteShelf' || get().dialogBusy) {
        return;
      }
      set({ dialogBusy: true });
      try {
        await ctx.request('shelf.delete', { repoId: dialog.repoId, id: dialog.id });
        await reload(dialog.repoId);
        set({ dialog: null, dialogBusy: false });
      } catch (err) {
        fail(err);
      }
    },
  };
};