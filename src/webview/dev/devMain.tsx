import { createRoot } from 'react-dom/client';
import { Root } from '../App';
import { createStore } from '../state/createStore';
import { createMemoryTransport } from '../transport/memoryTransport';
import { installTheme } from '../theme/tokens';
import { STYLES } from '../theme/styles';

// Standalone dev harness: no acquireVsCodeApi, fixtures back every method.
installTheme();
const style = document.createElement('style');
style.textContent = STYLES;
document.head.appendChild(style);

const container = document.getElementById('root');
if (container) {
  const view = container.dataset.view === 'log' ? 'log' : 'commit';
  const instance = createStore(createMemoryTransport());
  createRoot(container).render(<Root instance={instance} view={view} />);
}