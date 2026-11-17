import { useEffect } from 'react';
import { CommitBox } from './CommitBox';
import { HunkPicker } from './HunkPicker';
import { LogPanel } from './LogPanel';
import { ErrorActions, ResultPanel } from './ResultPanel';
import { ShelfPanel } from './ShelfPanel';
import { StashPanel } from './StashPanel';
import { subscribeEvents, usePanelStore } from './store';
import { request } from './bridge';
import { VirtualPanel } from './VirtualPanel';

function BranchPicker() {
  const picker = usePanelStore((s) => s.branchPicker);
  const repos = usePanelStore((s) => s.repos);
  const close = usePanelStore((s) => s.closeBranchPicker);
  const checkout = usePanelStore((s) => s.checkoutBranch);
  const setField = usePanelStore((s) => s.setBranchField);
  const create = usePanelStore((s) => s.createBranch);
  const startRename = usePanelStore((s) => s.startRename);
  const confirmRename = usePanelStore((s) => s.confirmRename);
  const requestDelete = usePanelStore((s) => s.requestDeleteBranch);
  const confirmDelete = usePanelStore((s) => s.confirmDeleteBranch);
  const compare = usePanelStore((s) => s.compareBranch);
  if (!picker) {
    return null;
  }
  const repoName = repos[picker.repoId]?.repo.name ?? picker.repoId;
  return (
    <div className="gbc-overlay gbc-branchmgr">
      <div className="gbc-overlay-head">
        <span>分支管理 · {repoName}</span>
        <button className="gbc-linkbtn" onClick={close}>关闭</button>
      </div>
      <div className="gbc-branchcreate">
        <input
          className="gbc-branchinput"
          placeholder="新分支名"
          value={picker.newBranch}
          disabled={picker.busy}
          onChange={(e) => setField('newBranch', e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void create();
          }}
        />
        <button
          className="gbc-btn"
          disabled={picker.busy || !picker.newBranch.trim()}
          onClick={() => void create()}
        >
          创建并切换
        </button>
      </div>
      {picker.error && <div className="gbc-op">{picker.error}</div>}
      <div className="gbc-branchlist">
        {picker.branches.map((b) => (
          <div key={b.name} className="gbc-branchrow">
            <button
              className={`gbc-branchitem${b.current ? ' gbc-branchitem-current' : ''}`}
              disabled={picker.busy}
              onClick={() => void checkout(b.name)}
            >
              {b.current ? '● ' : ''}{b.name}
            </button>
            <span className="gbc-branchactions">
              {!b.current && (
                <button className="gbc-linkbtn" disabled={picker.busy} onClick={() => void compare(b.name)}>
                  对比
                </button>
              )}
              <button className="gbc-linkbtn" disabled={picker.busy} onClick={() => startRename(b.name)}>
                重命名
              </button>
              {!b.current && (
                <button className="gbc-linkbtn" disabled={picker.busy} onClick={() => requestDelete(b.name)}>
                  删除
                </button>
              )}
            </span>
            {picker.renaming === b.name && (
              <div className="gbc-branchconfirm">
                <input
                  className="gbc-branchinput"
                  value={picker.renameTo}
                  disabled={picker.busy}
                  onChange={(e) => setField('renameTo', e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void confirmRename();
                    if (e.key === 'Escape') {
                      e.stopPropagation();
                      startRename(null);
                    }
                  }}
                />
                <button
                  className="gbc-btn"
                  disabled={picker.busy || !picker.renameTo.trim() || picker.renameTo.trim() === b.name}
                  onClick={() => void confirmRename()}
                >
                  确认
                </button>
                <button className="gbc-linkbtn" onClick={() => startRename(null)}>取消</button>
              </div>
            )}
            {picker.confirmDelete === b.name && (
              <div className="gbc-branchconfirm">
                <span className="gbc-confirmtext">删除分支 {b.name}？未合并的提交将被 Git 拒绝删除。</span>
                <button className="gbc-btn gbc-btn-danger" disabled={picker.busy} onClick={() => void confirmDelete()}>
                  确认删除
                </button>
                <button className="gbc-linkbtn" onClick={() => requestDelete(null)}>取消</button>
              </div>
            )}
          </div>
        ))}
        {picker.branches.length === 0 && !picker.error && <div className="gbc-op">没有本地分支</div>}
      </div>
    </div>
  );
}

function AbortConfirm() {
  const repoId = usePanelStore((s) => s.abortConfirm);
  const repos = usePanelStore((s) => s.repos);
  const request = usePanelStore((s) => s.requestAbortMerge);
  const confirm = usePanelStore((s) => s.confirmAbortMerge);
  if (!repoId) {
    return null;
  }
  const repoName = repos[repoId]?.repo.name ?? repoId;
  return (
    <div className="gbc-overlay">
      <div className="gbc-confirm">
        中止 {repoName} 进行中的合并/变基/拣选/反转？未提交的进度将被丢弃，工作区恢复到操作前状态。
        <div className="gbc-actions">
          <button className="gbc-btn gbc-btn-danger" onClick={() => void confirm()}>确认中止</button>
          <button className="gbc-btn gbc-btn-secondary" onClick={() => request(null)}>取消</button>
        </div>
      </div>
    </div>
  );
}

function UndoConfirm() {
  const repoId = usePanelStore((s) => s.undoConfirm);
  const repos = usePanelStore((s) => s.repos);
  const request = usePanelStore((s) => s.requestUndoCommit);
  const confirm = usePanelStore((s) => s.confirmUndoCommit);
  if (!repoId) {
    return null;
  }
  const status = repos[repoId];
  const repoName = status?.repo.name ?? repoId;
  const oid = status?.branch.oid?.slice(0, 7) ?? '';
  return (
    <div className="gbc-overlay">
      <div className="gbc-confirm">
        撤销 {repoName} 的最新提交{oid ? ` ${oid}` : ''}？改动将保留在暂存区（soft reset，不丢失工作区内容）。已推送到远端的提交会被阻止撤销。
        <div className="gbc-actions">
          <button className="gbc-btn gbc-btn-danger" onClick={() => void confirm()}>确认撤销</button>
          <button className="gbc-btn gbc-btn-secondary" onClick={() => request(null)}>取消</button>
        </div>
      </div>
    </div>
  );
}

export function App() {
  const panelState = usePanelStore((s) => s.panelState);
  const lastError = usePanelStore((s) => s.lastError);
  const dismissError = usePanelStore((s) => s.dismissError);
  const runAction = usePanelStore((s) => s.runAction);

  useEffect(() => {
    const off = subscribeEvents();
    const reportFocus = (focused: boolean) => {
      void request('ui.focus', { focused }).catch(() => {});
    };
    const onFocus = () => reportFocus(true);
    const onBlur = () => reportFocus(false);
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') {
        return;
      }
      const s = usePanelStore.getState();
      if (s.abortConfirm) {
        s.requestAbortMerge(null);
      } else if (s.undoConfirm) {
        s.requestUndoCommit(null);
      } else if (s.hunkPicker) {
        s.closeHunkPicker();
      } else if (s.shelfPanel) {
        s.closeShelfPanel();
      } else if (s.stashPanel) {
        s.closeStashPanel();
      } else if (s.logPanel) {
        s.closeLogPanel();
      } else if (s.branchPicker) {
        s.closeBranchPicker();
      } else if (s.historyOpen) {
        void s.toggleHistory();
      } else if (s.confirmNoVerify || s.lastError) {
        s.dismissError();
      }
    };
    window.addEventListener('focus', onFocus);
    window.addEventListener('blur', onBlur);
    window.addEventListener('keydown', onKeyDown);
    reportFocus(document.hasFocus());
    return () => {
      off();
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('keydown', onKeyDown);
      reportFocus(false);
    };
  }, []);

  if (panelState === 'initializing') {
    return <div className="gbc-guidance">正在绑定内置 Git 扩展…</div>;
  }

  if (panelState === 'git-extension-unavailable') {
    return (
      <div className="gbc-guidance">
        <p>内置 Git 扩展（vscode.git）不可用。</p>
        <p>请确认已启用内置 Git 扩展，且系统已安装 Git。</p>
        <button className="gbc-btn" onClick={() => void runAction('openGitSettings', { code: 'GIT_EXTENSION_UNAVAILABLE', message: '', actions: [] })}>
          打开 Git 设置
        </button>
      </div>
    );
  }

  return (
    <div className="gbc-panel">
      <VirtualPanel />
      <BranchPicker />
      <HunkPicker />
      <StashPanel />
      <ShelfPanel />
      <LogPanel />
      <AbortConfirm />
      <UndoConfirm />
      {lastError && (
        <div className="gbc-error">
          {lastError.message}
          <ErrorActions error={lastError} />
          <div className="gbc-actions">
            <button className="gbc-linkbtn" onClick={dismissError}>关闭</button>
          </div>
        </div>
      )}
      <ResultPanel />
      <CommitBox />
    </div>
  );
}