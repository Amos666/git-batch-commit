import { STRINGS } from '../strings/en';
import { usePanelStore } from '../state/StoreContext';
import { Icon } from '../theme/icons/Icon';

export function BranchWidget({ repoId }: { repoId: string }) {
  const branch = usePanelStore((s) => s.repos[repoId]?.branch);
  const openBranchPicker = usePanelStore((s) => s.openBranchPicker);
  if (!branch) {
    return null;
  }
  const label = branch.detached
    ? STRINGS.branch.detached(branch.oid?.slice(0, 7) ?? '')
    : (branch.name ?? STRINGS.branch.noBranch);
  return (
    <button
      type="button"
      className="gbc-branchwidget"
      data-testid="branch-widget"
      data-repo={repoId}
      title={branch.upstream ?? STRINGS.branch.noUpstream}
      onClick={() => void openBranchPicker(repoId)}
    >
      <Icon name="branch" size={12} />
      <span className="gbc-branchwidget-name">{label}</span>
      {branch.ahead !== undefined && branch.ahead > 0 && <span className="gbc-ahead">↑{branch.ahead}</span>}
      {branch.behind !== undefined && branch.behind > 0 && <span className="gbc-behind">↓{branch.behind}</span>}
      <Icon name="chevronDown" size={10} />
    </button>
  );
}