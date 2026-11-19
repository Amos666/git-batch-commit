import { describe, expect, it } from 'vitest';
import type { ErrorCode, RecoveryAction } from '../../src/protocol/errors';
import type { ChangeKind, CheckId, PanelState, UnavailableReason } from '../../src/protocol/models';
import { STRINGS } from '../../src/webview/strings/en';

const ERROR_CODES = [
  'GIT_EXTENSION_UNAVAILABLE', 'GIT_NOT_FOUND', 'NO_REPOSITORY', 'EMPTY_MESSAGE', 'NO_CHANGES',
  'STAGED_MISMATCH', 'INCLUDED_MISMATCH', 'CHANGELIST_CONFLICT', 'MODE_MIGRATION_REQUIRED',
  'CHECK_FAILED', 'CAPABILITY_UNAVAILABLE', 'PROTOCOL_MISMATCH', 'HOOK_FAILED', 'IDENTITY_MISSING',
  'AUTH_FAILED', 'LOCKED', 'PUSH_REJECTED', 'NO_REMOTE', 'CONFLICT', 'NETWORK', 'CANCELLED', 'DIFF_GUARDED',
  'HUNK_CONFLICT', 'SHELF_APPLY_FAILED', 'SHELF_NOT_FOUND', 'GENERIC',
] as const satisfies readonly ErrorCode[];

const RECOVERY_ACTIONS = [
  'showGitOutput', 'retryInTerminal', 'skipHooksRetry', 'openGitSettings', 'retry',
  'openMergeEditor', 'enableGitExtension', 'forceOpenDiff', 'abortSequencer',
] as const satisfies readonly RecoveryAction[];

const PANEL_STATES = ['ready', 'initializing', 'backend-unavailable'] as const satisfies readonly PanelState[];
const UNAVAILABLE_REASONS = ['extension-disabled', 'git-not-found', 'init-timeout'] as const satisfies readonly UnavailableReason[];
const CHANGE_KINDS = ['modified', 'added', 'deleted', 'renamed', 'copied', 'untracked', 'conflicted'] as const satisfies readonly ChangeKind[];
const CHECK_IDS = [
  'reformat', 'optimizeImports', 'rearrange', 'cleanup', 'copyright',
  'dependencies', 'analyze', 'todo', 'runConfiguration', 'afterCommitUpload',
] as const satisfies readonly CheckId[];

// every reason commitDisabledReason() can return must have visible copy
const DISABLED_REASONS = ['committing', 'conflicted', 'noChanges', 'noMessage', 'noHead'] as const;

describe('STRINGS coverage', () => {
  it('has a non-empty message for every ErrorCode', () => {
    for (const code of ERROR_CODES) {
      expect(STRINGS.errors[code], code).toBeTruthy();
    }
    expect(Object.keys(STRINGS.errors).sort()).toEqual([...ERROR_CODES].sort());
  });

  it('has a label for every RecoveryAction', () => {
    for (const action of RECOVERY_ACTIONS) {
      expect(STRINGS.recovery[action], action).toBeTruthy();
    }
    expect(Object.keys(STRINGS.recovery).sort()).toEqual([...RECOVERY_ACTIONS].sort());
  });

  it('covers PanelState and UnavailableReason', () => {
    for (const state of PANEL_STATES) {
      expect(STRINGS.panel[state], state).toBeTruthy();
    }
    for (const reason of UNAVAILABLE_REASONS) {
      expect(STRINGS.unavailable[reason], reason).toBeTruthy();
    }
  });

  it('covers ChangeKind and CheckId', () => {
    for (const kind of CHANGE_KINDS) {
      expect(STRINGS.changeKind[kind], kind).toBeTruthy();
    }
    for (const id of CHECK_IDS) {
      expect(STRINGS.checks[id], id).toBeTruthy();
    }
  });

  it('covers every commit disabled reason', () => {
    for (const reason of DISABLED_REASONS) {
      expect(STRINGS.disabled[reason], reason).toBeTruthy();
    }
  });

  it('contains no Chinese literals anywhere (English-only UI copy)', () => {
    const offenders: string[] = [];
    const walk = (value: unknown, path: string): void => {
      if (typeof value === 'string') {
        if (/[一-鿿]/.test(value)) {
          offenders.push(path);
        }
      } else if (typeof value === 'function') {
        // template functions take at most (string, number) or a preview object;
        // property reads on the dummy string yield undefined, never throw
        walk((value as (...args: unknown[]) => unknown)('x', 1), `${path}()`);
      } else if (value && typeof value === 'object') {
        for (const [k, v] of Object.entries(value)) {
          walk(v, `${path}.${k}`);
        }
      }
    };
    walk(STRINGS, 'STRINGS');
    expect(offenders).toEqual([]);
  });
});