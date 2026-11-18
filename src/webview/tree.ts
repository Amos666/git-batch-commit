import type { FileChange } from '../protocol/models';

export interface TreeNode {
  type: 'dir' | 'file';
  name: string;
  /** dir: prefix without trailing slash; file: repo-relative path */
  path: string;
  change?: FileChange;
  children: TreeNode[];
  total: number;
  staged: number;
}

export interface FlatRow {
  node: TreeNode;
  depth: number;
}

export function buildTree(changes: FileChange[]): TreeNode[] {
  const root: TreeNode = { type: 'dir', name: '', path: '', children: [], total: 0, staged: 0 };
  const dirs = new Map<string, TreeNode>([['', root]]);

  const ensureDir = (dirPath: string): TreeNode => {
    const existing = dirs.get(dirPath);
    if (existing) {
      return existing;
    }
    const slash = dirPath.lastIndexOf('/');
    const parent = ensureDir(slash === -1 ? '' : dirPath.slice(0, slash));
    const node: TreeNode = {
      type: 'dir',
      name: slash === -1 ? dirPath : dirPath.slice(slash + 1),
      path: dirPath,
      children: [],
      total: 0,
      staged: 0,
    };
    parent.children.push(node);
    dirs.set(dirPath, node);
    return node;
  };

  for (const change of changes) {
    const slash = change.path.lastIndexOf('/');
    const parent = ensureDir(slash === -1 ? '' : change.path.slice(0, slash));
    parent.children.push({
      type: 'file',
      name: slash === -1 ? change.path : change.path.slice(slash + 1),
      path: change.path,
      change,
      children: [],
      total: 1,
      staged: change.staged ? 1 : 0,
    });
  }

  // IDEA-style compact directories: a chain of dirs where each level has
  // exactly one child (a dir) renders as one row "a/b/c/d".
  const compressChain = (node: TreeNode): TreeNode => {
    let cur = node;
    let name = node.name;
    for (;;) {
      const only = cur.children.length === 1 ? cur.children[0] : undefined;
      if (!only || only.type !== 'dir') {
        break;
      }
      cur = only;
      name += `/${only.name}`;
    }
    return cur === node ? node : { ...cur, name };
  };

  const finalize = (node: TreeNode): void => {
    if (node.type === 'file') {
      return;
    }
    for (const child of node.children) {
      finalize(child);
    }
    node.children = node.children.map((c) => (c.type === 'dir' ? compressChain(c) : c));
    node.children.sort((a, b) =>
      a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'dir' ? -1 : 1,
    );
    let total = 0;
    let staged = 0;
    for (const child of node.children) {
      total += child.total;
      staged += child.staged;
    }
    node.total = total;
    node.staged = staged;
  };
  finalize(root);
  return root.children;
}

export function flattenTree(
  nodes: TreeNode[],
  collapsed: Record<string, boolean>,
  keyPrefix: string,
  depth = 0,
  out: FlatRow[] = [],
): FlatRow[] {
  for (const node of nodes) {
    out.push({ node, depth });
    if (node.type === 'dir' && !collapsed[`${keyPrefix}:${node.path}`]) {
      flattenTree(node.children, collapsed, keyPrefix, depth + 1, out);
    }
  }
  return out;
}

export function collectPaths(node: TreeNode): string[] {
  if (node.type === 'file') {
    return [node.path];
  }
  return node.children.flatMap(collectPaths);
}