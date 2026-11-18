// Launch the perf fixture workspace in the downloaded VS Code with CDP + ext-host
// inspector enabled, run perf-run.mjs against it, then shut down.
// Usage: xvfb-run -a node test/perf/launch-perf.mjs <10k|50k>
// (fixtures must exist: node test/perf/make-fixtures.mjs)
import { spawn, spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const LABEL = process.argv[2] === '50k' ? '50k' : '10k';
const SCRIPT = process.argv[3] || 'perf-run.mjs';
const PORT = Number(process.env.GBC_CDP_PORT || 9223);
const EXT_PORT = 9229;
const perfRoot = path.join(root, 'test/perf/.tmp');
const workspace = path.join(perfRoot, `perf${LABEL}.code-workspace`);
if (!fs.existsSync(workspace)) {
  console.error('missing perf fixtures; run: node test/perf/make-fixtures.mjs');
  process.exit(2);
}
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
const userData = path.join(perfRoot, `userdata-${LABEL}`);
fs.rmSync(userData, { recursive: true, force: true });
const code = spawn(findCode(), [
  `--remote-debugging-port=${PORT}`,
  `--inspect-extensions=${EXT_PORT}`,
  `--extensionDevelopmentPath=${root}`,
  '--user-data-dir', userData,
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
  const start = Date.now();
  for (;;) {
    const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
    if (list.some((t) => t.type === 'page' && t.url.startsWith('vscode-file://'))) break;
    if (Date.now() - start > 60000) throw new Error('workbench target never appeared');
    await sleep(500);
  }
  await sleep(1500); // let the workbench DOM settle; perf-run measures cold first screen from here
  child = spawn(process.execPath, [path.join(root, 'test/perf', SCRIPT), LABEL], {
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