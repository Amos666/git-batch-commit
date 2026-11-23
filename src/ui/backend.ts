import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { GitApiUnavailableError } from '../adapter/gitApi';
import { mapLocalBranches, mapRemoteBranches } from '../adapter/branchRefs';
import { asGitErrorLike } from '../adapter/gitApiTypes';
import { RepoRegistry } from '../adapter/repoRegistry';
import { BatchOrchestrator } from '../core/batchOrchestrator';
import { defaultChangelistState } from '../core/changelistModel';
import { CommitTranslator } from '../core/commitTranslator';
import { InclusionModel } from '../core/inclusionModel';
import { MiniRunner, validateBranchName, validatePath } from '../core/miniRunner';
import { OperationTracker } from '../core/operationTracker';
import { pickRemote } from '../core/pushTarget';
import { StatusService } from '../core/statusService';
import { TerminalBridge } from '../core/terminalBridge';
import { CHECK_AVAILABILITY, detectCapabilities } from '../kernel/capabilities';
import type { GitKernel } from '../kernel/types';
import { createVscodeGitKernel } from '../kernel/vscodeGitKernel';
import { makeError, mapGitErrorCode } from '../protocol/errors';
import type { ProtocolError } from '../protocol/errors';
import { normalizeCommitRequest } from '../protocol/messages';
import type { BranchRef, EventMap, InitResult, LogPage, PanelSettings } from '../protocol/messages';
import type { ChangelistFileRef, ChangelistState, CommitOptionsState, PanelState, PushFilesResult, PushPreviewEntry, UnavailableReason } from '../protocol/models';
import { ChangelistService } from '../services/changelistService';
import type { ChangelistStorage } from '../services/changelistService';
import { ChecksService } from '../services/checksService';
import { commitFileEntries, EMPTY_TREE_OID, rangeFileEntries } from '../services/commitFiles';
import { DiffDataService } from '../services/diffDataService';
import { guardWorktreeFile } from '../services/diffData';
import { HunkService } from '../services/hunkService';
import { OptionsService } from '../services/optionsService';
import { ShelfService } from '../services/shelfService';
import { SequencerService } from '../services/sequencerService';
import { StashService } from '../services/stashService';
import { Diagnostics } from './diagnostics';
import { DiffViewProvider } from './diffViewProvider';
import { EditorActions } from './editorActions';
import { EditorBridge } from './editorBridge';
import { MessageGateway } from './messageGateway';

interface Services {
  kernel: GitKernel;
  registry: RepoRegistry;
  status: StatusService;
  inclusion: InclusionModel;
  translator: CommitTranslator;
  changelists: ChangelistService;
  options: OptionsService;
  orchestrator: BatchOrchestrator;
  tracker: OperationTracker;
  terminal: TerminalBridge;
  editor: EditorBridge;
  hunk: HunkService;
  diffData: DiffDataService;
  checks: ChecksService;
  stash: StashService;
  shelf: ShelfService;
  sequencer: SequencerService;
  mini: MiniRunner;
}

export class Backend implements vscode.Disposable {
  private services: Services | undefined;
  private initPromise: Promise<void> | undefined;
  private panelState: PanelState = 'initializing';
  private unavailableReason: UnavailableReason | undefined;
  private readonly gateways = new Map<MessageGateway, (() => void)[]>();
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
      const mini = new MiniRunner(() => vscode.workspace.getConfiguration('git').get<string>('path') || 'git');
      const kernel = await createVscodeGitKernel(mini);
      const registry = new RepoRegistry(kernel);
      const settings = readSettings();
      const status = new StatusService(registry, settings.refreshDebounceMs);
      const inclusion = new InclusionModel(registry);
      const tracker = new OperationTracker();
      const hunk = new HunkService(registry, mini);
      const translator = new CommitTranslator(registry, inclusion, hunk, mini);
      const changelists = new ChangelistService(status, inclusion, hunk, this.changelistStorage(), () => {
        const current = readSettings();
        return { defaultSelectAll: current.defaultSelectAll, selectUntracked: current.selectUntracked };
      });
      const options = new OptionsService({
        load: () => this.context.workspaceState.get<Partial<CommitOptionsState>>('gitBatchCommit.commitOptions'),
        save: async (next) => {
          await this.context.workspaceState.update('gitBatchCommit.commitOptions', next);
        },
      });
      const orchestrator = new BatchOrchestrator(
        registry,
        inclusion,
        translator,
        tracker,
        () => ({
          stopOnFirstRepoError: readSettings().stopOnFirstRepoError,
          confirmIndexExclusion: (_repoId, paths) => this.confirmIndexExclusion(paths),
          onCommitted: (repoId, req) => {
            const entries = req.expectedIncluded?.[repoId];
            if (entries) {
              changelists.removeCommitted(repoId, entries);
            }
            status.refresh(repoId);
          },
        }),
        (name, ms) => this.recordMetric(name, ms),
      );
      const terminal = new TerminalBridge(registry);
      const editor = new EditorBridge(registry);
      const diffData = new DiffDataService(registry, mini);
      const checks = new ChecksService(registry, new EditorActions());
      const stash = new StashService(registry, mini);
      const storageRoot = (this.context.storageUri ?? this.context.globalStorageUri).fsPath;
      const shelf = new ShelfService(registry, mini, path.join(storageRoot, 'shelf'));
      const sequencer = new SequencerService(registry, mini);
      this.services = { kernel, registry, status, inclusion, translator, changelists, options, orchestrator, tracker, terminal, editor, hunk, diffData, checks, stash, shelf, sequencer, mini };
      this.panelState = 'ready';
      this.unavailableReason = undefined;
      this.output.appendLine(`Git kernel bound; repositories: ${registry.all().length}`);
      for (const gateway of this.gateways.keys()) {
        this.wireEvents(gateway);
        gateway.emit('panel.state', { panelState: 'ready' });
      }
    } catch (err) {
      this.panelState = 'backend-unavailable';
      this.unavailableReason = err instanceof GitApiUnavailableError ? err.reason : 'extension-disabled';
      this.output.appendLine('Git kernel unavailable: ' + String(err));
      for (const gateway of this.gateways.keys()) {
        gateway.emit('panel.state', { panelState: 'backend-unavailable', unavailableReason: this.unavailableReason });
      }
    }
  }

  private async ready(): Promise<Services> {
    await this.init();
    if (!this.services) {
      throw makeError('GIT_EXTENSION_UNAVAILABLE', 'The git backend is unavailable; enable it and retry', ['enableGitExtension', 'openGitSettings']);
    }
    return this.services;
  }

  private changelistStorage(): ChangelistStorage {
    const key = 'gitBatchCommit.changelists';
    return {
      load: () => {
        const raw = this.context.workspaceState.get<ChangelistState>(key);
        return raw && raw.version === 1 && Array.isArray(raw.lists) && raw.lists.length > 0 ? raw : undefined;
      },
      save: async (state) => {
        await this.context.workspaceState.update(key, state);
      },
      backup: async (state) => {
        await this.context.workspaceState.update(`${key}.backup`, state);
      },
    };
  }

  private exclusionConfirmedThisSession = false;
  private diffView: DiffViewProvider | undefined;

  /** Files the next commit would include, for checks scoped to the commit. */
  private includedRefs(s: Services, repoIds: string[]): ChangelistFileRef[] {
    const wanted = new Set(repoIds);
    const state = s.changelists.get();
    if (state.mode === 'changelist') {
      return [...state.lists.flatMap((l) => l.checked), ...state.unversionedChecked].filter((r) => wanted.has(r.repoId));
    }
    const refs: ChangelistFileRef[] = [];
    for (const repoId of repoIds) {
      for (const c of s.status.snapshot(repoId)?.changes ?? []) {
        if (c.staged && !c.conflicted) {
          refs.push({ repoId, path: c.path });
        }
      }
    }
    return refs;
  }

  private async confirmIndexExclusion(paths: string[]): Promise<boolean> {
    if (this.exclusionConfirmedThisSession) {
      return true;
    }
    const preview = paths.slice(0, 5).join(', ') + (paths.length > 5 ? `, … (${paths.length} files)` : '');
    const choice = await vscode.window.showWarningMessage(
      `The index contains staged files that are not checked: ${preview}. Unstage them and commit only the checked files?`,
      { modal: true },
      'Unstage and Commit',
    );
    if (choice === 'Unstage and Commit') {
      this.exclusionConfirmedThisSession = true;
      return true;
    }
    return false;
  }

  refresh(): void {
    this.services?.status.refresh();
  }

  dispatchCommand(command: EventMap['ui.command']['command']): void {
    for (const gateway of this.gateways.keys()) {
      gateway.emit('ui.command', { command });
    }
  }

  attach(gateway: MessageGateway): vscode.Disposable {
    this.gateways.set(gateway, []);
    if (this.services) {
      this.wireEvents(gateway);
    }
    this.registerHandlers(gateway);
    return new vscode.Disposable(() => {
      for (const unsub of this.gateways.get(gateway) ?? []) {
        unsub();
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
      s.changelists.onChanged((state) => gateway.emit('changelists.changed', { state })),
      s.changelists.onModeChanged((mode) => gateway.emit('mode.changed', { mode })),
      s.options.onChanged((options) => gateway.emit('options.changed', { options })),
    );
  }

  private registerHandlers(gateway: MessageGateway): void {
    gateway.register('panel.init', async (): Promise<InitResult> => {
      await this.init();
      return {
        panelState: this.panelState,
        unavailableReason: this.unavailableReason,
        repos: this.services?.status.all() ?? [],
        settings: readSettings(),
        extensionVersion: this.extensionVersion,
        capabilities: this.services?.kernel.capabilities ?? detectCapabilities([]),
        checks: CHECK_AVAILABILITY,
        changelists: this.services?.changelists.get() ?? defaultChangelistState(),
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
    gateway.register('status.refresh', async (params) => {
      const s = await this.ready();
      return s.status.rescan(params?.repoId);
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
    gateway.register('changelist.list', async () => {
      const s = await this.ready();
      return s.changelists.get();
    });
    gateway.register('changelist.create', async (params) => {
      const s = await this.ready();
      return s.changelists.create(params.name, params.comment);
    });
    gateway.register('changelist.rename', async (params) => {
      const s = await this.ready();
      s.changelists.rename(params.id, params.name);
    });
    gateway.register('changelist.remove', async (params) => {
      const s = await this.ready();
      s.changelists.remove(params.id);
    });
    gateway.register('changelist.setActive', async (params) => {
      const s = await this.ready();
      s.changelists.setActive(params.id);
    });
    gateway.register('changelist.setComment', async (params) => {
      const s = await this.ready();
      s.changelists.setComment(params.id, params.comment);
    });
    gateway.register('changelist.move', async (params) => {
      const s = await this.ready();
      s.changelists.move(params.refs, params.targetId, params.force ?? false);
    });
    gateway.register('mode.get', async () => {
      const s = await this.ready();
      return { mode: s.changelists.get().mode };
    });
    gateway.register('mode.previewMigration', async (params) => {
      const s = await this.ready();
      return s.changelists.previewMigration(params.mode);
    });
    gateway.register('mode.set', async (params) => {
      const s = await this.ready();
      await s.changelists.setMode(params.mode, params.confirm);
    });
    gateway.register('inclusion.set', async (params) => {
      const s = await this.ready();
      const t = Date.now();
      s.changelists.setIncluded(params.refs, params.included);
      this.recordMetric('inclusion.set', Date.now() - t);
    });
    gateway.register('inclusion.setPartial', async (params) => {
      const s = await this.ready();
      s.changelists.setPartial(params.repoId, params.path, params.selection);
    });
    gateway.register('index.stagePartial', async (params) => {
      const s = await this.ready();
      await s.hunk.stagePartial(params.repoId, params.path, params.selection);
      s.status.refresh();
    });
    gateway.register('index.unstagePartial', async (params) => {
      const s = await this.ready();
      await s.hunk.unstagePartial(params.repoId, params.path, params.selection);
      s.status.refresh();
    });
    gateway.register('options.get', async () => {
      const s = await this.ready();
      return s.options.get();
    });
    gateway.register('options.set', async (params) => {
      const s = await this.ready();
      s.options.set(params);
    });
    gateway.register('commit.run', async (params) => {
      const s = await this.ready();
      const req = normalizeCommitRequest(params);
      const results = await s.orchestrator.run(req);
      if (req.message.trim() && results.some((r) => r.ok)) {
        this.recordHistory(req.message);
      }
      return results;
    });
    gateway.register('commit.show', async (params) => {
      const s = await this.ready();
      await s.editor.openCommit(params.repoId, params.oid);
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
      const desc = s.registry.descriptor(params.repoId);
      if (!desc) {
        throw makeError('NO_REPOSITORY', `Repository not found: ${params.repoId}`);
      }
      if (!validatePath(params.path)) {
        throw makeError('GENERIC', 'Invalid file path');
      }
      if (params.side !== 'staged' && !params.force) {
        await guardWorktreeFile(desc.rootPath, params.repoId, params.path, params.side, diffThresholdKB());
      }
      this.diffView ??= new DiffViewProvider(this.context.extensionUri, this, (line) => this.output.appendLine(line));
      this.diffView.open(params.repoId, params.path, params.side, params.force ?? false);
    });
    gateway.register('diff.data', async (params) => {
      const s = await this.ready();
      return s.diffData.get(params.repoId, params.path, params.side, params.force ?? false, diffThresholdKB());
    });
    gateway.register('checks.run', async (params) => {
      const s = await this.ready();
      const refs = params.refs ?? this.includedRefs(s, params.repoIds);
      return s.checks.run(params.repoIds, params.checkIds, refs, (checkId, status) =>
        gateway.emit('checks.progress', { checkId, status }),
      );
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
        throw makeError('NO_REPOSITORY', `Repository not found: ${params.repoId}`);
      }
      const [local, remote] = await Promise.all([repo.getBranches({ remote: false }), repo.getBranches({ remote: true })]);
      return [...mapLocalBranches(local, repo.state.HEAD?.name), ...mapRemoteBranches(remote)];
    });
    gateway.register('branch.checkout', async (params) => {
      const s = await this.ready();
      const repo = s.registry.get(params.repoId);
      if (!repo) {
        throw makeError('NO_REPOSITORY', `Repository not found: ${params.repoId}`);
      }
      await repo.checkout(params.name);
    });
    gateway.register('branch.create', async (params) => {
      const s = await this.ready();
      const repo = s.registry.get(params.repoId);
      if (!repo) {
        throw makeError('NO_REPOSITORY', `Repository not found: ${params.repoId}`);
      }
      if (!validateBranchName(params.name)) {
        throw makeError('GENERIC', 'Invalid branch name');
      }
      await repo.createBranch(params.name, params.checkout ?? true, params.ref);
      s.status.refresh();
    });
    gateway.register('branch.delete', async (params) => {
      const s = await this.ready();
      const repo = s.registry.get(params.repoId);
      if (!repo) {
        throw makeError('NO_REPOSITORY', `Repository not found: ${params.repoId}`);
      }
      if (repo.state.HEAD?.name === params.name) {
        throw makeError('GENERIC', 'Cannot delete the current branch');
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
        throw makeError('NO_REPOSITORY', `Repository not found: ${params.repoId}`);
      }
      await s.mini.run(desc.rootPath, { cmd: 'branch-rename', from: params.from, to: params.to });
      s.status.refresh();
    });
    gateway.register('branch.compare', async (params) => {
      const s = await this.ready();
      if (!validateBranchName(params.name)) {
        throw makeError('GENERIC', 'Invalid branch name');
      }
      await s.editor.openBranchCompare(params.repoId, params.name);
    });
    gateway.register('repo.pull', async (params) => {
      const s = await this.ready();
      const repo = s.registry.get(params.repoId);
      if (!repo) {
        throw makeError('NO_REPOSITORY', `Repository not found: ${params.repoId}`);
      }
      if (!repo.pull) {
        throw makeError('CAPABILITY_UNAVAILABLE', 'The active git kernel does not support pull');
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
        throw makeError('NO_REPOSITORY', `Repository not found: ${params.repoId}`);
      }
      const head = repo.state.HEAD;
      if (!head?.name) {
        throw makeError('GENERIC', 'Cannot push from detached HEAD; check out a branch first');
      }
      const pick = pickRemote(head.upstream?.remote, head.upstream ? [] : repo.state.remotes.map((r) => r.name), params.remote);
      if (pick.status !== 'ok') {
        throw pick.status === 'none'
          ? makeError('NO_REMOTE', 'No remote is configured for this repository; add one before pushing')
          : makeError('NO_REMOTE', 'Multiple remotes are configured; choose a push target in the Push dialog');
      }
      s.tracker.start(params.repoId, 'push');
      s.tracker.update(params.repoId, 'pushing');
      try {
        await repo.push(pick.remote, head.name, !head.upstream);
        s.tracker.end(params.repoId, 'done');
      } catch (err) {
        const error = toProtocolError(err, 'push');
        s.tracker.end(params.repoId, 'failed', error.message);
        throw error;
      }
      s.status.refresh();
    });
    gateway.register('push.preview', async (params): Promise<PushPreviewEntry[]> => {
      const s = await this.ready();
      const entries: PushPreviewEntry[] = [];
      for (const repoId of params.repoIds) {
        const repo = s.registry.get(repoId);
        if (!repo) {
          continue;
        }
        const head = repo.state.HEAD;
        const upstreamRef = head?.upstream ? `${head.upstream.remote}/${head.upstream.name}` : undefined;
        const entry: PushPreviewEntry = {
          repoId,
          branch: head?.name,
          upstream: upstreamRef,
          ahead: head?.ahead,
          remotes: repo.state.remotes.map((r) => r.name),
          commits: [],
          hasMore: false,
          previewUnavailable: !repo.log,
        };
        if (head?.name && repo.log) {
          try {
            const max = upstreamRef ? 200 : 10;
            const range = upstreamRef ? `${upstreamRef}..HEAD` : 'HEAD';
            const commits = await repo.log({ range, maxEntries: max + 1 });
            entry.hasMore = commits.length > max;
            entry.commits = commits.slice(0, max).map((c) => ({
              hash: c.hash,
              message: c.message,
              authorName: c.authorName,
              authorEmail: c.authorEmail,
              authorDate: c.authorDate?.getTime(),
            }));
          } catch {
            // preview is best-effort; pushing still works without it
          }
        }
        const desc = s.registry.descriptor(repoId);
        if (desc) {
          try {
            const read = async (key: 'user.name' | 'user.email'): Promise<string | undefined> => {
              const v = (await s.mini.run(desc.rootPath, { cmd: 'config-get', key })).stdout.toString('utf8').trim();
              return v || undefined;
            };
            const [name, email] = await Promise.all([read('user.name'), read('user.email')]);
            if (name || email) {
              entry.selfAuthor = { name, email };
            }
          } catch {
            // identity is optional; asterisk marking degrades silently
          }
        }
        entries.push(entry);
      }
      return entries;
    });
    gateway.register('push.remoteBranches', async (params): Promise<{ branches: string[] }> => {
      const s = await this.ready();
      const repo = s.registry.get(params.repoId);
      if (!repo) {
        throw makeError('NO_REPOSITORY', `Repository not found: ${params.repoId}`);
      }
      if (!repo.state.remotes.some((r) => r.name === params.remote)) {
        throw makeError('NO_REMOTE', `Unknown remote '${params.remote}'`);
      }
      const refs = await repo.getBranches({ remote: true });
      const prefix = `${params.remote}/`;
      const branches = mapRemoteBranches(refs)
        .filter((b) => b.remote === params.remote)
        .map((b) => (b.name.startsWith(prefix) ? b.name.slice(prefix.length) : b.name));
      return { branches: [...new Set(branches)].sort() };
    });
    gateway.register('push.commitFiles', async (params): Promise<PushFilesResult> => {
      const s = await this.ready();
      const repo = s.registry.get(params.repoId);
      if (!repo) {
        throw makeError('NO_REPOSITORY', `Repository not found: ${params.repoId}`);
      }
      if (params.hash) {
        const commit = await repo.getCommit(params.hash);
        const parent = commit.parents[0];
        const files = await commitFileEntries(repo, params.hash, parent);
        return { from: parent ?? EMPTY_TREE_OID, to: params.hash, files };
      }
      const head = repo.state.HEAD;
      if (head?.upstream) {
        const upstreamRef = `${head.upstream.remote}/${head.upstream.name}`;
        const files = await rangeFileEntries(repo, upstreamRef, 'HEAD');
        return { from: upstreamRef, to: 'HEAD', files };
      }
      // no upstream: the outgoing set is the previewed commits (HEAD, max 10);
      // diff from the parent of the oldest previewed commit to HEAD
      if (!repo.log) {
        throw makeError('CAPABILITY_UNAVAILABLE', 'The active git kernel does not support log');
      }
      const commits = await repo.log({ range: 'HEAD', maxEntries: 11 });
      const oldest = commits[Math.min(commits.length, 10) - 1];
      if (!oldest) {
        return { from: EMPTY_TREE_OID, to: 'HEAD', files: [] };
      }
      const base = commits[10]?.hash ?? (await repo.getCommit(oldest.hash)).parents[0] ?? EMPTY_TREE_OID;
      const files = await rangeFileEntries(repo, base, 'HEAD');
      return { from: base, to: 'HEAD', files };
    });
    gateway.register('push.fileDiff', async (params): Promise<void> => {
      const s = await this.ready();
      await s.editor.openCommitFileDiff(params.repoId, params.file, params.from, params.to);
    });
    gateway.register('push.run', async (params) => {
      const s = await this.ready();
      const results = await s.orchestrator.runPush(params);
      s.status.refresh();
      return results;
    });
    gateway.register('log.list', async (params): Promise<LogPage> => {
      const s = await this.ready();
      const repo = s.registry.get(params.repoId);
      if (!repo) {
        throw makeError('NO_REPOSITORY', `Repository not found: ${params.repoId}`);
      }
      if (!repo.log) {
        throw makeError('CAPABILITY_UNAVAILABLE', 'The active git kernel does not support log');
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
        throw makeError('NO_REPOSITORY', `Repository not found: ${params.repoId}`);
      }
      if (repo.state.rebaseCommit) {
        if (!repo.rebaseAbort) {
          throw makeError('CAPABILITY_UNAVAILABLE', 'The active git kernel does not support rebase --abort');
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
        throw makeError('NO_REPOSITORY', `Repository not found: ${params.repoId}`);
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
      this.diffView ??= new DiffViewProvider(this.context.extensionUri, this, (line) => this.output.appendLine(line));
      this.diffView.open(params.repoId, params.path, 'worktree', true);
    });
    gateway.register('files.rollback', async (params) => {
      const s = await this.ready();
      const desc = s.registry.descriptor(params.repoId);
      if (!desc) {
        throw makeError('NO_REPOSITORY', `Repository not found: ${params.repoId}`);
      }
      const untracked = new Set(
        (s.status.snapshot(params.repoId)?.changes ?? []).filter((c) => c.kind === 'untracked').map((c) => c.path),
      );
      const tracked: string[] = [];
      const local: string[] = [];
      for (const p of params.paths) {
        if (!validatePath(p)) {
          throw makeError('GENERIC', 'Invalid file path');
        }
        (untracked.has(p) ? local : tracked).push(p);
      }
      for (let i = 0; i < tracked.length; i += 500) {
        await s.mini.run(desc.rootPath, { cmd: 'restore-head', paths: tracked.slice(i, i + 500) });
      }
      for (const p of local) {
        await fs.promises.rm(path.join(desc.rootPath, p), { force: true });
      }
      s.status.refresh(params.repoId);
    });
    gateway.register('files.delete', async (params) => {
      const s = await this.ready();
      const desc = s.registry.descriptor(params.repoId);
      if (!desc) {
        throw makeError('NO_REPOSITORY', `Repository not found: ${params.repoId}`);
      }
      for (const p of params.paths) {
        if (!validatePath(p)) {
          throw makeError('GENERIC', 'Invalid file path');
        }
        await fs.promises.rm(path.join(desc.rootPath, p), { force: true });
      }
      s.status.refresh(params.repoId);
    });
    gateway.register('files.open', async (params) => {
      const s = await this.ready();
      const desc = s.registry.descriptor(params.repoId);
      if (!desc) {
        throw makeError('NO_REPOSITORY', `Repository not found: ${params.repoId}`);
      }
      if (!validatePath(params.path)) {
        throw makeError('GENERIC', 'Invalid file path');
      }
      await vscode.window.showTextDocument(vscode.Uri.file(path.join(desc.rootPath, params.path)));
    });
    gateway.register('files.reveal', async (params) => {
      const s = await this.ready();
      const desc = s.registry.descriptor(params.repoId);
      if (!desc) {
        throw makeError('NO_REPOSITORY', `Repository not found: ${params.repoId}`);
      }
      if (!validatePath(params.path)) {
        throw makeError('GENERIC', 'Invalid file path');
      }
      await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(path.join(desc.rootPath, params.path)));
    });
    gateway.register('commit.isPushed', async (params) => {
      const s = await this.ready();
      const desc = s.registry.descriptor(params.repoId);
      const oid = s.registry.get(params.repoId)?.state.HEAD?.commit;
      if (!desc || !oid) {
        return { pushed: false };
      }
      const remotes = (await s.mini.run(desc.rootPath, { cmd: 'remote-contains', oid })).stdout.toString('utf8').trim();
      return { pushed: remotes.length > 0 };
    });
    gateway.register('ui.reloadWindow', async () => {
      await vscode.commands.executeCommand('workbench.action.reloadWindow');
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
      this.recordMetric(params.name, params.ms);
    });
  }

  private recordMetric(name: string, ms: number): void {
    if (!/^[a-zA-Z0-9._-]{1,64}$/.test(name) || !Number.isFinite(ms) || ms < 0) {
      return;
    }
    const line = `[metric] ${name}=${Math.round(ms)}ms`;
    this.output.appendLine(line);
    this.diagnostics.record(line);
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
    void vscode.window.showInformationMessage('Diagnostics copied to clipboard (no file contents or credentials).');
  }

  dispose(): void {
    this.diffView?.dispose();
    for (const [gateway, subs] of this.gateways) {
      for (const unsub of subs) {
        unsub();
      }
      gateway.dispose();
    }
    this.gateways.clear();
    this.services?.changelists.dispose();
    this.services?.options.dispose();
    this.services?.status.dispose();
    this.services?.registry.dispose();
    this.services?.tracker.dispose();
    this.services?.kernel.dispose();
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

function diffThresholdKB(): number {
  return vscode.workspace.getConfiguration('gitBatchCommit.diff').get<number>('largeFileThresholdKB', 2048);
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