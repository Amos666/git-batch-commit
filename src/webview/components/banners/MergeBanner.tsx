import { STRINGS } from '../../strings/en';
import { usePanelStore } from '../../state/StoreContext';
import { Icon } from '../../theme/icons/Icon';

export function MergeBanner() {
  const repos = usePanelStore((s) => s.repos);
  const repoOrder = usePanelStore((s) => s.repoOrder);
  const openMergeEditor = usePanelStore((s) => s.openMergeEditor);
  const conflicted = repoOrder
    .map((id) => ({ id, files: repos[id]?.changes.filter((c) => c.conflicted) ?? [] }))
    .filter((r) => r.files.length > 0);
  if (conflicted.length === 0) {
    return null;
  }
  const total = conflicted.reduce((n, r) => n + r.files.length, 0);
  const first = conflicted[0];
  const firstFile = first?.files[0];
  return (
    <div className="gbc-banner gbc-banner-error" data-testid="banner-merge" role="alert">
      <Icon name="warning" size={14} />
      <span className="gbc-banner-text">{STRINGS.banners.mergeConflicts(total)}</span>
      {first && firstFile && (
        <button
          type="button"
          className="gbc-btn gbc-btn-sm"
          data-testid="merge-resolve"
          onClick={() => void openMergeEditor(first.id, firstFile.path)}
        >
          {STRINGS.menus.file.resolve}
        </button>
      )}
    </div>
  );
}