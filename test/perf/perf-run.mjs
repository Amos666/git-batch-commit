// Perf calibration driver (Phase 4 re-baseline): measures §7 budgets against the
// IDEA-form UI in a real headless editor. Run via: xvfb-run -a node test/perf/launch-perf.mjs <10k|50k>
import * as fs from 'node:fs';
import * as path from 'node:path';
import { Cdp, clickTestId, connect, openView, panel, scrollTreeTo, selectOption, setInput, sleep, targets, workbench } from '../manual-run/lib/cdp.mjs';

const LABEL = process.argv[2] === '50k' ? '50k' : '10k';
const EXT_PORT = 9229;
const ROOT = path.resolve('test/perf/.tmp');
const results = { label: LABEL, budgets: {}, metrics: {} };
for (const r of ['repo10k', 'repo50k']) fs.rmSync(path.join(ROOT, r, 'probe-refresh.txt'), { force: true });

async function waitFor(fn, timeout, what) {
  const t0 = Date.now();
  for (;;) {
    const v = await fn().catch(() => null);
    if (v) return { value: v, ms: Date.now() - t0 };
    if (Date.now() - t0 > timeout) throw new Error(`timeout: ${what}`);
    await sleep(40);
  }
}

// ---- attach workbench and measure the cold first screen (fresh userdata + ext host;
// no Page.reload: VS Code's webview resource layer serves broken content to panels
// created after a workbench reload — harness artifact, not product behavior) ----
let wb = await workbench();
const ensurePanel = async () => {
  const open = await wb.eval(`(document.querySelector('.sidebar .composite.title')?.textContent ?? '').includes('Git Batch Commit')`).catch(() => false);
  if (!open) {
    await wb.eval(`(() => {
      const btn = Array.from(document.querySelectorAll('.activitybar .action-item a'))
        .find(a => (a.getAttribute('aria-label') || '').includes('Git Batch Commit'));
      if (btn) btn.click();
      return !!btn;
    })()`).catch(() => false);
  }
};
await waitFor(() => wb.eval(`!!document.querySelector('.activitybar .action-item a')`), 30000, 'workbench DOM');
const t0 = Date.now();
const commit = await waitFor(async () => {
  await ensurePanel();
  return panel('commit-panel').catch(() => null);
}, 90000, 'commit webview');
let wv = commit.value.cdp;
let ev = commit.value.ev;
try {
  await waitFor(() => ev(`(doc) => doc.querySelectorAll('.gbc-listrow').length >= 1 && doc.querySelectorAll('[data-testid="file-row"]').length >= 1`), 240000, 'first render');
} catch (err) {
  console.log('FIRST RENDER STATE DUMP:', JSON.stringify(await ev(`(doc) => ({
    bodyLen: doc.body.innerHTML.length,
    text: doc.body.textContent.slice(0, 400),
    testIds: Array.from(doc.querySelectorAll('[data-testid]')).slice(0, 15).map(e => e.getAttribute('data-testid')),
  })`).catch((e) => String(e))));
  throw err;
}
results.coldFirstScreenMs = Date.now() - t0;
console.log('cold first screen:', results.coldFirstScreenMs, 'ms');

// longtask observer + heap baseline
const installLongtasks = () => ev(`(doc) => {
  const w = doc.defaultView;
  w.__lt = [];
  new w.PerformanceObserver((l) => { for (const e of l.getEntries()) w.__lt.push(Math.round(e.duration)); }).observe({ entryTypes: ['longtask'] });
  return true;
}`);
await installLongtasks();
await wv.send('Performance.enable');
const heap = async () => (await wv.send('Performance.getMetrics')).metrics.find((m) => m.name === 'JSHeapUsedSize').value;
results.heapAfterRenderMB = Math.round((await heap()) / 1048576);

// quiescence gate: built-in initial scan finished and SCM badge stable
const badge = () => wb.eval(`(() => {
  const a = Array.from(document.querySelectorAll('.activitybar .action-item a')).find(x => (x.getAttribute('aria-label') || '').startsWith('Source Control'));
  const m = (a?.getAttribute('aria-label') || '').match(/(\\d+) pending/);
  return m ? Number(m[1]) : 0;
})()`).catch(() => 0);
await waitFor(async () => {
  const a = await badge();
  if (a <= 0) return null;
  await sleep(800);
  return a === (await badge()) ? a : null;
}, 120000, 'quiescent');

// ext-host event loop lag probe (max setTimeout(50) drift over ~2s)
let ext = null;
try {
  const et = (await targets(EXT_PORT)).find((t) => t.webSocketDebuggerUrl);
  if (et) ext = new Cdp(await connect(et.webSocketDebuggerUrl));
} catch { /* inspector not available */ }
const lagProbe = () => ext ? ext.eval(`new Promise((res) => {
  let max = 0, n = 0;
  const iv = setInterval(() => {
    const t = performance.now();
    setTimeout(() => { max = Math.max(max, performance.now() - t - 50); if (++n >= 40) { clearInterval(iv); res(Math.round(max)); } }, 50);
  }, 10);
})`) : Promise.resolve(null);

// host/webview [metric] lines via the diagnostics clipboard snapshot
const readMetrics = async () => {
  if (!ext) {
    console.log('metrics: ext inspector not connected');
    return;
  }
  const text = await ext.eval(`globalThis.__gbcMetrics = (async () => {
    const { createRequire } = process.getBuiltinModule('module');
    const v = createRequire(process.argv[1])('vscode');
    await v.commands.executeCommand('gitBatchCommit.copyDiagnostics');
    return v.env.clipboard.readText();
  })(); globalThis.__gbcMetrics`).catch((err) => {
    console.log('metrics read failed:', String(err).slice(0, 200));
    return '';
  });
  const snapshot = {};
  for (const m of String(text).matchAll(/\[metric\] ([\w.-]+)=(\d+)ms/g)) {
    (snapshot[m[1]] ??= []).push(Number(m[2]));
  }
  results.metrics = snapshot;
};

const repoName = LABEL === '50k' ? 'repo50k' : 'repo10k';
const treeBottom = () => ev(`(doc) => { const el = doc.querySelector('[data-testid="change-tree"]'); el.scrollTop = el.scrollHeight; return el.scrollTop; }`);

if (LABEL === '10k') {
  // ---- diff.data latency: open the editor-area diff viewer for the first file ----
  await ev(`(doc) => { const el = doc.querySelector('[data-testid="change-tree"]'); el.scrollTop = 0; return true; }`);
  await sleep(300);
  const tDiff = Date.now();
  await ev(`(doc) => {
    const el = doc.querySelector('[data-testid="file-row"]');
    if (!el) return false;
    el.dispatchEvent(new doc.defaultView.MouseEvent('dblclick', { bubbles: true, cancelable: true }));
    return true;
  }`);
  let dv;
  try {
    dv = await waitFor(() => panel('diff-viewer'), 20000, 'diff viewer webview');
  } catch (err) {
    console.log('DIFF STATE DUMP:', JSON.stringify(await ev(`(doc) => ({
      firstRow: doc.querySelector('[data-testid="file-row"]')?.getAttribute('data-path'),
      error: doc.querySelector('[data-testid="banner-error"]')?.textContent,
    })`)));
    console.log('targets:', JSON.stringify((await targets()).map((t) => ({ type: t.type, url: t.url.slice(0, 80) }))));
    if (ext) {
      const diag = await ext.eval(`globalThis.__gbcDiag = (async () => {
        const { createRequire } = process.getBuiltinModule('module');
        const v = createRequire(process.argv[1])('vscode');
        await v.commands.executeCommand('gitBatchCommit.copyDiagnostics');
        return v.env.clipboard.readText();
      })(); globalThis.__gbcDiag`).catch((e) => 'diag failed: ' + String(e));
      console.log('DIAGNOSTICS:\n' + String(diag).split('\n').slice(-30).join('\n'));
    }
    throw err;
  }
  await waitFor(() => dv.value.ev(`(doc) => doc.querySelectorAll('.dv-hunk').length >= 1`), 20000, 'diff rendered');
  results.diffOpenRenderMs = Date.now() - tDiff;
  await readMetrics();
  console.log('diff open+render:', results.diffOpenRenderMs, 'ms');

  // ---- log first screen 300 (repoLog has 350 commits) ----
  await openView(wb, 'Log');
  const log = await waitFor(() => panel('log-panel'), 20000, 'log webview');
  await sleep(1000);
  const tLog = Date.now();
  await selectOption(log.value.ev, '[data-testid="log-repo"]', 'repoLog');
  await waitFor(() => log.value.ev(`(doc) => doc.querySelectorAll('[data-testid="log-entry"]').length >= 300`), 20000, 'log 300');
  results.logFirstScreen300Ms = Date.now() - tLog;
  console.log('log 300 first screen:', results.logFirstScreen300Ms, 'ms');
  // back to the Commit pane: the virtualized tree needs a visible scroll container
  await openView(wb, 'Commit');
}

// ---- cold reload removed: a fresh launch (fresh userdata + ext host) IS the cold
// path; Page.reload both breaks VS Code's webview resource layer for new panels and
// leaves retained webviews pre-rendered, so it measured neither cold nor warm. ----

// ---- single-file refresh (new untracked file; Unversioned Files group sits below the fold) ----
await treeBottom();
await sleep(400);
const probe = path.join(ROOT, repoName, 'probe-refresh.txt');
const lagP = lagProbe();
const badgeBase = await badge();
const tRefresh = Date.now();
fs.writeFileSync(probe, 'probe\n');
const [builtIn, ours] = await Promise.all([
  waitFor(async () => (await badge()) > badgeBase, 20000, 'built-in badge bump'),
  waitFor(async () => {
    await treeBottom();
    return ev(`(doc) => !!Array.from(doc.querySelectorAll('[data-testid="file-row"]')).find(r => r.getAttribute('data-path') === 'probe-refresh.txt')`);
  }, 20000, 'refresh shows probe'),
]);
results.builtInRefreshMs = builtIn.ms;
results.singleFileRefreshMs = ours.ms;
results.ourPipelineAfterBuiltInMs = ours.ms - builtIn.ms;
results.extHostLagDuringRefreshMs = await lagP;
console.log('single-file refresh:', results.singleFileRefreshMs, 'ms (built-in', results.builtInRefreshMs, 'ms); ext-host lag:', results.extHostLagDuringRefreshMs);
await ev(`(doc) => { const el = doc.querySelector('[data-testid="change-tree"]'); el.scrollTop = 0; return true; }`);
await sleep(400);

if (LABEL === '10k') {
  // ---- include 100 files via the batch100 dir checkbox (changelist mode: inclusion, not staging) ----
  await scrollTreeTo(ev, '[data-testid="dir-row"][data-path="batch100"]');
  const tCheck = Date.now();
  await ev(`(doc) => { doc.querySelector('[data-testid="dir-row"][data-path="batch100"] input[type=checkbox]')?.click(); }`);
  await waitFor(() => ev(`(doc) => (doc.querySelector('[data-testid="dir-row"][data-path="batch100"] .gbc-count')?.textContent ?? '') === '100/100'`), 20000, '100 included');
  results.check100Ms = Date.now() - tCheck;
  console.log('check 100:', results.check100Ms, 'ms');

  // ---- commit feedback: click -> message cleared (result) -> tree refreshed ----
  await setInput(ev, '[data-testid="commit-message"]', 'perf: commit 100');
  await waitFor(() => ev(`(doc) => doc.querySelector('[data-testid="commit-button-main"]')?.disabled === false`), 10000, 'commit enabled');
  const tCommit = Date.now();
  await clickTestId(ev, 'commit-button-main');
  try {
    await waitFor(() => ev(`(doc) => (doc.querySelector('[data-testid="commit-message"]')?.value ?? 'x') === ''`), 30000, 'commit result');
  } catch (err) {
    console.log('COMMIT STATE DUMP:', JSON.stringify(await ev(`(doc) => ({
      message: doc.querySelector('[data-testid="commit-message"]')?.value,
      disabledReason: doc.querySelector('[data-testid="commit-disabled-reason"]')?.textContent,
      buttonDisabled: doc.querySelector('[data-testid="commit-button-main"]')?.disabled,
      error: doc.querySelector('[data-testid="banner-error"]')?.textContent,
      indexModified: doc.querySelector('[data-testid="banner-index-modified"]')?.textContent,
      dialog: doc.querySelector('[role="dialog"]')?.textContent?.slice(0, 300),
      listCount: doc.querySelector('.gbc-listrow .gbc-count')?.textContent,
    })`)));
    await readMetrics();
    console.log('metrics:', JSON.stringify(results.metrics));
    throw err;
  }
  results.commitResultMs = Date.now() - tCommit;
  await waitFor(() => ev(`(doc) => (doc.querySelector('.gbc-listrow .gbc-count')?.textContent ?? '') === '9900 files'`), 30000, 'post-commit refresh');
  results.commitFullFeedbackMs = Date.now() - tCommit;
  console.log('commit result:', results.commitResultMs, 'ms; full feedback:', results.commitFullFeedbackMs, 'ms');
  await readMetrics();
  console.log('metrics after commit:', JSON.stringify(results.metrics));

  // ---- select-all inclusion (9900 remaining tracked changes), then unselect ----
  const tAll = Date.now();
  await clickTestId(ev, 'changelist-check-default');
  await waitFor(() => ev(`(doc) => doc.querySelector('[data-testid="changelist-check-default"]')?.checked === true`), 60000, 'all included');
  results.checkAll10kMs = Date.now() - tAll;
  console.log('check all 10k:', results.checkAll10kMs, 'ms');
  const tNone = Date.now();
  await clickTestId(ev, 'changelist-check-default');
  await waitFor(() => ev(`(doc) => { const c = doc.querySelector('[data-testid="changelist-check-default"]'); return c && !c.checked && !c.indeterminate; }`), 60000, 'all excluded');
  results.uncheckAll10kMs = Date.now() - tNone;
  console.log('uncheck all 10k:', results.uncheckAll10kMs, 'ms');
}

if (LABEL === '50k') {
  await treeBottom();
  await sleep(1000);
  results.heapAfterScrollMB = Math.round((await heap()) / 1048576);
  const lagP2 = lagProbe();
  fs.appendFileSync(path.join(ROOT, repoName, 'f00000.txt'), 'more\n');
  await sleep(2500);
  results.extHostLagDuringRefreshMs = await lagP2;
}

results.longTasksMs = (await ev(`(doc) => doc.defaultView.__lt ?? []`)) ?? [];
results.heapFinalMB = Math.round((await heap()) / 1048576);
await readMetrics();
console.log('long tasks >100ms:', results.longTasksMs.filter((d) => d > 100));
console.log('heap MB:', results.heapAfterRenderMB, '->', results.heapFinalMB);
console.log('metrics:', JSON.stringify(results.metrics));

fs.writeFileSync(`test/perf/results-${LABEL}.json`, JSON.stringify(results, null, 2));
console.log('results written to test/perf/results-' + LABEL + '.json');
wb.ws.close();
wv.ws.close();
if (ext) ext.ws.close();
process.exit(0);