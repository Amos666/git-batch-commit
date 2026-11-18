import { STRINGS } from '../../strings/en';
import { usePanelStore } from '../../state/StoreContext';
import { IconButton } from '../primitives';
import { AmendRow } from './AmendRow';
import { HistoryDropdown } from './HistoryDropdown';

export function MessageEditor() {
  const message = usePanelStore((s) => s.message);
  const setMessage = usePanelStore((s) => s.setMessage);
  const toggleHistory = usePanelStore((s) => s.toggleHistory);
  const toggleOptions = usePanelStore((s) => s.toggleOptions);
  const optionsOpen = usePanelStore((s) => s.optionsOpen);
  return (
    <div className="gbc-message" data-testid="message-area">
      <textarea
        className="gbc-message-input"
        data-testid="commit-message"
        placeholder={STRINGS.message.placeholder}
        value={message}
        spellCheck={false}
        onChange={(e) => setMessage(e.target.value)}
      />
      <div className="gbc-message-footer">
        <AmendRow />
        <span className="gbc-message-hint">{STRINGS.message.ctrlEnterHint}</span>
        <IconButton
          icon="gear"
          label={STRINGS.options.toggle}
          testId="message-options"
          active={optionsOpen}
          onClick={toggleOptions}
        />
        <IconButton icon="history" label={STRINGS.message.history} testId="message-history" onClick={() => void toggleHistory()} />
      </div>
      <HistoryDropdown />
    </div>
  );
}