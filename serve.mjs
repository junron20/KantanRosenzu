import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const root = process.cwd();
const types = { '.css': 'text/css', '.html': 'text/html', '.js': 'text/javascript', '.svg': 'image/svg+xml' };

createServer(async (request, response) => {
  const pathname = request.url === '/' ? '/index.html' : new URL(request.url, 'http://localhost').pathname;
  const file = normalize(join(root, pathname));
  if (!file.startsWith(root)) return response.writeHead(403).end('Forbidden');
  try {
    response.writeHead(200, { 'content-type': `${types[extname(file)] || 'application/octet-stream'}; charset=utf-8` });
    response.end(await readFile(file));
  } catch { response.writeHead(404).end('Not found'); }
}).listen(4173, '0.0.0.0', () => console.log('Preview: http://localhost:4173'));
