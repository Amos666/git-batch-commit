import * as vscode from 'vscode';
import type { Repository } from '../adapter/gitApiTypes';
import { RepoRegistry, repoIdFor } from '../adapter/repoRegistry';
import { mapRepoStatus } from '../adapter/stateMapper';
import type { RepoStatus } from '../protocol/models';

export class StatusService implements vscode.Disposable {
  private seq = 0;
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly subs = new Map<string, vscode.Disposable>();
  private readonly changed = new vscode.EventEmitter<RepoStatus>();
  private readonly disposables: vscode.Disposable[] = [];

  readonly onStatusChanged = this.changed.event;

  constructor(private readonly registry: RepoRegistry, private debounceMs: number) {
    for (const desc of registry.all()) {
      const repo = registry.get(desc.id);
      if (repo) {
        this.attach(repo);
      }
    }
    this.disposables.push(
      registry.onDidOpen((desc) => {
        const repo = registry.get(desc.id);
        if (repo) {
          this.attach(repo);
          this.push(repo);
        }
      }),
      registry.onDidClose((repoId) => this.detach(repoId)),
    );
  }

  setDebounce(ms: number): void {
    this.debounceMs = ms;
  }

  private attach(repo: Repository): void {
    const id = repoIdFor(repo.rootUri);
    if (this.subs.has(id)) {
      return;
    }
    this.subs.set(id, repo.state.onDidChange(() => this.schedulePush(repo)));
  }

  private detach(repoId: string): void {
    this.subs.get(repoId)?.dispose();
    this.subs.delete(repoId);
    const timer = this.timers.get(repoId);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(repoId);
    }
  }

  private schedulePush(repo: Repository): void {
    const id = repoIdFor(repo.rootUri);
    const existing = this.timers.get(id);
    if (existing) {
      clearTimeout(existing);
    }
    this.timers.set(id, setTimeout(() => {
      this.timers.delete(id);
      this.push(repo);
    }, this.debounceMs));
  }

  private push(repo: Repository): void {
    const snapshot = this.snapshotOf(repo);
    if (snapshot) {
      this.changed.fire(snapshot);
    }
  }

  private snapshotOf(repo: Repository): RepoStatus | undefined {
    const descriptor = this.registry.descriptor(repoIdFor(repo.rootUri));
    if (!descriptor) {
      return undefined;
    }
    return mapRepoStatus(
      {
        descriptor,
        head: repo.state.HEAD,
        mergeChanges: repo.state.mergeChanges,
        indexChanges: repo.state.indexChanges,
        workingTreeChanges: repo.state.workingTreeChanges,
        untrackedChanges: repo.state.untrackedChanges,
      },
      ++this.seq,
    );
  }

  snapshot(repoId: string): RepoStatus | undefined {
    const repo = this.registry.get(repoId);
    return repo ? this.snapshotOf(repo) : undefined;
  }

  all(): RepoStatus[] {
    return this.registry.all()
      .map((d) => this.snapshot(d.id))
      .filter((s): s is RepoStatus => s !== undefined);
  }

  refresh(repoId?: string): void {
    if (repoId) {
      const repo = this.registry.get(repoId);
      if (repo) {
        this.push(repo);
      }
      return;
    }
    for (const desc of this.registry.all()) {
      const repo = this.registry.get(desc.id);
      if (repo) {
        this.push(repo);
      }
    }
  }

  dispose(): void {
    for (const id of [...this.subs.keys()]) {
      this.detach(id);
    }
    this.changed.dispose();
    for (const d of this.disposables) {
      d.dispose();
    }
  }
}