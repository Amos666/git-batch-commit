import { describe, expect, it } from 'vitest';
import { filterPatch } from '../../src/services/patchFilter';

const sectionA = [
  'diff --git a/a.txt b/a.txt',
  'index 1111111..2222222 100644',
  '--- a/a.txt',
  '+++ b/a.txt',
  '@@ -1 +1,2 @@',
  ' v1',
  '+shelved-a',
].join('\n');

// git C-quotes 中文.txt as octal UTF-8 bytes
const sectionQuoted = [
  'diff --git "a/\\344\\270\\255\\346\\226\\207.txt" "b/\\344\\270\\255\\346\\226\\207.txt"',
  'index 3333333..4444444 100644',
  '--- "a/\\344\\270\\255\\346\\226\\207.txt"',
  '+++ "b/\\344\\270\\255\\346\\226\\207.txt"',
  '@@ -1 +1,2 @@',
  ' 你好',
  '+shelved-cn',
].join('\n');

const sectionRename = [
  'diff --git a/old name.txt b/new name.txt',
  'similarity index 90%',
  'rename from old name.txt',
  'rename to new name.txt',
  'index 5555555..6666666 100644',
  '--- a/old name.txt',
  '+++ b/new name.txt',
  '@@ -1 +1 @@',
  '-old',
  '+new',
].join('\n');

const patch = `${sectionA}\n${sectionQuoted}\n${sectionRename}\n`;

describe('filterPatch', () => {
  it('keeps only the selected plain-path section', () => {
    const out = filterPatch(patch, ['a.txt']);
    expect(out).toBe(`${sectionA}\n`);
    expect(out).not.toContain('shelved-cn');
    expect(out).not.toContain('rename to');
  });

  it('matches C-quoted octal UTF-8 paths by decoded name', () => {
    const out = filterPatch(patch, ['中文.txt']);
    expect(out).toBe(`${sectionQuoted}\n`);
  });

  it('matches rename sections by b-side path', () => {
    const out = filterPatch(patch, ['new name.txt']);
    expect(out).toBe(`${sectionRename}\n`);
  });

  it('keeps multiple sections in original order', () => {
    const out = filterPatch(patch, ['new name.txt', 'a.txt']);
    expect(out).toBe(`${sectionA}\n${sectionRename}\n`);
  });

  it('returns empty string when nothing matches', () => {
    expect(filterPatch(patch, ['missing.txt'])).toBe('');
    expect(filterPatch('', ['a.txt'])).toBe('');
  });
});