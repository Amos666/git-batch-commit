import * as crypto from 'node:crypto';
import * as vscode from 'vscode';
import { MessageGateway } from './messageGateway';

export class CommitViewProvider implements vscode.WebviewViewProvider {
  static readonly viewType = 'gitBatchCommit.commitPanel';
  static readonly logViewType = 'gitBatchCommit.logPanel';

  private viewRef: vscode.WebviewView | undefined;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly wireBackend: (gateway: MessageGateway) => vscode.Disposable,
    private readonly log: (line: string) => void = () => {},
    private readonly view: 'commit' | 'log' = 'commit',
  ) {}

  resolveWebviewView(view: vscode.WebviewView): void {
    this.viewRef = view;
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'dist')],
    };
    const gateway = new MessageGateway((msg) => view.webview.postMessage(msg), this.log);
    const backend = this.wireBackend(gateway);
    view.webview.html = this.renderHtml(view.webview);
    const receiver = view.webview.onDidReceiveMessage((msg) => void gateway.handle(msg));
    const disposables = [receiver];
    if (this.view === 'commit') {
      const syncVisible = (): void => {
        void vscode.commands.executeCommand('setContext', 'gitBatchCommit.panelVisible', view.visible);
      };
      syncVisible();
      disposables.push(view.onDidChangeVisibility(syncVisible));
    }
    view.onDidDispose(() => {
      disposables.forEach((d) => d.dispose());
      backend.dispose();
      gateway.dispose();
      this.viewRef = undefined;
    });
  }

  focusView(): void {
    this.viewRef?.show();
  }

  private renderHtml(webview: vscode.Webview): string {
    const nonce = crypto.randomBytes(16).toString('hex');
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview.js'));
    const csp = [
      `default-src 'none'`,
      `style-src ${webview.cspSource} 'unsafe-inline'`,
      `script-src 'nonce-${nonce}'`,
      `font-src ${webview.cspSource}`,
      `img-src ${webview.cspSource} data:`,
    ].join('; ');
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
  html, body { margin: 0; padding: 0; height: 100%; }
  body { font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); color: var(--vscode-foreground); background: var(--vscode-sideBar-background); }
  #root { height: 100%; }
</style>
</head>
<body>
<div id="root" data-view="${this.view}"></div>
<script nonce="${nonce}" src="${scriptUri.toString()}"></script>
</body>
</html>`;
  }
}