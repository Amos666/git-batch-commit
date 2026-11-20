import { useEffect, useRef, useState } from 'react';
import { STRINGS } from '../strings/en';
import { usePanelStore } from '../state/StoreContext';
import { splitRefKey } from '../state/types';
import { Icon } from '../theme/icons/Icon';
import { Checkbox, IconButton } from './primitives';

export function Toolbar() {
  const s = usePanelStore((state) => state);
  const refs = s.highlighted.map(splitRefKey);
  const hasSelection = refs.length > 0;
  const first = refs[0];
  const firstChange = first ? s.repos[first.repoId]?.changes.find((c) => c.path === first.path) : undefined;
  const [viewOpen, setViewOpen] = useState(false);
  const viewRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!viewOpen) {
      return;
    }
    const onDown = (e: MouseEvent): void => {
      if (viewRef.current && !viewRef.current.contains(e.target as Node)) {
        setViewOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        setViewOpen(false);
      }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [viewOpen]);

  const T = STRINGS.toolbar;
  return (
    <div className="gbc-toolbar" data-testid="toolbar">
      <IconButton icon="refresh" label={T.refresh} testId="tool-refresh" onClick={() => void s.refresh()} />
      <IconButton
        icon="rollback"
        label={T.rollback}
        testId="tool-rollback"
        disabled={!hasSelection}
        onClick={() => s.openDialog({ kind: 'rollback', refs })}
      />
      <IconButton
        icon="shelve"
        label={T.shelve}
        testId="tool-shelve"
        disabled={!hasSelection || !first}
        onClick={() => first && s.requestShelve(first.repoId, refs.filter((r) => r.repoId === first.repoId))}
      />
      <IconButton
        icon="diff"
        label={T.showDiff}
        testId="tool-diff"
        disabled={!first}
        onClick={() =>
          first && void s.openDiff(first.repoId, first.path, s.mode === 'staging' && firstChange?.staged ? 'staged' : 'head')
        }
      />
      {s.mode === 'changelist' && (
        <IconButton
          icon="move"
          label={T.move}
          testId="tool-move"
          disabled={!hasSelection}
          onClick={() => s.openDialog({ kind: 'moveChangelist', refs, targetId: s.changelists?.activeId ?? 'default' })}
        />
      )}
      <span className="gbc-toolbar-spacer" />
      <IconButton icon="push" label={T.push} testId="tool-push" onClick={() => s.requestPush([])} />
      <div className="gbc-viewoptions" ref={viewRef}>
        <IconButton
          icon="eye"
          label={T.viewOptions}
          testId="tool-viewoptions"
          active={viewOpen}
          onClick={() => setViewOpen(!viewOpen)}
        />
        {viewOpen && (
          <div className="gbc-menu gbc-viewmenu" role="menu" data-testid="viewoptions-menu">
            <div className="gbc-menu-header">{T.groupBy}</div>
            <label className="gbc-menu-item gbc-menu-check">
              <Checkbox
                checked={s.viewOptions.groupByDirectory}
                onChange={() => s.toggleViewOption('groupByDirectory')}
                label={T.groupByDirectory}
                testId="view-groupdir"
              />
              <span className="gbc-menu-label">{T.directory}</span>
            </label>
            <div className="gbc-menu-sep" />
            <div className="gbc-menu-header">{T.show}</div>
            <label className="gbc-menu-item gbc-menu-check">
              <Checkbox
                checked={s.viewOptions.showUnversioned}
                onChange={() => s.toggleViewOption('showUnversioned')}
                label={T.showUnversioned}
                testId="view-unversioned"
              />
              <span className="gbc-menu-label">{STRINGS.groups.unversioned}</span>
            </label>
          </div>
        )}
      </div>
      <IconButton icon="expandAll" label={T.expandAll} testId="tool-expand" onClick={s.expandAll} />
      <IconButton icon="collapseAll" label={T.collapseAll} testId="tool-collapse" onClick={s.collapseAll} />
      <span className="gbc-toolbar-mode">
        <button
          type="button"
          className="gbc-mode-toggle"
          data-testid="mode-toggle"
          title={s.mode === 'changelist' ? STRINGS.dialogs.modeEnableTitle : STRINGS.dialogs.modeDisableTitle}
          onClick={() => void s.requestModeSwitch(s.mode === 'changelist' ? 'staging' : 'changelist')}
        >
          <Icon name="changelist" size={14} />
          <span>{s.mode === 'changelist' ? STRINGS.groups.changes : STRINGS.groups.staged}</span>
        </button>
      </span>
    </div>
  );
}