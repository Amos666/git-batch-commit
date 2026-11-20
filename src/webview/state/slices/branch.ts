import type { ProtocolError } from '../../../protocol/errors';
import type { PushPreviewEntry, PushRunResult, PushTarget, RepoStatus } from '../../../protocol/models';
import { STRINGS } from '../../strings/en';
import type { Dialog, PanelStore, SetFn, Slice, SliceCtx } from '../types';

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

  requestPush: (checkedIds, includeAhead = true) => {
    const s = get();
    const repoIds = s.repoOrder.filter((id) => s.repos[id]?.branch.name);
    if (repoIds.length === 0) {
      return;
    }
    const checked: Record<string, boolean> = {};
    for (const id of repoIds) {
      const ahead = s.repos[id]?.branch.ahead ?? 0;
      checked[id] = checkedIds.includes(id) || (includeAhead && ahead > 0);
    }
    set({
      dialog: {
        kind: 'push',
        repoIds,
        checked,
        expanded: {},
        remoteChoice: {},
        branchChoice: {},
        preview: {},
        previewLoading: true,
        results: {},
        tags: false,
        filesLoading: false,
        filesCache: {},
      },
      dialogBusy: false,
      dialogError: undefined,
    });
    void (async () => {
      try {
        const entries = await ctx.request('push.preview', { repoIds });
        const cur = get().dialog;
        if (cur?.kind !== 'push') {
          return;
        }
        const preview = { ...cur.preview };
        const remoteChoice = { ...cur.remoteChoice };
        for (const entry of entries) {
          preview[entry.repoId] = entry;
          const only = entry.remotes.length === 1 ? entry.remotes[0] : undefined;
          if (!entry.upstream && only && !remoteChoice[entry.repoId]) {
            remoteChoice[entry.repoId] = only;
          }
        }
        set({ dialog: { ...cur, preview, remoteChoice, previewLoading: false } });
      } catch {
        const cur = get().dialog;
        if (cur?.kind === 'push') {
          set({ dialog: { ...cur, previewLoading: false } });
        }
      }
    })();
  },

  togglePushRepo: (repoId) => {
    const dialog = get().dialog;
    if (dialog?.kind === 'push' && !get().dialogBusy) {
      set({ dialog: { ...dialog, checked: { ...dialog.checked, [repoId]: !dialog.checked[repoId] } } });
    }
  },

  togglePushExpand: (repoId) => {
    const dialog = get().dialog;
    if (dialog?.kind === 'push') {
      set({ dialog: { ...dialog, expanded: { ...dialog.expanded, [repoId]: !dialog.expanded[repoId] } } });
    }
  },

  setPushRemote: (repoId, remote) => {
    const dialog = get().dialog;
    if (dialog?.kind === 'push') {
      set({ dialog: { ...dialog, remoteChoice: { ...dialog.remoteChoice, [repoId]: remote } }, dialogError: undefined });
    }
  },

  setPushBranch: (repoId, branch) => {
    const dialog = get().dialog;
    if (dialog?.kind === 'push') {
      set({ dialog: { ...dialog, branchChoice: { ...dialog.branchChoice, [repoId]: branch } }, dialogError: undefined });
    }
  },

  setPushTags: (tags) => {
    const dialog = get().dialog;
    if (dialog?.kind === 'push') {
      set({ dialog: { ...dialog, tags } });
    }
  },

  requestForcePush: () => {
    const dialog = get().dialog;
    if (dialog?.kind !== 'push' || get().dialogBusy) {
      return;
    }
    if (!dialog.repoIds.some((id) => dialog.checked[id])) {
      set({ dialogError: STRINGS.dialogs.pushNothingSelected });
      return;
    }
    set({ dialog: { ...dialog, forceConfirm: true }, dialogError: undefined });
  },

  cancelForcePush: () => {
    const dialog = get().dialog;
    if (dialog?.kind === 'push') {
      set({ dialog: { ...dialog, forceConfirm: false } });
    }
  },

  confirmPush: async () => {
    await runPushSelection(get, set, ctx, false);
  },

  confirmForcePush: async () => {
    await runPushSelection(get, set, ctx, true);
  },

  retryPushRepo: async (repoId) => {
    const dialog = get().dialog;
    if (dialog?.kind !== 'push' || get().dialogBusy) {
      return;
    }
    const targets = resolvePushTargets(get, dialog, [repoId]);
    if (!targets) {
      set({ dialogError: STRINGS.dialogs.pushChooseRemoteFor(get().repos[repoId]?.repo.name ?? repoId) });
      return;
    }
    set({ dialogBusy: true, dialogError: undefined });
    try {
      const results = await ctx.request('push.run', {
        repoIds: [repoId],
        targets,
        tags: dialog.tags || undefined,
      });
      mergePushResults(get, set, results);
    } catch (err) {
      set({ dialogBusy: false, dialogError: (err as ProtocolError).message, lastError: err as ProtocolError });
    }
  },

  selectPushFiles: (repoId, hash) => {
    const dialog = get().dialog;
    if (dialog?.kind !== 'push') {
      return;
    }
    const key = pushFilesKey(repoId, hash);
    const cached = dialog.filesCache[key];
    const selected = { repoId, hash };
    if (cached) {
      set({ dialog: { ...dialog, selected, files: cached, filesLoading: false, filesError: undefined } });
      return;
    }
    set({ dialog: { ...dialog, selected, files: undefined, filesLoading: true, filesError: undefined } });
    void (async () => {
      try {
        const result = await ctx.request('push.commitFiles', { repoId, hash });
        const cur = get().dialog;
        if (cur?.kind !== 'push' || pushFilesKey(cur.selected?.repoId ?? '', cur.selected?.hash) !== key) {
          return;
        }
        set({ dialog: { ...cur, files: result, filesLoading: false, filesCache: { ...cur.filesCache, [key]: result } } });
      } catch (err) {
        const cur = get().dialog;
        if (cur?.kind !== 'push' || pushFilesKey(cur.selected?.repoId ?? '', cur.selected?.hash) !== key) {
          return;
        }
        set({ dialog: { ...cur, filesLoading: false, filesError: (err as ProtocolError).message } });
      }
    })();
  },

  openPushFileDiff: async (file) => {
    const dialog = get().dialog;
    if (dialog?.kind !== 'push' || !dialog.selected || !dialog.files) {
      return;
    }
    try {
      await ctx.request('push.fileDiff', {
        repoId: dialog.selected.repoId,
        file,
        from: dialog.files.from,
        to: dialog.files.to,
      });
    } catch (err) {
      set({ dialogError: (err as ProtocolError).message });
    }
  },
});

function pushFilesKey(repoId: string, hash: string | undefined): string {
  return `${repoId}:${hash ?? '@'}`;
}

type PushDialog = Extract<Dialog, { kind: 'push' }>;

/** Effective push target for a root: user overrides win, then upstream, then the sole remote. */
export function pushTargetFor(
  dialog: PushDialog,
  id: string,
  status: RepoStatus,
  entry: PushPreviewEntry | undefined,
): { remote: string; branch: string } {
  const upstream = status.branch.upstream;
  const slash = upstream ? upstream.indexOf('/') : -1;
  const upRemote = slash > 0 ? upstream!.slice(0, slash) : undefined;
  const upBranch = slash > 0 ? upstream!.slice(slash + 1) : undefined;
  const remotes = entry?.remotes ?? [];
  const only = remotes.length === 1 ? remotes[0] : undefined;
  const remote = dialog.remoteChoice[id] ?? upRemote ?? only ?? '';
  const branch = dialog.branchChoice[id] ?? upBranch ?? status.branch.name ?? '';
  return { remote, branch };
}

function resolvePushTargets(get: () => PanelStore, dialog: PushDialog, repoIds: string[]): Record<string, PushTarget> | undefined {
  const targets: Record<string, PushTarget> = {};
  for (const id of repoIds) {
    const status = get().repos[id];
    if (!status?.branch.name) {
      continue;
    }
    const entry = dialog.preview[id];
    const target = pushTargetFor(dialog, id, status, entry);
    const upBranch = status.branch.upstream ? status.branch.upstream.slice(status.branch.upstream.indexOf('/') + 1) : undefined;
    const branch = target.branch.trim() || upBranch || status.branch.name || '';
    const overridden = dialog.remoteChoice[id] !== undefined || dialog.branchChoice[id] !== undefined;
    if (status.branch.upstream) {
      // With an upstream the host pushes to it unless the user edited the target.
      if (overridden && target.remote) {
        targets[id] = { remote: target.remote, branch };
      }
      continue;
    }
    if (!target.remote) {
      // Preview remotes can lag behind `git remote add`; with none known, let the
      // host resolve from live state at push time. Only a known-ambiguous list blocks.
      if (entry && entry.remotes.length > 1) {
        return undefined;
      }
      continue;
    }
    targets[id] = { remote: target.remote, branch };
  }
  return targets;
}

async function runPushSelection(get: () => PanelStore, set: SetFn, ctx: SliceCtx, force: boolean): Promise<void> {
  const dialog = get().dialog;
  if (dialog?.kind !== 'push' || get().dialogBusy) {
    return;
  }
  const selected = dialog.repoIds.filter((id) => dialog.checked[id]);
  if (selected.length === 0) {
    set({ dialogError: STRINGS.dialogs.pushNothingSelected });
    return;
  }
  const targets = resolvePushTargets(get, dialog, selected);
  if (!targets) {
    const missing = selected.find((id) => {
      const status = get().repos[id];
      return status && !status.branch.upstream && !dialog.remoteChoice[id] && dialog.preview[id]?.remotes.length !== 1;
    });
    const name = missing ? get().repos[missing]?.repo.name : '';
    set({ dialogError: STRINGS.dialogs.pushChooseRemoteFor(name ?? '') });
    return;
  }
  set({ dialogBusy: true, dialogError: undefined, dialog: { ...dialog, forceConfirm: false } });
  try {
    const results = await ctx.request('push.run', {
      repoIds: selected,
      targets,
      tags: dialog.tags || undefined,
      force: force || undefined,
    });
    mergePushResults(get, set, results);
  } catch (err) {
    set({ dialogBusy: false, dialogError: (err as ProtocolError).message, lastError: err as ProtocolError });
  }
}

function mergePushResults(get: () => PanelStore, set: SetFn, results: PushRunResult[]): void {
  const cur = get().dialog;
  if (cur?.kind !== 'push') {
    set({ dialogBusy: false });
    return;
  }
  const merged = { ...cur.results };
  for (const result of results) {
    merged[result.repoId] = result;
  }
  const anyFailed = Object.values(merged).some((r) => !r.ok);
  if (anyFailed) {
    set({ dialog: { ...cur, results: merged, forceConfirm: false }, dialogBusy: false });
  } else {
    set({ dialog: null, dialogBusy: false, dialogError: undefined });
  }
}