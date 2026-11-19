// Local dev server: serves the app and runs /api/* the way Vercel does.
//   npm run dev                      -> real ESPN, in-memory data (saved to .data/)
//   MOCK_ESPN=r3 npm run dev         -> fake tournament in round 3 (pre | r1 | r2 | r3 | final)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT || 3000);
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json', '.webmanifest': 'application/manifest+json' };

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  if (url.pathname.startsWith('/api/')) {
    const file = path.join(root, 'api', `${url.pathname.slice(5).replace(/[^a-z-]/gi, '')}.js`);
    if (!fs.existsSync(file)) { res.statusCode = 404; return res.end('{"error":"not found"}'); }
    req.query = Object.fromEntries(url.searchParams);
    const mod = await import(pathToFileURL(file).href);
    return mod.default(req, res);
  }
  let p = path.join(root, decodeURIComponent(url.pathname));
  if (!p.startsWith(root)) { res.statusCode = 403; return res.end(); }
  if (fs.existsSync(p) && fs.statSync(p).isDirectory()) p = path.join(p, 'index.html');
  if (!fs.existsSync(p)) p = path.join(root, 'index.html');
  res.setHeader('Content-Type', TYPES[path.extname(p)] || 'application/octet-stream');
  res.setHeader('Cache-Control', 'no-store');
  fs.createReadStream(p).pipe(res);
}).listen(PORT, () => console.log(`Golf Degens dev server on http://localhost:${PORT}${process.env.MOCK_ESPN ? ` (mock ESPN: ${process.env.MOCK_ESPN})` : ''}`));
