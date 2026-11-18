// End-to-end drive: check files → commit (changelist mode) → verify in Log → branch create/checkout.
// Run via: xvfb-run -a node test/manual-run/launch.mjs drive.mjs
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
const ctrlClick = (sel) => ev(`(doc) => {
  const el = doc.querySelector('${sel}');
  if (!el) return false;
  el.dispatchEvent(new doc.defaultView.MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: true }));
  return true;
}`);

// pick two tracked, non-conflicted rows from the first repo that has two
const picks = await ev(`(doc) => {
  const rows = Array.from(doc.querySelectorAll('[data-testid="file-row"]'))
    .filter(r => r.getAttribute('data-conflicted') === 'false' && r.getAttribute('data-status') !== '?');
  const byRepo = {};
  for (const r of rows) (byRepo[r.getAttribute('data-repo')] ??= []).push(r);
  const repoId = Object.keys(byRepo).find(id => byRepo[id].length >= 2);
  const mine = (byRepo[repoId] ?? []).slice(0, 2);
  return { repoId, paths: mine.map(r => r.getAttribute('data-path')) };
}`);
check('found two tracked files to commit', picks.paths.length === 2);
// IDEA checks changelist files by default; clear the list, then include just the picks
await clickTestId(ev, 'changelist-check-default');
check('list header clears all inclusion', await waitFor(() => ev(`(doc) =>
  ${JSON.stringify(picks.paths)}.every(p => doc.querySelector('[data-testid="file-row"][data-repo="${picks.repoId}"][data-path="' + p + '"]')?.getAttribute('data-included') === 'false')`)));
for (const p of picks.paths) {
  await ctrlClick(`[data-testid="file-row"][data-repo="${picks.repoId}"][data-path="${p}"]`);
  await sleep(400);
}
check('ctrl+click marks rows included', await ev(`(doc) =>
  ${JSON.stringify(picks.paths)}.every(p => doc.querySelector('[data-testid="file-row"][data-repo="${picks.repoId}"][data-path="' + p + '"]')?.getAttribute('data-included') === 'true')`));

await setInput(ev, '[data-testid="commit-message"]', 'drive: changelist commit');
await sleep(300);
check('commit enabled with selection + message', await ev(`(doc) => doc.querySelector('[data-testid="commit-button-main"]')?.disabled === false`));
await shot(wb, 'drive1-before-commit');
await clickTestId(ev, 'commit-button-main');
const rowGone = (p) => ev(`(doc) => !doc.querySelector('[data-testid="file-row"][data-repo="${picks.repoId}"][data-path="${p}"]')`);
check('committed files leave the tree', await waitFor(async () => (await rowGone(picks.paths[0])) && (await rowGone(picks.paths[1]))));
check('message cleared on success', await waitFor(() => ev(`(doc) => (doc.querySelector('[data-testid="commit-message"]')?.value ?? 'x') === ''`)));
check('unchecked files remain', await ev(`(doc) => doc.querySelectorAll('[data-testid="file-row"][data-repo="${picks.repoId}"]').length >= 1`));
await shot(wb, 'drive2-after-commit');

// the commit must appear at the top of the Log view
await openView(wb, 'Log');
const log = await panel('log-panel');
await selectOption(log.ev, '[data-testid="log-repo"]', 'repoA');
check('log HEAD is the new commit', await waitFor(() => log.ev(`(doc) => (doc.querySelector('[data-testid="log-entry"] .gbc-logmessage')?.textContent ?? '').includes('drive: changelist commit')`)));
await shot(wb, 'drive3-log');
log.cdp.ws.close();
await openView(wb, 'Commit');

// branch create + checkout back through the popup
await clickTestId(ev, 'branch-widget');
check('branch popup opens', await waitFor(() => ev(`(doc) => !!doc.querySelector('[data-testid="branch-popup"]')`)));
await setInput(ev, '[data-testid="branch-new-name"]', 'drive-branch');
await sleep(300);
await clickTestId(ev, 'branch-new-create');
check('widget shows created branch', await waitFor(() => ev(`(doc) => (doc.querySelector('[data-testid="branch-widget"]')?.innerText ?? '').includes('drive-branch')`)));
await shot(wb, 'drive4-branch-created');
await clickTestId(ev, 'branch-widget');
await waitFor(() => ev(`(doc) => !!doc.querySelector('[data-testid="branch-popup"]')`));
await ev(`(doc) => doc.querySelector('[data-testid="branch-row"][data-branch="main"] .gbc-branchrow-main')?.click()`);
check('checkout back to main', await waitFor(() => ev(`(doc) => (doc.querySelector('[data-testid="branch-widget"]')?.innerText ?? '').includes('main')`)));

cdp.ws.close();
wb.ws.close();
finish('DRIVE');