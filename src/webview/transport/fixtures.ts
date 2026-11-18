import type {
  ChangelistDescriptor,
  ChangelistState,
  CheckAvailability,
  CommitResult,
  FileChange,
  KernelCapabilities,
  RepoStatus,
} from '../../protocol/models';
import type { EventMap, EventName, Method, RequestMap } from '../../protocol/messages';

export type MemoryHandlers = {
  [M in Method]: (params: RequestMap[M]['params']) => Promise<RequestMap[M]['result']>;
};

type Emit = <E extends EventName>(event: E, payload: EventMap[E]) => void;

const ALL_CAPABILITIES: KernelCapabilities = {
  stagedDiff: true,
  hashObject: true,
  stash: true,
  log: true,
  rootCommitStats: true,
  commitAuthor: true,
  commitCleanup: false,
};

const CHECKS: CheckAvailability[] = [
  { id: 'reformat', available: true },
  { id: 'optimizeImports', available: true },
  { id: 'rearrange', available: false },
  { id: 'cleanup', available: true, limited: true },
  { id: 'copyright', available: false },
  { id: 'dependencies', available: true },
  { id: 'analyze', available: true },
  { id: 'todo', available: true },
  { id: 'runConfiguration', available: false },
  { id: 'afterCommitUpload', available: false },
];

function change(repoId: string, p: string, partial: Partial<FileChange>): FileChange {
  return {
    repoId,
    path: p,
    uri: `file:///demo/${repoId}/${p}`,
    indexStatus: null,
    worktreeStatus: null,
    kind: 'modified',
    staged: false,
    conflicted: false,
    ...partial,
  };
}

function demoRepos(): RepoStatus[] {
  return [
    {
      repo: { id: 'alpha', rootUri: 'file:///demo/alpha', rootPath: '/demo/alpha', name: 'alpha', kind: 'repository' },
      branch: { name: 'main', detached: false, oid: 'a'.repeat(40), upstream: 'origin/main', ahead: 1, behind: 0 },
      changes: [
        change('alpha', 'src/app.ts', { worktreeStatus: 'M', kind: 'modified' }),
        change('alpha', 'src/util.ts', { worktreeStatus: 'M', indexStatus: 'M', staged: true, kind: 'modified' }),
        change('alpha', 'README.md', { worktreeStatus: '?', kind: 'untracked' }),
      ],
      seq: 1,
    },
    {
      repo: { id: 'beta', rootUri: 'file:///demo/beta', rootPath: '/demo/beta', name: 'beta', kind: 'repository' },
      branch: { name: 'main', detached: false, oid: 'b'.repeat(40) },
      changes: [change('beta', 'lib/core.ts', { worktreeStatus: 'M', kind: 'modified' })],
      seq: 1,
    },
  ];
}

function defaultChangelists(): ChangelistState {
  const tracked = [
    { repoId: 'alpha', path: 'src/app.ts' },
    { repoId: 'alpha', path: 'src/util.ts' },
    { repoId: 'beta', path: 'lib/core.ts' },
  ];
  return {
    version: 1,
    mode: 'changelist',
    activeId: 'default',
    lists: [{ id: 'default', name: 'Changes', comment: '', isDefault: true, files: tracked, checked: tracked, partial: {} }],
    unversionedChecked: [],
  };
}

/** Stateful in-memory host mock; exhaustive over RequestMap so new methods force a mock. */
export function defaultHandlers(emit: Emit): MemoryHandlers {
  const repos = demoRepos();
  let cls = defaultChangelists();
  let seq = 100;
  const pushChangelists = (): void => {
    emit('changelists.changed', { state: cls });
  };
  const snapshot = (repoId: string): RepoStatus | undefined => repos.find((r) => r.repo.id === repoId);
  const pushStatus = (repoId: string): void => {
    const repo = snapshot(repoId);
    if (repo) {
      repo.seq = ++seq;
      emit('status.changed', { status: { ...repo, changes: [...repo.changes] } });
    }
  };
  const setStaged = (repoId: string, paths: string[], target: boolean): void => {
    const repo = snapshot(repoId);
    if (!repo) {
      return;
    }
    const selected = new Set(paths);
    repo.changes = repo.changes.map((c) =>
      selected.has(c.path) && !c.conflicted
        ? { ...c, staged: target, indexStatus: target ? (c.worktreeStatus ?? c.indexStatus ?? 'M') : null }
        : c,
    );
    pushStatus(repoId);
  };

  return {
    'panel.init': async () => ({
      panelState: 'ready',
      repos: repos.map((r) => ({ ...r, changes: [...r.changes] })),
      settings: {
        defaultSelectAll: true,
        selectUntracked: false,
        clearMessageOnSuccess: true,
        stopOnFirstRepoError: true,
        refreshDebounceMs: 250,
      },
      extensionVersion: '0.0.0-dev',
      capabilities: ALL_CAPABILITIES,
      checks: CHECKS,
      changelists: cls,
    }),
    'status.get': async (params) =>
      params?.repoId
        ? repos.filter((r) => r.repo.id === params.repoId).map((r) => ({ ...r }))
        : repos.map((r) => ({ ...r })),
    'status.refresh': async (params) =>
      params?.repoId
        ? repos.filter((r) => r.repo.id === params.repoId).map((r) => ({ ...r }))
        : repos.map((r) => ({ ...r })),
    'index.stage': async (params) => {
      setStaged(params.repoId, params.paths, true);
    },
    'index.unstage': async (params) => {
      setStaged(params.repoId, params.paths, false);
    },
    'index.stageAll': async (params) => {
      const repo = snapshot(params.repoId);
      setStaged(params.repoId, repo?.changes.map((c) => c.path) ?? [], true);
    },
    'index.unstageAll': async (params) => {
      const repo = snapshot(params.repoId);
      setStaged(params.repoId, repo?.changes.filter((c) => c.staged).map((c) => c.path) ?? [], false);
    },
    'commit.run': async (params) => {
      const results: CommitResult[] = params.repoIds.map((repoId) => {
        const repo = snapshot(repoId);
        if (!repo) {
          return { repoId, ok: false, error: { code: 'NO_REPOSITORY', message: `Repository not found: ${repoId}`, actions: [] }, durationMs: 0 };
        }
        repo.changes = repo.changes
          .filter((c) => !(c.staged && c.worktreeStatus === null))
          .map((c) => (c.staged ? { ...c, staged: false, indexStatus: null } : c));
        pushStatus(repoId);
        return { repoId, ok: true, commitOid: 'c'.repeat(40), branch: repo.branch.name, durationMs: 5 };
      });
      return results;
    },
    'commit.show': async () => {},
    'commit.undo': async (params) => {
      pushStatus(params.repoId);
    },
    'commit.template': async () => null,
    'history.list': async () => ['Fix demo fixture', 'Initial commit'],
    'batch.cancelRemaining': async () => {},
    'diff.open': async () => {},
    'hunk.list': async (params) => ({
      side: params.side,
      binary: false,
      hunks: [
        {
          id: 0,
          header: '@@ -1,3 +1,4 @@',
          oldStart: 1,
          oldLines: 3,
          newStart: 1,
          newLines: 4,
          lines: [' const a = 1;', '+const b = 2;', ' const c = 3;', ' export {};'],
        },
      ],
    }),
    'hunk.stage': async (params) => {
      setStaged(params.repoId, [params.path], true);
    },
    'hunk.unstage': async (params) => {
      setStaged(params.repoId, [params.path], false);
    },
    'stash.list': async () => [],
    'stash.create': async () => {},
    'stash.apply': async () => {},
    'stash.pop': async () => {},
    'stash.drop': async () => {},
    'shelf.list': async () => [],
    'shelf.create': async (params) => ({
      id: `shelf-${params.name}`,
      name: params.name,
      createdAt: Date.now(),
      branch: 'main',
      files: params.paths,
    }),
    'shelf.unshelve': async () => {},
    'shelf.delete': async () => {},
    'branch.list': async (params) => [
      { name: 'main', commit: snapshot(params.repoId)?.branch.oid, current: true },
      { name: 'feature/demo', current: false },
      { name: 'main', remote: 'origin', commit: snapshot(params.repoId)?.branch.oid },
      { name: 'feature/demo', remote: 'origin' },
    ],
    'branch.checkout': async (params) => {
      const repo = snapshot(params.repoId);
      if (repo) {
        repo.branch = { ...repo.branch, name: params.name };
        pushStatus(params.repoId);
      }
    },
    'branch.create': async () => {},
    'branch.delete': async () => {},
    'branch.rename': async () => {},
    'branch.compare': async () => {},
    'repo.pull': async () => {},
    'repo.push': async () => {},
    'log.list': async () => ({
      entries: [
        { hash: 'd'.repeat(40), message: 'Initial commit', authorName: 'Demo Dev', authorDate: Date.now() - 86_400_000 },
      ],
      hasMore: false,
    }),
    'log.cherryPick': async () => {},
    'log.revert': async () => {},
    'merge.abort': async () => {},
    'merge.openEditor': async () => {},
    'ui.showGitOutput': async () => {},
    'ui.retryInTerminal': async () => {},
    'ui.openGitSettings': async () => {},
    'ui.focus': async () => {},
    'ui.metric': async () => {},
    'ui.reloadWindow': async () => {},
    'files.rollback': async (params) => {
      const repo = snapshot(params.repoId);
      if (repo) {
        const selected = new Set(params.paths);
        repo.changes = repo.changes.filter((c) => !(selected.has(c.path) && c.kind !== 'untracked' && !c.conflicted));
        pushStatus(params.repoId);
      }
    },
    'files.delete': async (params) => {
      const repo = snapshot(params.repoId);
      if (repo) {
        const selected = new Set(params.paths);
        repo.changes = repo.changes.filter((c) => !selected.has(c.path));
        pushStatus(params.repoId);
      }
    },
    'files.open': async () => {},
    'files.reveal': async () => {},
    'commit.isPushed': async () => ({ pushed: false }),
    'changelist.list': async () => cls,
    'changelist.create': async (params): Promise<ChangelistDescriptor> => {
      const list: ChangelistDescriptor = {
        id: `list-${params.name}`,
        name: params.name,
        comment: params.comment ?? '',
        isDefault: false,
        files: [],
        checked: [],
        partial: {},
      };
      cls = { ...cls, lists: [...cls.lists, list] };
      pushChangelists();
      return list;
    },
    'changelist.rename': async () => {},
    'changelist.remove': async () => {},
    'changelist.setActive': async (params) => {
      cls = { ...cls, activeId: params.id };
      pushChangelists();
    },
    'changelist.setComment': async () => {},
    'changelist.move': async () => {},
    'mode.get': async () => ({ mode: cls.mode }),
    'mode.previewMigration': async (params) => ({
      mode: params.mode,
      listsToRemove: 0,
      checkedToStage: 0,
      partialsToStage: 0,
      indexEntriesToChecked: 0,
    }),
    'mode.set': async (params) => {
      cls = { ...cls, mode: params.mode };
      emit('mode.changed', { mode: params.mode });
      pushChangelists();
    },
    'inclusion.set': async (params) => {
      const sameRef = (a: { repoId: string; path: string }, b: { repoId: string; path: string }): boolean =>
        a.repoId === b.repoId && a.path === b.path;
      const isUntracked = (ref: { repoId: string; path: string }): boolean =>
        snapshot(ref.repoId)?.changes.find((c) => c.path === ref.path)?.kind === 'untracked';
      const untracked = params.refs.filter(isUntracked);
      const tracked = params.refs.filter((r) => !isUntracked(r));
      cls = {
        ...cls,
        lists: cls.lists.map((l) => ({
          ...l,
          checked: params.included
            ? [...l.checked, ...tracked.filter((r) => l.files.some((f) => sameRef(f, r)) && !l.checked.some((c) => sameRef(c, r)))]
            : l.checked.filter((c) => !tracked.some((r) => sameRef(r, c))),
        })),
        unversionedChecked: params.included
          ? [...cls.unversionedChecked, ...untracked.filter((r) => !cls.unversionedChecked.some((c) => sameRef(c, r)))]
          : cls.unversionedChecked.filter((c) => !untracked.some((r) => sameRef(r, c))),
      };
      pushChangelists();
    },
    'inclusion.setPartial': async () => {},
    'index.stagePartial': async () => {},
    'index.unstagePartial': async () => {},
    'diff.data': async (params) => ({
      side: params.side,
      binary: false,
      tooLarge: false,
      oldText: 'const a = 1;\nconst c = 3;\nexport {};\n',
      newText: 'const a = 1;\nconst b = 2;\nconst c = 3;\nexport {};\n',
      hunks: [
        {
          id: 0,
          header: '@@ -1,3 +1,4 @@',
          oldStart: 1,
          oldLines: 3,
          newStart: 1,
          newLines: 4,
          lines: [' const a = 1;', '+const b = 2;', ' const c = 3;', ' export {};'],
        },
      ],
    }),
    'options.get': async () => ({ signoff: false, runHooks: true, checks: {}, runAfterCommit: false }),
    'options.set': async () => {},
    'checks.run': async (params) => ({
      results: params.checkIds.map((id) => ({ id, status: 'ok' as const })),
    }),
  };
}