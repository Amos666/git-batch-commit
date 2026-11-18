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

/** @type {import('esbuild').BuildOptions} */
const diffviewOptions = {
  entryPoints: ['src/diffview/main.tsx'],
  bundle: true,
  outfile: 'dist/diffview.js',
  platform: 'browser',
  format: 'iife',
  target: 'es2022',
  sourcemap: !production,
  minify: production,
  define: { 'process.env.NODE_ENV': production ? '"production"' : '"development"' },
  logLevel: 'info',
};

/** @type {import('esbuild').BuildOptions} */
const devOptions = {
  entryPoints: ['src/webview/dev/devMain.tsx', 'src/webview/dev/index.html', 'src/webview/dev/log.html'],
  bundle: true,
  outdir: 'dist/dev',
  platform: 'browser',
  format: 'iife',
  target: 'es2022',
  sourcemap: true,
  loader: { '.html': 'copy' },
  define: { 'process.env.NODE_ENV': '"development"' },
  logLevel: 'info',
};

const builds = production ? [hostOptions, webviewOptions, diffviewOptions] : [hostOptions, webviewOptions, diffviewOptions, devOptions];

if (watch) {
  const contexts = await Promise.all(builds.map((options) => esbuild.context(options)));
  await Promise.all(contexts.map((c) => c.watch()));
  console.log('watching...');
} else {
  await Promise.all(builds.map((options) => esbuild.build(options)));
}