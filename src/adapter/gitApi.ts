import * as vscode from 'vscode';
import type { UnavailableReason } from '../protocol/models';
import type { GitApi, GitExtensionExports } from './gitApiTypes';

export class GitApiUnavailableError extends Error {
  constructor(readonly reason: UnavailableReason, message: string) {
    super(message);
    this.name = 'GitApiUnavailableError';
  }
}

const INIT_TIMEOUT_MS = 30_000;

export async function acquireGitApi(): Promise<GitApi> {
  const ext = vscode.extensions.getExtension<GitExtensionExports>('vscode.git');
  if (!ext) {
    throw new GitApiUnavailableError('extension-disabled', 'Built-in Git extension is not installed');
  }
  const exports = ext.isActive ? ext.exports : await ext.activate();
  if (!exports || typeof exports.getAPI !== 'function') {
    throw new GitApiUnavailableError('extension-disabled', 'Built-in Git extension did not export its API');
  }
  const api = exports.getAPI(1);
  if (api.state === 'initialized') {
    return api;
  }
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      sub.dispose();
      reject(new GitApiUnavailableError('init-timeout', 'Timed out waiting for the built-in Git extension to initialize'));
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