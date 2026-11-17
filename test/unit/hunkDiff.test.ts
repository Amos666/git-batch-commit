import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyHunks, isBinaryPatch, parseHunks, splitLines, syntheticAddHunk } from '../../src/core/hunkDiff';

const tmp = path.join(process.cwd(), 'test/.tmp-hunk');

function git(...args: string[]): string {
  return execFileSync('git', args, { cwd: tmp, encoding: 'utf8' });
}

function write(name: string, content: string): void {
  fs.writeFileSync(path.join(tmp, name), content);
}

function read(name: string): string {
  return fs.readFileSync(path.join(tmp, name), 'utf8');
}

describe('splitLines', () => {
  it('tracks trailing newline', () => {
    expect(splitLines('')).toEqual({ lines: [], finalNewline: false });
    expect(splitLines('a\nb\n')).toEqual({ lines: ['a', 'b'], finalNewline: true });
    expect(splitLines('a\nb')).toEqual({ lines: ['a', 'b'], finalNewline: false });
    expect(splitLines('\n')).toEqual({ lines: [''], finalNewline: true });
  });
});

describe('parseHunks + applyHunks on hand-built patches', () => {
  const base = 'l1\nl2\nl3\nl4\nl5\nl6\nl7\nl8\n';
  const patch = [
    'diff --git a/f.txt b/f.txt',
    'index 1111111..2222222 100644',
    '--- a/f.txt',
    '+++ b/f.txt',
    '@@ -1,3 +1,4 @@',
    ' l1',
    '-l2',
    '+l2-changed',
    '+inserted',
    ' l3',
    '@@ -6,3 +7,3 @@',
    ' l6',
    '-l7',
    '+l7-changed',
    ' l8',
    '',
  ].join('\n');

  it('parses headers and bodies', () => {
    const hunks = parseHunks(patch);
    expect(hunks.length).toBe(2);
    expect(hunks[0]).toMatchObject({ id: 0, oldStart: 1, oldLines: 3, newStart: 1, newLines: 4 });
    expect(hunks[1]).toMatchObject({ id: 1, oldStart: 6, oldLines: 3 });
    expect(hunks[0]?.lines).toEqual([' l1', '-l2', '+l2-changed', '+inserted', ' l3']);
  });

  it('no selection returns base untouched', () => {
    expect(applyHunks(base, parseHunks(patch), new Set())).toBe(base);
  });

  it('first hunk only', () => {
    expect(applyHunks(base, parseHunks(patch), new Set([0]))).toBe('l1\nl2-changed\ninserted\nl3\nl4\nl5\nl6\nl7\nl8\n');
  });

  it('second hunk only', () => {
    expect(applyHunks(base, parseHunks(patch), new Set([1]))).toBe('l1\nl2\nl3\nl4\nl5\nl6\nl7-changed\nl8\n');
  });

  it('all hunks equals full worktree content', () => {
    expect(applyHunks(base, parseHunks(patch), new Set([0, 1]))).toBe(
      'l1\nl2-changed\ninserted\nl3\nl4\nl5\nl6\nl7-changed\nl8\n',
    );
  });

  it('detects base drift (context mismatch)', () => {
    const drifted = base.replace('l6', 'l6-external');
    expect(() => applyHunks(drifted, parseHunks(patch), new Set([1]))).toThrowError(
      expect.objectContaining({ code: 'HUNK_CONFLICT' }),
    );
  });

  it('handles no-newline-at-eof on both sides', () => {
    const p = ['@@ -1,2 +1,2 @@', ' a', '-b', '\\ No newline at end of file', '+B', '\\ No newline at end of file'].join('\n');
    expect(applyHunks('a\nb', parseHunks(p), new Set([0]))).toBe('a\nB');
    const p2 = ['@@ -1,2 +1,2 @@', ' a', '-b', '\\ No newline at end of file', '+B'].join('\n');
    expect(applyHunks('a\nb', parseHunks(p2), new Set([0]))).toBe('a\nB\n');
    const p3 = ['@@ -1,2 +1,2 @@', ' a', '-b', '+B', '\\ No newline at end of file'].join('\n');
    expect(applyHunks('a\nb\n', parseHunks(p3), new Set([0]))).toBe('a\nB');
  });

  it('unselected eof hunk preserves base lack of newline', () => {
    const p = ['@@ -1,2 +1,2 @@', ' a', '-b', '+B'].join('\n');
    expect(applyHunks('a\nb', parseHunks(p), new Set())).toBe('a\nb');
  });
});

describe('real git diffs round-trip', () => {
  beforeAll(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
    fs.mkdirSync(tmp, { recursive: true });
    git('init', '-b', 'main');
    git('config', 'user.email', 'hunk@test.local');
    git('config', 'user.name', 'Hunk Test');
  });

  afterAll(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('selecting all hunks reproduces the worktree file exactly', () => {
    const original = Array.from({ length: 40 }, (_, i) => `line ${i + 1}`).join('\n') + '\n';
    write('f.txt', original);
    git('add', 'f.txt');
    git('commit', '-m', 'init');
    const modified = original
      .replace('line 3', 'line 3 changed\nline 3.5 inserted')
      .replace('line 20', 'line 20 changed')
      .replace('line 39', 'line 39 changed');
    write('f.txt', modified);
    const patch = git('diff', '--', 'f.txt');
    const hunks = parseHunks(patch);
    expect(hunks.length).toBe(3);
    const all = new Set(hunks.map((h) => h.id));
    expect(applyHunks(original, hunks, all)).toBe(modified);
    // each single hunk applied alone matches git apply of that hunk
    for (const h of hunks) {
      const partial = applyHunks(original, hunks, new Set([h.id]));
      expect(partial).not.toBe(original);
      expect(partial).not.toBe(modified);
    }
  });

  it('partial staging matches git apply --cached semantics', () => {
    const original = git('show', 'HEAD:f.txt');
    const worktree = fs.readFileSync(path.join(tmp, 'f.txt'), 'utf8');
    const patch = git('diff', '--', 'f.txt');
    const hunks = parseHunks(patch);
    const firstOnly = new Set([0]);
    const rebuilt = applyHunks(original, hunks, firstOnly);
    // cross-check with real git: apply only the first hunk to a copy of the base
    const firstHunkPatch = (
      patch.slice(0, patch.indexOf('@@')) + (hunks[0]?.header ?? '') + '\n' + (hunks[0]?.lines ?? []).join('\n') + '\n'
    )
      .replaceAll('a/f.txt', 'a/check.txt')
      .replaceAll('b/f.txt', 'b/check.txt');
    fs.writeFileSync(path.join(tmp, 'check.txt'), original);
    execFileSync('git', ['apply', '--unsafe-paths', '-'], { cwd: tmp, input: firstHunkPatch.replace('a/f.txt', 'a/check.txt').replace('b/f.txt', 'b/check.txt') });
    expect(rebuilt).toBe(read('check.txt'));
    fs.rmSync(path.join(tmp, 'check.txt'));
    expect(worktree).not.toBe(rebuilt);
  });

  it('deletion-only and addition-only files', () => {
    write('del.txt', 'a\nb\nc\n');
    git('add', 'del.txt');
    git('commit', '-m', 'add del');
    write('del.txt', 'a\nc\n');
    const patch = git('diff', '--', 'del.txt');
    const hunks = parseHunks(patch);
    expect(applyHunks('a\nb\nc\n', hunks, new Set([0]))).toBe('a\nc\n');

    write('add.txt', 'new1\nnew2');
    const content = read('add.txt');
    const hunk = syntheticAddHunk(content);
    expect(applyHunks('', [hunk], new Set([0]))).toBe(content);
    expect(applyHunks('', [hunk], new Set())).toBe('');
  });

  it('unicode content survives round-trip', () => {
    write('uni.txt', '你好\n世界\n');
    git('add', 'uni.txt');
    git('commit', '-m', 'add uni');
    write('uni.txt', '你好\n世界 changed\n新增行\n');
    const patch = git('diff', '--', 'uni.txt');
    const hunks = parseHunks(patch);
    expect(applyHunks('你好\n世界\n', hunks, new Set(hunks.map((h) => h.id)))).toBe('你好\n世界 changed\n新增行\n');
  });

  it('binary patches are flagged', () => {
    expect(isBinaryPatch('Binary files a/x.bin and b/x.bin differ')).toBe(true);
    expect(isBinaryPatch('diff --git a/f b/f\n@@ -1 +1 @@\n-a\n+b\n')).toBe(false);
  });
});