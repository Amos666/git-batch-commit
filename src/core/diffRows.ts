import type { HunkInfo } from '../protocol/messages';
import { splitLines } from './hunkDiff';

export interface DiffRowSide {
  no: number;
  text: string;
  /** 0-based offset within the hunk's new-side lines (context + additions) */
  offset?: number;
}

export type DiffRow =
  | { kind: 'equal'; oldNo: number; newNo: number; text: string }
  | { kind: 'hunk'; hunkId: number; header: string }
  | {
      kind: 'change';
      hunkId: number;
      change: 'ctx' | 'add' | 'del' | 'replace';
      old?: DiffRowSide;
      new?: DiffRowSide;
    };

/**
 * Align old/new text into side-by-side rows using the parsed hunks.
 * Replace blocks pair '-' runs with the following '+' run (same pairing
 * rule as applyLineSelection); unpaired lines get an empty opposite pane.
 */
export function buildDiffRows(oldText: string, newText: string, hunks: HunkInfo[]): DiffRow[] {
  const oldLines = splitLines(oldText).lines;
  const newLines = splitLines(newText).lines;
  const rows: DiffRow[] = [];
  let oi = 0;
  let ni = 0;
  const copyEqual = (untilOld: number, untilNew: number): void => {
    while (oi < untilOld && ni < untilNew && oi < oldLines.length && ni < newLines.length) {
      rows.push({ kind: 'equal', oldNo: oi + 1, newNo: ni + 1, text: oldLines[oi] as string });
      oi++;
      ni++;
    }
  };
  for (const h of hunks) {
    const oStart = h.oldStart - (h.oldLines > 0 ? 1 : 0);
    const nStart = h.newStart - (h.newLines > 0 ? 1 : 0);
    copyEqual(oStart, nStart);
    oi = Math.max(oi, oStart);
    ni = Math.max(ni, nStart);
    rows.push({ kind: 'hunk', hunkId: h.id, header: h.header });
    const toks: { kind: string; text: string }[] = [];
    for (const raw of h.lines) {
      const kind = raw[0];
      if (kind === ' ' || kind === '+' || kind === '-') {
        toks.push({ kind, text: raw.slice(1) });
      }
    }
    let o = oi;
    let n = ni;
    let offset = 0;
    let i = 0;
    while (i < toks.length) {
      const tok = toks[i] as { kind: string; text: string };
      if (tok.kind === ' ') {
        rows.push({
          kind: 'change',
          hunkId: h.id,
          change: 'ctx',
          old: { no: o + 1, text: tok.text },
          new: { no: n + 1, text: tok.text, offset },
        });
        o++;
        n++;
        offset++;
        i++;
        continue;
      }
      if (tok.kind === '-') {
        let j = i;
        while (j < toks.length && (toks[j] as { kind: string }).kind === '-') {
          j++;
        }
        let k = j;
        while (k < toks.length && (toks[k] as { kind: string }).kind === '+') {
          k++;
        }
        const dels = toks.slice(i, j);
        const adds = toks.slice(j, k);
        const pairs = Math.min(dels.length, adds.length);
        for (let p = 0; p < pairs; p++) {
          rows.push({
            kind: 'change',
            hunkId: h.id,
            change: 'replace',
            old: { no: o + p + 1, text: (dels[p] as { text: string }).text },
            new: { no: n + p + 1, text: (adds[p] as { text: string }).text, offset: offset + p },
          });
        }
        for (let p = pairs; p < dels.length; p++) {
          rows.push({
            kind: 'change',
            hunkId: h.id,
            change: 'del',
            old: { no: o + p + 1, text: (dels[p] as { text: string }).text },
          });
        }
        for (let p = pairs; p < adds.length; p++) {
          rows.push({
            kind: 'change',
            hunkId: h.id,
            change: 'add',
            new: { no: n + p + 1, text: (adds[p] as { text: string }).text, offset: offset + p },
          });
        }
        o += dels.length;
        n += adds.length;
        offset += adds.length;
        i = k;
        continue;
      }
      let k = i;
      while (k < toks.length && (toks[k] as { kind: string }).kind === '+') {
        k++;
      }
      for (let p = i; p < k; p++) {
        rows.push({
          kind: 'change',
          hunkId: h.id,
          change: 'add',
          new: { no: n + 1, text: (toks[p] as { text: string }).text, offset },
        });
        n++;
        offset++;
      }
      i = k;
    }
    oi = oStart + h.oldLines;
    ni = nStart + h.newLines;
  }
  copyEqual(oldLines.length, newLines.length);
  return rows;
}