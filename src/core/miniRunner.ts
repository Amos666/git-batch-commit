import { spawn } from 'node:child_process';
import { makeError } from '../protocol/errors';
import type { ProtocolError } from '../protocol/errors';

/**
 * Route C hybrid: the built-in Git API does not expose update-index /
 * ls-files / stash list / branch rename. This runner covers exactly those
 * gaps with structured, whitelisted requests — callers never pass raw
 * argv, so shell/argument injection is impossible by construction.
 */
export type MiniRequest =
  | { cmd: 'update-index'; entries: IndexEntry[] }
  | { cmd: 'ls-files'; path: string }
  | { cmd: 'stash-list' }
  | { cmd: 'branch-rename'; from: string; to: string }
  | { cmd: 'diff-worktree'; path: string }
  | { cmd: 'diff-head'; paths: string[] }
  | { cmd: 'apply-check'; patchPath: string; reverse?: boolean }
  | { cmd: 'apply'; patchPath: string }
  | { cmd: 'restore-head'; paths: string[] }
  | { cmd: 'cherry-pick'; oid: string }
  | { cmd: 'revert'; oid: string }
  | { cmd: 'cherry-pick-abort' }
  | { cmd: 'revert-abort' }
  | { cmd: 'reset-soft'; oid: string }
  | { cmd: 'remote-contains'; oid: string }
  | { cmd: 'git-dir' };

export interface IndexEntry {
  mode: '100644' | '100755' | '120000';
  oid: string;
  /** repo-relative path */
  path: string;
}

export interface MiniResult {
  stdout: Buffer;
  stderr: string;
}

const OID_RE = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const BRANCH_RE = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/;
const TIMEOUT_MS = 30_000;
const LOCK_RETRIES = 5;
const STDERR_CAP = 8 * 1024;

export function validatePath(p: string): boolean {
  return (
    p.length > 0 &&
    p.length <= 4096 &&
    !p.startsWith('-') &&
    !p.startsWith('/') &&
    !p.includes('\0') &&
    !p.includes('\\') &&
    !p.split('/').includes('..')
  );
}

export function validateBranchName(name: string): boolean {
  return (
    BRANCH_RE.test(name) &&
    !name.includes('..') &&
    !name.includes('@{') &&
    !name.endsWith('/') &&
    !name.endsWith('.') &&
    !name.endsWith('.lock') &&
    !name.split('/').some((seg) => seg.startsWith('.') || seg.length === 0)
  );
}

export function buildArgs(req: MiniRequest): string[] {
  switch (req.cmd) {
    case 'update-index': {
      if (req.entries.length === 0 || req.entries.length > 1000) {
        throw makeError('GENERIC', 'update-index 条目数量非法');
      }
      const args = ['update-index', '--add'];
      for (const e of req.entries) {
        if (!OID_RE.test(e.oid) || !validatePath(e.path)) {
          throw makeError('GENERIC', 'update-index 参数非法');
        }
        args.push('--cacheinfo', `${e.mode},${e.oid},${e.path}`);
      }
      return args;
    }
    case 'ls-files':
      if (!validatePath(req.path)) {
        throw makeError('GENERIC', 'ls-files 路径非法');
      }
      return ['ls-files', '-s', '-z', '--', req.path];
    case 'stash-list':
      return ['stash', 'list', '-z', '--format=%gd%x00%H%x00%s'];
    case 'branch-rename':
      if (!validateBranchName(req.from) || !validateBranchName(req.to)) {
        throw makeError('GENERIC', '分支名非法');
      }
      return ['branch', '-m', req.from, req.to];
    case 'diff-worktree':
      if (!validatePath(req.path)) {
        throw makeError('GENERIC', 'diff 路径非法');
      }
      return ['diff', '--no-ext-diff', '--no-textconv', '--', req.path];
    case 'diff-head': {
      const paths = validatePaths(req.paths);
      return ['diff', '--binary', '--no-ext-diff', '--no-textconv', 'HEAD', '--', ...paths];
    }
    case 'apply-check':
      if (!validatePatchPath(req.patchPath)) {
        throw makeError('GENERIC', '补丁路径非法');
      }
      return ['apply', '--check', ...(req.reverse ? ['--reverse'] : []), '--', req.patchPath];
    case 'apply':
      if (!validatePatchPath(req.patchPath)) {
        throw makeError('GENERIC', '补丁路径非法');
      }
      return ['apply', '--', req.patchPath];
    case 'restore-head': {
      const paths = validatePaths(req.paths);
      return ['restore', '--source=HEAD', '--staged', '--worktree', '--', ...paths];
    }
    case 'cherry-pick':
      if (!OID_RE.test(req.oid)) {
        throw makeError('GENERIC', '提交 OID 非法');
      }
      return ['cherry-pick', req.oid];
    case 'revert':
      if (!OID_RE.test(req.oid)) {
        throw makeError('GENERIC', '提交 OID 非法');
      }
      return ['revert', '--no-commit', req.oid];
    case 'cherry-pick-abort':
      return ['cherry-pick', '--abort'];
    case 'revert-abort':
      return ['revert', '--abort'];
    case 'reset-soft':
      if (!OID_RE.test(req.oid)) {
        throw makeError('GENERIC', '提交 OID 非法');
      }
      return ['reset', '--soft', req.oid];
    case 'remote-contains':
      if (!OID_RE.test(req.oid)) {
        throw makeError('GENERIC', '提交 OID 非法');
      }
      return ['branch', '-r', '--contains', req.oid, '--format=%(refname)'];
    case 'git-dir':
      return ['rev-parse', '--git-dir'];
  }
}

function validatePaths(paths: string[]): string[] {
  if (paths.length === 0 || paths.length > 1000 || !paths.every(validatePath)) {
    throw makeError('GENERIC', '路径列表非法');
  }
  return paths;
}

/** Patch files live in extension storage, never user-supplied: absolute, no traversal. */
function validatePatchPath(p: string): boolean {
  return p.length > 0 && p.length <= 4096 && p.startsWith('/') && !p.includes('\0') && !p.split('/').includes('..');
}

export class MiniRunner {
  private readonly queues = new Map<string, Promise<unknown>>();

  constructor(private readonly gitPath: () => string = () => 'git') {}

  /** Serialized per repository root; index.lock contention is retried. */
  run(repoRoot: string, req: MiniRequest): Promise<MiniResult> {
    const args = buildArgs(req);
    const readOnly =
      req.cmd === 'ls-files' ||
      req.cmd === 'stash-list' ||
      req.cmd === 'diff-worktree' ||
      req.cmd === 'diff-head' ||
      req.cmd === 'apply-check' ||
      req.cmd === 'remote-contains' ||
      req.cmd === 'git-dir';
    const prev = this.queues.get(repoRoot) ?? Promise.resolve();
    const task = prev.then(() => this.execWithLockRetry(repoRoot, args, readOnly));
    this.queues.set(
      repoRoot,
      task.catch(() => {}),
    );
    return task;
  }

  private async execWithLockRetry(repoRoot: string, args: string[], readOnly: boolean): Promise<MiniResult> {
    let lastErr: ProtocolError | undefined;
    for (let attempt = 0; attempt <= LOCK_RETRIES; attempt++) {
      try {
        return await this.exec(repoRoot, args, readOnly);
      } catch (err) {
        const pe = err as ProtocolError;
        if (pe.code !== 'LOCKED' || attempt === LOCK_RETRIES) {
          throw pe;
        }
        lastErr = pe;
        await sleep(100 * 2 ** attempt);
      }
    }
    throw lastErr ?? makeError('LOCKED', '仓库被锁定');
  }

  private exec(repoRoot: string, args: string[], readOnly: boolean): Promise<MiniResult> {
    return new Promise((resolve, reject) => {
      const child = spawn(this.gitPath(), args, {
        cwd: repoRoot,
        env: {
          ...process.env,
          GIT_TERMINAL_PROMPT: '0',
          ...(readOnly ? { GIT_OPTIONAL_LOCKS: '0' } : {}),
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      const stdout: Buffer[] = [];
      let stderr = '';
      let settled = false;
      const timer = setTimeout(() => {
        child.kill('SIGTERM');
        finish(makeError('GENERIC', `git ${args[0]} 超时`));
      }, TIMEOUT_MS);
      const finish = (err?: ProtocolError, result?: MiniResult) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        if (err) {
          reject(err);
        } else {
          resolve(result as MiniResult);
        }
      };
      child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
      child.stderr.on('data', (chunk: Buffer) => {
        if (stderr.length < STDERR_CAP) {
          stderr += chunk.toString('utf8');
        }
      });
      child.on('error', (err) => {
        finish(makeError('GIT_NOT_FOUND', `无法执行 git: ${err.message}`));
      });
      child.on('close', (code) => {
        if (code === 0) {
          finish(undefined, { stdout: Buffer.concat(stdout), stderr });
          return;
        }
        if (/index\.lock|unable to create.*lock|file exists/i.test(stderr)) {
          finish(makeError('LOCKED', '仓库索引被其他 Git 进程锁定', ['retry']));
          return;
        }
        const firstLine = stderr.split('\n').find((l) => l.trim().length > 0) ?? `git ${args[0]} 失败 (exit ${code})`;
        finish(makeError('GENERIC', firstLine.length > 200 ? `${firstLine.slice(0, 200)}…` : firstLine));
      });
    });
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}