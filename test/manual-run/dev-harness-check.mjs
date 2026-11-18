// Phase 2 exit check: dev harness renders the IDEA-style panel standalone (memory transport, no VS Code).
// Usage: node test/manual-run/dev-harness-check.mjs [path-to-chrome-headless-shell]
import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PORT = 5199;
const CDP_PORT = 9224;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const failures = [];
const check = (name, cond) => {
  console.log(`${cond ? 'OK  ' : 'FAIL'} ${name}`);
  if (!cond) failures.push(name);
};

function findShell() {
  const arg = process.argv[2];
  if (arg) return arg;
  if (process.env.GBC_HEADLESS_SHELL) return process.env.GBC_HEADLESS_SHELL;
  const base = '/work/.browsers/chrome-headless-shell';
  if (fs.existsSync(base)) {
    for (const dir of fs.readdirSync(base)) {
      const candidate = path.join(base, dir, 'chrome-headless-shell-linux64', 'chrome-headless-shell');
      if (fs.existsSync(candidate)) return candidate;
    }
  }
  throw new Error('chrome-headless-shell not found; pass its path as argv[2]');
}

async function waitForHttp(url, timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {}
    await sleep(200);
  }
  throw new Error(`timeout waiting for ${url}`);
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
    if (res.exceptionDetails) throw new Error('eval: ' + JSON.stringify(res.exceptionDetails).slice(0, 300));
    return res.result.value;
  }
  async waitFor(expression, timeoutMs = 15000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (await this.eval(expression)) return true;
      await sleep(200);
    }
    return false;
  }
  async screenshot(file) {
    const shot = await this.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(root, file), Buffer.from(shot.data, 'base64'));
    console.log(`screenshot: ${file}`);
  }
}

async function openTab(url) {
  const target = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/new?${url}`, { method: 'PUT' })).json();
  const cdp = new Cdp(await connect(target.webSocketDebuggerUrl));
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  return cdp;
}

const server = spawn(process.execPath, [path.join(root, 'scripts/serve-dev.mjs')], {
  env: { ...process.env, PORT: String(PORT) },
  stdio: 'ignore',
});
const shell = spawn(findShell(), [
  '--headless',
  '--no-sandbox',
  '--disable-gpu',
  `--remote-debugging-port=${CDP_PORT}`,
  '--window-size=480,900',
  'about:blank',
], { stdio: 'ignore' });

try {
  await waitForHttp(`http://127.0.0.1:${PORT}/`);
  await waitForHttp(`http://127.0.0.1:${CDP_PORT}/json/version`);

  // --- Commit view harness ---
  const cdp = await openTab(`http://127.0.0.1:${PORT}/`);
  check('commit panel renders standalone (memory transport)', await cdp.waitFor(`!!document.querySelector('[data-testid="commit-panel"]')`));

  const repoNames = await cdp.eval(`Array.from(document.querySelectorAll('[data-testid="repo-row"]')).map(r => r.textContent)`);
  check('demo repos alpha/beta visible', repoNames.some(t => t.includes('alpha')) && repoNames.some(t => t.includes('beta')));
  check('default changelist header present', await cdp.eval(`!!document.querySelector('[data-testid="changelist-default"]')`));
  check('unversioned group present', await cdp.eval(`!!document.querySelector('[data-testid="group-unversioned"]')`));
  check('file rows rendered', (await cdp.eval(`document.querySelectorAll('[data-testid="file-row"]').length`)) >= 3);
  check('commit message box present', await cdp.eval(`!!document.querySelector('[data-testid="commit-message"]')`));
  check('no error banner on load', await cdp.eval(`!document.querySelector('[data-testid="banner-error"]')`));

  // interaction: uncheck a tracked file checkbox → inclusion.set → changelists.changed reconciliation
  const rowSel = `[data-testid="file-row"][data-path="src/app.ts"][data-repo="alpha"]`;
  check('src/app.ts initially included', await cdp.eval(`document.querySelector('${rowSel}')?.dataset.included === 'true'`));
  await cdp.eval(`document.querySelector('${rowSel} [data-testid="file-check"]').click()`);
  const unchecked = await cdp.waitFor(`document.querySelector('${rowSel}')?.dataset.included === 'false'`);
  check('uncheck reaches mock host (data-included=false)', unchecked);
  await cdp.eval(`document.querySelector('${rowSel} [data-testid="file-check"]').click()`);
  check('re-check restores inclusion', await cdp.waitFor(`document.querySelector('${rowSel}')?.dataset.included === 'true'`));

  // mode switch dialog opens and closes
  await cdp.eval(`document.querySelector('[data-testid="mode-toggle"]').click()`);
  check('mode switch dialog opens', await cdp.waitFor(`!!document.querySelector('[data-testid="dialog-modeswitch"]')`));
  await cdp.eval(`document.querySelector('[data-testid="dialog-close"]').click()`);
  check('mode switch dialog closes', await cdp.waitFor(`!document.querySelector('[data-testid="dialog-modeswitch"]')`));

  await cdp.screenshot('test/manual-run/dev-harness.png');
  cdp.ws.close();

  // --- Log view harness ---
  const log = await openTab(`http://127.0.0.1:${PORT}/log.html`);
  check('log panel renders standalone', await log.waitFor(`!!document.querySelector('[data-testid="log-panel"]')`));
  check('log entries from fixtures', await log.waitFor(`document.querySelectorAll('[data-testid="log-entry"]').length >= 1`));
  check('undo commit action on HEAD', await log.eval(`!!document.querySelector('[data-testid="log-undo"]')`));
  check('no error banner in log view', await log.eval(`!document.querySelector('[data-testid="banner-error"], [data-testid="log-error"]')`));
  await log.screenshot('test/manual-run/dev-harness-log.png');
  log.ws.close();
} finally {
  shell.kill();
  server.kill();
}

if (failures.length) {
  console.error(`${failures.length} checks failed`);
  process.exit(1);
}
console.log('dev harness checks passed');