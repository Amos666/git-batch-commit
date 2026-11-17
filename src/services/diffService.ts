import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import type { DiffBetweenFile, GitApi, Repository } from '../adapter/gitApiTypes';
import { RepoRegistry } from '../adapter/repoRegistry';
import { makeError } from '../protocol/errors';
import type { DiffSide } from '../protocol/messages';
import { parseDiffPaths } from './diffPaths';

const EMPTY_TREE_OID = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';
const BINARY_PROBE_BYTES = 8192;

export class DiffService {
  constructor(private readonly api: GitApi, private readonly registry: RepoRegistry) {}

  async open(repoId: string, relPath: string, side: DiffSide, force = false): Promise<void> {
    const desc = this.registry.descriptor(repoId);
    if (!desc) {
      throw makeError('NO_REPOSITORY', `仓库不存在: ${repoId}`);
    }
    const fileUri = vscode.Uri.file(path.join(desc.rootPath, relPath));
    if (!force && side !== 'staged') {
      await this.guardWorktreeFile(repoId, relPath, side, fileUri);
    }
    const name = path.basename(relPath);
    let left: vscode.Uri;
    let right: vscode.Uri;
    let title: string;
    switch (side) {
      case 'staged':
        left = this.api.toGitUri(fileUri, 'HEAD');
        right = this.api.toGitUri(fileUri, '~');
        title = `${name} (HEAD ↔ Index)`;
        break;
      case 'worktree':
        left = this.api.toGitUri(fileUri, '~');
        right = fileUri;
        title = `${name} (Index ↔ Working Tree)`;
        break;
      default:
        left = this.api.toGitUri(fileUri, 'HEAD');
        right = fileUri;
        title = `${name} (Working Tree ↔ HEAD)`;
    }
    await vscode.commands.executeCommand('vscode.diff', left, right, title, { preview: true });
  }

  /** Open a commit as a multi-file diff (parent ↔ commit). */
  async openCommit(repoId: string, oid: string): Promise<void> {
    const desc = this.registry.descriptor(repoId);
    const repo = this.registry.get(repoId);
    if (!desc || !repo) {
      throw makeError('NO_REPOSITORY', `仓库不存在: ${repoId}`);
    }
    const commit = await repo.getCommit(oid);
    const parent = commit.parents[0];
    const entries = await this.commitFileEntries(repo, oid, parent);
    if (entries.length === 0) {
      void vscode.window.showInformationMessage(`提交 ${oid.slice(0, 7)} 没有文件变更（可能是空提交或合并提交）。`);
      return;
    }
    const title = `${desc.name} · ${oid.slice(0, 7)} ${firstLine(commit.message)}`;
    const leftRef = parent ?? EMPTY_TREE_OID;
    const resources = entries.map((e) => this.compareResources(e, leftRef, oid));
    try {
      await vscode.commands.executeCommand('vscode.changes', title, resources);
    } catch {
      const [first] = resources;
      if (first) {
        await vscode.commands.executeCommand('vscode.diff', first[1], first[2], title, { preview: true });
      }
    }
  }

  /** Open a multi-file diff between HEAD (or merge-base) and another branch. */
  async openBranchCompare(repoId: string, otherRef: string): Promise<void> {
    const desc = this.registry.descriptor(repoId);
    const repo = this.registry.get(repoId);
    if (!desc || !repo) {
      throw makeError('NO_REPOSITORY', `仓库不存在: ${repoId}`);
    }
    const head = repo.state.HEAD;
    const headRef = head?.name ?? head?.commit;
    if (!headRef) {
      throw makeError('NO_CHANGES', '当前仓库没有提交，无法对比分支');
    }
    let base = headRef;
    if (repo.getMergeBase) {
      try {
        base = (await repo.getMergeBase(headRef, otherRef)) ?? headRef;
      } catch {
        // unrelated histories: fall back to direct HEAD comparison
      }
    }
    const entries = await this.branchCompareEntries(repo, base, otherRef);
    if (entries.length === 0) {
      void vscode.window.showInformationMessage(`${desc.name}: ${headRef} 与 ${otherRef} 没有文件差异。`);
      return;
    }
    const title = `${desc.name} · ${headRef} ↔ ${otherRef}`;
    const resources = entries.map((e) => this.compareResources(e, base, otherRef));
    try {
      await vscode.commands.executeCommand('vscode.changes', title, resources);
    } catch {
      const [first] = resources;
      if (first) {
        await vscode.commands.executeCommand('vscode.diff', first[1], first[2], title, { preview: true });
      }
    }
  }

  private async commitFileEntries(repo: Repository, oid: string, parent: string | undefined): Promise<DiffBetweenFile[]> {
    // newer builds: stats2 takes a raw range; `<oid>^!` covers root commits
    // (the empty-tree special case in diffBetweenWithStats is broken upstream:
    // it compares against an async getter, so three-dot ranges always fail there)
    if (typeof repo.diffBetweenWithStats2 === 'function') {
      const range = parent ? `${parent}..${oid}` : `${oid}^!`;
      return repo.diffBetweenWithStats2(range);
    }
    if (parent && typeof repo.diffBetweenPatch === 'function') {
      return this.patchEntries(repo, await repo.diffBetweenPatch(parent, oid));
    }
    // documented fallback: older API returns a patch string, newer stable parsed entries
    const result = await repo.diffBetween(parent ?? EMPTY_TREE_OID, oid);
    if (typeof result === 'string') {
      return this.patchEntries(repo, result);
    }
    return result;
  }

  private async branchCompareEntries(repo: Repository, base: string, otherRef: string): Promise<DiffBetweenFile[]> {
    if (typeof repo.diffBetweenWithStats2 === 'function') {
      return repo.diffBetweenWithStats2(`${base}..${otherRef}`);
    }
    const result = await repo.diffBetween(base, otherRef);
    return typeof result === 'string' ? [] : result;
  }

  private patchEntries(repo: Repository, patch: string): DiffBetweenFile[] {
    // patch fallback carries no status; treat every path as modified
    const rootPath = repo.rootUri.fsPath;
    return parseDiffPaths(patch).map((p) => ({ uri: vscode.Uri.file(path.join(rootPath, p)) }));
  }

  /**
   * Build [resource, original, modified] for the multi-diff editor.
   * Added files must point the original side at the empty tree and deleted
   * files the modified side: `git show <ref>:<path>` throws for a path absent
   * in that ref, and the multi-diff editor then drops the entry ("No Changed Files").
   * Renames keep the old path on the original side.
   */
  private compareResources(
    entry: DiffBetweenFile,
    baseRef: string,
    targetRef: string,
  ): [vscode.Uri, vscode.Uri, vscode.Uri] {
    const newPath = entry.renameUri ?? entry.uri;
    const fileUri = vscode.Uri.file(newPath.fsPath);
    const oldUri = entry.originalUri ?? entry.uri;
    const oldFileUri = vscode.Uri.file(oldUri.fsPath);
    const status = entry.status;
    // Status enum: INDEX_ADDED/ADDED=1, INDEX_DELETED=2, DELETED=6; renames carry originalUri
    const added = status === 1;
    const deleted = status === 2 || status === 6;
    const renamed = entry.originalUri !== undefined && entry.originalUri.fsPath !== newPath.fsPath;
    const left = added
      ? this.api.toGitUri(fileUri, EMPTY_TREE_OID)
      : this.api.toGitUri(renamed ? oldFileUri : fileUri, baseRef);
    const right = deleted ? this.api.toGitUri(fileUri, EMPTY_TREE_OID) : this.api.toGitUri(fileUri, targetRef);
    return [fileUri, left, right];
  }

  private async guardWorktreeFile(repoId: string, relPath: string, side: DiffSide, fileUri: vscode.Uri): Promise<void> {
    let stat: fs.Stats;
    try {
      stat = await fs.promises.stat(fileUri.fsPath);
    } catch {
      return; // deleted files: diff shows removal, nothing to guard
    }
    if (!stat.isFile()) {
      return;
    }
    const thresholdKB = vscode.workspace
      .getConfiguration('gitBatchCommit.diff')
      .get<number>('largeFileThresholdKB', 2048);
    const context = { repoId, path: relPath, side };
    if (stat.size > thresholdKB * 1024) {
      const err = makeError(
        'DIFF_GUARDED',
        `文件较大（${(stat.size / 1024 / 1024).toFixed(1)} MB，阈值 ${thresholdKB} KB），直接打开 Diff 可能卡顿`,
        ['forceOpenDiff'],
      );
      err.diffContext = context;
      throw err;
    }
    if (await looksBinary(fileUri.fsPath)) {
      const err = makeError('DIFF_GUARDED', '文件疑似二进制，Diff 编辑器无法有效展示', ['forceOpenDiff']);
      err.diffContext = context;
      throw err;
    }
  }
}

async function looksBinary(fsPath: string): Promise<boolean> {
  let handle: fs.promises.FileHandle | undefined;
  try {
    handle = await fs.promises.open(fsPath, 'r');
    const buf = Buffer.alloc(BINARY_PROBE_BYTES);
    const { bytesRead } = await handle.read(buf, 0, BINARY_PROBE_BYTES, 0);
    return buf.subarray(0, bytesRead).includes(0);
  } catch {
    return false;
  } finally {
    await handle?.close();
  }
}

function firstLine(message: string): string {
  const line = message.split('\n')[0] ?? '';
  return line.length > 60 ? `${line.slice(0, 60)}…` : line;
}