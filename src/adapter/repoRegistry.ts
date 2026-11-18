import { createHash } from 'node:crypto';
import * as path from 'node:path';
import { Emitter } from '../core/events';
import type { GitKernel, KernelRepo } from '../kernel/types';
import type { RepoDescriptor } from '../protocol/models';

export function repoIdFor(rootPath: string): string {
  return createHash('sha1').update(rootPath).digest('hex').slice(0, 12);
}

export function descriptorFor(repo: KernelRepo): RepoDescriptor {
  const rootPath = repo.rootPath;
  return {
    id: repoIdFor(rootPath),
    rootUri: repo.rootUri,
    rootPath,
    name: path.basename(rootPath) || rootPath,
    kind: repo.kind,
  };
}

interface Entry {
  repo: KernelRepo;
  descriptor: RepoDescriptor;
}

export class RepoRegistry {
  private readonly entries = new Map<string, Entry>();
  private readonly opened = new Emitter<RepoDescriptor>();
  private readonly closed = new Emitter<string>();
  private readonly unsubs: (() => void)[] = [];

  readonly onDidOpen = this.opened.event;
  readonly onDidClose = this.closed.event;

  constructor(kernel: GitKernel) {
    for (const repo of kernel.repositories) {
      this.register(repo);
    }
    this.unsubs.push(
      kernel.onDidOpenRepository((repo) => this.register(repo)),
      kernel.onDidCloseRepository((repo) => this.unregister(repo)),
    );
  }

  private register(repo: KernelRepo): void {
    const descriptor = descriptorFor(repo);
    if (this.entries.has(descriptor.id)) {
      return;
    }
    this.entries.set(descriptor.id, { repo, descriptor });
    this.opened.fire(descriptor);
  }

  private unregister(repo: KernelRepo): void {
    const id = repoIdFor(repo.rootPath);
    if (this.entries.delete(id)) {
      this.closed.fire(id);
    }
  }

  get(repoId: string): KernelRepo | undefined {
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
    for (const unsub of this.unsubs) {
      unsub();
    }
  }
}