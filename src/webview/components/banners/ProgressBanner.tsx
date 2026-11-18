import { STRINGS } from '../../strings/en';
import { usePanelStore } from '../../state/StoreContext';

export function ProgressBanner() {
  const operations = usePanelStore((s) => s.operations);
  const repos = usePanelStore((s) => s.repos);
  const repoOrder = usePanelStore((s) => s.repoOrder);
  const committing = usePanelStore((s) => s.committing);
  const cancelRemaining = usePanelStore((s) => s.cancelRemaining);
  const active = Object.values(operations).filter(
    (op) => op.phase === 'validating' || op.phase === 'committing' || op.phase === 'pushing',
  );
  if (active.length === 0 && !committing) {
    return null;
  }
  const op = active[0];
  const name = op ? (repos[op.repoId]?.repo.name ?? op.repoId) : '';
  const label = op
    ? op.kind === 'push'
      ? STRINGS.banners.pushing(name)
      : op.kind === 'pull'
        ? STRINGS.banners.pulling(name)
        : op.kind === 'commit' || op.kind === 'commitAndPush'
          ? STRINGS.banners.committing(name)
          : STRINGS.disabled.busy
    : STRINGS.banners.committing(name);
  return (
    <div className="gbc-banner gbc-banner-progress" data-testid="banner-progress" role="status">
      <span className="gbc-spinner" aria-hidden />
      <span className="gbc-banner-text">{label}</span>
      {committing && repoOrder.length > 1 && (
        <button type="button" className="gbc-btn gbc-btn-sm" data-testid="cancel-remaining" onClick={cancelRemaining}>
          {STRINGS.actions.cancelRemaining}
        </button>
      )}
    </div>
  );
}