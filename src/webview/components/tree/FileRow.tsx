import type { FileChange } from '../../../protocol/models';
import { STRINGS } from '../../strings/en';
import { usePanelStore } from '../../state/StoreContext';
import { refKey } from '../../state/types';
import { Icon } from '../../theme/icons/Icon';
import { Checkbox, Tooltip } from '../primitives';
import type { Row } from '../../treeRows';

type NodeRow = Extract<Row, { kind: 'node' }>;

export function FileRow({ row }: { row: NodeRow }) {
  const change = row.node.change as FileChange;
  const { repoId, depth, side } = row;
  const key = refKey(repoId, change.path);
  const selected = usePanelStore((s) => s.highlighted.includes(key));
  const highlight = usePanelStore((s) => s.highlight);
  const toggleIncluded = usePanelStore((s) => s.toggleIncluded);
  const setIncluded = usePanelStore((s) => s.setIncluded);
  const openDiff = usePanelStore((s) => s.openDiff);
  const openFile = usePanelStore((s) => s.openFile);
  const openMergeEditor = usePanelStore((s) => s.openMergeEditor);
  const openContextMenu = usePanelStore((s) => s.openContextMenu);

  const letter = change.conflicted
    ? '!'
    : side === 'staged'
      ? (change.indexStatus ?? 'M')
      : (change.worktreeStatus ?? change.indexStatus ?? (change.kind === 'untracked' ? '?' : 'M'));
  const canDiff = !change.conflicted;
  const openDefault = (): void => {
    if (change.conflicted) {
      void openMergeEditor(repoId, change.path);
    } else if (canDiff) {
      void openDiff(repoId, change.path, side);
    } else {
      void openFile(repoId, change.path);
    }
  };

  return (
    <div
      className={`gbc-vrow gbc-filerow gbc-kind-${change.kind}${selected ? ' gbc-selected' : ''}`}
      style={{ paddingLeft: 8 + depth * 16 }}
      data-testid="file-row"
      data-path={change.path}
      data-repo={repoId}
      data-status={letter}
      data-included={row.included ? 'true' : 'false'}
      data-conflicted={change.conflicted ? 'true' : 'false'}
      role="treeitem"
      aria-selected={selected}
      tabIndex={0}
      data-gbc-row
      onClick={(e) => {
        if (e.ctrlKey || e.metaKey) {
          if (!change.conflicted) {
            void toggleIncluded({ repoId, path: change.path });
          }
          return;
        }
        highlight([key], e.shiftKey);
      }}
      onDoubleClick={openDefault}
      onContextMenu={(e) => {
        e.preventDefault();
        if (!selected) {
          highlight([key]);
        }
        openContextMenu({ kind: 'file', repoId, path: change.path, x: e.clientX, y: e.clientY });
      }}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) {
          return;
        }
        if (e.key === 'Enter') {
          e.preventDefault();
          openDefault();
        }
      }}
    >
      <span className="gbc-chevron-spacer" />
      <Checkbox
        checked={row.included ?? false}
        disabled={change.conflicted}
        onChange={(target) => void setIncluded([{ repoId, path: change.path }], target)}
        label={change.conflicted ? STRINGS.misc.conflictedHint : STRINGS.misc.included}
        testId="file-check"
      />
      <span className={`gbc-status gbc-status-${change.kind}`} title={STRINGS.changeKind[change.kind]}>
        {letter}
      </span>
      <span className="gbc-path" title={change.origPath ? `${change.origPath} → ${change.path}` : change.path}>
        {row.node.name}
      </span>
      {change.origPath && <span className="gbc-orig">← {change.origPath}</span>}
      {row.partial && (
        <Tooltip text={STRINGS.misc.partialTooltip}>
          <span className="gbc-partial" data-testid="partial-badge">
            {STRINGS.misc.partial}
          </span>
        </Tooltip>
      )}
      {change.conflicted && (
        <span className="gbc-conflict-hint" title={STRINGS.misc.conflictedHint}>
          <Icon name="warning" size={12} />
        </span>
      )}
    </div>
  );
}