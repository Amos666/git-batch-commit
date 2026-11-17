/** Extract b-side paths from `git diff` output, handling C-style quoted names. */
export function parseDiffPaths(patch: string): string[] {
  const paths: string[] = [];
  for (const line of patch.split('\n')) {
    if (!line.startsWith('diff --git ')) {
      continue;
    }
    const rest = line.slice('diff --git '.length);
    if (rest.startsWith('"')) {
      const first = readQuoted(rest);
      if (!first) {
        continue;
      }
      const after = rest.slice(first.consumed).trimStart();
      let bValue: string | undefined;
      if (after.startsWith('"')) {
        bValue = readQuoted(after)?.value;
      } else if (after.startsWith('b/')) {
        const tail = after.slice(2);
        bValue = tail.startsWith('"') ? readQuoted(tail)?.value : tail;
      }
      if (bValue?.startsWith('b/')) {
        paths.push(bValue.slice(2));
      }
    } else {
      const same = /^a\/(.*) b\/\1$/.exec(rest);
      if (same?.[1]) {
        paths.push(same[1]);
        continue;
      }
      // rename with unquoted names: greedy a-side tolerates spaces, splits at last " b/"
      const renamed = /^a\/(.*) b\/(.*)$/.exec(rest);
      if (renamed?.[2]) {
        paths.push(renamed[2]);
      }
    }
  }
  return paths;
}

function readQuoted(input: string): { value: string; consumed: number } | undefined {
  if (!input.startsWith('"')) {
    return undefined;
  }
  // git octal escapes encode raw UTF-8 bytes; collect bytes then decode once
  const bytes: number[] = [];
  let i = 1;
  while (i < input.length) {
    const ch = input[i] as string;
    if (ch === '"') {
      return { value: new TextDecoder().decode(Uint8Array.from(bytes)), consumed: i + 1 };
    }
    if (ch === '\\') {
      const next = input[i + 1];
      if (next === undefined) {
        return undefined;
      }
      if (next >= '0' && next <= '7') {
        let oct = '';
        let j = i + 1;
        while (j < input.length && oct.length < 3 && (input[j] as string) >= '0' && (input[j] as string) <= '7') {
          oct += input[j];
          j++;
        }
        bytes.push(parseInt(oct, 8));
        i = j;
        continue;
      }
      const escapes: Record<string, string> = { a: '\x07', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t', v: '\v', '\\': '\\', '"': '"' };
      bytes.push((escapes[next] ?? next).charCodeAt(0));
      i += 2;
      continue;
    }
    bytes.push(ch.charCodeAt(0));
    i++;
  }
  return undefined;
}