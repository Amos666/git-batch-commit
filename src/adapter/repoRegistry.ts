import { createHash } from 'node:crypto';
import * as path from 'node:path';
import * as vscode from 'vscode';
import type { Repository } from './gitApiTypes';
import type { RepoDescriptor } from '../protocol/models';

export function repoIdFor(rootUri: vscode.Uri): string {
  return createHash('sha1').update(rootUri.fsPath).digest('hex').slice(0, 12);
}

export function descriptorFor(repo: Repository): RepoDescriptor {
  const rootPath = repo.rootUri.fsPath;
  return {
    id: repoIdFor(repo.rootUri),
    rootUri: repo.rootUri.toString(),
    rootPath,
    name: path.basename(rootPath) || rootPath,
    kind: repo.kind,
  };
}

interface Entry {
  repo: Repository;
  descriptor: RepoDescriptor;
}

export class RepoRegistry implements vscode.Disposable {
  private readonly entries = new Map<string, Entry>();
  private readonly opened = new vscode.EventEmitter<RepoDescriptor>();
  private readonly closed = new vscode.EventEmitter<string>();
  private readonly disposables: vscode.Disposable[] = [];

  readonly onDidOpen = this.opened.event;
  readonly onDidClose = this.closed.event;

  constructor(private readonly api: { repositories: Repository[]; onDidOpenRepository: vscode.Event<Repository>; onDidCloseRepository: vscode.Event<Repository> }) {
    for (const repo of api.repositories) {
      this.register(repo);
    }
    this.disposables.push(
      api.onDidOpenRepository((repo) => this.register(repo)),
      api.onDidCloseRepository((repo) => this.unregister(repo)),
    );
  }

  private register(repo: Repository): void {
    const descriptor = descriptorFor(repo);
    if (this.entries.has(descriptor.id)) {
      return;
    }
    this.entries.set(descriptor.id, { repo, descriptor });
    this.opened.fire(descriptor);
  }

  private unregister(repo: Repository): void {
    const id = repoIdFor(repo.rootUri);
    if (this.entries.delete(id)) {
      this.closed.fire(id);
    }
  }

  get(repoId: string): Repository | undefined {
    return this.entries.get(repoId)?.repo;
  }

  descriptor(repoId: string): RepoDescriptor | undefined {
    return this.entries.get(repoId)?.descriptor;
  }

  all(): RepoDescriptor[] {
    return [...this.entries.values()].map((e) => e.descriptor);
  }

  dispose(): void {
    this.opened.dispose();
    this.closed.dispose();
    for (const d of this.disposables) {
      d.dispose();
    }
  }
}