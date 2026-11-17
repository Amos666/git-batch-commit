// Log actions UI smoke (#29): cherry-pick empty-stop error + abort recovery, revert --no-commit staging
import * as fs from 'node:fs';

const PORT = 9223;
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

await waitFor(() => ev(`(doc) => doc.querySelectorAll('.gbc-reporow').length >= 1`), 'panel repos rendered');

// sequencer ops require an index matching HEAD: unstage repoA's auto-staged changes first
await ev(`(doc) => {
  const row = Array.from(doc.querySelectorAll('.gbc-reporow')).find(r => r.textContent.includes('repoA'));
  const btn = row && Array.from(row.querySelectorAll('button')).find(b => b.textContent.trim() === '全部取消');
  if (btn) btn.click();
}`);
await waitFor(() => ev(`(doc) => {
  const rows = Array.from(doc.querySelectorAll('.gbc-reporow, .gbc-grouprow'));
  const a = rows.findIndex(r => r.classList.contains('gbc-reporow') && r.textContent.includes('repoA'));
  const b = rows.findIndex(r => r.classList.contains('gbc-reporow') && r.textContent.includes('repoB'));
  return a >= 0 && b > a && !rows.slice(a, b).some(r => r.classList.contains('gbc-grouprow') && r.textContent.includes('已暂存'));
}`), 'repoA index clean');

// open repoA log
const logOpen = await ev(`(doc) => !!doc.querySelector('.gbc-logoverlay')`);
if (!logOpen) {
  await ev(`(doc) => {
    const row = Array.from(doc.querySelectorAll('.gbc-reporow')).find(r => r.textContent.includes('repoA'));
    const btn = row && Array.from(row.querySelectorAll('button')).find(b => b.textContent.trim() === '日志');
    if (btn) btn.click();
  }`);
}
await waitFor(() => ev(`(doc) => doc.querySelectorAll('.gbc-logitem').length >= 3`), 'log entries rendered');
check('log rows expose 拣选/反转 actions', await ev(`(doc) => {
  const row = doc.querySelector('.gbc-logrow');
  if (!row) return false;
  const labels = Array.from(row.querySelectorAll('.gbc-logactions button')).map(b => b.textContent.trim());
  return labels.includes('拣选') && labels.includes('反转');
}`));
check('row click still opens commit detail target', await ev(`(doc) => !!doc.querySelector('.gbc-logitem')`));

// 1) cherry-pick HEAD onto its own branch → empty stop → CONFLICT + abortSequencer recovery
await clickBtn('.gbc-error', '关闭');
await ev(`(doc) => { doc.querySelector('.gbc-logrow .gbc-logactions button')?.click(); }`);
await waitFor(() => ev(`(doc) => !!doc.querySelector('.gbc-logoverlay .gbc-confirm')`), 'cherry-pick confirm shown');
const pickConfirm = await ev(`(doc) => doc.querySelector('.gbc-logoverlay .gbc-confirm')?.innerText ?? ''`);
check('cherry-pick confirm names branch', pickConfirm.includes('拣选到当前分支 main'));
await shot(wb, 's5-log-confirm');
await clickBtn('.gbc-logoverlay .gbc-confirm', '确认拣选');
await waitFor(() => ev(`(doc) => (doc.querySelector('.gbc-error')?.innerText ?? '').includes('中止拣选/反转')`), 'empty cherry-pick surfaces abort recovery');
const errText = await ev(`(doc) => doc.querySelector('.gbc-error')?.innerText ?? ''`);
check('error offers abort recovery', errText.includes('中止拣选/反转'));
await shot(wb, 's6-log-error');
await clickBtn('.gbc-error', '中止拣选/反转');
await waitFor(() => ev(`(doc) => (doc.querySelector('.gbc-overlay .gbc-confirm')?.innerText ?? '').includes('中止')`), 'abort double-confirm shown');
await clickBtn('.gbc-overlay .gbc-confirm', '确认中止');
await waitFor(() => ev(`(doc) => !doc.querySelector('.gbc-overlay .gbc-confirm')`), 'abort confirm closed');
check('sequencer aborted via recovery action', true);
await clickBtn('.gbc-error', '关闭');

// 2) revert HEAD commit → inverse staged, no auto commit (abort reset closed the log overlay)
await ev(`(doc) => {
  const row = Array.from(doc.querySelectorAll('.gbc-reporow')).find(r => r.textContent.includes('repoA'));
  const btn = row && Array.from(row.querySelectorAll('button')).find(b => b.textContent.trim() === '日志');
  if (btn) btn.click();
}`);
await waitFor(() => ev(`(doc) => doc.querySelectorAll('.gbc-logrow').length >= 1`), 'log reopened');
await ev(`(doc) => {
  const btns = doc.querySelectorAll('.gbc-logrow .gbc-logactions button');
  btns[1]?.click();
}`);
await waitFor(() => ev(`(doc) => (doc.querySelector('.gbc-logoverlay .gbc-confirm')?.innerText ?? '').includes('反转')`), 'revert confirm shown');
const revConfirm = await ev(`(doc) => doc.querySelector('.gbc-logoverlay .gbc-confirm')?.innerText ?? ''`);
check('revert confirm promises no auto commit', revConfirm.includes('不自动提交'));
await clickBtn('.gbc-logoverlay .gbc-confirm', '确认反转');
await waitFor(() => ev(`(doc) => Array.from(doc.querySelectorAll('.gbc-grouprow')).some(g => g.textContent.includes('已暂存 (3)'))`), 'inverse changes staged (3 files)');
check('revert staged add/rename/delete inverse', await ev(`(doc) => {
  const rows = Array.from(doc.querySelectorAll('.gbc-filerow')).map(r => r.textContent);
  return rows.some(t => t.includes('probe-add.txt')) && rows.some(t => t.includes('中文 文件.txt'));
}`));
await shot(wb, 's7-log-revert-staged');

// Escape closes log overlay
await wv.key('Escape', 'Escape', 27);
await sleep(600);
check('Escape closes log overlay', !(await ev(`(doc) => !!doc.querySelector('.gbc-logoverlay')`)));

console.log(failures.length === 0 ? '\nlog smoke: all checks passed' : `\nlog smoke FAILED: ${failures.join('; ')}`);
process.exit(failures.length === 0 ? 0 : 1);