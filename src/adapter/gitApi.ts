import * as vscode from 'vscode';
import type { GitApi, GitExtensionExports } from './gitApiTypes';

export class GitApiUnavailableError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = 'GitApiUnavailableError';
  }
}

const INIT_TIMEOUT_MS = 30_000;

export async function acquireGitApi(): Promise<GitApi> {
  const ext = vscode.extensions.getExtension<GitExtensionExports>('vscode.git');
  if (!ext) {
    throw new GitApiUnavailableError('内置 Git 扩展（vscode.git）不存在');
  }
  const exports = ext.isActive ? ext.exports : await ext.activate();
  if (!exports || typeof exports.getAPI !== 'function') {
    throw new GitApiUnavailableError('内置 Git 扩展未导出 API');
  }
  const api = exports.getAPI(1);
  if (api.state === 'initialized') {
    return api;
  }
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      sub.dispose();
      reject(new GitApiUnavailableError('等待内置 Git 扩展初始化超时'));
    }, INIT_TIMEOUT_MS);
    const sub = api.onDidChangeState((state) => {
      if (state === 'initialized') {
        clearTimeout(timer);
        sub.dispose();
        resolve();
      }
    });
  });
  return api;
}