import * as crypto from 'node:crypto';
import * as path from 'node:path';
import * as vscode from 'vscode';
import type { DiffSide } from '../protocol/messages';
import type { Backend } from './backend';
import { MessageGateway } from './messageGateway';

const TITLES: Record<DiffSide, string> = {
  staged: 'HEAD ↔ Index',
  worktree: 'Index ↔ Working Tree',
  head: 'Working Tree ↔ HEAD',
};

/** Self-drawn diff viewer in the editor area (IDEA opens diffs as editor tabs). */
export class DiffViewProvider implements vscode.Disposable {
  private readonly panels = new Map<string, { panel: vscode.WebviewPanel; gateway: MessageGateway }>();

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly backend: Backend,
    private readonly log: (line: string) => void = () => {},
  ) {}

  open(repoId: string, relPath: string, side: DiffSide, force: boolean): void {
    const key = `${repoId}:${side}:${relPath}`;
    const existing = this.panels.get(key);
    if (existing) {
      existing.panel.reveal();
      existing.gateway.emit('ui.command', { command: 'refresh' });
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      'gitBatchCommit.diffView',
      `${path.basename(relPath)} (${TITLES[side]})`,
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'dist')],
      },
    );
    const gateway = new MessageGateway((msg) => panel.webview.postMessage(msg), this.log);
    const attached = this.backend.attach(gateway);
    panel.webview.html = this.renderHtml(panel.webview, repoId, relPath, side, force);
    const receiver = panel.webview.onDidReceiveMessage((msg) => void gateway.handle(msg));
    panel.onDidDispose(() => {
      receiver.dispose();
      attached.dispose();
      gateway.dispose();
      this.panels.delete(key);
    });
    this.panels.set(key, { panel, gateway });
  }

  private renderHtml(webview: vscode.Webview, repoId: string, relPath: string, side: DiffSide, force: boolean): string {
    const nonce = crypto.randomBytes(16).toString('hex');
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'dist', 'diffview.js'));
    const csp = [
      `default-src 'none'`,
      `style-src ${webview.cspSource} 'unsafe-inline'`,
      `script-src 'nonce-${nonce}'`,
      `font-src ${webview.cspSource}`,
      `img-src ${webview.cspSource} data:`,
    ].join('; ');
    const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
  html, body { margin: 0; padding: 0; height: 100%; }
  body { font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); color: var(--vscode-foreground); background: var(--vscode-editor-background); }
  #root { height: 100%; }
</style>
</head>
<body>
<div id="root" data-repo="${esc(repoId)}" data-path="${esc(relPath)}" data-side="${side}" data-force="${force}"></div>
<script nonce="${nonce}" src="${scriptUri.toString()}"></script>
</body>
</html>`;
  }

  dispose(): void {
    for (const { panel } of this.panels.values()) {
      panel.dispose();
    }
    this.panels.clear();
  }
}