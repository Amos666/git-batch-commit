// Diff viewer smoke: editor-area self-drawn viewer, hunk/line include checkboxes in
// changelist mode (partial badge), binary guard + force, staging-mode stage/unstage.
// Run via: xvfb-run -a node test/manual-run/launch.mjs diffview-smoke.mjs
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { Cdp, check, clickCheck, clickTestId, connect, finish, openView, panel, scrollTreeTo, shot, sleep, targets, workbench } from './lib/cdp.mjs';

const fixtureRepoA = path.resolve('test/integration/.tmp/repoA');
const gitA = (...args) => execFileSync('git', args, { cwd: fixtureRepoA, stdio: 'pipe' }).toString();

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

const inDoc = (body) => `(() => { const doc = document.querySelector('iframe')?.contentDocument; if (!doc || !doc.body) return null; return ((${body})(doc)); })()`;

/** Find the diff-viewer webview whose document satisfies the predicate (several panels may be open). */
async function findDiff(pred) {
  for (const t of await targets()) {
    if (t.type !== 'iframe' || !t.url.startsWith('vscode-webview://')) continue;
    const cdp = new Cdp(await connect(t.webSocketDebuggerUrl));
    const found = await cdp.eval(inDoc(pred));
    if (found) {
      return { cdp, ev: (body) => cdp.eval(inDoc(body)) };
    }
    cdp.ws.close();
  }
  return null;
}

const waitForDiff = async (pred, ms = 20000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const d = await findDiff(pred);
    if (d) return d;
    await sleep(400);
  }
  return null;
};

const dblclick = (ev, sel) => ev(`(doc) => {
  const el = doc.querySelector('${sel}');
  if (!el) return false;
  el.dispatchEvent(new doc.defaultView.MouseEvent('dblclick', { bubbles: true, cancelable: true }));
  return true;
}`);

const hunksRow = '[data-testid="file-row"][data-path="hunks.txt"]';
const checked = (ev, id) => ev(`(doc) => doc.querySelector('[data-testid="${id}"]')?.checked === true`);
const badge = () => commit.ev(`(doc) => !!doc.querySelector('${hunksRow} [data-testid="partial-badge"]')`);

// --- changelist mode: open the viewer by double-click, navigate hunks ---
check('hunks.txt row visible', await waitFor(() => commit.ev(`(doc) => !!doc.querySelector('${hunksRow}')`)));
await dblclick(commit.ev, hunksRow);
const dv = await waitForDiff(`(doc) => !!doc.querySelector('[data-testid="diff-viewer"]') && (doc.querySelector('.dv-title')?.textContent ?? '').includes('hunks.txt')`);
check('diff viewer opens in editor area for hunks.txt', !!dv);
if (!dv) finish('DIFFVIEW-SMOKE');
check('three hunk blocks rendered', await waitFor(() => dv.ev(`(doc) => ['diff-hunk-0','diff-hunk-1','diff-hunk-2'].every(id => !!doc.querySelector('[data-testid="' + id + '"]'))`)));
check('hunk counter starts at 1 / 3', await waitFor(async () => (await dv.ev(`(doc) => doc.querySelector('[data-testid="diff-hunk-counter"]')?.textContent`)) === '1 / 3'));
await clickTestId(dv.ev, 'diff-next-hunk');
check('next hunk → 2 / 3', (await dv.ev(`(doc) => doc.querySelector('[data-testid="diff-hunk-counter"]')?.textContent`)) === '2 / 3');
await clickTestId(dv.ev, 'diff-prev-hunk');
check('prev hunk → 1 / 3', (await dv.ev(`(doc) => doc.querySelector('[data-testid="diff-hunk-counter"]')?.textContent`)) === '1 / 3');
check('default-included file has all hunk checks on', await checked(dv.ev, 'hunk-check-0') && await checked(dv.ev, 'hunk-check-1') && await checked(dv.ev, 'hunk-check-2'));

// --- changelist mode: hunk exclusion → Partial badge in the commit tree ---
check('hunk 1 toggle clicked', await clickCheck(dv.ev, 'hunk-check-1'));
check('unchecking a hunk shows the Partial badge', await waitFor(badge));
check('hunk 1 unchecked, others stay checked', !(await checked(dv.ev, 'hunk-check-1')) && await checked(dv.ev, 'hunk-check-0') && await checked(dv.ev, 'hunk-check-2'));

// --- changelist mode: line-level toggle inside hunk 0 ---
const lineId = await dv.ev(`(doc) => doc.querySelector('[data-testid^="line-check-0-"]')?.getAttribute('data-testid') ?? null`);
check('hunk 0 exposes line checkboxes', !!lineId);
check('line toggle clicked', await clickCheck(dv.ev, lineId));
check('line unchecked', await waitFor(async () => !(await checked(dv.ev, lineId))));
check('partial badge persists after line toggle', await badge());
await shot(wb, 'dv1-changelist-partial');
check('line toggle clicked', await clickCheck(dv.ev, lineId));
check('line re-checked', await waitFor(() => checked(dv.ev, lineId)));
check('hunk 1 toggle clicked', await clickCheck(dv.ev, 'hunk-check-1'));
check('full selection clears the Partial badge', await waitFor(async () => !(await badge())));

// --- binary guard: diff.open pre-guard → DIFF_GUARDED banner → Open Anyway → binary notice ---
// binary.bin is untracked → lives in the Unversioned Files group at the tree
// bottom; the virtualized tree only renders the viewport, so scroll to it.
fs.appendFileSync(path.join(fixtureRepoA, 'binary.bin'), Buffer.from([0, 1, 2, 3]));
await clickTestId(commit.ev, 'tool-refresh');
const binaryRow = '[data-testid="file-row"][data-path="binary.bin"]';
check('binary.bin change visible', await waitFor(() => scrollTreeTo(commit.ev, binaryRow)));
await dblclick(commit.ev, binaryRow);
check('binary open raises the DIFF_GUARDED banner', await waitFor(() => commit.ev(`(doc) => doc.querySelector('[data-testid="banner-error"]')?.getAttribute('data-error-code') === 'DIFF_GUARDED'`)));
check('Open Anyway recovery offered', await commit.ev(`(doc) => !!doc.querySelector('[data-testid="error-action-forceOpenDiff"]')`));
await shot(wb, 'dv2-binary-guard');
await clickTestId(commit.ev, 'error-action-forceOpenDiff');
const binDv = await waitForDiff(`(doc) => !!doc.querySelector('[data-testid="diff-binary"]')`);
check('Open Anyway reveals the binary notice in the viewer', !!binDv);
if (!binDv) finish('DIFFVIEW-SMOKE');
binDv.cdp.ws.close();
// untracked file: restore the original fixture bytes (git restore would fail)
fs.writeFileSync(path.join(fixtureRepoA, 'binary.bin'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01, 0x02, 0x03]));

// --- viewer-side guard: an open viewer whose file turns binary shows the error bar + force button ---
const guardAbs = path.join(fixtureRepoA, 'dv-guard.txt');
fs.writeFileSync(guardAbs, 'guard probe\n');
await clickTestId(commit.ev, 'tool-refresh');
const guardRow = '[data-testid="file-row"][data-path="dv-guard.txt"]';
check('guard probe visible', await waitFor(() => scrollTreeTo(commit.ev, guardRow)));
await dblclick(commit.ev, guardRow);
const guardDv = await waitForDiff(`(doc) => (doc.querySelector('.dv-title')?.textContent ?? '').includes('dv-guard.txt')`);
check('text probe opens the viewer', !!guardDv);
if (!guardDv) finish('DIFFVIEW-SMOKE');
fs.appendFileSync(guardAbs, Buffer.from([0]));
await clickTestId(guardDv.ev, 'diff-refresh');
check('viewer reload hits DIFF_GUARDED error bar', await waitFor(() => guardDv.ev(`(doc) => !!doc.querySelector('[data-testid="diff-error"]')`)));
check('viewer offers force-open', await guardDv.ev(`(doc) => !!doc.querySelector('[data-testid="diff-force-open"]')`));
await clickTestId(guardDv.ev, 'diff-force-open');
check('viewer force reveals binary notice', await waitFor(() => guardDv.ev(`(doc) => !!doc.querySelector('[data-testid="diff-binary"]')`)));
guardDv.cdp.ws.close();
fs.rmSync(guardAbs);

// --- staging mode: migration stages checked files; staged-side checkboxes unstage ---
await clickTestId(commit.ev, 'mode-toggle');
check('mode switch dialog opens', await waitFor(() => commit.ev(`(doc) => !!doc.querySelector('[data-testid="dialog-modeswitch"]')`)));
await clickTestId(commit.ev, 'dialog-ok');
check('migration staged the checked hunks.txt', await waitFor(() => gitA('diff', '--cached', '--name-only').includes('hunks.txt')));
await scrollTreeTo(commit.ev, hunksRow);
await dblclick(commit.ev, hunksRow);
const stDv = await waitForDiff(`(doc) => (doc.querySelector('.dv-side')?.textContent ?? '') === 'HEAD ↔ Index'`);
check('staged-side viewer opens (HEAD ↔ Index)', !!stDv);
if (!stDv) finish('DIFFVIEW-SMOKE');
check('fully staged file has all hunk checks on', await checked(stDv.ev, 'hunk-check-0') && await checked(stDv.ev, 'hunk-check-1') && await checked(stDv.ev, 'hunk-check-2'));
check('hunk 2 toggle clicked', await clickCheck(stDv.ev, 'hunk-check-2'));
check('unchecking hunk 2 unstages it from the index', await waitFor(() => !gitA('show', ':hunks.txt').includes('line 39 changed')));
check('worktree keeps the unstaged hunk', fs.readFileSync(path.join(fixtureRepoA, 'hunks.txt'), 'utf8').includes('line 39 changed'));
check('viewer reload reflects the unstage', await waitFor(async () => !(await checked(stDv.ev, 'hunk-check-2'))));

// line-level unstage: drop the inserted line from the index blob
const addLineId = await stDv.ev(`(doc) => {
  const row = Array.from(doc.querySelectorAll('.dv-row[data-hunk="0"]')).find(r => (r.textContent ?? '').includes('line 3.5 inserted'));
  return row?.querySelector('input[data-testid^="line-check-"]')?.getAttribute('data-testid') ?? null;
}`);
check('inserted line exposes a checkbox on the staged side', !!addLineId);
check('line unstage toggle clicked', await clickCheck(stDv.ev, addLineId));
check('line unstage removes only that addition from the index', await waitFor(() => !gitA('show', ':hunks.txt').includes('line 3.5 inserted')));
check('rest of hunk 0 stays staged', gitA('show', ':hunks.txt').includes('line 3 changed'));
check('viewer reload drops the unstaged line', await waitFor(() => stDv.ev(`(doc) => !Array.from(doc.querySelectorAll('.dv-row[data-hunk="0"]')).some(r => (r.textContent ?? '').includes('line 3.5 inserted'))`)));
await shot(wb, 'dv3-staging-partial');

// the earlier changelist-side viewer is read-only in staging mode
const roDv = await findDiff(`(doc) => (doc.querySelector('.dv-side')?.textContent ?? '') === 'Working Tree ↔ HEAD' && (doc.querySelector('.dv-title')?.textContent ?? '').includes('hunks.txt')`);
check('head-side viewer is read-only in staging mode', !!roDv && await roDv.ev(`(doc) => doc.querySelector('[data-testid="hunk-check-0"]')?.disabled === true`));
if (roDv) roDv.cdp.ws.close();

// restore: re-stage host-side (hunk ids renumber after each partial unstage),
// then verify the viewer's refresh picks up the fully staged state
gitA('add', '--', 'hunks.txt');
await clickTestId(stDv.ev, 'diff-refresh');
check('refresh shows the fully staged file again', await waitFor(async () =>
  await checked(stDv.ev, 'hunk-check-0') && await checked(stDv.ev, 'hunk-check-1') && await checked(stDv.ev, 'hunk-check-2')));
gitA('restore', '--staged', '--', 'hunks.txt');

stDv.cdp.ws.close();
dv.cdp.ws.close();
commit.cdp.ws.close();
wb.ws.close();
finish('DIFFVIEW-SMOKE');