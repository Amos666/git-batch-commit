// Shared CDP helpers for the manual-run scripts (VS Code workbench + webview frames).
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

export const PORT = Number(process.env.GBC_CDP_PORT || 9223);
export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const failures = [];
export function check(name, cond) {
  console.log(`${cond ? 'OK  ' : 'FAIL'} ${name}`);
  if (!cond) failures.push(name);
}
export function finish(label) {
  console.log(failures.length === 0 ? `\n${label}: all checks passed` : `\n${label} FAILURES: ${failures.join('; ')}`);
  process.exit(failures.length === 0 ? 0 : 1);
}

export async function targets(port = PORT) {
  return await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
}

export function connect(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.addEventListener('open', () => resolve(ws));
    ws.addEventListener('error', reject);
  });
}

export class Cdp {
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
    if (res.exceptionDetails) throw new Error('eval: ' + JSON.stringify(res.exceptionDetails).slice(0, 300));
    return res.result.value;
  }
  async key(key, code, keyCode, modifiers = 0) {
    for (const type of ['rawKeyDown', 'keyUp']) {
      await this.send('Input.dispatchKeyEvent', { type, key, code, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode, modifiers });
    }
  }
  async chord(keys) {
    let modifiers = 0;
    for (const k of keys) {
      if (k.ctrl) modifiers |= 2;
      if (k.alt) modifiers |= 1;
      if (k.shift) modifiers |= 8;
      await this.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: k.key, code: k.code, windowsVirtualKeyCode: k.vk, nativeVirtualKeyCode: k.vk, modifiers });
    }
    for (const k of [...keys].reverse()) {
      if (k.ctrl) modifiers &= ~2;
      if (k.alt) modifiers &= ~1;
      if (k.shift) modifiers &= ~8;
      await this.send('Input.dispatchKeyEvent', { type: 'keyUp', key: k.key, code: k.code, windowsVirtualKeyCode: k.vk, nativeVirtualKeyCode: k.vk, modifiers });
    }
  }
}

export async function shot(cdp, name) {
  const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(root, 'test/manual-run', `${name}.png`), Buffer.from(data, 'base64'));
  console.log('shot ->', name + '.png');
}

export async function workbench() {
  const list = await targets();
  const wb = list.find((t) => t.type === 'page' && t.url.startsWith('vscode-file://'));
  if (!wb) throw new Error('no workbench target; is VS Code running with --remote-debugging-port?');
  return new Cdp(await connect(wb.webSocketDebuggerUrl));
}

/** Open the Git Batch Commit container and expand the named view pane. */
export async function openView(wb, viewName) {
  const opened = await wb.eval(`!!Array.from(document.querySelectorAll('.pane-header .title')).find(t => (t.textContent || '').trim() === ${JSON.stringify(viewName)})`);
  if (!opened) {
    await wb.eval(`(() => {
      const btn = Array.from(document.querySelectorAll('.activitybar .action-item a'))
        .find(a => (a.getAttribute('aria-label') || '').includes('Git Batch Commit'));
      if (btn) btn.click();
    })()`);
    await sleep(4000);
  }
  await wb.eval(`(() => {
    const header = Array.from(document.querySelectorAll('.pane-header')).find(h => (h.querySelector('.title')?.textContent || '').trim() === ${JSON.stringify(viewName)});
    if (header && header.getAttribute('aria-expanded') === 'false') header.click();
  })()`);
  await sleep(2500);
}

const inDoc = (body) => `(() => { const doc = document.querySelector('iframe')?.contentDocument; if (!doc || !doc.body) return null; return ((${body})(doc)); })()`;

/**
 * Connect to the webview whose inner app root carries the given testid
 * (commit-panel or log-panel). Both views share one bundle.
 */
export async function panel(testId) {
  for (const t of await targets()) {
    if (t.type !== 'iframe' || !t.url.startsWith('vscode-webview://')) continue;
    const cdp = new Cdp(await connect(t.webSocketDebuggerUrl));
    const found = await cdp.eval(inDoc(`(doc) => !!doc.querySelector('[data-testid="${testId}"]')`));
    if (found) {
      const ev = (body) => cdp.eval(inDoc(body));
      return { cdp, ev };
    }
    cdp.ws.close();
  }
  throw new Error(`no webview with [data-testid=${testId}]`);
}

export const setInput = (ev, sel, value) => ev(`(doc) => {
  const input = doc.querySelector('${sel}');
  if (!input) return false;
  const proto = input.tagName === 'TEXTAREA' ? doc.defaultView.HTMLTextAreaElement.prototype : doc.defaultView.HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(input, ${JSON.stringify(value)});
  input.dispatchEvent(new doc.defaultView.Event('input', { bubbles: true }));
  return true;
}`);

export const clickTestId = (ev, testId) => ev(`(doc) => {
  const el = doc.querySelector('[data-testid="${testId}"]');
  if (!el) return false;
  el.click();
  return true;
}`);

/** Checkboxes disable during host round-trips; wait until enabled, then click. */
export async function clickCheck(ev, testId, ms = 15000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const ok = await ev(`(doc) => {
      const el = doc.querySelector('[data-testid="${testId}"]');
      if (!el || el.disabled) return false;
      el.click();
      return true;
    }`);
    if (ok) return true;
    await sleep(200);
  }
  return false;
}

/** Pick a <select> option by its visible label (repo ids are hashes, labels are names). */
export const selectOption = (ev, sel, label) => ev(`(doc) => {
  const select = doc.querySelector('${sel}');
  if (!select) return false;
  const opt = Array.from(select.options).find(o => (o.textContent || '').trim() === ${JSON.stringify(label)});
  if (!opt) return false;
  Object.getOwnPropertyDescriptor(doc.defaultView.HTMLSelectElement.prototype, 'value').set.call(select, opt.value);
  select.dispatchEvent(new doc.defaultView.Event('change', { bubbles: true }));
  return true;
}`);

/** The commit tree is virtualized: scroll its container until sel renders (or bottom reached). */
export async function scrollTreeTo(ev, sel, ms = 15000) {
  const end = Date.now() + ms;
  await ev(`(doc) => { const t = doc.querySelector('[data-testid="change-tree"]'); if (t) t.scrollTop = 0; return true; }`);
  await sleep(250);
  while (Date.now() < end) {
    const r = await ev(`(doc) => {
      const t = doc.querySelector('[data-testid="change-tree"]');
      if (!t) return { found: false, done: true };
      if (t.querySelector('${sel}')) return { found: true, done: true };
      const max = t.scrollHeight - t.clientHeight;
      if (t.scrollTop >= max) return { found: false, done: true };
      t.scrollTop = Math.min(max, t.scrollTop + Math.max(100, t.clientHeight - 52));
      return { found: false, done: false };
    }`);
    if (r?.found) return true;
    if (r?.done) return false;
    await sleep(250);
  }
  return false;
}

export const textOf = (ev, sel) => ev(`(doc) => doc.querySelector('${sel}')?.innerText ?? null`);

export const escape = async (cdp) => { await cdp.key('Escape', 'Escape', 27); await sleep(500); };

/** Right-click a row to open its context menu; returns menu item labels. */
export const contextMenuLabels = (ev, rowSel) => ev(`(doc) => {
  const row = doc.querySelector('${rowSel}');
  if (!row) return null;
  const r = row.getBoundingClientRect();
  row.dispatchEvent(new doc.defaultView.MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.x + 20, clientY: r.y + 5 }));
  return true;
}`);