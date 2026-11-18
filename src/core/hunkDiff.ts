import { makeError } from '../protocol/errors';
import type { PartialSelection } from '../protocol/models';

export interface DiffHunk {
  id: number;
  header: string;
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  /** raw unified-diff body lines: ' ctx', '+add', '-del', '\ No newline…' */
  lines: string[];
}

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

export function parseHunks(patch: string): DiffHunk[] {
  const hunks: DiffHunk[] = [];
  let current: DiffHunk | undefined;
  for (const line of patch.split('\n')) {
    const m = HUNK_HEADER.exec(line);
    if (m) {
      current = {
        id: hunks.length,
        header: line,
        oldStart: Number(m[1]),
        oldLines: m[2] === undefined ? 1 : Number(m[2]),
        newStart: Number(m[3]),
        newLines: m[4] === undefined ? 1 : Number(m[4]),
        lines: [],
      };
      hunks.push(current);
      continue;
    }
    if (!current) {
      continue;
    }
    if (line.startsWith('diff --git ') || line.startsWith('@@ ')) {
      current = undefined;
      continue;
    }
    if (line.startsWith(' ') || line.startsWith('+') || line.startsWith('-') || line.startsWith('\\') || line === '') {
      current.lines.push(line);
    }
  }
  // trailing '' entries are artifacts of split('\n') on a newline-terminated patch
  for (const h of hunks) {
    while (h.lines.length > 0 && h.lines[h.lines.length - 1] === '') {
      h.lines.pop();
    }
  }
  return hunks;
}

export function splitLines(text: string): { lines: string[]; finalNewline: boolean } {
  if (text === '') {
    return { lines: [], finalNewline: false };
  }
  if (text.endsWith('\n')) {
    return { lines: text.slice(0, -1).split('\n'), finalNewline: true };
  }
  return { lines: text.split('\n'), finalNewline: false };
}

/**
 * C3 blob approach: rebuild the target blob by applying selected hunks to
 * the base text. Context/delete lines are verified against the base so a
 * concurrently modified file fails loudly instead of corrupting the index.
 */
export function applyHunks(baseText: string, hunks: DiffHunk[], selected: ReadonlySet<number>): string {
  if (selected.size === 0) {
    return baseText;
  }
  const { lines: baseLines, finalNewline: baseNl } = splitLines(baseText);
  const out: string[] = [];
  let cursor = 0;
  let lastNonl = false;
  for (const h of hunks) {
    const start = h.oldStart - (h.oldLines > 0 ? 1 : 0);
    if (start < cursor || start > baseLines.length) {
      throw makeError('HUNK_CONFLICT', 'File was modified externally; hunk position no longer matches. Refresh and retry.');
    }
    while (cursor < start) {
      out.push(baseLines[cursor] as string);
      cursor++;
      lastNonl = false;
    }
    const take = selected.has(h.id);
    let bi = start;
    for (const raw of h.lines) {
      const kind = raw[0];
      const text = raw.slice(1);
      if (kind === '\\') {
        lastNonl = true;
        continue;
      }
      if (kind === ' ' || kind === '-' || raw === '') {
        const ctx = raw === '' ? '' : text;
        if (bi >= baseLines.length || baseLines[bi] !== ctx) {
          throw makeError('HUNK_CONFLICT', 'File was modified externally; hunk content no longer matches. Refresh and retry.');
        }
        bi++;
        if (kind !== '-' || !take) {
          out.push(ctx);
          lastNonl = false;
        }
      } else if (kind === '+') {
        if (take) {
          out.push(text);
          lastNonl = false;
        }
      }
    }
    cursor = bi;
  }
  const tailCopied = cursor < baseLines.length;
  while (cursor < baseLines.length) {
    out.push(baseLines[cursor] as string);
    cursor++;
    lastNonl = false;
  }
  const finalNl = lastNonl ? false : tailCopied ? baseNl : true;
  if (out.length === 0) {
    return '';
  }
  return out.join('\n') + (finalNl ? '\n' : '');
}

/** New-side line count of a hunk (context + additions; deletions do not count). */
export function countNewSideLines(hunk: DiffHunk): number {
  let n = 0;
  for (const raw of hunk.lines) {
    const kind = raw === '' ? ' ' : raw[0];
    if (kind === ' ' || kind === '+') {
      n++;
    }
  }
  return n;
}

/**
 * Fold a hunk+line selection into filtered hunks suitable for applyHunks.
 * `lines` offsets are 0-based within the hunk's new-side lines (context and
 * '+' both count). Unselected additions are dropped; in a replace block the
 * paired deletion is kept as context (the base line survives). Unpaired
 * deletions always apply. Hunks left with no change at all are dropped.
 */
export function applyLineSelection(hunks: DiffHunk[], selection: PartialSelection): DiffHunk[] {
  const valid = new Set(hunks.map((h) => h.id));
  for (const id of selection.hunkIds) {
    if (!Number.isInteger(id) || !valid.has(id)) {
      throw makeError('HUNK_CONFLICT', 'Hunks have changed; refresh and retry', ['retry']);
    }
  }
  const wanted = new Set(selection.hunkIds);
  const out: DiffHunk[] = [];
  for (const h of hunks) {
    if (!wanted.has(h.id)) {
      continue;
    }
    const offsets = selection.lines?.[h.id];
    if (!offsets) {
      out.push(h);
      continue;
    }
    const total = countNewSideLines(h);
    for (const o of offsets) {
      if (!Number.isInteger(o) || o < 0 || o >= total) {
        throw makeError('HUNK_CONFLICT', 'Line selection no longer matches the file; refresh and retry', ['retry']);
      }
    }
    const keep = new Set(offsets);
    interface Tok {
      raw: string;
      kind: string;
      kept: boolean;
      asContext: boolean;
    }
    const toks: Tok[] = h.lines.map((raw) => {
      const kind = raw === '' ? ' ' : (raw[0] ?? ' ');
      return { raw, kind, kept: true, asContext: false };
    });
    let newIdx = 0;
    for (const tok of toks) {
      if (tok.kind === '+') {
        tok.kept = keep.has(newIdx);
        newIdx++;
      } else if (tok.kind === ' ') {
        newIdx++;
      }
    }
    // pair deletions with additions inside replace blocks ('-' run then '+' run);
    // markers are transparent for pairing but stay attached to their line
    const solid = toks.filter((t) => t.kind !== '\\');
    for (let i = 0; i < solid.length; i++) {
      if ((solid[i] as Tok).kind !== '-') {
        continue;
      }
      let j = i;
      while (j < solid.length && (solid[j] as Tok).kind === '-') {
        j++;
      }
      let k = j;
      while (k < solid.length && (solid[k] as Tok).kind === '+') {
        k++;
      }
      const pairs = Math.min(j - i, k - j);
      for (let p = 0; p < pairs; p++) {
        if (!(solid[j + p] as Tok).kept) {
          const del = solid[i + p] as Tok;
          del.kept = false;
          del.asContext = true;
        }
      }
      i = k - 1;
    }
    const lines: string[] = [];
    let oldCount = 0;
    let newCount = 0;
    let hasChange = false;
    let lastKept = true;
    for (const tok of toks) {
      if (tok.kind === '\\') {
        if (lastKept) {
          lines.push(tok.raw);
        }
        continue;
      }
      if (tok.kind === '+' && !tok.kept) {
        lastKept = false;
        continue;
      }
      if (tok.kind === '-' && tok.asContext) {
        lines.push(` ${tok.raw.slice(1)}`);
        oldCount++;
        newCount++;
        lastKept = true;
        continue;
      }
      lines.push(tok.raw);
      lastKept = true;
      if (tok.kind === '+') {
        newCount++;
        hasChange = true;
      } else if (tok.kind === '-') {
        oldCount++;
        hasChange = true;
      } else {
        oldCount++;
        newCount++;
      }
    }
    if (!hasChange) {
      continue;
    }
    const tail = /^@@ -\d+(?:,\d+)? \+\d+(?:,\d+)? @@(.*)$/.exec(h.header)?.[1] ?? '';
    out.push({
      ...h,
      header: `@@ -${h.oldStart},${oldCount} +${h.newStart},${newCount} @@${tail}`,
      oldLines: oldCount,
      newLines: newCount,
      lines,
    });
  }
  return out;
}

/** Whole-file "add" hunk for untracked files (no index entry to diff against). */
export function syntheticAddHunk(content: string): DiffHunk {
  const { lines, finalNewline } = splitLines(content);
  const body = lines.map((l) => `+${l}`);
  if (!finalNewline && lines.length > 0) {
    body.push('\\ No newline at end of file');
  }
  return {
    id: 0,
    header: `@@ -0,0 +1,${lines.length} @@`,
    oldStart: 0,
    oldLines: 0,
    newStart: 1,
    newLines: lines.length,
    lines: body,
  };
}

export function isBinaryPatch(patch: string): boolean {
  return /Binary files .* differ/.test(patch) || patch.startsWith('GIT binary patch');
}