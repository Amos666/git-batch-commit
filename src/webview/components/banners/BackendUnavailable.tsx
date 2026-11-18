import { STRINGS } from '../../strings/en';
import { usePanelStore } from '../../state/StoreContext';
import { Icon } from '../../theme/icons/Icon';

export function BackendUnavailable() {
  const panelState = usePanelStore((s) => s.panelState);
  const reason = usePanelStore((s) => s.unavailableReason);
  const runAction = usePanelStore((s) => s.runAction);
  const reloadWindow = usePanelStore((s) => s.reloadWindow);
  if (panelState !== 'backend-unavailable') {
    return null;
  }
  const detail = reason ? STRINGS.unavailable[reason] : STRINGS.banners.backendUnavailable;
  const noopError = { code: 'GENERIC' as const, message: '', actions: [] };
  return (
    <div className="gbc-banner gbc-banner-error gbc-backend" data-testid="banner-backend" role="alert">
      <Icon name="warning" size={14} />
      <div className="gbc-banner-body">
        <div className="gbc-banner-text">{STRINGS.banners.backendUnavailable}</div>
        <div className="gbc-banner-detail">{detail}</div>
        <div className="gbc-banner-actions">
          {reason === 'extension-disabled' && (
            <button
              type="button"
              className="gbc-btn gbc-btn-sm"
              data-testid="backend-enable-git"
              onClick={() => void runAction('enableGitExtension', noopError)}
            >
              {STRINGS.recovery.enableGitExtension}
            </button>
          )}
          <button
            type="button"
            className="gbc-btn gbc-btn-sm"
            data-testid="backend-git-settings"
            onClick={() => void runAction('openGitSettings', noopError)}
          >
            {STRINGS.recovery.openGitSettings}
          </button>
          <button type="button" className="gbc-btn gbc-btn-sm" data-testid="backend-reload" onClick={() => void reloadWindow()}>
            {STRINGS.actions.reload}
          </button>
        </div>
      </div>
    </div>
  );
}