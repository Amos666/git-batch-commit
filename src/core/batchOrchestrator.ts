import { asGitErrorLike } from '../adapter/gitApiTypes';
import { RepoRegistry } from '../adapter/repoRegistry';
import { mapGitErrorCode, makeError } from '../protocol/errors';
import type { ProtocolError } from '../protocol/errors';
import type { CommitRequest, CommitResult } from '../protocol/models';
import { InclusionModel } from './inclusionModel';
import { OperationTracker } from './operationTracker';

export interface OrchestratorOptions {
  stopOnFirstRepoError: boolean;
}

export class BatchOrchestrator {
  private cancelRemainingFlag = false;
  private running = false;

  constructor(
    private readonly registry: RepoRegistry,
    private readonly inclusion: InclusionModel,
    private readonly tracker: OperationTracker,
    private readonly options: () => OrchestratorOptions,
  ) {}

  cancelRemaining(): void {
    if (this.running) {
      this.cancelRemainingFlag = true;
    }
  }

  isRunning(): boolean {
    return this.running;
  }

  async run(req: CommitRequest): Promise<CommitResult[]> {
    if (this.running) {
      throw makeError('GENERIC', '已有提交正在进行，请等待完成');
    }
    if (!req.message.trim() && !req.amend) {
      throw makeError('EMPTY_MESSAGE', '提交消息为空');
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
      if (req.pushAfter && results.every((r) => r.ok)) {
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

  private async commitOne(repoId: string, req: CommitRequest): Promise<CommitResult> {
    const started = Date.now();
    const repo = this.registry.get(repoId);
    if (!repo) {
      return { repoId, ok: false, error: makeError('NO_REPOSITORY', `仓库不存在: ${repoId}`), durationMs: 0 };
    }
    this.tracker.start(repoId, req.pushAfter ? 'commitAndPush' : 'commit');
    try {
      if (repo.state.mergeChanges.length > 0) {
        throw makeError('CONFLICT', '存在未解决的冲突，无法提交', ['openMergeEditor', 'showGitOutput']);
      }
      const expected = req.expectedStaged?.[repoId];
      if (expected) {
        const mismatch = this.inclusion.validateExpectedStaged(repoId, expected);
        if (mismatch) {
          throw mismatch;
        }
      }
      if (repo.state.indexChanges.length === 0 && !req.amend) {
        throw makeError('NO_CHANGES', '暂存区为空，没有可提交的内容（勾选文件即暂存）');
      }
      this.tracker.update(repoId, 'committing');
      await repo.commit(req.message, {
        all: false,
        amend: req.amend,
        signoff: req.signoff,
        noVerify: req.noVerify,
      });
      let oid = repo.state.HEAD?.commit;
      try {
        oid = (await repo.getCommit('HEAD')).hash;
      } catch {
        // state.HEAD fallback is acceptable; state events reconcile shortly
      }
      const branch = repo.state.HEAD?.name;
      this.tracker.end(repoId, 'done');
      return { repoId, ok: true, commitOid: oid, branch, durationMs: Date.now() - started };
    } catch (err) {
      const error = toProtocolError(err, 'commit');
      this.tracker.end(repoId, 'failed', error.message);
      return { repoId, ok: false, error, durationMs: Date.now() - started };
    }
  }

  private async pushOne(result: CommitResult, req: CommitRequest): Promise<void> {
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