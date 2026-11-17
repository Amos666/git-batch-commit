// Visual walkthrough (task #24): five overlays + keyboard nav, dark then light theme
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
  async key(key, code, keyCode, modifiers = 0) {
    for (const type of ['rawKeyDown', 'keyUp']) {
      await this.send('Input.dispatchKeyEvent', { type, key, code, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode, modifiers });
    }
  }
  async chord(keys) {
    // keys: [{key, code, vk, ctrl}]
    let modifiers = 0;
    for (const k of keys) {
      if (k.ctrl) modifiers |= 2;
      await this.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: k.key, code: k.code, windowsVirtualKeyCode: k.vk, nativeVirtualKeyCode: k.vk, modifiers });
    }
    for (const k of [...keys].reverse()) {
      if (k.ctrl) modifiers &= ~2;
      await this.send('Input.dispatchKeyEvent', { type: 'keyUp', key: k.key, code: k.code, windowsVirtualKeyCode: k.vk, nativeVirtualKeyCode: k.vk, modifiers });
    }
  }
}
async function shot(cdp, name) {
  const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(`test/manual-run/${name}.png`, Buffer.from(data, 'base64'));
  console.log('shot ->', name + '.png');
}

const list0 = await targets();
const workbench = list0.find((t) => t.type === 'page' && t.url.startsWith('vscode-file://'));
const wb = new Cdp(await connect(workbench.webSocketDebuggerUrl));

const already = await wb.eval(`!!Array.from(document.querySelectorAll('.title')).find(t => (t.textContent || '').includes('Git Batch Commit: Commit'))`);
if (!already) {
  await wb.eval(`(() => {
    const btn = Array.from(document.querySelectorAll('.activitybar .action-item a'))
      .find(a => (a.getAttribute('aria-label') || '').includes('Git Batch Commit'));
    if (btn) btn.click();
  })()`);
  await sleep(5000);
}
const wt = (await targets()).find((t) => t.type === 'iframe' && t.url.startsWith('vscode-webview://'));
if (!wt) throw new Error('no vscode-webview target');
const wv = new Cdp(await connect(wt.webSocketDebuggerUrl));
const inDoc = (body) => `(() => { const doc = document.querySelector('iframe').contentDocument; if (!doc || !doc.body) return 'NO INNER DOC'; return ((${body})(doc)); })()`;
const ev = (body) => wv.eval(inDoc(body));
const setInput = (sel, value) => ev(`(doc) => {
  const input = doc.querySelector('${sel}');
  if (!input) return false;
  const set = Object.getOwnPropertyDescriptor(doc.defaultView.HTMLInputElement.prototype, 'value').set;
  set.call(input, ${JSON.stringify(value)});
  input.dispatchEvent(new doc.defaultView.Event('input', { bubbles: true }));
  return true;
}`);
const clickBtn = (scope, label) => ev(`(doc) => {
  const root = ${scope ? `doc.querySelector('${scope}')` : 'doc'};
  if (!root) return false;
  const btn = Array.from(root.querySelectorAll('button')).find(b => b.textContent.trim() === '${label}');
  if (!btn || btn.disabled) return false;
  btn.click();
  return true;
}`);
const repoRow = (name) => `(Array.from(doc.querySelectorAll('.gbc-reporow')).find(r => r.textContent.includes('${name}')))`;
const esc = async () => { await wv.key('Escape', 'Escape', 27); await sleep(600); };

// ---- dark theme pass ----
const theme = await wb.eval(`document.body.className`);
console.log('body classes:', theme);
await shot(wb, 'w1-panel-dark');
check('panel renders repos', await ev(`(doc) => doc.querySelectorAll('.gbc-reporow').length >= 3`));

// 1) branch overlay — must list local branches now (bug #22 regression)
await ev(`(doc) => { ${repoRow('repoA')}?.querySelector('.gbc-branch')?.click(); }`);
await sleep(2000);
const branchText = await ev(`(doc) => doc.querySelector('.gbc-branchmgr')?.innerText ?? ''`);
check('branch overlay lists main', branchText.includes('main'));
check('branch overlay not empty', !branchText.includes('没有本地分支'));
await shot(wb, 'w2-branch-dark');
await esc();
check('Escape closes branch overlay', !(await ev(`(doc) => !!doc.querySelector('.gbc-branchmgr')`)));

// 2) hunk overlay on hunks.txt
await ev(`(doc) => {
  const row = Array.from(doc.querySelectorAll('.gbc-filerow')).find(r => r.textContent.includes('hunks.txt'));
  const btn = row && Array.from(row.querySelectorAll('button')).find(b => b.textContent.trim() === 'Hunk');
  if (btn) btn.click();
}`);
await sleep(2500);
const hunkCount = await ev(`(doc) => doc.querySelectorAll('.gbc-hunk').length`);
check('hunk overlay shows hunks', hunkCount >= 2);
await shot(wb, 'w3-hunk-dark');
await esc();
check('Escape closes hunk overlay', !(await ev(`(doc) => !!doc.querySelector('.gbc-hunkoverlay')`)));

// 3) stash overlay: create an entry, verify list + inline drop confirm
await ev(`(doc) => { Array.from(${repoRow('repoA')}.querySelectorAll('.gbc-toolbar button')).find(b => b.textContent === 'Stash')?.click(); }`);
await sleep(1500);
await setInput('.gbc-stashmsg', 'walkthrough stash');
await clickBtn('.gbc-stashcreate', '创建 Stash');
await sleep(3000);
check('stash entry created', await ev(`(doc) => doc.querySelectorAll('.gbc-stashitem').length >= 1`));
await ev(`(doc) => { Array.from(doc.querySelectorAll('.gbc-stashitem button')).find(b => b.textContent === '丢弃')?.click(); }`);
await sleep(600);
check('drop inline confirm shown', await ev(`(doc) => (doc.querySelector('.gbc-stashitem .gbc-confirm')?.textContent ?? '').includes('确认丢弃')`));
await shot(wb, 'w4-stash-dark');
await clickBtn('.gbc-stashitem .gbc-confirm', '取消');
await sleep(400);
await esc();

// 4) log overlay + commit detail (bug #23 regression: must show real diff)
await ev(`(doc) => { Array.from(${repoRow('repoA')}.querySelectorAll('.gbc-toolbar button')).find(b => b.textContent === '日志')?.click(); }`);
await sleep(2500);
check('log lists entries', await ev(`(doc) => doc.querySelectorAll('.gbc-logitem').length >= 3`));
await shot(wb, 'w5-log-dark');
await ev(`(doc) => { doc.querySelector('.gbc-logitem')?.click(); }`);
await sleep(4000);
const tabLabel = await wb.eval(`Array.from(document.querySelectorAll('.tab .label-name')).map(e => e.textContent).join(' | ')`);
console.log('editor tabs:', tabLabel);
check('commit detail tab opened', /repoA · [0-9a-f]{7}/.test(tabLabel));
await shot(wb, 'w6-commitdiff-dark');
const noChanged = await wb.eval(`!!Array.from(document.querySelectorAll('.monaco-editor, .multi-diff-editor, [class*=empty]')).find(e => (e.textContent || '').includes('No Changed Files'))`);
check('commit detail not "No Changed Files"', !noChanged);
await esc();

// 5) abort-confirm overlay on conflicted repoC
const abortVisible = await ev(`(doc) => {
  const row = ${repoRow('repoC')};
  return !!row && Array.from(row.querySelectorAll('button')).some(b => b.textContent.includes('中止合并'));
}`);
check('repoC shows 中止合并 (conflict state)', abortVisible);
if (abortVisible) {
  await ev(`(doc) => { Array.from(${repoRow('repoC')}.querySelectorAll('button')).find(b => b.textContent.includes('中止合并'))?.click(); }`);
  await sleep(800);
  check('abort confirm overlay shown', await ev(`(doc) => (doc.querySelector('.gbc-confirm')?.textContent ?? '').includes('确认中止')`));
  await shot(wb, 'w7-abort-dark');
  await clickBtn('.gbc-confirm', '取消');
  await sleep(400);
}

// 6) keyboard navigation in the changes tree
await ev(`(doc) => { doc.querySelector('.gbc-filerow')?.focus(); }`);
await sleep(300);
const focused0 = await ev(`(doc) => doc.activeElement?.getAttribute('aria-label') ?? doc.activeElement?.className ?? 'none'`);
await wv.key('ArrowDown', 'ArrowDown', 40);
await sleep(300);
const focused1 = await ev(`(doc) => doc.activeElement?.getAttribute('aria-label') ?? doc.activeElement?.className ?? 'none'`);
check('ArrowDown moves row focus', focused0 !== focused1 && focused1 !== 'none');
console.log('focus:', JSON.stringify(focused0), '->', JSON.stringify(focused1));
await shot(wb, 'w8-keyboard-dark');

// ---- light theme pass ----
await wb.eval(`document.querySelector('.monaco-workbench')?.focus()`);
await wb.chord([{ key: 'k', code: 'KeyK', vk: 75, ctrl: true }, { key: 't', code: 'KeyT', vk: 84, ctrl: true }]);
await sleep(1500);
await wb.eval(`(() => {
  const input = document.querySelector('.quick-input-widget input.input');
  if (!input) return;
  const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  set.call(input, 'Light Modern');
  input.dispatchEvent(new Event('input', { bubbles: true }));
})()`);
await sleep(1200);
await wb.key('Enter', 'Enter', 13);
await sleep(2500);
const themeNow = await wb.eval(`getComputedStyle(document.body).getPropertyValue('--vscode-sideBar-background').trim()`);
console.log('sidebar bg after theme switch:', themeNow);
await shot(wb, 'w9-panel-light');

await ev(`(doc) => { ${repoRow('repoA')}?.querySelector('.gbc-branch')?.click(); }`);
await sleep(1500);
await shot(wb, 'w10-branch-light');
// overlay mutual exclusivity: opening log while branch overlay is open must close the branch overlay
await ev(`(doc) => { Array.from(${repoRow('repoA')}.querySelectorAll('.gbc-toolbar button')).find(b => b.textContent === '日志')?.click(); }`);
await sleep(2000);
check('log open closes branch overlay', !(await ev(`(doc) => !!doc.querySelector('.gbc-branchmgr')`)));
check('log overlay visible', await ev(`(doc) => !!doc.querySelector('.gbc-logoverlay')`));
await esc();
// dark pass stashed repoA changes; apply the stash to restore hunks.txt before the light hunk shot
await ev(`(doc) => { Array.from(${repoRow('repoA')}.querySelectorAll('.gbc-toolbar button')).find(b => b.textContent === 'Stash')?.click(); }`);
await sleep(1500);
await ev(`(doc) => { Array.from(doc.querySelectorAll('.gbc-stashitem button')).find(b => b.textContent === '应用')?.click(); }`);
await sleep(3000);
await esc();
await ev(`(doc) => {
  const row = Array.from(doc.querySelectorAll('.gbc-filerow')).find(r => r.textContent.includes('hunks.txt'));
  const btn = row && Array.from(row.querySelectorAll('button')).find(b => b.textContent.trim() === 'Hunk');
  if (btn) btn.click();
}`);
await sleep(2500);
check('light hunk overlay shows hunks', (await ev(`(doc) => doc.querySelectorAll('.gbc-hunk').length`)) >= 2);
await shot(wb, 'w11-hunk-light');
await esc();
if (abortVisible) {
  await ev(`(doc) => { Array.from(${repoRow('repoC')}.querySelectorAll('button')).find(b => b.textContent.includes('中止合并'))?.click(); }`);
  await sleep(800);
  const contrast = await ev(`(doc) => {
    const btn = Array.from(doc.querySelectorAll('.gbc-btn-danger')).find(b => b.textContent.includes('确认中止'));
    if (!btn) return null;
    const cs = doc.defaultView.getComputedStyle(btn);
    return { color: cs.color, bg: cs.backgroundColor };
  }`);
  console.log('light danger button colors:', JSON.stringify(contrast));
  check('light danger button has contrast', !!contrast && contrast.color !== contrast.bg);
  await shot(wb, 'w12-abort-light');
  await clickBtn('.gbc-confirm', '取消');
}

console.log(failures.length === 0 ? '\nWALKTHROUGH: all checks passed' : `\nWALKTHROUGH FAILURES: ${failures.join('; ')}`);
wb.ws.close();
wv.ws.close();
process.exit(failures.length === 0 ? 0 : 1);