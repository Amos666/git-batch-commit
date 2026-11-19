import * as path from 'node:path';
import * as vscode from 'vscode';
import { acquireGitApi } from '../adapter/gitApi';
import type { GitApi } from '../adapter/gitApiTypes';
import { RepoRegistry } from '../adapter/repoRegistry';
import { makeError } from '../protocol/errors';
import type { DiffSide } from '../protocol/messages';
import type { PushCommitFile } from '../protocol/models';
import { commitFileEntries, EMPTY_TREE_OID, rangeFileEntries } from '../services/commitFiles';
import { guardWorktreeFile } from '../services/diffData';

/** Host-only editor side effects: native diff / multi-diff / merge editor. */
export class EditorBridge {
  private apiPromise: Promise<GitApi> | undefined;

  constructor(private readonly registry: RepoRegistry) {}

  private api(): Promise<GitApi> {
    this.apiPromise ??= acquireGitApi();
    return this.apiPromise;
  }

  async open(repoId: string, relPath: string, side: DiffSide, force = false): Promise<void> {
    const desc = this.registry.descriptor(repoId);
    if (!desc) {
      throw makeError('NO_REPOSITORY', `Repository not found: ${repoId}`);
    }
    const fileUri = vscode.Uri.file(path.join(desc.rootPath, relPath));
    if (!force && side !== 'staged') {
      const thresholdKB = vscode.workspace
        .getConfiguration('gitBatchCommit.diff')
        .get<number>('largeFileThresholdKB', 2048);
      await guardWorktreeFile(desc.rootPath, repoId, relPath, side, thresholdKB);
    }
    const api = await this.api();
    const name = path.basename(relPath);
    let left: vscode.Uri;
    let right: vscode.Uri;
    let title: string;
    switch (side) {
      case 'staged':
        left = api.toGitUri(fileUri, 'HEAD');
        right = api.toGitUri(fileUri, '~');
        title = `${name} (HEAD ↔ Index)`;
        break;
      case 'worktree':
        left = api.toGitUri(fileUri, '~');
        right = fileUri;
        title = `${name} (Index ↔ Working Tree)`;
        break;
      default:
        left = api.toGitUri(fileUri, 'HEAD');
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
      throw makeError('NO_REPOSITORY', `Repository not found: ${repoId}`);
    }
    const commit = await repo.getCommit(oid);
    const parent = commit.parents[0];
    const entries = await commitFileEntries(repo, oid, parent);
    if (entries.length === 0) {
      void vscode.window.showInformationMessage(`Commit ${oid.slice(0, 7)} has no file changes (possibly an empty or merge commit).`);
      return;
    }
    const title = `${desc.name} · ${oid.slice(0, 7)} ${firstLine(commit.message)}`;
    const leftRef = parent ?? EMPTY_TREE_OID;
    const api = await this.api();
    const resources = entries.map((e) => this.compareResources(api, e, leftRef, oid, desc.rootPath));
    await this.openMultiDiff(title, resources);
  }

  /** Open a multi-file diff between HEAD (or merge-base) and another branch. */
  async openBranchCompare(repoId: string, otherRef: string): Promise<void> {
    const desc = this.registry.descriptor(repoId);
    const repo = this.registry.get(repoId);
    if (!desc || !repo) {
      throw makeError('NO_REPOSITORY', `Repository not found: ${repoId}`);
    }
    const head = repo.state.HEAD;
    const headRef = head?.name ?? head?.commit;
    if (!headRef) {
      throw makeError('NO_CHANGES', 'This repository has no commits yet; branch comparison is unavailable');
    }
    let base = headRef;
    if (repo.getMergeBase) {
      try {
        base = (await repo.getMergeBase(headRef, otherRef)) ?? headRef;
      } catch {
        // unrelated histories: fall back to direct HEAD comparison
      }
    }
    const entries = await rangeFileEntries(repo, base, otherRef);
    if (entries.length === 0) {
      void vscode.window.showInformationMessage(`${desc.name}: no file differences between ${headRef} and ${otherRef}.`);
      return;
    }
    const title = `${desc.name} · ${headRef} ↔ ${otherRef}`;
    const api = await this.api();
    const resources = entries.map((e) => this.compareResources(api, e, base, otherRef, desc.rootPath));
    await this.openMultiDiff(title, resources);
  }

  async openMergeEditor(repoId: string, relPath: string): Promise<void> {
    const desc = this.registry.descriptor(repoId);
    if (!desc) {
      throw makeError('NO_REPOSITORY', `Repository not found: ${repoId}`);
    }
    const uri = vscode.Uri.file(path.join(desc.rootPath, relPath));
    await vscode.commands.executeCommand('git.openMergeEditor', uri);
  }

  /** Open one file of a commit (or of an outgoing range) as a two-side diff. */
  async openCommitFileDiff(repoId: string, file: PushCommitFile, from: string, to: string): Promise<void> {
    const desc = this.registry.descriptor(repoId);
    if (!desc) {
      throw makeError('NO_REPOSITORY', `Repository not found: ${repoId}`);
    }
    const api = await this.api();
    const [, left, right] = this.compareResources(api, file, from, to, desc.rootPath);
    const name = path.basename(file.renamePath ?? file.path);
    const title = `${name} (${shortRef(from)} ↔ ${shortRef(to)})`;
    await vscode.commands.executeCommand('vscode.diff', left, right, title, { preview: true });
  }

  private async openMultiDiff(title: string, resources: [vscode.Uri, vscode.Uri, vscode.Uri][]): Promise<void> {
    try {
      await vscode.commands.executeCommand('vscode.changes', title, resources);
    } catch {
      const [first] = resources;
      if (first) {
        await vscode.commands.executeCommand('vscode.diff', first[1], first[2], title, { preview: true });
      }
    }
  }

  /**
   * Build [resource, original, modified] for the multi-diff editor.
   * Added files must point the original side at the empty tree and deleted
   * files the modified side: `git show <ref>:<path>` throws for a path absent
   * in that ref, and the multi-diff editor then drops the entry ("No Changed Files").
   * Renames keep the old path on the original side.
   */
  private compareResources(
    api: GitApi,
    entry: PushCommitFile,
    baseRef: string,
    targetRef: string,
    rootPath: string,
  ): [vscode.Uri, vscode.Uri, vscode.Uri] {
    const newPath = entry.renamePath ?? entry.path;
    const fileUri = vscode.Uri.file(path.join(rootPath, newPath));
    const oldPath = entry.origPath ?? entry.path;
    const oldFileUri = vscode.Uri.file(path.join(rootPath, oldPath));
    const status = entry.status;
    // Status enum: INDEX_ADDED/ADDED=1, INDEX_DELETED=2, DELETED=6; renames carry origPath
    const added = status === 1;
    const deleted = status === 2 || status === 6;
    const renamed = entry.origPath !== undefined && entry.origPath !== newPath;
    const left = added
      ? api.toGitUri(fileUri, EMPTY_TREE_OID)
      : api.toGitUri(renamed ? oldFileUri : fileUri, baseRef);
    const right = deleted ? api.toGitUri(fileUri, EMPTY_TREE_OID) : api.toGitUri(fileUri, targetRef);
    return [fileUri, left, right];
  }
}

function firstLine(message: string): string {
  const line = message.split('\n')[0] ?? '';
  return line.length > 60 ? `${line.slice(0, 60)}…` : line;
}

function shortRef(ref: string): string {
  if (ref === EMPTY_TREE_OID) {
    return '∅';
  }
  return /^[0-9a-f]{40,64}$/.test(ref) ? ref.slice(0, 7) : ref;
}