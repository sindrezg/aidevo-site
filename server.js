const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 8050;

const MIME = {
  '.html': 'text/html; charset=UTF-8',
  '.css': 'text/css; charset=UTF-8',
  '.js': 'application/javascript; charset=UTF-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.pdf': 'application/pdf',
  '.mp4': 'video/mp4',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.txt': 'text/plain; charset=UTF-8',
  '.xml': 'application/xml; charset=UTF-8',
};

function serveFile(filePath, res, cache) {
  try {
    const stat = fs.statSync(filePath);
    const ext = path.extname(filePath);
    const mime = MIME[ext] || 'application/octet-stream';
    const headers = {
      'Content-Type': mime,
      'Content-Length': stat.size,
      'Cache-Control': cache || 'public, max-age=300',
      'X-Content-Type-Options': 'nosniff',
    };
    if (ext === '.mp4') {
      headers['Accept-Ranges'] = 'bytes';
    }
    res.writeHead(200, headers);
    fs.createReadStream(filePath).pipe(res);
    return true;
  } catch (_) {
    return false;
  }
}

const server = http.createServer((req, res) => {
  const url = req.url.split('?')[0];

  if (url === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end('{"status":"ok"}');
    return;
  }

  // Try exact file
  let filePath = path.join(__dirname, url);
  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    const isAsset = url.startsWith('/_next/') || url.startsWith('/images/') || url.startsWith('/downloads/');
    serveFile(filePath, res, isAsset ? 'public, max-age=31536000, immutable' : 'public, max-age=300');
    return;
  }

  // Try index.html in directory
  const indexPath = path.join(filePath, 'index.html');
  if (fs.existsSync(indexPath)) {
    serveFile(indexPath, res, 'public, max-age=300');
    return;
  }

  // Fallback to root index.html (SPA routing)
  const rootIndex = path.join(__dirname, 'index.html');
  if (fs.existsSync(rootIndex)) {
    serveFile(rootIndex, res, 'public, max-age=300');
    return;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not found');
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`aidevo.ai v2 listening on :${PORT}`);
});
