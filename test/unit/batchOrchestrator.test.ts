import { describe, expect, it } from 'vitest';
import type { RepoRegistry } from '../../src/adapter/repoRegistry';
import { BatchOrchestrator } from '../../src/core/batchOrchestrator';
import type { CommitTranslator } from '../../src/core/commitTranslator';
import { OperationTracker } from '../../src/core/operationTracker';
import type { InclusionModel } from '../../src/core/inclusionModel';
import type { CommitRequestV2, PushRunRequest } from '../../src/protocol/models';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Errors thrown by the built-in API carry a gitErrorCode our mapper keys on. */
function gitError(gitErrorCode: string, message: string): Error & { gitErrorCode: string } {
  return Object.assign(new Error(message), { gitErrorCode });
}

interface Behaviour {
  /** ms spent inside commit()/pushTo() */
  delay: number;
  fail?: boolean;
}

class Harness {
  readonly events: string[] = [];
  private inFlight = 0;
  maxInFlight = 0;
  private readonly repos = new Map<string, RepoStub>();
  private readonly roots = new Map<string, string>();

  constructor(private readonly parallel: number) {}

  add(id: string, commit: Behaviour, push: Behaviour = { delay: 0 }, root = `/ws/${id}`): RepoStub {
    const repo = new RepoStub(this, id, commit, push);
    this.repos.set(id, repo);
    this.roots.set(id, root);
    return repo;
  }

  record(event: string): void {
    this.events.push(event);
  }

  enter(): void {
    this.inFlight += 1;
    this.maxInFlight = Math.max(this.maxInFlight, this.inFlight);
  }

  leave(): void {
    this.inFlight -= 1;
  }

  orchestrator(options: Partial<{ stopOnFirstRepoError: boolean }> = {}) {
    const registry = {
      get: (id: string) => this.repos.get(id),
      descriptor: (id: string) => ({ id, rootPath: this.roots.get(id) ?? '', name: id }),
    } as unknown as RepoRegistry;
    return new BatchOrchestrator(
      registry,
      {} as InclusionModel,
      {} as CommitTranslator,
      new OperationTracker(),
      () => ({ stopOnFirstRepoError: options.stopOnFirstRepoError ?? false, maxParallelRepos: this.parallel }),
    );
  }
}

class RepoStub {
  pushedTo: string[] = [];
  committed = 0;

  constructor(
    private readonly h: Harness,
    private readonly id: string,
    private readonly commitBehaviour: Behaviour,
    private readonly pushBehaviour: Behaviour,
  ) {}

  get state() {
    return {
      HEAD: { name: 'main', commit: `oid-${this.id}`, upstream: { name: 'main', remote: 'origin' } },
      mergeChanges: [],
      indexChanges: [{ path: 'a.txt' }],
      workingTreeChanges: [],
      untrackedChanges: [],
      remotes: [{ name: 'origin' }],
    };
  }

  async commit(): Promise<void> {
    this.h.enter();
    this.h.events.push(`${this.id}:commit-start`);
    await sleep(this.commitBehaviour.delay);
    if (this.commitBehaviour.fail) {
      this.h.events.push(`${this.id}:commit-end`);
      this.h.leave();
      throw new Error('hook failed');
    }
    this.committed += 1;
    this.h.events.push(`${this.id}:commit-end`);
    this.h.leave();
  }

  getCommit(): Promise<{ hash: string }> {
    return Promise.resolve({ hash: `oid-${this.id}` });
  }

  async pushTo(remote: string, refspec: string): Promise<void> {
    this.h.enter();
    this.h.events.push(`${this.id}:push-start`);
    await sleep(this.pushBehaviour.delay);
    this.pushedTo.push(`${remote} ${refspec}`);
    if (this.pushBehaviour.fail) {
      this.h.events.push(`${this.id}:push-end`);
      this.h.leave();
      throw gitError('PushRejected', '[rejected] non-fast-forward');
    }
    this.h.events.push(`${this.id}:push-end`);
    this.h.leave();
  }

  push(): Promise<void> {
    throw new Error('unused: pushTo covers the batch path');
  }
}

const commitReq = (repoIds: string[]): CommitRequestV2 => ({
  repoIds,
  message: 'batch: concurrent',
  options: {},
});

const pushReq = (repoIds: string[]): PushRunRequest => ({ repoIds });

describe('batch commit concurrency', () => {
  it('overlaps repository commits instead of waiting for each other', async () => {
    const h = new Harness(4);
    const ids = ['r1', 'r2', 'r3', 'r4'];
    for (const id of ids) {
      h.add(id, { delay: 40 });
    }
    const started = Date.now();
    const results = await h.orchestrator().run(commitReq(ids));
    const elapsed = Date.now() - started;

    expect(results.map((r) => r.repoId)).toEqual(ids);
    expect(results.every((r) => r.ok)).toBe(true);
    // four 40ms commits would need ~160ms one after another; lanes finish in ~40ms
    expect(elapsed).toBeLessThan(120);
    expect(h.maxInFlight).toBe(4);
    expect(h.events.slice(0, 4)).toEqual(['r1:commit-start', 'r2:commit-start', 'r3:commit-start', 'r4:commit-start']);
  });

  it('never runs more repositories at once than the configured limit', async () => {
    const h = new Harness(2);
    const ids = ['r1', 'r2', 'r3', 'r4', 'r5', 'r6'];
    for (const id of ids) {
      h.add(id, { delay: 10 });
    }
    const results = await h.orchestrator().run(commitReq(ids));

    expect(results.filter((r) => r.ok)).toHaveLength(6);
    expect(h.maxInFlight).toBe(2);
    // results stay in request order regardless of which lane finished first
    expect(results.map((r) => r.repoId)).toEqual(ids);
  });

  it('commits a nested repository before the repository that records its gitlink', async () => {
    const h = new Harness(4);
    h.add('child', { delay: 20 }, { delay: 0 }, '/ws/parent/sub');
    h.add('parent', { delay: 5 });
    const results = await h.orchestrator().run(commitReq(['parent', 'child']));

    // the parent would otherwise stage the old submodule HEAD and trip the race guard
    expect(results.map((r) => r.repoId)).toEqual(['parent', 'child']);
    expect(h.events).toEqual(['child:commit-start', 'child:commit-end', 'parent:commit-start', 'parent:commit-end']);
  });

  it('cancel-remaining lets in-flight commits finish and skips only queued repositories', async () => {    const h = new Harness(1);
    const ids = ['r1', 'r2', 'r3'];
    for (const id of ids) {
      h.add(id, { delay: 40 });
    }
    const orchestrator = h.orchestrator();
    const run = orchestrator.run(commitReq(ids));
    await sleep(10);
    orchestrator.cancelRemaining();
    const results = await run;

    expect(results[0]?.ok).toBe(true);
    expect(results[1]?.skipped).toBe('cancelled');
    expect(results[2]?.skipped).toBe('cancelled');
    expect(results.map((r) => r.repoId)).toEqual(ids);
  });

  it('stop-on-first-error skips the remaining repositories after a failure', async () => {
    const h = new Harness(1);
    h.add('r1', { delay: 5, fail: true });
    h.add('r2', { delay: 5 });
    h.add('r3', { delay: 5 });
    const results = await h.orchestrator({ stopOnFirstRepoError: true }).run(commitReq(['r1', 'r2', 'r3']));

    expect(results[0]?.error?.code).toBe('HOOK_FAILED');
    expect(results[1]?.skipped).toBe('stopped-after-error');
    expect(results[2]?.skipped).toBe('stopped-after-error');
  });

  it('reports a missing repository without disturbing the concurrent lanes', async () => {
    const h = new Harness(4);
    h.add('r1', { delay: 10 });
    const results = await h.orchestrator().run(commitReq(['r1', 'ghost', 'r1']));

    expect(results[0]?.ok).toBe(true);
    expect(results[1]?.error?.code).toBe('NO_REPOSITORY');
    expect(results[2]?.ok).toBe(true);
  });
});

describe('batch push concurrency', () => {
  it('pushes all repositories at the same time', async () => {
    const h = new Harness(4);
    const ids = ['r1', 'r2', 'r3'];
    for (const id of ids) {
      h.add(id, { delay: 0 }, { delay: 40 });
    }
    const started = Date.now();
    const results = await h.orchestrator().runPush(pushReq(ids));
    const elapsed = Date.now() - started;

    expect(results.every((r) => r.ok)).toBe(true);
    expect(elapsed).toBeLessThan(120);
    expect(h.maxInFlight).toBe(3);
    expect(h.events.slice(0, 3)).toEqual(['r1:push-start', 'r2:push-start', 'r3:push-start']);
  });

  it('a rejected repository does not stop the others (IDEA semantics)', async () => {
    const h = new Harness(4);
    h.add('r1', { delay: 0 }, { delay: 20 });
    h.add('r2', { delay: 0 }, { delay: 20, fail: true });
    h.add('r3', { delay: 0 }, { delay: 20 });
    const results = await h.orchestrator({ stopOnFirstRepoError: true }).runPush(pushReq(['r1', 'r2', 'r3']));

    expect(results.map((r) => r.repoId)).toEqual(['r1', 'r2', 'r3']);
    expect(results[0]?.ok).toBe(true);
    expect(results[1]?.error?.code).toBe('PUSH_REJECTED');
    expect(results[2]?.ok).toBe(true);
  });

  it('cancel-remaining skips queued pushes', async () => {
    const h = new Harness(1);
    const ids = ['r1', 'r2'];
    for (const id of ids) {
      h.add(id, { delay: 0 }, { delay: 40 });
    }
    const orchestrator = h.orchestrator();
    const run = orchestrator.runPush(pushReq(ids));
    await sleep(10);
    orchestrator.cancelRemaining();
    const results = await run;

    expect(results[0]?.ok).toBe(true);
    expect(results[1]?.skipped).toBe('cancelled');
  });

  it('rejects a second batch operation while one is running', async () => {
    const h = new Harness(4);
    h.add('r1', { delay: 30 });
    const orchestrator = h.orchestrator();
    const first = orchestrator.run(commitReq(['r1']));
    await expect(orchestrator.run(commitReq(['r1']))).rejects.toMatchObject({ code: 'GENERIC' });
    await first;
  });
});
