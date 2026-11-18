import { describe, expect, it } from 'vitest';
import { normalizeCommitRequest } from '../../src/protocol/messages';
import type { CommitRequestV2 } from '../../src/protocol/models';

describe('normalizeCommitRequest (v1 webview compat)', () => {
  it('maps the legacy flat shape into options and keeps expectedStaged', () => {
    const req = normalizeCommitRequest({
      repoIds: ['r1'],
      message: 'legacy',
      amend: true,
      signoff: true,
      noVerify: false,
      pushAfter: true,
      expectedStaged: { r1: ['a.txt'] },
    });
    expect(req).toEqual({
      repoIds: ['r1'],
      message: 'legacy',
      options: { amend: true, signoff: true, noVerify: false, pushAfter: true },
      expectedStaged: { r1: ['a.txt'] },
    });
  });

  it('passes v2 requests through untouched', () => {
    const v2: CommitRequestV2 = {
      repoIds: ['r1'],
      message: 'v2',
      options: { author: { name: 'A', email: 'a@b.c' } },
      expectedIncluded: { r1: [{ path: 'a.txt', selection: { hunkIds: [0] } }] },
    };
    expect(normalizeCommitRequest(v2)).toBe(v2);
  });

  it('defaults missing legacy flags to undefined (kernel treats them as off)', () => {
    const req = normalizeCommitRequest({ repoIds: ['r1'], message: 'plain' });
    expect(req.options).toEqual({ amend: undefined, signoff: undefined, noVerify: undefined, pushAfter: undefined });
    expect(req.expectedStaged).toBeUndefined();
    expect(req.expectedIncluded).toBeUndefined();
  });
});