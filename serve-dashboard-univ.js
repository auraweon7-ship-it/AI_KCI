const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const server = http.createServer((req, res) => {
  const parsed = new URL(req.url, `http://${req.headers.host}`);

  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'X-Naver-Client-Id, X-Naver-Client-Secret, Content-Type',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
    });
    res.end();
    return;
  }

  // Naver News API proxy
  if (parsed.pathname === '/api/news') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    const clientId = req.headers['x-naver-client-id'] || process.env.NAVER_CLIENT_ID;
    const clientSecret = req.headers['x-naver-client-secret'] || process.env.NAVER_CLIENT_SECRET;
    const query = parsed.searchParams.get('query');
    const display = parsed.searchParams.get('display') || '5';
    const sort = parsed.searchParams.get('sort') || 'date';

    if (!clientId || !clientSecret) {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'Naver API 인증 정보가 없습니다. Client ID와 Secret을 설정하세요.' }));
      return;
    }
    if (!query) {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'query 파라미터가 필요합니다.' }));
      return;
    }

    const apiUrl = `https://openapi.naver.com/v1/search/news.json?query=${encodeURIComponent(query)}&display=${display}&sort=${sort}`;
    https.get(apiUrl, {
      headers: { 'X-Naver-Client-Id': clientId, 'X-Naver-Client-Secret': clientSecret },
    }, (apiRes) => {
      let data = '';
      apiRes.on('data', chunk => data += chunk);
      apiRes.on('end', () => {
        res.writeHead(apiRes.statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(data);
      });
    }).on('error', (err) => {
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: err.message }));
    });
    return;
  }

  // OG image scraper proxy
  if (parsed.pathname === '/api/og-image') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    const targetUrl = parsed.searchParams.get('url');
    if (!targetUrl) {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'url 파라미터가 필요합니다.' }));
      return;
    }
    const reqOpts = { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; NewsBot/1.0)' }, timeout: 5000 };
    const fetchPage = (url, depth) => {
      if (depth > 3) { res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify({ og: '' })); return; }
      const p = url.startsWith('https') ? https : http;
      p.get(url, reqOpts, (pageRes) => {
        if ([301,302,303,307,308].includes(pageRes.statusCode) && pageRes.headers.location) {
          let loc = pageRes.headers.location;
          if (loc.startsWith('/')) { const u = new URL(url); loc = u.protocol + '//' + u.host + loc; }
          fetchPage(loc, depth + 1);
          pageRes.resume();
          return;
        }
        let html = '';
        pageRes.setEncoding('utf8');
        pageRes.on('data', chunk => { html += chunk; if (html.length > 200000) { pageRes.destroy(); } });
        pageRes.on('end', () => {
          let og = '';
          const m = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)
                 || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i);
          if (m) og = m[1];
          if (!og) {
            const m2 = html.match(/<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i)
                     || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:image["']/i);
            if (m2) og = m2[1];
          }
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ og }));
        });
      }).on('error', () => {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ og: '' }));
      }).on('timeout', function() { this.destroy(); });
    };
    fetchPage(targetUrl, 0);
    return;
  }

  // Serve HTML
  const filePath = path.join(__dirname, 'private-university-dashboard.html');
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(500); res.end('Error'); return; }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(data);
  });
});

server.listen(3200, () => console.log('Dashboard server running on http://localhost:3200'));
