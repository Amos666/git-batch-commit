import type { KernelDiffFile, KernelRepo } from '../kernel/types';
import { parseDiffPaths } from './diffPaths';

export const EMPTY_TREE_OID = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';

/** Changed files of one commit (parent ↔ oid; root commits via `<oid>^!`). */
export async function commitFileEntries(repo: KernelRepo, oid: string, parent: string | undefined): Promise<KernelDiffFile[]> {
  // newer builds: stats2 takes a raw range; `<oid>^!` covers root commits
  // (the empty-tree special case in diffBetweenWithStats is broken upstream:
  // it compares against an async getter, so three-dot ranges always fail there)
  if (typeof repo.diffBetweenWithStats2 === 'function') {
    const range = parent ? `${parent}..${oid}` : `${oid}^!`;
    return repo.diffBetweenWithStats2(range);
  }
  if (parent && typeof repo.diffBetweenPatch === 'function') {
    return patchEntries(repo.rootPath, await repo.diffBetweenPatch(parent, oid));
  }
  // documented fallback: older API returns a patch string, newer stable parsed entries
  const result = await repo.diffBetween(parent ?? EMPTY_TREE_OID, oid);
  if (typeof result === 'string') {
    return patchEntries(repo.rootPath, result);
  }
  return result;
}

/** Changed files of a ref range (base ↔ target), deduped by git itself. */
export async function rangeFileEntries(repo: KernelRepo, base: string, target: string): Promise<KernelDiffFile[]> {
  if (typeof repo.diffBetweenWithStats2 === 'function') {
    return repo.diffBetweenWithStats2(`${base}..${target}`);
  }
  const result = await repo.diffBetween(base, target);
  return typeof result === 'string' ? patchEntries(repo.rootPath, result) : result;
}

function patchEntries(rootPath: string, patch: string): KernelDiffFile[] {
  // patch fallback carries no status; treat every path as modified
  return parseDiffPaths(patch).map((p) => ({ path: p }));
}