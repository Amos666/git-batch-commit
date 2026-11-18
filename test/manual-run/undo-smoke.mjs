// Undo commit smoke: Log HEAD Undo Commit → confirm dialog → soft reset keeps changes staged.
// Run via: xvfb-run -a node test/manual-run/launch.mjs undo-smoke.mjs
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { check, clickTestId, finish, openView, panel, selectOption, shot, sleep, workbench } from './lib/cdp.mjs';

const fixtureRepoA = path.resolve('test/integration/.tmp/repoA');
const probeAbs = path.join(fixtureRepoA, 'undo-smoke.txt');
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
const probeRow = () => commit.ev(`(doc) => !!doc.querySelector('[data-testid="file-row"][data-path="undo-smoke.txt"]')`);

// probe commit created host-side so the smoke is independent of panel commit state
fs.writeFileSync(probeAbs, 'undo smoke\n');
execFileSync('git', ['add', 'undo-smoke.txt'], { cwd: fixtureRepoA, stdio: 'pipe' });
execFileSync('git', ['commit', '-m', 'undo smoke probe'], { cwd: fixtureRepoA, stdio: 'pipe' });

await openView(wb, 'Log');
const { cdp, ev } = await panel('log-panel');
await selectOption(ev, '[data-testid="log-repo"]', 'repoA');
await clickTestId(ev, 'log-refresh');
check('log HEAD is the probe commit', await waitFor(() => ev(`(doc) => (doc.querySelector('[data-testid="log-entry"] .gbc-logmessage')?.textContent ?? '').includes('undo smoke probe')`)));
check('HEAD entry offers Undo Commit', await ev(`(doc) => !!doc.querySelector('[data-testid="log-entry"] [data-testid="log-undo"]')`));

// first attempt: cancel must leave the commit intact (dialog renders in the Log view)
await clickTestId(ev, 'log-undo');
check('undo dialog opens', await waitFor(() => ev(`(doc) => !!doc.querySelector('[data-testid="dialog-undo"]')`)));
const body = await ev(`(doc) => doc.querySelector('[data-testid="dialog-undo"]')?.innerText ?? ''`);
check('dialog explains soft reset + pushed guard + repo', body.includes('soft reset') && body.includes('Pushed commits cannot be undone') && body.includes('repoA'));
await shot(wb, 's8-undo-confirm');
await clickTestId(ev, 'dialog-close');
await sleep(500);
check('cancel leaves commit intact', await ev(`(doc) => (doc.querySelector('[data-testid="log-entry"] .gbc-logmessage')?.textContent ?? '').includes('undo smoke probe')`));

// second attempt: confirm → soft reset puts the change back into the index
await clickTestId(ev, 'log-undo');
await waitFor(() => ev(`(doc) => !!doc.querySelector('[data-testid="dialog-undo"]')`));
await clickTestId(ev, 'dialog-ok');
check('undone change visible again', await waitFor(probeRow));
check('soft reset keeps change staged (A)', await commit.ev(`(doc) => doc.querySelector('[data-testid="file-row"][data-path="undo-smoke.txt"]')?.getAttribute('data-status') === 'A'`));
await shot(wb, 's9-undo-staged');

// cleanup: drop the probe from the index and disk, restoring fixture neutrality
execFileSync('git', ['rm', '--cached', '-q', 'undo-smoke.txt'], { cwd: fixtureRepoA, stdio: 'pipe' });
fs.rmSync(probeAbs, { force: true });

cdp.ws.close();
commit.cdp.ws.close();
wb.ws.close();
finish('UNDO-SMOKE');