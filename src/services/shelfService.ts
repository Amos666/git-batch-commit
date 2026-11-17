import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { RepoRegistry } from '../adapter/repoRegistry';
import { Status } from '../adapter/gitApiTypes';
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
      throw makeError('GENERIC', `Shelf 名称需为 1–${NAME_CAP} 字符`);
    }
    if (paths.length === 0 || paths.length > PATHS_CAP || !paths.every(validatePath)) {
      throw makeError('GENERIC', 'Shelf 文件列表非法');
    }
    const conflicted = new Set(
      repo.state.mergeChanges.map((c) => path.relative(desc.rootPath, c.uri.fsPath).split(path.sep).join('/')),
    );
    const tracked = new Set(
      [...repo.state.workingTreeChanges, ...repo.state.indexChanges]
        .filter((c) => c.status !== Status.UNTRACKED && c.status !== Status.IGNORED && c.status < Status.ADDED_BY_US)
        .map((c) => path.relative(desc.rootPath, c.uri.fsPath).split(path.sep).join('/')),
    );
    for (const p of paths) {
      if (conflicted.has(p)) {
        throw makeError('CONFLICT', '冲突文件请先解决冲突', ['openMergeEditor']);
      }
      if (!tracked.has(p)) {
        throw makeError('GENERIC', `只能搁置已跟踪文件的改动: ${p}`);
      }
    }
    const res = await this.mini.run(desc.rootPath, { cmd: 'diff-head', paths });
    const patch = res.stdout.toString('utf8');
    if (patch.trim().length === 0) {
      throw makeError('NO_CHANGES', '所选文件没有相对 HEAD 的改动');
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
      throw makeError('GENERIC', '补丁与当前工作区状态不匹配，未搁置');
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
      throw makeError('SHELF_NOT_FOUND', `Shelf 不存在: ${id}`);
    }
    const patch = fs.readFileSync(this.patchPath(id), 'utf8');
    let target = this.patchPath(id);
    let partPath: string | undefined;
    if (paths && paths.length > 0) {
      if (!paths.every((p) => entry.files.includes(p))) {
        throw makeError('GENERIC', '恢复路径不在该 Shelf 中');
      }
      const filtered = filterPatch(patch, paths);
      if (filtered.trim().length === 0) {
        throw makeError('GENERIC', '所选路径在补丁中不存在');
      }
      partPath = this.patchPath(`${id}.part`);
      fs.writeFileSync(partPath, filtered);
      target = partPath;
    }
    try {
      try {
        await this.mini.run(desc.rootPath, { cmd: 'apply-check', patchPath: target });
      } catch (err) {
        throw makeError('SHELF_APPLY_FAILED', `补丁无法干净应用（当前分支内容已变化）: ${(err as ProtocolError).message}`);
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
      throw makeError('SHELF_NOT_FOUND', `Shelf 不存在: ${id}`);
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
      throw makeError('NO_REPOSITORY', `仓库不存在: ${repoId}`);
    }
    return repo;
  }

  private descOrThrow(repoId: string) {
    const desc = this.registry.descriptor(repoId);
    if (!desc) {
      throw makeError('NO_REPOSITORY', `仓库不存在: ${repoId}`);
    }
    return desc;
  }
}