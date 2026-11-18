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
  const logProvider = new CommitViewProvider(
    context.extensionUri,
    (gateway) => backend.attach(gateway),
    (line) => {
      output.appendLine(line);
      backend.diagnostics.record(line);
    },
    'log',
  );
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(CommitViewProvider.viewType, provider, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
    vscode.window.registerWebviewViewProvider(CommitViewProvider.logViewType, logProvider, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('gitBatchCommit.refresh', () => backend.refresh()),
    vscode.commands.registerCommand('gitBatchCommit.commitPanel.focus', () => provider.focusView()),
    vscode.commands.registerCommand('gitBatchCommit.logPanel.focus', () => logProvider.focusView()),
    vscode.commands.registerCommand('gitBatchCommit.commit', () => backend.dispatchCommand('commit')),
    vscode.commands.registerCommand('gitBatchCommit.commitAndPush', () => backend.dispatchCommand('commitAndPush')),
    vscode.commands.registerCommand('gitBatchCommit.push', () => backend.dispatchCommand('push')),
    vscode.commands.registerCommand('gitBatchCommit.showDiff', () => backend.dispatchCommand('diff')),
    vscode.commands.registerCommand('gitBatchCommit.addToVcs', () => backend.dispatchCommand('addToVcs')),
    vscode.commands.registerCommand('gitBatchCommit.moveChangelist', () => backend.dispatchCommand('moveChangelist')),
    vscode.commands.registerCommand('gitBatchCommit.toggleOptions', () => backend.dispatchCommand('toggleOptions')),
    vscode.commands.registerCommand('gitBatchCommit.setActiveChangelist', () =>
      backend.dispatchCommand('setActiveChangelist'),
    ),
    vscode.commands.registerCommand('gitBatchCommit.rollback', () => backend.dispatchCommand('rollback')),
    vscode.commands.registerCommand('gitBatchCommit.showGitOutput', () =>
      vscode.commands.executeCommand('git.showOutput'),
    ),
    vscode.commands.registerCommand('gitBatchCommit.copyDiagnostics', () => backend.copyDiagnostics()),
  );

  void backend.init();
}

export function deactivate(): void {}