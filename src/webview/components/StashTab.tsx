import { STRINGS } from '../strings/en';
import { usePanelStore } from '../state/StoreContext';
import { Icon } from '../theme/icons/Icon';
import { IconButton } from './primitives';

export function StashTab() {
  const tab = usePanelStore((s) => s.stashTab);
  const repoOrder = usePanelStore((s) => s.repoOrder);
  const repos = usePanelStore((s) => s.repos);
  const openStashTab = usePanelStore((s) => s.openStashTab);
  const reloadStash = usePanelStore((s) => s.reloadStash);
  const requestStashCreate = usePanelStore((s) => s.requestStashCreate);
  const applyStash = usePanelStore((s) => s.applyStash);
  const openContextMenu = usePanelStore((s) => s.openContextMenu);

  if (!tab) {
    return <div className="gbc-empty">{STRINGS.groups.noRepos}</div>;
  }
  return (
    <div className="gbc-tabbody" data-testid="stash-tab">
      <div className="gbc-tabtoolbar">
        {repoOrder.length > 1 && (
          <select
            className="gbc-input gbc-select gbc-reposelect"
            data-testid="stash-repo"
            aria-label={STRINGS.stash.selectRepo}
            value={tab.repoId}
            onChange={(e) => void openStashTab(e.target.value)}
          >
            {repoOrder.map((id) => (
              <option key={id} value={id}>
                {repos[id]?.repo.name ?? id}
              </option>
            ))}
          </select>
        )}
        <IconButton icon="refresh" label={STRINGS.toolbar.refresh} testId="stash-refresh" onClick={() => void reloadStash()} />
        <IconButton icon="add" label={STRINGS.actions.createStash} testId="stash-create" onClick={() => requestStashCreate(tab.repoId)} />
        {tab.busy && <span className="gbc-spinner" aria-hidden />}
      </div>
      {tab.error && (
        <div className="gbc-dialog-error" role="alert" data-testid="stash-error">
          {tab.error}
        </div>
      )}
      {tab.entries.length === 0 && !tab.busy ? (
        <div className="gbc-empty">{STRINGS.stash.empty}</div>
      ) : (
        <ul className="gbc-stashlist" data-testid="stash-list">
          {tab.entries.map((entry) => (
            <li
              key={entry.hash}
              className="gbc-vrow gbc-stashrow"
              data-testid="stash-entry"
              data-index={entry.index}
              title={entry.description}
              onDoubleClick={() => void applyStash(tab.repoId, entry.index)}
              onContextMenu={(e) => {
                e.preventDefault();
                openContextMenu({ kind: 'stashEntry', repoId: tab.repoId, index: entry.index, x: e.clientX, y: e.clientY });
              }}
            >
              <Icon name="stash" size={14} />
              <span className="gbc-stashdesc">{entry.description}</span>
              <span className="gbc-shelfmeta">
                {STRINGS.stash.onBranch(entry.branchName)}
                {entry.date ? ` · ${new Date(entry.date).toLocaleString()}` : ''}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}