import type { ProtocolError } from '../../../protocol/errors';
import type { ChangelistFileRef } from '../../../protocol/models';
import type { Slice } from '../types';

export const filesSlice: Slice = (set, get, ctx) => {
  const fail = (err: unknown): void => {
    const error = err as ProtocolError;
    if (get().dialog) {
      set({ dialogBusy: false, dialogError: error.message });
    } else {
      set({ lastError: error });
    }
  };

  const byRepo = (refs: ChangelistFileRef[]): Map<string, string[]> => {
    const map = new Map<string, string[]>();
    for (const ref of refs) {
      const arr = map.get(ref.repoId) ?? [];
      arr.push(ref.path);
      map.set(ref.repoId, arr);
    }
    return map;
  };

  return {
    rollbackFiles: async (refs) => {
      if (refs.length === 0) {
        return;
      }
      set({ dialogBusy: true });
      try {
        for (const [repoId, paths] of byRepo(refs)) {
          await ctx.request('files.rollback', { repoId, paths });
        }
        set({ dialog: null, dialogBusy: false, highlighted: [] });
      } catch (err) {
        fail(err);
      }
    },

    deleteFiles: async (refs) => {
      if (refs.length === 0) {
        return;
      }
      set({ dialogBusy: true });
      try {
        for (const [repoId, paths] of byRepo(refs)) {
          await ctx.request('files.delete', { repoId, paths });
        }
        set({ dialog: null, dialogBusy: false, highlighted: [] });
      } catch (err) {
        fail(err);
      }
    },

    openFile: async (repoId, path) => {
      try {
        await ctx.request('files.open', { repoId, path });
      } catch (err) {
        fail(err);
      }
    },

    revealFile: async (repoId, path) => {
      try {
        await ctx.request('files.reveal', { repoId, path });
      } catch (err) {
        fail(err);
      }
    },

    copyText: async (text) => {
      try {
        await navigator.clipboard.writeText(text);
      } catch {
        // clipboard may be unavailable in the webview sandbox; non-fatal
      }
    },

    requestAbortMerge: (repoId) =>
      set({ dialog: { kind: 'abortMerge', repoId }, dialogBusy: false, dialogError: undefined }),

    confirmAbortMerge: async () => {
      const dialog = get().dialog;
      if (dialog?.kind !== 'abortMerge' || get().dialogBusy) {
        return;
      }
      set({ dialogBusy: true });
      try {
        await ctx.request('merge.abort', { repoId: dialog.repoId });
        set({ dialog: null, dialogBusy: false, lastError: undefined });
      } catch (err) {
        fail(err);
      }
    },

    requestUndoCommit: (repoId) =>
      set({ dialog: { kind: 'undoCommit', repoId }, dialogBusy: false, dialogError: undefined }),

    confirmUndoCommit: async () => {
      const dialog = get().dialog;
      if (dialog?.kind !== 'undoCommit' || get().dialogBusy) {
        return;
      }
      set({ dialogBusy: true });
      try {
        await ctx.request('commit.undo', { repoId: dialog.repoId });
        set({ dialog: null, dialogBusy: false });
      } catch (err) {
        fail(err);
      }
    },

    openMergeEditor: async (repoId, path) => {
      try {
        await ctx.request('merge.openEditor', { repoId, path });
      } catch (err) {
        fail(err);
      }
    },
  };
};