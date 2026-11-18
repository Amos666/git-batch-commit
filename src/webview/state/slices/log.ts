import type { ProtocolError } from '../../../protocol/errors';
import type { Slice } from '../types';

export const logSlice: Slice = (set, get, ctx) => ({
  logView: null,

  openLogView: async (repoId) => {
    const current = get().logView;
    const target = repoId ?? current?.repoId ?? get().repoOrder[0];
    if (!target) {
      return;
    }
    set({
      logView: {
        repoId: target,
        entries: current?.repoId === target ? current.entries : [],
        hasMore: false,
        busy: true,
        author: current?.repoId === target ? current.author : '',
        grep: current?.repoId === target ? current.grep : '',
        confirm: null,
      },
    });
    try {
      const page = await ctx.request('log.list', { repoId: target });
      const view = get().logView;
      if (view?.repoId === target) {
        set({ logView: { ...view, entries: page.entries, hasMore: page.hasMore, busy: false } });
      }
    } catch (err) {
      const view = get().logView;
      if (view) {
        set({ logView: { ...view, busy: false, error: (err as ProtocolError).message } });
      }
    }
  },

  setLogField: (field, value) => {
    const view = get().logView;
    if (view) {
      set({ logView: { ...view, [field]: value } });
    }
  },

  reloadLog: async () => {
    const view = get().logView;
    if (!view || view.busy) {
      return;
    }
    set({ logView: { ...view, busy: true, error: undefined } });
    try {
      const page = await ctx.request('log.list', {
        repoId: view.repoId,
        author: view.author.trim() || undefined,
        grep: view.grep.trim() || undefined,
      });
      const current = get().logView;
      if (current) {
        set({ logView: { ...current, entries: page.entries, hasMore: page.hasMore, busy: false } });
      }
    } catch (err) {
      const current = get().logView;
      if (current) {
        set({ logView: { ...current, busy: false, error: (err as ProtocolError).message } });
      }
    }
  },

  loadMoreLog: async () => {
    const view = get().logView;
    if (!view || view.busy || !view.hasMore) {
      return;
    }
    set({ logView: { ...view, busy: true, error: undefined } });
    try {
      const page = await ctx.request('log.list', {
        repoId: view.repoId,
        skip: view.entries.length,
        author: view.author.trim() || undefined,
        grep: view.grep.trim() || undefined,
      });
      const current = get().logView;
      if (current) {
        set({ logView: { ...current, entries: [...current.entries, ...page.entries], hasMore: page.hasMore, busy: false } });
      }
    } catch (err) {
      const current = get().logView;
      if (current) {
        set({ logView: { ...current, busy: false, error: (err as ProtocolError).message } });
      }
    }
  },

  requestLogAction: (kind, oid) => {
    const view = get().logView;
    if (view && !view.busy) {
      set({ logView: { ...view, confirm: { kind, oid }, error: undefined } });
    }
  },

  cancelLogAction: () => {
    const view = get().logView;
    if (view) {
      set({ logView: { ...view, confirm: null } });
    }
  },

  confirmLogAction: async () => {
    const view = get().logView;
    if (!view?.confirm || view.busy) {
      return;
    }
    const { kind, oid } = view.confirm;
    set({ logView: { ...view, busy: true, confirm: null, error: undefined } });
    try {
      await ctx.request(kind === 'cherry-pick' ? 'log.cherryPick' : 'log.revert', { repoId: view.repoId, oid });
      await get().reloadLog();
    } catch (err) {
      const current = get().logView;
      if (current) {
        set({ logView: { ...current, busy: false, error: (err as ProtocolError).message } });
      }
      set({ lastError: err as ProtocolError });
    }
  },
});