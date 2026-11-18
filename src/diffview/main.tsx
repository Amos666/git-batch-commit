import { createRoot } from 'react-dom/client';
import type { DiffSide } from '../protocol/messages';
import { STYLES } from '../webview/theme/styles';
import { installTheme } from '../webview/theme/tokens';
import { createVscodeTransport } from '../webview/transport/vscodeTransport';
import { DiffViewer } from './DiffViewer';
import { DIFFVIEW_CSS } from './styles';

const rootEl = document.getElementById('root');
if (!rootEl) {
  throw new Error('diffview: missing #root');
}
installTheme();
const style = document.createElement('style');
style.textContent = STYLES + DIFFVIEW_CSS;
document.head.appendChild(style);

const transport = createVscodeTransport();
const { repo, path: relPath, side, force } = rootEl.dataset;
createRoot(rootEl).render(
  <DiffViewer
    transport={transport}
    repoId={repo ?? ''}
    relPath={relPath ?? ''}
    side={(side ?? 'head') as DiffSide}
    force={force === 'true'}
  />,
);