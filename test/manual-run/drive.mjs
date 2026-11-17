// CDP driver for headless VS Code trial: drive the panel via its webview frame
import * as fs from 'node:fs';

const PORT = 9223;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
  }
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
    if (res.exceptionDetails) {
      throw new Error('eval: ' + JSON.stringify(res.exceptionDetails).slice(0, 250));
    }
    return res.result.value;
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
console.log('title:', await wb.eval('document.title'));

// ensure the Git Batch Commit view is open
const already = await wb.eval(`!!Array.from(document.querySelectorAll('.title')).find(t => (t.textContent || '').includes('Git Batch Commit: Commit'))`);
if (!already) {
  console.log(await wb.eval(`(() => {
    const btn = Array.from(document.querySelectorAll('.activitybar .action-item a'))
      .find(a => (a.getAttribute('aria-label') || '').includes('Git Batch Commit'));
    if (!btn) return 'NO ICON';
    btn.click();
    return 'view opened';
  })()`));
  await sleep(5000);
}

const wt = (await targets()).find((t) => t.type === 'iframe' && t.url.startsWith('vscode-webview://'));
if (!wt) throw new Error('no vscode-webview target');
const wv = new Cdp(await connect(wt.webSocketDebuggerUrl));
// panel app lives in the same-origin inner iframe of the webview host frame
const inDoc = (body) => `(() => { const doc = document.querySelector('iframe').contentDocument; if (!doc || !doc.body) return 'NO INNER DOC'; return ((${body})(doc)); })()`;
const text = await wv.eval(inDoc('(doc) => doc.body.innerText.slice(0, 260)'));
console.log('panel text head:', JSON.stringify(text));
await shot(wb, 'shot1-panel');

// 1) toggle the first file checkbox (unstage n.txt / repoA first row)
console.log(await wv.eval(inDoc(`(doc) => {
  const cb = doc.querySelector('.gbc-filerow input[type=checkbox]');
  if (!cb) return 'no checkbox';
  cb.click();
  return 'checkbox clicked: ' + cb.closest('.gbc-filerow').querySelector('.gbc-path').textContent;
}`)));
await sleep(2500);

// 2) branch management overlay on repoA
console.log(await wv.eval(inDoc(`(doc) => {
  const row = Array.from(doc.querySelectorAll('.gbc-reporow')).find(r => r.textContent.includes('repoA'));
  if (!row) return 'no repoA row';
  row.querySelector('.gbc-branch').click();
  return 'branch chip clicked';
}`)));
await sleep(2500);
await shot(wb, 'shot2-branch');
console.log('branch overlay:', JSON.stringify(await wv.eval(inDoc(`(doc) => doc.querySelector('.gbc-branchmgr')?.innerText.slice(0, 300) ?? 'missing'`))));

// 2b) create a branch through the overlay
console.log(await wv.eval(inDoc(`(doc) => {
  const input = doc.querySelector('.gbc-branchcreate input');
  if (!input) return 'no create input';
  const set = Object.getOwnPropertyDescriptor(doc.defaultView.HTMLInputElement.prototype, 'value').set;
  set.call(input, 'trial-branch');
  input.dispatchEvent(new doc.defaultView.Event('input', { bubbles: true }));
  return 'typed trial-branch';
}`)));
await sleep(400);
console.log(await wv.eval(inDoc(`(doc) => {
  const btn = Array.from(doc.querySelectorAll('.gbc-branchcreate button')).find(b => b.textContent.includes('创建并切换'));
  if (!btn || btn.disabled) return 'create button disabled';
  btn.click();
  return 'create clicked';
}`)));
await sleep(3500);
console.log('after create:', JSON.stringify(await wv.eval(inDoc(`(doc) => {
  const row = Array.from(doc.querySelectorAll('.gbc-reporow')).find(r => r.textContent.includes('repoA'));
  return row?.querySelector('.gbc-branch')?.textContent ?? 'no chip';
}`))));
await shot(wb, 'shot3-branchcreated');

// 3) stash panel on repoA
console.log(await wv.eval(inDoc(`(doc) => {
  const row = Array.from(doc.querySelectorAll('.gbc-reporow')).find(r => r.textContent.includes('repoA'));
  Array.from(row.querySelectorAll('.gbc-toolbar button')).find(b => b.textContent === 'Stash')?.click();
  return 'stash clicked';
}`)));
await sleep(2500);
await shot(wb, 'shot4-stash');
console.log('stash overlay:', JSON.stringify(await wv.eval(inDoc(`(doc) => doc.querySelector('.gbc-stashoverlay')?.innerText.slice(0, 200) ?? 'missing'`))));

// 4) commit log with grep filter on repoA
console.log(await wv.eval(inDoc(`(doc) => {
  const row = Array.from(doc.querySelectorAll('.gbc-reporow')).find(r => r.textContent.includes('repoA'));
  Array.from(row.querySelectorAll('.gbc-toolbar button')).find(b => b.textContent === '日志')?.click();
  return 'log clicked';
}`)));
await sleep(3000);
console.log('log overlay:', JSON.stringify(await wv.eval(inDoc(`(doc) => doc.querySelector('.gbc-loglist')?.innerText.slice(0, 260) ?? 'missing'`))));
console.log(await wv.eval(inDoc(`(doc) => {
  const inputs = doc.querySelectorAll('.gbc-loginput');
  if (!inputs[1]) return 'no grep input';
  const set = Object.getOwnPropertyDescriptor(doc.defaultView.HTMLInputElement.prototype, 'value').set;
  set.call(inputs[1], 'signoff');
  inputs[1].dispatchEvent(new doc.defaultView.Event('input', { bubbles: true }));
  return 'typed filter';
}`)));
await sleep(400);
await wv.eval(inDoc(`(doc) => { Array.from(doc.querySelectorAll('.gbc-logfilters button')).pop().click(); }`));
await sleep(2500);
await shot(wb, 'shot5-log');
console.log('filtered log:', JSON.stringify(await wv.eval(inDoc(`(doc) => doc.querySelector('.gbc-loglist')?.innerText.slice(0, 260) ?? 'missing'`))));

// 5) click first log entry -> commit multi-diff in editor
await wv.eval(inDoc(`(doc) => { doc.querySelector('.gbc-logitem')?.click(); }`));
await sleep(5000);
await shot(wb, 'shot6-commitdiff');

wb.ws.close();
wv.ws.close();
