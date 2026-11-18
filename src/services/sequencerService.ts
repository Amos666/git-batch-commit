import * as fs from 'node:fs';
import * as path from 'node:path';
import type { RepoRegistry } from '../adapter/repoRegistry';
import type { MiniRunner } from '../core/miniRunner';
import { makeError } from '../protocol/errors';
import type { ProtocolError } from '../protocol/errors';

const OID_RE = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const CONFLICT_RE = /conflict|could not apply|after resolving|mark them with|now empty/i;

/** cherry-pick / revert / undo-commit via the MiniRunner whitelist; revert never auto-commits. */
export class SequencerService {
  constructor(
    private readonly registry: RepoRegistry,
    private readonly mini: MiniRunner,
  ) {}

  async cherryPick(repoId: string, oid: string): Promise<void> {
    const { repo, rootPath } = this.locate(repoId, oid);
    const commit = await repo.getCommit(oid);
    if (commit.parents.length > 1) {
      throw makeError('GENERIC', 'Cherry-picking merge commits is not supported yet (mainline -m selection required)');
    }
    await this.runSequencer(repoId, rootPath, { cmd: 'cherry-pick', oid });
  }

  /** Stages the inverse change set; the user reviews and commits it from the panel. */
  async revert(repoId: string, oid: string): Promise<void> {
    const { rootPath } = this.locate(repoId, oid);
    await this.runSequencer(repoId, rootPath, { cmd: 'revert', oid });
  }

  /** Undo HEAD via soft reset: changes stay staged; refuses pushed commits and in-progress operations. */
  async undoCommit(repoId: string): Promise<void> {
    const repo = this.registry.get(repoId);
    const desc = this.registry.descriptor(repoId);
    if (!repo || !desc) {
      throw makeError('NO_REPOSITORY', `Repository not found: ${repoId}`);
    }
    if (repo.state.mergeChanges.length > 0) {
      throw makeError('CONFLICT', 'Unresolved conflicts exist; resolve them or abort the current operation first', ['openMergeEditor']);
    }
    if (repo.state.rebaseCommit) {
      throw makeError('GENERIC', 'A rebase is in progress; finish or abort it first');
    }
    const headOid = repo.state.HEAD?.commit;
    if (!headOid || !OID_RE.test(headOid)) {
      throw makeError('NO_CHANGES', 'There is no commit to undo');
    }
    const gitDirRaw = (await this.mini.run(desc.rootPath, { cmd: 'git-dir' })).stdout.toString('utf8').trim();
    const gitDir = path.isAbsolute(gitDirRaw) ? gitDirRaw : path.join(desc.rootPath, gitDirRaw);
    for (const marker of ['MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD']) {
      if (fs.existsSync(path.join(gitDir, marker))) {
        throw makeError('GENERIC', 'A merge/cherry-pick/revert is in progress; finish or abort it before undoing the commit');
      }
    }
    const head = await repo.getCommit(headOid);
    const parent = head.parents[0];
    if (!parent) {
      throw makeError('GENERIC', 'The root commit has no parent; it cannot be undone');
    }
    const remoteBranches = (await this.mini.run(desc.rootPath, { cmd: 'remote-contains', oid: headOid })).stdout.toString('utf8').trim();
    if (remoteBranches) {
      throw makeError('GENERIC', `This commit already exists on a remote branch (${remoteBranches.split('\n')[0]}); undoing it would fork history, blocked`);
    }
    await this.mini.run(desc.rootPath, { cmd: 'reset-soft', oid: parent });
  }

  async abort(repoId: string): Promise<void> {
    const desc = this.registry.descriptor(repoId);
    if (!desc) {
      throw makeError('NO_REPOSITORY', `Repository not found: ${repoId}`);
    }
    try {
      await this.mini.run(desc.rootPath, { cmd: 'cherry-pick-abort' });
      return;
    } catch {
      // not a cherry-pick sequencer; fall through to revert
    }
    try {
      await this.mini.run(desc.rootPath, { cmd: 'revert-abort' });
    } catch {
      throw makeError('GENERIC', 'No cherry-pick or revert is in progress');
    }
  }

  private async runSequencer(repoId: string, rootPath: string, req: { cmd: 'cherry-pick'; oid: string } | { cmd: 'revert'; oid: string }): Promise<void> {
    try {
      await this.mini.run(rootPath, req);
    } catch (err) {
      const pe = err as ProtocolError;
      if (pe.code === 'GENERIC' && CONFLICT_RE.test(pe.message)) {
        throw {
          ...makeError('CONFLICT', `${req.cmd === 'cherry-pick' ? 'Cherry-pick' : 'Revert'} produced conflicts or an empty commit: ${pe.message}`, [
            'abortSequencer',
            'showGitOutput',
          ]),
          repoId,
        };
      }
      throw pe;
    }
  }

  private locate(repoId: string, oid: string) {
    if (!OID_RE.test(oid)) {
      throw makeError('GENERIC', 'Invalid commit OID');
    }
    const repo = this.registry.get(repoId);
    const desc = this.registry.descriptor(repoId);
    if (!repo || !desc) {
      throw makeError('NO_REPOSITORY', `Repository not found: ${repoId}`);
    }
    return { repo, rootPath: desc.rootPath };
  }
}