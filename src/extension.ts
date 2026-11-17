import * as vscode from 'vscode';
import { Backend } from './ui/backend';
import { CommitViewProvider } from './ui/commitViewProvider';

export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel('Git Batch Commit');
  const backend = new Backend(output, context);
  backend.setExtensionVersion(String(context.extension.packageJSON.version ?? '0.0.1'));
  context.subscriptions.push(output, backend);

  const provider = new CommitViewProvider(
    context.extensionUri,
    (gateway) => backend.attach(gateway),
    (line) => {
      output.appendLine(line);
      backend.diagnostics.record(line);
    },
  );
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(CommitViewProvider.viewType, provider, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('gitBatchCommit.refresh', () => backend.refresh()),
    vscode.commands.registerCommand('gitBatchCommit.commit', () => backend.requestCommit()),
    vscode.commands.registerCommand('gitBatchCommit.showGitOutput', () =>
      vscode.commands.executeCommand('git.showOutput'),
    ),
    vscode.commands.registerCommand('gitBatchCommit.copyDiagnostics', () => backend.copyDiagnostics()),
  );

  void backend.init();
}

export function deactivate(): void {}