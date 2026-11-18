import type { ProtocolError } from '../../../protocol/errors';
import type { Slice } from '../types';

export const branchSlice: Slice = (set, get, ctx) => ({
  branchPicker: null,

  openBranchPicker: async (repoId) => {
    if (get().branchPicker?.repoId === repoId) {
      set({ branchPicker: null });
      return;
    }
    const base = { repoId, busy: false, search: '', newBranch: '', renaming: null, renameTo: '', confirmDelete: null };
    try {
      const branches = await ctx.request('branch.list', { repoId });
      set({ branchPicker: { ...base, branches } });
    } catch (err) {
      set({ branchPicker: { ...base, branches: [], error: (err as ProtocolError).message } });
    }
  },

  closeBranchPicker: () => set({ branchPicker: null }),

  setBranchField: (field, value) => {
    const picker = get().branchPicker;
    if (picker) {
      set({ branchPicker: { ...picker, [field]: value } });
    }
  },

  checkoutBranch: async (name) => {
    const picker = get().branchPicker;
    if (!picker || picker.busy) {
      return;
    }
    set({ branchPicker: { ...picker, busy: true, error: undefined } });
    try {
      await ctx.request('branch.checkout', { repoId: picker.repoId, name });
      set({ branchPicker: null });
    } catch (err) {
      const current = get().branchPicker;
      if (current) {
        set({ branchPicker: { ...current, busy: false, error: (err as ProtocolError).message } });
      }
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
      await ctx.request('branch.create', { repoId: picker.repoId, name, checkout: true });
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
      await ctx.request('branch.rename', { repoId: picker.repoId, from: picker.renaming, to });
      const branches = await ctx.request('branch.list', { repoId: picker.repoId });
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
      await ctx.request('branch.delete', { repoId: picker.repoId, name: picker.confirmDelete });
      const branches = await ctx.request('branch.list', { repoId: picker.repoId });
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
    try {
      await ctx.request('branch.compare', { repoId: picker.repoId, name });
      set({ branchPicker: null });
    } catch (err) {
      const current = get().branchPicker;
      if (current) {
        set({ branchPicker: { ...current, error: (err as ProtocolError).message } });
      }
    }
  },

  pullRepo: async (repoId) => {
    if (get().operations[repoId]) {
      return;
    }
    try {
      await ctx.request('repo.pull', { repoId });
    } catch (err) {
      set({ lastError: err as ProtocolError });
    }
  },

  pushRepo: async (repoId) => {
    if (get().operations[repoId]) {
      return;
    }
    try {
      await ctx.request('repo.push', { repoId });
    } catch (err) {
      set({ lastError: err as ProtocolError });
    }
  },

  requestPush: (repoIds) => {
    if (repoIds.length === 0) {
      return;
    }
    set({ dialog: { kind: 'push', repoIds }, dialogBusy: false, dialogError: undefined });
  },

  confirmPush: async () => {
    const dialog = get().dialog;
    if (dialog?.kind !== 'push' || get().dialogBusy) {
      return;
    }
    set({ dialogBusy: true });
    try {
      for (const repoId of dialog.repoIds) {
        await ctx.request('repo.push', { repoId });
      }
      set({ dialog: null, dialogBusy: false });
    } catch (err) {
      set({ dialogBusy: false, dialogError: (err as ProtocolError).message, lastError: err as ProtocolError });
    }
  },
});