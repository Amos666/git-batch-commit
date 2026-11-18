import { spawnSync } from 'node:child_process';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';
import { downloadAndUnzipVSCode, runTests } from '@vscode/test-electron';
import { setupFixtures, tmp } from './fixtures.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

async function main() {
  const built = spawnSync(process.execPath, [path.join(root, 'esbuild.mjs')], { cwd: root, stdio: 'inherit' });
  if (built.status !== 0) throw new Error('extension build failed');
  const workspace = setupFixtures();
  await esbuild.build({
    entryPoints: [path.join(root, 'test/integration/suite.ts')],
    bundle: true,
    outfile: path.join(root, 'out/integrationTests.js'),
    platform: 'node',
    format: 'cjs',
    target: 'node18',
    external: ['vscode'],
    sourcemap: true,
  });
  console.log('downloading VS Code (stable)...');
  const vscodeExecutablePath = await downloadAndUnzipVSCode('stable');
  console.log('running integration tests...');
  await runTests({
    vscodeExecutablePath,
    extensionDevelopmentPath: root,
    extensionTestsPath: path.join(root, 'out/integrationTests'),
    launchArgs: [
      workspace,
      '--user-data-dir', path.join(tmp, 'userdata'),
      '--skip-welcome',
      '--skip-release-notes',
      '--disable-workspace-trust',
    ],
    extensionTestsEnv: { GBC_FIXTURE_DIR: tmp },
  });
  console.log('integration tests finished');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});