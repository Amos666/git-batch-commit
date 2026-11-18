import type { RepoRegistry } from '../adapter/repoRegistry';
import { asGitErrorLike } from '../adapter/gitApiTypes';
import type { MiniRunner } from '../core/miniRunner';
import { makeError, mapGitErrorCode } from '../protocol/errors';
import type { ProtocolError } from '../protocol/errors';
import type { StashEntry } from '../protocol/messages';

const MESSAGE_CAP = 500;

export class StashService {
  constructor(
    private readonly registry: RepoRegistry,
    private readonly mini: MiniRunner,
  ) {}

  async list(repoId: string): Promise<StashEntry[]> {
    const repo = this.repoOrThrow(repoId);
    if (repo.getStashes) {
      const stashes = await repo.getStashes();
      return stashes.map((s) => ({
        index: s.index,
        hash: s.hash,
        description: s.description,
        branchName: s.branchName,
        date: s.commitDate?.getTime(),
      }));
    }
    // older builds: whitelisted `stash list` fallback
    const desc = this.registry.descriptor(repoId);
    if (!desc) {
      throw makeError('NO_REPOSITORY', `Repository not found: ${repoId}`);
    }
    const res = await this.mini.run(desc.rootPath, { cmd: 'stash-list' });
    const fields = res.stdout.toString('utf8').split('\0').filter((f) => f.length > 0);
    const entries: StashEntry[] = [];
    for (let i = 0; i + 2 < fields.length; i += 3) {
      const ref = fields[i] as string;
      const m = /^stash@\{(\d+)\}$/.exec(ref);
      if (!m) {
        continue;
      }
      entries.push({
        index: Number(m[1]),
        hash: fields[i + 1] as string,
        description: fields[i + 2] as string,
        branchName: '',
      });
    }
    return entries;
  }

  async create(repoId: string, opts: { message?: string; includeUntracked?: boolean; staged?: boolean }): Promise<void> {
    const repo = this.repoOrThrow(repoId);
    if (!repo.createStash) {
      throw makeError('CAPABILITY_UNAVAILABLE', 'The active git kernel does not support stash');
    }
    const message = opts.message?.trim().slice(0, MESSAGE_CAP);
    try {
      await repo.createStash({
        message: message || undefined,
        includeUntracked: opts.includeUntracked,
        staged: opts.staged,
      });
    } catch (err) {
      throw toProtocolError(err);
    }
  }

  async apply(repoId: string, index: number): Promise<void> {
    const repo = this.repoOrThrow(repoId);
    this.assertIndex(index);
    if (!repo.applyStash) {
      throw makeError('CAPABILITY_UNAVAILABLE', 'The active git kernel does not support stash');
    }
    try {
      await repo.applyStash(index);
    } catch (err) {
      throw toProtocolError(err);
    }
  }

  async pop(repoId: string, index: number): Promise<void> {
    const repo = this.repoOrThrow(repoId);
    this.assertIndex(index);
    if (!repo.popStash) {
      throw makeError('CAPABILITY_UNAVAILABLE', 'The active git kernel does not support stash');
    }
    try {
      await repo.popStash(index);
    } catch (err) {
      throw toProtocolError(err);
    }
  }

  async drop(repoId: string, index: number): Promise<void> {
    const repo = this.repoOrThrow(repoId);
    this.assertIndex(index);
    if (!repo.dropStash) {
      throw makeError('CAPABILITY_UNAVAILABLE', 'The active git kernel does not support stash');
    }
    try {
      // index is mandatory: upstream dropStash() without a number runs `stash clear`
      await repo.dropStash(index);
    } catch (err) {
      throw toProtocolError(err);
    }
  }

  private repoOrThrow(repoId: string) {
    const repo = this.registry.get(repoId);
    if (!repo) {
      throw makeError('NO_REPOSITORY', `Repository not found: ${repoId}`);
    }
    return repo;
  }

  private assertIndex(index: number): void {
    if (!Number.isInteger(index) || index < 0 || index > 10_000) {
      throw makeError('GENERIC', 'Invalid stash index');
    }
  }
}

function toProtocolError(err: unknown): ProtocolError {
  if (typeof err === 'object' && err !== null && 'code' in err && 'actions' in err) {
    return err as ProtocolError;
  }
  const gitErr = asGitErrorLike(err);
  return mapGitErrorCode(gitErr.gitErrorCode, gitErr.stderr ?? gitErr.message ?? String(err));
}