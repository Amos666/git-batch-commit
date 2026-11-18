import * as http from 'node:http';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'dev');
const port = Number(process.env.PORT ?? 5173);
const types = { '.html': 'text/html', '.js': 'text/javascript', '.map': 'application/json', '.css': 'text/css' };

http
  .createServer((req, res) => {
    const urlPath = decodeURIComponent((req.url ?? '/').split('?')[0]);
    const file = path.join(root, urlPath === '/' ? 'index.html' : urlPath);
    if (!file.startsWith(root) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      res.writeHead(404);
      res.end('not found');
      return;
    }
    res.writeHead(200, { 'content-type': types[path.extname(file)] ?? 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  })
  .listen(port, () => {
    console.log(`dev harness: http://localhost:${port}/ (run "npm run build" first)`);
  });