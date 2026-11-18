import { STRINGS } from '../../strings/en';
import { usePanelStore } from '../../state/StoreContext';
import { errorText, recoveryActions, recoveryLabel } from '../../state/actionRunner';
import { Icon } from '../../theme/icons/Icon';

export function ErrorBanner() {
  const error = usePanelStore((s) => s.lastError);
  const repoOrder = usePanelStore((s) => s.repoOrder);
  const runAction = usePanelStore((s) => s.runAction);
  const dismissError = usePanelStore((s) => s.dismissError);
  if (!error) {
    return null;
  }
  if (error.code === 'CONFLICT' && error.actions.includes('abortSequencer')) {
    return null; // SequencerBanner owns this case
  }
  const repoId = error.repoId ?? error.diffContext?.repoId ?? repoOrder[0];
  return (
    <div className="gbc-banner gbc-banner-error" data-testid="banner-error" role="alert" data-error-code={error.code}>
      <Icon name="warning" size={14} />
      <div className="gbc-banner-body">
        <div className="gbc-banner-text">{errorText(error)}</div>
        {error.message && <div className="gbc-banner-detail" title={error.message}>{error.message}</div>}
        <div className="gbc-banner-actions">
          {recoveryActions(error).map((action) => (
            <button
              key={action}
              type="button"
              className="gbc-btn gbc-btn-sm"
              data-testid={`error-action-${action}`}
              onClick={() => void runAction(action, error, repoId)}
            >
              {recoveryLabel(action)}
            </button>
          ))}
        </div>
      </div>
      <button type="button" className="gbc-banner-close" aria-label={STRINGS.actions.close} data-testid="error-dismiss" onClick={dismissError}>
        <Icon name="close" size={12} />
      </button>
    </div>
  );
}

export function IndexModifiedBanner() {
  const repoIds = usePanelStore((s) => s.indexModifiedRepos);
  const repos = usePanelStore((s) => s.repos);
  const dismiss = usePanelStore((s) => s.dismissIndexModified);
  const runAction = usePanelStore((s) => s.runAction);
  if (repoIds.length === 0) {
    return null;
  }
  const noopError = { code: 'GENERIC' as const, message: '', actions: [] };
  return (
    <>
      {repoIds.map((repoId) => (
        <div key={repoId} className="gbc-banner gbc-banner-warning" data-testid="banner-index-modified" role="alert">
          <Icon name="warning" size={14} />
          <span className="gbc-banner-text">
            {repos[repoId]?.repo.name ?? repoId}: {STRINGS.banners.indexModified}
          </span>
          <button
            type="button"
            className="gbc-btn gbc-btn-sm"
            data-testid="index-modified-output"
            onClick={() => void runAction('showGitOutput', noopError)}
          >
            {STRINGS.recovery.showGitOutput}
          </button>
          <button
            type="button"
            className="gbc-banner-close"
            aria-label={STRINGS.actions.close}
            data-testid="index-modified-dismiss"
            onClick={() => dismiss(repoId)}
          >
            <Icon name="close" size={12} />
          </button>
        </div>
      ))}
    </>
  );
}

export function ProtocolMismatchBanner() {
  const mismatch = usePanelStore((s) => s.protocolMismatch);
  const reloadWindow = usePanelStore((s) => s.reloadWindow);
  if (!mismatch) {
    return null;
  }
  return (
    <div className="gbc-banner gbc-banner-error" data-testid="banner-protocol" role="alert">
      <Icon name="warning" size={14} />
      <span className="gbc-banner-text">{STRINGS.banners.protocolMismatch}</span>
      <button type="button" className="gbc-btn gbc-btn-sm" data-testid="protocol-reload" onClick={() => void reloadWindow()}>
        {STRINGS.actions.reload}
      </button>
    </div>
  );
}

export function InitializingBanner() {
  const panelState = usePanelStore((s) => s.panelState);
  if (panelState !== 'initializing') {
    return null;
  }
  return (
    <div className="gbc-banner gbc-banner-progress" data-testid="banner-initializing" role="status">
      <span className="gbc-spinner" aria-hidden />
      <span className="gbc-banner-text">{STRINGS.banners.initializing}</span>
    </div>
  );
}