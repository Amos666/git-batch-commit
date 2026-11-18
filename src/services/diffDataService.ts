import * as fs from 'node:fs';
import * as path from 'node:path';
import type { RepoRegistry } from '../adapter/repoRegistry';
import { isBinaryPatch, parseHunks, syntheticAddHunk } from '../core/hunkDiff';
import { validatePath } from '../core/miniRunner';
import type { MiniRunner } from '../core/miniRunner';
import { makeError } from '../protocol/errors';
import type { DiffDataResult, DiffSide } from '../protocol/messages';
import { guardWorktreeFile, looksBinary } from './diffData';

const TEXT_CAP = 2 * 1024 * 1024;
const PATCH_CAP = 8 * 1024 * 1024;

/** Data-side diff retrieval for the self-drawn viewer (kernel + fs only). */
export class DiffDataService {
  constructor(
    private readonly registry: RepoRegistry,
    private readonly mini: MiniRunner,
  ) {}

  async get(repoId: string, relPath: string, side: DiffSide, force: boolean, thresholdKB: number): Promise<DiffDataResult> {
    if (!validatePath(relPath)) {
      throw makeError('GENERIC', 'Invalid path');
    }
    const repo = this.registry.get(repoId);
    const desc = this.registry.descriptor(repoId);
    if (!repo || !desc) {
      throw makeError('NO_REPOSITORY', `Repository not found: ${repoId}`);
    }
    const rootPath = desc.rootPath;
    if (side !== 'staged' && !force) {
      await guardWorktreeFile(rootPath, repoId, relPath, side, thresholdKB);
    }
    let patch: string;
    if (side === 'staged') {
      if (!repo.diffIndexWithHEAD) {
        throw makeError('CAPABILITY_UNAVAILABLE', 'The active git kernel does not support staged diffs');
      }
      patch = await repo.diffIndexWithHEAD(relPath);
    } else if (side === 'worktree') {
      patch = (await this.mini.run(rootPath, { cmd: 'diff-worktree', path: relPath })).stdout.toString('utf8');
    } else {
      patch = (await this.mini.run(rootPath, { cmd: 'diff-head', paths: [relPath] })).stdout.toString('utf8');
    }
    if (isBinaryPatch(patch)) {
      return { side, binary: true, tooLarge: false, oldText: '', newText: '', hunks: [] };
    }
    if (patch.length > PATCH_CAP) {
      return this.tooLarge(repoId, relPath, side, force, 'Diff is too large to display');
    }
    let oldText: string;
    let newText: string;
    if (side === 'staged') {
      oldText = await this.blob(repo, 'HEAD', relPath);
      newText = await this.blob(repo, '', relPath);
    } else {
      oldText = await this.blob(repo, side === 'head' ? 'HEAD' : '', relPath);
      newText = await this.worktreeText(rootPath, relPath);
      const abs = path.join(rootPath, relPath);
      if (await looksBinary(abs)) {
        return { side, binary: true, tooLarge: false, oldText: '', newText: '', hunks: [] };
      }
    }
    if (oldText.length > TEXT_CAP || newText.length > TEXT_CAP) {
      return this.tooLarge(repoId, relPath, side, force, 'File is too large to display');
    }
    let hunks = parseHunks(patch);
    if (side !== 'staged' && hunks.length === 0 && newText !== '') {
      // untracked files have no diff against HEAD/index: whole-file add
      const tracked = (await this.mini.run(rootPath, { cmd: 'ls-files', path: relPath })).stdout.length > 0;
      if (!tracked) {
        oldText = '';
        hunks = [syntheticAddHunk(newText)];
      }
    }
    return { side, binary: false, tooLarge: false, oldText, newText, hunks };
  }

  private tooLarge(repoId: string, relPath: string, side: DiffSide, force: boolean, message: string): DiffDataResult {
    if (force) {
      return { side, binary: false, tooLarge: true, oldText: '', newText: '', hunks: [] };
    }
    const err = makeError('DIFF_GUARDED', message, ['forceOpenDiff']);
    err.diffContext = { repoId, path: relPath, side };
    throw err;
  }

  private async blob(repo: { buffer: (ref: string, path: string) => Promise<Buffer> }, ref: string, relPath: string): Promise<string> {
    try {
      return (await repo.buffer(ref, relPath)).toString('utf8');
    } catch {
      // absent blob (new file vs HEAD, deleted file vs index)
      return '';
    }
  }

  private async worktreeText(rootPath: string, relPath: string): Promise<string> {
    try {
      return await fs.promises.readFile(path.join(rootPath, relPath), 'utf8');
    } catch {
      // deleted in worktree
      return '';
    }
  }
}