import { STRINGS } from '../../strings/en';
import type { IconName } from '../../theme/icons/paths';
import type { MenuTarget, PanelStore } from '../../state/types';
import { refKey, splitRefKey } from '../../state/types';

export interface MenuItem {
  id: string;
  label?: string;
  icon?: IconName;
  shortcut?: string;
  disabled?: boolean;
  danger?: boolean;
  checked?: boolean;
  separator?: boolean;
  run?: () => void;
}

const sep: MenuItem = { id: 'sep', separator: true };

function refsForTarget(target: MenuTarget, s: PanelStore): { repoId: string; path: string }[] {
  switch (target.kind) {
    case 'file':
      return [{ repoId: target.repoId, path: target.path }];
    case 'dir':
      return target.paths.map((path) => ({ repoId: target.repoId, path }));
    case 'unversioned': {
      const pool = target.repoId ? [s.repos[target.repoId]] : Object.values(s.repos);
      const refs: { repoId: string; path: string }[] = [];
      for (const status of pool) {
        if (!status) {
          continue;
        }
        for (const c of status.changes) {
          if (c.kind === 'untracked' && !c.conflicted) {
            refs.push({ repoId: status.repo.id, path: c.path });
          }
        }
      }
      return refs;
    }
    default:
      return [];
  }
}

/** If the right-clicked row is part of a multi-row highlight, act on the whole selection. */
function effectiveRefs(target: MenuTarget, s: PanelStore): { repoId: string; path: string }[] {
  const base = refsForTarget(target, s);
  if ((target.kind === 'file' || target.kind === 'dir') && s.highlighted.length > 1) {
    const key = target.kind === 'file' ? refKey(target.repoId, target.path) : null;
    const hit = key ? s.highlighted.includes(key) : base.some((r) => s.highlighted.includes(refKey(r.repoId, r.path)));
    if (hit) {
      return s.highlighted.map(splitRefKey);
    }
  }
  return base;
}

export function menuForTarget(target: MenuTarget, s: PanelStore): MenuItem[] {
  const M = STRINGS.menus;
  switch (target.kind) {
    case 'file':
    case 'dir':
    case 'unversioned': {
      const refs = effectiveRefs(target, s);
      const changes = refs
        .map((r) => s.repos[r.repoId]?.changes.find((c) => c.path === r.path))
        .filter((c): c is NonNullable<typeof c> => c !== undefined);
      const anyUntracked = changes.some((c) => c.kind === 'untracked');
      const allUntracked = changes.length > 0 && changes.every((c) => c.kind === 'untracked');
      const anyConflicted = changes.some((c) => c.conflicted);
      const anyStaged = changes.some((c) => c.staged);
      const single = target.kind === 'file' ? changes[0] : undefined;
      const items: MenuItem[] = [
        {
          id: 'showDiff',
          label: M.file.showDiff,
          icon: 'diff',
          shortcut: 'Ctrl+Alt+D',
          disabled: refs.length === 0,
          run: () => {
            const first = refs[0];
            if (first) {
              void s.openDiff(first.repoId, first.path, s.mode === 'staging' && anyStaged ? 'staged' : 'head');
            }
          },
        },
      ];
      if (target.kind === 'file') {
        items.push(
          {
            id: 'jumpToSource',
            label: M.file.jumpToSource,
            icon: 'jumpToSource',
            run: () => void s.openFile(target.repoId, target.path),
          },
          {
            id: 'openInSystemFolder',
            label: M.file.openInSystemFolder,
            icon: 'openFolder',
            run: () => void s.revealFile(target.repoId, target.path),
          },
        );
      }
      items.push(sep);
      if (anyConflicted && single) {
        items.push(
          {
            id: 'resolve',
            label: M.file.resolve,
            icon: 'warning',
            run: () => void s.openMergeEditor(single.repoId, single.path),
          },
          {
            id: 'markResolved',
            label: M.file.markResolved,
            icon: 'check',
            run: () => void s.setIncluded([{ repoId: single.repoId, path: single.path }], true),
          },
        );
      } else if (s.mode === 'staging') {
        items.push({
          id: anyStaged ? 'unstage' : 'addToVcs',
          label: anyStaged ? M.file.unstage : M.file.addToVcs,
          icon: anyStaged ? 'remove' : 'add',
          shortcut: anyStaged ? undefined : 'Ctrl+Alt+S',
          disabled: refs.length === 0 || anyConflicted,
          run: () => void s.setIncluded(refs, !anyStaged),
        });
      } else if (anyUntracked) {
        items.push({
          id: 'addToVcs',
          label: M.file.addToVcs,
          icon: 'add',
          shortcut: 'Ctrl+Alt+S',
          run: () => void s.setIncluded(refs.filter((r) => {
            const c = s.repos[r.repoId]?.changes.find((x) => x.path === r.path);
            return c?.kind === 'untracked';
          }), true),
        });
      }
      if (!anyConflicted) {
        items.push({
          id: 'rollback',
          label: M.file.rollback,
          icon: 'rollback',
          disabled: refs.length === 0,
          run: () => s.openDialog({ kind: 'rollback', refs }),
        });
      }
      items.push(sep, {
        id: 'shelve',
        label: M.file.shelve,
        icon: 'shelve',
        disabled: refs.length === 0 || allUntracked || anyConflicted || target.kind !== 'file',
        run: () => {
          if (target.kind === 'file') {
            s.requestShelve(target.repoId, refs.filter((r) => r.repoId === target.repoId));
          }
        },
      });
      if (target.kind === 'file') {
        items.push(sep, {
          id: 'copyPath',
          label: M.file.copyPath,
          icon: 'copy',
          run: () => void s.copyText(target.path),
        });
      }
      items.push(sep, {
        id: 'delete',
        label: M.file.delete,
        icon: 'delete',
        shortcut: 'Del',
        danger: true,
        disabled: refs.length === 0,
        run: () => s.openDialog({ kind: 'deleteFiles', refs }),
      });
      return items;
    }
    case 'changelist': {
      const list = s.changelists?.lists.find((l) => l.id === target.id);
      if (!list) {
        return [];
      }
      return [
        {
          id: 'new',
          label: M.changelist.new,
          icon: 'add',
          run: () => s.openDialog({ kind: 'newChangelist', name: '', comment: '' }),
        },
        {
          id: 'setActive',
          label: M.changelist.setActive,
          icon: 'check',
          disabled: list.id === s.changelists?.activeId,
          run: () => void s.setActiveChangelist(list.id),
        },
        {
          id: 'rename',
          label: M.changelist.rename,
          icon: 'amend',
          run: () => s.openDialog({ kind: 'renameChangelist', id: list.id, name: list.name }),
        },
        {
          id: 'editComment',
          label: M.changelist.editComment,
          icon: 'patch',
          run: () => s.openDialog({ kind: 'editComment', id: list.id, comment: list.comment }),
        },
        sep,
        {
          id: 'delete',
          label: M.changelist.delete,
          icon: 'delete',
          danger: true,
          disabled: list.isDefault,
          run: () => s.openDialog({ kind: 'deleteChangelist', id: list.id }),
        },
      ];
    }
    case 'shelfEntry': {
      const entry = s.shelfTab?.entries.find((e) => e.id === target.id);
      return [
        {
          id: 'unshelve',
          label: M.shelfEntry.unshelve,
          icon: 'unshelve',
          disabled: !entry,
          run: () => s.requestUnshelve(target.repoId, target.id),
        },
        {
          id: 'restore',
          label: M.shelfEntry.restore,
          icon: 'rollback',
          disabled: !entry,
          run: () => void s.restoreShelf(target.repoId, target.id),
        },
        sep,
        { id: 'createPatch', label: M.shelfEntry.createPatch, icon: 'patch', disabled: true },
        { id: 'copyPatch', label: M.shelfEntry.copyPatch, icon: 'copy', disabled: true },
        { id: 'importPatches', label: M.shelfEntry.importPatches, icon: 'file', disabled: true },
        { id: 'importClipboard', label: M.shelfEntry.importClipboard, icon: 'copy', disabled: true },
        sep,
        {
          id: 'delete',
          label: M.shelfEntry.delete,
          icon: 'delete',
          danger: true,
          disabled: !entry,
          run: () => s.requestDeleteShelf(target.repoId, target.id),
        },
      ];
    }
    case 'shelfFile':
      return [
        { id: 'showDiff', label: M.shelfFile.showDiff, icon: 'diff', disabled: true },
        {
          id: 'jumpToSource',
          label: M.shelfFile.jumpToSource,
          icon: 'jumpToSource',
          run: () => void s.openFile(target.repoId, target.path),
        },
        {
          id: 'copyPath',
          label: M.shelfFile.copyPath,
          icon: 'copy',
          run: () => void s.copyText(target.path),
        },
        sep,
        {
          id: 'unshelveFile',
          label: M.shelfFile.unshelveFile,
          icon: 'unshelve',
          run: () => s.unshelveSingleFile(target.repoId, target.id, target.path),
        },
      ];
    case 'stashEntry':
      return [
        {
          id: 'apply',
          label: M.stashEntry.apply,
          icon: 'check',
          run: () => void s.applyStash(target.repoId, target.index),
        },
        {
          id: 'pop',
          label: M.stashEntry.pop,
          icon: 'unshelve',
          run: () => s.requestPopStash(target.repoId, target.index),
        },
        sep,
        {
          id: 'drop',
          label: M.stashEntry.drop,
          icon: 'delete',
          danger: true,
          run: () => s.requestDropStash(target.repoId, target.index),
        },
      ];
  }
}