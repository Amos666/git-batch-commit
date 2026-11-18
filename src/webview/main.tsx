import { createRoot } from 'react-dom/client';
import { Root } from './App';
import { createStore } from './state/createStore';
import { createVscodeTransport } from './transport/vscodeTransport';
import { installTheme } from './theme/tokens';
import { STYLES } from './theme/styles';

installTheme();
const style = document.createElement('style');
style.textContent = STYLES;
document.head.appendChild(style);

const container = document.getElementById('root');
if (container) {
  const view = container.dataset.view === 'log' ? 'log' : 'commit';
  const instance = createStore(createVscodeTransport());
  createRoot(container).render(<Root instance={instance} view={view} />);
}