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
      CREATE TABLE IF NOT EXISTS app_data (
        key TEXT PRIMARY KEY,
        data JSONB NOT NULL DEFAULT '[]',
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS app_social (
        key TEXT PRIMARY KEY,
        likes INTEGER DEFAULT 0,
        liked_by JSONB DEFAULT '[]',
        comments JSONB DEFAULT '[]'
      );
      CREATE TABLE IF NOT EXISTS app_poll (
        key TEXT PRIMARY KEY,
        votes JSONB DEFAULT '[0,0,0,0,0]'
      );
    `);
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

  // ── 앱 데이터 API ───────────────────────────
  try {
    // GET /api/appdata/:key
    const m_get = pathname.match(/^\/api\/appdata\/(.+)$/);
    if (m_get && req.method === 'GET') {
      const key = decodeURIComponent(m_get[1]);
      if (!pool) return jsonResponse(res, 200, { data: [] });
      const r = await pool.query('SELECT data FROM app_data WHERE key=$1', [key]);
      return jsonResponse(res, 200, { data: r.rows[0]?.data || [] });
    }

    // PUT /api/appdata/:key
    const m_put = pathname.match(/^\/api\/appdata\/(.+)$/);
    if (m_put && req.method === 'PUT') {
      const key = decodeURIComponent(m_put[1]);
      if (!pool) return jsonResponse(res, 200, { ok: true, db: false });
      const { data } = await readBody(req);
      await pool.query(`
        INSERT INTO app_data (key, data, updated_at)
        VALUES ($1, $2, NOW())
        ON CONFLICT (key) DO UPDATE SET data=$2, updated_at=NOW()
      `, [key, JSON.stringify(data)]);
      return jsonResponse(res, 200, { ok: true });
    }

    // GET /api/social/:key
    const m_sg = pathname.match(/^\/api\/social\/(.+)$/);
    if (m_sg && req.method === 'GET') {
      const key = decodeURIComponent(m_sg[1]);
      if (!pool) return jsonResponse(res, 200, { likes: 0, liked_by: [], comments: [] });
      const r = await pool.query('SELECT * FROM app_social WHERE key=$1', [key]);
      const row = r.rows[0] || { likes: 0, liked_by: [], comments: [] };
      return jsonResponse(res, 200, row);
    }

    // POST /api/social/:key/like  body: {userId}
    const m_like = pathname.match(/^\/api\/social\/(.+)\/like$/);
    if (m_like && req.method === 'POST') {
      const key = decodeURIComponent(m_like[1]);
      if (!pool) return jsonResponse(res, 200, { ok: true, db: false });
      const { userId } = await readBody(req);
      const r = await pool.query('SELECT * FROM app_social WHERE key=$1', [key]);
      const row = r.rows[0] || { likes: 0, liked_by: [], comments: [] };
      const likedBy = Array.isArray(row.liked_by) ? row.liked_by : [];
      const idx = likedBy.indexOf(userId);
      let newLikes;
      if (idx >= 0) { likedBy.splice(idx, 1); newLikes = Math.max(0, (row.likes||0) - 1); }
      else { likedBy.push(userId); newLikes = (row.likes||0) + 1; }
      await pool.query(`
        INSERT INTO app_social (key, likes, liked_by, comments)
        VALUES ($1,$2,$3,$4)
        ON CONFLICT (key) DO UPDATE SET likes=$2, liked_by=$3
      `, [key, newLikes, JSON.stringify(likedBy), JSON.stringify(row.comments||[])]);
      return jsonResponse(res, 200, { ok: true, likes: newLikes, liked: idx < 0 });
    }

    // POST /api/social/:key/comment  body: {text}
    const m_cmt = pathname.match(/^\/api\/social\/(.+)\/comment$/);
    if (m_cmt && req.method === 'POST') {
      const key = decodeURIComponent(m_cmt[1]);
      if (!pool) return jsonResponse(res, 200, { ok: true, db: false });
      const { text } = await readBody(req);
      if (!text) return jsonResponse(res, 400, { error: 'text required' });
      const r = await pool.query('SELECT * FROM app_social WHERE key=$1', [key]);
      const row = r.rows[0] || { likes: 0, liked_by: [], comments: [] };
      const comments = Array.isArray(row.comments) ? row.comments : [];
      comments.push({ text: text.slice(0, 50), ts: Date.now() });
      await pool.query(`
        INSERT INTO app_social (key, likes, liked_by, comments)
        VALUES ($1,$2,$3,$4)
        ON CONFLICT (key) DO UPDATE SET comments=$4
      `, [key, row.likes||0, JSON.stringify(row.liked_by||[]), JSON.stringify(comments)]);
      return jsonResponse(res, 200, { ok: true, comments });
    }

    // GET /api/poll
    if (pathname === '/api/poll' && req.method === 'GET') {
      if (!pool) return jsonResponse(res, 200, { votes: [0,0,0,0,0] });
      const r = await pool.query("SELECT votes FROM app_poll WHERE key='main'");
      return jsonResponse(res, 200, { votes: r.rows[0]?.votes || [0,0,0,0,0] });
    }

    // POST /api/poll  body: {rating: 1-5}
    if (pathname === '/api/poll' && req.method === 'POST') {
      if (!pool) return jsonResponse(res, 200, { ok: true, db: false });
      const { rating } = await readBody(req);
      if (!rating || rating < 1 || rating > 5) return jsonResponse(res, 400, { error: 'rating 1-5 required' });
      const r = await pool.query("SELECT votes FROM app_poll WHERE key='main'");
      const votes = r.rows[0]?.votes || [0,0,0,0,0];
      votes[rating - 1]++;
      await pool.query(`
        INSERT INTO app_poll (key, votes) VALUES ('main', $1)
        ON CONFLICT (key) DO UPDATE SET votes=$1
      `, [JSON.stringify(votes)]);
      return jsonResponse(res, 200, { ok: true, votes });
    }

  } catch (e) {
    console.error('[APP DATA API ERROR]', pathname, e.message);
    return jsonResponse(res, 500, { error: e.message });
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
  let filePath = pathname === '/' ? '/index.html' : pathname;
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
