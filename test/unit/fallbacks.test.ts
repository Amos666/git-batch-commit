import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MiniRunner } from '../../src/core/miniRunner';
import { commitWithAuthor } from '../../src/kernel/fallbacks';

const tmp = path.join(process.cwd(), 'test/.tmp-fallbacks');

function git(...args: string[]): string {
  return execFileSync('git', args, { cwd: tmp, encoding: 'utf8' });
}

describe('commitWithAuthor against real git', () => {
  const mini = new MiniRunner();

  beforeAll(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
    fs.mkdirSync(tmp, { recursive: true });
    git('init', '-b', 'main');
    git('config', 'user.email', 'committer@test.local');
    git('config', 'user.name', 'Committer');
    fs.writeFileSync(path.join(tmp, 'a.txt'), 'v1\n');
    git('add', '.');
    git('commit', '-m', 'init');
  });

  afterAll(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('overrides author via env while committer stays the configured identity', async () => {
    fs.writeFileSync(path.join(tmp, 'a.txt'), 'v2\n');
    git('add', 'a.txt');
    await commitWithAuthor(tmp, 'author override commit', { author: { name: 'Override Author', email: 'override@test.local' } }, mini);
    expect(git('log', '-1', '--format=%an <%ae>').trim()).toBe('Override Author <override@test.local>');
    expect(git('log', '-1', '--format=%cn <%ce>').trim()).toBe('Committer <committer@test.local>');
    expect(git('log', '-1', '--format=%s').trim()).toBe('author override commit');
  });

  it('runs hooks by default and honors noVerify', async () => {
    const hook = path.join(tmp, '.git/hooks/pre-commit');
    fs.writeFileSync(hook, '#!/bin/sh\necho "fallback hook failure" >&2\nexit 1\n');
    fs.chmodSync(hook, 0o755);
    try {
      fs.writeFileSync(path.join(tmp, 'a.txt'), 'v3\n');
      git('add', 'a.txt');
      const headBefore = git('rev-parse', 'HEAD').trim();
      await expect(commitWithAuthor(tmp, 'hooked', {}, mini)).rejects.toMatchObject({ code: 'HOOK_FAILED' });
      expect(git('rev-parse', 'HEAD').trim()).toBe(headBefore);
      await commitWithAuthor(tmp, 'hook skipped', { noVerify: true }, mini);
      expect(git('log', '-1', '--format=%s').trim()).toBe('hook skipped');
    } finally {
      fs.rmSync(hook, { force: true });
    }
  });

  it('appends signoff trailer and supports amend', async () => {
    fs.writeFileSync(path.join(tmp, 'a.txt'), 'v4\n');
    git('add', 'a.txt');
    await commitWithAuthor(tmp, 'signoff commit', { signoff: true }, mini);
    expect(git('log', '-1', '--format=%B')).toContain('Signed-off-by: Committer <committer@test.local>');
    const oid = git('rev-parse', 'HEAD').trim();
    await commitWithAuthor(tmp, 'amended message', { amend: true }, mini);
    expect(git('log', '-1', '--format=%s').trim()).toBe('amended message');
    expect(git('rev-parse', 'HEAD').trim()).not.toBe(oid);
    expect(git('status', '--porcelain')).toBe('');
  });

  it('rejects a commit with nothing staged', async () => {
    await expect(commitWithAuthor(tmp, 'empty', {}, mini)).rejects.toMatchObject({ code: 'GENERIC' });
  });
});