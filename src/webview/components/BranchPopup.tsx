import { useEffect, useRef, useState } from 'react';
import type { MouseEvent as ReactMouseEvent, ReactNode } from 'react';
import type { BranchRef } from '../../protocol/messages';
import { STRINGS } from '../strings/en';
import { usePanelStore } from '../state/StoreContext';
import { Icon } from '../theme/icons/Icon';

const B = STRINGS.branch;
const M = STRINGS.menus.branch;

export function BranchPopup() {
  const picker = usePanelStore((s) => s.branchPicker);
  const closeBranchPicker = usePanelStore((s) => s.closeBranchPicker);
  const setBranchField = usePanelStore((s) => s.setBranchField);
  const checkoutBranch = usePanelStore((s) => s.checkoutBranch);
  const createBranch = usePanelStore((s) => s.createBranch);
  const startRename = usePanelStore((s) => s.startRename);
  const confirmRename = usePanelStore((s) => s.confirmRename);
  const requestDeleteBranch = usePanelStore((s) => s.requestDeleteBranch);
  const confirmDeleteBranch = usePanelStore((s) => s.confirmDeleteBranch);
  const compareBranch = usePanelStore((s) => s.compareBranch);
  const pullRepo = usePanelStore((s) => s.pullRepo);
  const pushRepo = usePanelStore((s) => s.pushRepo);
  const repos = usePanelStore((s) => s.repos);
  const [menu, setMenu] = useState<{ branch: BranchRef; x: number; y: number } | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!picker) {
      return;
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        if (menu) {
          setMenu(null);
        } else {
          closeBranchPicker();
        }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [picker, menu, closeBranchPicker]);

  if (!picker) {
    return null;
  }
  const query = picker.search.trim().toLowerCase();
  const matches = (b: BranchRef): boolean => !query || b.name.toLowerCase().includes(query);
  const local = picker.branches.filter((b) => !b.remote && matches(b));
  const remote = picker.branches.filter((b) => b.remote && matches(b));
  const current = local.find((b) => b.current);
  const repoName = repos[picker.repoId]?.repo.name ?? picker.repoId;

  const rowMenu = (branch: BranchRef, e: ReactMouseEvent): void => {
    e.preventDefault();
    e.stopPropagation();
    setMenu({ branch, x: e.clientX, y: e.clientY });
  };

  const renderRow = (b: BranchRef): ReactNode => {
    if (picker.renaming === b.name) {
      return (
        <li key={`rename-${b.name}`} className="gbc-branchrow gbc-branchrow-edit" data-testid="branch-rename-row">
          <input
            type="text"
            className="gbc-input"
            data-testid="branch-rename-input"
            value={picker.renameTo}
            autoFocus
            onChange={(e) => setBranchField('renameTo', e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                void confirmRename();
              }
            }}
          />
          <button type="button" className="gbc-btn gbc-btn-sm" data-testid="branch-rename-ok" onClick={() => void confirmRename()}>
            {STRINGS.actions.save}
          </button>
          <button type="button" className="gbc-btn gbc-btn-sm" onClick={() => startRename(null)}>
            {STRINGS.actions.cancel}
          </button>
        </li>
      );
    }
    if (picker.confirmDelete === b.name) {
      return (
        <li key={`delete-${b.name}`} className="gbc-branchrow gbc-branchrow-confirm" data-testid="branch-delete-row">
          <span className="gbc-banner-text">{STRINGS.dialogs.branchDeleteBody(b.name)}</span>
          <button type="button" className="gbc-btn gbc-btn-sm gbc-btn-danger" data-testid="branch-delete-ok" onClick={() => void confirmDeleteBranch()}>
            {STRINGS.actions.delete}
          </button>
          <button type="button" className="gbc-btn gbc-btn-sm" onClick={() => requestDeleteBranch(null)}>
            {STRINGS.actions.cancel}
          </button>
        </li>
      );
    }
    const refName = b.remote ? `${b.remote}/${b.name}` : b.name;
    return (
      <li key={refName} className="gbc-branchrow" data-testid="branch-row" data-branch={refName}>
        <button
          type="button"
          className="gbc-branchrow-main"
          disabled={picker.busy || b.current}
          onClick={() => void checkoutBranch(refName)}
        >
          {b.current && <Icon name="check" size={12} />}
          <span className="gbc-branchrow-name">{b.name}</span>
          {b.remote && <span className="gbc-branchrow-remote">{b.remote}</span>}
        </button>
        <button type="button" className="gbc-iconbtn gbc-branchrow-more" aria-label={STRINGS.misc.moreActions} onClick={(e) => rowMenu(b, e)}>
          <Icon name="more" size={12} />
        </button>
      </li>
    );
  };

  return (
    <div
      className="gbc-dialog-overlay gbc-popup-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) {
          closeBranchPicker();
        }
      }}
    >
      <div className="gbc-dialog gbc-branchpopup" ref={panelRef} role="dialog" aria-label={B.title} data-testid="branch-popup">
        <div className="gbc-dialog-head">
          <span className="gbc-dialog-title">
            {B.title} — {repoName}
          </span>
          <button type="button" className="gbc-banner-close" aria-label={STRINGS.actions.close} onClick={closeBranchPicker}>
            <Icon name="close" size={12} />
          </button>
        </div>
        <div className="gbc-branchpopup-search">
          <Icon name="search" size={12} />
          <input
            type="text"
            className="gbc-input"
            data-testid="branch-search"
            placeholder={B.search}
            value={picker.search}
            autoFocus
            onChange={(e) => setBranchField('search', e.target.value)}
          />
        </div>
        <div className="gbc-branchpopup-new">
          <input
            type="text"
            className="gbc-input"
            data-testid="branch-new-name"
            placeholder={STRINGS.dialogs.branchName}
            value={picker.newBranch}
            onChange={(e) => setBranchField('newBranch', e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                void createBranch();
              }
            }}
          />
          <button
            type="button"
            className="gbc-btn gbc-btn-sm"
            data-testid="branch-new-create"
            disabled={picker.busy || !picker.newBranch.trim()}
            onClick={() => void createBranch()}
          >
            {M.newBranch}
          </button>
        </div>
        {picker.error && (
          <div className="gbc-dialog-error" role="alert" data-testid="branch-error">
            {picker.error}
          </div>
        )}
        <div className="gbc-branchpopup-list">
          {current && (
            <>
              <div className="gbc-menu-header">{B.current}</div>
              <ul className="gbc-branchlist">{renderRow(current)}</ul>
            </>
          )}
          <div className="gbc-menu-header">{B.local}</div>
          {local.length === 0 ? (
            <div className="gbc-menu-empty">{B.empty}</div>
          ) : (
            <ul className="gbc-branchlist" data-testid="branch-local">
              {local.filter((b) => !b.current).map(renderRow)}
            </ul>
          )}
          <div className="gbc-menu-header">{B.remote}</div>
          {remote.length === 0 ? (
            <div className="gbc-menu-empty">{B.empty}</div>
          ) : (
            <ul className="gbc-branchlist" data-testid="branch-remote">
              {remote.map(renderRow)}
            </ul>
          )}
        </div>
        <div className="gbc-dialog-foot gbc-branchpopup-foot">
          <button type="button" className="gbc-btn gbc-btn-sm" data-testid="branch-pull" disabled={picker.busy} onClick={() => void pullRepo(picker.repoId)}>
            <Icon name="pull" size={12} /> {B.updateProject}
          </button>
          <button type="button" className="gbc-btn gbc-btn-sm" data-testid="branch-push" disabled={picker.busy} onClick={() => void pushRepo(picker.repoId)}>
            <Icon name="push" size={12} /> {STRINGS.actions.push}
          </button>
        </div>
      </div>
      {menu && (
        <div
          className="gbc-menu gbc-branchmenu"
          role="menu"
          data-testid="branch-menu"
          style={{ position: 'fixed', left: menu.x, top: menu.y }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          {!menu.branch.remote && (
            <>
              <button
                type="button"
                role="menuitem"
                className="gbc-menu-item"
                data-testid="branch-menu-rename"
                onClick={() => {
                  startRename(menu.branch.name);
                  setMenu(null);
                }}
              >
                {M.rename}
              </button>
              <button
                type="button"
                role="menuitem"
                className="gbc-menu-item gbc-menu-danger"
                data-testid="branch-menu-delete"
                disabled={menu.branch.current}
                onClick={() => {
                  requestDeleteBranch(menu.branch.name);
                  setMenu(null);
                }}
              >
                {M.delete}
              </button>
            </>
          )}
          <button
            type="button"
            role="menuitem"
            className="gbc-menu-item"
            data-testid="branch-menu-compare"
            disabled={menu.branch.current}
            onClick={() => {
              void compareBranch(menu.branch.remote ? `${menu.branch.remote}/${menu.branch.name}` : menu.branch.name);
              setMenu(null);
            }}
          >
            {M.compare}
          </button>
        </div>
      )}
    </div>
  );
}