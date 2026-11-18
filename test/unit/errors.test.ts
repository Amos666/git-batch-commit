import { describe, expect, it } from 'vitest';
import { mapGitErrorCode, makeError } from '../../src/protocol/errors';
import { isHostEvent, isRequest, isResponse } from '../../src/protocol/messages';

describe('mapGitErrorCode', () => {
  it('maps lock errors with retry action', () => {
    const err = mapGitErrorCode('RepositoryIsLocked', '');
    expect(err.code).toBe('LOCKED');
    expect(err.actions).toContain('retry');
  });

  it('maps identity errors', () => {
    expect(mapGitErrorCode('NoUserNameConfigured', '').code).toBe('IDENTITY_MISSING');
    expect(mapGitErrorCode('NoUserEmailConfigured', '').actions).toContain('openGitSettings');
  });

  it('maps push rejection', () => {
    expect(mapGitErrorCode('PushRejected', '').code).toBe('PUSH_REJECTED');
    expect(mapGitErrorCode('PushNotFastForward', '').code).toBe('PUSH_REJECTED');
  });

  it('maps conflicts with merge editor action', () => {
    const err = mapGitErrorCode('UnmergedChanges', '');
    expect(err.code).toBe('CONFLICT');
    expect(err.actions).toContain('openMergeEditor');
  });

  it('detects hook failures from message when no dedicated code', () => {
    const err = mapGitErrorCode(undefined, 'error: pre-commit hook declined\nsome detail');
    expect(err.code).toBe('HOOK_FAILED');
    expect(err.actions).toContain('skipHooksRetry');
  });

  it('falls back to generic with terminal retry', () => {
    const err = mapGitErrorCode(undefined, 'fatal: something odd');
    expect(err.code).toBe('GENERIC');
    expect(err.actions).toContain('retryInTerminal');
    expect(err.message).toBe('fatal: something odd');
  });

  it('truncates long messages', () => {
    const err = mapGitErrorCode(undefined, 'x'.repeat(500));
    expect(err.message.length).toBeLessThanOrEqual(201);
  });
});

describe('protocol guards', () => {
  it('identifies requests', () => {
    expect(isRequest({ v: 2, id: 'a', method: 'panel.init', params: undefined })).toBe(true);
    expect(isRequest({ v: 1, id: 'a', method: 'panel.init' })).toBe(false);
    expect(isRequest(null)).toBe(false);
  });

  it('identifies responses', () => {
    expect(isResponse({ v: 2, id: 'a', ok: true, result: null })).toBe(true);
    expect(isResponse({ v: 2, id: 'a', ok: false, error: makeError('GENERIC', 'x') })).toBe(true);
    expect(isResponse({ v: 2, event: 'x' })).toBe(false);
  });

  it('identifies events', () => {
    expect(isHostEvent({ v: 2, event: 'status.changed', seq: 1, payload: {} })).toBe(true);
    expect(isHostEvent({ v: 2, id: 'a', ok: true })).toBe(false);
  });
});