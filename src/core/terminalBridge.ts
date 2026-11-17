import * as vscode from 'vscode';
import { RepoRegistry } from '../adapter/repoRegistry';
import { makeError } from '../protocol/errors';

const ALLOWED_COMMANDS = /^(git (commit|push|pull|status|add|restore|stash)( [a-zA-Z0-9._/-]+)*)$/;

export class TerminalBridge {
  constructor(private readonly registry: RepoRegistry) {}

  /** Writes a sanitized command into a terminal without executing it. */
  async retryInTerminal(repoId: string, command: string): Promise<void> {
    const desc = this.registry.descriptor(repoId);
    if (!desc) {
      throw makeError('NO_REPOSITORY', `仓库不存在: ${repoId}`);
    }
    if (!ALLOWED_COMMANDS.test(command)) {
      throw makeError('GENERIC', '不允许在终端执行该命令');
    }
    const terminal = vscode.window.createTerminal({ name: 'Git Batch Commit', cwd: desc.rootPath });
    terminal.show();
    terminal.sendText(command, false);
  }
}