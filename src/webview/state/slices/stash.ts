import type { ProtocolError } from '../../../protocol/errors';
import type { Slice } from '../types';

export const stashSlice: Slice = (set, get, ctx) => {
  const fail = (err: unknown): void => {
    const error = err as ProtocolError;
    if (get().dialog) {
      set({ dialogBusy: false, dialogError: error.message });
    } else {
      const tab = get().stashTab;
      set({ stashTab: tab ? { ...tab, busy: false, error: error.message } : null, lastError: error });
    }
  };

  const reload = async (repoId: string): Promise<void> => {
    const entries = await ctx.request('stash.list', { repoId });
    const tab = get().stashTab;
    if (tab?.repoId === repoId) {
      set({ stashTab: { ...tab, entries, busy: false } });
    }
  };

  return {
    stashTab: null,

    openStashTab: async (repoId) => {
      const current = get().stashTab;
      const target = repoId ?? current?.repoId ?? get().repoOrder[0];
      if (!target) {
        return;
      }
      set({ stashTab: { repoId: target, entries: current?.repoId === target ? current.entries : [], busy: true } });
      try {
        await reload(target);
      } catch (err) {
        fail(err);
      }
    },

    reloadStash: async () => {
      const tab = get().stashTab;
      if (!tab) {
        return;
      }
      try {
        await reload(tab.repoId);
      } catch (err) {
        fail(err);
      }
    },

    requestStashCreate: (repoId) =>
      set({
        dialog: { kind: 'stashCreate', repoId, message: '', includeUntracked: false, stagedOnly: false },
        dialogBusy: false,
        dialogError: undefined,
        contextMenu: null,
      }),

    confirmStashCreate: async () => {
      const dialog = get().dialog;
      if (dialog?.kind !== 'stashCreate' || get().dialogBusy) {
        return;
      }
      set({ dialogBusy: true });
      try {
        await ctx.request('stash.create', {
          repoId: dialog.repoId,
          message: dialog.message.trim() || undefined,
          includeUntracked: dialog.includeUntracked || undefined,
          staged: dialog.stagedOnly || undefined,
        });
        await reload(dialog.repoId);
        set({ dialog: null, dialogBusy: false });
      } catch (err) {
        fail(err);
      }
    },

    applyStash: async (repoId, index) => {
      try {
        await ctx.request('stash.apply', { repoId, index });
        await reload(repoId);
      } catch (err) {
        fail(err);
      }
    },

    requestPopStash: (repoId, index) =>
      set({ dialog: { kind: 'popStash', repoId, index }, dialogBusy: false, dialogError: undefined, contextMenu: null }),

    confirmPopStash: async () => {
      const dialog = get().dialog;
      if (dialog?.kind !== 'popStash' || get().dialogBusy) {
        return;
      }
      set({ dialogBusy: true });
      try {
        await ctx.request('stash.pop', { repoId: dialog.repoId, index: dialog.index });
        await reload(dialog.repoId);
        set({ dialog: null, dialogBusy: false });
      } catch (err) {
        fail(err);
      }
    },

    requestDropStash: (repoId, index) =>
      set({ dialog: { kind: 'dropStash', repoId, index }, dialogBusy: false, dialogError: undefined, contextMenu: null }),

    confirmDropStash: async () => {
      const dialog = get().dialog;
      if (dialog?.kind !== 'dropStash' || get().dialogBusy) {
        return;
      }
      set({ dialogBusy: true });
      try {
        await ctx.request('stash.drop', { repoId: dialog.repoId, index: dialog.index });
        await reload(dialog.repoId);
        set({ dialog: null, dialogBusy: false });
      } catch (err) {
        fail(err);
      }
    },
  };
};