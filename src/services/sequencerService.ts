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
      throw makeError('GENERIC', '暂不支持拣选合并提交（需要选择主线 -m）');
    }
    await this.runSequencer(rootPath, { cmd: 'cherry-pick', oid });
  }

  /** Stages the inverse change set; the user reviews and commits it from the panel. */
  async revert(repoId: string, oid: string): Promise<void> {
    const { rootPath } = this.locate(repoId, oid);
    await this.runSequencer(rootPath, { cmd: 'revert', oid });
  }

  /** Undo HEAD via soft reset: changes stay staged; refuses pushed commits and in-progress operations. */
  async undoCommit(repoId: string): Promise<void> {
    const repo = this.registry.get(repoId);
    const desc = this.registry.descriptor(repoId);
    if (!repo || !desc) {
      throw makeError('NO_REPOSITORY', `仓库不存在: ${repoId}`);
    }
    if (repo.state.mergeChanges.length > 0) {
      throw makeError('CONFLICT', '存在未解决的冲突，请先解决冲突或中止当前操作', ['openMergeEditor']);
    }
    if (repo.state.rebaseCommit) {
      throw makeError('GENERIC', '变基进行中，请先完成或中止变基');
    }
    const headOid = repo.state.HEAD?.commit;
    if (!headOid || !OID_RE.test(headOid)) {
      throw makeError('NO_CHANGES', '当前没有可撤销的提交');
    }
    const gitDirRaw = (await this.mini.run(desc.rootPath, { cmd: 'git-dir' })).stdout.toString('utf8').trim();
    const gitDir = path.isAbsolute(gitDirRaw) ? gitDirRaw : path.join(desc.rootPath, gitDirRaw);
    for (const marker of ['MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD']) {
      if (fs.existsSync(path.join(gitDir, marker))) {
        throw makeError('GENERIC', '有进行中的合并/拣选/反转，请先完成或中止后再撤销提交');
      }
    }
    const head = await repo.getCommit(headOid);
    const parent = head.parents[0];
    if (!parent) {
      throw makeError('GENERIC', '根提交没有父提交，无法撤销');
    }
    const remoteBranches = (await this.mini.run(desc.rootPath, { cmd: 'remote-contains', oid: headOid })).stdout.toString('utf8').trim();
    if (remoteBranches) {
      throw makeError('GENERIC', `该提交已存在于远端分支（${remoteBranches.split('\n')[0]}），撤销会导致历史分叉，已阻止`);
    }
    await this.mini.run(desc.rootPath, { cmd: 'reset-soft', oid: parent });
  }

  async abort(repoId: string): Promise<void> {
    const desc = this.registry.descriptor(repoId);
    if (!desc) {
      throw makeError('NO_REPOSITORY', `仓库不存在: ${repoId}`);
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
      throw makeError('GENERIC', '当前没有进行中的拣选或反转');
    }
  }

  private async runSequencer(rootPath: string, req: { cmd: 'cherry-pick'; oid: string } | { cmd: 'revert'; oid: string }): Promise<void> {
    try {
      await this.mini.run(rootPath, req);
    } catch (err) {
      const pe = err as ProtocolError;
      if (pe.code === 'GENERIC' && CONFLICT_RE.test(pe.message)) {
        throw makeError('CONFLICT', `${req.cmd === 'cherry-pick' ? '拣选' : '反转'}产生冲突或空提交：${pe.message}`, [
          'abortSequencer',
          'showGitOutput',
        ]);
      }
      throw pe;
    }
  }

  private locate(repoId: string, oid: string) {
    if (!OID_RE.test(oid)) {
      throw makeError('GENERIC', '提交 OID 非法');
    }
    const repo = this.registry.get(repoId);
    const desc = this.registry.descriptor(repoId);
    if (!repo || !desc) {
      throw makeError('NO_REPOSITORY', `仓库不存在: ${repoId}`);
    }
    return { repo, rootPath: desc.rootPath };
  }
}