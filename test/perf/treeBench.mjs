// Pure tree-pipeline benchmark (no VS Code needed): node test/perf/treeBench.mjs
import * as esbuild from 'esbuild';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const outfile = path.join(root, 'out/treeBench.bundle.mjs');
await esbuild.build({
  entryPoints: [path.join(root, 'src/webview/tree.ts')],
  bundle: true, outfile, platform: 'node', format: 'esm', target: 'node18',
});
const { buildTree, flattenTree } = await import(outfile);
const changes = [];
for (let i = 0; i < 50000; i++) {
  const dir = `src/mod${i % 200}/sub${i % 20}`;
  changes.push({
    repoId: 'r1', path: `${dir}/file${i}.ts`, uri: `file:///r/${dir}/file${i}.ts`,
    indexStatus: i % 3 === 0 ? 'M' : null, worktreeStatus: i % 3 === 0 ? null : 'M',
    kind: 'modified', staged: i % 3 === 0, conflicted: false,
  });
}
let t = performance.now();
const tree = buildTree(changes);
const buildMs = performance.now() - t;
t = performance.now();
const rows = flattenTree(tree, {}, 'r1:staged');
const flatMs = performance.now() - t;
t = performance.now();
for (let i = 0; i < 60; i++) flattenTree(tree, { 'r1:staged:src/mod5': true }, 'r1:staged');
const perRebuildMs = (performance.now() - t) / 60;
console.log(JSON.stringify({ files: changes.length, buildMs: +buildMs.toFixed(1), flattenMs: +flatMs.toFixed(1), rows: rows.length, perRebuildMs: +perRebuildMs.toFixed(2) }));
