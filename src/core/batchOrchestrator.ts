import { asGitErrorLike, ForcePushMode } from '../adapter/gitApiTypes';
import { RepoRegistry } from '../adapter/repoRegistry';
import { mapGitErrorCode, makeError } from '../protocol/errors';
import type { ProtocolError } from '../protocol/errors';
import type { CommitRequestV2, CommitResult, PushRunRequest, PushRunResult } from '../protocol/models';
import { CommitTranslator } from './commitTranslator';
import type { TranslationState } from './commitTranslator';
import { InclusionModel } from './inclusionModel';
import { OperationTracker } from './operationTracker';
import { pickRemote } from './pushTarget';

export interface OrchestratorOptions {
  stopOnFirstRepoError: boolean;
  /** repositories committed/pushed at the same time (default 4, clamped 1..8) */
  maxParallelRepos?: number;
  /** changelist mode: asked before unstaging index entries outside the checked set */
  confirmIndexExclusion?: (repoId: string, paths: string[]) => Promise<boolean>;
  /** changelist mode: post-commit list cleanup */
  onCommitted?: (repoId: string, req: CommitRequestV2) => void;
}

export class BatchOrchestrator {
  private cancelRemainingFlag = false;
  private running = false;

  constructor(
    private readonly registry: RepoRegistry,
    private readonly inclusion: InclusionModel,
    private readonly translator: CommitTranslator,
    private readonly tracker: OperationTracker,
    private readonly options: () => OrchestratorOptions,
    private readonly metric?: (name: string, ms: number) => void,
  ) {}

  cancelRemaining(): void {
    if (this.running) {
      this.cancelRemainingFlag = true;
    }
  }

  isRunning(): boolean {
    return this.running;
  }

  private parallelLimit(): number {
    const n = this.options().maxParallelRepos ?? 4;
    return Math.max(1, Math.min(8, Math.floor(n)));
  }

  /**
   * Lane pool over independent repositories. Lanes check cancel/stop before
   * grabbing the next item, so in-flight work always finishes and only
   * not-yet-started repositories are skipped; results keep request order.
   */
  private async pool<T>(items: T[], worker: (item: T, index: number) => Promise<void>, stopped: () => boolean): Promise<void> {
    let next = 0;
    const lanes = Array.from({ length: Math.min(this.parallelLimit(), items.length) }, async () => {
      for (;;) {
        if (this.cancelRemainingFlag || stopped()) {
          return;
        }
        const i = next++;
        if (i >= items.length) {
          return;
        }
        await worker(items[i]!, i);
      }
    });
    await Promise.all(lanes);
  }

  /**
   * Commit order: a repository nested inside another one (submodule / embedded
   * repository) has to land first, otherwise the parent records the old gitlink
   * while the child moves HEAD and the translator's race guard rejects it.
   * Repositories that do not contain each other are independent and share a wave.
   */
  private waves<T extends { repoId: string }>(items: T[]): T[][] {
    const roots = items.map((item) => this.registry.descriptor(item.repoId)?.rootPath.replace(/\/+$/, '') ?? '');
    const byDepth = items
      .map((item, i) => ({ item, depth: roots.filter((root, j) => root !== '' && j !== i && roots[i]!.startsWith(`${root}/`)).length }))
      .sort((a, b) => b.depth - a.depth);
    const groups = new Map<number, T[]>();
    for (const entry of byDepth) {
      const group = groups.get(entry.depth);
      if (group) {
        group.push(entry.item);
      } else {
        groups.set(entry.depth, [entry.item]);
      }
    }
    return [...groups.entries()].sort((a, b) => b[0] - a[0]).map(([, group]) => group);
  }

  async run(req: CommitRequestV2): Promise<CommitResult[]> {
    if (this.running) {
      throw makeError('GENERIC', 'A commit is already in progress; wait for it to finish');
    }
    if (!req.message.trim() && !req.options.amend) {
      throw makeError('EMPTY_MESSAGE', 'Commit message is empty');
    }
    this.running = true;
    this.cancelRemainingFlag = false;
    const slots: (CommitResult | undefined)[] = Array.from({ length: req.repoIds.length });
    let stopped = false;
    try {
      const lanes = req.repoIds.map((repoId, slot) => ({ repoId, slot }));
      for (const wave of this.waves(lanes)) {
        await this.pool(
          wave,
          async ({ repoId, slot }) => {
            const result = await this.commitOne(repoId, req);
            slots[slot] = result;
            if (!result.ok && this.options().stopOnFirstRepoError) {
              stopped = true;
            }
          },
          () => stopped,
        );
        if (stopped || this.cancelRemainingFlag) {
          break;
        }
      }
      const cancelled = this.cancelRemainingFlag;
      return slots.map((result, i) =>
        result ?? {
          repoId: req.repoIds[i]!,
          ok: false,
          skipped: cancelled ? 'cancelled' : 'stopped-after-error',
          durationMs: 0,
        },
      );
    } finally {
      this.running = false;
      this.cancelRemainingFlag = false;
    }
  }

  /** Batch push: repositories push concurrently; a failed repo never aborts the rest (IDEA semantics). */
  async runPush(req: PushRunRequest): Promise<PushRunResult[]> {
    if (this.running) {
      throw makeError('GENERIC', 'Another batch operation is in progress; wait for it to finish');
    }
    this.running = true;
    this.cancelRemainingFlag = false;
    const slots: (PushRunResult | undefined)[] = Array.from({ length: req.repoIds.length });
    try {
      await this.pool(
        req.repoIds,
        async (repoId, i) => {
          slots[i] = await this.pushOne(repoId, req);
        },
        () => false,
      );
      return slots.map((result, i) => result ?? { repoId: req.repoIds[i]!, ok: false, skipped: 'cancelled' });
    } finally {
      this.running = false;
      this.cancelRemainingFlag = false;
    }
  }

  private async pushOne(repoId: string, req: PushRunRequest): Promise<PushRunResult> {
    const repo = this.registry.get(repoId);
    if (!repo) {
      return { repoId, ok: false, error: makeError('NO_REPOSITORY', `Repository not found: ${repoId}`) };
    }
    const head = repo.state.HEAD;
    if (!head?.name) {
      return { repoId, ok: false, error: makeError('GENERIC', 'Cannot push from detached HEAD; check out a branch first') };
    }
    this.tracker.start(repoId, 'push');
    this.tracker.update(repoId, 'pushing');
    try {
      const target = req.targets?.[repoId];
      let remote = target?.remote ?? head.upstream?.remote;
      if (!remote) {
        const pick = pickRemote(undefined, repo.state.remotes.map((r) => r.name));
        if (pick.status !== 'ok') {
          const error =
            pick.status === 'none'
              ? makeError('NO_REMOTE', 'No remote is configured for this repository; add one before pushing')
              : makeError('NO_REMOTE', 'Multiple remotes are configured; choose a push target in the Push dialog');
          this.tracker.end(repoId, 'failed', error.message);
          return { repoId, ok: false, error };
        }
        remote = pick.remote;
      }
      const branch = target?.branch ?? head.name;
      const setUpstream = !head.upstream;
      if (repo.pushTo) {
        // refspec local:target pushes the current commit to any remote branch name
        // (IDEA semantics: renaming/creating the remote branch), instead of
        // repo.push which can only push a local branch of the same name.
        await repo.pushTo(remote, `${head.name}:${branch}`, setUpstream, req.force ? ForcePushMode.ForceWithLease : undefined, req.tags);
      } else if (branch !== head.name) {
        const error = makeError('GENERIC', `Pushing to remote branch '${branch}' requires a kernel with pushTo support`);
        this.tracker.end(repoId, 'failed', error.message);
        return { repoId, ok: false, error };
      } else {
        await repo.push(remote, branch, setUpstream);
      }
      this.tracker.end(repoId, 'done');
      return { repoId, ok: true };
    } catch (err) {
      const error = toProtocolError(err, 'push');
      this.tracker.end(repoId, 'failed', error.message);
      return { repoId, ok: false, error };
    }
  }

  private async commitOne(repoId: string, req: CommitRequestV2): Promise<CommitResult> {
    const started = Date.now();
    const repo = this.registry.get(repoId);
    if (!repo) {
      return { repoId, ok: false, error: makeError('NO_REPOSITORY', `Repository not found: ${repoId}`), durationMs: 0 };
    }
    this.tracker.start(repoId, 'commit');
    const tx: TranslationState = { indexModified: false };
    try {
      if (repo.state.mergeChanges.length > 0) {
        throw makeError('CONFLICT', 'Unresolved conflicts exist; commit is not possible', ['openMergeEditor', 'showGitOutput']);
      }
      const included = req.expectedIncluded?.[repoId];
      if (included && included.length > 0) {
        const tTranslate = Date.now();
        await this.translator.translate(repoId, included, {
          confirmExclusion: (paths) => this.options().confirmIndexExclusion?.(repoId, paths) ?? Promise.resolve(true),
          tx,
        });
        this.metric?.('commit.translate', Date.now() - tTranslate);
      } else if (included && !req.options.amend) {
        throw makeError('NO_CHANGES', 'Nothing checked to commit');
      } else if (!included) {
        const expected = req.expectedStaged?.[repoId];
        if (expected) {
          const mismatch = this.inclusion.validateExpectedStaged(repoId, expected);
          if (mismatch) {
            throw mismatch;
          }
        }
        if (repo.state.indexChanges.length === 0 && !req.options.amend) {
          throw makeError('NO_CHANGES', 'Nothing staged to commit (check files to stage them)');
        }
      }
      this.tracker.update(repoId, 'committing');
      const tCommit = Date.now();
      await repo.commit(req.message, {
        all: false,
        amend: req.options.amend,
        signoff: req.options.signoff,
        noVerify: req.options.noVerify,
        author: req.options.author,
      });
      this.metric?.('commit.git', Date.now() - tCommit);
      let oid = repo.state.HEAD?.commit;
      try {
        oid = (await repo.getCommit('HEAD')).hash;
      } catch {
        // state.HEAD fallback is acceptable; state events reconcile shortly
      }
      const branch = repo.state.HEAD?.name;
      this.tracker.end(repoId, 'done');
      this.options().onCommitted?.(repoId, req);
      return { repoId, ok: true, commitOid: oid, branch, durationMs: Date.now() - started };
    } catch (err) {
      const error = toProtocolError(err, 'commit');
      this.tracker.end(repoId, 'failed', error.message);
      return {
        repoId,
        ok: false,
        error,
        durationMs: Date.now() - started,
        ...(tx.indexModified ? { indexModified: true } : {}),
      };
    }
  }

}

function toProtocolError(err: unknown, command: 'commit' | 'push'): ProtocolError {
  if (typeof err === 'object' && err !== null && 'code' in err && 'actions' in err) {
    return err as ProtocolError;
  }
  const gitErr = asGitErrorLike(err);
  const mapped = mapGitErrorCode(gitErr.gitErrorCode, gitErr.stderr ?? gitErr.message ?? String(err));
  mapped.terminalCommand = command === 'commit' ? 'git commit' : 'git push';
  return mapped;
}