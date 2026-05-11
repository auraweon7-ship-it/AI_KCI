/**
 * KCI Open API 프록시 서버
 * - 정적 파일 서빙 (index.html 등)
 * - /api/kci 경로로 KCI API 프록시 (CORS 우회)
 *
 * 실행: node server.js
 * 접속: http://localhost:8080
 */
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const url = require('url');

const PORT = process.env.PORT || 8080;
const KCI_BASE = 'https://open.kci.go.kr';

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2'
};

const server = http.createServer((req, res) => {
  const parsed = url.parse(req.url, true);

  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400'
    });
    res.end();
    return;
  }

  // Health check
  if (parsed.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', service: 'ai-kci', uptime: process.uptime() }));
    return;
  }

  // KCI API 프록시
  if (parsed.pathname === '/api/kci') {
    const query = new URLSearchParams(parsed.query).toString();
    const kciUrl = `${KCI_BASE}/po/openapi/openApiSearch.kci?${query}`;

    console.log(`[PROXY] ${req.method} /api/kci → ${kciUrl.substring(0, 100)}...`);

    const kciReq = https.get(kciUrl, {
      headers: {
        'User-Agent': 'AI-KCI-Proxy/1.0',
        'Accept': 'text/xml, application/xml, */*'
      },
      timeout: 20000
    }, (kciRes) => {
      let body = '';
      kciRes.on('data', chunk => body += chunk);
      kciRes.on('end', () => {
        console.log(`[PROXY] KCI 응답: ${kciRes.statusCode}, ${body.length} bytes`);
        res.writeHead(200, {
          'Content-Type': 'text/xml; charset=utf-8',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET',
          'Cache-Control': 'public, max-age=300'
        });
        res.end(body);
      });
    });

    kciReq.on('error', (e) => {
      console.error(`[PROXY] KCI 에러: ${e.message}`);
      res.writeHead(502, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      });
      res.end(JSON.stringify({ error: 'KCI API proxy error', message: e.message }));
    });

    kciReq.on('timeout', () => {
      console.error('[PROXY] KCI 타임아웃');
      kciReq.destroy();
      res.writeHead(504, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      });
      res.end(JSON.stringify({ error: 'KCI API timeout' }));
    });

    return;
  }

  // 정적 파일 서빙
  let filePath = parsed.pathname === '/' ? '/index.html' : parsed.pathname;
  // 보안: 상위 디렉토리 접근 방지
  filePath = path.normalize(filePath).replace(/^(\.\.[\/\\])+/, '');
  filePath = path.join(__dirname, filePath);

  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not Found');
      return;
    }
    res.writeHead(200, {
      'Content-Type': contentType,
      'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=3600'
    });
    res.end(data);
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n  ✅ KCI 연구 분석 서버 실행 중`);
  console.log(`  📡 http://0.0.0.0:${PORT}\n`);
  console.log(`  프록시: /api/kci → open.kci.go.kr`);
  console.log(`  종료: Ctrl+C\n`);
});
