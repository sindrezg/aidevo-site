const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const htmlPath = path.join(__dirname, 'index.html');
const w2ePath = path.join(__dirname, 'waste-to-energy.html');
const wteAnswerPath = path.join(__dirname, 'wte', 'index.html');
const hydrogenLcohPath = path.join(__dirname, 'hydrogen-lcoh', 'index.html');
const ammoniaFeasibilityPath = path.join(__dirname, 'ammonia-feasibility', 'index.html');
const prefeedCostPath = path.join(__dirname, 'prefeed-cost', 'index.html');
const sampleReportPath = path.join(__dirname, 'AIDEVO_SAMPLE_REPORT.pdf');
const robotsPath = path.join(__dirname, 'robots.txt');
const sitemapPath = path.join(__dirname, 'sitemap.xml');
const llmsPath = path.join(__dirname, 'llms.txt');
const leadsPath = '/Users/aidevo/.openclaw/workspace/customers/leads.json';

const answerPages = {
  '/wte': wteAnswerPath,
  '/wte/': wteAnswerPath,
  '/waste-to-energy': w2ePath,
  '/waste-to-energy/': w2ePath,
  '/hydrogen-lcoh': hydrogenLcohPath,
  '/hydrogen-lcoh/': hydrogenLcohPath,
  '/ammonia-feasibility': ammoniaFeasibilityPath,
  '/ammonia-feasibility/': ammoniaFeasibilityPath,
  '/prefeed-cost': prefeedCostPath,
  '/prefeed-cost/': prefeedCostPath,
};

const SCREEN_UPSTREAM = 'https://www.indsite.ai/api/v1/screen';

function appendLead(data) {
  try {
    const entry = Object.assign({}, data, { _ts: new Date().toISOString() });
    const line = JSON.stringify(entry) + '\n';
    fs.appendFileSync(leadsPath, line, 'utf8');
  } catch (e) {
    console.error('[leads] append failed:', e.message);
  }
}

function proxyScreen(reqBody, res) {
  const url = new URL(SCREEN_UPSTREAM);
  const options = {
    hostname: url.hostname,
    port: 443,
    path: url.pathname,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(reqBody),
    },
  };
  const proxyReq = https.request(options, (proxyRes) => {
    res.writeHead(proxyRes.statusCode, {
      'Content-Type': proxyRes.headers['content-type'] || 'application/json',
      'Access-Control-Allow-Origin': '*',
    });
    proxyRes.pipe(res);
  });
  proxyReq.on('error', (e) => {
    console.error('[screen proxy] error:', e.message);
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'upstream unavailable' }));
  });
  proxyReq.write(reqBody);
  proxyReq.end();
}

function readBody(req, cb) {
  let body = '';
  req.on('data', (chunk) => { body += chunk; });
  req.on('end', () => cb(body));
}

const AIDEVO_WWW_HOSTS = ['www.aidevo.ai', 'www.aidevo.com'];
const AIDEVO_CANONICAL = 'aidevo.ai';

const server = http.createServer((req, res) => {
  const host = (req.headers.host || '').split(':')[0].toLowerCase();
  if (AIDEVO_WWW_HOSTS.includes(host)) {
    const destPath = (req.url === '/' || req.url === '') ? '/#film' : req.url;
    res.writeHead(301, { Location: `https://${AIDEVO_CANONICAL}${destPath}` });
    res.end();
    return;
  }

  const url = req.url.split('?')[0];

  if (url === '/healthz') {
    let vids = [];
    try { vids = fs.readdirSync(path.join(__dirname, 'videos')); } catch (_) {}
    let allFiles = [];
    try {
      const walk = (d, prefix) => {
        for (const f of fs.readdirSync(d, { withFileTypes: true })) {
          if (f.name === 'node_modules') continue;
          const p = prefix + '/' + f.name;
          if (f.isDirectory()) walk(path.join(d, f.name), p);
          else allFiles.push(p);
        }
      };
      walk(__dirname, '');
    } catch (_) {}
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', v: '2026-09-28-v5-docker', dir: __dirname, videos: vids, files: allFiles }));
    return;
  }

  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    res.end();
    return;
  }

  // API: proxy /api/v1/screen to indsite.ai
  if (url === '/api/v1/screen' && req.method === 'POST') {
    readBody(req, (body) => proxyScreen(body, res));
    return;
  }

  // API: stub /api/v1/leads — log to JSON file, always 200
  if (url === '/api/v1/leads' && req.method === 'POST') {
    readBody(req, (body) => {
      let parsed = {};
      try { parsed = JSON.parse(body); } catch (_) {}
      appendLead(parsed);
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      });
      res.end(JSON.stringify({ ok: true }));
    });
    return;
  }

  // Static: AI-visibility plain-text files
  const visibilityFiles = {
    '/robots.txt': { path: robotsPath, type: 'text/plain; charset=UTF-8' },
    '/sitemap.xml': { path: sitemapPath, type: 'application/xml; charset=UTF-8' },
    '/llms.txt': { path: llmsPath, type: 'text/plain; charset=UTF-8' },
  };
  const vis = visibilityFiles[url];
  if (vis) {
    try {
      const text = fs.readFileSync(vis.path, 'utf8');
      res.writeHead(200, {
        'Content-Type': vis.type,
        'Cache-Control': 'public, max-age=3600',
        'X-Content-Type-Options': 'nosniff',
      });
      res.end(text);
    } catch (e) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found');
    }
    return;
  }

  // Static: sample report PDF
  if (url === '/sample-report.pdf') {
    try {
      const pdf = fs.readFileSync(sampleReportPath);
      res.writeHead(200, {
        'Content-Type': 'application/pdf',
        'Content-Disposition': 'inline; filename="AIDEVO_SAMPLE_REPORT.pdf"',
        'Cache-Control': 'public, max-age=86400',
      });
      res.end(pdf);
    } catch (e) {
      res.writeHead(404);
      res.end('Not found');
    }
    return;
  }

  // Static: video files
  const videoMatch = url.match(/^\/videos\/([A-Za-z0-9_\-]+\.mp4)$/);
  if (videoMatch) {
    const videoPath = path.join(__dirname, 'videos', videoMatch[1]);
    try {
      const stat = fs.statSync(videoPath);
      const range = req.headers.range;
      if (range) {
        const parts = range.replace(/bytes=/, '').split('-');
        const start = parseInt(parts[0], 10);
        const end = parts[1] ? parseInt(parts[1], 10) : stat.size - 1;
        res.writeHead(206, {
          'Content-Range': `bytes ${start}-${end}/${stat.size}`,
          'Accept-Ranges': 'bytes',
          'Content-Length': end - start + 1,
          'Content-Type': 'video/mp4',
          'Cache-Control': 'public, max-age=86400',
        });
        fs.createReadStream(videoPath, { start, end }).pipe(res);
      } else {
        res.writeHead(200, {
          'Content-Type': 'video/mp4',
          'Content-Length': stat.size,
          'Accept-Ranges': 'bytes',
          'Cache-Control': 'public, max-age=86400',
        });
        fs.createReadStream(videoPath).pipe(res);
      }
    } catch (e) {
      res.writeHead(404);
      res.end('Not found');
    }
    return;
  }

  // Engineering answer pages
  const answerPath = answerPages[url];
  if (answerPath) {
    try {
      const html = fs.readFileSync(answerPath, 'utf8');
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=UTF-8',
        'Cache-Control': 'public, max-age=300',
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'DENY',
        'Referrer-Policy': 'strict-origin-when-cross-origin',
      });
      res.end(html);
    } catch (e) {
      res.writeHead(500);
      res.end('Server error');
    }
    return;
  }

  // Explicit root only — return real 404 for unknown paths
  if (url === '/' || url === '/index.html') {
    try {
      const html = fs.readFileSync(htmlPath, 'utf8');
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=UTF-8',
        'Cache-Control': 'public, max-age=300',
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'DENY',
        'Referrer-Policy': 'strict-origin-when-cross-origin',
      });
      res.end(html);
    } catch (e) {
      res.writeHead(500);
      res.end('Server error');
    }
    return;
  }

  // Real 404 — prevents soft-404s and duplicate homepage URLs
  res.writeHead(404, {
    'Content-Type': 'text/plain',
    'Cache-Control': 'public, max-age=300',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end('Not found');
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`aidevo.ai listening on :${PORT}`);
});
