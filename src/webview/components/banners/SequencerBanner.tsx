import { STRINGS } from '../../strings/en';
import { usePanelStore } from '../../state/StoreContext';
import { Icon } from '../../theme/icons/Icon';

/**
 * Shown when a cherry-pick/revert stopped on conflicts (host reports CONFLICT
 * with abortSequencer recovery). Continue/Skip are not offered: the host
 * sequencer only supports abort, and inert buttons are a fidelity bug.
 */
export function SequencerBanner() {
  const error = usePanelStore((s) => s.lastError);
  const requestAbortMerge = usePanelStore((s) => s.requestAbortMerge);
  const dismissError = usePanelStore((s) => s.dismissError);
  const repoOrder = usePanelStore((s) => s.repoOrder);
  if (!error || error.code !== 'CONFLICT' || !error.actions.includes('abortSequencer')) {
    return null;
  }
  const repoId = error.repoId ?? repoOrder[0];
  return (
    <div className="gbc-banner gbc-banner-warning" data-testid="banner-sequencer" role="alert">
      <Icon name="warning" size={14} />
      <span className="gbc-banner-text">{error.message}</span>
      {repoId && (
        <button type="button" className="gbc-btn gbc-btn-sm" data-testid="sequencer-abort" onClick={() => requestAbortMerge(repoId)}>
          {STRINGS.actions.abort}
        </button>
      )}
      <button type="button" className="gbc-banner-close" aria-label={STRINGS.actions.close} onClick={dismissError}>
        <Icon name="close" size={12} />
      </button>
    </div>
  );
}