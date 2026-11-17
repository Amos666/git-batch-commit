import { describe, expect, it } from 'vitest';
import { mapLocalBranches } from '../../src/adapter/branchRefs';
import type { Ref } from '../../src/adapter/gitApiTypes';

describe('mapLocalBranches', () => {
  it('accepts numeric RefType.Head (0) as returned by the real built-in API', () => {
    const refs: Ref[] = [
      { type: 0, name: 'main', commit: 'aaa' },
      { type: 0, name: 'topic', commit: 'bbb' },
    ];
    expect(mapLocalBranches(refs, 'main')).toEqual([
      { name: 'main', commit: 'aaa', current: true },
      { name: 'topic', commit: 'bbb', current: false },
    ]);
  });

  it('still accepts legacy string head refs', () => {
    const refs: Ref[] = [{ type: 'head', name: 'main', commit: 'aaa' }];
    expect(mapLocalBranches(refs, 'main')).toEqual([{ name: 'main', commit: 'aaa', current: true }]);
  });

  it('excludes remote heads (1), tags (2) and unnamed refs', () => {
    const refs: Ref[] = [
      { type: 1, name: 'origin/main', commit: 'ccc', remote: 'origin' },
      { type: 2, name: 'v1.0', commit: 'ddd' },
      { type: 0, commit: 'eee' },
      { type: 'remote', name: 'origin/dev' },
      { type: 'tag', name: 'v2.0' },
    ];
    expect(mapLocalBranches(refs, undefined)).toEqual([]);
  });

  it('marks no current branch when HEAD is detached', () => {
    const refs: Ref[] = [{ type: 0, name: 'main', commit: 'aaa' }];
    expect(mapLocalBranches(refs, undefined)).toEqual([{ name: 'main', commit: 'aaa', current: false }]);
  });
});