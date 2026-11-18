import { RepoRegistry } from '../adapter/repoRegistry';
import { makeError } from '../protocol/errors';
import type { ProtocolError } from '../protocol/errors';

export class InclusionModel {
  constructor(private readonly registry: RepoRegistry) {}

  private repoOrThrow(repoId: string) {
    const repo = this.registry.get(repoId);
    if (!repo) {
      throw makeError('NO_REPOSITORY', `Repository not found: ${repoId}`);
    }
    return repo;
  }

  async stage(repoId: string, paths: string[]): Promise<void> {
    const repo = this.repoOrThrow(repoId);
    await repo.add(paths);
  }

  async unstage(repoId: string, paths: string[]): Promise<void> {
    const repo = this.repoOrThrow(repoId);
    await repo.restore(paths, { staged: true });
  }

  async stageAll(repoId: string): Promise<void> {
    const repo = this.repoOrThrow(repoId);
    const paths = [
      ...repo.state.workingTreeChanges.map((c) => c.path),
      ...repo.state.untrackedChanges.map((c) => c.path),
    ];
    if (paths.length > 0) {
      await repo.add(paths);
    }
  }

  async unstageAll(repoId: string): Promise<void> {
    const repo = this.repoOrThrow(repoId);
    const paths = repo.state.indexChanges.map((c) => c.path);
    if (paths.length > 0) {
      await repo.restore(paths, { staged: true });
    }
  }

  /** Returns an error when the index does not match the expected staged set. */
  validateExpectedStaged(repoId: string, expected: string[]): ProtocolError | undefined {
    const repo = this.repoOrThrow(repoId);
    const actual = new Set(repo.state.indexChanges.map((c) => c.path));
    const expectedSet = new Set(expected);
    if (actual.size !== expectedSet.size || [...expectedSet].some((p) => !actual.has(p))) {
      return makeError(
        'STAGED_MISMATCH',
        'Staged files no longer match the checked selection (an external Git operation may have occurred); commit blocked',
        ['retry'],
      );
    }
    return undefined;
  }
}