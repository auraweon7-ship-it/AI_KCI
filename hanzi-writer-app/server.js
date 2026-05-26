const express = require('express');
const { Pool } = require('pg');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { OAuth2Client } = require('google-auth-library');
const path = require('path');

const app = express();
const port = process.env.PORT || 3001;

const JWT_SECRET = process.env.JWT_SECRET || 'hanzi-writer-default-secret';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'aura09#$';
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

const googleClient = GOOGLE_CLIENT_ID ? new OAuth2Client(GOOGLE_CLIENT_ID) : null;

app.use(express.json());
app.use(express.static(__dirname));

// --- Auth Middleware ---
function auth(req, res, next) {
    var header = req.headers.authorization;
    if (!header) return res.status(401).json({ error: 'No token' });
    var token = header.replace('Bearer ', '');
    try {
        req.user = jwt.verify(token, JWT_SECRET);
        next();
    } catch (e) {
        res.status(401).json({ error: 'Invalid token' });
    }
}

// --- Config endpoint (expose Google Client ID to frontend) ---
app.get('/api/config', function (req, res) {
    res.json({ googleClientId: GOOGLE_CLIENT_ID });
});

// --- Google OAuth Login ---
app.post('/api/auth/google', async function (req, res) {
    if (!googleClient) return res.status(400).json({ error: 'Google OAuth not configured' });
    try {
        var ticket = await googleClient.verifyIdToken({
            idToken: req.body.credential,
            audience: GOOGLE_CLIENT_ID
        });
        var payload = ticket.getPayload();

        var result = await pool.query(
            `INSERT INTO users (google_id, name, email, photo_url, last_active)
             VALUES ($1, $2, $3, $4, NOW())
             ON CONFLICT (google_id) DO UPDATE SET
               name = EXCLUDED.name, email = EXCLUDED.email,
               photo_url = EXCLUDED.photo_url, last_active = NOW()
             RETURNING id, name, email, photo_url`,
            [payload.sub, payload.name, payload.email, payload.picture]
        );
        var user = result.rows[0];
        res.json({ token: makeToken(user), user: userJson(user) });
    } catch (e) {
        console.error('Google auth error:', e.message);
        res.status(401).json({ error: 'Authentication failed' });
    }
});

// --- Email/Password Auth ---
function hashPassword(pw) {
    var salt = crypto.randomBytes(16).toString('hex');
    var hash = crypto.pbkdf2Sync(pw, salt, 10000, 64, 'sha512').toString('hex');
    return salt + ':' + hash;
}

function verifyPassword(pw, stored) {
    var parts = stored.split(':');
    var hash = crypto.pbkdf2Sync(pw, parts[0], 10000, 64, 'sha512').toString('hex');
    return hash === parts[1];
}

function makeToken(user) {
    return jwt.sign(
        { id: user.id, name: user.name, email: user.email, photoURL: user.photo_url || '' },
        JWT_SECRET, { expiresIn: '7d' }
    );
}

function userJson(user) {
    return { id: user.id, name: user.name, email: user.email, photoURL: user.photo_url || '' };
}

app.post('/api/auth/register', async function (req, res) {
    var b = req.body;
    if (!b.email || !b.password || !b.name) return res.status(400).json({ error: '이름, 이메일, 비밀번호를 입력하세요' });
    if (b.password.length < 4) return res.status(400).json({ error: '비밀번호는 4자 이상이어야 합니다' });
    try {
        var exists = await pool.query('SELECT id FROM users WHERE email = $1 AND password_hash IS NOT NULL', [b.email]);
        if (exists.rows.length > 0) return res.status(409).json({ error: '이미 등록된 이메일입니다' });
        var result = await pool.query(
            `INSERT INTO users (name, email, password_hash, last_active)
             VALUES ($1, $2, $3, NOW()) RETURNING id, name, email, photo_url`,
            [b.name, b.email, hashPassword(b.password)]
        );
        var user = result.rows[0];
        res.json({ token: makeToken(user), user: userJson(user) });
    } catch (e) {
        console.error('Register error:', e.message);
        res.status(500).json({ error: '회원가입 실패' });
    }
});

app.post('/api/auth/login', async function (req, res) {
    var b = req.body;
    if (!b.email || !b.password) return res.status(400).json({ error: '이메일과 비밀번호를 입력하세요' });
    try {
        var result = await pool.query('SELECT id, name, email, photo_url, password_hash FROM users WHERE email = $1 AND password_hash IS NOT NULL', [b.email]);
        if (result.rows.length === 0) return res.status(401).json({ error: '이메일 또는 비밀번호가 틀립니다' });
        var user = result.rows[0];
        if (!verifyPassword(b.password, user.password_hash)) return res.status(401).json({ error: '이메일 또는 비밀번호가 틀립니다' });
        await pool.query('UPDATE users SET last_active = NOW() WHERE id = $1', [user.id]);
        res.json({ token: makeToken(user), user: userJson(user) });
    } catch (e) {
        console.error('Login error:', e.message);
        res.status(500).json({ error: '로그인 실패' });
    }
});

// --- Admin Login ---
app.post('/api/auth/admin', function (req, res) {
    if (req.body.password === ADMIN_PASSWORD) {
        var token = jwt.sign({ admin: true }, JWT_SECRET, { expiresIn: '4h' });
        res.json({ token: token });
    } else {
        res.status(401).json({ error: 'Wrong password' });
    }
});

// --- Practice Records ---
app.post('/api/practices', auth, async function (req, res) {
    try {
        var b = req.body;
        await pool.query(
            'INSERT INTO practices (user_id, char, correct, mistakes) VALUES ($1, $2, $3, $4)',
            [req.user.id, b.char, b.correct || 0, b.mistakes || 0]
        );
        res.json({ ok: true });
    } catch (e) {
        console.error('Save practice error:', e.message);
        res.status(500).json({ error: 'Save failed' });
    }
});

app.get('/api/practices', auth, async function (req, res) {
    try {
        var result = await pool.query(
            'SELECT char, correct, mistakes, created_at FROM practices WHERE user_id = $1 ORDER BY created_at DESC LIMIT 500',
            [req.user.id]
        );
        res.json(result.rows);
    } catch (e) {
        res.status(500).json({ error: 'Load failed' });
    }
});

// --- Admin: All Learners ---
app.get('/api/admin/learners', auth, async function (req, res) {
    if (!req.user.admin && !req.user.id) return res.status(403).json({ error: 'Forbidden' });
    try {
        var result = await pool.query(
            `SELECT u.id, u.name, u.email, u.photo_url, u.last_active,
                    COUNT(p.id)::int as practice_count
             FROM users u LEFT JOIN practices p ON p.user_id = u.id
             GROUP BY u.id ORDER BY u.last_active DESC`
        );
        res.json(result.rows);
    } catch (e) {
        res.status(500).json({ error: 'Load failed' });
    }
});

// --- Admin: Learner Detail ---
app.get('/api/admin/learners/:id', auth, async function (req, res) {
    if (!req.user.admin && !req.user.id) return res.status(403).json({ error: 'Forbidden' });
    try {
        var results = await Promise.all([
            pool.query('SELECT id, name, email, photo_url, last_active FROM users WHERE id = $1', [req.params.id]),
            pool.query('SELECT char, correct, mistakes, created_at FROM practices WHERE user_id = $1 ORDER BY created_at DESC LIMIT 200', [req.params.id])
        ]);
        if (results[0].rows.length === 0) return res.status(404).json({ error: 'Not found' });
        res.json({ user: results[0].rows[0], practices: results[1].rows });
    } catch (e) {
        res.status(500).json({ error: 'Load failed' });
    }
});

// --- DB Init ---
async function initDB() {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS users (
            id SERIAL PRIMARY KEY,
            google_id VARCHAR(255) UNIQUE,
            name VARCHAR(255),
            email VARCHAR(255),
            password_hash TEXT,
            photo_url TEXT,
            last_active TIMESTAMP DEFAULT NOW(),
            created_at TIMESTAMP DEFAULT NOW()
        );
        CREATE TABLE IF NOT EXISTS practices (
            id SERIAL PRIMARY KEY,
            user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
            char VARCHAR(10) NOT NULL,
            correct INTEGER DEFAULT 0,
            mistakes INTEGER DEFAULT 0,
            created_at TIMESTAMP DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_practices_user ON practices(user_id);
        CREATE INDEX IF NOT EXISTS idx_practices_created ON practices(created_at);
    `);
}

initDB().then(function () {
    console.log('Database connected and tables ready');
}).catch(function (e) {
    console.warn('DB init skipped (no DATABASE_URL or connection failed):', e.message);
    console.warn('Running in static-only mode — API endpoints will return errors');
});

app.listen(port, function () {
    console.log('Hanzi Writer server running on port ' + port);
});
