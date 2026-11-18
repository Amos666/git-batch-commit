import { describe, expect, it } from 'vitest';
import type { FileChange } from '../../src/protocol/models';
import { buildTree, collectPaths, flattenTree } from '../../src/webview/tree';

function change(path: string, staged: boolean): FileChange {
  return {
    repoId: 'r1',
    path,
    uri: `file:///repo/${path}`,
    indexStatus: staged ? 'M' : null,
    worktreeStatus: staged ? null : 'M',
    kind: 'modified',
    staged,
    conflicted: false,
  };
}

describe('buildTree', () => {
  it('groups files into directories with post-order counts', () => {
    const tree = buildTree([
      change('src/a.ts', true),
      change('src/deep/b.ts', false),
      change('src/deep/c.ts', true),
      change('README.md', false),
    ]);
    expect(tree.map((n) => n.name)).toEqual(['src', 'README.md']);
    const src = tree[0];
    expect(src?.type).toBe('dir');
    expect(src?.total).toBe(3);
    expect(src?.staged).toBe(2);
    const deep = src?.children.find((n) => n.name === 'deep');
    expect(deep?.total).toBe(2);
    expect(deep?.staged).toBe(1);
  });

  it('sorts directories before files, alphabetically', () => {
    const tree = buildTree([
      change('z.txt', false),
      change('b/x.txt', false),
      change('a.txt', false),
      change('a/y.txt', false),
    ]);
    expect(tree.map((n) => `${n.type}:${n.name}`)).toEqual(['dir:a', 'dir:b', 'file:a.txt', 'file:z.txt']);
  });

  it('handles root-level files only', () => {
    const tree = buildTree([change('a.txt', true)]);
    expect(tree).toHaveLength(1);
    expect(tree[0]?.type).toBe('file');
    expect(tree[0]?.staged).toBe(1);
  });
});

describe('flattenTree', () => {
  const changes = [change('src/a.ts', true), change('src/deep/b.ts', false), change('top.txt', false)];

  it('emits depth-first rows with depths (dirs before files)', () => {
    const rows = flattenTree(buildTree(changes), {}, 'r1:staged');
    expect(rows.map((r) => `${r.depth}:${r.node.path}`)).toEqual([
      '0:src',
      '1:src/deep',
      '2:src/deep/b.ts',
      '1:src/a.ts',
      '0:top.txt',
    ]);
  });

  it('hides children of collapsed dirs using prefixed keys', () => {
    const rows = flattenTree(buildTree(changes), { 'r1:staged:src/deep': true }, 'r1:staged');
    expect(rows.map((r) => r.node.path)).toEqual(['src', 'src/deep', 'src/a.ts', 'top.txt']);
  });

  it('does not collapse same-named dirs in another group', () => {
    const rows = flattenTree(buildTree(changes), { 'r1:changes:src/deep': true }, 'r1:staged');
    expect(rows.map((r) => r.node.path)).toContain('src/deep/b.ts');
  });
});

describe('collectPaths', () => {
  it('collects all file paths under a dir node', () => {
    const tree = buildTree([change('src/a.ts', true), change('src/deep/b.ts', false)]);
    const src = tree[0];
    expect(src && collectPaths(src)).toEqual(['src/deep/b.ts', 'src/a.ts']);
  });
});

describe('directory chain compression (IDEA compact dirs)', () => {
  it('merges single-child dir chains into one row', () => {
    const tree = buildTree([change('a/b/c/d/File.java', false)]);
    expect(tree.map((n) => `${n.type}:${n.name}:${n.path}`)).toEqual(['dir:a/b/c/d:a/b/c/d']);
    expect(tree[0]?.children.map((n) => n.name)).toEqual(['File.java']);
    expect(tree[0]?.total).toBe(1);
  });

  it('breaks the chain where a dir holds files or multiple children', () => {
    const tree = buildTree([change('a/b/keep.txt', false), change('a/b/c/d/File.java', false)]);
    expect(tree.map((n) => n.name)).toEqual(['a/b']);
    expect(tree[0]?.children.map((n) => `${n.type}:${n.name}`)).toEqual(['dir:c/d', 'file:keep.txt']);
  });

  it('compresses chains below a branching dir independently', () => {
    const tree = buildTree([change('src/x/y/one.txt', false), change('src/p/q/two.txt', false)]);
    expect(tree.map((n) => n.name)).toEqual(['src']);
    expect(tree[0]?.children.map((n) => n.name)).toEqual(['p/q', 'x/y']);
  });

  it('does not merge a dir whose only child is a file', () => {
    const tree = buildTree([change('a/b.txt', false)]);
    expect(tree.map((n) => n.name)).toEqual(['a']);
    expect(tree[0]?.children.map((n) => n.name)).toEqual(['b.txt']);
  });

  it('collapsed key uses the merged path', () => {
    const rows = flattenTree(buildTree([change('a/b/c/f.txt', false)]), { 'p:a/b/c': true }, 'p');
    expect(rows.map((r) => r.node.path)).toEqual(['a/b/c']);
  });

  it('collectPaths spans the merged chain', () => {
    const tree = buildTree([change('a/b/c/f.txt', false), change('a/b/c/g.txt', true)]);
    expect(tree[0] && collectPaths(tree[0])).toEqual(['a/b/c/f.txt', 'a/b/c/g.txt']);
  });
});