// v2.1 - redeploy trigger
const express = require('express');
const { Pool } = require('pg');
const jwt = require('jsonwebtoken');
const { OAuth2Client } = require('google-auth-library');
const path = require('path');

const app = express();
const port = process.env.PORT || 3001;

const JWT_SECRET = process.env.JWT_SECRET || 'hanzi-writer-default-secret';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'aura09#$';
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '494247553294-68p0b7mtfqo7ub1lvgrb4ollbmcqks1h.apps.googleusercontent.com';

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
             RETURNING id, name, email, photo_url, approved`,
            [payload.sub, payload.name, payload.email, payload.picture]
        );
        var user = result.rows[0];
        res.json({ token: makeToken(user), user: userJson(user) });
    } catch (e) {
        console.error('Google auth error:', e.message);
        res.status(401).json({ error: 'Authentication failed', detail: e.message });
    }
});

function makeToken(user) {
    return jwt.sign(
        { id: user.id, name: user.name, email: user.email, photoURL: user.photo_url || '', approved: !!user.approved },
        JWT_SECRET, { expiresIn: '7d' }
    );
}

function userJson(user) {
    return { id: user.id, name: user.name, email: user.email, photoURL: user.photo_url || '', approved: !!user.approved };
}

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

// --- SRS Data ---
app.get('/api/srs', auth, async function (req, res) {
    try {
        var result = await pool.query(
            'SELECT char, interval_days, ease_factor, repetitions, next_review, last_review FROM srs_data WHERE user_id = $1',
            [req.user.id]
        );
        var data = {};
        result.rows.forEach(function (r) {
            data[r.char] = {
                interval: r.interval_days, ease: r.ease_factor,
                repetitions: r.repetitions, nextReview: r.next_review, lastReview: r.last_review
            };
        });
        res.json(data);
    } catch (e) {
        res.status(500).json({ error: 'Load failed' });
    }
});

app.post('/api/srs', auth, async function (req, res) {
    try {
        var b = req.body;
        await pool.query(
            `INSERT INTO srs_data (user_id, char, interval_days, ease_factor, repetitions, next_review, last_review)
             VALUES ($1, $2, $3, $4, $5, $6, $7)
             ON CONFLICT (user_id, char) DO UPDATE SET
               interval_days = EXCLUDED.interval_days, ease_factor = EXCLUDED.ease_factor,
               repetitions = EXCLUDED.repetitions, next_review = EXCLUDED.next_review,
               last_review = EXCLUDED.last_review`,
            [req.user.id, b.char, b.interval || 1, b.ease || 2.5, b.repetitions || 0, b.nextReview, b.lastReview]
        );
        res.json({ ok: true });
    } catch (e) {
        console.error('Save SRS error:', e.message);
        res.status(500).json({ error: 'Save failed' });
    }
});

// --- Admin: All Learners ---
app.get('/api/admin/learners', auth, async function (req, res) {
    if (!req.user.admin && !req.user.id) return res.status(403).json({ error: 'Forbidden' });
    try {
        var result = await pool.query(
            `SELECT u.id, u.name, u.email, u.photo_url, u.last_active, u.approved, u.created_at,
                    COUNT(p.id)::int as practice_count
             FROM users u LEFT JOIN practices p ON p.user_id = u.id
             GROUP BY u.id ORDER BY u.last_active DESC`
        );
        res.json(result.rows);
    } catch (e) {
        res.status(500).json({ error: 'Load failed' });
    }
});

// --- Admin: Approve / Unapprove User ---
app.patch('/api/admin/learners/:id/approve', auth, async function (req, res) {
    if (!req.user.admin) return res.status(403).json({ error: 'Forbidden' });
    try {
        var approved = req.body.approved !== false;
        var result = await pool.query(
            'UPDATE users SET approved = $1 WHERE id = $2 RETURNING id, name, approved',
            [approved, req.params.id]
        );
        if (result.rows.length === 0) return res.status(404).json({ error: 'Not found' });
        res.json(result.rows[0]);
    } catch (e) {
        res.status(500).json({ error: 'Update failed' });
    }
});

// --- Check approval status (for logged-in user) ---
app.get('/api/auth/status', auth, async function (req, res) {
    try {
        var result = await pool.query('SELECT approved FROM users WHERE id = $1', [req.user.id]);
        if (result.rows.length === 0) return res.json({ approved: false });
        res.json({ approved: !!result.rows[0].approved });
    } catch (e) {
        res.json({ approved: false });
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

// --- Admin: Stats for charts ---
app.get('/api/admin/stats', auth, async function (req, res) {
    if (!req.user.admin && !req.user.id) return res.status(403).json({ error: 'Forbidden' });
    try {
        var results = await Promise.all([
            // Daily practice counts (last 14 days)
            pool.query(
                `SELECT DATE(created_at) as day, COUNT(*)::int as cnt,
                        SUM(correct)::int as correct, SUM(mistakes)::int as mistakes
                 FROM practices
                 WHERE created_at >= NOW() - INTERVAL '14 days'
                 GROUP BY DATE(created_at) ORDER BY day`
            ),
            // Per-learner summary
            pool.query(
                `SELECT u.name, COUNT(p.id)::int as cnt,
                        COALESCE(SUM(p.correct),0)::int as correct,
                        COALESCE(SUM(p.mistakes),0)::int as mistakes,
                        COUNT(DISTINCT p.char)::int as chars
                 FROM users u LEFT JOIN practices p ON p.user_id = u.id
                 GROUP BY u.id, u.name ORDER BY cnt DESC LIMIT 20`
            )
        ]);
        res.json({ daily: results[0].rows, learners: results[1].rows });
    } catch (e) {
        res.status(500).json({ error: 'Stats failed' });
    }
});

// --- Admin: Update User ---
app.put('/api/admin/learners/:id', auth, async function (req, res) {
    if (!req.user.admin) return res.status(403).json({ error: 'Forbidden' });
    try {
        var { name, email } = req.body;
        var result = await pool.query(
            'UPDATE users SET name = COALESCE($1, name), email = COALESCE($2, email) WHERE id = $3 RETURNING id, name, email',
            [name || null, email || null, req.params.id]
        );
        if (result.rows.length === 0) return res.status(404).json({ error: 'Not found' });
        res.json(result.rows[0]);
    } catch (e) {
        res.status(500).json({ error: 'Update failed' });
    }
});

// --- Admin: Delete User ---
app.delete('/api/admin/learners/:id', auth, async function (req, res) {
    if (!req.user.admin) return res.status(403).json({ error: 'Forbidden' });
    try {
        var result = await pool.query('DELETE FROM users WHERE id = $1 RETURNING id', [req.params.id]);
        if (result.rows.length === 0) return res.status(404).json({ error: 'Not found' });
        res.json({ deleted: true });
    } catch (e) {
        res.status(500).json({ error: 'Delete failed' });
    }
});

// --- Visitor Counter ---
app.post('/api/visit', async function (req, res) {
    try {
        var result = await pool.query(
            `INSERT INTO site_stats (key, value) VALUES ('visits', 1)
             ON CONFLICT (key) DO UPDATE SET value = site_stats.value + 1
             RETURNING value`
        );
        res.json({ count: result.rows[0].value });
    } catch (e) {
        res.status(500).json({ error: 'Count failed' });
    }
});

app.get('/api/visit', async function (req, res) {
    try {
        var result = await pool.query("SELECT value FROM site_stats WHERE key = 'visits'");
        res.json({ count: result.rows.length > 0 ? result.rows[0].value : 0 });
    } catch (e) {
        res.status(500).json({ error: 'Count failed' });
    }
});

// --- DB Init ---
async function initDB() {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS site_stats (
            key VARCHAR(50) PRIMARY KEY,
            value INTEGER DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS users (
            id SERIAL PRIMARY KEY,
            google_id VARCHAR(255) UNIQUE,
            name VARCHAR(255),
            email VARCHAR(255),
            photo_url TEXT,
            approved BOOLEAN DEFAULT true,
            last_active TIMESTAMP DEFAULT NOW(),
            created_at TIMESTAMP DEFAULT NOW()
        );
        ALTER TABLE users ADD COLUMN IF NOT EXISTS approved BOOLEAN DEFAULT true;
        UPDATE users SET approved = true WHERE approved = false;
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
        CREATE TABLE IF NOT EXISTS srs_data (
            id SERIAL PRIMARY KEY,
            user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
            char VARCHAR(10) NOT NULL,
            interval_days INTEGER DEFAULT 1,
            ease_factor REAL DEFAULT 2.5,
            repetitions INTEGER DEFAULT 0,
            next_review DATE,
            last_review DATE,
            UNIQUE(user_id, char)
        );
        CREATE INDEX IF NOT EXISTS idx_srs_user ON srs_data(user_id);
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
