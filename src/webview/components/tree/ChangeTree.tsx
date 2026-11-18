import { useEffect, useMemo, useRef, useState } from 'react';
import type { RepoStatus } from '../../../protocol/models';
import { STRINGS } from '../../strings/en';
import { usePanelStore } from '../../state/StoreContext';
import { buildRows } from '../../treeRows';
import type { GroupId, Row } from '../../treeRows';
import { Icon } from '../../theme/icons/Icon';
import { Checkbox } from '../primitives';
import { BranchWidget } from '../BranchWidget';
import { ChangelistHeader } from './ChangelistHeader';
import { DirRow } from './DirRow';
import { FileRow } from './FileRow';

const ROW_H = 26;
const OVERSCAN = 10;

const GROUP_LABELS: Record<GroupId, string> = {
  conflicts: STRINGS.groups.mergeConflicts,
  staged: STRINGS.groups.staged,
  changes: STRINGS.groups.changes,
  unversioned: STRINGS.groups.unversioned,
};

function RepoRow({ row, status }: { row: Extract<Row, { kind: 'repo' }>; status: RepoStatus }) {
  const toggleCollapse = usePanelStore((s) => s.toggleCollapse);
  const collapsed = usePanelStore((s) => s.collapsed[row.key]);
  const setIncluded = usePanelStore((s) => s.setIncluded);
  return (
    <div
      className="gbc-vrow gbc-reporow"
      style={{ paddingLeft: 4 + row.depth * 16 }}
      data-testid="repo-row"
      data-repo={status.repo.id}
      role="treeitem"
      aria-expanded={!collapsed}
    >
      <button
        type="button"
        className="gbc-chevron"
        aria-label={collapsed ? STRINGS.toolbar.expandAll : STRINGS.toolbar.collapseAll}
        onClick={() => toggleCollapse(row.key)}
      >
        <Icon name={collapsed ? 'chevronRight' : 'chevronDown'} size={12} />
      </button>
      {row.selectable ? (
        <Checkbox
          checked={row.total > 0 && row.checked === row.total}
          indeterminate={row.checked > 0 && row.checked < row.total}
          onChange={(target) => void setIncluded(row.refs, target)}
          label={status.repo.name}
          testId="repo-check"
        />
      ) : (
        <span className="gbc-checkbox-spacer" />
      )}
      <span className="gbc-repo-name" title={status.repo.rootPath} onClick={() => toggleCollapse(row.key)}>
        <Icon name="openFolder" size={14} />
        {status.repo.name}
      </span>
      <span className="gbc-count">{STRINGS.groups.filesCount(row.total)}</span>
      {status.repo.kind !== 'repository' && <span className="gbc-kind">{status.repo.kind}</span>}
      <BranchWidget repoId={status.repo.id} />
    </div>
  );
}

function GroupHeader({ row }: { row: Extract<Row, { kind: 'group' }> }) {
  const toggleCollapse = usePanelStore((s) => s.toggleCollapse);
  const collapsed = usePanelStore((s) => s.collapsed[row.key]);
  const setIncluded = usePanelStore((s) => s.setIncluded);
  const openContextMenu = usePanelStore((s) => s.openContextMenu);
  const isConflicts = row.group === 'conflicts';
  const toggleAll = (target: boolean): void => {
    if (isConflicts) {
      return;
    }
    void setIncluded(row.refs, target);
  };
  return (
    <div
      className={`gbc-vrow gbc-grouprow gbc-group-${row.group}`}
      style={{ paddingLeft: 4 + row.depth * 16 }}
      data-testid={`group-${row.group}`}
      data-repo={row.repoId}
      role="treeitem"
      aria-expanded={!collapsed}
      onContextMenu={(e) => {
        if (row.group === 'unversioned') {
          e.preventDefault();
          openContextMenu({ kind: 'unversioned', repoId: row.repoId, x: e.clientX, y: e.clientY });
        }
      }}
    >
      <button type="button" className="gbc-chevron" onClick={() => toggleCollapse(row.key)}>
        <Icon name={collapsed ? 'chevronRight' : 'chevronDown'} size={12} />
      </button>
      {isConflicts ? (
        <span className="gbc-checkbox-spacer" />
      ) : (
        <Checkbox
          checked={row.total > 0 && row.checked === row.total}
          indeterminate={row.checked > 0 && row.checked < row.total}
          onChange={toggleAll}
          label={GROUP_LABELS[row.group]}
          testId={`group-check-${row.group}`}
        />
      )}
      <span className="gbc-group-name" onClick={() => toggleCollapse(row.key)}>
        {GROUP_LABELS[row.group]}
      </span>
      <span className="gbc-count">{STRINGS.groups.filesCount(row.total)}</span>
    </div>
  );
}

export function ChangeTree() {
  const repoOrder = usePanelStore((s) => s.repoOrder);
  const repos = usePanelStore((s) => s.repos);
  const mode = usePanelStore((s) => s.mode);
  const changelists = usePanelStore((s) => s.changelists);
  const viewOptions = usePanelStore((s) => s.viewOptions);
  const collapsed = usePanelStore((s) => s.collapsed);
  const containerRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportH, setViewportH] = useState(400);

  const rows = useMemo(
    () => buildRows({ repoOrder, repos, mode, changelists, viewOptions, collapsed }),
    [repoOrder, repos, mode, changelists, viewOptions, collapsed],
  );

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
      className="gbc-scroll gbc-tree"
      ref={containerRef}
      role="tree"
      aria-label={STRINGS.groups.changes}
      data-testid="change-tree"
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
      {repoOrder.length === 0 && <div className="gbc-empty">{STRINGS.groups.noRepos}</div>}
      <div style={{ height: rows.length * ROW_H, position: 'relative' }}>
        {visible.map((row, i) => {
          const index = start + i;
          const style = { position: 'absolute' as const, top: index * ROW_H, left: 0, right: 0, height: ROW_H };
          if (row.kind === 'node') {
            return (
              <div key={row.key} style={style}>
                {row.node.type === 'dir' ? <DirRow row={row} /> : <FileRow row={row} />}
              </div>
            );
          }
          if (row.kind === 'list') {
            return (
              <div key={row.key} style={style}>
                <ChangelistHeader row={row} />
              </div>
            );
          }
          if (row.kind === 'group') {
            return (
              <div key={row.key} style={style}>
                <GroupHeader row={row} />
              </div>
            );
          }
          if (row.kind === 'repo') {
            const status = repos[row.repoId];
            return (
              <div key={row.key} style={style}>
                {status && <RepoRow row={row} status={status} />}
              </div>
            );
          }
          return (
            <div key={row.key} className="gbc-vrow gbc-emptyrow" style={style}>
              <span className="gbc-empty-inline">{STRINGS.groups.noChanges}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}