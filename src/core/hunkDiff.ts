import { makeError } from '../protocol/errors';

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
      throw makeError('HUNK_CONFLICT', '文件已被外部修改，hunk 位置不匹配，请刷新后重试');
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
          throw makeError('HUNK_CONFLICT', '文件已被外部修改，hunk 内容不匹配，请刷新后重试');
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