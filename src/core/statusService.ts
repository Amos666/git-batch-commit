import { Emitter } from '../core/events';
import type { KernelRepo } from '../kernel/types';
import { RepoRegistry, repoIdFor } from '../adapter/repoRegistry';
import { mapRepoStatus } from '../adapter/stateMapper';
import type { RepoStatus } from '../protocol/models';

export class StatusService {
  private seq = 0;
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly subs = new Map<string, () => void>();
  private readonly changed = new Emitter<RepoStatus>();
  private readonly unsubs: (() => void)[] = [];

  readonly onStatusChanged = this.changed.event;

  constructor(private readonly registry: RepoRegistry, private debounceMs: number) {
    for (const desc of registry.all()) {
      const repo = registry.get(desc.id);
      if (repo) {
        this.attach(repo);
      }
    }
    this.unsubs.push(
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

  private attach(repo: KernelRepo): void {
    const id = repoIdFor(repo.rootPath);
    if (this.subs.has(id)) {
      return;
    }
    this.subs.set(id, repo.state.onDidChange(() => this.schedulePush(repo)));
  }

  private detach(repoId: string): void {
    this.subs.get(repoId)?.();
    this.subs.delete(repoId);
    const timer = this.timers.get(repoId);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(repoId);
    }
  }

  private schedulePush(repo: KernelRepo): void {
    const id = repoIdFor(repo.rootPath);
    const existing = this.timers.get(id);
    if (existing) {
      clearTimeout(existing);
    }
    this.timers.set(id, setTimeout(() => {
      this.timers.delete(id);
      this.push(repo);
    }, this.debounceMs));
  }

  private push(repo: KernelRepo): void {
    const snapshot = this.snapshotOf(repo);
    if (snapshot) {
      this.changed.fire(snapshot);
    }
  }

  private snapshotOf(repo: KernelRepo): RepoStatus | undefined {
    const descriptor = this.registry.descriptor(repoIdFor(repo.rootPath));
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

  /** IDEA-style Refresh: force a kernel rescan, push events, return fresh snapshots. */
  async rescan(repoId?: string): Promise<RepoStatus[]> {
    const descs = repoId ? this.registry.all().filter((d) => d.id === repoId) : this.registry.all();
    await Promise.all(
      descs.map(async (d) => {
        const repo = this.registry.get(d.id);
        if (!repo) {
          return;
        }
        await repo.refresh?.();
        this.push(repo);
      }),
    );
    return repoId ? [this.snapshot(repoId)].filter((s): s is RepoStatus => s !== undefined) : this.all();
  }

  dispose(): void {
    for (const id of [...this.subs.keys()]) {
      this.detach(id);
    }
    this.changed.dispose();
    for (const unsub of this.unsubs) {
      unsub();
    }
  }
}