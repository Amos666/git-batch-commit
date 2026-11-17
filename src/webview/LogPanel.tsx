import { usePanelStore } from './store';

function formatDate(ms?: number): string {
  if (!ms) {
    return '';
  }
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function LogPanel() {
  const panel = usePanelStore((s) => s.logPanel);
  const repos = usePanelStore((s) => s.repos);
  const close = usePanelStore((s) => s.closeLogPanel);
  const setField = usePanelStore((s) => s.setLogField);
  const reload = usePanelStore((s) => s.reloadLog);
  const loadMore = usePanelStore((s) => s.loadMoreLog);
  const showCommit = usePanelStore((s) => s.showCommit);
  const requestAction = usePanelStore((s) => s.requestLogAction);
  const cancelAction = usePanelStore((s) => s.cancelLogAction);
  const confirmAction = usePanelStore((s) => s.confirmLogAction);
  if (!panel) {
    return null;
  }
  const repoName = repos[panel.repoId]?.repo.name ?? panel.repoId;
  const branchName = repos[panel.repoId]?.branch.name ?? '(detached)';
  return (
    <div className="gbc-overlay gbc-logoverlay">
      <div className="gbc-overlay-head">
        <span>提交日志 · {repoName}</span>
        <button className="gbc-linkbtn" onClick={close}>关闭</button>
      </div>
      <div className="gbc-logfilters">
        <input
          className="gbc-loginput"
          type="text"
          placeholder="按作者筛选"
          value={panel.author}
          disabled={panel.busy}
          onChange={(e) => setField('author', e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void reload();
          }}
        />
        <input
          className="gbc-loginput"
          type="text"
          placeholder="按消息筛选（正则，忽略大小写）"
          value={panel.grep}
          disabled={panel.busy}
          onChange={(e) => setField('grep', e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void reload();
          }}
        />
        <button className="gbc-btn" disabled={panel.busy} onClick={() => void reload()}>
          筛选
        </button>
      </div>
      {panel.error && <div className="gbc-op">{panel.error}</div>}
      {panel.confirm && (
        <div className="gbc-confirm">
          {panel.confirm.kind === 'cherry-pick'
            ? `将提交 ${panel.confirm.oid.slice(0, 7)} 拣选到当前分支 ${branchName} 并直接提交？冲突时需解决或中止。`
            : `反转提交 ${panel.confirm.oid.slice(0, 7)} 的改动并放入暂存区（不自动提交，可在提交框检查后提交）？`}
          <div className="gbc-actions">
            <button className="gbc-btn" disabled={panel.busy} onClick={() => void confirmAction()}>
              {panel.confirm.kind === 'cherry-pick' ? '确认拣选' : '确认反转'}
            </button>
            <button className="gbc-btn gbc-btn-secondary" disabled={panel.busy} onClick={cancelAction}>取消</button>
          </div>
        </div>
      )}
      <div className="gbc-loglist">
        {panel.entries.length === 0 && !panel.busy && <div className="gbc-op">没有匹配的提交</div>}
        {panel.entries.map((c) => (
          <div key={c.hash} className="gbc-logrow">
            <button
              className="gbc-logitem"
              title={`${c.hash}\n${c.message}`}
              onClick={() => void showCommit(panel.repoId, c.hash)}
            >
              <span className="gbc-loghash">{c.hash.slice(0, 7)}</span>
              <span className="gbc-logmsg">{c.message.split('\n')[0]}</span>
              <span className="gbc-logmeta">
                {c.authorName ?? ''} {formatDate(c.authorDate)}
              </span>
            </button>
            <span className="gbc-logactions">
              <button
                className="gbc-linkbtn"
                disabled={panel.busy}
                title={`cherry-pick ${c.hash.slice(0, 7)} 到当前分支`}
                onClick={() => requestAction('cherry-pick', c.hash)}
              >
                拣选
              </button>
              <button
                className="gbc-linkbtn"
                disabled={panel.busy}
                title={`revert --no-commit ${c.hash.slice(0, 7)}（反转改动入暂存区）`}
                onClick={() => requestAction('revert', c.hash)}
              >
                反转
              </button>
            </span>
          </div>
        ))}
        {panel.hasMore && (
          <button className="gbc-btn gbc-logmore" disabled={panel.busy} onClick={() => void loadMore()}>
            {panel.busy ? '加载中…' : '加载更多'}
          </button>
        )}
        {panel.busy && panel.entries.length === 0 && <div className="gbc-op">加载中…</div>}
      </div>
    </div>
  );
}