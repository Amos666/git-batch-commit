import { STRINGS } from '../strings/en';
import { usePanelStore } from '../state/StoreContext';
import { commitDisabledReason } from '../state/slices/commit';
import { SplitButton } from './primitives';

export function CommitActions() {
  const s = usePanelStore((state) => state);
  const reasonKey = commitDisabledReason(s);
  const reason = reasonKey ? STRINGS.disabled[reasonKey as keyof typeof STRINGS.disabled] : null;
  return (
    <div className="gbc-commit-actions" data-testid="commit-actions-row">
      <SplitButton
        label={STRINGS.actions.commit}
        testId="commit-button"
        busy={s.committing || s.checksRunning.length > 0}
        disabled={reasonKey !== null}
        disabledReason={reason}
        onClick={() => void s.commit()}
        menu={[
          {
            label: STRINGS.actions.commitAndPush,
            disabled: reasonKey !== null,
            onClick: () => void s.commit({ pushAfter: true }),
          },
        ]}
      />
      {reason && (
        <span className="gbc-disabled-reason" data-testid="commit-disabled-reason">
          {reason}
        </span>
      )}
    </div>
  );
}