import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { RepoRegistry } from '../adapter/repoRegistry';
import { KernelStatus } from '../kernel/types';
import type { MiniRunner } from '../core/miniRunner';
import { validatePath } from '../core/miniRunner';
import { makeError } from '../protocol/errors';
import type { ProtocolError } from '../protocol/errors';
import type { ShelfEntry } from '../protocol/messages';
import { filterPatch } from './patchFilter';

interface StoredEntry extends ShelfEntry {
  repoRoot: string;
}

const NAME_CAP = 100;
const PATHS_CAP = 1000;

/** IDE-managed named patch storage (IDEA Shelf semantics), independent of the git stash stack. */
export class ShelfService {
  constructor(
    private readonly registry: RepoRegistry,
    private readonly mini: MiniRunner,
    private readonly shelfRoot: string,
  ) {}

  async list(repoId: string): Promise<ShelfEntry[]> {
    const desc = this.descOrThrow(repoId);
    return this.readIndex()
      .filter((e) => e.repoRoot === desc.rootPath)
      .map(({ repoRoot, ...entry }) => entry);
  }

  async create(repoId: string, name: string, paths: string[]): Promise<ShelfEntry> {
    const repo = this.repoOrThrow(repoId);
    const desc = this.descOrThrow(repoId);
    const trimmed = name.trim();
    if (trimmed.length === 0 || trimmed.length > NAME_CAP) {
      throw makeError('GENERIC', `Shelf name must be 1–${NAME_CAP} characters`);
    }
    if (paths.length === 0 || paths.length > PATHS_CAP || !paths.every(validatePath)) {
      throw makeError('GENERIC', 'Invalid shelf file list');
    }
    const conflicted = new Set(repo.state.mergeChanges.map((c) => c.path));
    const tracked = new Set(
      [...repo.state.workingTreeChanges, ...repo.state.indexChanges]
        .filter((c) => c.status !== KernelStatus.UNTRACKED && c.status !== KernelStatus.IGNORED && c.status < KernelStatus.ADDED_BY_US)
        .map((c) => c.path),
    );
    for (const p of paths) {
      if (conflicted.has(p)) {
        throw makeError('CONFLICT', 'Resolve conflicts in this file first', ['openMergeEditor']);
      }
      if (!tracked.has(p)) {
        throw makeError('GENERIC', `Only changes to tracked files can be shelved: ${p}`);
      }
    }
    const res = await this.mini.run(desc.rootPath, { cmd: 'diff-head', paths });
    const patch = res.stdout.toString('utf8');
    if (patch.trim().length === 0) {
      throw makeError('NO_CHANGES', 'The selected files have no changes relative to HEAD');
    }
    fs.mkdirSync(this.shelfRoot, { recursive: true });
    const id = randomUUID();
    const patchPath = this.patchPath(id);
    fs.writeFileSync(patchPath, patch);
    try {
      // reverse-check proves the saved patch exactly describes the current state before we revert it
      await this.mini.run(desc.rootPath, { cmd: 'apply-check', patchPath, reverse: true });
    } catch {
      fs.rmSync(patchPath, { force: true });
      throw makeError('GENERIC', 'Patch does not match the current worktree state; nothing was shelved');
    }
    try {
      await this.mini.run(desc.rootPath, { cmd: 'restore-head', paths });
    } catch (err) {
      fs.rmSync(patchPath, { force: true });
      throw err;
    }
    const entry: StoredEntry = {
      id,
      name: trimmed,
      createdAt: Date.now(),
      branch: repo.state.HEAD?.name ?? '',
      files: paths,
      repoRoot: desc.rootPath,
    };
    this.writeIndex([...this.readIndex(), entry]);
    const { repoRoot, ...rest } = entry;
    return rest;
  }

  async unshelve(repoId: string, id: string, paths?: string[], removeAfter?: boolean): Promise<void> {
    const desc = this.descOrThrow(repoId);
    const index = this.readIndex();
    const entry = index.find((e) => e.id === id && e.repoRoot === desc.rootPath);
    if (!entry) {
      throw makeError('SHELF_NOT_FOUND', `Shelf not found: ${id}`);
    }
    const patch = fs.readFileSync(this.patchPath(id), 'utf8');
    let target = this.patchPath(id);
    let partPath: string | undefined;
    if (paths && paths.length > 0) {
      if (!paths.every((p) => entry.files.includes(p))) {
        throw makeError('GENERIC', 'Restore path is not part of this shelf');
      }
      const filtered = filterPatch(patch, paths);
      if (filtered.trim().length === 0) {
        throw makeError('GENERIC', 'The selected paths do not exist in the patch');
      }
      partPath = this.patchPath(`${id}.part`);
      fs.writeFileSync(partPath, filtered);
      target = partPath;
    }
    try {
      try {
        await this.mini.run(desc.rootPath, { cmd: 'apply-check', patchPath: target });
      } catch (err) {
        throw makeError('SHELF_APPLY_FAILED', `Patch cannot be applied cleanly (branch content has changed): ${(err as ProtocolError).message}`);
      }
      await this.mini.run(desc.rootPath, { cmd: 'apply', patchPath: target });
    } finally {
      if (partPath) {
        fs.rmSync(partPath, { force: true });
      }
    }
    if (removeAfter) {
      this.removeEntry(index, id);
    }
  }

  async delete(repoId: string, id: string): Promise<void> {
    const desc = this.descOrThrow(repoId);
    const index = this.readIndex();
    if (!index.some((e) => e.id === id && e.repoRoot === desc.rootPath)) {
      throw makeError('SHELF_NOT_FOUND', `Shelf not found: ${id}`);
    }
    this.removeEntry(index, id);
  }

  private removeEntry(index: StoredEntry[], id: string): void {
    fs.rmSync(this.patchPath(id), { force: true });
    this.writeIndex(index.filter((e) => e.id !== id));
  }

  private patchPath(id: string): string {
    return path.join(this.shelfRoot, `${id}.diff`);
  }

  private indexPath(): string {
    return path.join(this.shelfRoot, 'index.json');
  }

  private readIndex(): StoredEntry[] {
    try {
      const raw: unknown = JSON.parse(fs.readFileSync(this.indexPath(), 'utf8'));
      return Array.isArray(raw) ? (raw as StoredEntry[]) : [];
    } catch {
      return [];
    }
  }

  private writeIndex(entries: StoredEntry[]): void {
    fs.mkdirSync(this.shelfRoot, { recursive: true });
    const tmp = `${this.indexPath()}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(entries, null, 2));
    fs.renameSync(tmp, this.indexPath());
  }

  private repoOrThrow(repoId: string) {
    const repo = this.registry.get(repoId);
    if (!repo) {
      throw makeError('NO_REPOSITORY', `Repository not found: ${repoId}`);
    }
    return repo;
  }

  private descOrThrow(repoId: string) {
    const desc = this.registry.descriptor(repoId);
    if (!desc) {
      throw makeError('NO_REPOSITORY', `Repository not found: ${repoId}`);
    }
    return desc;
  }
}