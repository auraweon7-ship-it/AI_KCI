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

const PORT = 8080;
const KCI_BASE = 'https://open.kci.go.kr';

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

const server = http.createServer((req, res) => {
  const parsed = url.parse(req.url, true);

  // KCI API 프록시
  if (parsed.pathname === '/api/kci') {
    const query = new URLSearchParams(parsed.query).toString();
    const kciUrl = `${KCI_BASE}/po/openapi/openApiSearch.kci?${query}`;

    https.get(kciUrl, (kciRes) => {
      let body = '';
      kciRes.on('data', chunk => body += chunk);
      kciRes.on('end', () => {
        res.writeHead(200, {
          'Content-Type': 'text/xml; charset=utf-8',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET',
          'Cache-Control': 'no-cache'
        });
        res.end(body);
      });
    }).on('error', (e) => {
      res.writeHead(502, { 'Content-Type': 'text/plain' });
      res.end('KCI API proxy error: ' + e.message);
    });
    return;
  }

  // 정적 파일 서빙
  let filePath = parsed.pathname === '/' ? '/index.html' : parsed.pathname;
  filePath = path.join(__dirname, filePath);

  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not Found');
      return;
    }
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log(`\n  ✅ KCI 연구 분석 서버 실행 중`);
  console.log(`  📡 http://localhost:${PORT}\n`);
  console.log(`  프록시: /api/kci → open.kci.go.kr`);
  console.log(`  종료: Ctrl+C\n`);
});
