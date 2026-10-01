const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');

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

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > 50000) { reject(new Error('too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString()));
    req.on('error', reject);
  });
}

async function handleEnquiry(req, res) {
  try {
    const raw = await readBody(req);
    const data = JSON.parse(raw);

    const required = ['name', 'email', 'company', 'country'];
    for (const k of required) {
      if (!data[k] || !data[k].trim()) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: `Missing field: ${k}` }));
        return;
      }
    }

    const lines = [
      `Name: ${data.name}`,
      `Email: ${data.email}`,
      `Company: ${data.company}`,
      `Country: ${data.country}`,
    ];
    if (data.waste_type) lines.push(`Waste type: ${data.waste_type}`);
    if (data.annual_tonnage) lines.push(`Annual tonnage: ${data.annual_tonnage}`);
    if (data.end_product) lines.push(`End product: ${data.end_product}`);
    if (data.project_phase) lines.push(`Project phase: ${data.project_phase}`);
    if (data.notes) lines.push(`\nNotes:\n${data.notes}`);

    const smtpUser = process.env.SMTP_USER || 'szg@aidevo.ai';
    const smtpPass = process.env.SMTP_PASS;

    if (!smtpPass) {
      console.error('SMTP_PASS not set — enquiry form cannot send');
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'Server configuration error' }));
      return;
    }

    const transporter = nodemailer.createTransport({
      host: 'send.one.com',
      port: 465,
      secure: true,
      auth: { user: smtpUser, pass: smtpPass },
    });

    await transporter.sendMail({
      from: `"Aidevo Website" <${smtpUser}>`,
      to: 'szg@aidevo.ai',
      replyTo: data.email,
      subject: `Waste project enquiry | ${data.company}`,
      text: lines.join('\n'),
    });

    console.log(`Enquiry received from ${data.email} (${data.company})`);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
  } catch (e) {
    console.error('Enquiry error:', e.message);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: 'Failed to send enquiry' }));
  }
}

const server = http.createServer((req, res) => {
  const url = req.url.split('?')[0];

  // API: enquiry form
  if (url === '/api/enquiry' && req.method === 'POST') {
    handleEnquiry(req, res);
    return;
  }

  // Only serve GET/HEAD for static files
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { 'Content-Type': 'text/plain' });
    res.end('Method not allowed');
    return;
  }

  const videoMatch = url.match(/^\/videos\/([A-Za-z0-9_\-]+\.mp4)$/);
  if (videoMatch) {
    const ghUrl = `https://raw.githubusercontent.com/sindrezg/aidevo-site/main/videos/${videoMatch[1]}`;
    https.get(ghUrl, (ghRes) => {
      if (ghRes.statusCode === 302 || ghRes.statusCode === 301) {
        https.get(ghRes.headers.location, (rRes) => {
          const len = rRes.headers['content-length'];
          const headers = { 'Content-Type': 'video/mp4', 'Accept-Ranges': 'bytes', 'Cache-Control': 'public, max-age=86400' };
          if (len) headers['Content-Length'] = len;
          res.writeHead(200, headers);
          rRes.pipe(res);
        }).on('error', () => { res.writeHead(502); res.end(); });
        return;
      }
      if (ghRes.statusCode !== 200) { res.writeHead(404); res.end('Not found'); return; }
      const len = ghRes.headers['content-length'];
      const headers = { 'Content-Type': 'video/mp4', 'Accept-Ranges': 'bytes', 'Cache-Control': 'public, max-age=86400' };
      if (len) headers['Content-Length'] = len;
      res.writeHead(200, headers);
      ghRes.pipe(res);
    }).on('error', () => { res.writeHead(502); res.end(); });
    return;
  }

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

  // Try .html extension
  const htmlPath = filePath + '.html';
  if (fs.existsSync(htmlPath) && fs.statSync(htmlPath).isFile()) {
    serveFile(htmlPath, res, 'public, max-age=300');
    return;
  }

  // 404
  res.writeHead(404, { 'Content-Type': 'text/html; charset=UTF-8' });
  res.end(`<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Page not found | Aidevo</title><link rel="stylesheet" href="/_next/static/css/index.DRPEh4jA.css"/><link rel="icon" href="/favicon.svg"/></head><body class="antialiased"><div class="premium-site"><header class="site-header"><a class="wordmark" href="/" aria-label="Aidevo home">AIDEVO<span>.</span></a></header><main id="main" style="display:flex;align-items:center;justify-content:center;min-height:70vh;text-align:center;padding:3rem"><div><h1 style="font-size:4rem;font-weight:300;margin-bottom:1rem;opacity:.3">404</h1><p style="font-size:1.1rem;color:hsl(0 0% 45%);margin-bottom:2rem">This page does not exist.</p><a class="button button-green" href="/">Back to aidevo.ai</a></div></main></div></body></html>`);
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`aidevo.ai v2 listening on :${PORT}`);
});
