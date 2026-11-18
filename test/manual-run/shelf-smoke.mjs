// Shelf smoke: partial-file shelve, unshelve into a named changelist with remove-after, single-file unshelve.
// Run via: xvfb-run -a node test/manual-run/launch.mjs shelf-smoke.mjs
import { check, clickTestId, finish, openView, panel, selectOption, setInput, shot, sleep, workbench } from './lib/cdp.mjs';

const wb = await workbench();
await openView(wb, 'Commit');
const { cdp, ev } = await panel('commit-panel');
async function waitFor(fn, ms = 15000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await fn()) return true;
    await sleep(300);
  }
  return false;
}
const rightClick = (sel) => ev(`(doc) => {
  const el = doc.querySelector('${sel}');
  if (!el) return false;
  const r = el.getBoundingClientRect();
  el.dispatchEvent(new doc.defaultView.MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.x + 30, clientY: r.y + 5 }));
  return true;
}`);

// a named target changelist for the unshelve dialog
await rightClick('[data-testid="changelist-default"]');
await sleep(400);
await clickTestId(ev, 'menu-new');
await waitFor(() => ev(`(doc) => !!doc.querySelector('[data-testid="dialog-newchangelist"]')`));
await setInput(ev, '[data-testid="changelist-name"]', 'Shelf Target');
await clickTestId(ev, 'dialog-ok');
check('target changelist created', await waitFor(() => ev(`(doc) => Array.from(doc.querySelectorAll('[data-testid^="changelist-"]')).some(h => h.innerText.includes('Shelf Target'))`)));

// highlight two tracked files from the first repo that has two, shelve only the first
const pair = await ev(`(doc) => {
  const rows = Array.from(doc.querySelectorAll('[data-testid="file-row"]'))
    .filter(r => r.getAttribute('data-conflicted') === 'false' && r.getAttribute('data-status') !== '?');
  const byRepo = {};
  for (const r of rows) (byRepo[r.getAttribute('data-repo')] ??= []).push(r);
  const repoId = Object.keys(byRepo).find(id => byRepo[id].length >= 2);
  return (byRepo[repoId] ?? []).slice(0, 2).map(r => r.getAttribute('data-path'));
}`);
check('two candidate files found', pair.length === 2);
await ev(`(doc) => doc.querySelector('[data-testid="file-row"][data-path="${pair[0]}"]')?.click()`);
await sleep(200);
await ev(`(doc) => {
  const row = doc.querySelector('[data-testid="file-row"][data-path="${pair[1]}"]');
  row?.dispatchEvent(new doc.defaultView.MouseEvent('click', { bubbles: true, cancelable: true, shiftKey: true }));
}`);
await sleep(300);
await clickTestId(ev, 'tool-shelve');
check('shelve dialog lists both files', await waitFor(() => ev(`(doc) => doc.querySelectorAll('[data-testid="shelve-files"] input[type=checkbox]').length === 2`)));
await setInput(ev, '[data-testid="shelve-name"]', 'smoke shelf');
await ev(`(doc) => doc.querySelectorAll('[data-testid="shelve-files"] input[type=checkbox]')[1]?.click()`);
await sleep(300);
await shot(wb, 's1-shelf-overlay');
await clickTestId(ev, 'dialog-ok');
await sleep(1500);
await clickTestId(ev, 'tab-shelf');
await selectOption(ev, '[data-testid="shelf-repo"]', 'repoA');
check('shelf entry created', await waitFor(() => ev(`(doc) => !!doc.querySelector('[data-testid="shelf-entry"]')`)));
await ev(`(doc) => doc.querySelector('[data-testid="shelf-entry"] .gbc-chevron')?.click()`);
await sleep(400);
check('only the selected file was shelved', await ev(`(doc) => {
  const files = Array.from(doc.querySelectorAll('[data-testid="shelf-file"]')).map(f => f.getAttribute('data-path'));
  return files.length === 1 && files[0] === ${JSON.stringify(pair[0])};
}`));
await shot(wb, 's3-shelf-entry');

// unshelve into "Shelf Target" with remove-after
await ev(`(doc) => {
  const row = doc.querySelector('[data-testid="shelf-entry"] .gbc-shelfrow');
  row?.dispatchEvent(new doc.defaultView.MouseEvent('dblclick', { bubbles: true, cancelable: true }));
}`);
check('unshelve dialog opens', await waitFor(() => ev(`(doc) => !!doc.querySelector('[data-testid="dialog-unshelve"]')`)));
const targeted = await ev(`(doc) => {
  const sel = doc.querySelector('[data-testid="unshelve-target"]');
  const opt = Array.from(sel?.options ?? []).find(o => o.textContent === 'Shelf Target');
  if (!sel || !opt) return false;
  const set = Object.getOwnPropertyDescriptor(doc.defaultView.HTMLSelectElement.prototype, 'value').set;
  set.call(sel, opt.value);
  sel.dispatchEvent(new doc.defaultView.Event('change', { bubbles: true }));
  return true;
}`);
check('unshelve target selectable', targeted);
await ev(`(doc) => doc.querySelector('[data-testid="unshelve-removeafter"]')?.click()`);
await sleep(300);
await shot(wb, 's4-shelf-unshelve');
await clickTestId(ev, 'dialog-ok');
check('shelf removed after unshelve', await waitFor(async () => !(await ev(`(doc) => !!doc.querySelector('[data-testid="shelf-entry"]')`))));
await clickTestId(ev, 'tab-commit');
check('unshelved file back in the tree', await waitFor(() => ev(`(doc) => !!doc.querySelector('[data-testid="file-row"][data-path="${pair[0]}"]')`)));

// single-file unshelve via the shelf-file context menu
await ev(`(doc) => doc.querySelector('[data-testid="file-row"][data-path="${pair[0]}"]')?.click()`);
await sleep(200);
await clickTestId(ev, 'tool-shelve');
await waitFor(() => ev(`(doc) => !!doc.querySelector('[data-testid="dialog-shelve"]')`));
await setInput(ev, '[data-testid="shelve-name"]', 'smoke shelf 2');
await clickTestId(ev, 'dialog-ok');
await sleep(1500);
await clickTestId(ev, 'tab-shelf');
await selectOption(ev, '[data-testid="shelf-repo"]', 'repoA');
await waitFor(() => ev(`(doc) => !!doc.querySelector('[data-testid="shelf-entry"]')`));
await ev(`(doc) => doc.querySelector('[data-testid="shelf-entry"] .gbc-chevron')?.click()`);
await sleep(400);
await rightClick('[data-testid="shelf-file"]');
await sleep(400);
check('shelf file menu offers Unshelve File', await ev(`(doc) => !!doc.querySelector('[data-testid="menu-unshelveFile"]')`));
await clickTestId(ev, 'menu-unshelveFile');
await sleep(2000);
await clickTestId(ev, 'tab-commit');
check('single-file unshelve restored the file', await waitFor(() => ev(`(doc) => !!doc.querySelector('[data-testid="file-row"][data-path="${pair[0]}"]')`)));

// cleanup: remove leftover shelf entries and the target changelist
await clickTestId(ev, 'tab-shelf');
await selectOption(ev, '[data-testid="shelf-repo"]', 'repoA');
await sleep(800);
for (let i = 0; i < 3; i++) {
  const any = await ev(`(doc) => !!doc.querySelector('[data-testid="shelf-entry"] .gbc-shelfrow')`);
  if (!any) break;
  await rightClick('[data-testid="shelf-entry"] .gbc-shelfrow');
  await sleep(400);
  await clickTestId(ev, 'menu-delete');
  await waitFor(() => ev(`(doc) => !!doc.querySelector('[data-testid="dialog-deleteshelf"]')`));
  await clickTestId(ev, 'dialog-ok');
  await sleep(1000);
}
await clickTestId(ev, 'tab-commit');
await sleep(500);
await ev(`(doc) => {
  const h = Array.from(doc.querySelectorAll('[data-testid^="changelist-"]')).find(x => x.innerText.includes('Shelf Target'));
  if (!h) return false;
  const r = h.getBoundingClientRect();
  h.dispatchEvent(new doc.defaultView.MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.x + 30, clientY: r.y + 5 }));
  return true;
}`);
await sleep(400);
await clickTestId(ev, 'menu-delete');
await waitFor(() => ev(`(doc) => !!doc.querySelector('[data-testid="dialog-deletechangelist"]')`));
await clickTestId(ev, 'dialog-ok');
check('target changelist cleaned up', await waitFor(async () => !(await ev(`(doc) => Array.from(doc.querySelectorAll('[data-testid^="changelist-"]')).some(h => h.innerText.includes('Shelf Target'))`))));

cdp.ws.close();
wb.ws.close();
finish('SHELF-SMOKE');