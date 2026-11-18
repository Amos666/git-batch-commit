import { STRINGS } from '../strings/en';
import { usePanelStore } from '../state/StoreContext';
import type { TabId } from '../state/types';

const TABS: { id: TabId; label: string }[] = [
  { id: 'commit', label: STRINGS.tabs.commit },
  { id: 'shelf', label: STRINGS.tabs.shelf },
  { id: 'stash', label: STRINGS.tabs.stash },
];

export function TabBar() {
  const activeTab = usePanelStore((s) => s.activeTab);
  const setActiveTab = usePanelStore((s) => s.setActiveTab);
  return (
    <div className="gbc-tabbar" role="tablist" data-testid="tabbar">
      {TABS.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          aria-selected={activeTab === tab.id}
          className={`gbc-tab${activeTab === tab.id ? ' gbc-tab-active' : ''}`}
          data-testid={`tab-${tab.id}`}
          onClick={() => setActiveTab(tab.id)}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}