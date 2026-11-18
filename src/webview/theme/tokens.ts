/**
 * Own design tokens (--gbc-*). Inside VS Code they map onto --vscode-*
 * variables; the standalone dev harness can override them wholesale.
 * Status colors follow IDEA semantics: blue=modified, green=added,
 * gray=deleted, red=conflict, brown=unversioned.
 */
export const THEME_CSS = `
:root {
  --gbc-row-h: 26px;
  --gbc-indent: 16px;
  --gbc-font: var(--vscode-font-family, -apple-system, 'Segoe UI', sans-serif);
  --gbc-font-size: var(--vscode-font-size, 13px);
  --gbc-font-size-small: 11px;
  --gbc-fg: var(--vscode-foreground, #ccc);
  --gbc-fg-muted: var(--vscode-descriptionForeground, #9d9d9d);
  --gbc-bg: var(--vscode-sideBar-background, #1e1f22);
  --gbc-bg-header: var(--vscode-sideBarSectionHeader-background, rgba(128,128,128,.12));
  --gbc-border: var(--vscode-panel-border, rgba(128,128,128,.25));
  --gbc-hover: var(--vscode-list-hoverBackground, rgba(128,128,128,.12));
  --gbc-selection: var(--vscode-list-activeSelectionBackground, #2f5d8a);
  --gbc-selection-fg: var(--vscode-list-activeSelectionForeground, #fff);
  --gbc-focus: var(--vscode-focusBorder, #0078d4);
  --gbc-input-bg: var(--vscode-input-background, #2b2d30);
  --gbc-input-fg: var(--vscode-input-foreground, #ccc);
  --gbc-input-border: var(--vscode-input-border, rgba(128,128,128,.35));
  --gbc-btn-bg: var(--vscode-button-background, #3574f0);
  --gbc-btn-fg: var(--vscode-button-foreground, #fff);
  --gbc-btn-hover: var(--vscode-button-hoverBackground, #2f65d4);
  --gbc-btn2-bg: var(--vscode-button-secondaryBackground, #3a3d41);
  --gbc-btn2-fg: var(--vscode-button-secondaryForeground, #fff);
  --gbc-btn2-hover: var(--vscode-button-secondaryHoverBackground, #45494e);
  --gbc-link: var(--vscode-textLink-foreground, #4daafc);
  --gbc-error: var(--vscode-errorForeground, #f14c4c);
  --gbc-error-bg: var(--vscode-inputValidation-errorBackground, rgba(190,17,17,.12));
  --gbc-error-border: var(--vscode-inputValidation-errorBorder, #be1100);
  --gbc-warn-bg: var(--vscode-inputValidation-warningBackground, rgba(255,204,0,.1));
  --gbc-warn-border: var(--vscode-inputValidation-warningBorder, #ffcc00);
  --gbc-badge-bg: var(--vscode-badge-background, #4d4d4d);
  --gbc-badge-fg: var(--vscode-badge-foreground, #fff);
  --gbc-modified: var(--vscode-gitDecoration-modifiedResourceForeground, #6c9bd2);
  --gbc-added: var(--vscode-gitDecoration-addedResourceForeground, #629755);
  --gbc-deleted: var(--vscode-gitDecoration-deletedResourceForeground, #8c8c8c);
  --gbc-renamed: var(--vscode-gitDecoration-submoduleResourceForeground, #6c9bd2);
  --gbc-conflict: var(--vscode-gitDecoration-conflictingResourceForeground, #e46767);
  --gbc-unversioned: var(--vscode-gitDecoration-untrackedResourceForeground, #b08d57);
  --gbc-ahead: var(--vscode-gitDecoration-addedResourceForeground, #629755);
  --gbc-behind: var(--vscode-gitDecoration-modifiedResourceForeground, #6c9bd2);
  --gbc-menu-bg: var(--vscode-menu-background, #2b2d30);
  --gbc-menu-fg: var(--vscode-menu-foreground, #ccc);
  --gbc-menu-hover: var(--vscode-menu-selectionBackground, #2f5d8a);
  --gbc-menu-hover-fg: var(--vscode-menu-selectionForeground, #fff);
  --gbc-menu-border: var(--vscode-menu-border, rgba(128,128,128,.35));
  --gbc-overlay-bg: var(--vscode-editorWidget-background, #252526);
}
html, body { margin: 0; padding: 0; height: 100%; }
body {
  font-family: var(--gbc-font);
  font-size: var(--gbc-font-size);
  color: var(--gbc-fg);
  background: var(--gbc-bg);
}
#root { height: 100%; }
* { box-sizing: border-box; }
button { font-family: inherit; font-size: inherit; color: inherit; }
input, textarea, select { font-family: inherit; font-size: inherit; }
`;

/** Install tokens once per document (idempotent). */
export function installTheme(doc: Document = document): void {
  if (doc.getElementById('gbc-theme')) {
    return;
  }
  const style = doc.createElement('style');
  style.id = 'gbc-theme';
  style.textContent = THEME_CSS;
  doc.head.appendChild(style);
}