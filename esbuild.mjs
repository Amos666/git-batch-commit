import * as esbuild from 'esbuild';

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

/** @type {import('esbuild').BuildOptions} */
const hostOptions = {
  entryPoints: ['src/extension.ts'],
  bundle: true,
  outfile: 'dist/extension.js',
  platform: 'node',
  format: 'cjs',
  target: 'node18',
  external: ['vscode'],
  sourcemap: !production,
  minify: production,
  logLevel: 'info',
};

/** @type {import('esbuild').BuildOptions} */
const webviewOptions = {
  entryPoints: ['src/webview/main.tsx'],
  bundle: true,
  outfile: 'dist/webview.js',
  platform: 'browser',
  format: 'iife',
  target: 'es2022',
  sourcemap: !production,
  minify: production,
  define: { 'process.env.NODE_ENV': production ? '"production"' : '"development"' },
  logLevel: 'info',
};

if (watch) {
  const contexts = await Promise.all([
    esbuild.context(hostOptions),
    esbuild.context(webviewOptions),
  ]);
  await Promise.all(contexts.map((c) => c.watch()));
  console.log('watching...');
} else {
  await Promise.all([esbuild.build(hostOptions), esbuild.build(webviewOptions)]);
}