// Perf calibration driver (#25): measures §7 budgets against a real headless editor.
// usage: node test/perf/perf-run.mjs <10k|50k>
import * as fs from 'node:fs';
import * as path from 'node:path';

const LABEL = process.argv[2] === '50k' ? '50k' : '10k';
const PORT = 9223;
const EXT_PORT = 9229;
const ROOT = path.resolve('test/perf/.tmp');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = { label: LABEL, budgets: {} };
for (const r of ['repo10k', 'repo50k']) fs.rmSync(path.join(ROOT, r, 'probe-refresh.txt'), { force: true });

async function targets(port = PORT) {
  return (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json());
}
function connect(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.addEventListener('open', () => resolve(ws));
    ws.addEventListener('error', reject);
  });
}
class Cdp {
  constructor(ws) { this.ws = ws; this.id = 0; }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      const onMsg = (ev) => {
        const msg = JSON.parse(ev.data);
        if (msg.id === id) {
          this.ws.removeEventListener('message', onMsg);
          if (msg.error) reject(new Error(`${method}: ${JSON.stringify(msg.error.message)}`));
          else resolve(msg.result);
        }
      };
      this.ws.addEventListener('message', onMsg);
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async eval(expression) {
    const res = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (res.exceptionDetails) throw new Error('eval: ' + JSON.stringify(res.exceptionDetails).slice(0, 250));
    return res.result.value;
  }
  async key(key, code, keyCode) {
    for (const type of ['rawKeyDown', 'keyUp']) {
      await this.send('Input.dispatchKeyEvent', { type, key, code, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode });
    }
  }
}
async function waitFor(fn, timeout, what) {
  const t0 = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return { value: v, ms: Date.now() - t0 };
    if (Date.now() - t0 > timeout) throw new Error(`timeout: ${what}`);
    await sleep(40);
  }
}

// ---- attach workbench, warm activation, then cold reload ----
let wb = new Cdp(await connect((await targets()).find((t) => t.type === 'page' && t.url.startsWith('vscode-file://')).webSocketDebuggerUrl));
const openPanel = () => wb.eval(`(() => {
  const btn = Array.from(document.querySelectorAll('.activitybar .action-item a'))
    .find(a => (a.getAttribute('aria-label') || '').includes('Git Batch Commit'));
  if (btn) btn.click();
  return !!btn;
})()`);
const ensurePanel = async () => {
  const open = await wb.eval(`(document.querySelector('.sidebar .composite.title')?.textContent ?? '').includes('Git Batch Commit')`).catch(() => false);
  if (!open) await openPanel();
};
await ensurePanel();
await sleep(6000);
await wb.send('Page.reload');
const wbTarget = await waitFor(async () => (await targets()).find((t) => t.type === 'page' && t.url.startsWith('vscode-file://') && t.webSocketDebuggerUrl), 30000, 'workbench back');
wb = new Cdp(await connect(wbTarget.value.webSocketDebuggerUrl));
await waitFor(() => wb.eval(`!!document.querySelector('.activitybar .action-item a')`).catch(() => false), 30000, 'workbench DOM');
await sleep(2000);

const t0 = Date.now();
await ensurePanel();
const wtTarget = await waitFor(async () => (await targets()).find((t) => t.type === 'iframe' && t.url.startsWith('vscode-webview://')), 30000, 'webview target');
const wv = new Cdp(await connect(wtTarget.value.webSocketDebuggerUrl));
const inDoc = (body) => `(() => { const doc = document.querySelector('iframe')?.contentDocument; if (!doc || !doc.body) return null; return ((${body})(doc)); })()`;
const ev = (body) => wv.eval(inDoc(body)).catch(() => null);
const scroll = (where) => ev(`(doc) => { const el = doc.querySelector('.gbc-scroll'); el.scrollTop = ${where === 'top' ? '0' : 'el.scrollHeight'}; return el.scrollTop; }`);
await waitFor(() => ev(`(doc) => doc.querySelectorAll('.gbc-reporow').length >= 1 && doc.querySelectorAll('.gbc-grouprow').length >= 1`), 60000, 'first render');
results.coldFirstScreenMs = Date.now() - t0;
console.log('cold first screen:', results.coldFirstScreenMs, 'ms');

// longtask observer + heap baseline
await ev(`(doc) => {
  const w = doc.defaultView;
  w.__lt = [];
  new w.PerformanceObserver((l) => { for (const e of l.getEntries()) w.__lt.push(Math.round(e.duration)); }).observe({ entryTypes: ['longtask'] });
  return true;
}`);
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
}, 90000, 'quiescent');

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

const repoName = LABEL === '50k' ? 'repo50k' : 'repo10k';
const repoRow = `(Array.from(doc.querySelectorAll('.gbc-reporow')).find(r => r.textContent.includes('${repoName}')))`;

// ---- single-file refresh (new untracked file appears; untracked group sits below the fold) ----
await scroll('bottom');
await sleep(400);
const probe = path.join(ROOT, repoName, 'probe-refresh.txt');
const lagP = lagProbe();
const badgeBase = await badge();
const tRefresh = Date.now();
fs.writeFileSync(probe, 'probe\n');
const [builtIn, ours] = await Promise.all([
  waitFor(async () => (await badge()) > badgeBase, 15000, 'built-in badge bump'),
  waitFor(() => ev(`(doc) => !!Array.from(doc.querySelectorAll('.gbc-filerow')).find(r => r.textContent.includes('probe-refresh.txt'))`), 15000, 'refresh shows probe'),
]);
results.builtInRefreshMs = builtIn.ms;
results.singleFileRefreshMs = ours.ms;
results.ourPipelineAfterBuiltInMs = ours.ms - builtIn.ms;
results.extHostLagDuringRefreshMs = await lagP;
console.log('single-file refresh:', results.singleFileRefreshMs, 'ms (built-in', results.builtInRefreshMs, 'ms); ext-host lag:', results.extHostLagDuringRefreshMs);
await scroll('top');
await sleep(400);

if (LABEL === '10k') {
  // ---- stage 100 via batch100 dir checkbox ----
  const tStage = Date.now();
  await ev(`(doc) => { doc.querySelector('input[aria-label="暂存目录 batch100 下全部文件"]')?.click(); }`);
  await waitFor(() => ev(`(doc) => !!Array.from(doc.querySelectorAll('.gbc-grouprow')).find(r => r.textContent.includes('已暂存 (100)'))`), 15000, '100 staged');
  results.stage100Ms = Date.now() - tStage;
  console.log('stage 100:', results.stage100Ms, 'ms');

  // ---- commit feedback: click -> result + refresh ----
  await ev(`(doc) => {
    const ta = doc.querySelector('.gbc-commitbox textarea');
    const set = Object.getOwnPropertyDescriptor(doc.defaultView.HTMLTextAreaElement.prototype, 'value').set;
    set.call(ta, 'perf: commit 100');
    ta.dispatchEvent(new doc.defaultView.Event('input', { bubbles: true }));
  }`);
  const tCommit = Date.now();
  await ev(`(doc) => { doc.querySelector('.gbc-commitrow button.gbc-btn')?.click(); }`);
  await waitFor(() => ev(`(doc) => !!doc.querySelector('.gbc-result-ok')`), 30000, 'commit result');
  results.commitResultMs = Date.now() - tCommit;
  await waitFor(() => ev(`(doc) => !Array.from(doc.querySelectorAll('.gbc-grouprow')).some(r => r.textContent.includes('已暂存 (100)'))`), 30000, 'post-commit refresh');
  results.commitFullFeedbackMs = Date.now() - tCommit;
  console.log('commit result:', results.commitResultMs, 'ms; full feedback:', results.commitFullFeedbackMs, 'ms');

  // ---- select-all stage (9900 remaining tracked changes) ----
  const tAll = Date.now();
  await ev(`(doc) => {
    const row = Array.from(doc.querySelectorAll('.gbc-grouprow')).find(r => r.textContent.includes('变更 (9900)'));
    row?.querySelector('input[type=checkbox]')?.click();
  }`);
  await waitFor(() => ev(`(doc) => !!Array.from(doc.querySelectorAll('.gbc-grouprow')).find(r => r.textContent.includes('已暂存 (9900)'))`), 60000, 'all staged');
  results.stageAll10kMs = Date.now() - tAll;
  console.log('stage all 10k:', results.stageAll10kMs, 'ms');
  await ev(`(doc) => { Array.from(${repoRow}.querySelectorAll('.gbc-toolbar button')).find(b => b.textContent === '全部取消')?.click(); }`);
  await waitFor(() => ev(`(doc) => !!Array.from(doc.querySelectorAll('.gbc-grouprow')).find(r => r.textContent.includes('变更 (9900)'))`), 60000, 'all unstaged');

  // ---- log first screen 300 (repoLog row below the fold) ----
  await scroll('bottom');
  await sleep(400);
  const tLog = Date.now();
  await ev(`(doc) => { Array.from(Array.from(doc.querySelectorAll('.gbc-reporow')).find(r => r.textContent.includes('repoLog')).querySelectorAll('.gbc-toolbar button')).find(b => b.textContent === '日志')?.click(); }`);
  await waitFor(() => ev(`(doc) => doc.querySelectorAll('.gbc-logitem').length >= 300`), 15000, 'log 300');
  results.logFirstScreen300Ms = Date.now() - tLog;
  console.log('log 300 first screen:', results.logFirstScreen300Ms, 'ms');
  await wv.key('Escape', 'Escape', 27);
  await sleep(400);
}

if (LABEL === '50k') {
  // scroll to bottom, then heap + longtasks
  await ev(`(doc) => { const el = doc.querySelector('.gbc-scroll'); el.scrollTop = el.scrollHeight; return el.scrollTop; }`);
  await sleep(1000);
  results.heapAfterScrollMB = Math.round((await heap()) / 1048576);
  const lagP2 = lagProbe();
  fs.appendFileSync(path.join(ROOT, repoName, 'f00000.txt'), 'more\n');
  await sleep(2500);
  results.extHostLagDuringRefreshMs = await lagP2;
}

results.longTasksMs = (await ev(`(doc) => doc.defaultView.__lt ?? []`)) ?? [];
results.heapFinalMB = Math.round((await heap()) / 1048576);
console.log('long tasks >100ms:', results.longTasksMs.filter((d) => d > 100));
console.log('heap MB:', results.heapAfterRenderMB, '->', results.heapFinalMB);

fs.writeFileSync(`test/perf/results-${LABEL}.json`, JSON.stringify(results, null, 2));
console.log('results written to test/perf/results-' + LABEL + '.json');
wb.ws.close();
wv.ws.close();
if (ext) ext.ws.close();
process.exit(0);