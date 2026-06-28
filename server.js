/**
 * KCI Open API 프록시 서버 + PostgreSQL 사용자 데이터
 * - 정적 파일 서빙 (index.html 등)
 * - /api/kci 경로로 KCI API 프록시 (CORS 우회)
 * - /api/user/* 경로로 사용자 프로필/연구이력 CRUD
 *
 * 환경변수: DATABASE_URL (PostgreSQL 연결 문자열)
 * 실행: node server.js
 * 접속: http://localhost:8080
 */
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const url = require('url');
const { Pool } = require('pg');

const PORT = process.env.PORT || 8080;
const KCI_BASE = 'https://open.kci.go.kr';

// PostgreSQL 연결
const pool = process.env.DATABASE_URL
  ? new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },
    })
  : null;

async function initDB() {
  if (!pool) {
    console.log('  ⚠️  DATABASE_URL 미설정 — DB 기능 비활성');
    return;
  }
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        sub TEXT PRIMARY KEY,
        name TEXT,
        email TEXT,
        picture TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS profiles (
        sub TEXT PRIMARY KEY REFERENCES users(sub) ON DELETE CASCADE,
        name TEXT,
        univ TEXT,
        major TEXT,
        keywords TEXT,
        stage TEXT,
        interest TEXT,
        api_key TEXT,
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS research_history (
        id SERIAL PRIMARY KEY,
        sub TEXT REFERENCES users(sub) ON DELETE CASCADE,
        article_id TEXT NOT NULL,
        title TEXT,
        author TEXT,
        journal TEXT,
        year TEXT,
        raw_data JSONB,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(sub, article_id)
      );
    `);
    console.log('  ✅ PostgreSQL 테이블 준비 완료');
  } catch (e) {
    console.error('  ❌ DB 초기화 에러:', e.message);
  }
}

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

function jsonResponse(res, status, data) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(JSON.stringify(data));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try { resolve(JSON.parse(body)); }
      catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  const parsed = url.parse(req.url, true);
  const pathname = parsed.pathname;

  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400'
    });
    res.end();
    return;
  }

  // Health check
  if (pathname === '/health') {
    jsonResponse(res, 200, {
      status: 'ok', service: 'ai-kci',
      db: pool ? 'connected' : 'disabled',
      uptime: process.uptime()
    });
    return;
  }

  // ── 사용자 API ──────────────────────────────
  try {

    // POST /api/user/login — 사용자 upsert
    if (pathname === '/api/user/login' && req.method === 'POST') {
      if (!pool) return jsonResponse(res, 200, { ok: true, db: false });
      const { sub, name, email, picture } = await readBody(req);
      if (!sub) return jsonResponse(res, 400, { error: 'sub required' });
      await pool.query(`
        INSERT INTO users (sub, name, email, picture, updated_at)
        VALUES ($1, $2, $3, $4, NOW())
        ON CONFLICT (sub) DO UPDATE SET name=$2, email=$3, picture=$4, updated_at=NOW()
      `, [sub, name, email, picture]);
      return jsonResponse(res, 200, { ok: true });
    }

    // GET /api/user/profile?sub=xxx
    if (pathname === '/api/user/profile' && req.method === 'GET') {
      if (!pool) return jsonResponse(res, 200, { profile: null, db: false });
      const sub = parsed.query.sub;
      if (!sub) return jsonResponse(res, 400, { error: 'sub required' });
      const r = await pool.query('SELECT * FROM profiles WHERE sub=$1', [sub]);
      return jsonResponse(res, 200, { profile: r.rows[0] || null });
    }

    // POST /api/user/profile — 프로필 저장
    if (pathname === '/api/user/profile' && req.method === 'POST') {
      if (!pool) return jsonResponse(res, 200, { ok: true, db: false });
      const { sub, name, univ, major, keywords, stage, interest, apiKey } = await readBody(req);
      if (!sub) return jsonResponse(res, 400, { error: 'sub required' });
      await pool.query(`
        INSERT INTO profiles (sub, name, univ, major, keywords, stage, interest, api_key, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
        ON CONFLICT (sub) DO UPDATE SET
          name=$2, univ=$3, major=$4, keywords=$5, stage=$6, interest=$7, api_key=$8, updated_at=NOW()
      `, [sub, name, univ, major, keywords, stage, interest, apiKey]);
      return jsonResponse(res, 200, { ok: true });
    }

    // GET /api/user/history?sub=xxx
    if (pathname === '/api/user/history' && req.method === 'GET') {
      if (!pool) return jsonResponse(res, 200, { history: [], db: false });
      const sub = parsed.query.sub;
      if (!sub) return jsonResponse(res, 400, { error: 'sub required' });
      const r = await pool.query(
        'SELECT article_id as id, title, author, journal, year, raw_data FROM research_history WHERE sub=$1 ORDER BY created_at',
        [sub]
      );
      return jsonResponse(res, 200, { history: r.rows });
    }

    // POST /api/user/history — 연구이력 저장 (배치)
    if (pathname === '/api/user/history' && req.method === 'POST') {
      if (!pool) return jsonResponse(res, 200, { ok: true, db: false });
      const { sub, items } = await readBody(req);
      if (!sub || !items) return jsonResponse(res, 400, { error: 'sub and items required' });
      for (const item of items) {
        await pool.query(`
          INSERT INTO research_history (sub, article_id, title, author, journal, year, raw_data)
          VALUES ($1, $2, $3, $4, $5, $6, $7)
          ON CONFLICT (sub, article_id) DO NOTHING
        `, [sub, item.id, item.title, item.author, item.journal, item.year, JSON.stringify(item)]);
      }
      return jsonResponse(res, 200, { ok: true, saved: items.length });
    }

    // DELETE /api/user/history?sub=xxx&articleId=yyy
    if (pathname === '/api/user/history' && req.method === 'DELETE') {
      if (!pool) return jsonResponse(res, 200, { ok: true, db: false });
      const { sub, articleId } = parsed.query;
      if (!sub || !articleId) return jsonResponse(res, 400, { error: 'sub and articleId required' });
      await pool.query('DELETE FROM research_history WHERE sub=$1 AND article_id=$2', [sub, articleId]);
      return jsonResponse(res, 200, { ok: true });
    }

  } catch (e) {
    console.error('[API ERROR]', pathname, e.message);
    return jsonResponse(res, 500, { error: e.message });
  }

  // ── KCI API 프록시 ─────────────────────────
  if (pathname === '/api/kci') {
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

  // ── 정적 파일 서빙 ─────────────────────────
  let filePath = pathname === '/' ? '/chinese-literacy-app.html' : pathname;
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

initDB().then(() => {
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`\n  ✅ KCI 연구 분석 서버 실행 중`);
    console.log(`  📡 http://0.0.0.0:${PORT}\n`);
    console.log(`  프록시: /api/kci → open.kci.go.kr`);
    console.log(`  DB: ${pool ? 'PostgreSQL 연결됨' : '미설정 (localStorage 폴백)'}`);
    console.log(`  종료: Ctrl+C\n`);
  });
});
