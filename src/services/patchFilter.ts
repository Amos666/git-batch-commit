import { parseDiffPaths } from './diffPaths';

/** Keep only the per-file sections of a unified git patch whose b-side path is selected. */
export function filterPatch(patch: string, paths: string[]): string {
  const selected = new Set(paths);
  const sections: string[] = [];
  let current: string[] = [];
  let keep = false;
  const flush = () => {
    // split('\n') on a trailing newline leaves an empty tail element; context blanks are ' ', never ''
    while (current.length > 0 && current[current.length - 1] === '') {
      current.pop();
    }
    if (keep && current.length > 0) {
      sections.push(current.join('\n'));
    }
    current = [];
  };
  for (const line of patch.split('\n')) {
    if (line.startsWith('diff --git ')) {
      flush();
      const bPath = parseDiffPaths(line)[0];
      keep = bPath !== undefined && selected.has(bPath);
    }
    current.push(line);
  }
  flush();
  return sections.length > 0 ? sections.join('\n') + '\n' : '';
}