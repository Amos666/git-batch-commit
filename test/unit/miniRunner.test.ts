import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MiniRunner, buildArgs, validateBranchName, validatePath } from '../../src/core/miniRunner';
import { filterPatch } from '../../src/services/patchFilter';
import type { ProtocolError } from '../../src/protocol/errors';

const tmp = path.join(process.cwd(), 'test/.tmp-mini');

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' });
}

function hashObject(cwd: string, content: string): string {
  return execFileSync('git', ['hash-object', '-w', '--stdin'], { cwd, encoding: 'utf8', input: content }).trim();
}

describe('miniRunner argument whitelist', () => {
  it('rejects invalid oids, paths and modes by construction', () => {
    expect(() => buildArgs({ cmd: 'update-index', entries: [{ mode: '100644', oid: 'xyz', path: 'a.txt' }] })).toThrow();
    expect(() => buildArgs({ cmd: 'update-index', entries: [{ mode: '100644', oid: 'a'.repeat(40), path: '../evil' }] })).toThrow();
    expect(() => buildArgs({ cmd: 'update-index', entries: [{ mode: '100644', oid: 'a'.repeat(40), path: '-rf' }] })).toThrow();
    expect(() => buildArgs({ cmd: 'update-index', entries: [{ mode: '100644', oid: 'a'.repeat(40), path: '/etc/passwd' }] })).toThrow();
    expect(() => buildArgs({ cmd: 'update-index', entries: [] })).toThrow();
    expect(() => buildArgs({ cmd: 'ls-files', path: 'a\0b' })).toThrow();
  });

  it('rejects dangerous branch names', () => {
    for (const bad of ['--force', 'a..b', 'a@{b', 'a/', '.hidden', 'a.lock', 'a b', 'a;rm', '/abs']) {
      expect(validateBranchName(bad), bad).toBe(false);
    }
    expect(validateBranchName('feature/x-1')).toBe(true);
    expect(() => buildArgs({ cmd: 'branch-rename', from: 'main', to: '--delete' })).toThrow();
  });

  it('validatePath allows unicode and spaces but not traversal', () => {
    expect(validatePath('中文 文件.txt')).toBe(true);
    expect(validatePath('dir/sub/file.ts')).toBe(true);
    expect(validatePath('a/../b')).toBe(false);
    expect(validatePath('')).toBe(false);
  });

  it('builds expected argv for each command', () => {
    const oid = 'b'.repeat(40);
    expect(buildArgs({ cmd: 'update-index', entries: [{ mode: '100755', oid, path: 'x.sh' }] })).toEqual([
      'update-index', '--add', '--cacheinfo', `100755,${oid},x.sh`,
    ]);
    expect(buildArgs({ cmd: 'ls-files', path: 'x.sh' })).toEqual(['ls-files', '-s', '-z', '--', 'x.sh']);
    expect(buildArgs({ cmd: 'stash-list' })).toEqual(['stash', 'list', '-z', '--format=%gd%x00%H%x00%s']);
    expect(buildArgs({ cmd: 'branch-rename', from: 'old', to: 'new' })).toEqual(['branch', '-m', 'old', 'new']);
    expect(buildArgs({ cmd: 'diff-worktree', path: 'x.sh' })).toEqual(['diff', '--no-ext-diff', '--no-textconv', '--', 'x.sh']);
    expect(buildArgs({ cmd: 'diff-head', paths: ['a.txt', 'dir/b.txt'] })).toEqual([
      'diff', '--binary', '--no-ext-diff', '--no-textconv', 'HEAD', '--', 'a.txt', 'dir/b.txt',
    ]);
    expect(buildArgs({ cmd: 'apply-check', patchPath: '/store/x.diff', reverse: true })).toEqual([
      'apply', '--check', '--reverse', '--', '/store/x.diff',
    ]);
    expect(buildArgs({ cmd: 'apply', patchPath: '/store/x.diff' })).toEqual(['apply', '--', '/store/x.diff']);
    expect(buildArgs({ cmd: 'restore-head', paths: ['a.txt'] })).toEqual([
      'restore', '--source=HEAD', '--staged', '--worktree', '--', 'a.txt',
    ]);
    const seqOid = 'c'.repeat(40);
    expect(buildArgs({ cmd: 'cherry-pick', oid: seqOid })).toEqual(['cherry-pick', seqOid]);
    expect(buildArgs({ cmd: 'revert', oid: seqOid })).toEqual(['revert', '--no-commit', seqOid]);
    expect(buildArgs({ cmd: 'cherry-pick-abort' })).toEqual(['cherry-pick', '--abort']);
    expect(buildArgs({ cmd: 'revert-abort' })).toEqual(['revert', '--abort']);
    expect(() => buildArgs({ cmd: 'cherry-pick', oid: 'HEAD' })).toThrow();
    expect(() => buildArgs({ cmd: 'revert', oid: '--abort' })).toThrow();
    expect(buildArgs({ cmd: 'reset-soft', oid: seqOid })).toEqual(['reset', '--soft', seqOid]);
    expect(buildArgs({ cmd: 'remote-contains', oid: seqOid })).toEqual(['branch', '-r', '--contains', seqOid, '--format=%(refname)']);
    expect(buildArgs({ cmd: 'git-dir' })).toEqual(['rev-parse', '--git-dir']);
    expect(() => buildArgs({ cmd: 'reset-soft', oid: 'HEAD~1' })).toThrow();
    expect(() => buildArgs({ cmd: 'remote-contains', oid: '--all' })).toThrow();
  });

  it('rejects invalid shelf path lists and patch paths', () => {
    expect(() => buildArgs({ cmd: 'diff-head', paths: [] })).toThrow();
    expect(() => buildArgs({ cmd: 'diff-head', paths: ['../x'] })).toThrow();
    expect(() => buildArgs({ cmd: 'restore-head', paths: ['-x'] })).toThrow();
    expect(() => buildArgs({ cmd: 'restore-head', paths: Array.from({ length: 1001 }, (_, i) => `f${i}.txt`) })).toThrow();
    expect(() => buildArgs({ cmd: 'apply', patchPath: 'relative.diff' })).toThrow();
    expect(() => buildArgs({ cmd: 'apply', patchPath: '/a/../b.diff' })).toThrow();
    expect(() => buildArgs({ cmd: 'apply-check', patchPath: '/a\0b.diff' })).toThrow();
  });
});

describe('miniRunner against real git', () => {
  const runner = new MiniRunner();

  beforeAll(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
    fs.mkdirSync(tmp, { recursive: true });
    git(tmp, 'init', '-b', 'main');
    git(tmp, 'config', 'user.email', 'mini@test.local');
    git(tmp, 'config', 'user.name', 'Mini Test');
    fs.writeFileSync(path.join(tmp, 'a.txt'), 'v1\n');
    fs.writeFileSync(path.join(tmp, '中文 文件.txt'), '你好\n');
    git(tmp, 'add', '.');
    git(tmp, 'commit', '-m', 'init');
  });

  afterAll(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('update-index --cacheinfo replaces the staged blob (hunk staging primitive)', async () => {
    const oid = hashObject(tmp, 'v1\npartial-hunk\n');
    await runner.run(tmp, { cmd: 'update-index', entries: [{ mode: '100644', oid, path: 'a.txt' }] });
    const staged = git(tmp, 'show', ':a.txt');
    expect(staged).toBe('v1\npartial-hunk\n');
    // worktree untouched
    expect(fs.readFileSync(path.join(tmp, 'a.txt'), 'utf8')).toBe('v1\n');
    const ls = await runner.run(tmp, { cmd: 'ls-files', path: 'a.txt' });
    expect(ls.stdout.toString('utf8')).toContain(oid);
  });

  it('ls-files -s -z handles unicode + space paths', async () => {
    const res = await runner.run(tmp, { cmd: 'ls-files', path: '中文 文件.txt' });
    const text = res.stdout.toString('utf8');
    expect(text).toContain('中文 文件.txt');
    expect(text.startsWith('100644 ')).toBe(true);
    expect(text.endsWith('\0')).toBe(true);
  });

  it('ls-files returns empty for untracked paths', async () => {
    fs.writeFileSync(path.join(tmp, 'new.txt'), 'x\n');
    const res = await runner.run(tmp, { cmd: 'ls-files', path: 'new.txt' });
    expect(res.stdout.length).toBe(0);
    fs.rmSync(path.join(tmp, 'new.txt'));
  });

  it('stash-list returns parseable ref/oid/subject triples', async () => {
    fs.writeFileSync(path.join(tmp, 'a.txt'), 'v1\nstash-me\n');
    git(tmp, 'stash', 'push', '-m', 'mini stash subject');
    const res = await runner.run(tmp, { cmd: 'stash-list' });
    const fields = res.stdout.toString('utf8').split('\0').filter((f) => f.length > 0);
    expect(fields.length % 3).toBe(0);
    expect(fields[0]).toBe('stash@{0}');
    expect(fields[1]).toMatch(/^[0-9a-f]{40}$/);
    expect(fields[2]).toContain('mini stash subject');
    git(tmp, 'stash', 'pop');
  });

  it('branch-rename renames a local branch', async () => {
    git(tmp, 'branch', 'mini-old');
    await runner.run(tmp, { cmd: 'branch-rename', from: 'mini-old', to: 'mini-new' });
    const branches = git(tmp, 'branch', '--list');
    expect(branches).toContain('mini-new');
    expect(branches).not.toContain('mini-old');
  });

  it('serializes concurrent runs per repo', async () => {
    const oid1 = hashObject(tmp, 'one\n');
    const oid2 = hashObject(tmp, 'two\n');
    await Promise.all([
      runner.run(tmp, { cmd: 'update-index', entries: [{ mode: '100644', oid: oid1, path: 'a.txt' }] }),
      runner.run(tmp, { cmd: 'update-index', entries: [{ mode: '100644', oid: oid2, path: 'a.txt' }] }),
    ]);
    expect(git(tmp, 'show', ':a.txt')).toBe('two\n');
  });

  it('surfaces git failures as ProtocolError without raw stderr dumps', async () => {
    await expect(runner.run(tmp, { cmd: 'branch-rename', from: 'no-such-branch', to: 'mini-x' })).rejects.toMatchObject({
      code: 'GENERIC',
    } satisfies Partial<ProtocolError>);
  });

  it('shelf primitive cycle: diff-head → reverse check → restore-head → partial/full apply', async () => {
    fs.writeFileSync(path.join(tmp, 'a.txt'), 'v1\nshelved\n');
    fs.writeFileSync(path.join(tmp, '中文 文件.txt'), '你好\nshelved\n');
    const res = await runner.run(tmp, { cmd: 'diff-head', paths: ['a.txt', '中文 文件.txt'] });
    const patch = res.stdout.toString('utf8');
    expect(patch).toContain('+shelved');
    // patches live outside the repo, like extension storage
    const shelfDir = path.join(process.cwd(), 'test/.tmp-mini-shelf');
    fs.mkdirSync(shelfDir, { recursive: true });
    const patchPath = path.join(shelfDir, 'shelf-cycle.diff');
    const partPath = path.join(shelfDir, 'shelf-cycle.part.diff');
    fs.writeFileSync(patchPath, patch);
    try {
      await runner.run(tmp, { cmd: 'apply-check', patchPath, reverse: true });
      await runner.run(tmp, { cmd: 'restore-head', paths: ['a.txt', '中文 文件.txt'] });
      expect(fs.readFileSync(path.join(tmp, 'a.txt'), 'utf8')).toBe('v1\n');
      expect(fs.readFileSync(path.join(tmp, '中文 文件.txt'), 'utf8')).toBe('你好\n');
      expect(git(tmp, 'status', '--porcelain')).toBe('');

      fs.writeFileSync(partPath, filterPatch(patch, ['a.txt']));
      await runner.run(tmp, { cmd: 'apply-check', patchPath: partPath });
      await runner.run(tmp, { cmd: 'apply', patchPath: partPath });
      expect(fs.readFileSync(path.join(tmp, 'a.txt'), 'utf8')).toBe('v1\nshelved\n');
      expect(fs.readFileSync(path.join(tmp, '中文 文件.txt'), 'utf8')).toBe('你好\n');

      await runner.run(tmp, { cmd: 'restore-head', paths: ['a.txt'] });
      await runner.run(tmp, { cmd: 'apply-check', patchPath });
      await runner.run(tmp, { cmd: 'apply', patchPath });
      expect(fs.readFileSync(path.join(tmp, 'a.txt'), 'utf8')).toBe('v1\nshelved\n');
      expect(fs.readFileSync(path.join(tmp, '中文 文件.txt'), 'utf8')).toBe('你好\nshelved\n');
    } finally {
      fs.rmSync(shelfDir, { recursive: true, force: true });
      await runner.run(tmp, { cmd: 'restore-head', paths: ['a.txt', '中文 文件.txt'] });
    }
  });

  it('apply-check rejects a patch that does not match the worktree', async () => {
    fs.writeFileSync(path.join(tmp, 'a.txt'), 'v1\n');
    const res = await runner.run(tmp, { cmd: 'diff-head', paths: ['a.txt'] });
    expect(res.stdout.length).toBe(0);
    const patchPath = path.join(tmp, 'shelf-mismatch.diff');
    fs.writeFileSync(patchPath, [
      'diff --git a/a.txt b/a.txt',
      '--- a/a.txt',
      '+++ b/a.txt',
      '@@ -1 +1,2 @@',
      ' v1',
      '+never-applied',
      '',
    ].join('\n'));
    fs.writeFileSync(path.join(tmp, 'a.txt'), 'different content\n');
    try {
      await expect(runner.run(tmp, { cmd: 'apply-check', patchPath })).rejects.toMatchObject({ code: 'GENERIC' });
      expect(fs.readFileSync(path.join(tmp, 'a.txt'), 'utf8')).toBe('different content\n');
    } finally {
      fs.rmSync(patchPath, { force: true });
      await runner.run(tmp, { cmd: 'restore-head', paths: ['a.txt'] });
    }
  });

  it('reset-soft keeps changes staged; remote-contains detects pushed commits', async () => {
    fs.writeFileSync(path.join(tmp, 'a.txt'), 'v1\nv2\n');
    git(tmp, 'add', 'a.txt');
    git(tmp, 'commit', '-m', 'second');
    const head = git(tmp, 'rev-parse', 'HEAD').trim();
    const parent = git(tmp, 'rev-parse', 'HEAD~1').trim();
    const dir = await runner.run(tmp, { cmd: 'git-dir' });
    expect(dir.stdout.toString('utf8').trim()).toBe('.git');
    const unpushed = await runner.run(tmp, { cmd: 'remote-contains', oid: head });
    expect(unpushed.stdout.toString('utf8').trim()).toBe('');
    await runner.run(tmp, { cmd: 'reset-soft', oid: parent });
    expect(git(tmp, 'rev-parse', 'HEAD').trim()).toBe(parent);
    expect(git(tmp, 'show', ':a.txt')).toBe('v1\nv2\n');
    expect(fs.readFileSync(path.join(tmp, 'a.txt'), 'utf8')).toBe('v1\nv2\n');
    // re-commit and push to a local bare remote: remote-contains must now list it
    git(tmp, 'commit', '-m', 'second again');
    const pushed = git(tmp, 'rev-parse', 'HEAD').trim();
    const bare = path.join(process.cwd(), 'test/.tmp-mini-remote.git');
    git(process.cwd(), 'init', '--bare', bare);
    git(tmp, 'remote', 'add', 'origin', bare);
    git(tmp, 'push', '-u', 'origin', 'main');
    try {
      const res = await runner.run(tmp, { cmd: 'remote-contains', oid: pushed });
      expect(res.stdout.toString('utf8')).toContain('origin/main');
    } finally {
      git(tmp, 'remote', 'remove', 'origin');
      fs.rmSync(bare, { recursive: true, force: true });
    }
  });
});