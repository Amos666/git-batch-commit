import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';
import { downloadAndUnzipVSCode, runTests } from '@vscode/test-electron';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const tmp = path.join(root, 'test/integration/.tmp');

function git(cwd, ...args) {
  execFileSync('git', args, { cwd, stdio: 'pipe' });
}

function setupFixtures() {
  fs.rmSync(tmp, { recursive: true, force: true });
  const repoA = path.join(tmp, 'repoA');
  const repoB = path.join(tmp, 'repoB');
  const repoC = path.join(tmp, 'repoC');
  const repoSub = path.join(tmp, 'repoSub');
  const repoW = path.join(tmp, 'repoW');
  const nested = path.join(repoA, 'nested');
  for (const dir of [repoA, repoB, repoC, repoSub]) {
    fs.mkdirSync(dir, { recursive: true });
  }

  for (const repo of [repoA, repoB, repoC, repoSub]) {
    git(repo, 'init', '-b', 'main');
    git(repo, 'config', 'user.email', 'phase0@test.local');
    git(repo, 'config', 'user.name', 'Phase0 Test');
    git(repo, 'config', 'commit.gpgsign', 'false');
  }

  fs.writeFileSync(path.join(repoA, 'modified.txt'), 'line1\n');
  fs.writeFileSync(path.join(repoA, 'keep.txt'), 'keep\n');
  const hunksBase = Array.from({ length: 40 }, (_, i) => `line ${i + 1}`).join('\n') + '\n';
  fs.writeFileSync(path.join(repoA, 'hunks.txt'), hunksBase);
  git(repoA, 'add', '.');
  git(repoA, 'commit', '-m', 'init A');

  // worktree of repoA on branch wt
  git(repoA, 'worktree', 'add', repoW, '-b', 'wt');
  fs.writeFileSync(path.join(repoW, 'modified.txt'), 'line1\nworktree change\n');

  // submodule origin + manual submodule registration in repoA
  // (this machine's git build lacks the `git submodule` script; clone + gitlink is equivalent)
  fs.writeFileSync(path.join(repoSub, 'sub.txt'), 'sub1\n');
  git(repoSub, 'add', '.');
  git(repoSub, 'commit', '-m', 'init sub');
  git(repoA, 'clone', repoSub, 'sub');
  const subHead = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: path.join(repoA, 'sub') }).toString().trim();
  fs.writeFileSync(path.join(repoA, '.gitmodules'), `[submodule "sub"]\n\tpath = sub\n\turl = ${repoSub}\n`);
  git(repoA, 'add', '.gitmodules');
  git(repoA, 'update-index', '--add', '--cacheinfo', `160000,${subHead},sub`);
  git(repoA, 'commit', '-m', 'add submodule');
  fs.writeFileSync(path.join(repoA, 'sub', 'sub.txt'), 'sub1\nsub2\n');

  // nested independent repository inside repoA
  fs.mkdirSync(nested, { recursive: true });
  git(nested, 'init', '-b', 'main');
  git(nested, 'config', 'user.email', 'phase0@test.local');
  git(nested, 'config', 'user.name', 'Phase0 Test');
  fs.writeFileSync(path.join(nested, 'n.txt'), 'n1\n');
  git(nested, 'add', '.');
  git(nested, 'commit', '-m', 'init nested');
  fs.writeFileSync(path.join(nested, 'n.txt'), 'n1\nn2\n');

  // repoA working-tree changes used by staging/commit tests
  fs.writeFileSync(path.join(repoA, 'modified.txt'), 'line1\nline2\n');
  fs.writeFileSync(path.join(repoA, '中文 文件.txt'), '你好\n');
  fs.writeFileSync(path.join(repoA, 'untracked.txt'), 'temp\n');
  fs.writeFileSync(path.join(repoA, 'binary.bin'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01, 0x02, 0x03]));
  fs.writeFileSync(path.join(repoA, 'big.txt'), 'a'.repeat(3 * 1024 * 1024));
  fs.writeFileSync(
    path.join(repoA, 'hunks.txt'),
    hunksBase
      .replace('line 3', 'line 3 changed\nline 3.5 inserted')
      .replace('line 20', 'line 20 changed')
      .replace('line 39', 'line 39 changed'),
  );

  fs.writeFileSync(path.join(repoB, 'b.txt'), 'b1\n');
  git(repoB, 'add', '.');
  git(repoB, 'commit', '-m', 'init B');
  fs.writeFileSync(path.join(repoB, 'b.txt'), 'b1\nb2\n');
  const hooksDir = path.join(repoB, '.git/hooks');
  fs.mkdirSync(hooksDir, { recursive: true });
  const hook = path.join(hooksDir, 'pre-commit');
  fs.writeFileSync(hook, '#!/bin/sh\necho "phase0 intentional hook failure" >&2\nexit 1\n');
  fs.chmodSync(hook, 0o755);

  // repoC: slow but successful hook, for cancel-remaining timing tests
  fs.writeFileSync(path.join(repoC, 'c.txt'), 'c1\n');
  git(repoC, 'add', '.');
  git(repoC, 'commit', '-m', 'init C');
  fs.writeFileSync(path.join(repoC, 'c.txt'), 'c1\nc2\n');
  const hooksDirC = path.join(repoC, '.git/hooks');
  fs.mkdirSync(hooksDirC, { recursive: true });
  const hookC = path.join(hooksDirC, 'pre-commit');
  fs.writeFileSync(hookC, '#!/bin/sh\nsleep 2\nexit 0\n');
  fs.chmodSync(hookC, 0o755);

  const workspace = path.join(tmp, 'phase0.code-workspace');
  fs.writeFileSync(
    workspace,
    JSON.stringify({ folders: [{ path: 'repoA' }, { path: 'repoB' }, { path: 'repoC' }, { path: 'repoW' }] }, null, 2),
  );

  // ensure nested/submodule repositories are discovered by the built-in scanner
  const userDir = path.join(tmp, 'userdata', 'User');
  fs.mkdirSync(userDir, { recursive: true });
  fs.writeFileSync(
    path.join(userDir, 'settings.json'),
    JSON.stringify({ 'git.repositoryScanMaxDepth': 3, 'git.autoRepositoryDetection': true }, null, 2),
  );
  return workspace;
}

async function main() {
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