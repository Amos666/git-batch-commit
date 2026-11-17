export type ErrorCode =
  | 'GIT_EXTENSION_UNAVAILABLE'
  | 'GIT_NOT_FOUND'
  | 'NO_REPOSITORY'
  | 'EMPTY_MESSAGE'
  | 'NO_CHANGES'
  | 'STAGED_MISMATCH'
  | 'HOOK_FAILED'
  | 'IDENTITY_MISSING'
  | 'AUTH_FAILED'
  | 'LOCKED'
  | 'PUSH_REJECTED'
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
  message: string;
  gitErrorCode?: string;
  actions: RecoveryAction[];
  /** sanitized equivalent git command for terminal retry */
  terminalCommand?: string;
  /** set for DIFF_GUARDED so "open anyway" can re-issue the same diff request */
  diffContext?: { repoId: string; path: string; side: 'head' | 'staged' | 'worktree' };
}

const BASE_ACTIONS: RecoveryAction[] = ['showGitOutput', 'retryInTerminal'];

/** Map built-in Git extension error codes (GitErrorCodes) to our enum + actions. */
export function mapGitErrorCode(gitErrorCode: string | undefined, rawMessage: string): ProtocolError {
  switch (gitErrorCode) {
    case 'RepositoryIsLocked':
    case 'CantLockRef':
      return { code: 'LOCKED', message: '仓库被其他 Git 进程锁定（已自动重试仍失败）', gitErrorCode, actions: ['retry', ...BASE_ACTIONS] };
    case 'NoUserNameConfigured':
    case 'NoUserEmailConfigured':
      return { code: 'IDENTITY_MISSING', message: 'Git 提交身份未配置（user.name / user.email）', gitErrorCode, actions: ['openGitSettings', ...BASE_ACTIONS] };
    case 'AuthenticationFailed':
    case 'PermissionDenied':
      return { code: 'AUTH_FAILED', message: '远端认证失败', gitErrorCode, actions: BASE_ACTIONS };
    case 'PushRejected':
    case 'PushNotFastForward':
    case 'ForcePushWithLeaseRejected':
      return { code: 'PUSH_REJECTED', message: '推送被拒绝：远端有新提交，请先拉取/变基', gitErrorCode, actions: BASE_ACTIONS };
    case 'UnmergedChanges':
    case 'Conflict':
    case 'StashConflict':
      return { code: 'CONFLICT', message: '存在未解决的冲突', gitErrorCode, actions: ['openMergeEditor', ...BASE_ACTIONS] };
    case 'NoLocalChanges':
    case 'NothingToCommit':
      return { code: 'NO_CHANGES', message: '没有可提交的内容', gitErrorCode, actions: ['showGitOutput'] };
    case 'EmptyCommitMessage':
      return { code: 'EMPTY_MESSAGE', message: '提交消息为空', gitErrorCode, actions: [] };
    case 'ConnectionError':
    case 'RemoteConnectionError':
    case 'NetworkError':
      return { code: 'NETWORK', message: '无法连接远端', gitErrorCode, actions: ['retry', ...BASE_ACTIONS] };
    case 'DirtyWorkingTree':
    case 'DirtyWorkTree':
      return { code: 'HOOK_FAILED', message: '工作区不干净，操作被阻止', gitErrorCode, actions: BASE_ACTIONS };
    default:
      if (/hook|pre-commit|commit-msg/i.test(rawMessage)) {
        return { code: 'HOOK_FAILED', message: 'Git 钩子执行失败', gitErrorCode, actions: ['skipHooksRetry', ...BASE_ACTIONS] };
      }
      return { code: 'GENERIC', message: summarize(rawMessage), gitErrorCode, actions: BASE_ACTIONS };
  }
}

function summarize(raw: string): string {
  const firstLine = raw.split('\n').find((l) => l.trim().length > 0) ?? 'Git 操作失败';
  return firstLine.length > 200 ? `${firstLine.slice(0, 200)}…` : firstLine;
}

export function makeError(code: ErrorCode, message: string, actions: RecoveryAction[] = []): ProtocolError {
  return { code, message, actions };
}