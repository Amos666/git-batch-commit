import { usePanelStore } from './store';

export function ShelfPanel() {
  const panel = usePanelStore((s) => s.shelfPanel);
  const repos = usePanelStore((s) => s.repos);
  const close = usePanelStore((s) => s.closeShelfPanel);
  const setName = usePanelStore((s) => s.setShelfName);
  const toggleFile = usePanelStore((s) => s.toggleShelfFile);
  const requestCreate = usePanelStore((s) => s.requestShelfCreate);
  const cancelCreate = usePanelStore((s) => s.cancelShelfCreate);
  const confirmCreate = usePanelStore((s) => s.confirmShelfCreate);
  const openUnshelve = usePanelStore((s) => s.openUnshelve);
  const toggleUnshelveFile = usePanelStore((s) => s.toggleUnshelveFile);
  const setRemoveAfter = usePanelStore((s) => s.setUnshelveRemoveAfter);
  const doUnshelve = usePanelStore((s) => s.doUnshelve);
  const requestDelete = usePanelStore((s) => s.requestShelfDelete);
  const confirmDelete = usePanelStore((s) => s.confirmShelfDelete);
  if (!panel) {
    return null;
  }
  const repoName = repos[panel.repoId]?.repo.name ?? panel.repoId;
  const candidates = (repos[panel.repoId]?.changes ?? []).filter((c) => !c.conflicted && c.kind !== 'untracked');
  const selectedCount = Object.values(panel.selected).filter(Boolean).length;
  const unshelveEntry = panel.unshelve ? panel.entries.find((e) => e.id === panel.unshelve?.id) : undefined;
  return (
    <div className="gbc-overlay gbc-shelfoverlay">
      <div className="gbc-overlay-head">
        <span>Shelf · {repoName}</span>
        <button className="gbc-linkbtn" onClick={close}>关闭</button>
      </div>
      <div className="gbc-shelfcreate">
        <input
          className="gbc-shelfname"
          type="text"
          placeholder="Shelf 名称（必填）"
          value={panel.name}
          disabled={panel.busy}
          onChange={(e) => setName(e.target.value)}
        />
        <button className="gbc-btn" disabled={panel.busy} onClick={requestCreate}>
          {panel.busy ? '处理中…' : `搁置选中 (${selectedCount})`}
        </button>
      </div>
      {candidates.length > 0 && (
        <div className="gbc-shelffiles">
          {candidates.map((c) => (
            <label key={c.path} className="gbc-shelffile" title={c.path}>
              <input
                type="checkbox"
                checked={!!panel.selected[c.path]}
                disabled={panel.busy}
                onChange={() => toggleFile(c.path)}
              />
              <span className="gbc-path">{c.path}</span>
            </label>
          ))}
        </div>
      )}
      {candidates.length === 0 && <div className="gbc-op">没有可搁置的已跟踪改动</div>}
      {panel.confirmCreate && (
        <div className="gbc-confirm">
          搁置将保存补丁并把选中 {selectedCount} 个文件的工作区与暂存区恢复到 HEAD（改动存入 Shelf，可恢复）。确认？
          <div className="gbc-actions">
            <button className="gbc-btn gbc-btn-danger" disabled={panel.busy} onClick={() => void confirmCreate()}>确认搁置</button>
            <button className="gbc-btn gbc-btn-secondary" disabled={panel.busy} onClick={cancelCreate}>取消</button>
          </div>
        </div>
      )}
      {panel.error && <div className="gbc-op">{panel.error}</div>}
      <div className="gbc-shelflist">
        {panel.entries.length === 0 && !panel.busy && <div className="gbc-op">没有 Shelf</div>}
        {panel.entries.map((e) => (
          <div key={e.id} className="gbc-shelfitem">
            <div className="gbc-shelfinfo">
              <span className="gbc-shelftitle" title={e.name}>{e.name}</span>
              <span className="gbc-shelfmeta">{e.files.length} 文件 · {e.branch || '(detached)'} · {new Date(e.createdAt).toLocaleString()}</span>
            </div>
            <div className="gbc-actions">
              <button className="gbc-linkbtn" disabled={panel.busy} onClick={() => openUnshelve(panel.unshelve?.id === e.id ? null : e.id)}>
                {panel.unshelve?.id === e.id ? '收起' : '恢复…'}
              </button>
              <button className="gbc-linkbtn gbc-danger" disabled={panel.busy} onClick={() => requestDelete(panel.confirmDelete === e.id ? null : e.id)}>删除</button>
            </div>
            {panel.unshelve?.id === e.id && unshelveEntry && (
              <div className="gbc-shelfunshelve">
                {unshelveEntry.files.map((f) => (
                  <label key={f} className="gbc-shelffile" title={f}>
                    <input
                      type="checkbox"
                      checked={!!panel.unshelve?.selected[f]}
                      disabled={panel.busy}
                      onChange={() => toggleUnshelveFile(f)}
                    />
                    <span className="gbc-path">{f}</span>
                  </label>
                ))}
                <label title="恢复成功后删除该 Shelf">
                  <input
                    type="checkbox"
                    checked={panel.unshelve.removeAfter}
                    disabled={panel.busy}
                    onChange={(ev) => setRemoveAfter(ev.target.checked)}
                  />
                  恢复后删除
                </label>
                <button className="gbc-btn" disabled={panel.busy} onClick={() => void doUnshelve()}>
                  {panel.busy ? '恢复中…' : '恢复到当前分支'}
                </button>
              </div>
            )}
            {panel.confirmDelete === e.id && (
              <div className="gbc-confirm">
                确认删除 Shelf「{e.name}」？补丁删除后不可恢复。
                <div className="gbc-actions">
                  <button className="gbc-btn gbc-btn-danger" disabled={panel.busy} onClick={() => void confirmDelete()}>确认删除</button>
                  <button className="gbc-btn gbc-btn-secondary" disabled={panel.busy} onClick={() => requestDelete(null)}>取消</button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}