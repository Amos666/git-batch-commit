// Launch the fixture workspace in the downloaded VS Code with CDP enabled,
// run one manual-run script against it, then shut down.
// Usage: xvfb-run -a node test/manual-run/launch.mjs <script.mjs>
import { spawn, spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setupFixtures, tmp } from '../integration/fixtures.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const script = process.argv[2];
if (!script) {
  console.error('usage: node test/manual-run/launch.mjs <script.mjs>');
  process.exit(2);
}
const PORT = Number(process.env.GBC_CDP_PORT || 9223);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function findCode() {
  const base = path.join(root, '.vscode-test');
  for (const dir of fs.readdirSync(base)) {
    const candidate = path.join(base, dir, 'code');
    if (dir.startsWith('vscode-') && fs.existsSync(candidate)) return candidate;
  }
  throw new Error('no VS Code under .vscode-test; run npm run test:integration first');
}

async function waitForHttp(url, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {}
    await sleep(300);
  }
  throw new Error(`timeout waiting for ${url}`);
}

const built = spawnSync(process.execPath, [path.join(root, 'esbuild.mjs')], { cwd: root, stdio: 'inherit' });
if (built.status !== 0) {
  console.error('extension build failed');
  process.exit(1);
}
const workspace = process.env.GBC_SKIP_FIXTURES ? path.join(tmp, 'phase0.code-workspace') : setupFixtures();
const code = spawn(findCode(), [
  `--remote-debugging-port=${PORT}`,
  `--extensionDevelopmentPath=${root}`,
  '--user-data-dir', path.join(tmp, 'userdata'),
  '--skip-welcome',
  '--skip-release-notes',
  '--disable-workspace-trust',
  '--no-sandbox',
  '--disable-gpu',
  '--disable-dev-shm-usage',
  workspace,
], { stdio: 'ignore', detached: true });

let child;
try {
  await waitForHttp(`http://127.0.0.1:${PORT}/json/version`, 60000);
  // wait for the workbench window and the extension's activity bar icon
  const start = Date.now();
  for (;;) {
    const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
    if (list.some((t) => t.type === 'page' && t.url.startsWith('vscode-file://'))) break;
    if (Date.now() - start > 60000) throw new Error('workbench target never appeared');
    await sleep(500);
  }
  await sleep(8000); // extension activation + git repository scan
  child = spawn(process.execPath, [path.join(root, 'test/manual-run', script)], {
    stdio: 'inherit',
    env: { ...process.env, GBC_CDP_PORT: String(PORT) },
  });
  const exitCode = await new Promise((resolve) => child.on('close', resolve));
  process.exitCode = exitCode ?? 1;
} catch (err) {
  console.error(err);
  process.exitCode = 1;
} finally {
  try { process.kill(-code.pid, 'SIGTERM'); } catch {}
  await sleep(1500);
  try { process.kill(-code.pid, 'SIGKILL'); } catch {}
}