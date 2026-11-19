export type ErrorCode =
  | 'GIT_EXTENSION_UNAVAILABLE'
  | 'GIT_NOT_FOUND'
  | 'NO_REPOSITORY'
  | 'EMPTY_MESSAGE'
  | 'NO_CHANGES'
  | 'STAGED_MISMATCH'
  | 'INCLUDED_MISMATCH'
  | 'CHANGELIST_CONFLICT'
  | 'MODE_MIGRATION_REQUIRED'
  | 'CHECK_FAILED'
  | 'CAPABILITY_UNAVAILABLE'
  | 'PROTOCOL_MISMATCH'
  | 'HOOK_FAILED'
  | 'IDENTITY_MISSING'
  | 'AUTH_FAILED'
  | 'LOCKED'
  | 'PUSH_REJECTED'
  | 'NO_REMOTE'
  | 'CONFLICT'
  | 'NETWORK'
  | 'CANCELLED'
  | 'DIFF_GUARDED'
  | 'HUNK_CONFLICT'
  | 'SHELF_APPLY_FAILED'
  | 'SHELF_NOT_FOUND'
  | 'GENERIC';

export type RecoveryAction =
  | 'showGitOutput'
  | 'retryInTerminal'
  | 'skipHooksRetry'
  | 'openGitSettings'
  | 'retry'
  | 'openMergeEditor'
  | 'enableGitExtension'
  | 'forceOpenDiff'
  | 'abortSequencer';

export interface ProtocolError {
  code: ErrorCode;
  /** sanitized technical detail (git stderr first line); user-facing summary lives in UI strings */
  message: string;
  gitErrorCode?: string;
  actions: RecoveryAction[];
  /** sanitized equivalent git command for terminal retry */
  terminalCommand?: string;
  /** set for DIFF_GUARDED so "open anyway" can re-issue the same diff request */
  diffContext?: { repoId: string; path: string; side: 'head' | 'staged' | 'worktree' };
  /** set for CHANGELIST_CONFLICT: owning list of the contested path */
  conflictContext?: { repoId: string; path: string; ownerListId: string; ownerListName: string };
  /** set for sequencer CONFLICT so recovery targets the repo that stopped */
  repoId?: string;
}

const BASE_ACTIONS: RecoveryAction[] = ['showGitOutput', 'retryInTerminal'];

/** Map built-in Git extension error codes (GitErrorCodes) to our enum + actions. */
export function mapGitErrorCode(gitErrorCode: string | undefined, rawMessage: string): ProtocolError {
  const detail = summarize(rawMessage);
  switch (gitErrorCode) {
    case 'RepositoryIsLocked':
    case 'CantLockRef':
      return { code: 'LOCKED', message: detail, gitErrorCode, actions: ['retry', ...BASE_ACTIONS] };
    case 'NoUserNameConfigured':
    case 'NoUserEmailConfigured':
      return { code: 'IDENTITY_MISSING', message: detail, gitErrorCode, actions: ['openGitSettings', ...BASE_ACTIONS] };
    case 'AuthenticationFailed':
    case 'PermissionDenied':
      return { code: 'AUTH_FAILED', message: detail, gitErrorCode, actions: BASE_ACTIONS };
    case 'PushRejected':
    case 'PushNotFastForward':
    case 'ForcePushWithLeaseRejected':
      return { code: 'PUSH_REJECTED', message: detail, gitErrorCode, actions: BASE_ACTIONS };
    case 'UnmergedChanges':
    case 'Conflict':
    case 'StashConflict':
      return { code: 'CONFLICT', message: detail, gitErrorCode, actions: ['openMergeEditor', ...BASE_ACTIONS] };
    case 'NoLocalChanges':
    case 'NothingToCommit':
      return { code: 'NO_CHANGES', message: detail, gitErrorCode, actions: ['showGitOutput'] };
    case 'EmptyCommitMessage':
      return { code: 'EMPTY_MESSAGE', message: detail, gitErrorCode, actions: [] };
    case 'ConnectionError':
    case 'RemoteConnectionError':
    case 'NetworkError':
      return { code: 'NETWORK', message: detail, gitErrorCode, actions: ['retry', ...BASE_ACTIONS] };
    case 'DirtyWorkingTree':
    case 'DirtyWorkTree':
      return { code: 'HOOK_FAILED', message: detail, gitErrorCode, actions: BASE_ACTIONS };
    default:
      if (/hook|pre-commit|commit-msg/i.test(rawMessage)) {
        return { code: 'HOOK_FAILED', message: detail, gitErrorCode, actions: ['skipHooksRetry', ...BASE_ACTIONS] };
      }
      return { code: 'GENERIC', message: detail, gitErrorCode, actions: BASE_ACTIONS };
  }
}

function summarize(raw: string): string {
  const firstLine = raw.split('\n').find((l) => l.trim().length > 0) ?? 'Git operation failed';
  return firstLine.length > 200 ? `${firstLine.slice(0, 200)}…` : firstLine;
}

export function makeError(code: ErrorCode, message: string, actions: RecoveryAction[] = []): ProtocolError {
  return { code, message, actions };
}