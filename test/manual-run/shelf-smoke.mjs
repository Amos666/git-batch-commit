// Shelf UI smoke (#26): create double-confirm → revert verified → unshelve → delete, via CDP
import * as fs from 'node:fs';
import * as path from 'node:path';

const PORT = 9223;
const ROOT = process.cwd();
const hunksAbs = path.join(ROOT, 'test/integration/.tmp/repoA/hunks.txt');
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

// ensurePanel: reload restores the view OPEN; only click when the sidebar shows another view
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
const clickBtnPrefix = (scope, prefix) => ev(`(doc) => {
  const root = ${scope ? `doc.querySelector('${scope}')` : 'doc'};
  if (!root) return false;
  const btn = Array.from(root.querySelectorAll('button')).find(b => b.textContent.trim().startsWith('${prefix}'));
  if (!btn || btn.disabled) return false;
  btn.click();
  return true;
}`);
const setInput = (sel, value) => ev(`(doc) => {
  const input = doc.querySelector('${sel}');
  if (!input) return false;
  const set = Object.getOwnPropertyDescriptor(doc.defaultView.HTMLInputElement.prototype, 'value').set;
  set.call(input, ${JSON.stringify(value)});
  input.dispatchEvent(new doc.defaultView.Event('input', { bubbles: true }));
  return true;
}`);

await waitFor(() => ev(`(doc) => doc.querySelectorAll('.gbc-reporow').length >= 1`), 'panel repos rendered');
const headBefore = fs.readFileSync(hunksAbs, 'utf8');
check('fixture hunks.txt has worktree changes', headBefore.includes('line 3 changed'));

// open Shelf overlay from repoA toolbar (toggle: skip click if already open)
const alreadyOpen = await ev(`(doc) => !!doc.querySelector('.gbc-shelfoverlay')`);
if (!alreadyOpen) {
  await ev(`(doc) => {
    const row = Array.from(doc.querySelectorAll('.gbc-reporow')).find(r => r.textContent.includes('repoA'));
    const btn = row && Array.from(row.querySelectorAll('button')).find(b => b.textContent.trim() === 'Shelf');
    if (btn) btn.click();
  }`);
}
await waitFor(() => ev(`(doc) => !!doc.querySelector('.gbc-shelfoverlay')`), 'shelf overlay opens');
const candidates = await ev(`(doc) => Array.from(doc.querySelectorAll('.gbc-shelffiles .gbc-shelffile')).map(l => l.textContent.trim())`);
check('candidates include tracked hunks.txt', candidates.some((c) => c.includes('hunks.txt')));
check('untracked files excluded from candidates', !candidates.some((c) => c.includes('big.txt') || c.includes('binary.bin')));

// keep only hunks.txt selected (repoA also has a submodule typechange candidate)
await ev(`(doc) => {
  for (const label of doc.querySelectorAll('.gbc-shelffiles .gbc-shelffile')) {
    const box = label.querySelector('input[type=checkbox]');
    if (box && box.checked && !label.textContent.includes('hunks.txt')) box.click();
  }
}`);
await sleep(200);

// empty name must be rejected client-side (clear any leftover name/confirm from prior runs)
await setInput('.gbc-shelfname', '');
await clickBtn('.gbc-shelfoverlay .gbc-confirm', '取消');
await sleep(200);
await clickBtnPrefix('.gbc-shelfcreate', '搁置选中');
await sleep(400);
const nameErr = await ev(`(doc) => doc.querySelector('.gbc-shelfoverlay')?.innerText ?? ''`);
check('empty name rejected', nameErr.includes('请输入 Shelf 名称'));

await setInput('.gbc-shelfname', 'smoke shelf');
await sleep(200);
await shot(wb, 's1-shelf-overlay');
await clickBtnPrefix('.gbc-shelfcreate', '搁置选中');
await waitFor(() => ev(`(doc) => !!doc.querySelector('.gbc-shelfoverlay .gbc-confirm')`), 'create double-confirm shown');
const confirmText = await ev(`(doc) => doc.querySelector('.gbc-shelfoverlay .gbc-confirm')?.innerText ?? ''`);
check('confirm explains revert to HEAD', confirmText.includes('恢复到 HEAD'));
await shot(wb, 's2-shelf-confirm');
await clickBtn('.gbc-shelfoverlay .gbc-confirm', '确认搁置');

await waitFor(() => ev(`(doc) => doc.querySelectorAll('.gbc-shelfitem').length === 1`), 'shelf entry listed');
await waitFor(() => !fs.readFileSync(hunksAbs, 'utf8').includes('line 3 changed'), 'worktree reverted to HEAD');
check('shelve reverted hunks.txt on disk', !fs.readFileSync(hunksAbs, 'utf8').includes('line 3 changed'));
const entryText = await ev(`(doc) => doc.querySelector('.gbc-shelfitem')?.innerText ?? ''`);
check('entry shows name/branch/file count', entryText.includes('smoke shelf') && entryText.includes('main') && entryText.includes('1 文件'));
await waitFor(() => ev(`(doc) => !Array.from(doc.querySelectorAll('.gbc-filerow')).some(r => r.textContent.includes('hunks.txt'))`), 'hunks.txt gone from change tree');
await shot(wb, 's3-shelf-entry');

// unshelve (full, keep entry)
await clickBtn('.gbc-shelfitem', '恢复…');
await waitFor(() => ev(`(doc) => !!doc.querySelector('.gbc-shelfunshelve')`), 'unshelve picker expands');
await shot(wb, 's4-shelf-unshelve');
await clickBtn('.gbc-shelfunshelve', '恢复到当前分支');
await waitFor(() => fs.readFileSync(hunksAbs, 'utf8').includes('line 3 changed'), 'unshelve restored worktree');
check('unshelve restored hunks.txt changes', fs.readFileSync(hunksAbs, 'utf8') === headBefore);
check('entry kept without removeAfter', await ev(`(doc) => doc.querySelectorAll('.gbc-shelfitem').length === 1`));

// delete with double confirm
await clickBtn('.gbc-shelfitem', '删除');
await waitFor(() => ev(`(doc) => !!doc.querySelector('.gbc-shelfitem .gbc-confirm')`), 'delete double-confirm shown');
await clickBtn('.gbc-shelfitem .gbc-confirm', '确认删除');
await waitFor(() => ev(`(doc) => doc.querySelectorAll('.gbc-shelfitem').length === 0`), 'entry deleted');
check('delete removes entry', await ev(`(doc) => (doc.querySelector('.gbc-shelflist')?.innerText ?? '').includes('没有 Shelf')`));

// Escape closes overlay
await wv.key('Escape', 'Escape', 27);
await sleep(600);
check('Escape closes shelf overlay', !(await ev(`(doc) => !!doc.querySelector('.gbc-shelfoverlay')`)));

console.log(failures.length === 0 ? '\nshelf smoke: all checks passed' : `\nshelf smoke FAILED: ${failures.join('; ')}`);
process.exit(failures.length === 0 ? 0 : 1);