import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MiniRunner } from '../../src/core/miniRunner';
import type { KernelRepo } from '../../src/kernel/types';
import type { RepoRegistry } from '../../src/adapter/repoRegistry';
import { HunkService } from '../../src/services/hunkService';

const tmp = path.join(process.cwd(), 'test/.tmp-hunkmode');

function git(...args: string[]): string {
  return execFileSync('git', args, { cwd: tmp, encoding: 'utf8' });
}

function indexMode(file: string): string {
  return git('ls-files', '-s', '--', file).split(' ')[0] ?? '';
}

describe('hunkService mode-only staging', () => {
  let hunk: HunkService;

  beforeAll(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
    fs.mkdirSync(tmp, { recursive: true });
    git('init', '-b', 'main');
    git('config', 'user.email', 't@example.com');
    git('config', 'user.name', 'T');
    // pin the Linux default: git init's probe can write false on filesystems
    // that force mode bits, which would hide the mode-only diff entirely
    git('config', 'core.fileMode', 'true');
    fs.writeFileSync(path.join(tmp, 'f.txt'), 'line1\nline2\n');
    // this storage layer forces new files to 755; pin a non-exec baseline
    fs.chmodSync(path.join(tmp, 'f.txt'), 0o644);
    git('add', 'f.txt');
    git('commit', '-m', 'base');
    const repoStub = {
      rootPath: tmp,
      state: { mergeChanges: [] },
      buffer: async (_ref: string, rel: string) => Buffer.from(git('show', `:${rel}`)),
      hashObject: async (content: Buffer) =>
        execFileSync('git', ['hash-object', '-w', '--stdin'], { cwd: tmp, input: content }).toString().trim(),
    } as unknown as KernelRepo;
    const registry = {
      get: () => repoStub,
      descriptor: () => ({ rootPath: tmp }),
    } as unknown as RepoRegistry;
    hunk = new HunkService(registry, new MiniRunner());
  });

  afterAll(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('stagePartial syncs the exec bit when the patch has no content hunks', async () => {
    fs.chmodSync(path.join(tmp, 'f.txt'), 0o755);
    expect(indexMode('f.txt')).toBe('100644');
    await hunk.stagePartial('r', 'f.txt', { hunkIds: [] });
    expect(indexMode('f.txt')).toBe('100755');
    expect(git('show', ':f.txt')).toBe('line1\nline2\n');
    // and back down again
    fs.chmodSync(path.join(tmp, 'f.txt'), 0o644);
    await hunk.stagePartial('r', 'f.txt', { hunkIds: [] });
    expect(indexMode('f.txt')).toBe('100644');
  });

  it('an empty content selection does not drag the exec bit along', async () => {
    fs.writeFileSync(path.join(tmp, 'f.txt'), 'line1\nline2\nline3\n');
    fs.chmodSync(path.join(tmp, 'f.txt'), 0o755);
    await hunk.stagePartial('r', 'f.txt', { hunkIds: [] });
    expect(indexMode('f.txt')).toBe('100644');
    expect(git('show', ':f.txt')).toBe('line1\nline2\n');
    fs.chmodSync(path.join(tmp, 'f.txt'), 0o644);
    git('checkout', '--', 'f.txt');
  });
});