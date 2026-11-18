import { STRINGS } from '../../strings/en';
import { usePanelStore } from '../../state/StoreContext';
import { Icon } from '../../theme/icons/Icon';
import { Checkbox } from '../primitives';
import type { Row } from '../../treeRows';

type ListRow = Extract<Row, { kind: 'list' }>;

export function ChangelistHeader({ row }: { row: ListRow }) {
  const toggleCollapse = usePanelStore((s) => s.toggleCollapse);
  const collapsed = usePanelStore((s) => s.collapsed[row.key]);
  const setIncluded = usePanelStore((s) => s.setIncluded);
  const openContextMenu = usePanelStore((s) => s.openContextMenu);
  const list = usePanelStore((s) => s.changelists?.lists.find((l) => l.id === row.listId));
  const repos = usePanelStore((s) => s.repos);

  const toggleAll = (target: boolean): void => {
    if (!list) {
      return;
    }
    const pathsByRepo = new Map<string, Set<string>>();
    for (const [repoId, status] of Object.entries(repos)) {
      pathsByRepo.set(repoId, new Set(status.changes.filter((c) => !c.conflicted).map((c) => c.path)));
    }
    const refs = list.files.filter((ref) => pathsByRepo.get(ref.repoId)?.has(ref.path));
    void setIncluded(refs, target);
  };

  return (
    <div
      className={`gbc-vrow gbc-listrow${row.isActive ? ' gbc-listrow-active' : ''}`}
      data-testid={`changelist-${row.listId}`}
      data-active={row.isActive}
      role="treeitem"
      aria-expanded={!collapsed}
      onContextMenu={(e) => {
        e.preventDefault();
        openContextMenu({ kind: 'changelist', id: row.listId, x: e.clientX, y: e.clientY });
      }}
    >
      <button
        type="button"
        className="gbc-chevron"
        aria-label={collapsed ? STRINGS.toolbar.expandAll : STRINGS.toolbar.collapseAll}
        onClick={() => toggleCollapse(row.key)}
      >
        <Icon name={collapsed ? 'chevronRight' : 'chevronDown'} size={12} />
      </button>
      <Checkbox
        checked={row.total > 0 && row.checked === row.total}
        indeterminate={row.checked > 0 && row.checked < row.total}
        onChange={toggleAll}
        label={row.name}
        testId={`changelist-check-${row.listId}`}
      />
      <span className="gbc-listname" title={row.comment || undefined} onClick={() => toggleCollapse(row.key)}>
        {row.name}
      </span>
      <span className="gbc-count">{STRINGS.groups.filesCount(row.total)}</span>
      {row.comment && <span className="gbc-listcomment">{row.comment}</span>}
      {row.isActive && (
        <span className="gbc-activebadge" title={STRINGS.misc.activeChangelist}>
          <Icon name="check" size={10} />
        </span>
      )}
    </div>
  );
}