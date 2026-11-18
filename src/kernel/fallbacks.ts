import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import type { MiniRunner } from '../core/miniRunner';
import { mapGitErrorCode } from '../protocol/errors';
import type { ProtocolError } from '../protocol/errors';
import type { KernelCommitOptions } from './types';

/**
 * Author-override commit for kernels whose commit API has no author option.
 * Identity travels via env (GIT_AUTHOR_NAME/EMAIL), message via a temp file;
 * hooks/amend/signoff semantics mirror the built-in commit.
 */
export async function commitWithAuthor(
  repoRoot: string,
  message: string,
  opts: KernelCommitOptions,
  mini: MiniRunner,
): Promise<void> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'gbc-commit-'));
  const messageFile = path.join(dir, 'COMMIT_EDITMSG');
  try {
    await writeFile(messageFile, message, 'utf8');
    try {
      await mini.run(repoRoot, {
        cmd: 'commit',
        messageFile,
        authorName: opts.author?.name,
        authorEmail: opts.author?.email,
        amend: opts.amend,
        signoff: opts.signoff,
        noVerify: opts.noVerify,
      });
    } catch (err) {
      const pe = err as ProtocolError;
      // miniRunner reports plain GENERIC; classify like the built-in commit
      // (hook failures must surface HOOK_FAILED + skipHooksRetry)
      if (pe.code === 'GENERIC') {
        throw mapGitErrorCode(undefined, pe.message);
      }
      throw err;
    }
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}