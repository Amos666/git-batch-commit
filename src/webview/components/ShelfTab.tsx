import { useState } from 'react';
import { STRINGS } from '../strings/en';
import { usePanelStore } from '../state/StoreContext';
import { Icon } from '../theme/icons/Icon';
import { IconButton } from './primitives';

export function ShelfTab() {
  const tab = usePanelStore((s) => s.shelfTab);
  const repoOrder = usePanelStore((s) => s.repoOrder);
  const repos = usePanelStore((s) => s.repos);
  const openShelfTab = usePanelStore((s) => s.openShelfTab);
  const reloadShelf = usePanelStore((s) => s.reloadShelf);
  const requestUnshelve = usePanelStore((s) => s.requestUnshelve);
  const unshelveSingleFile = usePanelStore((s) => s.unshelveSingleFile);
  const openContextMenu = usePanelStore((s) => s.openContextMenu);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  if (!tab) {
    return <div className="gbc-empty">{STRINGS.groups.noRepos}</div>;
  }
  return (
    <div className="gbc-tabbody" data-testid="shelf-tab">
      <div className="gbc-tabtoolbar">
        {repoOrder.length > 1 && (
          <select
            className="gbc-input gbc-select gbc-reposelect"
            data-testid="shelf-repo"
            aria-label={STRINGS.shelf.selectRepo}
            value={tab.repoId}
            onChange={(e) => void openShelfTab(e.target.value)}
          >
            {repoOrder.map((id) => (
              <option key={id} value={id}>
                {repos[id]?.repo.name ?? id}
              </option>
            ))}
          </select>
        )}
        <IconButton icon="refresh" label={STRINGS.toolbar.refresh} testId="shelf-refresh" onClick={() => void reloadShelf()} />
        {tab.busy && <span className="gbc-spinner" aria-hidden />}
      </div>
      {tab.error && (
        <div className="gbc-dialog-error" role="alert" data-testid="shelf-error">
          {tab.error}
        </div>
      )}
      {tab.entries.length === 0 && !tab.busy ? (
        <div className="gbc-empty">{STRINGS.shelf.empty}</div>
      ) : (
        <ul className="gbc-shelflist" data-testid="shelf-list">
          {tab.entries.map((entry) => (
            <li key={entry.id} className="gbc-shelfentry" data-testid="shelf-entry" data-shelf={entry.id}>
              <div
                className="gbc-vrow gbc-shelfrow"
                onDoubleClick={() => requestUnshelve(tab.repoId, entry.id)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  openContextMenu({ kind: 'shelfEntry', repoId: tab.repoId, id: entry.id, x: e.clientX, y: e.clientY });
                }}
              >
                <button
                  type="button"
                  className="gbc-chevron"
                  onClick={() => setExpanded({ ...expanded, [entry.id]: !expanded[entry.id] })}
                >
                  <Icon name={expanded[entry.id] ? 'chevronDown' : 'chevronRight'} size={12} />
                </button>
                <Icon name="stash" size={14} />
                <span className="gbc-shelfname" title={entry.name}>
                  {entry.name}
                </span>
                <span className="gbc-count">{STRINGS.shelf.files(entry.files.length)}</span>
                <span className="gbc-shelfmeta">
                  {entry.branch} · {new Date(entry.createdAt).toLocaleString()}
                </span>
              </div>
              {expanded[entry.id] && (
                <ul className="gbc-shelffiles">
                  {entry.files.map((path) => (
                    <li
                      key={path}
                      className="gbc-vrow gbc-shelffile"
                      data-testid="shelf-file"
                      data-path={path}
                      title={path}
                      onDoubleClick={() => unshelveSingleFile(tab.repoId, entry.id, path)}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        openContextMenu({ kind: 'shelfFile', repoId: tab.repoId, id: entry.id, path, x: e.clientX, y: e.clientY });
                      }}
                    >
                      <span className="gbc-chevron-spacer" />
                      <Icon name="file" size={14} />
                      <span className="gbc-path">{path}</span>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}