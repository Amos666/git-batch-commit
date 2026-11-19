import { describe, expect, it } from 'vitest';
import { pickRemote } from '../../src/core/pushTarget';

describe('pickRemote', () => {
  it('prefers the explicit choice', () => {
    expect(pickRemote('origin', ['origin', 'backup'], 'backup')).toEqual({ status: 'ok', remote: 'backup' });
  });

  it('uses the upstream remote when set', () => {
    expect(pickRemote('origin', ['origin', 'backup'])).toEqual({ status: 'ok', remote: 'origin' });
  });

  it('auto-picks the only remote when no upstream', () => {
    expect(pickRemote(undefined, ['origin'])).toEqual({ status: 'ok', remote: 'origin' });
  });

  it('reports none when no remote exists', () => {
    expect(pickRemote(undefined, [])).toEqual({ status: 'none' });
  });

  it('reports ambiguous when several remotes exist and none is chosen', () => {
    expect(pickRemote(undefined, ['origin', 'backup'])).toEqual({ status: 'ambiguous' });
  });
});