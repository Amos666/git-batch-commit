import type { ChangelistState, FileChange, PartialSelection, RepoStatus } from '../protocol/models';
import type { DiffSide } from '../protocol/messages';
import { buildTree, flattenTree } from './tree';
import type { TreeNode } from './tree';
import { refKey } from './state/types';
import type { ViewOptions } from './state/types';

export type GroupId = 'conflicts' | 'staged' | 'changes' | 'unversioned';

export type Row =
  | {
      kind: 'repo';
      key: string;
      repoId: string;
      depth: number;
      total: number;
      checked: number;
      selectable: boolean;
      refs: { repoId: string; path: string }[];
    }
  | {
      kind: 'list';
      key: string;
      listId: string;
      name: string;
      comment: string;
      isDefault: boolean;
      isActive: boolean;
      total: number;
      checked: number;
    }
  | {
      kind: 'group';
      key: string;
      group: GroupId;
      /** '' for workspace-wide headers (Merge Conflicts / Unversioned Files) */
      repoId: string;
      depth: number;
      total: number;
      checked: number;
      refs: { repoId: string; path: string }[];
    }
  | {
      kind: 'node';
      key: string;
      repoId: string;
      keyPrefix: string;
      node: TreeNode;
      depth: number;
      side: DiffSide;
      /** file rows only */
      included?: boolean;
      partial?: boolean;
      selection?: PartialSelection;
      checkedCount?: number;
    }
  | { kind: 'empty'; key: string; repoId?: string };

export interface RowInput {
  repoOrder: string[];
  repos: Record<string, RepoStatus>;
  mode: 'changelist' | 'staging';
  changelists: ChangelistState | null;
  viewOptions: ViewOptions;
  collapsed: Record<string, boolean>;
}

const GROUP_SIDES: Record<GroupId, DiffSide> = {
  conflicts: 'worktree',
  staged: 'staged',
  changes: 'head',
  unversioned: 'head',
};

export function groupChanges(status: RepoStatus, group: GroupId): FileChange[] {
  switch (group) {
    case 'conflicts':
      return status.changes.filter((c) => c.conflicted);
    case 'staged':
      return status.changes.filter((c) => c.staged && !c.conflicted);
    case 'changes':
      return status.changes.filter(
        (c) => !c.conflicted && c.kind !== 'untracked' && c.worktreeStatus !== null && c.worktreeStatus !== '?',
      );
    case 'unversioned':
      return status.changes.filter((c) => c.kind === 'untracked' && !c.conflicted);
  }
}

function countChecked(node: TreeNode, isIncluded: (c: FileChange) => boolean): number {
  if (node.type === 'file') {
    return node.change && isIncluded(node.change) ? 1 : 0;
  }
  return node.children.reduce((n, child) => n + countChecked(child, isIncluded), 0);
}

/** All collapsible header keys, for Expand All / Collapse All. */
export function headerKeys(input: RowInput): string[] {
  const rows = buildRows({ ...input, collapsed: {} });
  return rows.filter((r) => r.kind !== 'node' && r.kind !== 'empty').map((r) => r.key);
}

export function buildRows(input: RowInput): Row[] {
  const { repoOrder, repos, mode, changelists, viewOptions, collapsed } = input;
  const rows: Row[] = [];
  const statuses = repoOrder.map((id) => repos[id]).filter((s): s is RepoStatus => s !== undefined);
  if (statuses.length === 0) {
    return rows;
  }

  const pushTree = (
    changes: FileChange[],
    repoId: string,
    keyPrefix: string,
    side: DiffSide,
    isIncluded: (c: FileChange) => boolean,
    partialOf: (c: FileChange) => PartialSelection | undefined,
    depthBase = 0,
  ): void => {
    const tree = buildTree(changes);
    const flat = viewOptions.groupByDirectory
      ? flattenTree(tree, collapsed, keyPrefix)
      : changes
          .slice()
          .sort((a, b) => a.path.localeCompare(b.path))
          .map((c) => ({
            node: {
              type: 'file' as const,
              name: c.path,
              path: c.path,
              change: c,
              children: [],
              total: 1,
              staged: c.staged ? 1 : 0,
            },
            depth: 0,
          }));
    for (const { node, depth } of flat) {
      const key = `${keyPrefix}:${node.path}`;
      if (node.type === 'dir') {
        rows.push({
          kind: 'node',
          key,
          repoId,
          keyPrefix,
          node,
          depth: depth + depthBase,
          side,
          checkedCount: countChecked(node, isIncluded),
        });
      } else {
        const change = node.change as FileChange;
        const selection = partialOf(change);
        rows.push({
          kind: 'node',
          key,
          repoId,
          keyPrefix,
          node,
          depth: depth + depthBase,
          side,
          included: isIncluded(change),
          partial: selection !== undefined,
          selection,
        });
      }
    }
  };

  if (mode === 'changelist' && changelists) {
    const changeByKey = new Map<string, FileChange>();
    for (const status of statuses) {
      for (const c of status.changes) {
        changeByKey.set(refKey(status.repo.id, c.path), c);
      }
    }
    const checkedKeys = new Set<string>();
    for (const list of changelists.lists) {
      for (const ref of list.checked) {
        checkedKeys.add(refKey(ref.repoId, ref.path));
      }
    }
    for (const ref of changelists.unversionedChecked) {
      checkedKeys.add(refKey(ref.repoId, ref.path));
    }
    const isIncluded = (c: FileChange): boolean => checkedKeys.has(refKey(c.repoId, c.path));

    // Merge Conflicts: one workspace-wide header with project sub-nodes (never assignable)
    const conflictEntries = statuses
      .map((status) => ({ status, conflicts: status.changes.filter((c) => c.conflicted) }))
      .filter((e) => e.conflicts.length > 0);
    if (conflictEntries.length > 0) {
      const total = conflictEntries.reduce((n, e) => n + e.conflicts.length, 0);
      rows.push({ kind: 'group', key: 'mc', group: 'conflicts', repoId: '', depth: 0, total, checked: 0, refs: [] });
      if (!collapsed['mc']) {
        for (const { status, conflicts } of conflictEntries) {
          const repoKey = `mcrepo:${status.repo.id}`;
          rows.push({
            kind: 'repo',
            key: repoKey,
            repoId: status.repo.id,
            depth: 1,
            total: conflicts.length,
            checked: 0,
            selectable: false,
            refs: [],
          });
          if (!collapsed[repoKey]) {
            pushTree(conflicts, status.repo.id, `mc:${status.repo.id}`, 'worktree', () => false, () => undefined, 2);
          }
        }
      }
    }

    for (const list of changelists.lists) {
      const entries: { ref: { repoId: string; path: string }; change: FileChange }[] = [];
      for (const ref of list.files) {
        const change = changeByKey.get(refKey(ref.repoId, ref.path));
        if (change && !change.conflicted) {
          entries.push({ ref, change });
        }
      }
      const key = `cl:${list.id}`;
      const checked = entries.filter((e) => isIncluded(e.change)).length;
      rows.push({
        kind: 'list',
        key,
        listId: list.id,
        name: list.name,
        comment: list.comment,
        isDefault: list.isDefault,
        isActive: list.id === changelists.activeId,
        total: entries.length,
        checked,
      });
      if (collapsed[key] || entries.length === 0) {
        continue;
      }
      const byRepo = new Map<string, FileChange[]>();
      for (const e of entries) {
        const arr = byRepo.get(e.ref.repoId) ?? [];
        arr.push(e.change);
        byRepo.set(e.ref.repoId, arr);
      }
      for (const status of statuses) {
        const changes = byRepo.get(status.repo.id);
        if (!changes || changes.length === 0) {
          continue;
        }
        const repoKey = `${key}:${status.repo.id}`;
        rows.push({
          kind: 'repo',
          key: repoKey,
          repoId: status.repo.id,
          depth: 1,
          total: changes.length,
          checked: changes.filter(isIncluded).length,
          selectable: true,
          refs: changes.map((c) => ({ repoId: status.repo.id, path: c.path })),
        });
        if (collapsed[repoKey]) {
          continue;
        }
        pushTree(
          changes,
          status.repo.id,
          repoKey,
          'head',
          isIncluded,
          (c) => list.partial[refKey(c.repoId, c.path)],
          2,
        );
      }
    }

    // Unversioned Files: one workspace-wide header with project sub-nodes
    if (viewOptions.showUnversioned) {
      const uvEntries = statuses
        .map((status) => ({
          status,
          unversioned: status.changes.filter((c) => c.kind === 'untracked' && !c.conflicted),
        }))
        .filter((e) => e.unversioned.length > 0);
      if (uvEntries.length > 0) {
        const all = uvEntries.flatMap((e) => e.unversioned);
        rows.push({
          kind: 'group',
          key: 'uv',
          group: 'unversioned',
          repoId: '',
          depth: 0,
          total: all.length,
          checked: all.filter(isIncluded).length,
          refs: all.map((c) => ({ repoId: c.repoId, path: c.path })),
        });
        if (!collapsed['uv']) {
          for (const { status, unversioned } of uvEntries) {
            const repoKey = `uvrepo:${status.repo.id}`;
            rows.push({
              kind: 'repo',
              key: repoKey,
              repoId: status.repo.id,
              depth: 1,
              total: unversioned.length,
              checked: unversioned.filter(isIncluded).length,
              selectable: true,
              refs: unversioned.map((c) => ({ repoId: status.repo.id, path: c.path })),
            });
            if (!collapsed[repoKey]) {
              pushTree(unversioned, status.repo.id, `uv:${status.repo.id}`, 'head', isIncluded, () => undefined, 2);
            }
          }
        }
      }
    }
    return rows;
  }

  // staging mode
  const GROUP_ORDER: GroupId[] = ['conflicts', 'staged', 'changes', 'unversioned'];
  for (const status of statuses) {
    const repoKey = `repo:${status.repo.id}`;
    const selectable = status.changes.filter((c) => !c.conflicted);
    rows.push({
      kind: 'repo',
      key: repoKey,
      repoId: status.repo.id,
      depth: 0,
      total: selectable.length,
      checked: selectable.filter((c) => c.staged).length,
      selectable: true,
      refs: selectable.map((c) => ({ repoId: status.repo.id, path: c.path })),
    });
    if (collapsed[repoKey]) {
      continue;
    }
    if (status.changes.length === 0) {
      rows.push({ kind: 'empty', key: `empty:${status.repo.id}`, repoId: status.repo.id });
      continue;
    }
    for (const group of GROUP_ORDER) {
      if (group === 'unversioned' && !viewOptions.showUnversioned) {
        continue;
      }
      const changes = groupChanges(status, group);
      if (changes.length === 0) {
        continue;
      }
      const key = `g:${status.repo.id}:${group}`;
      rows.push({
        kind: 'group',
        key,
        group,
        repoId: status.repo.id,
        depth: 1,
        total: changes.length,
        checked: changes.filter((c) => c.staged).length,
        refs: changes.map((c) => ({ repoId: status.repo.id, path: c.path })),
      });
      if (!collapsed[key]) {
        pushTree(changes, status.repo.id, key, GROUP_SIDES[group], (c) => c.staged, () => undefined, 2);
      }
    }
  }
  return rows;
}