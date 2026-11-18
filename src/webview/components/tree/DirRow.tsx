import { usePanelStore } from '../../state/StoreContext';
import { collectPaths } from '../../tree';
import { Icon } from '../../theme/icons/Icon';
import { Checkbox } from '../primitives';
import type { Row } from '../../treeRows';

type NodeRow = Extract<Row, { kind: 'node' }>;

export function DirRow({ row }: { row: NodeRow }) {
  const toggleCollapse = usePanelStore((s) => s.toggleCollapse);
  const collapsed = usePanelStore((s) => s.collapsed[row.key]);
  const setIncluded = usePanelStore((s) => s.setIncluded);
  const openContextMenu = usePanelStore((s) => s.openContextMenu);
  const { node, repoId, depth } = row;
  const checked = row.checkedCount ?? 0;
  const paths = collectPaths(node);
  return (
    <div
      className="gbc-vrow gbc-dirrow"
      style={{ paddingLeft: 8 + depth * 16 }}
      data-testid="dir-row"
      data-path={node.path}
      data-repo={repoId}
      role="treeitem"
      aria-expanded={!collapsed}
      tabIndex={0}
      data-gbc-row
      onKeyDown={(e) => {
        if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault();
          toggleCollapse(row.key);
        }
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        openContextMenu({ kind: 'dir', repoId, paths, x: e.clientX, y: e.clientY });
      }}
    >
      <button type="button" className="gbc-chevron" onClick={() => toggleCollapse(row.key)}>
        <Icon name={collapsed ? 'chevronRight' : 'chevronDown'} size={12} />
      </button>
      <Checkbox
        checked={node.total > 0 && checked === node.total}
        indeterminate={checked > 0 && checked < node.total}
        onChange={(target) => void setIncluded(paths.map((path) => ({ repoId, path })), target)}
        label={node.path}
      />
      <span className="gbc-dirname" onClick={() => toggleCollapse(row.key)}>
        <Icon name="folder" size={14} />
        {node.name}/
      </span>
      <span className="gbc-count">
        {checked}/{node.total}
      </span>
    </div>
  );
}