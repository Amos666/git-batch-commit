import * as fs from 'node:fs';
import * as path from 'node:path';
import { makeError } from '../protocol/errors';
import type { DiffSide } from '../protocol/messages';

const BINARY_PROBE_BYTES = 8192;

/** Data-side diff guards (fs only, kernel-independent); editor opening lives in ui/editorBridge. */
export async function guardWorktreeFile(
  rootPath: string,
  repoId: string,
  relPath: string,
  side: DiffSide,
  thresholdKB: number,
): Promise<void> {
  const fsPath = path.join(rootPath, relPath);
  let stat: fs.Stats;
  try {
    stat = await fs.promises.stat(fsPath);
  } catch {
    return; // deleted files: diff shows removal, nothing to guard
  }
  if (!stat.isFile()) {
    return;
  }
  const context = { repoId, path: relPath, side };
  if (stat.size > thresholdKB * 1024) {
    const err = makeError(
      'DIFF_GUARDED',
      `File is large (${(stat.size / 1024 / 1024).toFixed(1)} MB, threshold ${thresholdKB} KB); opening the diff may be slow`,
      ['forceOpenDiff'],
    );
    err.diffContext = context;
    throw err;
  }
  if (await looksBinary(fsPath)) {
    const err = makeError('DIFF_GUARDED', 'File appears to be binary; the diff viewer cannot display it usefully', ['forceOpenDiff']);
    err.diffContext = context;
    throw err;
  }
}

export async function looksBinary(fsPath: string): Promise<boolean> {
  let handle: fs.promises.FileHandle | undefined;
  try {
    handle = await fs.promises.open(fsPath, 'r');
    const buf = Buffer.alloc(BINARY_PROBE_BYTES);
    const { bytesRead } = await handle.read(buf, 0, BINARY_PROBE_BYTES, 0);
    return buf.subarray(0, bytesRead).includes(0);
  } catch {
    return false;
  } finally {
    await handle?.close();
  }
}