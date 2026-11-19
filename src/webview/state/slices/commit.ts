import type { ProtocolError } from '../../../protocol/errors';
import type { CheckId, CommitRequestV2, RepoStatus } from '../../../protocol/models';
import { refKey } from '../types';
import type { PanelStore, Slice } from '../types';

export interface IncludedEntry {
  path: string;
  selection?: import('../../../protocol/models').PartialSelection;
}

/** The set the next commit will include, derived from host-owned state. */
export function includedByRepo(s: PanelStore): Record<string, IncludedEntry[]> {
  const out: Record<string, IncludedEntry[]> = {};
  const add = (repoId: string, entry: IncludedEntry): void => {
    (out[repoId] ??= []).push(entry);
  };
  if (s.mode === 'changelist' && s.changelists) {
    for (const list of s.changelists.lists) {
      for (const ref of list.checked) {
        add(ref.repoId, { path: ref.path, selection: list.partial[refKey(ref.repoId, ref.path)] });
      }
    }
    for (const ref of s.changelists.unversionedChecked) {
      add(ref.repoId, { path: ref.path });
    }
    return out;
  }
  for (const repoId of s.repoOrder) {
    const status = s.repos[repoId];
    if (!status) {
      continue;
    }
    for (const c of status.changes) {
      if (c.staged && !c.conflicted) {
        add(repoId, { path: c.path });
      }
    }
  }
  return out;
}

/** Visible reason the Commit button is disabled, or null when enabled. */
export function commitDisabledReason(s: PanelStore): string | null {
  if (s.committing) {
    return 'committing';
  }
  if (s.checksRunning.length > 0) {
    return 'checksRunning';
  }
  const included = includedByRepo(s);
  // Conflicts only block repos that would actually be committed; an unrelated
  // conflicted repo must not block the rest of the batch.
  const targets = Object.keys(included);
  const scope = targets.length > 0 ? targets : s.repoOrder;
  if (scope.some((id) => s.repos[id]?.changes.some((c) => c.conflicted))) {
    return 'conflicted';
  }
  const anyIncluded = targets.length > 0;
  if (!anyIncluded && !s.amend) {
    return 'noChanges';
  }
  if (!s.amend && !s.message.trim()) {
    return 'noMessage';
  }
  if (s.amend && s.repoOrder.every((id) => !s.repos[id]?.branch.oid)) {
    return 'noHead';
  }
  return null;
}

export const commitSlice: Slice = (set, get, ctx) => {
  // set when the user invoked "Commit and Push"; consumed after a successful commit
  let pendingPushAfter = false;

  const loadAmendMessage = async (): Promise<void> => {
    const s = get();
    const repoId = s.repoOrder.find((id) => s.repos[id]?.branch.oid) ?? s.repoOrder[0];
    if (!repoId) {
      return;
    }
    try {
      const page = await ctx.request('log.list', { repoId });
      const last = page.entries[0];
      if (last && get().amend) {
        set({ message: last.message });
      }
    } catch {
      // message stays editable; history dropdown remains available
    }
  };

  const doCommit = async (opts: { noVerify?: boolean } | undefined): Promise<void> => {
    const s = get();
    const included = includedByRepo(s);
    let repoIds = Object.keys(included).filter((id) => (included[id] as IncludedEntry[]).length > 0);
    const amend = s.amend;
    if (repoIds.length === 0 && amend) {
      const withHead = s.repoOrder.filter((id) => s.repos[id]?.branch.oid);
      repoIds = withHead.length > 0 ? withHead : s.repoOrder.slice(0, 1);
    }
    if (repoIds.length === 0) {
      return;
    }
    // batch in tree order, not checked-insertion order (re-checks after a
    // commit append to the end and would otherwise shuffle the sequence)
    repoIds = repoIds.sort((a, b) => s.repoOrder.indexOf(a) - s.repoOrder.indexOf(b));
    if (!amend && !s.message.trim()) {
      return;
    }
    const author =
      s.optionsState.author && s.optionsState.author.name && s.optionsState.author.email
        ? s.optionsState.author
        : undefined;
    const request: CommitRequestV2 = {
      repoIds,
      message: s.message,
      options: {
        amend: amend || undefined,
        signoff: s.optionsState.signoff || undefined,
        noVerify: (opts?.noVerify ?? !s.optionsState.runHooks) || undefined,
        author,
      },
    };
    if (!amend) {
      if (s.mode === 'changelist') {
        request.expectedIncluded = Object.fromEntries(repoIds.map((id) => [id, included[id] as IncludedEntry[]]));
      } else {
        request.expectedStaged = Object.fromEntries(
          repoIds.map((id) => [
            id,
            (s.repos[id] as RepoStatus).changes.filter((c) => c.staged && !c.conflicted).map((c) => c.path),
          ]),
        );
      }
    }
    set({ committing: true, results: null, lastError: null });
    const started = performance.now();
    try {
      const results = await ctx.request('commit.run', request);
      ctx.metric('commit.roundtrip', performance.now() - started);
      const allOk = results.every((r) => r.ok);
      const okRepos = results.filter((r) => r.ok).map((r) => r.repoId);
      const failed = results.find((r) => !r.ok && r.error);
      const indexModifiedRepos = results.filter((r) => r.indexModified).map((r) => r.repoId);
      set({
        results,
        committing: false,
        indexModifiedRepos: [...new Set([...get().indexModifiedRepos, ...indexModifiedRepos])],
        message: allOk && get().settings?.clearMessageOnSuccess ? '' : get().message,
        amend: allOk ? false : get().amend,
        ...(failed?.error ? { lastError: { ...failed.error, repoId: failed.repoId } } : {}),
      });
      if (okRepos.length > 0) {
        const pushAfter = pendingPushAfter;
        pendingPushAfter = false;
        const after = get();
        const enabled = Object.entries(after.optionsState.checks)
          .filter(([, on]) => on)
          .map(([id]) => id as CheckId);
        if (after.optionsState.runAfterCommit && enabled.length > 0) {
          // deferred checks: the commit already happened, so the report only
          // offers Review; a pending Commit-and-Push continues from the dialog
          set({ checksRunning: enabled });
          try {
            // the checked set is pruned once the commit lands, so scope the
            // scan to what was actually committed, captured before the run
            const refs = okRepos.flatMap((id) => (included[id] ?? []).map((e) => ({ repoId: id, path: e.path })));
            const report = await ctx.request('checks.run', { repoIds: okRepos, checkIds: enabled, refs });
            if (report.results.some((r) => r.status === 'issues')) {
              set({ dialog: { kind: 'checksReport', report, pushAfter, postCommit: true, repoIds: okRepos } });
              return;
            }
          } catch {
            // post-commit checks are best-effort
          } finally {
            set({ checksRunning: [] });
          }
        }
        if (pushAfter) {
          get().requestPush(okRepos, allOk);
        }
      }
    } catch (err) {
      const error = err as ProtocolError;
      set({ committing: false });
      if (error.code === 'PROTOCOL_MISMATCH') {
        set({ protocolMismatch: true });
      } else {
        set({ lastError: error });
      }
    }
  };

  return {
    message: '',
    history: null,
    historyOpen: false,
    amend: false,
    committing: false,
    results: null,

    setMessage: (message) => set({ message }),

    toggleHistory: async () => {
      if (get().historyOpen) {
        set({ historyOpen: false });
        return;
      }
      try {
        const history = await ctx.request('history.list', undefined);
        set({ history, historyOpen: true });
      } catch (err) {
        set({ lastError: err as ProtocolError });
      }
    },

    pickHistory: (message) => set({ message, historyOpen: false }),

    setAmend: async (amend) => {
      if (!amend) {
        set({ amend: false });
        return;
      }
      const s = get();
      const repoIds = s.repoOrder.filter((id) => s.repos[id]?.branch.oid);
      if (repoIds.length === 0) {
        return;
      }
      try {
        for (const repoId of repoIds) {
          const { pushed } = await ctx.request('commit.isPushed', { repoId });
          if (pushed) {
            set({ dialog: { kind: 'amendPushed' }, dialogBusy: false, dialogError: undefined });
            return;
          }
        }
      } catch {
        // guard is best-effort; amend proceeds when the check is unavailable
      }
      set({ amend: true });
      await loadAmendMessage();
    },

    confirmAmendPushed: async () => {
      set({ dialog: null, amend: true });
      await loadAmendMessage();
    },

    setOptions: async (patch) => {
      const current = get().optionsState;
      const next = {
        ...current,
        ...patch,
        checks: patch.checks ? { ...current.checks, ...patch.checks } : current.checks,
      };
      set({ optionsState: next });
      try {
        await ctx.request('options.set', patch);
      } catch (err) {
        set({ optionsState: current, lastError: err as ProtocolError });
      }
    },

    applyOptions: (options) => set({ optionsState: options }),

    commit: async (opts) => {
      const s = get();
      if (s.committing || s.checksRunning.length > 0) {
        return;
      }
      pendingPushAfter = false;
      const enabledChecks = Object.entries(s.optionsState.checks).filter(([, on]) => on).map(([id]) => id);
      if (enabledChecks.length > 0 && !opts?.skipChecks && !s.optionsState.runAfterCommit) {
        const included = includedByRepo(s);
        const repoIds = Object.keys(included);
        if (repoIds.length > 0) {
          set({ checksRunning: enabledChecks as CheckId[] });
          try {
            const report = await ctx.request('checks.run', {
              repoIds,
              checkIds: enabledChecks as CheckId[],
            });
            if (report.results.some((r) => r.status === 'issues')) {
              set({ dialog: { kind: 'checksReport', report, pushAfter: opts?.pushAfter ?? false } });
              return;
            }
          } catch (err) {
            set({ lastError: err as ProtocolError });
            return;
          } finally {
            set({ checksRunning: [] });
          }
        }
      }
      pendingPushAfter = opts?.pushAfter ?? false;
      await doCommit({ noVerify: opts?.noVerify });
    },

    cancelRemaining: () => {
      void ctx.request('batch.cancelRemaining', undefined).catch(() => {});
    },

    openDiff: async (repoId, path, side, force) => {
      try {
        await ctx.request('diff.open', { repoId, path, side, force });
      } catch (err) {
        set({ lastError: err as ProtocolError });
      }
    },

    showCommit: async (repoId, oid) => {
      try {
        await ctx.request('commit.show', { repoId, oid });
      } catch (err) {
        set({ lastError: err as ProtocolError });
      }
    },

    runAction: async (action, error, repoId) => {
      try {
        switch (action) {
          case 'showGitOutput':
            await ctx.request('ui.showGitOutput', undefined);
            break;
          case 'retryInTerminal':
            if (repoId) {
              await ctx.request('ui.retryInTerminal', { repoId, command: error.terminalCommand ?? 'git status' });
            }
            break;
          case 'openGitSettings':
          case 'enableGitExtension':
            await ctx.request('ui.openGitSettings', undefined);
            break;
          case 'skipHooksRetry':
            set({ dialog: { kind: 'skipHooks', pushAfter: false } });
            break;
          case 'retry':
            await get().commit({ skipChecks: true });
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
              await get().openMergeEditor(target, conflicted.path);
            } else {
              await ctx.request('ui.showGitOutput', undefined);
            }
            break;
          }
          case 'abortSequencer': {
            const target = repoId ?? get().repoOrder[0];
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
  };
};