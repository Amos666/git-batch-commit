import type { CheckAvailability, KernelCapabilities } from '../protocol/models';
import type { KernelRepo } from './types';

/**
 * Feature detection over the kernel contract. The UI renders availability
 * from these flags only — it never learns which kernel implementation runs.
 * commitAuthor is true because the author-override fallback covers kernels
 * whose commit API lacks an author option.
 */
export function detectCapabilities(repos: readonly KernelRepo[]): KernelCapabilities {
  const any = (pred: (r: KernelRepo) => boolean): boolean => repos.some(pred);
  return {
    stagedDiff: any((r) => typeof r.diffIndexWithHEAD === 'function'),
    hashObject: any((r) => typeof r.hashObject === 'function'),
    // list has a whitelisted `stash list` fallback; creation gates the feature
    stash: any((r) => typeof r.createStash === 'function'),
    log: any((r) => typeof r.log === 'function'),
    rootCommitStats: any((r) => typeof r.diffBetweenWithStats2 === 'function'),
    commitAuthor: true,
    commitCleanup: false,
  };
}

/** Commit Checks availability, kernel-independent (editor-command based). */
export const CHECK_AVAILABILITY: CheckAvailability[] = [
  { id: 'reformat', available: true },
  { id: 'optimizeImports', available: true },
  { id: 'rearrange', available: false },
  { id: 'cleanup', available: true, limited: true },
  { id: 'copyright', available: false },
  { id: 'dependencies', available: true },
  { id: 'analyze', available: true },
  { id: 'todo', available: true },
  { id: 'runConfiguration', available: false },
  { id: 'afterCommitUpload', available: false },
];