import { describe, expect, it } from 'vitest';
import { parseDiffPaths } from '../../src/services/diffPaths';

describe('parseDiffPaths', () => {
  it('parses plain paths', () => {
    const patch = [
      'diff --git a/src/a.ts b/src/a.ts',
      'index 123..456 100644',
      '--- a/src/a.ts',
      '+++ b/src/a.ts',
      '@@ -1 +1 @@',
      '-old',
      '+new',
      'diff --git a/README.md b/README.md',
      'index 123..456 100644',
    ].join('\n');
    expect(parseDiffPaths(patch)).toEqual(['src/a.ts', 'README.md']);
  });

  it('parses paths with spaces (quoted by git)', () => {
    const patch = 'diff --git "a/my file.txt" "b/my file.txt"\nindex 123..456 100644';
    expect(parseDiffPaths(patch)).toEqual(['my file.txt']);
  });

  it('decodes octal-escaped unicode names', () => {
    // git quotes UTF-8 bytes of 中文 as octal escapes
    const patch = 'diff --git "a/\\344\\270\\255\\346\\226\\207.txt" "b/\\344\\270\\255\\346\\226\\207.txt"';
    expect(parseDiffPaths(patch)).toEqual(['中文.txt']);
  });

  it('handles rename entries (a and b differ)', () => {
    const patch = 'diff --git a/old.txt b/new.txt\nsimilarity index 90%\nrename from old.txt\nrename to new.txt';
    expect(parseDiffPaths(patch)).toEqual(['new.txt']);
    const quoted = 'diff --git "a/old name.txt" "b/new name.txt"';
    expect(parseDiffPaths(quoted)).toEqual(['new name.txt']);
  });

  it('returns empty for empty patch', () => {
    expect(parseDiffPaths('')).toEqual([]);
  });
});