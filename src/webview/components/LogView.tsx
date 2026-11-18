import { STRINGS } from '../strings/en';
import { usePanelStore } from '../state/StoreContext';
import { Icon } from '../theme/icons/Icon';
import { IconButton } from './primitives';

const L = STRINGS.log;

/** Standalone Log view (Alt+9); same store, rendered by the log webview entry. */
export function LogView() {
  const view = usePanelStore((s) => s.logView);
  const repoOrder = usePanelStore((s) => s.repoOrder);
  const repos = usePanelStore((s) => s.repos);
  const openLogView = usePanelStore((s) => s.openLogView);
  const setLogField = usePanelStore((s) => s.setLogField);
  const reloadLog = usePanelStore((s) => s.reloadLog);
  const loadMoreLog = usePanelStore((s) => s.loadMoreLog);
  const requestLogAction = usePanelStore((s) => s.requestLogAction);
  const requestUndoCommit = usePanelStore((s) => s.requestUndoCommit);
  const cancelLogAction = usePanelStore((s) => s.cancelLogAction);
  const confirmLogAction = usePanelStore((s) => s.confirmLogAction);
  const showCommit = usePanelStore((s) => s.showCommit);

  if (!view) {
    return <div className="gbc-empty">{STRINGS.groups.noRepos}</div>;
  }
  return (
    <div className="gbc-logview" data-testid="log-view">
      <div className="gbc-tabtoolbar gbc-logtoolbar">
        {repoOrder.length > 1 && (
          <select
            className="gbc-input gbc-select gbc-reposelect"
            data-testid="log-repo"
            value={view.repoId}
            onChange={(e) => void openLogView(e.target.value)}
          >
            {repoOrder.map((id) => (
              <option key={id} value={id}>
                {repos[id]?.repo.name ?? id}
              </option>
            ))}
          </select>
        )}
        <input
          type="text"
          className="gbc-input gbc-logfilter"
          data-testid="log-author"
          placeholder={L.author}
          value={view.author}
          onChange={(e) => setLogField('author', e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              void reloadLog();
            }
          }}
        />
        <input
          type="text"
          className="gbc-input gbc-logfilter"
          data-testid="log-grep"
          placeholder={L.grep}
          value={view.grep}
          onChange={(e) => setLogField('grep', e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              void reloadLog();
            }
          }}
        />
        <IconButton icon="search" label={L.search} testId="log-search" onClick={() => void reloadLog()} />
        <IconButton icon="refresh" label={STRINGS.toolbar.refresh} testId="log-refresh" onClick={() => void reloadLog()} />
        {view.busy && <span className="gbc-spinner" aria-hidden />}
      </div>
      {view.error && (
        <div className="gbc-dialog-error" role="alert" data-testid="log-error">
          {view.error}
        </div>
      )}
      {view.confirm && (
        <div className="gbc-banner gbc-banner-warning" data-testid="log-confirm" role="alert">
          <Icon name="warning" size={14} />
          <span className="gbc-banner-text">
            {view.confirm.kind === 'cherry-pick'
              ? L.cherryPickConfirm(view.confirm.oid.slice(0, 7))
              : L.revertConfirm(view.confirm.oid.slice(0, 7))}
          </span>
          <button type="button" className="gbc-btn gbc-btn-sm" data-testid="log-confirm-ok" onClick={() => void confirmLogAction()}>
            {STRINGS.actions.ok}
          </button>
          <button type="button" className="gbc-btn gbc-btn-sm" data-testid="log-confirm-cancel" onClick={cancelLogAction}>
            {STRINGS.actions.cancel}
          </button>
        </div>
      )}
      {view.entries.length === 0 && !view.busy ? (
        <div className="gbc-empty">{L.empty}</div>
      ) : (
        <ul className="gbc-loglist" data-testid="log-list">
          {view.entries.map((entry, i) => (
            <li key={entry.hash} className="gbc-logentry" data-testid="log-entry" data-oid={entry.hash}>
              <button
                type="button"
                className="gbc-loghash"
                title={L.showCommit}
                onClick={() => void showCommit(view.repoId, entry.hash)}
              >
                {entry.hash.slice(0, 7)}
              </button>
              <span className="gbc-logmessage" title={entry.message}>
                {entry.message.split('\n')[0]}
              </span>
              <span className="gbc-logmeta">
                {entry.authorName ?? ''}
                {entry.authorDate ? ` · ${new Date(entry.authorDate).toLocaleDateString()}` : ''}
              </span>
              <span className="gbc-logactions">
                {i === 0 && (
                  <button
                    type="button"
                    className="gbc-btn gbc-btn-sm"
                    data-testid="log-undo"
                    onClick={() => requestUndoCommit(view.repoId)}
                  >
                    {STRINGS.actions.undoCommit}
                  </button>
                )}
                <button
                  type="button"
                  className="gbc-btn gbc-btn-sm"
                  data-testid="log-cherrypick"
                  onClick={() => requestLogAction('cherry-pick', entry.hash)}
                >
                  {L.cherryPick}
                </button>
                <button
                  type="button"
                  className="gbc-btn gbc-btn-sm"
                  data-testid="log-revert"
                  onClick={() => requestLogAction('revert', entry.hash)}
                >
                  {L.revert}
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
      {view.hasMore && (
        <button type="button" className="gbc-btn gbc-loadmore" data-testid="log-loadmore" disabled={view.busy} onClick={() => void loadMoreLog()}>
          {L.loadMore}
        </button>
      )}
    </div>
  );
}