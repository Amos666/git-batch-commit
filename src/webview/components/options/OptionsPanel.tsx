import { STRINGS } from '../../strings/en';
import { usePanelStore } from '../../state/StoreContext';
import { Checkbox, Tooltip } from '../primitives';
import { AuthorField } from './AuthorField';

/** Gear panel (Ctrl+Alt+O): author, sign-off, hooks, and the Before Commit checks. */
export function OptionsPanel() {
  const optionsOpen = usePanelStore((s) => s.optionsOpen);
  const signoff = usePanelStore((s) => s.optionsState.signoff);
  const runHooks = usePanelStore((s) => s.optionsState.runHooks);
  const checks = usePanelStore((s) => s.optionsState.checks);
  const runAfterCommit = usePanelStore((s) => s.optionsState.runAfterCommit);
  const availability = usePanelStore((s) => s.checksAvailability);
  const setOptions = usePanelStore((s) => s.setOptions);
  if (!optionsOpen) {
    return null;
  }
  return (
    <div className="gbc-options" data-testid="options-panel" aria-label={STRINGS.options.title}>
      <AuthorField />
      <label className="gbc-option-row gbc-option-check">
        <Checkbox
          checked={signoff}
          onChange={(target) => void setOptions({ signoff: target })}
          label={STRINGS.options.signoff}
          testId="option-signoff"
        />
        <span className="gbc-option-label">{STRINGS.options.signoff}</span>
      </label>
      <label className="gbc-option-row gbc-option-check">
        <Checkbox
          checked={runHooks}
          onChange={(target) => void setOptions({ runHooks: target })}
          label={STRINGS.options.runHooks}
          testId="option-runhooks"
        />
        <span className="gbc-option-label">{STRINGS.options.runHooks}</span>
      </label>
      <div className="gbc-options-section" data-testid="checks-section">
        <div className="gbc-options-header">{STRINGS.options.checks}</div>
        {availability.map((c) => (
          <label
            key={c.id}
            className={`gbc-option-row gbc-option-check${c.available ? '' : ' gbc-option-disabled'}`}
          >
            <Checkbox
              checked={checks[c.id] ?? false}
              disabled={!c.available}
              onChange={(target) => void setOptions({ checks: { [c.id]: target } })}
              label={STRINGS.checks[c.id]}
              testId={`option-check-${c.id}`}
            />
            <span className="gbc-option-label">{STRINGS.checks[c.id]}</span>
            {!c.available && (
              <Tooltip text={STRINGS.options.unavailable}>
                <span className="gbc-checkbadge gbc-checkbadge-unavailable" data-testid={`check-unavailable-${c.id}`}>
                  {STRINGS.options.unavailable}
                </span>
              </Tooltip>
            )}
            {c.available && c.limited && (
              <span className="gbc-checkbadge" data-testid={`check-limited-${c.id}`}>
                {STRINGS.options.limited}
              </span>
            )}
          </label>
        ))}
        <label className="gbc-option-row gbc-option-check">
          <Checkbox
            checked={runAfterCommit}
            onChange={(target) => void setOptions({ runAfterCommit: target })}
            label={STRINGS.options.runAfterCommit}
            testId="option-runaftercommit"
          />
          <span className="gbc-option-label">{STRINGS.options.runAfterCommit}</span>
        </label>
        <div className="gbc-option-hint">{STRINGS.options.checksDisabledHint}</div>
      </div>
    </div>
  );
}