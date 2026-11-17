// Perf calibration fixtures (#25): 1k/10k/50k tracked-modified repos + 350-commit log repo
import * as fs from 'node:fs';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';

const ROOT = path.resolve('test/perf/.tmp');
const git = (cwd, ...args) =>
  execFileSync('git', ['-c', 'user.email=perf@test', '-c', 'user.name=Perf', ...args], { cwd, stdio: 'pipe', maxBuffer: 64 * 1024 * 1024 });

function makeRepo(name, rootFiles, batchDirs) {
  const dir = path.join(ROOT, name);
  fs.mkdirSync(dir, { recursive: true });
  git(dir, 'init', '-b', 'main');
  const files = [];
  for (let i = 0; i < rootFiles; i++) files.push(`f${String(i).padStart(5, 'd')}.txt`);
  for (const [d, n] of batchDirs) {
    fs.mkdirSync(path.join(dir, d), { recursive: true });
    for (let i = 0; i < n; i++) files.push(`${d}/b${String(i).padStart(3, 'd')}.txt`);
  }
  for (const f of files) fs.writeFileSync(path.join(dir, f), 'line1\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-m', 'init');
  for (const f of files) fs.appendFileSync(path.join(dir, f), 'changed\n');
  console.log(`${name}: ${files.length} modified files`);
  return dir;
}

fs.rmSync(ROOT, { recursive: true, force: true });
fs.mkdirSync(ROOT, { recursive: true });

const repo10k = makeRepo('repo10k', 9900, [['batch100', 100]]);
const repo50k = makeRepo('repo50k', 50000, []);
const repoLog = path.join(ROOT, 'repoLog');
fs.mkdirSync(repoLog, { recursive: true });
git(repoLog, 'init', '-b', 'main');
for (let i = 0; i < 350; i++) git(repoLog, 'commit', '--allow-empty', '-m', `log ${i}`);
console.log('repoLog: 350 commits');

const settings = {
  'git.statusLimit': 100000,
  'git.autofetch': false,
  'gitBatchCommit.commit.defaultSelectAll': false,
  'gitBatchCommit.log.pageSize': 300,
  'workbench.startupEditor': 'none',
};
const ws = (name, folders) => {
  fs.writeFileSync(
    path.join(ROOT, name),
    JSON.stringify({ folders: folders.map((f) => ({ path: f })), settings }, null, 2),
  );
};
ws('perf10k.code-workspace', [repo10k, repoLog]);
ws('perf50k.code-workspace', [repo50k]);
console.log('fixtures ready at', ROOT);