import { STRINGS } from '../strings/en';
import { usePanelStore } from '../state/StoreContext';
import { commitDisabledReason } from '../state/slices/commit';

export function CommitActions() {
  const s = usePanelStore((state) => state);
  const reasonKey = commitDisabledReason(s);
  const reason = reasonKey ? STRINGS.disabled[reasonKey as keyof typeof STRINGS.disabled] : null;
  const busy = s.committing || s.checksRunning.length > 0;
  const disabled = reasonKey !== null || busy;
  return (
    <div className="gbc-commit-actions" data-testid="commit-actions-row">
      <button
        type="button"
        className="gbc-btn gbc-btn-primary"
        data-testid="commit-button"
        disabled={disabled}
        title={reasonKey !== null && reason ? reason : undefined}
        onClick={() => void s.commit()}
      >
        {busy ? <span className="gbc-spinner" aria-hidden /> : null}
        {STRINGS.actions.commit}
      </button>
      <button
        type="button"
        className="gbc-btn"
        data-testid="commit-push-button"
        disabled={disabled}
        title={reasonKey !== null && reason ? reason : undefined}
        onClick={() => void s.commit({ pushAfter: true })}
      >
        {STRINGS.actions.commitAndPush}
      </button>
      {reason && (
        <span className="gbc-disabled-reason" data-testid="commit-disabled-reason">
          {reason}
        </span>
      )}
    </div>
  );
}