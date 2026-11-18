import * as fs from 'node:fs';
import * as path from 'node:path';
import type { RepoRegistry } from '../adapter/repoRegistry';
import { applyHunks, applyLineSelection, countNewSideLines, isBinaryPatch, parseHunks, syntheticAddHunk } from '../core/hunkDiff';
import type { DiffHunk } from '../core/hunkDiff';
import { validatePath } from '../core/miniRunner';
import type { MiniRunner } from '../core/miniRunner';
import { makeError } from '../protocol/errors';
import type { HunkListResult } from '../protocol/messages';
import type { PartialSelection } from '../protocol/models';

const FILE_CAP = 2 * 1024 * 1024;
const PATCH_CAP = 8 * 1024 * 1024;

/**
 * C3 hunk staging: rebuild the index blob from base + selected hunks,
 * hash-object it through the built-in API, then update-index via the
 * MiniRunner whitelist. No `git apply --cached` anywhere.
 */
export class HunkService {
  private readonly locks = new Map<string, Promise<unknown>>();

  constructor(
    private readonly registry: RepoRegistry,
    private readonly mini: MiniRunner,
  ) {}

  async list(repoId: string, relPath: string, side: 'worktree' | 'staged'): Promise<HunkListResult> {
    const { repo, rootPath } = this.locate(repoId, relPath);
    this.assertNoConflict(repo.state.mergeChanges, rootPath, relPath);
    if (side === 'staged') {
      if (!repo.diffIndexWithHEAD) {
        throw makeError('CAPABILITY_UNAVAILABLE', 'The active git kernel does not support staged diffs');
      }
      const patch = await repo.diffIndexWithHEAD(relPath);
      return { side, binary: isBinaryPatch(patch), hunks: parseHunks(patch) };
    }
    if (await this.isUntracked(rootPath, relPath)) {
      const content = await this.readWorktreeGuarded(rootPath, relPath);
      return { side, binary: false, hunks: [syntheticAddHunk(content)] };
    }
    const patch = await this.worktreePatch(rootPath, relPath);
    return { side, binary: isBinaryPatch(patch), hunks: parseHunks(patch) };
  }

  /** Stage selected worktree→index hunks. */
  async stage(repoId: string, relPath: string, hunkIds: number[]): Promise<void> {
    await this.stageCore(repoId, relPath, (hunks) => {
      const selected = this.validateIds(hunks, hunkIds);
      return hunks.filter((h) => selected.has(h.id));
    });
  }

  /** Stage a hunk+line selection (worktree→index). */
  async stagePartial(repoId: string, relPath: string, selection: PartialSelection): Promise<void> {
    await this.stageCore(repoId, relPath, (hunks) => applyLineSelection(hunks, selection));
  }

  private async stageCore(repoId: string, relPath: string, transform: (hunks: DiffHunk[]) => DiffHunk[]): Promise<void> {
    await this.serialize(repoId, async () => {
      const { repo, rootPath } = this.locate(repoId, relPath);
      this.assertNoConflict(repo.state.mergeChanges, rootPath, relPath);
      const untracked = await this.isUntracked(rootPath, relPath);
      let base: string;
      let hunks: DiffHunk[];
      if (untracked) {
        base = '';
        hunks = [syntheticAddHunk(await this.readWorktreeGuarded(rootPath, relPath))];
      } else {
        const patch = await this.worktreePatch(rootPath, relPath);
        if (isBinaryPatch(patch)) {
          throw makeError('GENERIC', 'Binary files do not support hunk staging');
        }
        hunks = parseHunks(patch);
        // buffer('', path) → `git show :path` = index blob (F13: '~' is not special-cased)
        base = this.decodeUtf8(await repo.buffer('', relPath));
      }
      const filtered = transform(hunks);
      const next = applyHunks(base, filtered, new Set(filtered.map((h) => h.id)));
      if (next === base) {
        return;
      }
      const mode = untracked ? await this.worktreeMode(rootPath, relPath) : await this.indexMode(rootPath, relPath);
      await this.writeIndexBlob(repo, rootPath, relPath, mode, next);
    });
  }

  /** Remove selected HEAD→index hunks from the index (keep the rest staged). */
  async unstage(repoId: string, relPath: string, hunkIds: number[]): Promise<void> {
    await this.unstageCore(repoId, relPath, (hunks) => {
      const remove = this.validateIds(hunks, hunkIds);
      return hunks.filter((h) => !remove.has(h.id));
    });
  }

  /** Remove a hunk+line selection from the index (keep the rest staged). */
  async unstagePartial(repoId: string, relPath: string, selection: PartialSelection): Promise<void> {
    await this.unstageCore(repoId, relPath, (hunks) => {
      const remove = this.validateIds(hunks, selection.hunkIds);
      const keep: DiffHunk[] = [];
      for (const h of hunks) {
        if (!remove.has(h.id)) {
          keep.push(h);
          continue;
        }
        const offsets = selection.lines?.[h.id];
        if (!offsets) {
          continue;
        }
        const dropped = new Set(offsets);
        const complement: number[] = [];
        for (let i = 0; i < countNewSideLines(h); i++) {
          if (!dropped.has(i)) {
            complement.push(i);
          }
        }
        keep.push(...applyLineSelection([h], { hunkIds: [h.id], lines: { [h.id]: complement } }));
      }
      return keep;
    });
  }

  private async unstageCore(repoId: string, relPath: string, transform: (hunks: DiffHunk[]) => DiffHunk[]): Promise<void> {
    await this.serialize(repoId, async () => {
      const { repo, rootPath } = this.locate(repoId, relPath);
      this.assertNoConflict(repo.state.mergeChanges, rootPath, relPath);
      if (!repo.diffIndexWithHEAD) {
        throw makeError('CAPABILITY_UNAVAILABLE', 'The active git kernel does not support staged diffs');
      }
      const patch = await repo.diffIndexWithHEAD(relPath);
      if (isBinaryPatch(patch)) {
        throw makeError('GENERIC', 'Binary files do not support hunk staging');
      }
      const hunks = parseHunks(patch);
      let headBase = '';
      try {
        headBase = this.decodeUtf8(await repo.buffer('HEAD', relPath));
      } catch {
        // newly added file: no HEAD blob
      }
      const keep = transform(hunks);
      const next = applyHunks(headBase, keep, new Set(keep.map((h) => h.id)));
      if (next === headBase) {
        await repo.restore([relPath], { staged: true });
        return;
      }
      const mode = await this.indexMode(rootPath, relPath);
      await this.writeIndexBlob(repo, rootPath, relPath, mode, next);
    });
  }

  private async worktreePatch(rootPath: string, relPath: string): Promise<string> {
    // built-in diffIndexWith is actually `diff --cached <ref>` upstream (F12),
    // so the index→worktree patch comes from the whitelisted MiniRunner
    const res = await this.mini.run(rootPath, { cmd: 'diff-worktree', path: relPath });
    const patch = res.stdout.toString('utf8');
    if (patch.length > PATCH_CAP) {
      throw makeError('GENERIC', 'Diff is too large for hunk staging');
    }
    return patch;
  }

  private locate(repoId: string, relPath: string) {
    if (!validatePath(relPath)) {
      throw makeError('GENERIC', 'Invalid path');
    }
    const repo = this.registry.get(repoId);
    const desc = this.registry.descriptor(repoId);
    if (!repo || !desc) {
      throw makeError('NO_REPOSITORY', `Repository not found: ${repoId}`);
    }
    return { repo, rootPath: desc.rootPath };
  }

  private assertNoConflict(mergeChanges: { path: string }[], _rootPath: string, relPath: string): void {
    if (mergeChanges.some((c) => c.path === relPath)) {
      throw makeError('CONFLICT', 'Resolve conflicts in this file first', ['openMergeEditor']);
    }
  }

  /** ls-files based: independent of the built-in untracked display mode (mixed/separate). */
  private async isUntracked(rootPath: string, relPath: string): Promise<boolean> {
    const res = await this.mini.run(rootPath, { cmd: 'ls-files', path: relPath });
    return res.stdout.length === 0;
  }

  private validateIds(hunks: DiffHunk[], hunkIds: number[]): Set<number> {
    const valid = new Set(hunks.map((h) => h.id));
    const selected = new Set<number>();
    for (const id of hunkIds) {
      if (!Number.isInteger(id) || !valid.has(id)) {
        throw makeError('HUNK_CONFLICT', 'Hunks have changed; refresh and retry');
      }
      selected.add(id);
    }
    return selected;
  }

  private decodeUtf8(buf: Buffer): string {
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(buf);
    } catch {
      throw makeError('GENERIC', 'Non-UTF-8 files do not support hunk staging');
    }
  }

  private async readWorktreeGuarded(rootPath: string, relPath: string): Promise<string> {
    const abs = path.join(rootPath, relPath);
    const stat = await fs.promises.stat(abs);
    if (!stat.isFile() || stat.size > FILE_CAP) {
      throw makeError('GENERIC', 'File is too large for hunk staging');
    }
    const buf = await fs.promises.readFile(abs);
    if (buf.subarray(0, 8192).includes(0)) {
      throw makeError('GENERIC', 'Binary files do not support hunk staging');
    }
    return this.decodeUtf8(buf);
  }

  private async worktreeMode(rootPath: string, relPath: string): Promise<'100644' | '100755'> {
    const stat = await fs.promises.stat(path.join(rootPath, relPath));
    return stat.mode & 0o111 ? '100755' : '100644';
  }

  private async indexMode(rootPath: string, relPath: string): Promise<'100644' | '100755' | '120000'> {
    const res = await this.mini.run(rootPath, { cmd: 'ls-files', path: relPath });
    const mode = res.stdout.toString('utf8').split(' ')[0];
    if (mode === '100755' || mode === '120000') {
      return mode;
    }
    return '100644';
  }

  private async writeIndexBlob(
    repo: { hashObject?: (content: Buffer) => Promise<string> },
    rootPath: string,
    relPath: string,
    mode: '100644' | '100755' | '120000',
    content: string,
  ): Promise<void> {
    if (!repo.hashObject) {
      throw makeError('CAPABILITY_UNAVAILABLE', 'The active git kernel does not support hashObject');
    }
    const oid = await repo.hashObject(Buffer.from(content, 'utf8'));
    await this.mini.run(rootPath, { cmd: 'update-index', entries: [{ mode, oid, path: relPath }] });
  }

  private serialize<T>(repoId: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.locks.get(repoId) ?? Promise.resolve();
    const task = prev.then(fn);
    this.locks.set(
      repoId,
      task.catch(() => {}),
    );
    return task;
  }
}