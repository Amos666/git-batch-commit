// Phase 2 visual walkthrough: IDEA Commit tool window flows, dark then light theme.
// Run via: xvfb-run -a node test/manual-run/launch.mjs walkthrough.mjs
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { STRINGS } from '../../src/webview/strings/en.ts';
import {
  check, clickTestId, contextMenuLabels, escape, finish, openView, panel, selectOption, setInput, shot, sleep, textOf, workbench,
} from './lib/cdp.mjs';

const wb = await workbench();
await openView(wb, 'Commit');
const { cdp, ev } = await panel('commit-panel');

async function waitFor(fn, ms = 12000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await fn()) return true;
    await sleep(300);
  }
  return false;
}
const has = (testId) => ev(`(doc) => !!doc.querySelector('[data-testid="${testId}"]')`);
const rightClick = (sel) => ev(`(doc) => {
  const el = doc.querySelector('${sel}');
  if (!el) return false;
  const r = el.getBoundingClientRect();
  el.dispatchEvent(new doc.defaultView.MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.x + 30, clientY: r.y + 5 }));
  return true;
}`);
const dblClick = (sel) => ev(`(doc) => {
  const el = doc.querySelector('${sel}');
  if (!el) return false;
  el.dispatchEvent(new doc.defaultView.MouseEvent('dblclick', { bubbles: true, cancelable: true }));
  return true;
}`);
const menuLabels = () => ev(`(doc) => Array.from(doc.querySelectorAll('[data-testid="context-menu"] [role="menuitem"]')).map(b => b.getAttribute('data-menu-label'))`);
const firstFileRow = `(Array.from(doc.querySelectorAll('[data-testid="file-row"]')).find(r => r.getAttribute('data-conflicted') === 'false' && r.getAttribute('data-status') !== '?'))`;

// ---- dark theme pass ----
// repoC ships conflict-free; create a merge conflict host-side to exercise the
// Merge Conflicts group + banner, then abort so the rest of the walk is neutral.
const repoC = path.resolve('test/integration/.tmp/repoC');
const gitC = (...args) => execFileSync('git', args, { cwd: repoC, stdio: 'pipe' });
const baseBranch = gitC('rev-parse', '--abbrev-ref', 'HEAD').toString().trim();
gitC('checkout', '-q', '-b', 'walk-side');
fs.writeFileSync(path.join(repoC, 'c.txt'), 'c1\nside\n');
gitC('add', 'c.txt');
gitC('commit', '-q', '-m', 'walk side');
gitC('checkout', '-q', baseBranch);
fs.writeFileSync(path.join(repoC, 'c.txt'), 'c1\nmain\n');
gitC('add', 'c.txt');
gitC('commit', '-q', '-m', 'walk main');
try {
  gitC('merge', 'walk-side');
} catch {
  // exit 1 = conflicted merge, which is what we want
}
await shot(wb, 'w1-panel-dark');
check('multi-repo rows rendered', await ev(`(doc) => doc.querySelectorAll('[data-testid="repo-row"]').length >= 3`));
// project root node: per-project tri-state select-all + collapse (IDEA parity)
const repoARow = `(Array.from(doc.querySelectorAll('[data-testid="repo-row"]')).find(r => (r.innerText || '').includes('repoA')))`;
const repoATrackedCount = (includedOnly) => ev(`(doc) => {
  const id = ${repoARow}?.getAttribute('data-repo');
  return Array.from(doc.querySelectorAll('[data-testid="file-row"]')).filter(r => r.getAttribute('data-repo') === id && r.getAttribute('data-status') !== '?'${includedOnly ? ` && r.dataset.included === 'true'` : ''}).length;
}`);
check('project row carries checkbox and count', await ev(`(doc) => !!${repoARow}?.querySelector('[data-testid="repo-check"]') && !!${repoARow}?.querySelector('.gbc-count')`));
await waitFor(async () => (await repoATrackedCount(false)) > 0);
const projTotal = await repoATrackedCount(false);
check('project has tracked files', projTotal > 0);
await ev(`(doc) => ${repoARow}?.querySelector('[data-testid="repo-check"]')?.click()`);
await waitFor(async () => { const n = await repoATrackedCount(true); return n === 0 || n === projTotal; });
const afterFirst = await repoATrackedCount(true);
check('project checkbox toggles whole project', afterFirst === 0 || afterFirst === projTotal);
await ev(`(doc) => ${repoARow}?.querySelector('[data-testid="repo-check"]')?.click()`);
check('project checkbox flips back', await waitFor(async () => (await repoATrackedCount(true)) === projTotal - afterFirst));
if ((await repoATrackedCount(true)) !== projTotal) {
  await ev(`(doc) => ${repoARow}?.querySelector('[data-testid="repo-check"]')?.click()`);
  await waitFor(async () => (await repoATrackedCount(true)) === projTotal);
}
await ev(`(doc) => ${repoARow}?.querySelector('.gbc-chevron')?.click()`);
check('project chevron collapses project files', await waitFor(async () => (await repoATrackedCount(false)) === 0));
await ev(`(doc) => ${repoARow}?.querySelector('.gbc-chevron')?.click()`);
check('project chevron expands project files', await waitFor(async () => (await repoATrackedCount(false)) === projTotal));
check('default changelist header rendered', await has('changelist-default'));
check('file rows rendered', await ev(`(doc) => doc.querySelectorAll('[data-testid="file-row"]').length >= 3`));
check('merge conflict banner for repoC', await waitFor(() => has('banner-merge')));
check('merge banner offers Resolve', await has('merge-resolve'));
check('conflicted file row flagged', await ev(`(doc) => !!doc.querySelector('[data-testid="file-row"][data-conflicted="true"]')`));
gitC('merge', '--abort');
gitC('branch', '-D', 'walk-side');
check('abort clears merge banner', await waitFor(async () => !(await has('banner-merge'))));

// 1) branch popup: local branches listed, search filters, Escape closes
await clickTestId(ev, 'branch-widget');
check('branch popup opens', await waitFor(() => has('branch-popup')));
const branchText = await textOf(ev, '[data-testid="branch-popup"]');
check('branch popup lists main', (branchText ?? '').includes('main'));
await setInput(ev, '[data-testid="branch-search"]', 'main');
await sleep(400);
check('branch search keeps main', await ev(`(doc) => (doc.querySelector('[data-testid="branch-popup"]')?.innerText ?? '').includes('main')`));
await setInput(ev, '[data-testid="branch-search"]', '');
await shot(wb, 'w2-branch-dark');
await escape(cdp);
check('Escape closes branch popup', !(await has('branch-popup')));

// 2) new changelist dialog → header appears → delete dialog → header gone
await rightClick('[data-testid="changelist-default"]');
await sleep(400);
check('changelist menu offers New Changelist', (await menuLabels()).includes(STRINGS.menus.changelist.new));
await clickTestId(ev, 'menu-new');
check('new changelist dialog opens', await waitFor(() => has('dialog-newchangelist')));
await setInput(ev, '[data-testid="changelist-name"]', 'Walkthrough');
await setInput(ev, '[data-testid="changelist-comment"]', 'created by walkthrough');
await shot(wb, 'w3-newlist-dark');
await clickTestId(ev, 'dialog-ok');
const listGone = () => ev(`(doc) => !Array.from(doc.querySelectorAll('[data-testid^="changelist-"]')).some(h => h.innerText.includes('Walkthrough'))`);
check('Walkthrough list header appears', await waitFor(async () => !(await listGone())));
const walkHeader = `(Array.from(doc.querySelectorAll('[data-testid^="changelist-"]')).find(h => h.innerText.includes('Walkthrough')))`;
await ev(`(doc) => {
  const h = ${walkHeader};
  const r = h.getBoundingClientRect();
  h.dispatchEvent(new doc.defaultView.MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.x + 30, clientY: r.y + 5 }));
}`);
await sleep(400);
await clickTestId(ev, 'menu-delete');
check('delete changelist dialog opens', await waitFor(() => has('dialog-deletechangelist')));
await clickTestId(ev, 'dialog-ok');
check('Walkthrough list removed', await waitFor(listGone));

// 3) shelve flow: highlight a file → toolbar Shelve → dialog → Shelf tab entry → unshelve → delete entry
await ev(`(doc) => ${firstFileRow}?.click()`);
await sleep(300);
check('shelve toolbar enabled with selection', await ev(`(doc) => doc.querySelector('[data-testid="tool-shelve"]')?.disabled === false`));
await clickTestId(ev, 'tool-shelve');
check('shelve dialog opens', await waitFor(() => has('dialog-shelve')));
await setInput(ev, '[data-testid="shelve-name"]', 'walkthrough shelf');
check('shelve dialog lists selected files', await ev(`(doc) => (doc.querySelector('[data-testid="shelve-files"]')?.innerText ?? '').length > 0`));
await shot(wb, 'w4-shelve-dark');
await clickTestId(ev, 'dialog-ok');
await sleep(1500);
await clickTestId(ev, 'tab-shelf');
check('shelf entry created', await waitFor(() => has('shelf-entry')));
check('shelf entry named walkthrough shelf', await ev(`(doc) => (doc.querySelector('[data-testid="shelf-entry"]')?.innerText ?? '').includes('walkthrough shelf')`));
await ev(`(doc) => doc.querySelector('[data-testid="shelf-entry"] .gbc-chevron')?.click()`);
await sleep(400);
check('shelf entry expands to files', await has('shelf-file'));
await dblClick('[data-testid="shelf-entry"] .gbc-shelfrow');
check('unshelve dialog opens', await waitFor(() => has('dialog-unshelve')));
check('unshelve targets a changelist (changelist mode)', await has('unshelve-target'));
check('unshelve remove-after option present', await has('unshelve-removeafter'));
await shot(wb, 'w5-unshelve-dark');
await clickTestId(ev, 'dialog-ok');
await sleep(2000);
await rightClick('[data-testid="shelf-entry"] .gbc-shelfrow');
await sleep(400);
const shelfMenu = await menuLabels();
check('shelf menu = IDEA set', JSON.stringify(shelfMenu) === JSON.stringify([
  STRINGS.menus.shelfEntry.unshelve, STRINGS.menus.shelfEntry.restore, STRINGS.menus.shelfEntry.createPatch,
  STRINGS.menus.shelfEntry.copyPatch, STRINGS.menus.shelfEntry.importPatches, STRINGS.menus.shelfEntry.importClipboard,
  STRINGS.menus.shelfEntry.delete,
]));
await clickTestId(ev, 'menu-delete');
check('delete shelf dialog opens', await waitFor(() => has('dialog-deleteshelf')));
await clickTestId(ev, 'dialog-ok');
check('shelf entry deleted', await waitFor(async () => !(await has('shelf-entry'))));
await clickTestId(ev, 'tab-commit');
await sleep(800);
check('unshelve restored file rows', await ev(`(doc) => doc.querySelectorAll('[data-testid="file-row"]').length >= 3`));

// 4) stash flow: create via dialog → entry listed → pop restores changes
await clickTestId(ev, 'tab-stash');
await sleep(1000);
await clickTestId(ev, 'stash-create');
check('stash create dialog opens', await waitFor(() => has('dialog-stash')));
await setInput(ev, '[data-testid="stash-message"]', 'walkthrough stash');
await shot(wb, 'w6-stash-dark');
await clickTestId(ev, 'dialog-ok');
check('stash entry created', await waitFor(() => has('stash-entry')));
check('stash entry carries message', await ev(`(doc) => (doc.querySelector('[data-testid="stash-entry"]')?.innerText ?? '').includes('walkthrough stash')`));
await rightClick('[data-testid="stash-entry"]');
await sleep(400);
check('stash menu = Apply/Pop/Drop', JSON.stringify(await menuLabels()) === JSON.stringify([
  STRINGS.menus.stashEntry.apply, STRINGS.menus.stashEntry.pop, STRINGS.menus.stashEntry.drop,
]));
await clickTestId(ev, 'menu-pop');
check('pop stash dialog opens', await waitFor(() => has('dialog-popstash')));
await clickTestId(ev, 'dialog-ok');
check('stash popped (list empty again)', await waitFor(async () => !(await has('stash-entry'))));
await clickTestId(ev, 'tab-commit');
await sleep(1000);
check('pop restored file rows', await ev(`(doc) => doc.querySelectorAll('[data-testid="file-row"]').length >= 3`));

// 5) Log view (separate Alt+9 webview): entries + commit detail editor tab
await openView(wb, 'Log');
const log = await panel('log-panel');
await selectOption(log.ev, '[data-testid="log-repo"]', 'repoA');
check('log lists entries', await waitFor(() => log.ev(`(doc) => doc.querySelectorAll('[data-testid="log-entry"]').length >= 2`)));
await shot(wb, 'w7-log-dark');
const oid = await log.ev(`(doc) => doc.querySelector('[data-testid="log-entry"]')?.getAttribute('data-oid') ?? ''`);
await log.ev(`(doc) => doc.querySelector('[data-testid="log-entry"] .gbc-loghash')?.click()`);
await sleep(4000);
const tabLabel = await wb.eval(`Array.from(document.querySelectorAll('.tab .label-name')).map(e => e.textContent).join(' | ')`);
check('commit detail tab opened', tabLabel.includes(oid.slice(0, 7)));
await shot(wb, 'w8-commitdiff-dark');
await wb.eval(`(() => {
  const tab = Array.from(document.querySelectorAll('.tab')).find(t => (t.textContent || '').includes(${JSON.stringify(oid.slice(0, 7))}));
  tab?.querySelector('.tab-close')?.click();
})()`);
await sleep(800);
log.cdp.ws.close();
await openView(wb, 'Commit');

// 6) keyboard: ArrowDown moves row focus; Ctrl+Alt+O toggles the options panel
await ev(`(doc) => ${firstFileRow}?.focus()`);
await sleep(300);
const focused0 = await ev(`(doc) => doc.activeElement?.getAttribute('data-path') ?? 'none'`);
await cdp.key('ArrowDown', 'ArrowDown', 40);
await sleep(300);
const focused1 = await ev(`(doc) => doc.activeElement?.getAttribute('data-path') ?? 'none'`);
check('ArrowDown moves row focus', focused0 !== focused1 && focused1 !== 'none');
await cdp.chord([{ key: 'o', code: 'KeyO', vk: 79, ctrl: true, alt: true }]);
check('Ctrl+Alt+O opens options panel', await waitFor(() => has('options-panel')));
check('options panel has sign-off + hooks toggles', await ev(`(doc) => !!doc.querySelector('[data-testid="option-signoff"]') && !!doc.querySelector('[data-testid="option-runhooks"]')`));
await shot(wb, 'w9-options-dark');
await cdp.chord([{ key: 'o', code: 'KeyO', vk: 79, ctrl: true, alt: true }]);
await sleep(400);
check('Ctrl+Alt+O closes options panel', !(await has('options-panel')));

// 7) file context menu + rollback dialog (cancel, no destructive action)
await rightClick(`[data-testid="file-row"]`);
await sleep(400);
const M = STRINGS.menus.file;
check('file menu = IDEA set in order', JSON.stringify(await menuLabels()) === JSON.stringify([
  M.showDiff, M.jumpToSource, M.openInSystemFolder, M.rollback, M.shelve, M.copyPath, M.delete,
]));
await shot(wb, 'w10-filemenu-dark');
await clickTestId(ev, 'menu-rollback');
check('rollback dialog opens with file list', await waitFor(() => has('dialog-rollback')) && await has('dialog-filelist'));
await shot(wb, 'w11-rollback-dark');
await clickTestId(ev, 'dialog-close');
await sleep(300);

// ---- light theme pass ----
await wb.eval(`document.querySelector('.monaco-workbench')?.focus()`);
await wb.chord([{ key: 'k', code: 'KeyK', vk: 75, ctrl: true }, { key: 't', code: 'KeyT', vk: 84, ctrl: true }]);
await sleep(1500);
await wb.eval(`(() => {
  const input = document.querySelector('.quick-input-widget input.input');
  if (!input) return;
  const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  set.call(input, 'Light Modern');
  input.dispatchEvent(new Event('input', { bubbles: true }));
})()`);
await sleep(1200);
await wb.key('Enter', 'Enter', 13);
await sleep(2500);
await shot(wb, 'w12-panel-light');

await clickTestId(ev, 'branch-widget');
await waitFor(() => has('branch-popup'));
await shot(wb, 'w13-branch-light');
await escape(cdp);

await cdp.chord([{ key: 'o', code: 'KeyO', vk: 79, ctrl: true, alt: true }]);
await waitFor(() => has('options-panel'));
await shot(wb, 'w14-options-light');
await cdp.chord([{ key: 'o', code: 'KeyO', vk: 79, ctrl: true, alt: true }]);
await sleep(400);

await ev(`(doc) => ${firstFileRow}?.click()`);
await sleep(300);
await clickTestId(ev, 'tool-rollback');
await waitFor(() => has('dialog-rollback'));
const contrast = await ev(`(doc) => {
  const btn = doc.querySelector('[data-testid="dialog-rollback"] [data-testid="dialog-ok"]');
  if (!btn) return null;
  const cs = doc.defaultView.getComputedStyle(btn);
  return { color: cs.color, bg: cs.backgroundColor };
}`);
check('light danger button has contrast', !!contrast && contrast.color !== contrast.bg);
await shot(wb, 'w15-rollback-light');
await clickTestId(ev, 'dialog-close');
await sleep(300);

await clickTestId(ev, 'mode-toggle');
check('mode switch dialog opens (light)', await waitFor(() => has('dialog-modeswitch')));
const modeTitle = await ev(`(doc) => doc.querySelector('[data-testid="dialog-modeswitch"]')?.getAttribute('aria-label') ?? ''`);
check('mode dialog title = Enable Staging Area', modeTitle === STRINGS.dialogs.modeEnableTitle);
await shot(wb, 'w16-modeswitch-light');
await clickTestId(ev, 'dialog-close');

// 8) batch push: visible Commit and Push button → commit → Push dialog → confirm;
//    standalone push keybinding; a rejected repo keeps the dialog open with per-row error.
const repoA = path.resolve('test/integration/.tmp/repoA');
const repoB = path.resolve('test/integration/.tmp/repoB');
const gitA = (...args) => execFileSync('git', args, { cwd: repoA, stdio: 'pipe' });
const gitB = (...args) => execFileSync('git', args, { cwd: repoB, stdio: 'pipe' });
const bareA = path.resolve('test/integration/.tmp/.walkPushA.git');
const bareB = path.resolve('test/integration/.tmp/.walkPushB.git');
execFileSync('git', ['init', '--bare', '-b', 'main', bareA], { stdio: 'pipe' });
execFileSync('git', ['init', '--bare', '-b', 'main', bareB], { stdio: 'pipe' });
gitA('remote', 'add', 'walk-origin', bareA);
gitB('remote', 'add', 'walk-origin', bareB);
// the Commit toolbar Push button (left of View Options) opens the same dialog
await clickTestId(ev, 'tool-push');
check('toolbar Push button opens the Push dialog', await waitFor(() => has('dialog-push')));
await clickTestId(ev, 'dialog-close');
await sleep(300);
// After a dialog closes, focus can fall back to the workbench: re-focus inside the
// webview (then blur the textarea) so the panel keymap receives the push chord.
const pushChord = async () => {
  await ev(`(doc) => { doc.querySelector('[data-testid="commit-message"]')?.focus(); }`);
  await sleep(250);
  await ev(`(doc) => { const a = doc.activeElement; if (a && a.blur) a.blur(); }`);
  await cdp.chord([{ key: 'p', code: 'KeyP', vk: 80, ctrl: true, alt: true, shift: true }]);
};
const pushRepoARow = `Array.from(doc.querySelectorAll('[data-testid="push-repo"]')).find(r => (r.innerText || '').includes('repoA'))`;
const clickRepoACommit = async (msg) => {
  await ev(`(doc) => {
    const row = ${pushRepoARow};
    if (row && !row.querySelector('[data-testid="push-commits"]')) row.querySelector('[data-testid="push-expand"]')?.click();
  }`);
  const found = await waitFor(() => ev(`(doc) => {
    const row = ${pushRepoARow};
    return Array.from(row?.querySelectorAll('[data-testid="push-commit"]') ?? []).some(c => (c.innerText || '').includes(${JSON.stringify(msg)}));
  }`));
  await ev(`(doc) => {
    const row = ${pushRepoARow};
    Array.from(row?.querySelectorAll('[data-testid="push-commit"]') ?? []).find(c => (c.innerText || '').includes(${JSON.stringify(msg)}))?.click();
  }`);
  return found;
};
// vscode.git observes new remotes asynchronously: retry the dialog until the preview sees them
const openRepoATarget = () => ev(`(doc) => {
  const row = Array.from(doc.querySelectorAll('[data-testid="push-repo"]')).find(r => (r.innerText || '').includes('repoA'));
  row?.querySelector('[data-testid="push-target"]')?.click();
  return true;
}`);
const repoARemoteVisible = () => ev(`(doc) => {
  const row = Array.from(doc.querySelectorAll('[data-testid="push-repo"]')).find(r => (r.innerText || '').includes('repoA'));
  return Array.from(row?.querySelector('[data-testid="push-remote"]')?.options ?? []).some(o => o.value === 'walk-origin');
}`);
let remotesSeen = false;
for (let i = 0; i < 6 && !remotesSeen; i++) {
  await pushChord();
  await waitFor(() => has('dialog-push'));
  await openRepoATarget();
  remotesSeen = await waitFor(repoARemoteVisible, 10000);
  if (!remotesSeen) {
    await clickTestId(ev, 'dialog-close');
    await sleep(1000);
  }
}
check('push preview sees freshly added remotes', remotesSeen);
// IDEA-style editable target: the remote/branch link opens an editor for any root
check('target editor exposes remote + branch fields', await ev(`(doc) => {
  const row = Array.from(doc.querySelectorAll('[data-testid="push-repo"]')).find(r => (r.innerText || '').includes('repoA'));
  return !!row?.querySelector('[data-testid="push-remote"]') && !!row?.querySelector('[data-testid="push-branch"]');
}`));
await ev(`(doc) => {
  const row = Array.from(doc.querySelectorAll('[data-testid="push-repo"]')).find(r => (r.innerText || '').includes('repoA'));
  const input = row?.querySelector('[data-testid="push-branch"]');
  if (input) {
    const set = Object.getOwnPropertyDescriptor(doc.defaultView.HTMLInputElement.prototype, 'value').set;
    set.call(input, 'walk-target');
    input.dispatchEvent(new doc.defaultView.Event('input', { bubbles: true }));
  }
}`);
check('editing the branch updates the target link', await waitFor(() => ev(`(doc) => {
  const row = Array.from(doc.querySelectorAll('[data-testid="push-repo"]')).find(r => (r.innerText || '').includes('repoA'));
  return (row?.querySelector('[data-testid="push-target"]')?.textContent ?? '').includes('walk-target');
}`)));
// IDEA semantics: a name that is not on the remote offers creation (empty bare remote → always)
check('branch editor offers to create a branch missing on the remote', await waitFor(() => ev(`(doc) => {
  const row = ${pushRepoARow};
  return !!row?.querySelector('[data-testid="push-branch-new"]');
}`)));
// restore the default branch so the batch push below targets main
await ev(`(doc) => {
  const row = Array.from(doc.querySelectorAll('[data-testid="push-repo"]')).find(r => (r.innerText || '').includes('repoA'));
  const input = row?.querySelector('[data-testid="push-branch"]');
  if (input) {
    const set = Object.getOwnPropertyDescriptor(doc.defaultView.HTMLInputElement.prototype, 'value').set;
    set.call(input, 'main');
    input.dispatchEvent(new doc.defaultView.Event('input', { bubbles: true }));
  }
  row?.querySelector('[data-testid="push-target-done"]')?.click();
}`);
await clickTestId(ev, 'dialog-close');
await sleep(300);
check('Commit and Push button visible', await has('commit-push-button'));
// repoB fixture ships a failing pre-commit hook: disable Run Git hooks via the options panel
await cdp.chord([{ key: 'o', code: 'KeyO', vk: 79, ctrl: true, alt: true }]);
await waitFor(() => has('options-panel'));
await ev(`(doc) => { const c = doc.querySelector('[data-testid="option-runhooks"]'); if (c && c.checked) c.click(); }`);
await cdp.chord([{ key: 'o', code: 'KeyO', vk: 79, ctrl: true, alt: true }]);
await sleep(400);
await setInput(ev, '[data-testid="commit-message"]', 'walkthrough batch push');
await sleep(300);
await clickTestId(ev, 'commit-push-button');
check('commit-and-push opens Push dialog after commit', await waitFor(() => has('dialog-push'), 25000));
check('push dialog lists project rows with checkboxes', await ev(`(doc) => doc.querySelectorAll('[data-testid="push-repo"] [data-testid="push-check"]').length >= 2`));
// The workspace also contains fixture repos (sub/nested/repoC/repoW) whose push targets
// are unreachable or absent: per-root selection lets the user scope the batch (IDEA parity).
const checkOnly = (names) => ev(`(doc) => {
  const want = ${JSON.stringify(names)};
  for (const row of doc.querySelectorAll('[data-testid="push-repo"]')) {
    const name = (row.innerText || '').split('\\n')[0];
    const c = row.querySelector('[data-testid="push-check"]');
    if (!c) continue;
    const on = want.includes(name);
    if (c.checked !== on) c.click();
  }
}`);
await checkOnly(['repoA', 'repoB']);
await ev(`(doc) => {
  const row = Array.from(doc.querySelectorAll('[data-testid="push-repo"]')).find(r => (r.innerText || '').includes('repoA'));
  row?.querySelector('[data-testid="push-expand"]')?.click();
}`);
check('outgoing commits preview lists the new commit', await waitFor(() => ev(`(doc) => {
  const row = Array.from(doc.querySelectorAll('[data-testid="push-repo"]')).find(r => (r.innerText || '').includes('repoA'));
  return (row?.querySelector('[data-testid="push-commits"]')?.innerText ?? '').includes('walkthrough batch push');
}`)));
// IDEA right-hand pane: commit selection → its changed files; double-click → editor diff
await clickRepoACommit('walkthrough batch push');
check('commit selection loads the changed-files pane', await waitFor(() => ev(`(doc) => doc.querySelectorAll('[data-testid="push-files"] [data-testid="push-file"]').length > 0`)));
const pushFilePath = await ev(`(doc) => doc.querySelector('[data-testid="push-file"] .gbc-pushfile-path')?.textContent ?? ''`);
await shot(wb, 'w17b-push-files');
await ev(`(doc) => { doc.querySelector('[data-testid="push-file"]')?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); }`);
const pushFileBase = pushFilePath.split('/').pop();
check('double-click opens the file diff in the editor area', await waitFor(() => wb.eval(`Array.from(document.querySelectorAll('.tab')).some(t => (t.textContent || '').includes(${JSON.stringify(pushFileBase)}))`), 15000));
await ev(`(doc) => {
  const row = ${pushRepoARow};
  row?.querySelector('[data-testid="push-repo-select"]')?.click();
}`);
check('repo selection lists the outgoing range files', await waitFor(() => ev(`(doc) => {
  const head = doc.querySelector('[data-testid="push-files-head"]')?.innerText ?? '';
  return head.includes('main') && doc.querySelectorAll('[data-testid="push-file"]').length > 0;
}`)));
await shot(wb, 'w17-push-dialog');
await clickTestId(ev, 'dialog-ok-main');
check('push dialog closes after successful batch push', await waitFor(async () => !(await has('dialog-push')), 25000));
const bareHead = (bare) => execFileSync('git', ['--git-dir', bare, 'rev-parse', 'main'], { stdio: 'pipe' }).toString().trim();
check('bare A received the pushed commit', gitA('rev-parse', 'HEAD').toString().trim() === bareHead(bareA));
check('bare B received the pushed commit (no-upstream auto remote)', gitB('rev-parse', 'HEAD').toString().trim() === bareHead(bareB));

// IDEA remote-branch listing: the target editor suggests branches of the chosen remote
await pushChord();
await waitFor(() => has('dialog-push'));
await openRepoATarget();
await waitFor(repoARemoteVisible, 10000);
check('branch editor lists remote branches of the chosen remote', await waitFor(() => ev(`(doc) => {
  const row = ${pushRepoARow};
  return Array.from(row?.querySelectorAll('[data-testid="push-branch-option"]') ?? []).some(b => b.textContent === 'main');
}`)));
await ev(`(doc) => {
  const row = ${pushRepoARow};
  const input = row?.querySelector('[data-testid="push-branch"]');
  if (input) {
    const set = Object.getOwnPropertyDescriptor(doc.defaultView.HTMLInputElement.prototype, 'value').set;
    set.call(input, 'walk-created');
    input.dispatchEvent(new doc.defaultView.Event('input', { bubbles: true }));
  }
}`);
check('typing filters the list and offers the new branch', await ev(`(doc) => {
  const row = ${pushRepoARow};
  const options = Array.from(row?.querySelectorAll('[data-testid="push-branch-option"]') ?? []).map(b => b.textContent);
  return options.length === 0 && !!row?.querySelector('[data-testid="push-branch-new"]');
}`));
await shot(wb, 'w17c-push-branchlist');
await ev(`(doc) => { ${pushRepoARow}?.querySelector('[data-testid="push-target-done"]')?.click(); }`);
await checkOnly(['repoA']);
await clickTestId(ev, 'dialog-ok-main');
check('push to a new remote branch name completes', await waitFor(async () => !(await has('dialog-push')), 25000));
const createdHead = execFileSync('git', ['--git-dir', bareA, 'rev-parse', 'refs/heads/walk-created'], { stdio: 'pipe' }).toString().trim();
check('push created the new remote branch (IDEA semantics)', createdHead === gitA('rev-parse', 'HEAD').toString().trim());

// standalone push: only ahead roots default-checked (ahead propagates asynchronously)
gitA('commit', '-q', '--allow-empty', '-m', 'walk ahead');
const repoAChecked = () => ev(`(doc) => {
  const row = Array.from(doc.querySelectorAll('[data-testid="push-repo"]')).find(r => (r.innerText || '').includes('repoA'));
  return row?.querySelector('[data-testid="push-check"]')?.checked === true;
}`);
let aheadChecked = false;
for (let i = 0; i < 8 && !aheadChecked; i++) {
  await sleep(1000);
  await pushChord();
  await waitFor(() => has('dialog-push'));
  aheadChecked = await repoAChecked();
  if (!aheadChecked) {
    await clickTestId(ev, 'dialog-close');
  }
}
check('standalone push opens dialog', await has('dialog-push'));
check('ahead repo default-checked', aheadChecked);
await clickRepoACommit('walk ahead');
check('empty commit shows the no-files state', await waitFor(() => has('push-files-empty')));
await checkOnly(['repoA']);
await clickTestId(ev, 'dialog-ok-main');
check('standalone push completes', await waitFor(async () => !(await has('dialog-push')), 25000));

// rejected push: dialog stays open with per-repo error + summary + Retry
const scratch = path.resolve('test/integration/.tmp/.walkPushScratch');
execFileSync('git', ['clone', '-q', bareA, scratch], { stdio: 'pipe' });
fs.writeFileSync(path.join(scratch, 'remote-side.txt'), 'r\n');
execFileSync('git', ['add', '.'], { cwd: scratch, stdio: 'pipe' });
execFileSync('git', ['commit', '-q', '-m', 'remote side'], { cwd: scratch, stdio: 'pipe' });
execFileSync('git', ['push', '-q', 'origin', 'main'], { cwd: scratch, stdio: 'pipe' });
gitA('commit', '-q', '--allow-empty', '-m', 'walk rejected');
await sleep(1000);
await pushChord();
await waitFor(() => has('dialog-push'));
await checkOnly(['repoA']);
await clickTestId(ev, 'dialog-ok-main');
check('rejected push keeps dialog open with per-repo error', await waitFor(() => has('push-error'), 25000));
check('push summary reports failure', await ev(`(doc) => (doc.querySelector('[data-testid="push-summary"]')?.innerText ?? '').includes('failed')`));
check('failed row offers Retry', await has('push-retry'));
await shot(wb, 'w18-push-rejected');
await clickTestId(ev, 'dialog-close');
gitA('remote', 'remove', 'walk-origin');
gitB('remote', 'remove', 'walk-origin');
fs.rmSync(bareA, { recursive: true, force: true });
fs.rmSync(bareB, { recursive: true, force: true });
fs.rmSync(scratch, { recursive: true, force: true });

cdp.ws.close();
wb.ws.close();
finish('WALKTHROUGH');