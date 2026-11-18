/** Styles for the editor-area diff viewer; colors come from webview/theme/tokens. */
export const DIFFVIEW_CSS = `
.dv-root { display: flex; flex-direction: column; height: 100%; overflow: hidden; background: var(--vscode-editor-background, var(--gbc-bg)); }
.dv-toolbar { display: flex; align-items: center; gap: 6px; padding: 4px 8px; border-bottom: 1px solid var(--gbc-border); flex: none; }
.dv-title { font-weight: 600; max-width: 40%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dv-side { color: var(--gbc-fg-muted); font-size: var(--gbc-font-size-small); }
.dv-readonly { color: var(--gbc-fg-muted); font-size: var(--gbc-font-size-small); font-style: italic; }
.dv-spacer { flex: 1; }
.dv-counter { color: var(--gbc-fg-muted); font-size: var(--gbc-font-size-small); min-width: 40px; text-align: center; }
.dv-prev svg { transform: rotate(180deg); }
.dv-error { display: flex; align-items: center; gap: 8px; padding: 6px 8px; background: var(--gbc-error-bg); border-bottom: 1px solid var(--gbc-error-border); color: var(--gbc-error); flex: none; }
.dv-notice { padding: 16px; color: var(--gbc-fg-muted); }
.dv-body { flex: 1; overflow: auto; font-family: var(--vscode-editor-font-family, monospace); font-size: var(--vscode-editor-font-size, 13px); line-height: 1.5; }
.dv-row { display: grid; grid-template-columns: 48px minmax(0, 1fr) 26px 48px minmax(0, 1fr); align-items: stretch; }
.dv-no { text-align: right; padding: 0 6px; color: var(--gbc-fg-muted); user-select: none; opacity: .7; }
.dv-pane { white-space: pre; overflow: hidden; text-overflow: ellipsis; padding: 0 8px; }
.dv-check { display: flex; align-items: center; justify-content: center; }
.dv-check .gbc-checkbox { margin: 0; }
.dv-add .dv-pane-add, .dv-replace .dv-pane-add { background: rgba(98, 151, 85, .18); }
.dv-del .dv-pane-del, .dv-replace .dv-pane-del { background: rgba(228, 103, 103, .15); }
.dv-hunk { display: flex; align-items: center; gap: 6px; padding: 2px 8px; background: var(--gbc-bg-header); border-top: 1px solid var(--gbc-border); border-bottom: 1px solid var(--gbc-border); position: sticky; top: 0; z-index: 5; }
.dv-hunk-header { color: var(--gbc-fg-muted); font-family: var(--vscode-editor-font-family, monospace); font-size: var(--gbc-font-size-small); }
`;