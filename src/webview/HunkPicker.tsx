import { usePanelStore } from './store';

const LINE_RENDER_CAP = 2000;

export function HunkPicker() {
  const picker = usePanelStore((s) => s.hunkPicker);
  const close = usePanelStore((s) => s.closeHunkPicker);
  const toggleHunk = usePanelStore((s) => s.toggleHunk);
  const setAllHunks = usePanelStore((s) => s.setAllHunks);
  const applyHunks = usePanelStore((s) => s.applyHunks);
  if (!picker) {
    return null;
  }
  const stagedSide = picker.side === 'staged';
  const selectedCount = picker.hunks.filter((h) => picker.selected[h.id]).length;
  return (
    <div className="gbc-overlay gbc-hunkoverlay">
      <div className="gbc-overlay-head">
        <span title={picker.path}>
          Hunk · {picker.path} · {stagedSide ? '取消暂存' : '暂存'}
        </span>
        <button className="gbc-linkbtn" onClick={close}>关闭</button>
      </div>
      {picker.busy && picker.hunks.length === 0 && <div className="gbc-op">加载中…</div>}
      {picker.error && <div className="gbc-op">{picker.error}</div>}
      {picker.binary && <div className="gbc-op">二进制文件不支持 Hunk 级操作</div>}
      {!picker.busy && !picker.binary && picker.hunks.length === 0 && !picker.error && (
        <div className="gbc-op">没有差异 Hunk</div>
      )}
      <div className="gbc-hunklist">
        {picker.hunks.map((h) => (
          <div key={h.id} className="gbc-hunk">
            <label className="gbc-hunkhead">
              <input
                type="checkbox"
                checked={picker.selected[h.id] ?? false}
                disabled={picker.busy}
                onChange={() => toggleHunk(h.id)}
              />
              <span className="gbc-hunkheader">{h.header}</span>
            </label>
            <pre className="gbc-hunkbody">
              {h.lines.slice(0, LINE_RENDER_CAP).map((line, i) => (
                <div
                  key={i}
                  className={
                    line.startsWith('+') ? 'gbc-line-add'
                    : line.startsWith('-') ? 'gbc-line-del'
                    : line.startsWith('\\') ? 'gbc-line-meta'
                    : 'gbc-line-ctx'
                  }
                >
                  {line || ' '}
                </div>
              ))}
              {h.lines.length > LINE_RENDER_CAP && (
                <div className="gbc-line-meta">… 其余 {h.lines.length - LINE_RENDER_CAP} 行省略</div>
              )}
            </pre>
          </div>
        ))}
      </div>
      <div className="gbc-actions gbc-hunkactions">
        <button className="gbc-linkbtn" disabled={picker.busy} onClick={() => setAllHunks(true)}>全选</button>
        <button className="gbc-linkbtn" disabled={picker.busy} onClick={() => setAllHunks(false)}>全不选</button>
        <button
          className="gbc-btn"
          disabled={picker.busy || picker.binary || selectedCount === 0}
          onClick={() => void applyHunks()}
        >
          {picker.busy ? '应用中…' : `${stagedSide ? '取消暂存' : '暂存'}选中 (${selectedCount})`}
        </button>
      </div>
    </div>
  );
}