import { useState } from 'react';
import type { KeyboardEvent } from 'react';
import { usePanelStore } from './store';

export function CommitBox() {
  const message = usePanelStore((s) => s.message);
  const setMessage = usePanelStore((s) => s.setMessage);
  const committing = usePanelStore((s) => s.committing);
  const commit = usePanelStore((s) => s.commit);
  const cancelRemaining = usePanelStore((s) => s.cancelRemaining);
  const confirmNoVerify = usePanelStore((s) => s.confirmNoVerify);
  const dismissError = usePanelStore((s) => s.dismissError);
  const repos = usePanelStore((s) => s.repos);
  const repoOrder = usePanelStore((s) => s.repoOrder);
  const options = usePanelStore((s) => s.options);
  const setOption = usePanelStore((s) => s.setOption);
  const history = usePanelStore((s) => s.history);
  const historyOpen = usePanelStore((s) => s.historyOpen);
  const toggleHistory = usePanelStore((s) => s.toggleHistory);
  const pickHistory = usePanelStore((s) => s.pickHistory);
  const [menuOpen, setMenuOpen] = useState(false);

  const stagedCount = repoOrder.reduce((sum, id) => {
    const status = repos[id];
    return sum + (status ? status.changes.filter((c) => c.staged && !c.conflicted).length : 0);
  }, 0);
  const hasConflict = repoOrder.some((id) => repos[id]?.changes.some((c) => c.conflicted));

  let disabledReason: string | null = null;
  if (committing) {
    disabledReason = '提交进行中…';
  } else if (hasConflict) {
    disabledReason = '存在未解决冲突';
  } else if (repoOrder.length === 0) {
    disabledReason = '没有打开的仓库';
  } else if (options.amend) {
    if (stagedCount === 0 && repoOrder.length > 1) {
      disabledReason = '多仓库 Amend 需勾选文件以指定仓库';
    }
  } else if (stagedCount === 0) {
    disabledReason = '勾选文件即暂存，然后提交';
  } else if (!message.trim()) {
    disabledReason = '请输入提交消息';
  }

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && !disabledReason) {
      e.preventDefault();
      void commit();
    }
  };

  const runCommit = (pushAfter?: boolean) => {
    setMenuOpen(false);
    void commit(pushAfter ? { pushAfter } : undefined);
  };

  return (
    <div className="gbc-commitbox">
      <textarea
        value={message}
        placeholder={options.amend ? 'Amend 消息（留空则保留原消息，Ctrl+Enter 提交）' : '提交消息（Ctrl+Enter 提交）'}
        onChange={(e) => setMessage(e.target.value)}
        onKeyDown={onKeyDown}
        disabled={committing}
      />
      <div className="gbc-optionsrow">
        <label title="改写上一提交（--amend）；已推送的提交请谨慎使用">
          <input
            type="checkbox"
            checked={options.amend}
            disabled={committing}
            onChange={(e) => setOption('amend', e.target.checked)}
          />
          Amend
        </label>
        <label title="跳过 pre-commit / commit-msg 钩子（--no-verify），提交前需确认">
          <input
            type="checkbox"
            checked={options.noVerify}
            disabled={committing}
            onChange={(e) => setOption('noVerify', e.target.checked)}
          />
          跳过钩子
        </label>
        <label title="追加 Signed-off-by 签名行（--signoff）">
          <input
            type="checkbox"
            checked={options.signoff}
            disabled={committing}
            onChange={(e) => setOption('signoff', e.target.checked)}
          />
          Sign-off
        </label>
        <button className="gbc-linkbtn" onClick={() => void toggleHistory()}>历史 ▾</button>
      </div>
      {historyOpen && (
        <div className="gbc-history">
          {(history ?? []).length === 0 && <div className="gbc-op">暂无历史消息</div>}
          {(history ?? []).map((m, i) => (
            <button key={`${i}-${m.slice(0, 20)}`} className="gbc-historyitem" onClick={() => pickHistory(m)} title={m}>
              {m.split('\n')[0]}
            </button>
          ))}
        </div>
      )}
      {confirmNoVerify && (
        <div className="gbc-confirm">
          确认跳过 Git 钩子（--no-verify）并提交？
          <div className="gbc-actions">
            <button className="gbc-btn" onClick={() => void commit({ confirmed: true, noVerify: true })}>确认跳过</button>
            <button className="gbc-btn gbc-btn-secondary" onClick={dismissError}>取消</button>
          </div>
        </div>
      )}
      <div className="gbc-commitrow">
        <span className="gbc-splitbtn">
          <button
            className="gbc-btn"
            disabled={disabledReason !== null}
            onClick={() => runCommit()}
            title={disabledReason ?? (options.amend ? 'Amend 上一提交' : '提交已暂存内容')}
          >
            {committing ? '提交中…' : `${options.amend ? 'Amend' : 'Commit'}${stagedCount > 0 ? ` (${stagedCount})` : ''}`}
          </button>
          <button
            className="gbc-btn gbc-splitarrow"
            disabled={disabledReason !== null}
            onClick={() => setMenuOpen(!menuOpen)}
            title="更多提交方式"
          >
            ▾
          </button>
        </span>
        {menuOpen && (
          <div className="gbc-commitmenu">
            <button className="gbc-historyitem" onClick={() => runCommit(true)}>Commit &amp; Push</button>
          </div>
        )}
        {committing && (
          <button className="gbc-btn gbc-btn-secondary" onClick={cancelRemaining}>取消后续仓库</button>
        )}
        <span className="gbc-hint">{disabledReason ?? 'Ctrl+Enter'}</span>
      </div>
    </div>
  );
}