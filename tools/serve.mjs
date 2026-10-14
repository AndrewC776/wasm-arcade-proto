// Minimal static server for dist/ (correct wasm MIME, no directory listing).
// usage: node tools/serve.mjs [port]
import { createServer } from 'node:http';
import { createReadStream, statSync } from 'node:fs';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('../dist', import.meta.url)));
const PORT = Number(process.argv[2] ?? process.env.PORT ?? 8765);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.txt': 'text/plain; charset=utf-8',
};

function resolvePath(urlPath) {
  const decoded = decodeURIComponent(urlPath.split('?')[0]);
  const target = resolve(join(ROOT, normalize(decoded)));
  if (target !== ROOT && !target.startsWith(ROOT + sep)) return null;
  try {
    const st = statSync(target);
    if (st.isDirectory()) {
      const index = join(target, 'index.html');
      return statSync(index).isFile() ? index : null;
    }
    return st.isFile() ? target : null;
  } catch {
    return null;
  }
}

function handle(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405).end();
    return;
  }
  let file;
  try {
    file = resolvePath(req.url);
  } catch {
    file = null;
  }
  if (!file) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('not found');
    return;
  }
  res.writeHead(200, {
    'Content-Type': MIME[extname(file)] ?? 'application/octet-stream',
    'Content-Length': statSync(file).size,
    'Cache-Control': 'no-cache',
  });
  if (req.method === 'HEAD') res.end();
  else createReadStream(file).pipe(res);
}

// Loopback only, on both stacks: browsers may resolve "localhost" to ::1 first.
for (const host of ['127.0.0.1', '::1']) {
  createServer(handle)
    .on('error', (err) => console.error(`listen ${host}:${PORT} failed: ${err.message}`))
    .listen(PORT, host, () => console.log(`serving ${ROOT} at http://${host.includes(':') ? `[${host}]` : host}:${PORT}/`));
}
