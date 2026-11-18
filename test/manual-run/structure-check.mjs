// Phase 2 structure check: DOM order, menu sets vs STRINGS, disabled reasons.
// Run via: xvfb-run -a node test/manual-run/launch.mjs structure-check.mjs
import { STRINGS } from '../../src/webview/strings/en.ts';
import { CHECK_AVAILABILITY } from '../../src/kernel/capabilities.ts';
import { check, clickTestId, contextMenuLabels, escape, finish, openView, panel, setInput, shot, sleep, workbench } from './lib/cdp.mjs';

const wb = await workbench();
await openView(wb, 'Commit');
const { cdp, ev } = await panel('commit-panel');

// 1) tab order: Commit | Shelf | Stash (Log is a separate view, not a tab)
const tabs = await ev(`(doc) => Array.from(doc.querySelectorAll('[data-testid="tabbar"] [role="tab"]')).map(t => t.textContent.trim())`);
check('tab order Commit | Shelf | Stash', JSON.stringify(tabs) === JSON.stringify([STRINGS.tabs.commit, STRINGS.tabs.shelf, STRINGS.tabs.stash]));

// 2) toolbar button order (IDEA): Refresh, Rollback, Shelve Changes, Show Diff, Move | View Options, Expand, Collapse
const toolbar = await ev(`(doc) => Array.from(doc.querySelectorAll('[data-testid="toolbar"] button')).map(b => b.getAttribute('data-testid'))`);
const expectedToolbar = ['tool-refresh', 'tool-rollback', 'tool-shelve', 'tool-diff', 'tool-move', 'tool-viewoptions', 'tool-expand', 'tool-collapse'];
check('toolbar order matches IDEA (changelist mode)', JSON.stringify(toolbar.slice(0, 8)) === JSON.stringify(expectedToolbar));
const toolbarLabels = await ev(`(doc) => Array.from(doc.querySelectorAll('[data-testid="toolbar"] button')).slice(0, 5).map(b => b.getAttribute('aria-label'))`);
check('toolbar labels come from STRINGS', JSON.stringify(toolbarLabels) === JSON.stringify([STRINGS.toolbar.refresh, STRINGS.toolbar.rollback, STRINGS.toolbar.shelve, STRINGS.toolbar.showDiff, STRINGS.toolbar.move]));

// 3) changelist tree: default "Changes" list + Unversioned Files group
check('default changelist header rendered', await ev(`(doc) => !!doc.querySelector('[data-testid="changelist-default"]')`));
const uvLabel = await ev(`(doc) => doc.querySelector('[data-testid="group-unversioned"]')?.innerText ?? ''`);
check('Unversioned Files group present with IDEA label', uvLabel.includes(STRINGS.groups.unversioned));
check('file rows rendered', await ev(`(doc) => doc.querySelectorAll('[data-testid="file-row"]').length >= 3`));

// 4) file context menu set vs STRINGS (tracked, non-conflicted, changelist mode)
const menuLabels = () => ev(`(doc) => Array.from(doc.querySelectorAll('[data-testid="context-menu"] [role="menuitem"]')).map(b => b.getAttribute('data-menu-label'))`);
await ev(`(doc) => {
  const row = Array.from(doc.querySelectorAll('[data-testid="file-row"]')).find(r => r.getAttribute('data-conflicted') === 'false' && r.getAttribute('data-status') !== '?');
  const r = row.getBoundingClientRect();
  row.dispatchEvent(new doc.defaultView.MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.x + 30, clientY: r.y + 5 }));
}`);
await sleep(400);
const fileMenu = await menuLabels();
const M = STRINGS.menus.file;
const expectedFileMenu = [M.showDiff, M.jumpToSource, M.openInSystemFolder, M.rollback, M.shelve, M.copyPath, M.delete];
if (JSON.stringify(fileMenu) !== JSON.stringify(expectedFileMenu)) {
  console.log('  actual file menu:', JSON.stringify(fileMenu));
  console.log('  expected        :', JSON.stringify(expectedFileMenu));
}
check('file menu = IDEA set in order', JSON.stringify(fileMenu) === JSON.stringify(expectedFileMenu));
await shot(wb, 'sc1-filemenu');
await escape(cdp);

// 5) changelist header menu set + honest disabled states
await ev(`(doc) => {
  const row = doc.querySelector('[data-testid="changelist-default"]');
  const r = row.getBoundingClientRect();
  row.dispatchEvent(new doc.defaultView.MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.x + 30, clientY: r.y + 5 }));
}`);
await sleep(400);
const clMenu = await menuLabels();
const C = STRINGS.menus.changelist;
check('changelist menu = New/Set Active/Rename/Edit Comment/Delete', JSON.stringify(clMenu) === JSON.stringify([C.new, C.setActive, C.rename, C.editComment, C.delete]));
const clDisabled = await ev(`(doc) => ({
  setActive: doc.querySelector('[data-testid="menu-setActive"]')?.disabled,
  delete: doc.querySelector('[data-testid="menu-delete"]')?.disabled,
})`);
check('Set Active disabled on active list; Delete disabled on default list', clDisabled?.setActive === true && clDisabled?.delete === true);
await escape(cdp);

// 6) commit disabled reason is visible (empty message, files checked by default)
const reason = await ev(`(doc) => doc.querySelector('[data-testid="commit-disabled-reason"]')?.textContent ?? null`);
check('disabled reason visible: ' + STRINGS.disabled.noMessage, reason === STRINGS.disabled.noMessage);
check('Commit button disabled while reason shown', await ev(`(doc) => doc.querySelector('[data-testid="commit-button-main"]')?.disabled === true`));
await setInput(ev, '[data-testid="commit-message"]', 'structure check message');
await sleep(400);
check('reason clears once message entered', await ev(`(doc) => !doc.querySelector('[data-testid="commit-disabled-reason"]')`));
check('Commit button enabled with message + selection', await ev(`(doc) => doc.querySelector('[data-testid="commit-button-main"]')?.disabled === false`));
await setInput(ev, '[data-testid="commit-message"]', '');
await sleep(300);

// 7) View Options dropdown carries the two IDEA checkboxes (headers "Group By"/"Show" + short labels)
await clickTestId(ev, 'tool-viewoptions');
await sleep(300);
const viewChecks = await ev(`(doc) => ({
  groupDir: doc.querySelector('[data-testid="view-groupdir"]')?.getAttribute('aria-label') ?? null,
  unversioned: doc.querySelector('[data-testid="view-unversioned"]')?.getAttribute('aria-label') ?? null,
  text: doc.querySelector('[data-testid="viewoptions-menu"]')?.innerText ?? '',
})`);
check(
  'View Options: Group by Directory + Show Unversioned Files',
  viewChecks?.groupDir === STRINGS.toolbar.groupByDirectory &&
    viewChecks?.unversioned === STRINGS.toolbar.showUnversioned &&
    viewChecks.text.includes(STRINGS.groups.unversioned),
);
await escape(cdp);

// 8) mode toggle opens the migration dialog (explicit confirmation, not silent)
await clickTestId(ev, 'mode-toggle');
await sleep(500);
const modeTitle = await ev(`(doc) => doc.querySelector('[data-testid="dialog-modeswitch"]')?.getAttribute('aria-label') ?? ''`);
check('mode switch asks for confirmation', modeTitle === STRINGS.dialogs.modeEnableTitle || modeTitle === STRINGS.dialogs.modeDisableTitle);
await clickTestId(ev, 'dialog-close');
await sleep(300);

// 9) Commit and Push split menu
await clickTestId(ev, 'commit-button-arrow');
await sleep(300);
const pushItem = await ev(`(doc) => Array.from(doc.querySelectorAll('[role="menuitem"], .gbc-menu-item')).map(b => b.textContent.trim()).find(t => t.includes('Commit and Push')) ?? null`);
check('split button offers Commit and Push…', pushItem === STRINGS.actions.commitAndPush);
await escape(cdp);

// 10) options gear panel: Before Commit checks list, honest unavailable/limited badges
await clickTestId(ev, 'message-options');
await sleep(400);
check('options panel opens', await ev(`(doc) => !!doc.querySelector('[data-testid="options-panel"]')`));
const checksDom = await ev(`(doc) => {
  const section = doc.querySelector('[data-testid="checks-section"]');
  if (!section) return null;
  return {
    header: section.querySelector('.gbc-options-header')?.textContent ?? '',
    rows: Array.from(section.querySelectorAll('input[data-testid^="option-check-"]')).map(i => ({
      id: i.getAttribute('data-testid').replace('option-check-', ''),
      disabled: i.disabled,
      label: i.closest('label')?.querySelector('.gbc-option-label')?.textContent ?? '',
    })),
    unavailable: Array.from(section.querySelectorAll('[data-testid^="check-unavailable-"]')).map(b => b.getAttribute('data-testid').replace('check-unavailable-', '')),
    limited: Array.from(section.querySelectorAll('[data-testid^="check-limited-"]')).map(b => b.getAttribute('data-testid').replace('check-limited-', '')),
    runAfterCommit: !!section.querySelector('[data-testid="option-runaftercommit"]'),
  };
}`);
check('Before Commit section header', checksDom?.header === STRINGS.options.checks);
check(
  'all checks listed in availability order with IDEA labels',
  JSON.stringify(checksDom?.rows.map(r => r.id)) === JSON.stringify(CHECK_AVAILABILITY.map(c => c.id)) &&
    checksDom?.rows.every(r => r.label === STRINGS.checks[r.id]),
);
check(
  'unavailable checks shown but disabled (not hidden)',
  JSON.stringify(checksDom?.unavailable.sort()) === JSON.stringify(CHECK_AVAILABILITY.filter(c => !c.available).map(c => c.id).sort()) &&
    checksDom?.rows.filter(r => !CHECK_AVAILABILITY.find(c => c.id === r.id)?.available).every(r => r.disabled),
);
check('cleanup carries the Limited badge', JSON.stringify(checksDom?.limited) === JSON.stringify(['cleanup']));
check('Run checks after commit toggle present', checksDom?.runAfterCommit === true);
await shot(wb, 'sc3-options-checks');
await clickTestId(ev, 'message-options');
await sleep(300);

await shot(wb, 'sc2-panel');
cdp.ws.close();
wb.ws.close();
finish('STRUCTURE-CHECK');