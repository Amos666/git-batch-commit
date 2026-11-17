import { useEffect, useMemo, useRef, useState } from 'react';
import type { FileChange, RepoStatus } from '../protocol/models';
import type { DiffSide } from '../protocol/messages';
import { usePanelStore } from './store';
import { buildTree, collectPaths, flattenTree } from './tree';
import type { TreeNode } from './tree';

const ROW_H = 26;
const OVERSCAN = 10;

export type GroupId = 'conflicted' | 'staged' | 'changes' | 'untracked';

const GROUP_TITLES: Record<GroupId, string> = {
  conflicted: '冲突',
  staged: '已暂存',
  changes: '变更',
  untracked: '未跟踪',
};

const GROUP_SIDES: Record<GroupId, DiffSide> = {
  conflicted: 'worktree',
  staged: 'staged',
  changes: 'head',
  untracked: 'head',
};

type Row =
  | { kind: 'repo'; repoId: string }
  | { kind: 'group'; repoId: string; group: GroupId; total: number; staged: number }
  | { kind: 'node'; repoId: string; group: GroupId; node: TreeNode; depth: number }
  | { kind: 'empty'; repoId: string };

function groupChanges(status: RepoStatus, group: GroupId): FileChange[] {
  switch (group) {
    case 'conflicted':
      return status.changes.filter((c) => c.conflicted);
    case 'staged':
      return status.changes.filter((c) => c.staged && !c.conflicted);
    case 'changes':
      return status.changes.filter((c) => !c.conflicted && c.worktreeStatus !== null && c.worktreeStatus !== '?');
    case 'untracked':
      return status.changes.filter((c) => c.kind === 'untracked' && !c.conflicted);
  }
}

const GROUP_ORDER: GroupId[] = ['conflicted', 'staged', 'changes', 'untracked'];

export function buildRows(
  repoOrder: string[],
  repos: Record<string, RepoStatus>,
  collapsed: Record<string, boolean>,
): Row[] {
  const rows: Row[] = [];
  for (const repoId of repoOrder) {
    const status = repos[repoId];
    if (!status) {
      continue;
    }
    rows.push({ kind: 'repo', repoId });
    if (status.changes.length === 0) {
      rows.push({ kind: 'empty', repoId });
      continue;
    }
    for (const group of GROUP_ORDER) {
      const changes = groupChanges(status, group);
      if (changes.length === 0) {
        continue;
      }
      const staged = changes.filter((c) => c.staged).length;
      rows.push({ kind: 'group', repoId, group, total: changes.length, staged });
      if (collapsed[`${repoId}:${group}`]) {
        continue;
      }
      const tree = buildTree(changes);
      for (const { node, depth } of flattenTree(tree, collapsed, `${repoId}:${group}`)) {
        rows.push({ kind: 'node', repoId, group, node, depth });
      }
    }
  }
  return rows;
}

function TriCheckbox({
  staged,
  total,
  disabled,
  onToggle,
  title,
  ariaLabel,
}: {
  staged: number;
  total: number;
  disabled?: boolean;
  onToggle: (target: boolean) => void;
  title?: string;
  ariaLabel?: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const all = total > 0 && staged === total;
  const some = staged > 0 && staged < total;
  useEffect(() => {
    if (ref.current) {
      ref.current.indeterminate = some;
    }
  }, [some]);
  return (
    <input
      ref={ref}
      type="checkbox"
      checked={all}
      disabled={disabled}
      title={title ?? '勾选 = 暂存'}
      aria-label={ariaLabel ?? title ?? '勾选 = 暂存'}
      onChange={() => onToggle(!all)}
    />
  );
}

function RepoRow({ status }: { status: RepoStatus }) {
  const stageAll = usePanelStore((s) => s.stageAll);
  const unstageAll = usePanelStore((s) => s.unstageAll);
  const openBranchPicker = usePanelStore((s) => s.openBranchPicker);
  const openStashPanel = usePanelStore((s) => s.openStashPanel);
  const openShelfPanel = usePanelStore((s) => s.openShelfPanel);
  const openLogPanel = usePanelStore((s) => s.openLogPanel);
  const requestAbortMerge = usePanelStore((s) => s.requestAbortMerge);
  const requestUndoCommit = usePanelStore((s) => s.requestUndoCommit);
  const pullRepo = usePanelStore((s) => s.pullRepo);
  const pushRepo = usePanelStore((s) => s.pushRepo);
  const operation = usePanelStore((s) => s.operations[status.repo.id]);
  const { branch, repo } = status;
  const branchLabel = branch.name ?? (branch.oid ? `HEAD@${branch.oid.slice(0, 7)}` : '(无提交)');
  const opLabel =
    operation?.kind === 'pull' ? '拉取中…'
    : operation?.phase === 'pushing' || operation?.kind === 'push' ? '推送中…'
    : '提交中…';
  return (
    <>
      <span className="gbc-repo-name" title={repo.rootPath}>{repo.name}</span>
      {repo.kind !== 'repository' && <span className="gbc-kind">{repo.kind === 'worktree' ? 'worktree' : 'submodule'}</span>}
      <button className="gbc-branch" onClick={() => void openBranchPicker(repo.id)} title="分支管理（切换/创建/重命名/删除/对比）">
        {branchLabel}
      </button>
      {branch.ahead !== undefined && branch.ahead > 0 && <span className="gbc-ahead">↑{branch.ahead}</span>}
      {branch.behind !== undefined && branch.behind > 0 && <span className="gbc-behind">↓{branch.behind}</span>}
      {operation && <span className="gbc-op-inline">{opLabel}</span>}
      <span className="gbc-toolbar">
        {status.changes.some((c) => c.conflicted) && (
          <button className="gbc-linkbtn gbc-danger" title="中止进行中的合并/变基/拣选/反转（需二次确认）" onClick={() => requestAbortMerge(repo.id)}>
            中止合并
          </button>
        )}
        <button className="gbc-linkbtn" onClick={() => void stageAll(repo.id)}>全部暂存</button>
        <button className="gbc-linkbtn" onClick={() => void unstageAll(repo.id)}>全部取消</button>
        <button className="gbc-linkbtn" onClick={() => void openStashPanel(repo.id)}>Stash</button>
        <button className="gbc-linkbtn" onClick={() => void openShelfPanel(repo.id)}>Shelf</button>
        <button className="gbc-linkbtn" onClick={() => void openLogPanel(repo.id)}>日志</button>
        <button
          className="gbc-linkbtn"
          disabled={!branch.oid || !!operation}
          title="撤销最新提交（soft reset，改动保留在暂存区；仅限未推送提交，需二次确认）"
          onClick={() => requestUndoCommit(repo.id)}
        >
          撤销提交
        </button>
        <button className="gbc-linkbtn" disabled={!!operation} onClick={() => void pullRepo(repo.id)}>拉取</button>
        <button className="gbc-linkbtn" disabled={!!operation} onClick={() => void pushRepo(repo.id)}>推送</button>
      </span>
    </>
  );
}

function GroupRow({ row }: { row: Extract<Row, { kind: 'group' }> }) {
  const toggleCollapse = usePanelStore((s) => s.toggleCollapse);
  const stagePaths = usePanelStore((s) => s.stagePaths);
  const status = usePanelStore((s) => s.repos[row.repoId]);
  const collapsed = usePanelStore((s) => s.collapsedDirs[`${row.repoId}:${row.group}`]);
  const isConflicted = row.group === 'conflicted';
  const toggleAll = (target: boolean) => {
    if (!status) {
      return;
    }
    void stagePaths(row.repoId, groupChanges(status, row.group).map((c) => c.path), target);
  };
  return (
    <>
      <button className="gbc-chevron" onClick={() => toggleCollapse(`${row.repoId}:${row.group}`)}>
        {collapsed ? '▸' : '▾'}
      </button>
      <TriCheckbox
        staged={row.staged}
        total={row.total}
        disabled={isConflicted}
        onToggle={toggleAll}
        title={isConflicted ? '冲突文件需先解决' : '勾选整组 = 批量暂存'}
      />
      <span className="gbc-group-name">{GROUP_TITLES[row.group]} ({row.total})</span>
    </>
  );
}

function NodeRow({ row }: { row: Extract<Row, { kind: 'node' }> }) {
  const { node, repoId, group, depth } = row;
  const toggleCollapse = usePanelStore((s) => s.toggleCollapse);
  const stagePaths = usePanelStore((s) => s.stagePaths);
  const toggleStaged = usePanelStore((s) => s.toggleStaged);
  const openDiff = usePanelStore((s) => s.openDiff);
  const openHunkPicker = usePanelStore((s) => s.openHunkPicker);
  const openMergeEditor = usePanelStore((s) => s.openMergeEditor);
  const collapsed = usePanelStore((s) => s.collapsedDirs[`${repoId}:${group}:${node.path}`]);
  const indent = { paddingLeft: 8 + depth * 14 };

  if (node.type === 'dir') {
    return (
      <div
        className="gbc-vrow gbc-dirrow"
        style={indent}
        tabIndex={0}
        data-gbc-row
        aria-label={`目录 ${node.path}，${node.staged}/${node.total} 已暂存`}
        onKeyDown={(e) => {
          if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
            e.preventDefault();
            toggleCollapse(`${repoId}:${group}:${node.path}`);
          }
        }}
      >
        <button className="gbc-chevron" onClick={() => toggleCollapse(`${repoId}:${group}:${node.path}`)}>
          {collapsed ? '▸' : '▾'}
        </button>
        <TriCheckbox
          staged={node.staged}
          total={node.total}
          onToggle={(target) => void stagePaths(repoId, collectPaths(node), target)}
          title="勾选目录 = 批量暂存目录下文件"
          ariaLabel={`暂存目录 ${node.path} 下全部文件`}
        />
        <span className="gbc-dirname" onClick={() => toggleCollapse(`${repoId}:${group}:${node.path}`)}>
          {node.name}/
        </span>
        <span className="gbc-count">{node.staged}/{node.total}</span>
      </div>
    );
  }

  const change = node.change as FileChange;
  const side = GROUP_SIDES[group];
  const letter = side === 'staged' ? (change.indexStatus ?? 'M') : (change.worktreeStatus ?? 'M');
  const canDiff = change.kind !== 'untracked';
  return (
    <div
      className="gbc-vrow gbc-filerow"
      style={indent}
      tabIndex={0}
      data-gbc-row
      aria-label={`${change.path}，${change.conflicted ? '冲突' : change.staged ? '已暂存' : '未暂存'}，Enter 切换暂存，D 打开 Diff`}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) {
          return;
        }
        if (e.key === 'Enter' || e.key === ' ') {
          if (!change.conflicted) {
            e.preventDefault();
            void toggleStaged(repoId, change.path, !change.staged);
          }
        } else if (e.key === 'd' && canDiff) {
          void openDiff(repoId, change.path, side);
        }
      }}
      onDoubleClick={() => canDiff && void openDiff(repoId, change.path, side)}
    >
      <span className="gbc-chevron-spacer" />
      <input
        type="checkbox"
        checked={change.staged}
        disabled={change.conflicted}
        title={change.conflicted ? '冲突文件需先解决' : '勾选 = 暂存'}
        aria-label={`${change.path}：${change.staged ? '已暂存' : '未暂存'}`}
        onChange={(e) => void toggleStaged(repoId, change.path, e.target.checked)}
      />
      <span className={`gbc-status gbc-status-${letter === '?' ? '\\?' : letter}`}>{letter}</span>
      <span className="gbc-path" title={change.origPath ? `${change.origPath} → ${change.path}` : change.path}>
        {node.name}
      </span>
      {change.origPath && <span className="gbc-orig">← {change.origPath}</span>}
      {canDiff && (
        <button className="gbc-linkbtn" onClick={() => void openDiff(repoId, change.path, side)}>
          Diff
        </button>
      )}
      {!change.conflicted && (
        <button
          className="gbc-linkbtn"
          title={group === 'staged' ? '按 Hunk 取消暂存' : '按 Hunk 暂存部分改动'}
          onClick={() => void openHunkPicker(repoId, change.path, group === 'staged' ? 'staged' : 'worktree')}
        >
          Hunk
        </button>
      )}
      {change.conflicted && (
        <>
          <button
            className="gbc-linkbtn"
            title="打开合并编辑器解决冲突（不可用时回退为 Diff）"
            onClick={() => void openMergeEditor(repoId, change.path)}
          >
            合并编辑器
          </button>
          <button
            className="gbc-linkbtn"
            title="确认文件内容已解决后，暂存即标记为已解决"
            onClick={() => void toggleStaged(repoId, change.path, true)}
          >
            标记解决
          </button>
        </>
      )}
    </div>
  );
}

export function VirtualPanel() {
  const repoOrder = usePanelStore((s) => s.repoOrder);
  const repos = usePanelStore((s) => s.repos);
  const collapsed = usePanelStore((s) => s.collapsedDirs);
  const containerRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportH, setViewportH] = useState(400);

  const rows = useMemo(() => buildRows(repoOrder, repos, collapsed), [repoOrder, repos, collapsed]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) {
      return;
    }
    const observer = new ResizeObserver(() => setViewportH(el.clientHeight));
    observer.observe(el);
    setViewportH(el.clientHeight);
    return () => observer.disconnect();
  }, []);

  const start = Math.max(0, Math.floor(scrollTop / ROW_H) - OVERSCAN);
  const end = Math.min(rows.length, Math.ceil((scrollTop + viewportH) / ROW_H) + OVERSCAN);
  const visible = rows.slice(start, end);

  return (
    <div
      className="gbc-scroll"
      ref={containerRef}
      role="tree"
      aria-label="仓库变更列表"
      onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
      onKeyDown={(e) => {
        if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') {
          return;
        }
        const el = containerRef.current;
        if (!el) {
          return;
        }
        const focusable = Array.from(el.querySelectorAll<HTMLElement>('[data-gbc-row]'));
        if (focusable.length === 0) {
          return;
        }
        const idx = focusable.indexOf(document.activeElement as HTMLElement);
        const next = e.key === 'ArrowDown' ? idx + 1 : idx - 1;
        const target = focusable[Math.max(0, Math.min(focusable.length - 1, next))];
        if (target) {
          e.preventDefault();
          target.focus();
        }
      }}
    >
      {repoOrder.length === 0 && (
        <div className="gbc-empty">当前工作区没有打开的 Git 仓库。打开一个包含 Git 仓库的文件夹后，面板会自动显示。</div>
      )}
      <div style={{ height: rows.length * ROW_H, position: 'relative' }}>
        {visible.map((row, i) => {
          const index = start + i;
          const style = { position: 'absolute' as const, top: index * ROW_H, left: 0, right: 0, height: ROW_H };
          const key =
            row.kind === 'repo' ? `repo:${row.repoId}`
            : row.kind === 'group' ? `group:${row.repoId}:${row.group}`
            : row.kind === 'empty' ? `empty:${row.repoId}`
            : `node:${row.repoId}:${row.group}:${row.node.path}`;
          if (row.kind === 'node') {
            return (
              <div key={key} style={style}>
                <NodeRow row={row} />
              </div>
            );
          }
          const status = repos[row.repoId];
          return (
            <div key={key} className={`gbc-vrow gbc-${row.kind}row`} style={style}>
              {row.kind === 'repo' && status && <RepoRow status={status} />}
              {row.kind === 'group' && <GroupRow row={row} />}
              {row.kind === 'empty' && <span className="gbc-op-inline">没有变更</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
}