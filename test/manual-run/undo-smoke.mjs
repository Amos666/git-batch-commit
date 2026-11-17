// Undo commit UI smoke (#31): toolbar button → double confirm → soft reset keeps changes staged
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

const PORT = 9223;
const fixtureRepoA = path.resolve('test/integration/.tmp/repoA');
const probeAbs = path.join(fixtureRepoA, 'undo-smoke.txt');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const failures = [];
const check = (name, cond) => {
  console.log(`${cond ? 'OK  ' : 'FAIL'} ${name}`);
  if (!cond) failures.push(name);
};

async function targets() {
  return (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json());
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
async function waitFor(fn, label, timeoutMs = 20000) {
  const start = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - start > timeoutMs) throw new Error(`timeout: ${label}`);
    await sleep(300);
  }
}
async function shot(cdp, name) {
  const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(`test/manual-run/${name}.png`, Buffer.from(data, 'base64'));
  console.log('shot ->', name + '.png');
}

const workbench = (await targets()).find((t) => t.type === 'page' && t.url.startsWith('vscode-file://'));
const wb = new Cdp(await connect(workbench.webSocketDebuggerUrl));
const ensurePanel = async () => {
  const open = await wb.eval(`(document.querySelector('.sidebar .composite.title')?.textContent ?? '').includes('Git Batch Commit')`);
  if (!open) {
    await wb.eval(`(() => {
      const btn = Array.from(document.querySelectorAll('.activitybar .action-item a'))
        .find(a => (a.getAttribute('aria-label') || '').includes('Git Batch Commit'));
      if (btn) btn.click();
    })()`);
  }
  await sleep(3000);
};
await ensurePanel();
const wt = await waitFor(async () => (await targets()).find((t) => t.type === 'iframe' && t.url.startsWith('vscode-webview://')), 'webview target');
const wv = new Cdp(await connect(wt.webSocketDebuggerUrl));
const ev = (body) => wv.eval(`(() => { const doc = document.querySelector('iframe').contentDocument; if (!doc || !doc.body) return 'NO INNER DOC'; return ((${body})(doc)); })()`);
const clickBtn = (scope, label) => ev(`(doc) => {
  const root = ${scope ? `doc.querySelector('${scope}')` : 'doc'};
  if (!root) return false;
  const btn = Array.from(root.querySelectorAll('button')).find(b => b.textContent.trim() === '${label}');
  if (!btn || btn.disabled) return false;
  btn.click();
  return true;
}`);
const repoABtn = (label) => ev(`(doc) => {
  const row = Array.from(doc.querySelectorAll('.gbc-reporow')).find(r => r.textContent.includes('repoA'));
  const btn = row && Array.from(row.querySelectorAll('button')).find(b => b.textContent.trim() === '${label}');
  if (!btn || btn.disabled) return false;
  btn.click();
  return true;
}`);
const probeRowVisible = () => ev(`(doc) => Array.from(doc.querySelectorAll('.gbc-filerow')).some(r => r.textContent.includes('undo-smoke.txt'))`);

await waitFor(() => ev(`(doc) => doc.querySelectorAll('.gbc-reporow').length >= 1`), 'panel repos rendered');
await clickBtn('.gbc-error', '关闭');

check('repoA toolbar exposes 撤销提交', await ev(`(doc) => {
  const row = Array.from(doc.querySelectorAll('.gbc-reporow')).find(r => r.textContent.includes('repoA'));
  return !!row && Array.from(row.querySelectorAll('button')).some(b => b.textContent.trim() === '撤销提交');
}`));

// create a probe commit (host-side git, like the integration suite; the panel Commit
// button is disabled while the walkthrough fixture repoC holds a merge conflict)
fs.writeFileSync(probeAbs, 'undo smoke\n');
execFileSync('git', ['add', 'undo-smoke.txt'], { cwd: fixtureRepoA, stdio: 'pipe' });
execFileSync('git', ['commit', '-m', 'undo smoke probe'], { cwd: fixtureRepoA, stdio: 'pipe' });
await waitFor(async () => !(await probeRowVisible()), 'probe commit reflected in panel');
check('probe commit created', true);

// first click → double confirm; cancel must leave the commit intact
await repoABtn('撤销提交');
await waitFor(() => ev(`(doc) => (doc.querySelector('.gbc-overlay .gbc-confirm')?.innerText ?? '').includes('撤销')`), 'undo confirm shown');
const confirmText = await ev(`(doc) => doc.querySelector('.gbc-overlay .gbc-confirm')?.innerText ?? ''`);
check('confirm explains soft reset + pushed guard', confirmText.includes('soft reset') && confirmText.includes('已推送') && confirmText.includes('repoA'));
await shot(wb, 's8-undo-confirm');
await clickBtn('.gbc-overlay .gbc-confirm', '取消');
await waitFor(() => ev(`(doc) => !doc.querySelector('.gbc-overlay .gbc-confirm')`), 'confirm cancelled');
check('cancel leaves commit intact', !(await probeRowVisible()));

// second click → confirm → soft reset puts the change back into the index
await repoABtn('撤销提交');
await waitFor(() => ev(`(doc) => !!doc.querySelector('.gbc-overlay .gbc-confirm')`), 'undo confirm shown again');
await clickBtn('.gbc-overlay .gbc-confirm', '确认撤销');
await waitFor(probeRowVisible, 'undone change visible again');
await waitFor(() => ev(`(doc) => {
  const rows = Array.from(doc.querySelectorAll('.gbc-reporow, .gbc-grouprow, .gbc-filerow'));
  const a = rows.findIndex(r => r.classList.contains('gbc-reporow') && r.textContent.includes('repoA'));
  const b = rows.findIndex(r => r.classList.contains('gbc-reporow') && r.textContent.includes('repoB'));
  const seg = rows.slice(a, b);
  const g = seg.findIndex(r => r.classList.contains('gbc-grouprow') && r.textContent.includes('已暂存'));
  const f = seg.findIndex(r => r.classList.contains('gbc-filerow') && r.textContent.includes('undo-smoke.txt'));
  return g >= 0 && f > g;
}`), 'probe back under 已暂存 group');
check('soft reset keeps change staged (A)', await ev(`(doc) => {
  const row = Array.from(doc.querySelectorAll('.gbc-filerow')).find(r => r.textContent.includes('undo-smoke.txt'));
  return !!row && row.textContent.includes('A');
}`));
await shot(wb, 's9-undo-staged');

// cleanup: unstage + remove the probe file, restoring fixture neutrality
await ev(`(doc) => {
  const row = Array.from(doc.querySelectorAll('.gbc-filerow')).find(r => r.textContent.includes('undo-smoke.txt'));
  const cb = row && row.querySelector('input[type=checkbox]');
  if (cb && !cb.disabled) cb.click();
}`);
await sleep(1000);
fs.rmSync(probeAbs, { force: true });

console.log(failures.length === 0 ? '\nundo smoke: all checks passed' : `\nundo smoke FAILED: ${failures.join('; ')}`);
process.exit(failures.length === 0 ? 0 : 1);