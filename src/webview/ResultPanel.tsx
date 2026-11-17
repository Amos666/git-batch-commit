import type { ProtocolError, RecoveryAction } from '../protocol/errors';
import { usePanelStore } from './store';

const ACTION_LABELS: Record<RecoveryAction, string> = {
  showGitOutput: '查看 Git 输出',
  retryInTerminal: '在终端重试',
  skipHooksRetry: '跳过钩子并重试',
  openGitSettings: '打开 Git 设置',
  enableGitExtension: '启用内置 Git 扩展',
  retry: '重试',
  openMergeEditor: '查看冲突',
  forceOpenDiff: '仍要打开',
  abortSequencer: '中止拣选/反转',
};

export function ErrorActions({ error, repoId }: { error: ProtocolError; repoId?: string }) {
  const runAction = usePanelStore((s) => s.runAction);
  if (error.actions.length === 0) {
    return null;
  }
  return (
    <div className="gbc-actions">
      {error.actions.map((action) => (
        <button key={action} className="gbc-linkbtn" onClick={() => void runAction(action, error, repoId)}>
          {ACTION_LABELS[action]}
        </button>
      ))}
    </div>
  );
}

export function ResultPanel() {
  const results = usePanelStore((s) => s.results);
  const repos = usePanelStore((s) => s.repos);
  const showCommit = usePanelStore((s) => s.showCommit);
  if (!results || results.length === 0) {
    return null;
  }
  return (
    <div className="gbc-results">
      {results.map((r) => {
        const name = repos[r.repoId]?.repo.name ?? r.repoId;
        if (r.skipped) {
          return (
            <div key={r.repoId} className="gbc-result gbc-result-skip">
              ⊘ {name}：{r.skipped === 'cancelled' ? '已取消' : '因前置仓库失败而跳过'}
            </div>
          );
        }
        if (r.ok) {
          return (
            <div key={r.repoId} className="gbc-result gbc-result-ok">
              ✓ {name}：{r.commitOid ? r.commitOid.slice(0, 7) : '已提交'}{r.branch ? ` (${r.branch})` : ''} · {r.durationMs}ms
              {r.commitOid && (
                <button className="gbc-linkbtn" onClick={() => void showCommit(r.repoId, r.commitOid as string)}>
                  查看提交
                </button>
              )}
            </div>
          );
        }
        return (
          <div key={r.repoId} className="gbc-result gbc-result-fail">
            ✗ {name}：{r.error?.message ?? '失败'}
            {r.error && <ErrorActions error={r.error} repoId={r.repoId} />}
          </div>
        );
      })}
    </div>
  );
}