import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { acquireGitApi } from '../adapter/gitApi';
import { mapLocalBranches } from '../adapter/branchRefs';
import type { GitApi } from '../adapter/gitApiTypes';
import { asGitErrorLike } from '../adapter/gitApiTypes';
import { RepoRegistry } from '../adapter/repoRegistry';
import { BatchOrchestrator } from '../core/batchOrchestrator';
import { InclusionModel } from '../core/inclusionModel';
import { MiniRunner, validateBranchName } from '../core/miniRunner';
import { OperationTracker } from '../core/operationTracker';
import { StatusService } from '../core/statusService';
import { TerminalBridge } from '../core/terminalBridge';
import { makeError, mapGitErrorCode } from '../protocol/errors';
import type { ProtocolError } from '../protocol/errors';
import type { BranchRef, InitResult, LogPage, PanelSettings } from '../protocol/messages';
import type { PanelState } from '../protocol/models';
import { DiffService } from '../services/diffService';
import { HunkService } from '../services/hunkService';
import { ShelfService } from '../services/shelfService';
import { SequencerService } from '../services/sequencerService';
import { StashService } from '../services/stashService';
import { Diagnostics } from './diagnostics';
import { MessageGateway } from './messageGateway';

interface Services {
  api: GitApi;
  registry: RepoRegistry;
  status: StatusService;
  inclusion: InclusionModel;
  orchestrator: BatchOrchestrator;
  tracker: OperationTracker;
  terminal: TerminalBridge;
  diff: DiffService;
  hunk: HunkService;
  stash: StashService;
  shelf: ShelfService;
  sequencer: SequencerService;
  mini: MiniRunner;
}

export class Backend implements vscode.Disposable {
  private services: Services | undefined;
  private initPromise: Promise<void> | undefined;
  private panelState: PanelState = 'initializing';
  private readonly gateways = new Map<MessageGateway, vscode.Disposable[]>();
  private readonly disposables: vscode.Disposable[] = [];
  private extensionVersion = '0.0.1';
  readonly diagnostics = new Diagnostics();

  constructor(
    private readonly output: vscode.OutputChannel,
    private readonly context: vscode.ExtensionContext,
  ) {
    this.disposables.push(
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration('gitBatchCommit.commit.refreshDebounceMs')) {
          this.services?.status.setDebounce(readSettings().refreshDebounceMs);
        }
      }),
    );
  }

  setExtensionVersion(version: string): void {
    this.extensionVersion = version;
  }

  init(): Promise<void> {
    if (!this.initPromise) {
      this.initPromise = this.doInit();
    }
    return this.initPromise;
  }

  private async doInit(): Promise<void> {
    try {
      const api = await acquireGitApi();
      const registry = new RepoRegistry(api);
      const settings = readSettings();
      const status = new StatusService(registry, settings.refreshDebounceMs);
      const inclusion = new InclusionModel(registry);
      const tracker = new OperationTracker();
      const orchestrator = new BatchOrchestrator(registry, inclusion, tracker, () => ({
        stopOnFirstRepoError: readSettings().stopOnFirstRepoError,
      }));
      const terminal = new TerminalBridge(registry);
      const diff = new DiffService(api, registry);
      const mini = new MiniRunner(() => vscode.workspace.getConfiguration('git').get<string>('path') || 'git');
      const hunk = new HunkService(registry, mini);
      const stash = new StashService(registry, mini);
      const storageRoot = (this.context.storageUri ?? this.context.globalStorageUri).fsPath;
      const shelf = new ShelfService(registry, mini, path.join(storageRoot, 'shelf'));
      const sequencer = new SequencerService(registry, mini);
      this.services = { api, registry, status, inclusion, orchestrator, tracker, terminal, diff, hunk, stash, shelf, sequencer, mini };
      this.panelState = 'ready';
      this.output.appendLine('内置 Git API 绑定成功，仓库数: ' + registry.all().length);
      for (const gateway of this.gateways.keys()) {
        this.wireEvents(gateway);
        gateway.emit('panel.state', { panelState: 'ready' });
      }
    } catch (err) {
      this.panelState = 'git-extension-unavailable';
      this.output.appendLine('内置 Git API 不可用: ' + String(err));
      for (const gateway of this.gateways.keys()) {
        gateway.emit('panel.state', { panelState: 'git-extension-unavailable' });
      }
    }
  }

  private async ready(): Promise<Services> {
    await this.init();
    if (!this.services) {
      throw makeError('GIT_EXTENSION_UNAVAILABLE', '内置 Git 扩展不可用，请启用后重试', ['enableGitExtension', 'openGitSettings']);
    }
    return this.services;
  }

  refresh(): void {
    this.services?.status.refresh();
  }

  requestCommit(): void {
    for (const gateway of this.gateways.keys()) {
      gateway.emit('ui.command', { command: 'commit' });
    }
  }

  attach(gateway: MessageGateway): vscode.Disposable {
    this.gateways.set(gateway, []);
    if (this.services) {
      this.wireEvents(gateway);
    }
    this.registerHandlers(gateway);
    return new vscode.Disposable(() => {
      for (const d of this.gateways.get(gateway) ?? []) {
        d.dispose();
      }
      this.gateways.delete(gateway);
    });
  }

  private wireEvents(gateway: MessageGateway): void {
    const s = this.services;
    if (!s) {
      return;
    }
    const subs = this.gateways.get(gateway);
    if (!subs || subs.length > 0) {
      return;
    }
    subs.push(
      s.status.onStatusChanged((status) => gateway.emit('status.changed', { status })),
      s.registry.onDidClose((repoId) => gateway.emit('repo.closed', { repoId })),
      s.tracker.onProgress((operation) => gateway.emit('operation.progress', { operation })),
    );
  }

  private registerHandlers(gateway: MessageGateway): void {
    gateway.register('panel.init', async (): Promise<InitResult> => {
      await this.init();
      return {
        panelState: this.panelState,
        repos: this.services?.status.all() ?? [],
        settings: readSettings(),
        extensionVersion: this.extensionVersion,
      };
    });
    gateway.register('status.get', async (params) => {
      const s = await this.ready();
      if (params?.repoId) {
        const snapshot = s.status.snapshot(params.repoId);
        return snapshot ? [snapshot] : [];
      }
      return s.status.all();
    });
    gateway.register('index.stage', async (params) => {
      const s = await this.ready();
      await s.inclusion.stage(params.repoId, params.paths);
    });
    gateway.register('index.unstage', async (params) => {
      const s = await this.ready();
      await s.inclusion.unstage(params.repoId, params.paths);
    });
    gateway.register('index.stageAll', async (params) => {
      const s = await this.ready();
      await s.inclusion.stageAll(params.repoId);
    });
    gateway.register('index.unstageAll', async (params) => {
      const s = await this.ready();
      await s.inclusion.unstageAll(params.repoId);
    });
    gateway.register('commit.run', async (params) => {
      const s = await this.ready();
      const results = await s.orchestrator.run(params);
      if (params.message.trim() && results.some((r) => r.ok)) {
        this.recordHistory(params.message);
      }
      return results;
    });
    gateway.register('commit.show', async (params) => {
      const s = await this.ready();
      await s.diff.openCommit(params.repoId, params.oid);
    });
    gateway.register('commit.undo', async (params) => {
      const s = await this.ready();
      await s.sequencer.undoCommit(params.repoId);
      s.status.refresh();
    });
    gateway.register('commit.template', async () => {
      const s = await this.ready();
      return readCommitTemplate(s);
    });
    gateway.register('history.list', async () => this.getHistory());
    gateway.register('batch.cancelRemaining', async () => {
      const s = await this.ready();
      s.orchestrator.cancelRemaining();
    });
    gateway.register('diff.open', async (params) => {
      const s = await this.ready();
      await s.diff.open(params.repoId, params.path, params.side, params.force ?? false);
    });
    gateway.register('hunk.list', async (params) => {
      const s = await this.ready();
      return s.hunk.list(params.repoId, params.path, params.side);
    });
    gateway.register('hunk.stage', async (params) => {
      const s = await this.ready();
      await s.hunk.stage(params.repoId, params.path, params.hunkIds);
      s.status.refresh();
    });
    gateway.register('hunk.unstage', async (params) => {
      const s = await this.ready();
      await s.hunk.unstage(params.repoId, params.path, params.hunkIds);
      s.status.refresh();
    });
    gateway.register('stash.list', async (params) => {
      const s = await this.ready();
      return s.stash.list(params.repoId);
    });
    gateway.register('stash.create', async (params) => {
      const s = await this.ready();
      await s.stash.create(params.repoId, params);
      s.status.refresh();
    });
    gateway.register('stash.apply', async (params) => {
      const s = await this.ready();
      await s.stash.apply(params.repoId, params.index);
      s.status.refresh();
    });
    gateway.register('stash.pop', async (params) => {
      const s = await this.ready();
      await s.stash.pop(params.repoId, params.index);
      s.status.refresh();
    });
    gateway.register('stash.drop', async (params) => {
      const s = await this.ready();
      await s.stash.drop(params.repoId, params.index);
    });
    gateway.register('shelf.list', async (params) => {
      const s = await this.ready();
      return s.shelf.list(params.repoId);
    });
    gateway.register('shelf.create', async (params) => {
      const s = await this.ready();
      const entry = await s.shelf.create(params.repoId, params.name, params.paths);
      s.status.refresh();
      return entry;
    });
    gateway.register('shelf.unshelve', async (params) => {
      const s = await this.ready();
      await s.shelf.unshelve(params.repoId, params.id, params.paths, params.removeAfter);
      s.status.refresh();
    });
    gateway.register('shelf.delete', async (params) => {
      const s = await this.ready();
      await s.shelf.delete(params.repoId, params.id);
    });
    gateway.register('branch.list', async (params): Promise<BranchRef[]> => {
      const s = await this.ready();
      const repo = s.registry.get(params.repoId);
      if (!repo) {
        throw makeError('NO_REPOSITORY', `仓库不存在: ${params.repoId}`);
      }
      const refs = await repo.getBranches({ remote: false });
      return mapLocalBranches(refs, repo.state.HEAD?.name);
    });
    gateway.register('branch.checkout', async (params) => {
      const s = await this.ready();
      const repo = s.registry.get(params.repoId);
      if (!repo) {
        throw makeError('NO_REPOSITORY', `仓库不存在: ${params.repoId}`);
      }
      await repo.checkout(params.name);
    });
    gateway.register('branch.create', async (params) => {
      const s = await this.ready();
      const repo = s.registry.get(params.repoId);
      if (!repo) {
        throw makeError('NO_REPOSITORY', `仓库不存在: ${params.repoId}`);
      }
      if (!validateBranchName(params.name)) {
        throw makeError('GENERIC', '分支名非法');
      }
      await repo.createBranch(params.name, params.checkout ?? true, params.ref);
      s.status.refresh();
    });
    gateway.register('branch.delete', async (params) => {
      const s = await this.ready();
      const repo = s.registry.get(params.repoId);
      if (!repo) {
        throw makeError('NO_REPOSITORY', `仓库不存在: ${params.repoId}`);
      }
      if (repo.state.HEAD?.name === params.name) {
        throw makeError('GENERIC', '不能删除当前所在分支');
      }
      try {
        // force=false: git refuses to delete unmerged branches (safe default)
        await repo.deleteBranch(params.name, false);
      } catch (err) {
        throw toProtocolError(err, 'branch');
      }
      s.status.refresh();
    });
    gateway.register('branch.rename', async (params) => {
      const s = await this.ready();
      const desc = s.registry.descriptor(params.repoId);
      if (!desc) {
        throw makeError('NO_REPOSITORY', `仓库不存在: ${params.repoId}`);
      }
      await s.mini.run(desc.rootPath, { cmd: 'branch-rename', from: params.from, to: params.to });
      s.status.refresh();
    });
    gateway.register('branch.compare', async (params) => {
      const s = await this.ready();
      if (!validateBranchName(params.name)) {
        throw makeError('GENERIC', '分支名非法');
      }
      await s.diff.openBranchCompare(params.repoId, params.name);
    });
    gateway.register('repo.pull', async (params) => {
      const s = await this.ready();
      const repo = s.registry.get(params.repoId);
      if (!repo) {
        throw makeError('NO_REPOSITORY', `仓库不存在: ${params.repoId}`);
      }
      if (!repo.pull) {
        throw makeError('GENERIC', '当前内置 Git API 版本不支持 pull');
      }
      s.tracker.start(params.repoId, 'pull');
      try {
        await repo.pull();
        s.tracker.end(params.repoId, 'done');
      } catch (err) {
        const error = toProtocolError(err, 'pull');
        s.tracker.end(params.repoId, 'failed', error.message);
        throw error;
      }
      s.status.refresh();
    });
    gateway.register('repo.push', async (params) => {
      const s = await this.ready();
      const repo = s.registry.get(params.repoId);
      if (!repo) {
        throw makeError('NO_REPOSITORY', `仓库不存在: ${params.repoId}`);
      }
      const head = repo.state.HEAD;
      if (!head?.name) {
        throw makeError('GENERIC', 'detached HEAD 无法推送，请切换到分支');
      }
      s.tracker.start(params.repoId, 'push');
      s.tracker.update(params.repoId, 'pushing');
      try {
        await repo.push(head.upstream?.remote, head.name, head.upstream ? false : true);
        s.tracker.end(params.repoId, 'done');
      } catch (err) {
        const error = toProtocolError(err, 'push');
        s.tracker.end(params.repoId, 'failed', error.message);
        throw error;
      }
      s.status.refresh();
    });
    gateway.register('log.list', async (params): Promise<LogPage> => {
      const s = await this.ready();
      const repo = s.registry.get(params.repoId);
      if (!repo) {
        throw makeError('NO_REPOSITORY', `仓库不存在: ${params.repoId}`);
      }
      if (!repo.log) {
        throw makeError('GENERIC', '当前内置 Git API 版本不支持 log');
      }
      const configured = vscode.workspace.getConfiguration('gitBatchCommit.log').get<number>('pageSize', 50);
      const pageSize = Math.min(500, Math.max(10, Math.floor(configured) || 50));
      const skip = Math.min(100_000, Math.max(0, Math.floor(params.skip ?? 0)));
      const commits = await repo.log({
        maxEntries: pageSize + 1,
        skip: skip || undefined,
        author: params.author?.trim() || undefined,
        grep: params.grep?.trim() || undefined,
      });
      return {
        entries: commits.slice(0, pageSize).map((c) => ({
          hash: c.hash,
          message: c.message,
          authorName: c.authorName,
          authorDate: c.authorDate ? c.authorDate.getTime() : undefined,
        })),
        hasMore: commits.length > pageSize,
      };
    });
    gateway.register('log.cherryPick', async (params) => {
      const s = await this.ready();
      await s.sequencer.cherryPick(params.repoId, params.oid);
      s.status.refresh();
    });
    gateway.register('log.revert', async (params) => {
      const s = await this.ready();
      await s.sequencer.revert(params.repoId, params.oid);
      s.status.refresh();
    });
    gateway.register('merge.abort', async (params) => {
      const s = await this.ready();
      const repo = s.registry.get(params.repoId);
      if (!repo) {
        throw makeError('NO_REPOSITORY', `仓库不存在: ${params.repoId}`);
      }
      if (repo.state.rebaseCommit) {
        if (!repo.rebaseAbort) {
          throw makeError('GENERIC', '当前内置 Git API 版本不支持 rebase --abort');
        }
        await repo.rebaseAbort();
      } else if (repo.state.mergeChanges.length > 0 && repo.mergeAbort) {
        try {
          await repo.mergeAbort();
        } catch {
          // cherry-pick/revert conflicts also populate mergeChanges but have no MERGE_HEAD
          await s.sequencer.abort(params.repoId);
        }
      } else {
        await s.sequencer.abort(params.repoId);
      }
      s.status.refresh();
    });
    gateway.register('merge.openEditor', async (params) => {
      const s = await this.ready();
      const desc = s.registry.descriptor(params.repoId);
      if (!desc) {
        throw makeError('NO_REPOSITORY', `仓库不存在: ${params.repoId}`);
      }
      const fileUri = vscode.Uri.file(path.join(desc.rootPath, params.path));
      const commands = await vscode.commands.getCommands(true);
      if (commands.includes('git.openMergeEditor')) {
        try {
          await vscode.commands.executeCommand('git.openMergeEditor', fileUri);
          return;
        } catch {
          // merge editor unavailable for this file: fall back to plain diff
        }
      }
      await s.diff.open(params.repoId, params.path, 'worktree', true);
    });
    gateway.register('ui.showGitOutput', async () => {
      await vscode.commands.executeCommand('git.showOutput');
    });
    gateway.register('ui.retryInTerminal', async (params) => {
      const s = await this.ready();
      await s.terminal.retryInTerminal(params.repoId, params.command);
    });
    gateway.register('ui.openGitSettings', async () => {
      await vscode.commands.executeCommand('workbench.action.openSettings', 'git.enabled');
    });
    gateway.register('ui.focus', async (params) => {
      await vscode.commands.executeCommand('setContext', 'gitBatchCommit.panelFocused', params.focused === true);
    });
    gateway.register('ui.metric', async (params) => {
      if (!/^[a-zA-Z0-9._-]{1,64}$/.test(params.name) || !Number.isFinite(params.ms) || params.ms < 0) {
        return;
      }
      const line = `[metric] ${params.name}=${Math.round(params.ms)}ms`;
      this.output.appendLine(line);
      this.diagnostics.record(line);
    });
  }

  private static readonly historyKey = 'gitBatchCommit.messageHistory';
  private static readonly historyCap = 20;

  private getHistory(): string[] {
    const raw = this.context.workspaceState.get<unknown>(Backend.historyKey);
    return Array.isArray(raw) ? raw.filter((m): m is string => typeof m === 'string') : [];
  }

  private recordHistory(message: string): void {
    const trimmed = message.trim();
    const next = [trimmed, ...this.getHistory().filter((m) => m !== trimmed)].slice(0, Backend.historyCap);
    void this.context.workspaceState.update(Backend.historyKey, next);
  }

  async copyDiagnostics(): Promise<void> {
    const s = this.services;
    const repos = s
      ? s.registry.all().map((d) => `${d.name} (${d.kind})`)
      : [];
    const lines = [
      `Git Batch Commit ${this.extensionVersion}`,
      `panelState=${this.panelState}`,
      `repos=${repos.length}: ${repos.join(', ')}`,
      `settings=${JSON.stringify(readSettings())}`,
      '',
      ...this.diagnostics.snapshot(),
    ];
    await vscode.env.clipboard.writeText(lines.join('\n'));
    void vscode.window.showInformationMessage('诊断信息已复制到剪贴板（不含文件内容与凭据）。');
  }

  dispose(): void {
    for (const [gateway, subs] of this.gateways) {
      for (const d of subs) {
        d.dispose();
      }
      gateway.dispose();
    }
    this.gateways.clear();
    this.services?.status.dispose();
    this.services?.registry.dispose();
    this.services?.tracker.dispose();
    for (const d of this.disposables) {
      d.dispose();
    }
  }
}

export function readSettings(): PanelSettings {
  const config = vscode.workspace.getConfiguration('gitBatchCommit.commit');
  return {
    defaultSelectAll: config.get<boolean>('defaultSelectAll', true),
    selectUntracked: config.get<boolean>('selectUntracked', false),
    clearMessageOnSuccess: config.get<boolean>('clearMessageOnSuccess', true),
    stopOnFirstRepoError: config.get<boolean>('stopOnFirstRepoError', true),
    refreshDebounceMs: config.get<number>('refreshDebounceMs', 250),
  };
}

const TEMPLATE_CAP = 64 * 1024;

function toProtocolError(err: unknown, command: 'branch' | 'pull' | 'push'): ProtocolError {
  if (typeof err === 'object' && err !== null && 'code' in err && 'actions' in err) {
    return err as ProtocolError;
  }
  const gitErr = asGitErrorLike(err);
  const mapped = mapGitErrorCode(gitErr.gitErrorCode, gitErr.stderr ?? gitErr.message ?? String(err));
  mapped.terminalCommand = `git ${command}`;
  return mapped;
}

async function readCommitTemplate(s: Services): Promise<string | null> {
  const repo = s.registry.all()[0];
  if (!repo) {
    return null;
  }
  const target = s.registry.get(repo.id);
  if (!target?.getConfig) {
    return null;
  }
  let templatePath = '';
  try {
    templatePath = (await target.getConfig('commit.template')).trim();
    if (!templatePath && target.getGlobalConfig) {
      templatePath = (await target.getGlobalConfig('commit.template')).trim();
    }
  } catch {
    return null;
  }
  if (!templatePath) {
    return null;
  }
  if (templatePath.startsWith('~')) {
    templatePath = path.join(os.homedir(), templatePath.slice(1));
  } else if (!path.isAbsolute(templatePath)) {
    templatePath = path.join(repo.rootPath, templatePath);
  }
  try {
    const stat = await fs.promises.stat(templatePath);
    if (!stat.isFile() || stat.size > TEMPLATE_CAP) {
      return null;
    }
    const raw = await fs.promises.readFile(templatePath, 'utf8');
    // match git's default cleanup: comment lines never reach the commit message
    const cleaned = raw
      .split('\n')
      .filter((line) => !line.startsWith('#'))
      .join('\n')
      .trim();
    return cleaned || null;
  } catch {
    return null;
  }
}