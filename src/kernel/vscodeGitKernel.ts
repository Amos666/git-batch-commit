import * as path from 'node:path';
import * as vscode from 'vscode';
import { acquireGitApi } from '../adapter/gitApi';
import type { Change, DiffBetweenFile, GitApi, Repository } from '../adapter/gitApiTypes';
import type { MiniRunner } from '../core/miniRunner';
import type { KernelCapabilities } from '../protocol/models';
import { detectCapabilities } from './capabilities';
import { commitWithAuthor } from './fallbacks';
import { KernelStatus } from './types';
import type {
  GitKernel,
  KernelChange,
  KernelCommitOptions,
  KernelDiffFile,
  KernelRepo,
  KernelRepoState,
  Unsubscribe,
} from './types';

function relPath(rootPath: string, fsPath: string): string {
  return path.relative(rootPath, fsPath).split(path.sep).join('/');
}

class VscodeKernelRepo implements KernelRepo {
  readonly rootPath: string;
  readonly rootUri: string;
  readonly kind: 'repository' | 'submodule' | 'worktree';

  private readonly changeCache = new WeakMap<Change[], KernelChange[]>();
  private readonly stateFacade: KernelRepoState;

  // Optional capabilities are exposed only when the underlying API has them,
  // so services' `if (repo.method)` feature checks and fallbacks stay honest.
  readonly diffIndexWithHEAD?: KernelRepo['diffIndexWithHEAD'];
  readonly diffBetweenPatch?: KernelRepo['diffBetweenPatch'];
  readonly diffBetweenWithStats?: KernelRepo['diffBetweenWithStats'];
  readonly diffBetweenWithStats2?: KernelRepo['diffBetweenWithStats2'];
  readonly getConfig?: KernelRepo['getConfig'];
  readonly getGlobalConfig?: KernelRepo['getGlobalConfig'];
  readonly hashObject?: KernelRepo['hashObject'];
  readonly log?: KernelRepo['log'];
  readonly createStash?: KernelRepo['createStash'];
  readonly getStashes?: KernelRepo['getStashes'];
  readonly popStash?: KernelRepo['popStash'];
  readonly applyStash?: KernelRepo['applyStash'];
  readonly dropStash?: KernelRepo['dropStash'];
  readonly merge?: KernelRepo['merge'];
  readonly mergeAbort?: KernelRepo['mergeAbort'];
  readonly rebase?: KernelRepo['rebase'];
  readonly rebaseAbort?: KernelRepo['rebaseAbort'];
  readonly rebaseContinue?: KernelRepo['rebaseContinue'];
  readonly getBranchBase?: KernelRepo['getBranchBase'];
  readonly getMergeBase?: KernelRepo['getMergeBase'];
  readonly pull?: KernelRepo['pull'];
  readonly pushTo?: KernelRepo['pushTo'];
  readonly branch?: KernelRepo['branch'];
  readonly getRefs?: KernelRepo['getRefs'];
  readonly refresh?: KernelRepo['refresh'];

  constructor(private readonly repo: Repository, private readonly mini: MiniRunner) {
    this.rootPath = repo.rootUri.fsPath;
    this.rootUri = repo.rootUri.toString();
    this.kind = repo.kind;
    if (repo.diffIndexWithHEAD) {
      const fn = repo.diffIndexWithHEAD.bind(repo);
      this.diffIndexWithHEAD = (p) => fn(p === undefined ? undefined : this.abs(p));
    }
    if (repo.diffBetweenPatch) {
      const fn = repo.diffBetweenPatch.bind(repo);
      this.diffBetweenPatch = (r1, r2, p) => fn(r1, r2, p === undefined ? undefined : this.abs(p));
    }
    if (repo.diffBetweenWithStats) {
      const fn = repo.diffBetweenWithStats.bind(repo);
      this.diffBetweenWithStats = async (r1, r2, p) =>
        (await fn(r1, r2, p === undefined ? undefined : this.abs(p))).map((f) => this.mapDiffFile(f));
    }
    if (repo.diffBetweenWithStats2) {
      const fn = repo.diffBetweenWithStats2.bind(repo);
      this.diffBetweenWithStats2 = async (range, p) =>
        (await fn(range, p === undefined ? undefined : this.abs(p))).map((f) => this.mapDiffFile(f));
    }
    if (repo.log) {
      const fn = repo.log.bind(repo);
      this.log = (options, token) => fn(options, token as never);
    }
    if (repo.pushTo) {
      const fn = repo.pushTo.bind(repo);
      this.pushTo = (remote, refspec, setUpstream, force, tags) => fn(remote, refspec, setUpstream, force as never, tags);
    }
    const passthrough = [
      'getConfig', 'getGlobalConfig', 'hashObject',
      'createStash', 'getStashes', 'popStash', 'applyStash', 'dropStash',
      'merge', 'mergeAbort', 'rebase', 'rebaseAbort', 'rebaseContinue',
      'getBranchBase', 'getMergeBase', 'pull', 'branch', 'getRefs',
    ] as const;
    for (const name of passthrough) {
      const fn = repo[name];
      if (typeof fn === 'function') {
        (this as unknown as Record<string, unknown>)[name] = fn.bind(repo);
      }
    }
    // The public API facade strips Repository.refresh(); the git.refresh
    // command resolves the internal repository from its root Uri instead.
    this.refresh = async () => {
      await vscode.commands.executeCommand('git.refresh', vscode.Uri.file(this.rootPath));
    };
    const self = this;
    this.stateFacade = {
      get HEAD() {
        return repo.state.HEAD;
      },
      get refs() {
        return repo.state.refs;
      },
      get mergeChanges() {
        return self.mapChanges(repo.state.mergeChanges);
      },
      get indexChanges() {
        return self.mapChanges(repo.state.indexChanges);
      },
      get workingTreeChanges() {
        return self.mapChanges(repo.state.workingTreeChanges);
      },
      get untrackedChanges() {
        return self.mapChanges(repo.state.untrackedChanges);
      },
      get rebaseCommit() {
        return repo.state.rebaseCommit;
      },
      onDidChange(cb: () => void): Unsubscribe {
        const sub = repo.state.onDidChange(cb);
        return () => sub.dispose();
      },
    };
  }

  get state(): KernelRepoState {
    return this.stateFacade;
  }

  private mapChanges(src: Change[]): KernelChange[] {
    const cached = this.changeCache.get(src);
    if (cached) {
      return cached;
    }
    const mapped = src.map((c): KernelChange => ({
      path: relPath(this.rootPath, c.uri.fsPath),
      uri: c.uri.toString(),
      origPath: c.originalUri ? relPath(this.rootPath, c.originalUri.fsPath) : undefined,
      origUri: c.originalUri?.toString(),
      renamePath: c.renameUri ? relPath(this.rootPath, c.renameUri.fsPath) : undefined,
      // built-in Status and KernelStatus are value-mirrored numeric enums
      status: c.status as number as KernelStatus,
    }));
    this.changeCache.set(src, mapped);
    return mapped;
  }

  private abs(p: string): string {
    return path.join(this.rootPath, p);
  }

  private absAll(paths: string[]): string[] {
    return paths.map((p) => this.abs(p));
  }

  add(paths: string[]): Promise<void> {
    return this.repo.add(this.absAll(paths));
  }

  restore(paths: string[], options?: { staged?: boolean; ref?: string }): Promise<void> {
    return this.repo.restore(this.absAll(paths), options);
  }

  commit(message: string, opts?: KernelCommitOptions): Promise<void> {
    if (opts?.author) {
      return commitWithAuthor(this.rootPath, message, opts, this.mini);
    }
    const { author: _author, ...rest } = opts ?? {};
    return this.repo.commit(message, rest);
  }

  push(remote?: string, ref?: string, setUpstream?: boolean, force?: number): Promise<void> {
    return this.repo.push(remote, ref, setUpstream, force as never);
  }

  checkout(treeish: string): Promise<void> {
    return this.repo.checkout(treeish);
  }

  getBranches(query?: { remote?: boolean; sort?: string }) {
    return this.repo.getBranches(query);
  }

  createBranch(name: string, checkout?: boolean, ref?: string): Promise<void> {
    return this.repo.createBranch(name, checkout, ref);
  }

  deleteBranch(name: string, force?: boolean): Promise<void> {
    return this.repo.deleteBranch(name, force);
  }

  diff(cached?: boolean): Promise<string> {
    return this.repo.diff(cached);
  }

  diffWithHEAD(p?: string): Promise<string> {
    return this.repo.diffWithHEAD(p === undefined ? undefined : this.abs(p));
  }

  diffWith(ref: string | undefined, p?: string): Promise<string> {
    return this.repo.diffWith(ref, p === undefined ? undefined : this.abs(p));
  }

  diffIndexWith(ref?: string, p?: string): Promise<string> {
    return this.repo.diffIndexWith(ref, p === undefined ? undefined : this.abs(p));
  }

  async diffBetween(ref1: string, ref2: string): Promise<string | KernelDiffFile[]> {
    const result = await this.repo.diffBetween(ref1, ref2);
    if (typeof result === 'string') {
      return result;
    }
    return result.map((f) => this.mapDiffFile(f));
  }

  private mapDiffFile(f: DiffBetweenFile): KernelDiffFile {
    return {
      path: relPath(this.rootPath, f.uri.fsPath),
      origPath: f.originalUri ? relPath(this.rootPath, f.originalUri.fsPath) : undefined,
      renamePath: f.renameUri ? relPath(this.rootPath, f.renameUri.fsPath) : undefined,
      status: f.status,
    };
  }

  buffer(ref: string, p: string): Promise<Buffer> {
    return this.repo.buffer(ref, this.abs(p));
  }

  show(ref: string, p: string): Promise<string> {
    return this.repo.show(ref, this.abs(p));
  }

  getCommit(ref: string) {
    return this.repo.getCommit(ref);
  }
}

export class VscodeGitKernel implements GitKernel {
  readonly capabilities: KernelCapabilities;
  private readonly wrapped = new Map<Repository, KernelRepo>();

  constructor(private readonly api: GitApi, private readonly mini: MiniRunner) {
    this.capabilities = detectCapabilities(this.repositories);
  }

  get repositories(): KernelRepo[] {
    return this.api.repositories.map((r) => this.wrap(r));
  }

  private wrap(repo: Repository): KernelRepo {
    let kernelRepo = this.wrapped.get(repo);
    if (!kernelRepo) {
      kernelRepo = new VscodeKernelRepo(repo, this.mini);
      this.wrapped.set(repo, kernelRepo);
    }
    return kernelRepo;
  }

  onDidOpenRepository(cb: (repo: KernelRepo) => void): Unsubscribe {
    const sub = this.api.onDidOpenRepository((repo) => cb(this.wrap(repo)));
    return () => sub.dispose();
  }

  onDidCloseRepository(cb: (repo: KernelRepo) => void): Unsubscribe {
    const sub = this.api.onDidCloseRepository((repo) => cb(this.wrap(repo)));
    return () => sub.dispose();
  }

  dispose(): void {
    this.wrapped.clear();
  }
}

export async function createVscodeGitKernel(mini: MiniRunner): Promise<VscodeGitKernel> {
  const api = await acquireGitApi();
  return new VscodeGitKernel(api, mini);
}