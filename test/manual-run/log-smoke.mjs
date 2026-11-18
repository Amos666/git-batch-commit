// Log actions smoke: cherry-pick empty-stop error + abort recovery, revert --no-commit staging.
// Run via: xvfb-run -a node test/manual-run/launch.mjs log-smoke.mjs
import { STRINGS } from '../../src/webview/strings/en.ts';
import { check, clickTestId, finish, openView, panel, selectOption, shot, sleep, workbench } from './lib/cdp.mjs';

const wb = await workbench();
await openView(wb, 'Commit');
const commit = await panel('commit-panel');
async function waitFor(fn, ms = 20000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await fn()) return true;
    await sleep(300);
  }
  return false;
}

// changelist mode never auto-stages, so repoA's index already matches HEAD.
await openView(wb, 'Log');
const { cdp, ev } = await panel('log-panel');
await selectOption(ev, '[data-testid="log-repo"]', 'repoA');
check('log entries rendered', await waitFor(() => ev(`(doc) => doc.querySelectorAll('[data-testid="log-entry"]').length >= 2`)));
check('entries expose Cherry-pick/Revert', await ev(`(doc) => {
  const row = doc.querySelector('[data-testid="log-entry"]');
  return !!row?.querySelector('[data-testid="log-cherrypick"]') && !!row?.querySelector('[data-testid="log-revert"]');
}`));
check('HEAD entry exposes Undo Commit', await ev(`(doc) => !!doc.querySelector('[data-testid="log-entry"] [data-testid="log-undo"]')`));

// 1) cherry-pick HEAD onto its own branch → empty stop → CONFLICT + abortSequencer recovery
const headOid = await ev(`(doc) => doc.querySelector('[data-testid="log-entry"]')?.getAttribute('data-oid') ?? ''`);
await clickTestId(ev, 'log-cherrypick');
check('cherry-pick confirm banner shown', await waitFor(() => ev(`(doc) => !!doc.querySelector('[data-testid="log-confirm"]')`)));
const pickConfirm = await ev(`(doc) => doc.querySelector('[data-testid="log-confirm"]')?.innerText ?? ''`);
check('confirm names the commit', pickConfirm.includes(headOid.slice(0, 7)));
await shot(wb, 's5-log-confirm');
await clickTestId(ev, 'log-confirm-ok');
check('empty cherry-pick surfaces error banner', await waitFor(() => ev(`(doc) => !!doc.querySelector('[data-testid="log-error"]')`)));
await shot(wb, 's6-log-error');
// recovery banner + abort dialog render in the Log view (its own store instance)
check('abort recovery offered', await waitFor(() => ev(`(doc) => !!doc.querySelector('[data-testid="sequencer-abort"]')`)));
await clickTestId(ev, 'sequencer-abort');
check('abort dialog opens', await waitFor(() => ev(`(doc) => !!doc.querySelector('[data-testid="dialog-abort"]')`)));
await clickTestId(ev, 'dialog-ok');
check('sequencer aborted, banner cleared', await waitFor(() => ev(`(doc) => !doc.querySelector('[data-testid="banner-sequencer"]')`)));

// 2) revert HEAD → inverse changes staged, no auto commit
await clickTestId(ev, 'log-refresh');
await sleep(1500);
await clickTestId(ev, 'log-revert');
check('revert confirm banner shown', await waitFor(() => ev(`(doc) => (doc.querySelector('[data-testid="log-confirm"]')?.innerText ?? '').length > 0`)));
const revConfirm = await ev(`(doc) => doc.querySelector('[data-testid="log-confirm"]')?.innerText ?? ''`);
check('revert confirm promises no auto commit', revConfirm.includes(STRINGS.log.revertConfirm(headOid.slice(0, 7))));
await clickTestId(ev, 'log-confirm-ok');
await openView(wb, 'Commit');
check('inverse deletions staged (D rows appear)', await waitFor(() => commit.ev(`(doc) => Array.from(doc.querySelectorAll('[data-testid="file-row"]')).some(r => r.getAttribute('data-status') === 'D')`)));
await shot(wb, 's7-log-revert-staged');

cdp.ws.close();
commit.cdp.ws.close();
wb.ws.close();
finish('LOG-SMOKE');