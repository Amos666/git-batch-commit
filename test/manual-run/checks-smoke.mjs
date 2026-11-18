// Commit Checks smoke: pre-commit report (Review / Commit Anyway) and the
// run-after-commit report (commit lands first, Review only).
// Run via: xvfb-run -a node test/manual-run/launch.mjs checks-smoke.mjs
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { STRINGS } from '../../src/webview/strings/en.ts';
import { check, clickTestId, finish, openView, panel, setInput, shot, sleep, workbench } from './lib/cdp.mjs';

const fixtureRepoA = path.resolve('test/integration/.tmp/repoA');
const gitA = (...args) => execFileSync('git', args, { cwd: fixtureRepoA, stdio: 'pipe' }).toString();
const modifiedAbs = path.join(fixtureRepoA, 'modified.txt');
// this smoke tests Commit Checks, not hook recovery: repoB's intentional
// failing pre-commit hook would stop the batch before repoA (stop-on-error)
fs.rmSync(path.resolve('test/integration/.tmp/repoB/.git/hooks/pre-commit'), { force: true });

const wb = await workbench();
await openView(wb, 'Commit');
const { cdp, ev } = await panel('commit-panel');

async function waitFor(fn, ms = 30000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await fn()) return true;
    await sleep(300);
  }
  return false;
}
const modifiedRow = () => ev(`(doc) => !!doc.querySelector('[data-testid="file-row"][data-path="modified.txt"]')`);
const reportDialog = () => ev(`(doc) => !!doc.querySelector('[data-testid="dialog-checksreport"]')`);

// host-side TODO change in a tracked file (checked by default)
fs.appendFileSync(modifiedAbs, '// TODO: checks smoke\n');
await clickTestId(ev, 'tool-refresh');
check('TODO change visible and checked', await waitFor(async () =>
  await modifiedRow() && await ev(`(doc) => doc.querySelector('[data-testid="file-row"][data-path="modified.txt"]')?.getAttribute('data-included') === 'true'`)));

// enable the Check TODO option
await clickTestId(ev, 'message-options');
await sleep(400);
await clickTestId(ev, 'option-check-todo');
await sleep(300);
check('todo check enabled', await ev(`(doc) => doc.querySelector('[data-testid="option-check-todo"]')?.checked === true`));
await clickTestId(ev, 'message-options');
await sleep(300);

// --- pre-commit: issues block the commit behind the report dialog ---
await setInput(ev, '[data-testid="commit-message"]', 'checks smoke pre-commit');
await sleep(300);
await clickTestId(ev, 'commit-button-main');
check('pre-commit checks report opens', await waitFor(reportDialog));
const todoRow = await ev(`(doc) => {
  const li = doc.querySelector('[data-testid="checks-report"] li[data-check="todo"]');
  return li ? { status: li.getAttribute('data-status'), text: li.textContent } : null;
}`);
check('todo reported as issues with location', todoRow?.status === 'issues' && todoRow.text.includes('modified.txt'));
const okLabel = await ev(`(doc) => doc.querySelector('[data-testid="dialog-ok"]')?.textContent ?? null`);
check('primary action is Commit Anyway', okLabel === STRINGS.checks.commitAnyway);
check('commit has not landed yet', gitA('log', '-1', '--format=%s').trim() !== 'checks smoke pre-commit');
await shot(wb, 'cs1-checks-report');

// Commit Anyway bypasses the checks and commits
await clickTestId(ev, 'dialog-ok');
check('Commit Anyway lands the commit', await waitFor(() => gitA('log', '-1', '--format=%s').trim() === 'checks smoke pre-commit'));
if (gitA('log', '-1', '--format=%s').trim() !== 'checks smoke pre-commit') {
  console.log('DIAG head:', gitA('log', '-1', '--format=%s').trim());
  console.log('DIAG banner:', await ev(`(doc) => doc.querySelector('[data-testid="banner-error"]')?.textContent ?? null`));
  console.log('DIAG included:', await ev(`(doc) => doc.querySelector('[data-testid="file-row"][data-path="modified.txt"]')?.getAttribute('data-included') ?? 'row-gone'`));
  console.log('DIAG index:', gitA('diff', '--cached', '--name-only').trim());
}
check('report dialog closed', await waitFor(async () => !(await reportDialog())));
// let commit 1 fully settle (batch + post-commit gate) before touching options,
// otherwise a slow batch picks up the runAfterCommit toggle mid-flight
await waitFor(async () => await ev(`(doc) => {
  const t = doc.querySelector('[data-testid="commit-disabled-reason"]')?.textContent ?? '';
  return t !== ${JSON.stringify(STRINGS.disabled.committing)} && t !== ${JSON.stringify(STRINGS.disabled.checksRunning)};
}`));

// --- post-commit: runAfterCommit reports after the commit has landed ---
await clickTestId(ev, 'message-options');
await sleep(400);
await clickTestId(ev, 'option-runaftercommit');
await sleep(300);
await clickTestId(ev, 'message-options');
await sleep(300);
fs.appendFileSync(modifiedAbs, '// TODO: post-commit smoke\n');
await clickTestId(ev, 'tool-refresh');
check('second TODO change visible', await waitFor(modifiedRow));
await setInput(ev, '[data-testid="commit-message"]', 'checks smoke post-commit');
await sleep(300);
await clickTestId(ev, 'commit-button-main');
check('post-commit report opens', await waitFor(reportDialog));
check('commit already landed before the post-commit report', gitA('log', '-1', '--format=%s').trim() === 'checks smoke post-commit');
const postTodo = await ev(`(doc) => doc.querySelector('[data-testid="checks-report"] li[data-check="todo"]')?.getAttribute('data-status') ?? null`);
check('post-commit todo still reports issues', postTodo === 'issues');
check('no Commit Anyway after commit', await ev(`(doc) => !doc.querySelector('[data-testid="dialog-ok"]')`));
const closeLabel = await ev(`(doc) => doc.querySelector('[data-testid="dialog-review"]')?.textContent ?? null`);
check('post-commit action is Review', closeLabel === STRINGS.checks.review);
await shot(wb, 'cs2-postcommit-report');
await clickTestId(ev, 'dialog-review');
await sleep(400);

// cleanup: drop the TODO probe lines
execFileSync('git', ['restore', '--worktree', '--', 'modified.txt'], { cwd: fixtureRepoA, stdio: 'pipe' });

cdp.ws.close();
wb.ws.close();
finish('CHECKS-SMOKE');