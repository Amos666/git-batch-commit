import { STRINGS } from '../../strings/en';
import { usePanelStore } from '../../state/StoreContext';
import { Checkbox } from '../primitives';

export function AmendRow() {
  const amend = usePanelStore((s) => s.amend);
  const setAmend = usePanelStore((s) => s.setAmend);
  const repoOrder = usePanelStore((s) => s.repoOrder);
  const repos = usePanelStore((s) => s.repos);
  const hasHead = repoOrder.some((id) => repos[id]?.branch.oid);
  return (
    <label className="gbc-amend" title={STRINGS.message.amendTooltip}>
      <Checkbox
        checked={amend}
        disabled={!hasHead}
        onChange={(target) => void setAmend(target)}
        label={STRINGS.message.amend}
        testId="amend-check"
      />
      <span className="gbc-amend-label">{STRINGS.message.amend}</span>
    </label>
  );
}