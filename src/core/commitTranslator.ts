import type { RepoRegistry } from '../adapter/repoRegistry';
import { applyLineSelection } from './hunkDiff';
import type { InclusionModel } from './inclusionModel';
import type { MiniRunner } from './miniRunner';
import { makeError } from '../protocol/errors';
import type { PartialSelection } from '../protocol/models';
import type { HunkService } from '../services/hunkService';

export interface IncludedEntry {
  path: string;
  selection?: PartialSelection;
}

export interface TranslationState {
  /** set once the translator performs its first index mutation */
  indexModified: boolean;
}

export interface TranslateOptions {
  /** asked once per session before unstaging index entries outside the checked set */
  confirmExclusion: (paths: string[]) => Promise<boolean>;
  tx: TranslationState;
}

const CHUNK = 500;

/** Parse `git status --porcelain=v1 -z --untracked-files=no` into staged paths. */
export function parseStagedPaths(stdout: Buffer): string[] {
  return parsePorcelain(stdout)
    .filter((e) => e.x !== ' ' && e.x !== '?')
    .map((e) => e.path);
}

export interface PorcelainEntry {
  x: string;
  y: string;
  path: string;
}

export function parsePorcelain(stdout: Buffer): PorcelainEntry[] {
  const tokens = stdout.toString('utf8').split('\0').filter((t) => t.length > 0);
  const entries: PorcelainEntry[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i] as string;
    const x = token[0] ?? ' ';
    entries.push({ x, y: token[1] ?? ' ', path: token.slice(3) });
    if (x === 'R' || x === 'C') {
      i++; // rename/copy entries carry the origin path as an extra token
    }
  }
  return entries;
}

/**
 * IDEA changelist-mode commit translation: the checked set becomes the index
 * immediately before commit. On any failure the index keeps its translated
 * state (IDEA does not roll back); the caller surfaces a review banner.
 */
export class CommitTranslator {
  constructor(
    private readonly registry: RepoRegistry,
    private readonly inclusion: InclusionModel,
    private readonly hunk: HunkService,
    private readonly mini: MiniRunner,
  ) {}

  async translate(repoId: string, included: IncludedEntry[], opts: TranslateOptions): Promise<void> {
    const repo = this.registry.get(repoId);
    const desc = this.registry.descriptor(repoId);
    if (!repo || !desc) {
      throw makeError('NO_REPOSITORY', `Repository not found: ${repoId}`);
    }
    if (included.length === 0) {
      throw makeError('NO_CHANGES', 'Nothing checked to commit');
    }
    if (repo.state.mergeChanges.length > 0) {
      throw makeError('CONFLICT', 'Unresolved conflicts exist; commit is not possible', ['openMergeEditor', 'showGitOutput']);
    }

    // 1. validate the checked snapshot against fresh state before touching the index
    const present = new Set<string>([
      ...repo.state.workingTreeChanges.map((c) => c.path),
      ...repo.state.untrackedChanges.map((c) => c.path),
      ...repo.state.indexChanges.map((c) => c.path),
    ]);
    const seen = new Set<string>();
    for (const entry of included) {
      if (seen.has(entry.path)) {
        throw makeError('INCLUDED_MISMATCH', `Duplicate path in the checked selection: ${entry.path}`, ['retry']);
      }
      seen.add(entry.path);
      if (!present.has(entry.path)) {
        throw makeError(
          'INCLUDED_MISMATCH',
          'Checked files no longer match the repository state (an external Git operation may have occurred); commit blocked',
          ['retry'],
        );
      }
      if (entry.selection) {
        const fresh = await this.hunk.list(repoId, entry.path, 'worktree');
        if (fresh.binary) {
          throw makeError('GENERIC', 'Binary files do not support partial commit');
        }
        // throws HUNK_CONFLICT when hunk ids / line offsets no longer match
        applyLineSelection(fresh.hunks, entry.selection);
      }
    }

    // 2. exclude index entries outside the checked set (never silently)
    const stagedNow = parseStagedPaths((await this.mini.run(desc.rootPath, { cmd: 'status-porcelain' })).stdout);
    const includedPaths = new Set(included.map((e) => e.path));
    const excluded = stagedNow.filter((p) => !includedPaths.has(p));
    if (excluded.length > 0) {
      const ok = await opts.confirmExclusion(excluded);
      if (!ok) {
        throw makeError('GENERIC', 'Commit aborted: files outside the checked selection remain staged', ['showGitOutput']);
      }
      opts.tx.indexModified = true;
      for (let i = 0; i < excluded.length; i += CHUNK) {
        await this.inclusion.unstage(repoId, excluded.slice(i, i + CHUNK));
      }
    }

    // 3. fully included paths (tracked + untracked) in chunks
    const full = included.filter((e) => !e.selection).map((e) => e.path);
    if (full.length > 0) {
      opts.tx.indexModified = true;
      for (let i = 0; i < full.length; i += CHUNK) {
        await this.inclusion.stage(repoId, full.slice(i, i + CHUNK));
      }
    }

    // 4. partial selections via blob rebuild (context verified against the index base)
    for (const entry of included) {
      if (entry.selection) {
        opts.tx.indexModified = true;
        await this.hunk.stagePartial(repoId, entry.path, entry.selection);
      }
    }

    // 5. final race guard: the index must now equal the checked set exactly
    const entries = parsePorcelain((await this.mini.run(desc.rootPath, { cmd: 'status-porcelain' })).stdout);
    const after = new Set(entries.filter((e) => e.x !== ' ' && e.x !== '?').map((e) => e.path));
    // dirty/untracked content inside a submodule is not stageable from the parent
    // (git add is a no-op until the submodule HEAD moves) — not an index race
    const unstageable = new Set(entries.filter((e) => e.x === ' ' && (e.y === 'm' || e.y === '?')).map((e) => e.path));
    const expected = [...includedPaths].filter((p) => !unstageable.has(p));
    const missing = expected.filter((p) => !after.has(p));
    const extra = [...after].filter((p) => !includedPaths.has(p));
    if (missing.length > 0 || extra.length > 0) {
      throw makeError(
        'INCLUDED_MISMATCH',
        'The index changed while preparing the commit (an external Git operation may have occurred); commit blocked',
        ['retry', 'showGitOutput'],
      );
    }
  }
}