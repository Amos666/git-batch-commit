import { usePanelStore } from './store';

export function StashPanel() {
  const panel = usePanelStore((s) => s.stashPanel);
  const repos = usePanelStore((s) => s.repos);
  const close = usePanelStore((s) => s.closeStashPanel);
  const setField = usePanelStore((s) => s.setStashField);
  const createStash = usePanelStore((s) => s.createStash);
  const applyStash = usePanelStore((s) => s.applyStash);
  const requestPop = usePanelStore((s) => s.requestPopStash);
  const popStash = usePanelStore((s) => s.popStash);
  const requestDrop = usePanelStore((s) => s.requestDropStash);
  const dropStash = usePanelStore((s) => s.dropStash);
  if (!panel) {
    return null;
  }
  const repoName = repos[panel.repoId]?.repo.name ?? panel.repoId;
  return (
    <div className="gbc-overlay gbc-stashoverlay">
      <div className="gbc-overlay-head">
        <span>Stash · {repoName}</span>
        <button className="gbc-linkbtn" onClick={close}>关闭</button>
      </div>
      <div className="gbc-stashcreate">
        <input
          className="gbc-stashmsg"
          type="text"
          placeholder="Stash 消息（可选）"
          value={panel.message}
          disabled={panel.busy}
          onChange={(e) => setField('message', e.target.value)}
        />
        <label title="包含未跟踪文件（-u）">
          <input
            type="checkbox"
            checked={panel.includeUntracked}
            disabled={panel.busy}
            onChange={(e) => setField('includeUntracked', e.target.checked)}
          />
          含未跟踪
        </label>
        <label title="仅暂存已 staged 的改动（-S）">
          <input
            type="checkbox"
            checked={panel.stagedOnly}
            disabled={panel.busy}
            onChange={(e) => setField('stagedOnly', e.target.checked)}
          />
          仅已暂存
        </label>
        <button className="gbc-btn" disabled={panel.busy} onClick={() => void createStash()}>
          {panel.busy ? '处理中…' : '创建 Stash'}
        </button>
      </div>
      {panel.error && <div className="gbc-op">{panel.error}</div>}
      <div className="gbc-stashlist">
        {panel.entries.length === 0 && !panel.busy && <div className="gbc-op">没有 stash</div>}
        {panel.entries.map((s) => (
          <div key={s.hash} className="gbc-stashitem">
            <div className="gbc-stashinfo">
              <span className="gbc-stashref">stash@{'{'}{s.index}{'}'}</span>
              <span className="gbc-stashdesc" title={s.description}>{s.description}</span>
              {s.branchName && <span className="gbc-stashbranch">{s.branchName}</span>}
            </div>
            <div className="gbc-actions">
              <button className="gbc-linkbtn" disabled={panel.busy} onClick={() => void applyStash(s.index)}>应用</button>
              <button className="gbc-linkbtn" disabled={panel.busy} onClick={() => requestPop(s.index)}>弹出</button>
              <button className="gbc-linkbtn gbc-danger" disabled={panel.busy} onClick={() => requestDrop(s.index)}>丢弃</button>
            </div>
            {panel.confirmPop === s.index && (
              <div className="gbc-confirm">
                弹出将应用改动并删除该 stash，确认？
                <div className="gbc-actions">
                  <button className="gbc-btn" onClick={() => void popStash(s.index)}>确认弹出</button>
                  <button className="gbc-btn gbc-btn-secondary" onClick={() => requestPop(null)}>取消</button>
                </div>
              </div>
            )}
            {panel.confirmDrop === s.index && (
              <div className="gbc-confirm">
                确认丢弃 stash@{'{'}{s.index}{'}'}？丢弃后不可恢复。
                <div className="gbc-actions">
                  <button className="gbc-btn gbc-btn-danger" onClick={() => void dropStash(s.index)}>确认丢弃</button>
                  <button className="gbc-btn gbc-btn-secondary" onClick={() => requestDrop(null)}>取消</button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}