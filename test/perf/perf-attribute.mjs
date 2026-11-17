// Attribution probe (#25): split refresh/cold latency into built-in git vs our pipeline.
// usage: node test/perf/perf-attribute.mjs <repoName>
import * as fs from 'node:fs';
import * as path from 'node:path';

const REPO = process.argv[2] || 'repo10k';
const ROOT = path.resolve('test/perf/.tmp');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function targets() {
  return (await (await fetch('http://127.0.0.1:9223/json/list')).json());
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
}
async function waitFor(fn, timeout, what) {
  const t0 = Date.now();
  for (;;) {
    const v = await fn().catch(() => null);
    if (v) return { value: v, ms: Date.now() - t0 };
    if (Date.now() - t0 > timeout) throw new Error(`timeout: ${what}`);
    await sleep(30);
  }
}
const badge = (wb) => wb.eval(`(() => {
  const a = Array.from(document.querySelectorAll('.activitybar .action-item a')).find(x => (x.getAttribute('aria-label') || '').startsWith('Source Control'));
  const m = (a?.getAttribute('aria-label') || '').match(/(\\d+) pending/);
  return m ? Number(m[1]) : 0;
})()`);

let wb = new Cdp(await connect((await targets()).find((t) => t.type === 'page' && t.url.startsWith('vscode-file://')).webSocketDebuggerUrl));
const open = await wb.eval(`(document.querySelector('.sidebar .composite.title')?.textContent ?? '').includes('Git Batch Commit')`).catch(() => false);
if (!open) {
  await wb.eval(`(() => {
    const btn = Array.from(document.querySelectorAll('.activitybar .action-item a'))
      .find(a => (a.getAttribute('aria-label') || '').includes('Git Batch Commit'));
    if (btn) btn.click();
  })()`);
}
const wt0 = await waitFor(async () => (await targets()).find((t) => t.type === 'iframe' && t.url.startsWith('vscode-webview://')), 30000, 'webview target');
const wv = new Cdp(await connect(wt0.value.webSocketDebuggerUrl));
const ev = (body) => wv.eval(`(() => { const doc = document.querySelector('iframe')?.contentDocument; if (!doc || !doc.body) return null; return ((${body})(doc)); })()`).catch(() => null);
await waitFor(() => ev(`(doc) => { const el = doc.querySelector('.gbc-scroll'); if (el) el.scrollTop = 0; return doc.querySelectorAll('.gbc-grouprow').length >= 1; }`), 60000, 'panel ready');
// quiescence gate: built-in initial scan finished and badge stable
await waitFor(async () => {
  const a = await badge(wb);
  if (a <= 0) return null;
  await sleep(800);
  const b = await badge(wb);
  return a === b ? a : null;
}, 90000, 'quiescent');

// ensure our panel shows the untracked group (scroll bottom)
await ev(`(doc) => { const el = doc.querySelector('.gbc-scroll'); el.scrollTop = el.scrollHeight; return true; }`);
await sleep(400);
const probe = path.join(ROOT, REPO, 'probe-attr.txt');
fs.rmSync(probe, { force: true });
await sleep(1500);
const base = await badge(wb);
const t0 = Date.now();
fs.writeFileSync(probe, 'attr\n');
const builtIn = await waitFor(async () => (await badge(wb)) > base, 30000, 'built-in badge bump');
const ours = await waitFor(() => ev(`(doc) => !!Array.from(doc.querySelectorAll('.gbc-filerow')).find(r => r.textContent.includes('probe-attr.txt'))`), 30000, 'panel row');
console.log(JSON.stringify({
  repo: REPO,
  badgeBase: base,
  builtInRefreshMs: builtIn.ms,
  ourPipelineAfterBuiltInMs: ours.ms - builtIn.ms,
  totalRefreshMs: ours.ms,
}));

// cold split: reload -> built-in badge vs our first render
await wb.send('Page.reload');
const wb2t = await waitFor(async () => (await targets()).find((t) => t.type === 'page' && t.url.startsWith('vscode-file://') && t.webSocketDebuggerUrl), 30000, 'workbench back');
wb = new Cdp(await connect(wb2t.value.webSocketDebuggerUrl));
await waitFor(() => wb.eval(`!!document.querySelector('.activitybar')`).catch(() => false), 30000, 'workbench DOM');
const tc = Date.now();
const coldBuiltIn = await waitFor(async () => (await badge(wb)) > 0, 60000, 'built-in initial scan');
console.log(JSON.stringify({ repo: REPO, coldBuiltInScanMs: coldBuiltIn.ms }));
const open2 = await wb.eval(`(document.querySelector('.sidebar .composite.title')?.textContent ?? '').includes('Git Batch Commit')`).catch(() => false);
if (!open2) {
  await wb.eval(`(() => {
    const btn = Array.from(document.querySelectorAll('.activitybar .action-item a'))
      .find(a => (a.getAttribute('aria-label') || '').includes('Git Batch Commit'));
    if (btn) btn.click();
  })()`);
}
const coldOurs = await waitFor(async () => {
  const wt = (await targets()).find((t) => t.type === 'iframe' && t.url.startsWith('vscode-webview://'));
  if (!wt) return null;
  const c = new Cdp(await connect(wt.webSocketDebuggerUrl));
  const v = await c.eval(`(() => { const doc = document.querySelector('iframe')?.contentDocument; return doc ? doc.querySelectorAll('.gbc-grouprow').length : 0; })()`).catch(() => 0);
  c.ws.close();
  return v > 0 ? v : null;
}, 60000, 'panel first render');
console.log(JSON.stringify({
  repo: REPO,
  coldBuiltInScanMs: coldBuiltIn.ms,
  coldPanelAfterBuiltInMs: coldOurs.ms,
  coldTotalMs: Date.now() - tc,
}));
wb.ws.close();
wv.ws.close();
process.exit(0);