import * as path from 'node:path';
import { RepoRegistry } from '../adapter/repoRegistry';
import { makeError } from '../protocol/errors';
import type { ProtocolError } from '../protocol/errors';

export class InclusionModel {
  constructor(private readonly registry: RepoRegistry) {}

  private repoOrThrow(repoId: string) {
    const repo = this.registry.get(repoId);
    if (!repo) {
      throw makeError('NO_REPOSITORY', `仓库不存在: ${repoId}`);
    }
    return repo;
  }

  private absolute(repoId: string, paths: string[]): string[] {
    const desc = this.registry.descriptor(repoId);
    if (!desc) {
      throw makeError('NO_REPOSITORY', `仓库不存在: ${repoId}`);
    }
    return paths.map((p) => path.join(desc.rootPath, p));
  }

  async stage(repoId: string, paths: string[]): Promise<void> {
    const repo = this.repoOrThrow(repoId);
    await repo.add(this.absolute(repoId, paths));
  }

  async unstage(repoId: string, paths: string[]): Promise<void> {
    const repo = this.repoOrThrow(repoId);
    await repo.restore(this.absolute(repoId, paths), { staged: true });
  }

  async stageAll(repoId: string): Promise<void> {
    const repo = this.repoOrThrow(repoId);
    const paths = [
      ...repo.state.workingTreeChanges.map((c) => c.uri.fsPath),
      ...repo.state.untrackedChanges.map((c) => c.uri.fsPath),
    ];
    if (paths.length > 0) {
      await repo.add(paths);
    }
  }

  async unstageAll(repoId: string): Promise<void> {
    const repo = this.repoOrThrow(repoId);
    const paths = repo.state.indexChanges.map((c) => c.uri.fsPath);
    if (paths.length > 0) {
      await repo.restore(paths, { staged: true });
    }
  }

  /** Returns an error when the index does not match the expected staged set. */
  validateExpectedStaged(repoId: string, expected: string[]): ProtocolError | undefined {
    const repo = this.repoOrThrow(repoId);
    const desc = this.registry.descriptor(repoId);
    if (!desc) {
      return makeError('NO_REPOSITORY', `仓库不存在: ${repoId}`);
    }
    const actual = new Set(
      repo.state.indexChanges.map((c) => path.relative(desc.rootPath, c.uri.fsPath).split(path.sep).join('/')),
    );
    const expectedSet = new Set(expected);
    if (actual.size !== expectedSet.size || [...expectedSet].some((p) => !actual.has(p))) {
      return makeError('STAGED_MISMATCH', '暂存区与勾选集不一致（可能有外部 Git 操作），已阻止提交', ['retry']);
    }
    return undefined;
  }
}