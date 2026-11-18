import { useEffect, useRef } from 'react';
import { STRINGS } from '../../strings/en';
import { usePanelStore } from '../../state/StoreContext';

export function HistoryDropdown() {
  const historyOpen = usePanelStore((s) => s.historyOpen);
  const history = usePanelStore((s) => s.history);
  const pickHistory = usePanelStore((s) => s.pickHistory);
  const toggleHistory = usePanelStore((s) => s.toggleHistory);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!historyOpen) {
      return;
    }
    const onDown = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        void toggleHistory();
      }
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        void toggleHistory();
      }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [historyOpen, toggleHistory]);

  if (!historyOpen) {
    return null;
  }
  return (
    <div className="gbc-menu gbc-history" ref={ref} role="menu" data-testid="history-dropdown" aria-label={STRINGS.message.history}>
      <div className="gbc-menu-header">{STRINGS.message.history}</div>
      {history === null || history.length === 0 ? (
        <div className="gbc-menu-empty">{STRINGS.message.historyEmpty}</div>
      ) : (
        history.map((entry, i) => (
          <button
            key={`${i}-${entry.slice(0, 24)}`}
            type="button"
            role="menuitem"
            className="gbc-menu-item gbc-history-item"
            data-testid={`history-item-${i}`}
            title={entry}
            onClick={() => pickHistory(entry)}
          >
            {entry.split('\n')[0]}
          </button>
        ))
      )}
    </div>
  );
}