import { createRoot } from 'react-dom/client';
import { App } from './App';
import { STYLES } from './styles';

const style = document.createElement('style');
style.textContent = STYLES;
document.head.appendChild(style);

const container = document.getElementById('root');
if (container) {
  createRoot(container).render(<App />);
}