import { asGitErrorLike } from '../adapter/gitApiTypes';
import { RepoRegistry } from '../adapter/repoRegistry';
import { mapGitErrorCode, makeError } from '../protocol/errors';
import type { ProtocolError } from '../protocol/errors';
import type { CommitRequestV2, CommitResult } from '../protocol/models';
import { CommitTranslator } from './commitTranslator';
import type { TranslationState } from './commitTranslator';
import { InclusionModel } from './inclusionModel';
import { OperationTracker } from './operationTracker';

export interface OrchestratorOptions {
  stopOnFirstRepoError: boolean;
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

  async run(req: CommitRequestV2): Promise<CommitResult[]> {
    if (this.running) {
      throw makeError('GENERIC', 'A commit is already in progress; wait for it to finish');
    }
    if (!req.message.trim() && !req.options.amend) {
      throw makeError('EMPTY_MESSAGE', 'Commit message is empty');
    }
    this.running = true;
    this.cancelRemainingFlag = false;
    const results: CommitResult[] = [];
    let stopped = false;
    try {
      for (const repoId of req.repoIds) {
        if (this.cancelRemainingFlag) {
          results.push({ repoId, ok: false, skipped: 'cancelled', durationMs: 0 });
          continue;
        }
        if (stopped) {
          results.push({ repoId, ok: false, skipped: 'stopped-after-error', durationMs: 0 });
          continue;
        }
        const result = await this.commitOne(repoId, req);
        results.push(result);
        if (!result.ok && this.options().stopOnFirstRepoError) {
          stopped = true;
        }
      }
      if (req.options.pushAfter && results.every((r) => r.ok)) {
        for (const result of results) {
          if (this.cancelRemainingFlag) {
            result.skipped = 'cancelled';
            result.ok = false;
            continue;
          }
          await this.pushOne(result, req);
        }
      }
      return results;
    } finally {
      this.running = false;
      this.cancelRemainingFlag = false;
    }
  }

  private async commitOne(repoId: string, req: CommitRequestV2): Promise<CommitResult> {
    const started = Date.now();
    const repo = this.registry.get(repoId);
    if (!repo) {
      return { repoId, ok: false, error: makeError('NO_REPOSITORY', `Repository not found: ${repoId}`), durationMs: 0 };
    }
    this.tracker.start(repoId, req.options.pushAfter ? 'commitAndPush' : 'commit');
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

  private async pushOne(result: CommitResult, req: CommitRequestV2): Promise<void> {
    const repo = this.registry.get(result.repoId);
    if (!repo) {
      return;
    }
    const started = Date.now();
    this.tracker.start(result.repoId, 'commitAndPush');
    this.tracker.update(result.repoId, 'pushing');
    try {
      const head = repo.state.HEAD;
      const remote = head?.upstream?.remote;
      const branch = head?.name;
      await repo.push(remote, branch, head?.upstream ? false : true);
      this.tracker.end(result.repoId, 'done');
    } catch (err) {
      const error = toProtocolError(err, 'push');
      this.tracker.end(result.repoId, 'failed', error.message);
      result.ok = false;
      result.error = error;
      result.durationMs += Date.now() - started;
      if (this.options().stopOnFirstRepoError) {
        this.cancelRemainingFlag = true;
      }
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