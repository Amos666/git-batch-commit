export const STYLES = `
.gbc-panel { display: flex; flex-direction: column; height: 100%; overflow: hidden; }
.gbc-scroll { flex: 1; overflow-y: auto; padding: 8px; }
.gbc-empty, .gbc-guidance { padding: 16px 12px; color: var(--vscode-descriptionForeground); line-height: 1.6; }
.gbc-repo { margin-bottom: 12px; border: 1px solid var(--vscode-panel-border, rgba(128,128,128,.2)); border-radius: 4px; }
.gbc-repo-head { display: flex; align-items: center; gap: 6px; padding: 6px 8px; background: var(--vscode-sideBarSectionHeader-background, rgba(128,128,128,.1)); flex-wrap: wrap; }
.gbc-repo-name { font-weight: 600; }
.gbc-branch { cursor: pointer; padding: 1px 8px; border-radius: 10px; background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); font-size: 11px; border: none; }
.gbc-ahead { color: var(--vscode-gitDecoration-addedResourceForeground, #487e02); font-size: 11px; }
.gbc-behind { color: var(--vscode-gitDecoration-modifiedResourceForeground, #895503); font-size: 11px; }
.gbc-toolbar { margin-left: auto; display: flex; gap: 4px; }
.gbc-group-title { display: flex; align-items: center; gap: 6px; padding: 4px 8px; font-size: 11px; text-transform: uppercase; color: var(--vscode-descriptionForeground); }
.gbc-row { display: flex; align-items: center; gap: 6px; padding: 2px 8px; }
.gbc-row:hover { background: var(--vscode-list-hoverBackground); }
.gbc-row input[type=checkbox] { margin: 0; cursor: pointer; }
.gbc-status { width: 14px; text-align: center; font-weight: 700; font-size: 11px; flex-shrink: 0; }
.gbc-status-M { color: var(--vscode-gitDecoration-modifiedResourceForeground, #895503); }
.gbc-status-A, .gbc-status-\\? { color: var(--vscode-gitDecoration-addedResourceForeground, #487e02); }
.gbc-status-D { color: var(--vscode-gitDecoration-deletedResourceForeground, #ad0707); }
.gbc-status-R, .gbc-status-C { color: var(--vscode-gitDecoration-submoduleResourceForeground, #157efb); }
.gbc-status-U { color: var(--vscode-gitDecoration-conflictingResourceForeground, #e46767); }
.gbc-path { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; direction: rtl; text-align: left; }
.gbc-orig { color: var(--vscode-descriptionForeground); font-size: 11px; }
.gbc-linkbtn { background: none; border: none; color: var(--vscode-textLink-foreground); cursor: pointer; font-size: 11px; padding: 0 2px; flex-shrink: 0; }
.gbc-linkbtn:hover { text-decoration: underline; }
.gbc-btn { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; border-radius: 2px; padding: 4px 12px; cursor: pointer; font-size: 12px; }
.gbc-btn:hover { background: var(--vscode-button-hoverBackground); }
.gbc-btn:disabled { opacity: .5; cursor: default; }
.gbc-btn-secondary { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
.gbc-btn-secondary:hover { background: var(--vscode-button-secondaryHoverBackground); }
.gbc-commitbox { border-top: 1px solid var(--vscode-panel-border, rgba(128,128,128,.2)); padding: 8px; }
.gbc-commitbox textarea { width: 100%; box-sizing: border-box; resize: vertical; min-height: 56px; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border, transparent); border-radius: 2px; padding: 6px; font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); }
.gbc-commitrow { display: flex; align-items: center; gap: 8px; margin-top: 6px; }
.gbc-hint { color: var(--vscode-descriptionForeground); font-size: 11px; flex: 1; }
.gbc-results { border-top: 1px solid var(--vscode-panel-border, rgba(128,128,128,.2)); padding: 8px; max-height: 40%; overflow-y: auto; }
.gbc-result { padding: 4px 0; line-height: 1.5; }
.gbc-result-ok { color: var(--vscode-gitDecoration-addedResourceForeground, #487e02); }
.gbc-result-fail { color: var(--vscode-errorForeground); }
.gbc-result-skip { color: var(--vscode-descriptionForeground); }
.gbc-actions { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 2px; }
.gbc-error { background: var(--vscode-inputValidation-errorBackground, rgba(190,17,17,.1)); border: 1px solid var(--vscode-inputValidation-errorBorder, #be1100); padding: 6px 8px; margin: 8px; border-radius: 2px; }
.gbc-confirm { background: var(--vscode-inputValidation-warningBackground, rgba(255,204,0,.1)); border: 1px solid var(--vscode-inputValidation-warningBorder, #ffcc00); padding: 6px 8px; margin-top: 6px; border-radius: 2px; }
.gbc-branchlist { padding: 4px 8px; display: flex; flex-direction: column; gap: 2px; max-height: 160px; overflow-y: auto; }
.gbc-branchitem { text-align: left; background: none; border: none; color: var(--vscode-foreground); cursor: pointer; padding: 2px 4px; }
.gbc-branchitem:hover { background: var(--vscode-list-hoverBackground); }
.gbc-branchitem-current { font-weight: 700; }
.gbc-op { font-size: 11px; color: var(--vscode-descriptionForeground); padding: 2px 8px; }
.gbc-vrow { display: flex; align-items: center; gap: 6px; padding: 0 8px; box-sizing: border-box; height: 100%; overflow: hidden; }
.gbc-vrow:hover { background: var(--vscode-list-hoverBackground); }
.gbc-vrow input[type=checkbox] { margin: 0; cursor: pointer; flex-shrink: 0; }
.gbc-reporow { background: var(--vscode-sideBarSectionHeader-background, rgba(128,128,128,.1)); font-weight: 600; }
.gbc-grouprow { color: var(--vscode-descriptionForeground); font-size: 11px; }
.gbc-group-name { text-transform: uppercase; }
.gbc-emptyrow { color: var(--vscode-descriptionForeground); font-size: 11px; }
.gbc-chevron { background: none; border: none; color: var(--vscode-descriptionForeground); cursor: pointer; width: 14px; padding: 0; flex-shrink: 0; font-size: 10px; }
.gbc-chevron-spacer { width: 14px; flex-shrink: 0; }
.gbc-dirname { cursor: pointer; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.gbc-count { color: var(--vscode-descriptionForeground); font-size: 11px; margin-left: auto; flex-shrink: 0; }
.gbc-kind { font-size: 10px; padding: 0 5px; border-radius: 8px; border: 1px solid var(--vscode-panel-border, rgba(128,128,128,.4)); color: var(--vscode-descriptionForeground); font-weight: 400; }
.gbc-op-inline { font-size: 11px; color: var(--vscode-descriptionForeground); font-weight: 400; }
.gbc-overlay { border-top: 1px solid var(--vscode-panel-border, rgba(128,128,128,.2)); background: var(--vscode-editorWidget-background, var(--vscode-sideBar-background)); max-height: 200px; overflow-y: auto; }
.gbc-overlay-head { display: flex; justify-content: space-between; align-items: center; padding: 4px 8px; font-size: 11px; color: var(--vscode-descriptionForeground); }
.gbc-optionsrow { display: flex; align-items: center; gap: 10px; margin-top: 4px; font-size: 11px; }
.gbc-optionsrow label { display: flex; align-items: center; gap: 4px; cursor: pointer; color: var(--vscode-descriptionForeground); }
.gbc-optionsrow input[type=checkbox] { margin: 0; cursor: pointer; }
.gbc-history { max-height: 140px; overflow-y: auto; border: 1px solid var(--vscode-panel-border, rgba(128,128,128,.2)); border-radius: 2px; margin-top: 4px; }
.gbc-historyitem { display: block; width: 100%; text-align: left; background: none; border: none; color: var(--vscode-foreground); cursor: pointer; padding: 3px 8px; font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.gbc-historyitem:hover { background: var(--vscode-list-hoverBackground); }
.gbc-splitbtn { display: inline-flex; }
.gbc-splitbtn .gbc-btn:first-child { border-radius: 2px 0 0 2px; }
.gbc-splitarrow { border-radius: 0 2px 2px 0; padding: 4px 6px; border-left: 1px solid var(--vscode-button-separator, rgba(255,255,255,.2)); }
.gbc-commitmenu { border: 1px solid var(--vscode-panel-border, rgba(128,128,128,.2)); border-radius: 2px; background: var(--vscode-editorWidget-background, var(--vscode-sideBar-background)); }
.gbc-hunkoverlay { max-height: 55%; display: flex; flex-direction: column; }
.gbc-hunklist { overflow-y: auto; padding: 0 8px; flex: 1; }
.gbc-hunk { border: 1px solid var(--vscode-panel-border, rgba(128,128,128,.2)); border-radius: 2px; margin-bottom: 6px; }
.gbc-hunkhead { display: flex; align-items: center; gap: 6px; padding: 3px 6px; cursor: pointer; font-size: 11px; background: var(--vscode-sideBarSectionHeader-background, rgba(128,128,128,.1)); }
.gbc-hunkhead input[type=checkbox] { margin: 0; cursor: pointer; }
.gbc-hunkheader { font-family: var(--vscode-editor-font-family, monospace); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.gbc-hunkbody { margin: 0; padding: 4px 6px; font-family: var(--vscode-editor-font-family, monospace); font-size: var(--vscode-editor-font-size, 12px); overflow-x: auto; max-height: 220px; overflow-y: auto; }
.gbc-line-add { color: var(--vscode-gitDecoration-addedResourceForeground, #487e02); }
.gbc-line-del { color: var(--vscode-gitDecoration-deletedResourceForeground, #ad0707); }
.gbc-line-meta { color: var(--vscode-descriptionForeground); font-style: italic; }
.gbc-line-ctx { color: var(--vscode-foreground); }
.gbc-hunkactions { padding: 6px 8px; border-top: 1px solid var(--vscode-panel-border, rgba(128,128,128,.2)); align-items: center; }
.gbc-stashoverlay, .gbc-shelfoverlay { max-height: 55%; display: flex; flex-direction: column; }
.gbc-stashcreate, .gbc-shelfcreate { display: flex; align-items: center; gap: 8px; padding: 4px 8px; font-size: 11px; flex-wrap: wrap; }
.gbc-stashcreate label { display: flex; align-items: center; gap: 3px; color: var(--vscode-descriptionForeground); cursor: pointer; }
.gbc-stashcreate input[type=checkbox] { margin: 0; }
.gbc-stashmsg, .gbc-shelfname { flex: 1; min-width: 100px; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border, transparent); padding: 3px 6px; font-size: 12px; }
.gbc-stashlist, .gbc-shelflist { overflow-y: auto; padding: 0 8px 6px; }
.gbc-stashitem, .gbc-shelfitem { border: 1px solid var(--vscode-panel-border, rgba(128,128,128,.2)); border-radius: 2px; padding: 4px 6px; margin-bottom: 6px; }
.gbc-shelffiles { display: flex; flex-direction: column; gap: 2px; padding: 4px 8px; max-height: 140px; overflow-y: auto; }
.gbc-shelffile { display: flex; align-items: center; gap: 4px; font-size: 12px; cursor: pointer; overflow: hidden; }
.gbc-shelffile input[type=checkbox] { margin: 0; flex-shrink: 0; }
.gbc-shelffile .gbc-path { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.gbc-shelfinfo { display: flex; align-items: center; gap: 6px; overflow: hidden; flex-wrap: wrap; }
.gbc-shelftitle { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.gbc-shelfmeta { font-size: 10px; color: var(--vscode-descriptionForeground); }
.gbc-shelfunshelve { display: flex; flex-direction: column; gap: 4px; padding: 4px 0; }
.gbc-shelfunshelve label { display: flex; align-items: center; gap: 4px; font-size: 12px; cursor: pointer; }
.gbc-shelfunshelve input[type=checkbox] { margin: 0; }
.gbc-stashinfo { display: flex; align-items: center; gap: 6px; overflow: hidden; }
.gbc-stashref { font-family: var(--vscode-editor-font-family, monospace); font-size: 11px; color: var(--vscode-descriptionForeground); flex-shrink: 0; }
.gbc-stashdesc { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.gbc-stashbranch { font-size: 10px; color: var(--vscode-descriptionForeground); border: 1px solid var(--vscode-panel-border, rgba(128,128,128,.4)); border-radius: 8px; padding: 0 5px; flex-shrink: 0; }
.gbc-danger { color: var(--vscode-errorForeground); }
.gbc-btn-danger { background: var(--vscode-errorForeground, #be1100); color: var(--vscode-editor-background, #fff); }
.gbc-branchcreate { display: flex; align-items: center; gap: 8px; padding: 4px 8px; }
.gbc-branchinput { flex: 1; min-width: 80px; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border, transparent); padding: 3px 6px; font-size: 12px; }
.gbc-branchrow { display: flex; align-items: center; gap: 4px; flex-wrap: wrap; }
.gbc-branchrow .gbc-branchitem { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.gbc-branchactions { display: inline-flex; gap: 4px; margin-left: auto; flex-shrink: 0; }
.gbc-branchconfirm { flex-basis: 100%; display: flex; align-items: center; gap: 6px; flex-wrap: wrap; padding: 3px 4px; margin: 2px 0; background: var(--vscode-inputValidation-warningBackground, rgba(255,204,0,.08)); border: 1px solid var(--vscode-inputValidation-warningBorder, rgba(255,204,0,.4)); border-radius: 2px; }
.gbc-confirmtext { font-size: 11px; color: var(--vscode-foreground); }
.gbc-branchmgr { max-height: 45%; display: flex; flex-direction: column; }
.gbc-branchmgr .gbc-branchlist { max-height: none; flex: 1; }
.gbc-logoverlay { max-height: 55%; display: flex; flex-direction: column; }
.gbc-logfilters { display: flex; align-items: center; gap: 6px; padding: 4px 8px; flex-wrap: wrap; }
.gbc-loginput { flex: 1; min-width: 90px; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border, transparent); padding: 3px 6px; font-size: 12px; }
.gbc-loglist { overflow-y: auto; padding: 0 8px 6px; display: flex; flex-direction: column; gap: 1px; }
.gbc-logrow { display: flex; align-items: center; gap: 2px; }
.gbc-logrow:hover { background: var(--vscode-list-hoverBackground); }
.gbc-logactions { display: inline-flex; gap: 4px; flex-shrink: 0; padding-right: 4px; }
.gbc-logitem { display: flex; align-items: center; gap: 8px; flex: 1; min-width: 0; text-align: left; background: none; border: none; color: var(--vscode-foreground); cursor: pointer; padding: 3px 4px; font-size: 12px; overflow: hidden; }
.gbc-loghash { font-family: var(--vscode-editor-font-family, monospace); color: var(--vscode-textLink-foreground); flex-shrink: 0; }
.gbc-logmsg { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.gbc-logmeta { font-size: 10px; color: var(--vscode-descriptionForeground); flex-shrink: 0; }
.gbc-logmore { align-self: center; margin: 4px 0; }
.gbc-vrow:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: -1px; }
`;