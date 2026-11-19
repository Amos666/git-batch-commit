/** Component styles for the IDEA-form Commit tool window; colors come from tokens.ts. */
export const STYLES = `
.gbc-panel { display: flex; flex-direction: column; height: 100%; overflow: hidden; }

/* tabs */
.gbc-tabbar { display: flex; gap: 2px; padding: 4px 6px 0; border-bottom: 1px solid var(--gbc-border); flex: none; }
.gbc-tab { background: none; border: none; border-bottom: 2px solid transparent; padding: 4px 10px; cursor: pointer; color: var(--gbc-fg-muted); }
.gbc-tab:hover { color: var(--gbc-fg); }
.gbc-tab-active { color: var(--gbc-fg); border-bottom-color: var(--gbc-focus); font-weight: 600; }

/* toolbar */
.gbc-toolbar { display: flex; align-items: center; gap: 2px; padding: 4px 6px; border-bottom: 1px solid var(--gbc-border); flex: none; }
.gbc-toolbar-spacer { flex: 1; }
.gbc-toolbar-mode { display: flex; align-items: center; }
.gbc-mode-toggle { display: inline-flex; align-items: center; gap: 4px; background: none; border: 1px solid var(--gbc-border); border-radius: 3px; padding: 2px 6px; cursor: pointer; color: var(--gbc-fg-muted); font-size: var(--gbc-font-size-small); }
.gbc-mode-toggle:hover { color: var(--gbc-fg); background: var(--gbc-hover); }
.gbc-iconbtn { display: inline-flex; align-items: center; justify-content: center; width: 24px; height: 24px; background: none; border: none; border-radius: 3px; cursor: pointer; color: var(--gbc-fg); padding: 0; }
.gbc-iconbtn:hover:not(:disabled) { background: var(--gbc-hover); }
.gbc-iconbtn:disabled { opacity: .4; cursor: default; }
.gbc-iconbtn-active { background: var(--gbc-hover); }
.gbc-iconbtn-danger { color: var(--gbc-error); }
.gbc-viewoptions { position: relative; display: inline-flex; }
.gbc-viewmenu { position: absolute; right: 0; top: 26px; z-index: 40; min-width: 200px; }

/* tooltip */
.gbc-tooltip { position: relative; display: inline-flex; }
.gbc-tooltip:hover::after {
  content: attr(data-tooltip); position: absolute; top: 100%; left: 50%; transform: translateX(-50%);
  margin-top: 4px; padding: 3px 8px; background: var(--gbc-overlay-bg); color: var(--gbc-fg);
  border: 1px solid var(--gbc-border); border-radius: 3px; font-size: var(--gbc-font-size-small);
  white-space: nowrap; z-index: 60; pointer-events: none;
}

/* buttons */
.gbc-btn { display: inline-flex; align-items: center; gap: 4px; background: var(--gbc-btn2-bg); color: var(--gbc-btn2-fg); border: 1px solid var(--gbc-border); border-radius: 3px; padding: 4px 12px; cursor: pointer; }
.gbc-btn:hover:not(:disabled) { background: var(--gbc-btn2-hover); }
.gbc-btn:disabled { opacity: .5; cursor: default; }
.gbc-btn-primary { background: var(--gbc-btn-bg); color: var(--gbc-btn-fg); border-color: transparent; }
.gbc-btn-primary:hover:not(:disabled) { background: var(--gbc-btn-hover); }
.gbc-btn-danger { color: var(--gbc-error); }
.gbc-btn-sm { padding: 2px 8px; font-size: var(--gbc-font-size-small); }
.gbc-spinner { width: 12px; height: 12px; border: 2px solid var(--gbc-fg-muted); border-top-color: transparent; border-radius: 50%; animation: gbc-spin .8s linear infinite; flex: none; }
@keyframes gbc-spin { to { transform: rotate(360deg); } }

/* split button */
.gbc-split { position: relative; display: inline-flex; }
.gbc-split-main { border-radius: 3px 0 0 3px; background: var(--gbc-btn-bg); color: var(--gbc-btn-fg); border-color: transparent; font-weight: 600; }
.gbc-split-main:hover:not(:disabled) { background: var(--gbc-btn-hover); }
.gbc-split-arrow { border-radius: 0 3px 3px 0; background: var(--gbc-btn-bg); color: var(--gbc-btn-fg); border-color: transparent; border-left: 1px solid rgba(255,255,255,.25); padding: 4px 6px; }
.gbc-split-arrow:hover:not(:disabled) { background: var(--gbc-btn-hover); }
.gbc-split-menu { display: none; position: absolute; top: 100%; right: 0; margin-top: 2px; min-width: 180px; background: var(--gbc-menu-bg); border: 1px solid var(--gbc-menu-border); border-radius: 4px; padding: 4px 0; z-index: 40; box-shadow: 0 4px 12px rgba(0,0,0,.35); }
.gbc-split-open .gbc-split-menu { display: block; }
.gbc-split-menu .gbc-menu-item { width: 100%; background: none; border: none; text-align: left; padding: 5px 12px; cursor: pointer; color: var(--gbc-menu-fg); }
.gbc-split-menu .gbc-menu-item:hover:not(:disabled) { background: var(--gbc-menu-hover); color: var(--gbc-menu-hover-fg); }
.gbc-split-menu .gbc-menu-item:disabled { opacity: .5; cursor: default; }

/* menus */
.gbc-menu { background: var(--gbc-menu-bg); color: var(--gbc-menu-fg); border: 1px solid var(--gbc-menu-border); border-radius: 4px; padding: 4px 0; box-shadow: 0 4px 12px rgba(0,0,0,.35); z-index: 50; min-width: 180px; }
.gbc-menu-header { padding: 4px 12px 2px; font-size: var(--gbc-font-size-small); color: var(--gbc-fg-muted); text-transform: none; }
.gbc-menu-item { display: flex; align-items: center; gap: 8px; width: 100%; background: none; border: none; text-align: left; padding: 5px 12px; cursor: pointer; color: var(--gbc-menu-fg); }
.gbc-menu-item:hover:not(:disabled) { background: var(--gbc-menu-hover); color: var(--gbc-menu-hover-fg); }
.gbc-menu-item:disabled { opacity: .45; cursor: default; }
.gbc-menu-item-danger { color: var(--gbc-error); }
.gbc-menu-icon { width: 16px; display: inline-flex; flex: none; }
.gbc-menu-label { flex: 1; white-space: nowrap; }
.gbc-menu-shortcut { color: var(--gbc-fg-muted); font-size: var(--gbc-font-size-small); margin-left: 16px; }
.gbc-menu-sep { height: 1px; background: var(--gbc-menu-border); margin: 4px 0; }
.gbc-menu-empty { padding: 6px 12px; color: var(--gbc-fg-muted); }
.gbc-menu-check { cursor: pointer; }
.gbc-menu-danger { color: var(--gbc-error); }

/* banners */
.gbc-banner { display: flex; align-items: center; gap: 8px; padding: 5px 8px; border-bottom: 1px solid var(--gbc-border); flex: none; font-size: var(--gbc-font-size-small); }
.gbc-banner-error { background: var(--gbc-error-bg); border-left: 3px solid var(--gbc-error-border); }
.gbc-banner-warning { background: var(--gbc-warn-bg); border-left: 3px solid var(--gbc-warn-border); }
.gbc-banner-progress { background: var(--gbc-bg-header); }
.gbc-banner-body { flex: 1; min-width: 0; }
.gbc-banner-text { flex: 1; min-width: 0; }
.gbc-banner-detail { color: var(--gbc-fg-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.gbc-banner-actions { display: flex; gap: 6px; margin-top: 3px; flex-wrap: wrap; }
.gbc-banner-close { background: none; border: none; cursor: pointer; color: var(--gbc-fg-muted); display: inline-flex; padding: 2px; flex: none; }
.gbc-banner-close:hover { color: var(--gbc-fg); }
.gbc-backend { align-items: flex-start; }

/* tree */
.gbc-scroll { overflow: auto; flex: 1; min-height: 80px; position: relative; }
.gbc-tree { outline: none; }
.gbc-empty { padding: 16px 12px; color: var(--gbc-fg-muted); }
.gbc-empty-inline { color: var(--gbc-fg-muted); padding-left: 28px; font-size: var(--gbc-font-size-small); }
.gbc-vrow { display: flex; align-items: center; gap: 6px; height: var(--gbc-row-h); padding-right: 8px; white-space: nowrap; overflow: hidden; cursor: default; }
.gbc-vrow:hover { background: var(--gbc-hover); }
.gbc-selected, .gbc-selected:hover { background: var(--gbc-selection); color: var(--gbc-selection-fg); }
.gbc-reporow { background: var(--gbc-bg-header); font-weight: 600; padding-left: 4px; }
.gbc-repo-name { display: inline-flex; align-items: center; gap: 4px; overflow: hidden; text-overflow: ellipsis; cursor: pointer; }
.gbc-kind { font-size: var(--gbc-font-size-small); color: var(--gbc-fg-muted); border: 1px solid var(--gbc-border); border-radius: 3px; padding: 0 4px; font-weight: 400; }
.gbc-branchwidget { display: inline-flex; align-items: center; gap: 4px; background: none; border: 1px solid var(--gbc-border); border-radius: 10px; padding: 1px 8px; cursor: pointer; color: var(--gbc-fg); font-size: var(--gbc-font-size-small); font-weight: 400; max-width: 60%; }
.gbc-branchwidget:hover { background: var(--gbc-hover); }
.gbc-branchwidget-name { overflow: hidden; text-overflow: ellipsis; }
.gbc-ahead { color: var(--gbc-ahead); }
.gbc-behind { color: var(--gbc-behind); }
.gbc-grouprow, .gbc-listrow { padding-left: 4px; }
.gbc-group-name, .gbc-listname { cursor: pointer; overflow: hidden; text-overflow: ellipsis; }
.gbc-listrow-active .gbc-listname { font-weight: 700; }
.gbc-listcomment { color: var(--gbc-fg-muted); font-size: var(--gbc-font-size-small); overflow: hidden; text-overflow: ellipsis; flex: 1; }
.gbc-activebadge { color: var(--gbc-added); display: inline-flex; }
.gbc-count { color: var(--gbc-fg-muted); font-size: var(--gbc-font-size-small); flex: none; }
.gbc-chevron { background: none; border: none; cursor: pointer; color: var(--gbc-fg-muted); display: inline-flex; padding: 2px; width: 18px; flex: none; }
.gbc-chevron:hover { color: var(--gbc-fg); }
.gbc-chevron-spacer { width: 18px; flex: none; }
.gbc-checkbox { margin: 0; flex: none; accent-color: var(--gbc-btn-bg); }
.gbc-checkbox-spacer { width: 13px; flex: none; }
.gbc-dirname { display: inline-flex; align-items: center; gap: 4px; cursor: pointer; color: var(--gbc-fg); overflow: hidden; text-overflow: ellipsis; }
.gbc-filerow { outline: none; }
.gbc-filerow:focus-visible { box-shadow: inset 0 0 0 1px var(--gbc-focus); }
.gbc-status { width: 14px; text-align: center; font-size: var(--gbc-font-size-small); font-weight: 700; flex: none; }
.gbc-status-modified { color: var(--gbc-modified); }
.gbc-status-added { color: var(--gbc-added); }
.gbc-status-deleted { color: var(--gbc-deleted); }
.gbc-status-renamed, .gbc-status-copied { color: var(--gbc-renamed); }
.gbc-status-conflicted { color: var(--gbc-conflict); }
.gbc-status-untracked { color: var(--gbc-unversioned); }
.gbc-kind-modified .gbc-path { color: var(--gbc-modified); }
.gbc-kind-added .gbc-path { color: var(--gbc-added); }
.gbc-kind-deleted .gbc-path { color: var(--gbc-deleted); text-decoration: line-through; }
.gbc-kind-renamed .gbc-path, .gbc-kind-copied .gbc-path { color: var(--gbc-renamed); }
.gbc-kind-conflicted .gbc-path { color: var(--gbc-conflict); }
.gbc-kind-untracked .gbc-path { color: var(--gbc-unversioned); }
.gbc-selected .gbc-path { color: inherit; }
.gbc-path { overflow: hidden; text-overflow: ellipsis; }
.gbc-orig { color: var(--gbc-fg-muted); font-size: var(--gbc-font-size-small); overflow: hidden; text-overflow: ellipsis; }
.gbc-partial { font-size: 10px; border: 1px solid var(--gbc-warn-border); color: var(--gbc-warn-border); border-radius: 3px; padding: 0 4px; flex: none; }
.gbc-conflict-hint { color: var(--gbc-conflict); display: inline-flex; flex: none; }

/* message */
.gbc-message { position: relative; flex: none; border-top: 1px solid var(--gbc-border); padding: 6px; }
.gbc-message-input { width: 100%; min-height: 64px; max-height: 160px; resize: vertical; background: var(--gbc-input-bg); color: var(--gbc-input-fg); border: 1px solid var(--gbc-input-border); border-radius: 3px; padding: 6px; }
.gbc-message-input:focus { outline: 1px solid var(--gbc-focus); }
.gbc-message-footer { display: flex; align-items: center; gap: 8px; margin-top: 4px; }
.gbc-message-hint { flex: 1; color: var(--gbc-fg-muted); font-size: var(--gbc-font-size-small); }
.gbc-amend { display: inline-flex; align-items: center; gap: 4px; cursor: pointer; }
.gbc-amend-label { font-size: var(--gbc-font-size-small); }
.gbc-history { position: absolute; right: 6px; bottom: 34px; max-height: 220px; overflow: auto; min-width: 260px; }
.gbc-history-item { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 320px; }

/* options */
.gbc-options { flex: none; border-top: 1px solid var(--gbc-border); padding: 6px 8px; display: flex; flex-direction: column; gap: 4px; background: var(--gbc-bg-header); }
.gbc-option-row { display: flex; align-items: center; gap: 6px; }
.gbc-option-check { cursor: pointer; }
.gbc-option-label { font-size: var(--gbc-font-size-small); color: var(--gbc-fg); }
.gbc-options-header { font-size: var(--gbc-font-size-small); font-weight: 600; color: var(--gbc-fg-muted); margin-top: 4px; }
.gbc-option-hint { font-size: var(--gbc-font-size-small); color: var(--gbc-fg-muted); font-style: italic; }
.gbc-checkbadge { font-size: var(--gbc-font-size-small); color: var(--gbc-badge-fg); background: var(--gbc-badge-bg); border-radius: 3px; padding: 0 5px; }
.gbc-checkbadge-unavailable { opacity: .7; }
.gbc-option-disabled .gbc-option-label { color: var(--gbc-fg-muted); }
.gbc-author { gap: 6px; }
.gbc-author-input { flex: 1; }

/* inputs */
.gbc-input { background: var(--gbc-input-bg); color: var(--gbc-input-fg); border: 1px solid var(--gbc-input-border); border-radius: 3px; padding: 3px 6px; min-width: 0; }
.gbc-input:focus { outline: 1px solid var(--gbc-focus); }
.gbc-select { padding: 2px 4px; }
.gbc-field { display: flex; flex-direction: column; gap: 3px; margin-bottom: 8px; }
.gbc-comment-input { width: 100%; min-height: 60px; resize: vertical; }

/* commit actions */
.gbc-commit-actions { display: flex; align-items: center; gap: 8px; padding: 6px; border-top: 1px solid var(--gbc-border); flex: none; }
.gbc-disabled-reason { color: var(--gbc-fg-muted); font-size: var(--gbc-font-size-small); }

/* dialogs */
.gbc-dialog-overlay { position: fixed; inset: 0; background: rgba(0,0,0,.35); display: flex; align-items: center; justify-content: center; z-index: 80; }
.gbc-dialog { background: var(--gbc-overlay-bg); border: 1px solid var(--gbc-border); border-radius: 6px; box-shadow: 0 8px 24px rgba(0,0,0,.45); width: min(440px, calc(100vw - 32px)); max-height: calc(100vh - 48px); display: flex; flex-direction: column; }
.gbc-dialog-head { display: flex; align-items: center; justify-content: space-between; padding: 10px 12px 6px; }
.gbc-dialog-title { font-weight: 600; }
.gbc-dialog-body { padding: 4px 12px; overflow: auto; font-size: var(--gbc-font-size); }
.gbc-dialog-body p { margin: 4px 0 8px; }
.gbc-dialog-error { margin: 0 12px 6px; padding: 4px 8px; background: var(--gbc-error-bg); border-left: 3px solid var(--gbc-error-border); color: var(--gbc-error); font-size: var(--gbc-font-size-small); }
.gbc-dialog-foot { display: flex; justify-content: flex-end; gap: 8px; padding: 8px 12px 12px; }
.gbc-filelist { list-style: none; margin: 4px 0; padding: 0; max-height: 180px; overflow: auto; border: 1px solid var(--gbc-border); border-radius: 3px; }
.gbc-filelist li { padding: 3px 8px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: var(--gbc-font-size-small); }
.gbc-checklist li { padding: 0; }
.gbc-checklist-item { display: flex; align-items: center; gap: 6px; padding: 3px 8px; cursor: pointer; }
.gbc-checklist-item span { overflow: hidden; text-overflow: ellipsis; }
.gbc-pushlist { list-style: none; margin: 4px 0; padding: 0; max-height: 320px; overflow: auto; }
.gbc-pushlist > li { padding: 2px 0; border-bottom: 1px solid var(--gbc-border); }
.gbc-pushrow { display: flex; align-items: center; gap: 6px; min-height: 24px; }
.gbc-pushref { color: var(--gbc-fg-muted); font-size: var(--gbc-font-size-small); overflow: hidden; text-overflow: ellipsis; }
.gbc-pushremote { max-width: 120px; }
.gbc-pushstate { display: inline-flex; width: 16px; flex: none; margin-left: auto; }
.gbc-push-note { color: var(--gbc-warn-border); font-size: var(--gbc-font-size-small); padding-left: 40px; }
.gbc-pushcommits { list-style: none; margin: 2px 0 4px; padding: 0 0 0 40px; max-height: 160px; overflow: auto; }
.gbc-pushcommit { display: flex; align-items: center; gap: 6px; padding: 1px 0; font-size: var(--gbc-font-size-small); }
.gbc-pushcommit-hash { color: var(--gbc-link); font-family: var(--vscode-editor-font-family, monospace); flex: none; }
.gbc-pushcommit-msg { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; }
.gbc-pushcommit-author { color: var(--gbc-fg-muted); flex: none; }
.gbc-pushcommit-muted { color: var(--gbc-fg-muted); font-size: var(--gbc-font-size-small); padding: 1px 0; }
.gbc-pusherror { display: flex; align-items: center; gap: 8px; margin: 2px 0 4px 40px; padding: 3px 6px; background: var(--gbc-error-bg); border-left: 3px solid var(--gbc-error-border); color: var(--gbc-error); font-size: var(--gbc-font-size-small); }
.gbc-pusherror span { flex: 1; min-width: 0; }
.gbc-pushsummary { padding: 4px 0 0; color: var(--gbc-fg-muted); font-size: var(--gbc-font-size-small); }
.gbc-pushtags { display: inline-flex; align-items: center; gap: 6px; font-size: var(--gbc-font-size-small); color: var(--gbc-fg-muted); }
.gbc-dialog-wide { width: min(920px, calc(100vw - 32px)); }
.gbc-pushpanes { display: flex; align-items: stretch; gap: 10px; min-height: 240px; }
.gbc-pushpanes .gbc-pushlist { flex: 1 1 50%; min-width: 0; max-height: 380px; }
.gbc-pushfiles { flex: 1 1 50%; min-width: 0; border-left: 1px solid var(--gbc-border); padding-left: 10px; max-height: 380px; overflow: auto; }
.gbc-pushfiles-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 2px 0 4px; margin-bottom: 4px; font-size: var(--gbc-font-size-small); color: var(--gbc-fg-muted); border-bottom: 1px solid var(--gbc-border); }
.gbc-pushfiles-title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.gbc-pushfiles-count { flex: none; }
.gbc-pushfilelist { list-style: none; margin: 0; padding: 0; }
.gbc-pushfile { display: flex; align-items: center; gap: 6px; padding: 1px 4px; font-size: var(--gbc-font-size-small); border-radius: 3px; }
.gbc-pushfile:hover { background: var(--gbc-hover); }
.gbc-pushfile:focus-visible { outline: 1px solid var(--gbc-link); outline-offset: -1px; }
.gbc-pushfile-status { flex: none; width: 12px; text-align: center; font-family: var(--vscode-editor-font-family, monospace); }
.gbc-pushfile-A { color: var(--gbc-added); }
.gbc-pushfile-M, .gbc-pushfile-T { color: var(--gbc-modified); }
.gbc-pushfile-D { color: var(--gbc-deleted); }
.gbc-pushfile-R, .gbc-pushfile-C { color: var(--gbc-renamed); }
.gbc-pushfile-path { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.gbc-pushfile-orig { flex: none; max-width: 40%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--gbc-fg-muted); }
.gbc-pushsel-on, .gbc-pushsel-on:hover { background: var(--gbc-selection); color: var(--gbc-selection-fg); }
.gbc-pushcommit { cursor: pointer; border-radius: 3px; }
.gbc-pushcommit:hover { background: var(--gbc-hover); }
button.gbc-repo-name { background: none; border: none; color: inherit; font: inherit; padding: 0 2px; cursor: pointer; border-radius: 3px; }
@media (max-width: 700px) {
  .gbc-pushpanes { flex-direction: column; }
  .gbc-pushfiles { border-left: none; padding-left: 0; border-top: 1px solid var(--gbc-border); padding-top: 6px; }
}
.gbc-checkreport { list-style: none; margin: 4px 0; padding: 0; }
.gbc-checkreport li { display: flex; align-items: center; gap: 8px; padding: 3px 0; flex-wrap: wrap; }
.gbc-checkstatus { font-size: var(--gbc-font-size-small); border-radius: 3px; padding: 0 6px; }
.gbc-checkstatus-ok { color: var(--gbc-added); }
.gbc-checkstatus-issues { color: var(--gbc-error); }
.gbc-checkstatus-unavailable, .gbc-checkstatus-skipped { color: var(--gbc-fg-muted); }
.gbc-checkdetails { width: 100%; color: var(--gbc-fg-muted); font-size: var(--gbc-font-size-small); }
.gbc-picklist { list-style: none; margin: 4px 0; padding: 0; }
.gbc-pick-active { font-weight: 600; }

/* branch popup */
.gbc-branchpopup { width: min(380px, calc(100vw - 32px)); }
.gbc-branchpopup-search { display: flex; align-items: center; gap: 6px; padding: 0 12px 6px; color: var(--gbc-fg-muted); }
.gbc-branchpopup-search .gbc-input { flex: 1; }
.gbc-branchpopup-new { display: flex; gap: 6px; padding: 0 12px 6px; }
.gbc-branchpopup-new .gbc-input { flex: 1; }
.gbc-branchpopup-list { overflow: auto; padding: 0 6px; max-height: 320px; }
.gbc-branchlist { list-style: none; margin: 0; padding: 0; }
.gbc-branchrow { display: flex; align-items: center; gap: 4px; padding: 1px 4px; border-radius: 3px; }
.gbc-branchrow:hover { background: var(--gbc-hover); }
.gbc-branchrow-main { flex: 1; display: flex; align-items: center; gap: 6px; background: none; border: none; cursor: pointer; padding: 4px 6px; color: var(--gbc-fg); min-width: 0; }
.gbc-branchrow-main:disabled { cursor: default; }
.gbc-branchrow-name { overflow: hidden; text-overflow: ellipsis; }
.gbc-branchrow-remote { color: var(--gbc-fg-muted); font-size: var(--gbc-font-size-small); }
.gbc-branchrow-more { width: 20px; height: 20px; opacity: 0; }
.gbc-branchrow:hover .gbc-branchrow-more { opacity: 1; }
.gbc-branchrow-edit, .gbc-branchrow-confirm { flex-wrap: wrap; padding: 4px; }
.gbc-branchrow-edit .gbc-input { flex: 1; }
.gbc-branchpopup-foot { justify-content: flex-start; border-top: 1px solid var(--gbc-border); }
.gbc-branchmenu { z-index: 90; }

/* shelf / stash tabs */
.gbc-tabbody { display: flex; flex-direction: column; flex: 1; min-height: 0; }
.gbc-tabtoolbar { display: flex; align-items: center; gap: 6px; padding: 4px 6px; border-bottom: 1px solid var(--gbc-border); flex: none; }
.gbc-reposelect { max-width: 160px; }
.gbc-shelflist, .gbc-stashlist { list-style: none; margin: 0; padding: 0; overflow: auto; flex: 1; }
.gbc-shelfrow { padding-left: 4px; }
.gbc-shelfname { font-weight: 600; overflow: hidden; text-overflow: ellipsis; }
.gbc-shelfmeta { color: var(--gbc-fg-muted); font-size: var(--gbc-font-size-small); overflow: hidden; text-overflow: ellipsis; }
.gbc-shelffiles { list-style: none; margin: 0; padding: 0; }
.gbc-shelffile { padding-left: 26px; }
.gbc-stashrow { padding-left: 8px; }
.gbc-stashdesc { overflow: hidden; text-overflow: ellipsis; flex: 1; }

/* log view */
.gbc-logview { display: flex; flex-direction: column; height: 100%; }
.gbc-logtoolbar { flex-wrap: wrap; }
.gbc-logfilter { width: 120px; }
.gbc-loglist { list-style: none; margin: 0; padding: 0; overflow: auto; flex: 1; }
.gbc-logentry { display: flex; align-items: center; gap: 8px; padding: 4px 8px; border-bottom: 1px solid var(--gbc-border); }
.gbc-logentry:hover { background: var(--gbc-hover); }
.gbc-loghash { background: none; border: none; color: var(--gbc-link); cursor: pointer; font-family: var(--vscode-editor-font-family, monospace); font-size: var(--gbc-font-size-small); padding: 0; flex: none; }
.gbc-logmessage { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.gbc-logmeta { color: var(--gbc-fg-muted); font-size: var(--gbc-font-size-small); flex: none; }
.gbc-logactions { display: flex; gap: 4px; flex: none; }
.gbc-loadmore { margin: 8px; align-self: center; }
`;