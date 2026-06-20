import dotenv from 'dotenv';
import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// 서버 크래시 방지: unhandled rejection/exception 잡기
process.on('unhandledRejection', (reason, promise) => {
  console.error('[FATAL] Unhandled Rejection:', reason?.message || reason);
});
process.on('uncaughtException', (err) => {
  console.error('[FATAL] Uncaught Exception:', err.message);
});

const __filename_init = fileURLToPath(import.meta.url);
const __dirname_init = path.dirname(__filename_init);
dotenv.config({ path: path.join(__dirname_init, '.env') });

// CJK 폰트 경로 (레포에 포함된 파일 우선)
import { execSync, execFile } from 'child_process';
const CJK_FONT_BUNDLED = path.join(__dirname_init, 'assets', 'fonts', 'NotoSansCJKsc-Bold.otf');
const KR_FONT_BUNDLED = path.join(__dirname_init, 'assets', 'fonts', 'KoPubWorldDotumBold.ttf');
// TTC (Docker에서 다운로드) → 번들 OTF → 번들 한국어 TTF
const CJK_TTC_PATHS = [
  '/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc',
  '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc',
  '/usr/share/fonts/truetype/noto/NotoSansCJK-Bold.ttc',
  '/usr/share/fonts/noto-cjk/NotoSansCJK-Bold.ttc',
  '/usr/share/fonts/noto-cjk/NotoSansCJK-Regular.ttc'
];
let CJK_FONT_PATH = CJK_TTC_PATHS.find(f => fs.existsSync(f))
                   || (fs.existsSync(CJK_FONT_BUNDLED) ? CJK_FONT_BUNDLED : '')
                   || (fs.existsSync(KR_FONT_BUNDLED) ? KR_FONT_BUNDLED : '');
if (!CJK_FONT_PATH) {
  // 시스템 폰트 검색
  try {
    const findResult = execSync('find /usr/share/fonts -name "NotoSansCJK*" 2>/dev/null | head -1', { encoding: 'utf-8', timeout: 5000 }).trim();
    if (findResult && fs.existsSync(findResult)) CJK_FONT_PATH = findResult;
  } catch(e) {}
}
console.log(`[Font] CJK 폰트: ${CJK_FONT_PATH || '없음 ⚠️'}`);
// execFile already imported above with execSync
import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { google } from 'googleapis';
import cron from 'node-cron';
import pg from 'pg';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ========================
// PostgreSQL 연결 (Railway 또는 로컬)
// ========================
let db = null;
const DATABASE_URL = process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.DATABASE_PRIVATE_URL || process.env.DATABASE_PUBLIC_URL || process.env.POSTGRES_PRISMA_URL || process.env.POSTGRES_URL_NON_POOLING;

async function initDB() {
  // 디버그: DB 관련 환경변수 출력
  const dbEnvKeys = Object.keys(process.env).filter(k => /database|postgres|pg/i.test(k));
  console.log('[DB] DB 관련 환경변수:', dbEnvKeys.length ? dbEnvKeys.join(', ') : '없음');
  if (!DATABASE_URL) {
    console.log('[DB] DATABASE_URL 미설정 — JSON 파일 모드 사용');
    return;
  }
  try {
    const pool = new pg.Pool({
      connectionString: DATABASE_URL,
      ssl: (DATABASE_URL.includes('railway') || DATABASE_URL.includes('postgres')) ? { rejectUnauthorized: false } : false
    });
    await pool.query('SELECT 1');
    db = pool;
    console.log('[DB] PostgreSQL 연결 성공');

    // 테이블 생성
    await db.query(`
      CREATE TABLE IF NOT EXISTS user_settings (
        email VARCHAR(255) PRIMARY KEY,
        name VARCHAR(255),
        picture TEXT,
        api_keys JSONB DEFAULT '{}',
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);
    await db.query(`
      CREATE TABLE IF NOT EXISTS schedules (
        id SERIAL PRIMARY KEY,
        topic TEXT,
        type VARCHAR(20),
        datetime TIMESTAMP,
        cron_expr VARCHAR(100),
        repeat_label VARCHAR(100),
        settings JSONB DEFAULT '{}',
        status VARCHAR(20) DEFAULT 'pending',
        last_run TIMESTAMP,
        last_error TEXT,
        last_topic TEXT,
        run_count INT DEFAULT 0,
        progress JSONB,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    console.log('[DB] 테이블 초기화 완료');
  } catch(e) {
    console.error('[DB] 연결 실패:', e.message);
    db = null;
  }
}
await initDB();

const app = express();
app.use(express.json({ limit: '50mb' }));
// 개발 모드: HTML/JS 캐시 방지
app.use((req, res, next) => {
  if (req.path.endsWith('.html') || req.path.endsWith('.js')) {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.set('Pragma', 'no-cache');
  }
  next();
});
// / → landing.html, /app → index.html
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'landing.html')));
app.get('/app', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/output', express.static(path.join(__dirname, 'output')));

const PORT = process.env.PORT || 3003;
const OUTPUT_DIR = path.join(__dirname, 'output');

['images', 'audio', 'video', 'thumbnails', 'bgm', 'srt', 'clips'].forEach(dir => {
  fs.mkdirSync(path.join(OUTPUT_DIR, dir), { recursive: true });
});

// ========================
// API Clients
// ========================
let anthropic, openai;

// API 키 정규화 (따옴표/공백 제거)
function cleanKey(k) {
  if (!k || typeof k !== 'string') return '';
  return k.trim().replace(/^["']|["']$/g, '').trim();
}

let ANTHROPIC_KEY = cleanKey(process.env.ANTHROPIC_API_KEY);
let OPENAI_KEY = cleanKey(process.env.OPENAI_API_KEY);
let ELEVENLABS_KEY = cleanKey(process.env.ELEVENLABS_API_KEY);
let PEXELS_KEY = cleanKey(process.env.PEXELS_API_KEY);

console.log('[Boot] env 검증:');
console.log('  ANTHROPIC:', ANTHROPIC_KEY ? `set (${ANTHROPIC_KEY.length}자, prefix=${ANTHROPIC_KEY.substring(0,7)}...)` : '❌ 미설정');
console.log('  OPENAI:', OPENAI_KEY ? `set (${OPENAI_KEY.length}자, prefix=${OPENAI_KEY.substring(0,5)}...)` : '❌ 미설정');
console.log('  ELEVENLABS:', ELEVENLABS_KEY ? `set (${ELEVENLABS_KEY.length}자)` : '❌ 미설정');
console.log('  PEXELS:', PEXELS_KEY ? `set (${PEXELS_KEY.length}자)` : '❌ 미설정');

if (ANTHROPIC_KEY) {
  try { anthropic = new Anthropic({ apiKey: ANTHROPIC_KEY }); }
  catch(e) { console.error('[Anthropic 초기화 실패]', e.message); }
} else {
  console.warn('⚠️  ANTHROPIC_API_KEY 미설정 — Claude API 호출 실패합니다.');
}
if (OPENAI_KEY) {
  try { openai = new OpenAI({ apiKey: OPENAI_KEY }); }
  catch(e) { console.error('[OpenAI 초기화 실패]', e.message); }
} else {
  console.warn('⚠️  OPENAI_API_KEY 미설정 — 이미지 생성 실패합니다.');
}

// 헬퍼: API 호출 전 키 확인
function checkAnthropic() {
  if (!anthropic || !ANTHROPIC_KEY) {
    const err = new Error('ANTHROPIC_API_KEY 환경변수가 설정되지 않았거나 빈 값입니다. Railway/.env에서 키를 확인하고 서비스를 재배포(redeploy)하세요.');
    err.code = 'NO_ANTHROPIC_KEY';
    throw err;
  }
}
function checkOpenAI() {
  if (!openai || !OPENAI_KEY) {
    const err = new Error('OPENAI_API_KEY 환경변수가 설정되지 않았거나 빈 값입니다.');
    err.code = 'NO_OPENAI_KEY';
    throw err;
  }
}

// YouTube OAuth2
const oauth2Client = new google.auth.OAuth2(
  cleanKey(process.env.YOUTUBE_CLIENT_ID),
  cleanKey(process.env.YOUTUBE_CLIENT_SECRET),
  cleanKey(process.env.YOUTUBE_REDIRECT_URI) || `http://localhost:${PORT}/api/google/callback`
);
console.log('[OAuth] Client ID:', process.env.YOUTUBE_CLIENT_ID ? `set (${cleanKey(process.env.YOUTUBE_CLIENT_ID).substring(0,10)}...)` : '❌');
console.log('[OAuth] Redirect URI:', cleanKey(process.env.YOUTUBE_REDIRECT_URI) || `http://localhost:${PORT}/api/google/callback`);

// 토큰 갱신 시 새 토큰 자동 저장 (Google token rotation 대응)
oauth2Client.on('tokens', async (tokens) => {
  console.log('[OAuth] 토큰 갱신 이벤트:', { hasAccess: !!tokens.access_token, hasRefresh: !!tokens.refresh_token });
  if (tokens.refresh_token) {
    youtubeTokens = { ...youtubeTokens, ...tokens };
    oauth2Client.setCredentials(youtubeTokens);
    // DB 저장
    if (db) {
      try {
        await db.query(`INSERT INTO oauth_tokens (id, tokens, updated_at) VALUES ('youtube', $1, NOW()) ON CONFLICT (id) DO UPDATE SET tokens = $1, updated_at = NOW()`, [JSON.stringify(youtubeTokens)]);
        console.log('[OAuth] 갱신된 refresh_token DB 저장 ✅');
      } catch(e) {}
    }
    // 파일 저장
    try { fs.writeFileSync(TOKEN_PATH, JSON.stringify(youtubeTokens, null, 2)); } catch(e) {}
  } else if (tokens.access_token) {
    youtubeTokens = { ...youtubeTokens, ...tokens };
    oauth2Client.setCredentials(youtubeTokens);
  }
});

let youtubeTokens = null;
const TOKEN_PATH = path.join(__dirname, '.youtube-tokens.json');

if (process.env.YOUTUBE_REFRESH_TOKEN) {
  youtubeTokens = { refresh_token: process.env.YOUTUBE_REFRESH_TOKEN };
  oauth2Client.setCredentials(youtubeTokens);
  console.log('[OAuth] 토큰 로드: 환경변수');
} else if (fs.existsSync(TOKEN_PATH)) {
  try {
    youtubeTokens = JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf-8'));
    oauth2Client.setCredentials(youtubeTokens);
    console.log('[OAuth] 토큰 로드: 파일');
  } catch(e) {}
}
// Railway 재배포 대비: DB에서 토큰 복원
if (!youtubeTokens && db) {
  try {
    const r = await db.query(`SELECT tokens FROM oauth_tokens WHERE id = 'youtube'`);
    if (r.rows.length && r.rows[0].tokens) {
      youtubeTokens = typeof r.rows[0].tokens === 'string' ? JSON.parse(r.rows[0].tokens) : r.rows[0].tokens;
      oauth2Client.setCredentials(youtubeTokens);
      console.log('[OAuth] 토큰 로드: DB 복원 ✅');
    }
  } catch(e) { console.warn('[OAuth] DB 토큰 복원 실패:', e.message); }
}

// ========================
// Project State
// ========================
const projects = {};

function getProject(id) {
  if (!projects[id]) {
    projects[id] = {
      id,
      topic: '',
      target: '',
      plan: '',
      script: '',
      scenes: [],
      imageFiles: [],
      audioFiles: [],
      videoFile: null,
      meta: {},
      createdAt: new Date().toISOString()
    };
  }
  return projects[id];
}

// ========================
// Health Check
// ========================
app.get('/api/health', async (req, res) => {
  res.json({
    status: 'ok',
    apis: {
      claude: !!ANTHROPIC_KEY && !!anthropic,
      dalle: !!OPENAI_KEY && !!openai,
      elevenlabs: !!ELEVENLABS_KEY,
      pexels: !!PEXELS_KEY,
      youtube: !!process.env.YOUTUBE_CLIENT_ID
    },
    ytClientPrefix: process.env.YOUTUBE_CLIENT_ID?.substring(0, 15) || 'NOT_SET',
    ytRedirectUri: process.env.YOUTUBE_REDIRECT_URI || 'NOT_SET',
    keyLengths: {
      anthropic: ANTHROPIC_KEY?.length || 0,
      openai: OPENAI_KEY?.length || 0,
      elevenlabs: ELEVENLABS_KEY?.length || 0,
      pexels: PEXELS_KEY?.length || 0
    },
    ffmpeg: await new Promise(resolve => {
      execFile('ffmpeg', ['-version'], { timeout: 5000 }, (err, stdout) => {
        resolve(err ? false : stdout.split('\n')[0] || true);
      });
    }),
    database: !!db,
    cjkFont: CJK_FONT_PATH || false
  });
});

// ========================
// 0. YouTube 트렌드
// ========================
app.get('/api/youtube/trending', async (req, res) => {
  try {
    const youtube = google.youtube({ version: 'v3', auth: oauth2Client });

    const response = await youtube.videos.list({
      part: 'snippet,statistics',
      chart: 'mostPopular',
      regionCode: 'KR',
      maxResults: 12
    });

    const trends = response.data.items.map(v => ({
      title: v.snippet.title,
      channel: v.snippet.channelTitle,
      views: parseInt(v.statistics.viewCount || 0),
      category: v.snippet.categoryId,
      thumbnail: v.snippet.thumbnails?.medium?.url
    }));

    res.json({ success: true, trends });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ========================
// 영상 유형별 프롬프트 가이드
// ========================
const VIDEO_TYPE_GUIDE = {
  'history-documentary': {
    label: '역사물',
    topicHint: '역사적 사건·왕조·전쟁·인물·문명을 중심으로, 사료 기반의 신뢰성 있는 주제',
    planHint: '연대기적 서술 구조. 1차 사료(실록, 문헌) 인용 강조. Fact-Check 체크리스트 상세히 작성. 역사적 맥락과 현대적 의미 연결.',
    scriptHint: '권위 있는 역사 다큐멘터리 어조. 연도·지명·인명 정확히 표기. 역사적 팩트와 해석을 구분. 감정적 몰입보다 사실 전달 우선.',
    imageHint: 'Historical accuracy essential. Period-accurate costumes, architecture, artifacts. Aged parchment texture, sepia tones acceptable. Maps and timelines as visual aids.',
  },
  'mini-documentary': {
    label: '미니 다큐',
    topicHint: '현실 세계의 흥미로운 현상·사건·장소·사람을 탐구하는 주제. 5~10분 내에 완결되는 단편 다큐 스타일',
    planHint: '탐사 보도 스타일. 오프닝 훅 → 현장 소개 → 핵심 발견 → 전문가 의견 → 결론 구조. 인터뷰·현장감 강조.',
    scriptHint: '현장감 있는 1인칭 탐사 어조. "지금 이 순간", "직접 가보니" 등 현재형 서술. 시청자를 현장에 데려가는 느낌.',
    imageHint: 'Documentary photography style. Candid shots, real locations, journalistic framing. Natural lighting, handheld camera feel.',
  },
  'reenactment': {
    label: '재현물',
    topicHint: '역사적 사건이나 실화를 드라마틱하게 재현하는 주제. 인물의 내면과 극적 순간 중심',
    planHint: '드라마 구조 적용. 주인공 설정 → 갈등 고조 → 클라이맥스 재현 → 역사적 평가. 각 장면의 감정선과 연출 포인트 구체적으로.',
    scriptHint: '영화적 서술. 현재형·과거형 혼용으로 긴장감 조성. 인물의 심리 묘사. "그 순간", "그는 결심했다" 등 드라마틱 표현 활용.',
    imageHint: 'Cinematic reenactment style. Dramatic lighting, period costumes on actors, intense close-ups, epic wide shots. Film grain texture, high contrast.',
  },
  'science-education': {
    label: '과학/교육',
    topicHint: '과학 원리·자연 현상·기술 혁신·의학·우주 등 지식 전달 중심 주제. 호기심 자극형',
    planHint: '개념 → 원리 설명 → 시각화 → 응용 사례 → 미래 전망 구조. 어려운 개념을 쉽게 설명하는 비유와 시각화 계획 포함.',
    scriptHint: '명확하고 친근한 설명 어조. 복잡한 개념은 일상 비유로 설명. "쉽게 말하면", "예를 들어" 전환구 활용. 정확한 수치와 출처 인용.',
    imageHint: 'Scientific visualization style. Diagrams, infographics, microscope views, space imagery, laboratory settings. Clean and educational aesthetic.',
  },
  'biography': {
    label: '인물전기',
    topicHint: '역사적 위인, 현대 인물, 독특한 삶을 산 사람의 생애와 업적 중심 주제',
    planHint: '생애 타임라인 구조. 탄생 배경 → 성장 → 도전과 실패 → 성취 → 유산. 인물의 내면 심리와 시대적 맥락 병행 서술.',
    scriptHint: '인물 중심 서술. 3인칭 시점. 인물의 명언·일화 적극 인용. 시대적 배경과 인물의 선택이 어떻게 연결되는지 강조.',
    imageHint: 'Portrait-focused composition. Authentic historical photos mixed with illustrated scenes. Character-driven framing, expressive faces, symbolic props.',
  },
  'mystery': {
    label: '미스터리/음모론',
    topicHint: '미해결 사건, 역사적 의문점, 음모론, 초자연 현상, 반전이 있는 실화 주제',
    planHint: '미스터리 구조. 의문 제기 → 기존 설명의 허점 → 새로운 단서 → 여러 가설 검토 → 충격적 결론(또는 미해결 처리). 서스펜스 유지.',
    scriptHint: '서스펜스 어조. 의문문으로 시청자 참여 유도. "그런데 이상한 점이 있습니다", "아무도 몰랐던 사실" 등 훅 표현 적극 활용. 반전 직전 빌드업.',
    imageHint: 'Dark atmospheric style. Shadows, fog, mysterious symbols, dark color palette. Noir lighting, redacted documents aesthetic, ominous ambiance.',
  },
  'social-phenomena': {
    label: '사회현상',
    topicHint: '현대 사회 트렌드, 문화 현상, 경제·정치 이슈, 세대 갈등 등 현재 진행형 주제',
    planHint: '사회 분석 구조. 현상 소개 → 통계/데이터 → 원인 분석 → 사례 인터뷰 → 전문가 의견 → 전망. 균형 잡힌 시각 유지.',
    scriptHint: '저널리즘 어조. 구체적 수치와 사례 활용. 다양한 시각 제시. 감정적 판단보다 사실 기반 분석. 시청자가 스스로 판단하도록 열린 결말.',
    imageHint: 'Modern journalistic style. Urban environments, diverse people, data visualizations, news headlines, social media screenshots aesthetic.',
  },
  'nature': {
    label: '자연/환경',
    topicHint: '자연 현상, 생태계, 동식물, 지구 변화, 환경 문제, 탐험 주제',
    planHint: '자연 다큐 구조. 경이로운 오프닝 → 생태 메커니즘 설명 → 위협/도전 → 보존 노력 → 희망 메시지. 감동적 서사.',
    scriptHint: 'David Attenborough 스타일. 경이로움과 경외감 전달. 생생한 묘사로 시청자가 현장에 있는 느낌. 생태적 정확성 유지.',
    imageHint: 'Nature photography style. Golden hour lighting, macro shots, aerial views, wildlife close-ups. Vivid colors, epic landscapes, BBC nature documentary aesthetic.',
  },
};

function getVideoTypeContext(videoType) {
  return VIDEO_TYPE_GUIDE[videoType] || VIDEO_TYPE_GUIDE['history-documentary'];
}

// ========================
// 1. 주제 추천 (Claude)
// ========================
app.post('/api/topics/suggest', async (req, res) => {
  try {
    checkAnthropic();
    const { category, target, keyword, categories, language, count, videoType } = req.body;
    const topicCount = Math.min(Math.max(parseInt(count) || 10, 1), 30);
    const catList = categories || 'history,science,ai,mystery,economy,psychology,nature,crime,culture,philosophy,health';
    const topicLang = language || '한국어';
    const vtCtx = getVideoTypeContext(videoType);

    const prompt = `당신은 100만 구독자를 보유한 전문 유튜브 채널 기획자입니다.

다음 조건에 맞는 유튜브 롱폼 영상 주제 ${topicCount}개를 추천해주세요:
- 영상 유형: ${vtCtx.label} — ${vtCtx.topicHint}
- 카테고리: ${category || '자유 (다양한 카테고리에서 골고루)'}
- 타겟 시청자: ${target || '전 연령'}
- 출력 언어: ${topicLang} (모든 title과 description을 반드시 ${topicLang}로 작성하세요)
${keyword ? `- 관련 키워드: ${keyword}` : ''}

category 필드는 반드시 다음 중 하나를 사용하세요: ${catList}

각 주제마다 다음 JSON 형식으로 작성해주세요:
[
  {
    "title": "영상 제목 (클릭을 유도하는 매력적인 제목)",
    "description": "2줄 설명",
    "estimatedViews": "예상 조회수 (예: 50만+)",
    "difficulty": "하/중/상",
    "category": "위 카테고리 목록 중 하나",
    "target": "가장 적합한 타겟 시청자 (다음 중 정확히 하나만 선택: 10대, 20대, 30대, 40대, 50대 이상, 전 연령)",
    "keywords": ["키워드1", "키워드2", "키워드3"]
  }
]

반드시 정확히 ${topicCount}개를 생성하세요. ${topicCount}개 미만이면 안 됩니다.
JSON 배열만 반환하세요. 다른 텍스트 없이.`;

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: Math.max(4000, topicCount * 400),
      messages: [{ role: 'user', content: prompt }]
    });

    const text = message.content[0].text;
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    let topics = jsonMatch ? JSON.parse(jsonMatch[0]) : [];
    console.log(`[Topics] 1차: ${topics.length}개 생성`);

    // 요청 수 미만이면 추가 생성
    if (topics.length < topicCount) {
      const need = topicCount - topics.length;
      console.log(`[Topics] ${need}개 추가 생성 중...`);
      try {
        const msg2 = await anthropic.messages.create({
          model: 'claude-sonnet-4-6',
          max_tokens: 3000,
          messages: [{ role: 'user', content: `이전에 ${topics.length}개 주제를 생성했습니다. 추가로 ${need}개를 더 생성하세요.
기존 주제: ${topics.map(t=>t.title).join(', ')}
중복되지 않는 새로운 주제 ${need}개를 동일한 JSON 형식으로 생성하세요.
조건: 카테고리=${category||'자유'}, 타겟=${target||'전 연령'}, 언어=${topicLang}
JSON 배열만 반환:` }]
        });
        const match2 = msg2.content[0].text.match(/\[[\s\S]*\]/);
        if (match2) {
          const extra = JSON.parse(match2[0]);
          topics = topics.concat(extra).slice(0, 10);
        }
      } catch(e) { console.warn('[Topics] 추가 생성 실패:', e.message); }
      console.log(`[Topics] 최종: ${topics.length}개`);
    }

    res.json({ success: true, topics });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ========================
// 2. 대본 기획 (Claude)
// ========================
app.post('/api/plan/generate', async (req, res) => {
  req.setTimeout(600000); res.setTimeout(600000);
  try {
    const { projectId, topic, target, length, tone, style, notes, refText, videoType } = req.body;
    const project = getProject(projectId);
    project.topic = topic;
    project.target = target;
    const vtCtx = getVideoTypeContext(videoType);

    const prompt = `당신은 100만 구독자를 보유한 전문 유튜브 영상 기획자입니다.

다음 주제로 유튜브 롱폼 영상 기획안을 작성해주세요:

[영상 유형]: ${vtCtx.label}
[유형별 기획 지침]: ${vtCtx.planHint}
[주제]: ${topic}
[타겟 시청자]: ${target || '전 연령'}
[영상 길이]: 약 ${length || 15}분
[톤앤매너]: ${tone || '진지하고 무게감 있는'}
[비주얼 스타일]: ${style || '유럽풍 애니메이션'}
${notes ? `[특별 요청]: ${notes}` : ''}
${refText ? `\n[참고 대본 텍스트]:\n아래 텍스트를 핵심 자료로 참고하여 기획안을 작성하세요. 이 텍스트의 내용, 구조, 핵심 정보를 최대한 반영하세요.\n---\n${refText.substring(0, 6000)}\n---` : ''}

기획안에 다음을 포함해주세요:
1. 영상 구조 (기승전결): 오프닝(후킹) - 서론 - 본론1 - 본론2 - 클라이맥스 - 결론(CTA)
   각 파트마다 시간 배분, 핵심 내용, 연출 포인트를 구체적으로 작성
2. 장면 구성: 8~10개 장면의 비주얼 설명
3. Fact-Check 체크리스트
4. 참고 자료/출처 가이드

중요: 이 영상은 단독 완결형 콘텐츠입니다. "다음 영상", "후속편", "시리즈 다음 편" 등 다음 영상 예고를 절대 포함하지 마세요.
전문적이고 상세한 기획안을 작성해주세요.`;

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      messages: [{ role: 'user', content: prompt }]
    });

    const plan = message.content[0].text;
    project.plan = plan;

    res.json({ success: true, plan });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ========================
// 3. 대본 생성 (Claude)
// ========================
app.post('/api/script/generate', async (req, res) => {
  req.setTimeout(600000); res.setTimeout(600000);
  try {
    const { projectId, topic, target, wordCount, narration, plan, tone, language, refText, targetMinutes, videoType } = req.body;
    const project = getProject(projectId);
    const vtCtx = getVideoTypeContext(videoType);

    const prompt = `당신은 100만 구독자를 보유한 전문 유튜브 대본 작가입니다.

다음 정보를 바탕으로 유튜브 롱폼 영상 대본을 작성해주세요:

[영상 유형]: ${vtCtx.label}
[대본 작성 지침]: ${vtCtx.scriptHint}
[주제]: ${topic || project.topic}
[타겟 시청자]: ${target || project.target || '전 연령'}
[대본 분량]: 약 ${wordCount || 3000}자
[나레이션 스타일]: ${narration || '3인칭 나레이터'}
[톤앤매너]: ${tone || '진지하고 무게감 있는'}
[출력 언어]: ${language || '한국어'} (이 언어로 모든 본문 나레이션을 작성하세요)

${plan || project.plan ? `[기획안 참고]:\n${(plan || project.plan).substring(0, 2000)}` : ''}
${refText ? `\n[참고 대본 텍스트]:\n아래 텍스트를 핵심 자료로 참고하여 대본을 작성하세요. 이 텍스트의 내용, 사실 관계, 핵심 정보를 정확히 반영하되, 유튜브 영상에 적합한 나레이션 형태로 재구성하세요.\n---\n${refText.substring(0, 8000)}\n---` : ''}

대본 작성 규칙:
1. 구조: 오프닝(강력한 후킹) → 서론 → 본론 → 클라이맥스 → 결론(CTA)
   [오프닝 30초 — 시청자 이탈 방지 핵심]
   - 첫 문장부터 충격적 사실, 반전, 또는 강렬한 질문으로 시작 (예: "이것을 알게 된 순간, 당신의 상식이 무너질 것입니다")
   - 절대 배경 설명이나 인사말로 시작하지 마세요. 곧바로 핵심 미스터리/충격/호기심을 던지세요
   - 첫 30초(약 120자) 안에 시청자가 "계속 봐야 하는 이유"를 명확히 제시
   - 오프닝에서 영상 전체의 가장 충격적인 팩트를 미리 암시 (스포일러 아닌 티저)
   - 짧고 강렬한 문장 연속 사용 (한 문장 20자 이내 권장)
2. Fact-Check: 실제 역사적 사실/검증된 데이터만 사용
3. 각 장면을 [장면 1: 제목 | 이미지: 비주얼 묘사] 형식으로 구분 (이미지 묘사는 반드시 [] 대괄호 안에만 포함)
4. 톤/감정 지시문 금지: "(차분하게)", "(긴장감 있게)" 같은 연출 지시는 절대 작성 금지 (TTS가 그대로 읽음)
5. CTA: 마지막에 자연스러운 좋아요/구독 요청
6. 절대 금지: "이미지:", "▶ 이미지:", "배경:", "효과음:", "음악:", "BGM:", "화면:", "자막:", "카메라:", "샷:", "비주얼:", "영상:" 같은 메타 라벨을 나레이션 본문이나 별도 줄에 작성하지 마세요. 비주얼 정보는 오직 [장면 N: 제목 | 이미지: 묘사] 헤더 안에만 포함하세요.
7. 진행/연출 지시문 절대 금지 (TTS가 그대로 읽으면 안 됨):
   - "잠시 멈춤", "잠깐 멈춤", "짧은 정적", "긴 침묵", "정적이 흐른다", "침묵", "한 박자 쉼", "호흡", "긴 호흡"
   - "(pause)", "[pause]", "...", "음악 페이드인", "음악 페이드아웃", "BGM 시작", "효과음", "톤 다운"
   - "화면 전환", "컷 전환", "다음 장면으로", "여기서 잠깐"
   - 위 종류 표현은 괄호/대괄호 포함 어떤 형식으로도 본문에 쓰지 마세요.
8. 절대 문장을 "..." 으로 생략하지 마세요. 모든 문장은 반드시 완전하게 끝맺어야 합니다.
9. "~것을...", "~했다는..." 같은 미완성 문장은 금지합니다. 마지막 문장까지 완결된 형태로 작성하세요.
10. 나레이션 본문은 시청자가 들을 음성 텍스트만 작성하세요. 화면 설명/시각 효과 지시/자막 안내/연출 지시/감정 톤 지시는 절대 본문에 쓰지 마세요.
11. 다음 영상 예고 절대 금지: "다음 영상에서는", "다음 편에서", "다음 시간에", "후속 영상", "2부에서", "시리즈 다음 편", "다음 이야기" 등 다음 영상·후속 콘텐츠를 예고하거나 암시하는 문장을 절대 작성하지 마세요. 이 영상은 단독 완결형 콘텐츠입니다.

[중요 - 분량 엄수 (오차 ±3분 이내)]
- 목표 영상 길이: 정확히 ${targetMinutes || 15}분 (허용 오차: ±3분)
- TTS 음성 속도: 약 230자/분 (한국어 ElevenLabs 기준)
- 따라서 나레이션 본문(장면 헤더 [장면 N:...] 제외)은 반드시 ${wordCount || 3000}자 내외로 작성하세요.
- 허용 범위: ${Math.round((wordCount||3000)*0.85)}자 ~ ${Math.round((wordCount||3000)*1.15)}자
- 이 범위를 벗어나면 영상 길이가 목표에서 3분 이상 차이납니다. 반드시 지켜주세요.
- 절대 중간에 끊기지 않도록 끝까지 완성하세요.`;

    // 스트리밍으로 긴 대본 수신 (타임아웃 방지)
    let script = '';
    const stream = anthropic.messages.stream({
      model: 'claude-sonnet-4-6',
      max_tokens: 32000,
      messages: [{ role: 'user', content: prompt }]
    });
    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta?.text) {
        script += event.delta.text;
      }
    }
    project.script = script;

    const sceneMatches = script.match(/\[장면\s*\d+[^\]]*\]/g) || [];
    project.scenes = sceneMatches.map(s => s.replace(/[\[\]]/g, ''));

    res.json({ success: true, script, sceneCount: project.scenes.length });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ========================
// 4. 이미지 생성 (ChatGPT Images 2.0)
// ========================
app.post('/api/images/generate', async (req, res) => {
  req.setTimeout(300000); res.setTimeout(300000);
  try {
    const { projectId, prompt, style, index, ratio } = req.body;

    const sizeMap = {
      '16:9': '1536x1024',
      '9:16': '1024x1536',
      '1:1': '1024x1024'
    };

    const stylePrefix = {
      // 시네마틱·포토리얼
      'realistic': 'photorealistic, hyper-detailed, 8K resolution, cinematic lighting, sharp focus,',
      'cinematic': 'cinematic concept art, dramatic lighting, film grain, wide aspect ratio,',
      'documentary': 'documentary photography style, candid moment, natural lighting, realistic colors, photojournalism,',
      'hyperrealistic': 'hyperrealistic rendering, ultra-detailed textures, lifelike skin and materials, professional photography,',
      'film-noir': 'film noir style, black and white, high contrast shadows, dramatic chiaroscuro lighting, 1940s atmosphere,',
      'vintage-film': 'vintage film aesthetic, faded colors, grainy texture, retro 1970s look, nostalgic mood,',

      // 일러스트·애니메이션
      'european-animation': 'European animation style, Ghibli-inspired, soft lighting, painterly textures,',
      'anime': 'Japanese anime style, vibrant colors, expressive characters, clean line art, cel-shaded,',
      'pixar-3d': 'Pixar 3D animation style, vibrant lighting, expressive character design, soft global illumination,',
      'ghibli': 'Studio Ghibli style, lush hand-painted backgrounds, whimsical atmosphere, soft watercolor textures,',
      'comic-book': 'American comic book style, bold outlines, halftone shading, dynamic action poses, vibrant colors,',
      'manga': 'Japanese manga style, black ink linework, screen tones, dramatic panel composition, expressive eyes,',
      'storybook': 'childrens storybook illustration, gentle watercolor, soft pastel tones, whimsical hand-drawn quality,',

      // 회화·예술
      'watercolor': 'watercolor painting style, soft edges, flowing colors, paper texture,',
      'oil-painting': 'classical oil painting style, rich colors, Renaissance-inspired, visible brushstrokes,',
      'pencil-sketch': 'detailed pencil sketch, graphite shading, fine cross-hatching, monochrome, hand-drawn artistry,',
      'ink-painting': 'East Asian ink wash painting, sumi-e style, monochromatic brushwork, minimal composition, atmospheric,',
      'impressionist': 'Impressionist painting style, visible brushstrokes, dappled light, Monet-inspired color palette,',
      'renaissance': 'Renaissance painting style, classical composition, chiaroscuro lighting, Da Vinci or Caravaggio inspired,',
      'ukiyo-e': 'Japanese ukiyo-e woodblock print style, flat color planes, bold outlines, Edo period aesthetic,',

      // 콘셉트·판타지
      'fantasy-art': 'epic fantasy concept art, magical atmosphere, ethereal lighting, painterly digital art,',
      'sci-fi': 'science fiction concept art, futuristic technology, atmospheric lighting, cinematic sci-fi aesthetic,',
      'cyberpunk': 'cyberpunk aesthetic, neon-lit streets, rainy night, holographic signs, blade runner style,',
      'steampunk': 'steampunk Victorian aesthetic, brass and copper machinery, gears and steam, retro-futuristic,',
      'dark-fantasy': 'dark fantasy art, gothic atmosphere, moody shadows, Frazetta inspired, epic scale,',
      'surreal': 'surrealist art, dreamlike composition, Salvador Dali inspired, impossible perspective, symbolic imagery,',

      // 그래픽·디자인
      'minimalist': 'minimalist design, clean composition, limited color palette, negative space, modern aesthetic,',
      'flat-design': 'flat design illustration, solid colors, no gradients, geometric shapes, modern UI style,',
      'vector-art': 'clean vector art, sharp lines, smooth gradients, illustrator style,',
      'pixel-art': '16-bit pixel art, retro video game aesthetic, limited color palette, detailed pixel work,',
      'low-poly': 'low poly 3D art, geometric facets, flat shading, isometric perspective, modern minimalist 3D,',
      'isometric': 'isometric illustration, 2.5D perspective, clean geometry, vibrant colors, infographic style,'
    };

    const fullPrompt = `${stylePrefix[style] || ''} ${prompt}. High quality, detailed, professional.`;

    // gpt-image-1: fastMode=quality:low(빠름), 일반=quality:high
    const imageQuality = req.body.fastMode ? 'low' : 'high';
    const imageReqOpts = { model: 'gpt-image-1', prompt: fullPrompt, size: sizeMap[ratio] || '1536x1024', quality: imageQuality, n: 1 };
    const image = await openai.images.generate(imageReqOpts);

    const filename = `scene_${index || Date.now()}.png`;
    const filepath = path.join(OUTPUT_DIR, 'images', filename);
    if (image.data[0].b64_json) {
      fs.writeFileSync(filepath, Buffer.from(image.data[0].b64_json, 'base64'));
    } else if (image.data[0].url) {
      const imgBuf = Buffer.from(await fetch(image.data[0].url).then(r=>r.arrayBuffer()));
      fs.writeFileSync(filepath, imgBuf);
    } else {
      throw new Error('이미지 데이터 없음 (b64_json/url 모두 없음)');
    }

    const project = getProject(projectId);
    project.imageFiles.push({ index, filename, filepath, prompt: fullPrompt });

    res.json({
      success: true,
      imageUrl: `/output/images/${filename}`,
      filename
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/images/generate-prompts', async (req, res) => {
  req.setTimeout(300000); res.setTimeout(300000);
  try {
    const { projectId, script, style, count, videoType } = req.body;
    const project = getProject(projectId);
    const vtCtx = getVideoTypeContext(videoType);

    const fullScript = script || project.script || '';
    const sceneCount = parseInt(count) || 8;

    const prompt = `다음 유튜브 영상 대본을 꼼꼼히 읽고, 대본 내용에 정확히 맞는 ${sceneCount}개 장면의 이미지 생성 프롬프트를 영어로 작성하세요.

[영상 유형]: ${vtCtx.label}
[이미지 스타일 지침]: ${vtCtx.imageHint}

대본:
${fullScript.substring(0, 8000)}

중요 규칙:
1. 대본의 [장면 N: 제목 | 이미지: 묘사] 헤더 구조를 반드시 참고하여 해당 장면의 내용을 정확히 반영하세요.
2. 대본에 언급된 구체적인 인물, 장소, 사건, 시대를 프롬프트에 포함하세요.
3. 대본 순서대로 장면을 배치하세요 (오프닝 → 본론 → 클라이맥스 → 엔딩).
4. 각 프롬프트는 50단어 이상, 배경/조명/분위기/구도를 구체적으로 묘사하세요.
5. search_keywords: Pexels 스톡 영상 검색에 최적화된 짧은 영문 키워드 2~4단어. 다음 규칙 준수:
   - 대본에서 다루는 시대·배경·장소에 정확히 부합하는 키워드 사용
   - 고대/역사 주제 → 해당 시대 관련 키워드 (예: "ancient temple ruins", "historical manuscript", "old palace courtyard", "medieval village", "silk road caravan")
   - 현대 주제 → 현대적 키워드 (예: "modern city skyline", "AI technology lab", "smartphone user")
   - 자연/과학 주제 → 구체적 자연 키워드 (예: "deep ocean underwater", "volcanic eruption", "microscope laboratory")
   - 각 장면의 핵심 소재·장소·분위기를 구체적으로 반영
   - 한국 고유명사·추상명사 금지
   - 각 장면마다 서로 다른 키워드 사용 (중복 영상 회피)
   - 절대 금지 키워드: 폭력, 무기, 범죄, 성인, 음란, 약물, 혐오 관련 단어 일체 사용 금지
6. 반드시 ${sceneCount}개를 모두 생성하세요.

스타일: ${style || 'european-animation'}
모든 이미지가 일관된 스타일을 유지하도록 프롬프트를 작성하세요.

JSON 배열 형식으로만 반환:
[{"scene":1,"name":"장면 이름 (한국어)","prompt":"영어 이미지 프롬프트","search_keywords":"english search terms"}]`;

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 6000,
      messages: [{ role: 'user', content: prompt }]
    });

    const text = message.content[0].text;
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    const prompts = jsonMatch ? JSON.parse(jsonMatch[0]) : [];

    res.json({ success: true, prompts });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ========================
// 5. TTS 생성 (ElevenLabs)
// ========================
app.post('/api/tts/generate', async (req, res) => {
  try {
    const { projectId, text, voiceId, index, stability, similarity } = req.body;

    const apiKey = process.env.ELEVENLABS_API_KEY;
    if (!apiKey) throw new Error('ElevenLabs API 키가 설정되지 않았습니다');

    const vid = voiceId || 'pNInz6obpgDQGcFmaJgB'; // default: Adam

    const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${vid}`, {
      method: 'POST',
      headers: {
        'xi-api-key': apiKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        text,
        model_id: 'eleven_multilingual_v2',
        voice_settings: {
          stability: stability || 0.5,
          similarity_boost: similarity || 0.75,
          style: 0.3,
          use_speaker_boost: true
        }
      })
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`ElevenLabs 오류: ${response.status} - ${err}`);
    }

    const audioBuffer = Buffer.from(await response.arrayBuffer());
    const filename = `narration_${index || Date.now()}.mp3`;
    const filepath = path.join(OUTPUT_DIR, 'audio', filename);
    fs.writeFileSync(filepath, audioBuffer);

    const project = getProject(projectId);
    project.audioFiles.push({ index, filename, filepath });

    res.json({
      success: true,
      audioUrl: `/output/audio/${filename}`,
      filename
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/tts/full-script', async (req, res) => {
  try {
    const { projectId, script, voiceId, stability, similarity, language } = req.body;
    const project = getProject(projectId);

    // 메타 라벨 키워드 통합 패턴
    const META_LABELS = '(?:이미지|배경|장면|효과음|음악|BGM|bgm|배경음악|자막|화면|카메라|컷|전환|샷|shot|비주얼|visual|영상|화면설명|시각효과|VFX|sfx|SFX)';
    const cleanScript = (script || project.script || '')
      .replace(/\[장면[^\]]*\]/g, '')
      .replace(/\[영상[^\]]*\]/g, '')
      .replace(/\[(?:오프닝|엔딩|인트로|아웃트로|마무리|시작|종료|끝)[^\]]*\]/gi, '')
      // markdown bold 래핑 제거 (**이미지**, __이미지__)
      .replace(new RegExp(`(?:\\*{1,2}|_{1,2})\\s*${META_LABELS}\\s*(?:\\*{1,2}|_{1,2})\\s*[:：][^\\n]*`, 'gim'), '')
      // 라인 단위 메타 라벨 (화살표/꺾쇠/대괄호 prefix 허용)
      .replace(new RegExp(`^\\s*[▶▷►▪■◆◇★☆◎●○•\\-\\*]?\\s*[<\\[\\(]?\\s*${META_LABELS}\\s*[>\\]\\)]?\\s*[:：].*$`, 'gim'), '')
      // 라인 중간 인라인 메타 라벨 (화살표 뒤)
      .replace(new RegExp(`[▶▷►▪■◆◇★☆◎●○]\\s*${META_LABELS}\\s*[:：][^\\n]*`, 'gi'), '')
      // 문장 중간에 끼어든 "이미지: ..." (문장부호 직후)
      .replace(new RegExp(`[.!?。！？]\\s*${META_LABELS}\\s*[:：][^.!?。！？\\n]*[.!?。！？]?`, 'gi'), m => m[0])
      // 나레이터 라벨
      .replace(/\*{0,2}나레이터\*{0,2}\s*\([^)]*\)\s*[:：]\s*/g, '')
      .replace(/\*{0,2}(?:나레이터|내레이터|해설|화자)\*{0,2}\s*[:：]\s*/g, '')
      // 톤/감정 지시문 (괄호/대괄호)
      .replace(/\([^)]*(?:톤|tone|하게|으로|있게|이듯|하며|차분|진지|긴장|단호|침착|격앙|흥분|밝게|어둡게|천천히|빠르게|강하게|부드럽게)[^)]*\)/gi, '')
      .replace(/\[[^\]]*(?:톤|tone|차분|진지|긴장|단호|침착|격앙|흥분)[^\]]*\]/gi, '')
      // 진행/연출 지시문 (괄호/대괄호 + 본문 단독)
      .replace(/\([^)]*(?:잠시|잠깐|짧은|긴)\s*(?:멈춤|침묵|정적|호흡|쉼|쉬다)[^)]*\)/gi, '')
      .replace(/\([^)]*(?:정적이?\s*흐른다|침묵이?\s*흐른다|한\s*박자|호흡\s*가다듬|숨\s*고르)[^)]*\)/gi, '')
      .replace(/\([^)]*(?:pause|silence|beat)[^)]*\)/gi, '')
      .replace(/\[[^\]]*(?:잠시|잠깐|짧은|긴)\s*(?:멈춤|침묵|정적|호흡|쉼)[^\]]*\]/gi, '')
      .replace(/\[[^\]]*(?:pause|silence|beat)[^\]]*\]/gi, '')
      // 본문 단독 진행 지시문 (앞뒤 공백/문장부호로 격리)
      .replace(/(?:^|[\s.,!?。！？\n])\s*(?:잠시|잠깐)\s*(?:멈춤|멈춥니다|정적|침묵|쉼|쉬어|쉬고)\.?(?=\s|$|[.,!?。！？\n])/g, ' ')
      .replace(/(?:^|[\s.,!?。！？\n])\s*(?:짧은|긴)\s*(?:정적|침묵|호흡)이?\s*(?:흐른다|흐릅니다)?\.?(?=\s|$|[.,!?。！？\n])/g, ' ')
      .replace(/(?:^|[\s.,!?。！？\n])\s*(?:한\s*박자\s*쉼|호흡\s*가다듬|숨\s*고르기|숨\s*고르고)\.?(?=\s|$|[.,!?。！？\n])/g, ' ')
      .replace(/(?:^|[\s.,!?。！？\n])\s*(?:화면\s*전환|컷\s*전환|다음\s*장면(?:으로|에서))\.?(?=\s|$|[.,!?。！？\n])/g, ' ')
      // 메타 정보
      .replace(/^.*총\s*글자\s*수\s*[:：].*$/gm, '')
      .replace(/^.*총\s*분량\s*[:：].*$/gm, '')
      .replace(/^.*예상\s*시간\s*[:：].*$/gm, '')
      // 구분선/마크다운
      .replace(/^---+$/gm, '')
      .replace(/^===+$/gm, '')
      .replace(/^#+\s.*$/gm, '')
      .replace(/^[-*]\s/gm, '')
      .replace(/\*{2,}/g, '')
      .replace(/[━═─■●•🎙️🎬📌🔹✅☐▶▷►🎵🎶⚡⏩]/g, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim();

    // 언어별 외국어 문자 제거 (한국어 선택 시 중국어/일본어 줄 제거)
    const ttsLang = language || null;
    const cleanScriptFiltered = ttsLang ? stripForeignLines(cleanScript, ttsLang) : cleanScript;

    const apiKey = process.env.ELEVENLABS_API_KEY;
    const vid = voiceId || 'pNInz6obpgDQGcFmaJgB';
    const voiceSettings = {
      stability: (stability != null && stability !== '') ? Number(stability) : 0.5,
      similarity_boost: (similarity != null && similarity !== '') ? Number(similarity) : 0.75,
      style: 0.3,
      use_speaker_boost: true
    };

    const CHUNK_LIMIT = 4900;

    function sanitizeTTSText(t) {
      return (t||'').replace(/[\uD800-\uDFFF]/g, () => '').replace(/�/g,'');
    }

    async function generateTTSChunk(text, prevText, nextText) {
      const payload = { text: sanitizeTTSText(text), model_id: 'eleven_multilingual_v2', voice_settings: voiceSettings };
      if (prevText) payload.previous_text = sanitizeTTSText(prevText).slice(-1000);
      if (nextText) payload.next_text = sanitizeTTSText(nextText).slice(0, 1000);
      const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${vid}`, {
        method: 'POST',
        headers: { 'xi-api-key': apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (!response.ok) {
        const err = await response.text();
        if (response.status === 401 || /quota|credit/i.test(err)) {
          throw new Error(`ElevenLabs 크레딧 부족: ${err}. 충전: https://elevenlabs.io/app/subscription`);
        }
        throw new Error(`ElevenLabs 오류: ${response.status} - ${err}`);
      }
      // Content-Type 검증 — audio가 아니면 에러 JSON일 가능성
      const ct = response.headers.get('content-type') || '';
      if (!ct.includes('audio') && !ct.includes('mpeg') && !ct.includes('octet')) {
        const body = await response.text();
        throw new Error(`ElevenLabs 비정상 응답 (content-type=${ct}): ${body.substring(0, 300)}`);
      }
      const buf = Buffer.from(await response.arrayBuffer());
      // mp3 헤더 검증: 첫 바이트가 0xFF 또는 'ID3'
      if (buf.length < 1024) {
        throw new Error(`ElevenLabs 응답 너무 작음 (${buf.length}바이트) — 손상된 audio. 본문: ${buf.toString('utf8').substring(0, 200)}`);
      }
      const hdr = buf.slice(0, 3);
      const isMP3 = (hdr[0] === 0xFF && (hdr[1] & 0xE0) === 0xE0) || (hdr.toString('ascii') === 'ID3');
      if (!isMP3) {
        throw new Error(`ElevenLabs 응답이 mp3가 아님 (헤더: ${hdr.toString('hex')}). 본문 일부: ${buf.toString('utf8').substring(0, 200)}`);
      }
      return buf;
    }

    // with-timestamps: 각 글자별 실제 시작/끝 시각 받아 SRT 정확도 향상
    async function generateTTSChunkWithTimestamps(text, prevText, nextText) {
      const payload = { text: sanitizeTTSText(text), model_id: 'eleven_multilingual_v2', voice_settings: voiceSettings };
      if (prevText) payload.previous_text = sanitizeTTSText(prevText).slice(-1000);
      if (nextText) payload.next_text = sanitizeTTSText(nextText).slice(0, 1000);
      const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${vid}/with-timestamps`, {
        method: 'POST',
        headers: { 'xi-api-key': apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (!response.ok) {
        const err = await response.text();
        // quota 부족 or 권한 부족 시 일반 TTS로 fallback
        if (response.status === 401 || response.status === 402 || /quota|credit/i.test(err)) {
          console.warn(`[TTS] with-timestamps 실패 (${response.status}), 일반 TTS로 fallback`);
          const audio = await generateTTSChunk(text, prevText, nextText);
          return { audio, alignment: null, fallback: true };
        }
        throw new Error(`ElevenLabs with-timestamps 오류: ${response.status} - ${err}`);
      }
      const data = await response.json();
      if (!data.audio_base64) {
        throw new Error(`ElevenLabs with-timestamps 응답에 audio_base64 없음: ${JSON.stringify(data).substring(0, 300)}`);
      }
      const audio = Buffer.from(data.audio_base64, 'base64');
      // mp3 헤더 검증
      if (audio.length < 1024) {
        throw new Error(`ElevenLabs with-timestamps audio 너무 작음 (${audio.length}바이트)`);
      }
      const hdr = audio.slice(0, 3);
      const isMP3 = (hdr[0] === 0xFF && (hdr[1] & 0xE0) === 0xE0) || (hdr.toString('ascii') === 'ID3');
      if (!isMP3) {
        throw new Error(`ElevenLabs with-timestamps audio가 mp3 아님 (헤더: ${hdr.toString('hex')})`);
      }
      const alignment = data.alignment || data.normalized_alignment || null;
      return { audio, alignment };
    }

    function splitTextIntoChunks(text, limit) {
      if (text.length <= limit) return [text];
      const chunks = [];
      let remaining = text;
      while (remaining.length > 0) {
        if (remaining.length <= limit) { chunks.push(remaining); break; }
        let splitIdx = remaining.lastIndexOf('. ', limit);
        if (splitIdx < limit * 0.3) splitIdx = remaining.lastIndexOf('。', limit);
        if (splitIdx < limit * 0.3) splitIdx = remaining.lastIndexOf('\n', limit);
        if (splitIdx < limit * 0.3) splitIdx = remaining.lastIndexOf(' ', limit);
        if (splitIdx < limit * 0.3) splitIdx = limit;
        chunks.push(remaining.substring(0, splitIdx + 1).trim());
        remaining = remaining.substring(splitIdx + 1).trim();
      }
      return chunks.filter(c => c.length > 0);
    }

    const chunks = splitTextIntoChunks(cleanScriptFiltered, CHUNK_LIMIT);
    const timestamp = Date.now();

    // === 정규화 헬퍼: -16 LUFS (YouTube 권장) + 압축 ===
    // narration 약함 → loudnorm으로 -16 LUFS 정규화 + dynaudnorm으로 작은 부분 ↑ + 큰 부분 ↓
    async function normalizeAudio(srcPath, dstPath) {
      return new Promise((resolve, reject) => {
        execFile('ffmpeg', [
          '-i', srcPath,
          '-af', 'loudnorm=I=-16:TP=-1.5:LRA=11',
          '-c:a', 'libmp3lame', '-b:a', '192k', '-ar', '44100',
          '-y', dstPath
        ], { timeout: 120000, maxBuffer: 50 * 1024 * 1024 }, (error, stdout, stderr) => {
          if (error) reject(new Error(`normalize 오류: ${error.message}\n${stderr.substring(0, 500)}`));
          else resolve();
        });
      });
    }

    // 글자별 정확한 timing 누적 (with-timestamps API 결과)
    const globalAlignment = { characters: [], starts: [], ends: [] };
    let cumulativeOffset = 0;

    if (chunks.length === 1) {
      const { audio, alignment } = await generateTTSChunkWithTimestamps(chunks[0], null, null);
      const filename = `full_narration_${timestamp}.mp3`;
      const filepath = path.join(OUTPUT_DIR, 'audio', filename);
      // raw audio 임시 저장
      const rawPath = path.join(OUTPUT_DIR, 'audio', `raw_${timestamp}.mp3`);
      fs.writeFileSync(rawPath, audio);
      // 정규화 → 최종 파일
      console.log('[TTS] 단일 청크 → 정규화 (-16 LUFS) 적용');
      try {
        await normalizeAudio(rawPath, filepath);
        try { fs.unlinkSync(rawPath); } catch(e) {}
      } catch(e) {
        console.warn('[TTS] 정규화 실패, raw 사용:', e.message);
        fs.renameSync(rawPath, filepath);
      }
      if (alignment && alignment.characters) {
        globalAlignment.characters = alignment.characters;
        globalAlignment.starts = alignment.character_start_times_seconds || [];
        globalAlignment.ends = alignment.character_end_times_seconds || [];
      }
      project.audioFiles = [{ index: 0, filename, filepath, full: true }];
      project.ttsAlignment = globalAlignment.characters.length > 0 ? globalAlignment : null;
      return res.json({ success: true, audioUrl: `/output/audio/${filename}`, filename, charCount: cleanScriptFiltered.length, chunks: 1, hasTimestamps: !!project.ttsAlignment, normalized: true });
    }

    const chunkFiles = [];
    for (let i = 0; i < chunks.length; i++) {
      const prevText = i > 0 ? chunks[i - 1] : null;
      const nextText = i < chunks.length - 1 ? chunks[i + 1] : null;
      const { audio, alignment } = await generateTTSChunkWithTimestamps(chunks[i], prevText, nextText);
      const chunkFile = `chunk_${timestamp}_${i}.mp3`;
      fs.writeFileSync(path.join(OUTPUT_DIR, 'audio', chunkFile), audio);
      chunkFiles.push(chunkFile);

      // alignment 누적: 청크별 시작 offset 적용
      if (alignment && alignment.characters) {
        const chars = alignment.characters || [];
        const starts = alignment.character_start_times_seconds || [];
        const ends = alignment.character_end_times_seconds || [];
        for (let j = 0; j < chars.length; j++) {
          globalAlignment.characters.push(chars[j]);
          globalAlignment.starts.push(starts[j] + cumulativeOffset);
          globalAlignment.ends.push(ends[j] + cumulativeOffset);
        }
        // 청크 끝 시간 = 마지막 글자 종료 + 약간 buffer (concat 시 이어 붙음)
        cumulativeOffset += ends[ends.length - 1] || 0;
      }

      if (i < chunks.length - 1) await new Promise(r => setTimeout(r, 500));
    }
    console.log(`[TTS] 누적 alignment ${globalAlignment.characters.length}자, 총 ${cumulativeOffset.toFixed(2)}초`);

    const concatList = chunkFiles.map(f => `file '${path.join(OUTPUT_DIR, 'audio', f).replace(/\\/g, '/')}'`).join('\n');
    const concatFile = path.join(OUTPUT_DIR, 'audio', `concat_${timestamp}.txt`);
    fs.writeFileSync(concatFile, concatList);

    const filename = `full_narration_${timestamp}.mp3`;
    const outputPath = path.join(OUTPUT_DIR, 'audio', filename);

    // 청크 결합 — acrossfade로 청크 경계 click/pop 노이즈 완전 제거
    // 수정 이력:
    //   - 버그 1 (해결): afade=t=out:st=0 → 청크 처음 5ms 페이드아웃 클릭 노이즈
    //   - 버그 2 (해결): 250ms silence 패딩 → SRT 누적 드리프트
    //   - 버그 3 (현재 수정): concat filter 단순 이어붙임 → 청크 경계 sample 불연속 click
    //   - 신규 해결: acrossfade 80ms crossfade로 청크 경계 자연스럽게 mix
    //              · ElevenLabs MP3는 sentence 경계 cut 후 80ms 무음에 가까움 → mix 자연스러움
    //              · sample-level 불연속 제거 → click 완전 차단
    //              · libmp3lame 192k → 320k 상향 (음성 narration 품질 안전 마진)
    const inputArgs = [];
    chunkFiles.forEach(f => { inputArgs.push('-i', path.join(OUTPUT_DIR, 'audio', f)); });

    const filterParts = [];
    const N = chunkFiles.length;
    // 1) aformat으로 샘플레이트/채널/포맷 통일 (재인코딩 도메인 동일화)
    chunkFiles.forEach((_, i) => {
      filterParts.push(`[${i}:a]aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo[a${i}]`);
    });
    // 2) 순차적 acrossfade — 청크 N개를 (N-1)번 crossfade
    let mixOut;
    if (N === 1) {
      filterParts.push(`[a0]anull[mixed]`);
      mixOut = 'mixed';
    } else {
      let prev = 'a0';
      for (let i = 1; i < N; i++) {
        const out = (i === N - 1) ? 'mixed' : `mix${i}`;
        filterParts.push(`[${prev}][a${i}]acrossfade=d=0.08:c1=tri:c2=tri[${out}]`);
        prev = out;
      }
      mixOut = 'mixed';
    }
    // 3) 정규화 — loudnorm -16 LUFS + dynaudnorm 압축 (YouTube 권장 라우드니스)
    filterParts.push(`[${mixOut}]loudnorm=I=-16:TP=-1.5:LRA=11[out]`);
    const filterComplex = filterParts.join(';');

    await new Promise((resolve, reject) => {
      execFile('ffmpeg', [
        ...inputArgs,
        '-filter_complex', filterComplex,
        '-map', '[out]',
        '-c:a', 'libmp3lame', '-b:a', '320k', '-ar', '44100',
        '-y', outputPath
      ], { timeout: 180000, maxBuffer: 50 * 1024 * 1024 }, (error, stdout, stderr) => {
        if (error) {
          // Fallback: concat demuxer + re-encode (필터 실패 시)
          console.error('[TTS acrossfade 실패, concat fallback]', error.message);
          execFile('ffmpeg', [
            '-f', 'concat', '-safe', '0', '-i', concatFile,
            '-c:a', 'libmp3lame', '-b:a', '320k', '-ar', '44100',
            '-y', outputPath
          ], { timeout: 120000, maxBuffer: 50 * 1024 * 1024 }, (e2) => { if (e2) reject(e2); else resolve(); });
        } else resolve();
      });
    });

    chunkFiles.forEach(f => { try { fs.unlinkSync(path.join(OUTPUT_DIR, 'audio', f)); } catch(e) {} });
    try { fs.unlinkSync(concatFile); } catch(e) {}

    project.audioFiles = [{ index: 0, filename, filepath: outputPath, full: true }];
    project.ttsAlignment = globalAlignment.characters.length > 0 ? globalAlignment : null;

    res.json({
      success: true, audioUrl: `/output/audio/${filename}`, filename,
      charCount: cleanScriptFiltered.length, chunks: chunks.length,
      hasTimestamps: !!project.ttsAlignment
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/tts/voices', async (req, res) => {
  try {
    const apiKey = process.env.ELEVENLABS_API_KEY;
    const response = await fetch('https://api.elevenlabs.io/v1/voices', {
      headers: { 'xi-api-key': apiKey }
    });
    const data = await response.json();
    const voices = data.voices.map(v => ({
      id: v.voice_id,
      name: v.name,
      category: v.category,
      labels: v.labels,
      previewUrl: v.preview_url || null
    }));
    res.json({ success: true, voices });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/tts/sample', async (req, res) => {
  try {
    const apiKey = process.env.ELEVENLABS_API_KEY;
    const { voiceId, text } = req.body;
    if (!text || !voiceId) throw new Error('voiceId와 text 필요');
    const sampleText = text.slice(0, 200);
    const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
      method: 'POST',
      headers: { 'xi-api-key': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: sampleText,
        model_id: 'eleven_multilingual_v2',
        voice_settings: { stability: 0.5, similarity_boost: 0.75 }
      })
    });
    if (!response.ok) throw new Error(`ElevenLabs: ${response.status}`);
    const audioBuffer = Buffer.from(await response.arrayBuffer());
    res.set({ 'Content-Type': 'audio/mpeg', 'Content-Length': audioBuffer.length });
    res.send(audioBuffer);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ========================
// 5-1. SRT 자막 생성
// ========================
// ========================
// 숏폼 대본 요약
// ========================
app.post('/api/shorts/summarize', async (req, res) => {
  req.setTimeout(300000); res.setTimeout(300000);
  try {
    checkAnthropic();
    const { script, topic, language } = req.body;
    if (!script) throw new Error('대본이 없습니다');

    const langName = { ko: '한국어', en: '영어', zh: '중국어', ja: '일본어', es: '스페인어' }[language] || '한국어';

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 2000,
      messages: [{ role: 'user', content: `다음 롱폼 대본에서 가장 흥미롭고 충격적인 내용을 2분 분량(~500자)으로 요약하세요.

원본 대본:
${script.substring(0, 6000)}

규칙:
- 출력 언어: ${langName}
- 첫 5초에 강력한 후킹 (질문/충격적 사실)
- 핵심 내용 3~4가지만 선택
- 마지막에 "전체 영상은 채널에서 확인하세요!" CTA
- 빠른 템포, 짧은 문장
- [장면 1: 제목 | 이미지: 묘사] 형식으로 장면 구분 (5~6개 장면)
- 500자 내외 엄수
- 톤/감정 지시문 금지 (TTS가 읽음)

나레이션 대본만 출력하세요.` }]
    });

    const shortsScript = message.content[0].text;
    res.json({ success: true, script: shortsScript, charCount: shortsScript.length });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/srt/generate', async (req, res) => {
  try {
    const { projectId, script, duration, language, ratio } = req.body;
    const project = getProject(projectId);
    const text = script || project.script || '';
    if (!text) throw new Error('대본이 없습니다');

    // 오디오 mtime 최신 파일 선택 후 길이 측정
    let audioDuration = 0;
    const audioFiles = fs.existsSync(path.join(OUTPUT_DIR, 'audio'))
      ? fs.readdirSync(path.join(OUTPUT_DIR, 'audio'))
          .filter(f => f.endsWith('.mp3'))
          .map(f => ({ f, m: fs.statSync(path.join(OUTPUT_DIR, 'audio', f)).mtimeMs }))
          .sort((a, b) => b.m - a.m)
          .map(o => o.f)
      : [];
    const audioFile = audioFiles.find(f => f.startsWith('full_')) || audioFiles[0];
    if (audioFile) {
      audioDuration = await probeDuration(path.join(OUTPUT_DIR, 'audio', audioFile));
    }

    const totalDur = audioDuration > 0 ? audioDuration : (duration || 120);
    const lang = language || 'ko';
    const srtSubMaxLen = ratio === '9:16' ? 18 : 33;
    let srtContent = scriptToSrt(text, totalDur, 0, project.ttsAlignment, lang, srtSubMaxLen);

    // 외국어(한국어 아님) → 한국어 번역 추가하여 이중 자막
    if (lang !== 'ko' && anthropic) {
      console.log(`[SRT] 이중 자막 생성: ${lang} + 한국어 번역`);
      const srtBlocks = srtContent.trim().split(/\n\n+/).filter(Boolean);
      const origLines = srtBlocks.map(block => {
        const lines = block.split('\n');
        return { idx: lines[0], time: lines[1], text: lines.slice(2).join(' ') };
      });

      // Claude로 일괄 번역 (원문 → 한국어)
      const textsToTranslate = origLines.map((l, i) => `[${i}] ${l.text}`).join('\n');
      const langNames = { en: '영어', zh: '중국어', ja: '일본어', es: '스페인어', fr: '프랑스어', de: '독일어' };
      const langName = langNames[lang] || lang;

      try {
        const transMsg = await anthropic.messages.create({
          model: 'claude-sonnet-4-6',
          max_tokens: 8000,
          messages: [{ role: 'user', content: `다음 ${langName} 자막을 한국어로 번역하세요.
각 줄의 [번호]를 유지하고, 번역만 작성하세요. 자연스러운 한국어로 번역하세요.
다른 설명 없이 번역 결과만 출력하세요.

${textsToTranslate}` }]
        });

        const transText = transMsg.content[0].text;
        const transMap = {};
        const transLines = transText.split('\n').filter(l => l.trim());
        for (const line of transLines) {
          const match = line.match(/^\[(\d+)\]\s*(.+)$/);
          if (match) transMap[parseInt(match[1])] = match[2].trim();
        }

        // 이중 자막 SRT 재구성: 원문 위, 한국어 아래
        let bilingualSrt = '';
        origLines.forEach((l, i) => {
          const koText = transMap[i] || '';
          bilingualSrt += `${l.idx}\n${l.time}\n${l.text}\n${koText}\n\n`;
        });
        srtContent = bilingualSrt;
        console.log(`[SRT] 이중 자막 완료: ${origLines.length}개 항목`);
      } catch (e) {
        console.warn('[SRT] 번역 실패, 원문 자막만 사용:', e.message);
      }
    }

    const filename = `subtitles_${Date.now()}.srt`;
    fs.writeFileSync(path.join(OUTPUT_DIR, 'srt', filename), srtContent, 'utf-8');

    res.json({
      success: true,
      srtUrl: `/output/srt/${filename}`,
      filename,
      subtitleCount: srtContent.split('\n\n').filter(Boolean).length,
      preview: srtContent.substring(0, 800),
      audioDuration: totalDur,
      bilingual: lang !== 'ko'
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.use('/output/srt', express.static(path.join(OUTPUT_DIR, 'srt')));
app.use('/output/clips', express.static(path.join(OUTPUT_DIR, 'clips')));

// ========================
// 6. 영상 클립 생성 (Pexels 스톡 영상)
// ========================
// Pexels API로 장면별 키워드 영상 검색 후 다운로드
app.post('/api/clips/generate', async (req, res) => {
  try {
    const apiKey = process.env.PEXELS_API_KEY;
    if (!apiKey) throw new Error('PEXELS_API_KEY가 설정되지 않았습니다. .env 파일에 추가하세요. (무료 발급: https://www.pexels.com/api/)');

    const { projectId, scenePrompts, perSceneDuration, ratio } = req.body;
    const pexelsOrientation = ratio === '9:16' ? 'portrait' : 'landscape';
    const project = getProject(projectId);
    const prompts = scenePrompts || project.scenePrompts || [];
    if (!prompts.length) throw new Error('장면 프롬프트가 없습니다. 먼저 프롬프트를 생성하세요.');

    // 기존 clip 파일 정리
    fs.readdirSync(path.join(OUTPUT_DIR, 'clips'))
      .filter(f => f.startsWith('clip_') && f.endsWith('.mp4'))
      .forEach(f => { try { fs.unlinkSync(path.join(OUTPUT_DIR, 'clips', f)); } catch(e) {} });

    const targetDur = perSceneDuration || 10;
    const clips = [];

    // 사용된 video id 추적 — 프로젝트 단위 (재호출 시도에도 중복 방지)
    const usedVideoIds = new Set(project.usedClipVideoIds || []);
    const MODERN_MODIFIERS = ['modern', 'contemporary', '2024', 'urban', 'cinematic', 'professional', 'lifestyle', 'business'];
    const FALLBACK_GENERIC = ['city street', 'nature landscape', 'people working', 'abstract pattern', 'sky timelapse', 'ocean waves', 'forest sunlight', 'urban night'];

    // Pexels 검색 + 사용 안 된 결과 반환 헬퍼
    async function searchAvailable(query) {
      const url = `https://api.pexels.com/videos/search?query=${encodeURIComponent(query)}&per_page=15&orientation=${pexelsOrientation}&safe_search=true`;
      const r = await fetch(url, { headers: { Authorization: apiKey } });
      if (!r.ok) return [];
      const data = await r.json();
      return (data.videos || []).filter(v => !usedVideoIds.has(v.id));
    }

    for (let i = 0; i < prompts.length; i++) {
      const p = prompts[i];
      let baseQuery;
      if (p.search_keywords && typeof p.search_keywords === 'string') {
        baseQuery = p.search_keywords.trim().substring(0, 50);
      } else {
        const englishWords = (p.prompt || '').match(/[a-zA-Z]+/g) || [];
        baseQuery = englishWords.slice(0, 4).join(' ').substring(0, 50);
        if (!baseQuery) baseQuery = (p.name || 'nature landscape').replace(/[^a-zA-Z\s]/g, ' ').trim();
      }

      let video = null;
      const triedQueries = [];

      // 1차: baseQuery + index-based modifier
      const primaryQuery = `${baseQuery} ${MODERN_MODIFIERS[i % MODERN_MODIFIERS.length]}`.substring(0, 70);
      triedQueries.push(primaryQuery);
      console.log(`[Pexels] 장면 ${i+1} 검색: "${primaryQuery}"`);
      let videos = await searchAvailable(primaryQuery);

      // 2차: 모든 modifier 순회 (8개)
      if (!videos.length) {
        for (let m = 0; m < MODERN_MODIFIERS.length && !videos.length; m++) {
          if (m === (i % MODERN_MODIFIERS.length)) continue; // primary 중복 스킵
          const altQuery = `${baseQuery} ${MODERN_MODIFIERS[m]}`.substring(0, 70);
          triedQueries.push(altQuery);
          videos = await searchAvailable(altQuery);
          if (videos.length) console.log(`[Pexels] 장면 ${i+1} ${m+1}차 시도 성공: "${altQuery}"`);
        }
      }

      // 3차: baseQuery만 (modifier 없이)
      if (!videos.length) {
        triedQueries.push(baseQuery);
        videos = await searchAvailable(baseQuery);
      }

      // 4차: 일반 키워드 fallback (장면 index별 다른 키워드)
      if (!videos.length) {
        const generic = FALLBACK_GENERIC[i % FALLBACK_GENERIC.length];
        triedQueries.push(generic);
        console.log(`[Pexels] 장면 ${i+1} generic fallback: "${generic}"`);
        videos = await searchAvailable(generic);
      }

      if (!videos.length) {
        clips.push({ index: i + 1, error: 'no unique result after all fallbacks', triedQueries });
        continue;
      }

      try {
        video = videos[0];
        usedVideoIds.add(video.id);
        const files = video.video_files || [];
        const hd = files.find(f => f.width >= 1280 && f.width <= 1920 && f.file_type === 'video/mp4')
                || files.find(f => f.file_type === 'video/mp4')
                || files[0];
        if (!hd?.link) {
          clips.push({ index: i + 1, error: 'no mp4 file', videoId: video.id });
          continue;
        }
        const vRes = await fetch(hd.link);
        if (!vRes.ok) throw new Error(`Download ${vRes.status}`);
        const buffer = Buffer.from(await vRes.arrayBuffer());
        const sceneNum = String(i + 1).padStart(2, '0');
        const filename = `clip_${sceneNum}.mp4`;
        const filepath = path.join(OUTPUT_DIR, 'clips', filename);
        fs.writeFileSync(filepath, buffer);
        clips.push({
          index: i + 1,
          filename,
          url: `/output/clips/${filename}`,
          size: `${(buffer.length / 1024 / 1024).toFixed(1)}MB`,
          query: triedQueries[triedQueries.length - 1],
          videoId: video.id,
          source: 'pexels',
          author: video.user?.name || 'Unknown',
          authorUrl: video.user?.url || ''
        });
        // Rate limit 보호
        await new Promise(r => setTimeout(r, 800));
      } catch(e) {
        clips.push({ index: i + 1, error: e.message, triedQueries });
      }
    }

    // 프로젝트에 사용된 video id 저장 (재호출 시 누적 추적)
    project.usedClipVideoIds = Array.from(usedVideoIds);
    project.clipFiles = clips.filter(c => c.filename);

    // 검증: 모든 clip이 unique한지 (videoId 중복 체크)
    const uniqueCheck = new Set(clips.filter(c => c.videoId).map(c => c.videoId));
    const allUnique = uniqueCheck.size === clips.filter(c => c.videoId).length;

    res.json({ success: true, clips, allUnique, totalUsedIds: usedVideoIds.size });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 클립 목록 조회
app.get('/api/clips/list', (req, res) => {
  const dir = path.join(OUTPUT_DIR, 'clips');
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.mp4')).sort().map(f => ({
    name: f, url: `/output/clips/${f}`,
    size: `${(fs.statSync(path.join(dir, f)).size / 1024 / 1024).toFixed(1)}MB`
  }));
  res.json({ success: true, files });
});
app.use('/output/bgm', express.static(path.join(OUTPUT_DIR, 'bgm')));

// ========================
// 6. 영상 렌더링 (FFmpeg)
// ========================
// 헬퍼: 디렉토리에서 최신 파일 mtime 기준 정렬
function listFilesByMtime(dir, filterFn) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(filterFn)
    .map(f => ({ name: f, mtime: fs.statSync(path.join(dir, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime)
    .map(o => o.name);
}

// 헬퍼: FFmpeg로 미디어 길이 측정
async function probeDuration(filePath) {
  return new Promise((resolve) => {
    execFile('ffmpeg', ['-i', filePath, '-hide_banner'], { timeout: 10000, maxBuffer: 50 * 1024 * 1024 }, (error, stdout, stderr) => {
      const match = (stderr || '').match(/Duration:\s*(\d+):(\d+):(\d+)\.(\d+)/);
      if (match) resolve(parseInt(match[1])*3600 + parseInt(match[2])*60 + parseInt(match[3]) + parseInt(match[4])/100);
      else resolve(0);
    });
  });
}

// 헬퍼: SRT 시간 형식
function formatSrtTime(sec) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  const ms = Math.round((sec % 1) * 1000);
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')},${String(ms).padStart(3,'0')}`;
}

// 헬퍼: 스크립트 → SRT 변환 (오디오 길이 기반 + 오프셋)
// 메타 라벨 제거 (이미지:, 배경:, 효과음: 등) — 강화 통합 패턴
const META_LABEL_KW = '(?:이미지|배경|장면|효과음|음악|BGM|bgm|배경음악|자막|화면|카메라|컷|전환|샷|shot|비주얼|visual|영상|화면설명|시각효과|VFX|sfx|SFX)';
function stripMetaLabels(text) {
  return text
    // bold/underscore 래핑
    .replace(new RegExp(`(?:\\*{1,2}|_{1,2})\\s*${META_LABEL_KW}\\s*(?:\\*{1,2}|_{1,2})\\s*[:：][^\\n]*`, 'gim'), '')
    // 라인 단위 (prefix 화살표/꺾쇠/대괄호 등 허용)
    .replace(new RegExp(`^\\s*[▶▷►▪■◆◇★☆◎●○•\\-\\*]?\\s*[<\\[\\(]?\\s*${META_LABEL_KW}\\s*[>\\]\\)]?\\s*[:：].*$`, 'gim'), '')
    // 인라인 (화살표 뒤)
    .replace(new RegExp(`[▶▷►▪■◆◇★☆◎●○]\\s*${META_LABEL_KW}\\s*[:：][^\\n]*`, 'gi'), '')
    // 나레이터 라벨
    .replace(/\*{0,2}(?:나레이터|내레이터|해설|화자)\*{0,2}\s*\([^)]*\)\s*[:：]\s*/g, '')
    .replace(/\*{0,2}(?:나레이터|내레이터|해설|화자)\*{0,2}\s*[:：]\s*/g, '');
}

// 언어별 외국어 문자 필터: 해당 언어가 아닌 문자가 과반인 줄 제거
function stripForeignLines(text, lang) {
  if (!lang || lang === 'auto') return text;
  return text.split('\n').filter(line => {
    const t = line.replace(/[\s\d.,!?。！？，、:：;；""''「」『』()（）\[\]—\-·…~]/g, '');
    if (t.length < 2) return true;
    if (lang === 'ko') {
      // 한국어: CJK 통합 한자(U+4E00-9FFF) + 일본어 가나가 과반이면 제거
      const foreign = (t.match(/[一-鿿぀-ゟ゠-ヿ]/g) || []).length;
      return foreign / t.length < 0.5;
    }
    return true;
  }).join('\n');
}

// 긴 문장을 자연스러운 단위(30~35자)로 분할
function splitForSubtitle(sentence, maxLen = 33) {
  const t = sentence.trim();
  if (t.length <= maxLen) return [t];
  const parts = [];
  let remaining = t;
  while (remaining.length > maxLen) {
    // 우선순위: 쉼표/조사 → 공백 → 강제 컷
    let cut = -1;
    const ideal = Math.min(maxLen, remaining.length);
    const minIdx = Math.floor(maxLen * 0.6);
    // 쉼표/마침표/콜론 우선
    for (let i = ideal; i >= minIdx; i--) {
      if (/[,，、:：;；]/.test(remaining[i])) { cut = i + 1; break; }
    }
    // 한국어 조사/어미 뒤 띄어쓰기
    if (cut < 0) {
      for (let i = ideal; i >= minIdx; i--) {
        if (remaining[i] === ' ') { cut = i; break; }
      }
    }
    if (cut < 0) cut = ideal;
    parts.push(remaining.substring(0, cut).trim());
    remaining = remaining.substring(cut).trim();
  }
  if (remaining) parts.push(remaining);
  return parts.filter(p => p.length > 0);
}

// alignment 기반 SRT (정확): TTS 글자별 실제 timing 사용
// fallback: 글자 비례 분배 (alignment 없을 때)
function scriptToSrt(scriptText, audioDur, offset = 0, alignment = null, lang = null, maxSubLen = 33) {
  let cleaned = stripMetaLabels(scriptText);
  if (lang) cleaned = stripForeignLines(cleaned, lang);

  // 자막 단위 추출 (30~35자 청크)
  const subtitleChunks = [];
  const sceneRegex = /\[장면\s*(\d+)[^\]]*\]([\s\S]*?)(?=\[장면|\s*$)/g;
  const scenes = [];
  let m;
  while ((m = sceneRegex.exec(cleaned)) !== null) {
    const c = m[2].replace(/[━═─▶■●•🎙️🎬📌🔹✅☐]/g, '').replace(/\(.*?\)/g, '').replace(/\n{2,}/g, '\n').trim();
    if (c) scenes.push(c);
  }
  if (scenes.length === 0) {
    const ps = cleaned.replace(/\[.*?\]/g, '').replace(/[━═─▶■●•🎙️🎬📌🔹✅☐]/g, '').replace(/\(.*?\)/g, '')
      .split(/\n{2,}/).map(p => p.trim()).filter(p => p.length > 10);
    scenes.push(...ps);
  }

  scenes.forEach((scene) => {
    const sentences = scene.match(/[^.!?。！？\n]+[.!?。！？]?/g) || [scene];
    sentences.forEach((sent) => {
      const t = sent.trim();
      if (!t || t.length < 3) return;
      const chunks = splitForSubtitle(t, maxSubLen);
      chunks.forEach(c => subtitleChunks.push(c));
    });
  });

  let srt = '';

  // === alignment 기반 정확 매칭 + 연속 표시 보장 ===
  if (alignment && alignment.characters && alignment.characters.length > 0) {
    const alignChars = alignment.characters;
    const alignStarts = alignment.starts;
    const alignEnds = alignment.ends;
    const alignText = alignChars.join('');

    // 1단계: 모든 chunk의 startTime/endTime 수집
    const entries = [];
    let alignPos = 0;
    for (const chunk of subtitleChunks) {
      const target = chunk.replace(/\s+/g, '').replace(/[.,!?。！？，、:：;；]/g, '');
      if (target.length === 0) continue;

      let realStartIdx = -1;
      let realEndIdx = -1;
      let matchedCount = 0;

      for (let i = alignPos; i < alignText.length && matchedCount < target.length; i++) {
        const ch = alignText[i];
        if (/[\s.,!?。！？，、:：;；]/.test(ch)) continue;
        if (ch === target[matchedCount]) {
          if (matchedCount === 0) realStartIdx = i;
          realEndIdx = i;
          matchedCount++;
        } else if (matchedCount > 0) {
          matchedCount = 0;
          realStartIdx = -1;
        }
      }

      if (realStartIdx >= 0 && realEndIdx >= 0 && realEndIdx < alignStarts.length) {
        entries.push({
          chunk,
          start: alignStarts[realStartIdx] + offset,
          end: alignEnds[realEndIdx] + offset
        });
        alignPos = realEndIdx + 1;
      } else {
        console.warn(`[SRT] alignment 매칭 실패: "${chunk.substring(0, 20)}..."`);
      }
    }

    if (entries.length > 0) {
      // 2단계: 각 자막의 endTime을 다음 자막 startTime까지 연장 (gap 제거)
      let idx = 1;
      for (let i = 0; i < entries.length; i++) {
        const e = entries[i];
        const next = entries[i + 1];
        // 다음 자막 시작까지 표시 (마지막은 audioDur + offset까지)
        let endTime = next ? next.start : (audioDur + offset);
        // 최소 1초 보장
        if (endTime - e.start < 1.0) endTime = e.start + 1.0;
        srt += `${idx}\n${formatSrtTime(e.start)} --> ${formatSrtTime(endTime)}\n${e.chunk}\n\n`;
        idx++;
      }
      return srt;
    }
    console.warn('[SRT] alignment 매칭 결과 없음, fallback');
  }

  // === Fallback: 글자 비례 분배 (gap 없는 연속) ===
  const totalChars = subtitleChunks.reduce((a, c) => a + c.length, 0) || 1;
  let cur = offset;
  let idx = 1;
  subtitleChunks.forEach((chunk, i) => {
    const isLast = i === subtitleChunks.length - 1;
    const dur = Math.max(1.0, (chunk.length / totalChars) * audioDur);
    const endTime = isLast ? (offset + audioDur) : (cur + dur);
    srt += `${idx}\n${formatSrtTime(cur)} --> ${formatSrtTime(endTime)}\n${chunk}\n\n`;
    cur = endTime;
    idx++;
  });
  return srt;
}

app.post('/api/render/video', async (req, res) => {
  // Railway 프록시 타임아웃 방지: 30초마다 진행 표시 전송
  req.setTimeout(1200000); // 20분
  res.setTimeout(1200000);
  try {
    const { projectId, duration, bgmFile, bgmVolume, transition, transitionDuration, burnSrt, showThumb, showIntro, kenburns, sourceMode, language, ratio } = req.body;
    const isVertical = ratio === '9:16';
    const outW = isVertical ? 1080 : 1920;
    const outH = isVertical ? 1920 : 1080;
    const project = getProject(projectId);

    // 소스 모드: 'image' (기본) / 'video' (Pexels) / 'runway' (Runway AI 영상) / 'falai' (fal.ai Wan2.1)
    const useVideo = sourceMode === 'video' || sourceMode === 'runway' || sourceMode === 'falai';
    const sourceDir = useVideo ? 'clips' : 'images';
    const sourcePrefix = sourceMode === 'runway' ? 'runway_' : sourceMode === 'falai' ? 'falai_' : (useVideo ? 'clip_' : 'scene_');
    const sourceExt = useVideo ? '.mp4' : '.png';

    // 이미지/영상 클립: 파일명 순서대로
    const images = fs.readdirSync(path.join(OUTPUT_DIR, sourceDir))
      .filter(f => f.startsWith(sourcePrefix) && f.endsWith(sourceExt))
      .sort();

    // 오디오: mtime 기준 최신, 'full_' 우선
    const allAudios = listFilesByMtime(path.join(OUTPUT_DIR, 'audio'), f => f.endsWith('.mp3'));
    const audioFile = allAudios.find(f => f.startsWith('full_')) || allAudios[0];

    if (images.length === 0) throw new Error(useVideo
      ? '영상 클립이 없습니다. 먼저 영상 클립을 생성하세요 (/api/clips/generate).'
      : '이미지 파일이 없습니다. 먼저 이미지를 생성하세요.');
    if (!audioFile) {
      const audioDir = path.join(OUTPUT_DIR, 'audio');
      const allFiles = fs.existsSync(audioDir) ? fs.readdirSync(audioDir) : [];
      throw new Error(`오디오 파일 없음. audio/ 폴더: [${allFiles.join(', ')}]`);
    }

    const audioPath = path.join(OUTPUT_DIR, 'audio', audioFile);
    const audioSize = fs.existsSync(audioPath) ? fs.statSync(audioPath).size : 0;
    console.log(`[Render] 오디오 파일: ${audioFile}, 크기: ${(audioSize/1024).toFixed(0)}KB`);

    if (audioSize < 1000) throw new Error(`오디오 파일 손상 (${audioSize}바이트): ${audioFile}`);

    const audioDuration = await probeDuration(audioPath);
    if (audioDuration <= 0) {
      // FFmpeg 직접 진단
      const diagResult = await new Promise(resolve => {
        execFile('ffmpeg', ['-i', audioPath], { timeout: 10000, maxBuffer: 50*1024*1024 }, (err, stdout, stderr) => {
          resolve(stderr || err?.message || 'unknown');
        });
      });
      throw new Error(`오디오 길이 측정 실패. 파일: ${audioFile} (${(audioSize/1024).toFixed(0)}KB). FFmpeg: ${diagResult.substring(0, 300)}`);
    }

    console.log(`[Render] 오디오: ${audioFile}, 실제 길이: ${audioDuration.toFixed(2)}초`);

    // 오디오 길이 = 총 영상 길이 (싱크 핵심)
    const totalDuration = audioDuration;
    const transType = transition || 'none';
    const rawTransDur = parseFloat(transitionDuration) || 0.8;

    // === 오디오 끝부분 잘림 방지: xfade 전환 보상 ===
    // xfade 결과 영상 길이 = N*durationPerImage - (N-1)*transDur
    // 이를 audioDuration과 일치시키려면:
    // durationPerImage = (audioDuration + (N-1)*transDur) / N
    // + 1초 여유 버퍼로 오디오 끝까지 보장
    const N = images.length;
    let durationPerImage;
    if (transType !== 'none' && N > 1) {
      const adjustedTotal = totalDuration + 1.0; // 1초 여유
      durationPerImage = (adjustedTotal + (N - 1) * rawTransDur) / N;
    } else {
      durationPerImage = (totalDuration + 1.0) / N;
    }
    const transDur = Math.min(rawTransDur, durationPerImage * 0.4);
    const kbMode = kenburns || 'varied';

    const KB_PATTERNS = [
      { z: "min(zoom+0.0008,1.25)", x: "iw/2-(iw/zoom/2)", y: "ih/2-(ih/zoom/2)" },
      { z: "if(eq(on,1),1.25,max(zoom-0.0008,1))", x: "iw/2-(iw/zoom/2)", y: "ih/2-(ih/zoom/2)" },
      { z: "min(zoom+0.0006,1.2)", x: "0", y: "ih/2-(ih/zoom/2)" },
      { z: "min(zoom+0.0006,1.2)", x: "iw/zoom-iw", y: "ih/2-(ih/zoom/2)" },
      { z: "min(zoom+0.0006,1.2)", x: "iw/2-(iw/zoom/2)", y: "0" },
      { z: "min(zoom+0.0006,1.2)", x: "iw/2-(iw/zoom/2)", y: "ih/zoom-ih" },
      { z: "min(zoom+0.0008,1.25)", x: "0", y: "0" },
      { z: "min(zoom+0.0008,1.25)", x: "iw/zoom-iw", y: "ih/zoom-ih" },
    ];

    function getKenBurns(idx, frames) {
      if (kbMode === 'none') return `scale=${outW}:${outH}:force_original_aspect_ratio=decrease,pad=${outW}:${outH}:(ow-iw)/2:(oh-ih)/2,setsar=1`;
      const p = kbMode === 'zoom-in'  ? KB_PATTERNS[0]
              : kbMode === 'zoom-out' ? KB_PATTERNS[1]
              : KB_PATTERNS[idx % KB_PATTERNS.length];
      return `scale=${outW*2}:${outH*2}:force_original_aspect_ratio=decrease,pad=${outW*2}:${outH*2}:(ow-iw)/2:(oh-ih)/2,setsar=1,zoompan=z='${p.z}':d=${frames}:x='${p.x}':y='${p.y}':s=${outW}x${outH}:fps=30`;
    }

    const outputFile = `video_${Date.now()}.mp4`;
    const outputPath = path.join(OUTPUT_DIR, 'video', outputFile);

    let ffmpegArgs;

    // 영상 합성 시 narration audio normalize (보장책)
    // TTS 단계에서 정규화했지만 영상 합성 단계에서도 한 번 더 보장 — narration 명확히 들림
    // -16 LUFS + dynaudnorm 압축 (작은 부분 ↑)
    const audioNormFilter = `[__A__:a]aresample=44100,pan=stereo|c0=c0|c1=c0,loudnorm=I=-16:TP=-1.5:LRA=11[aout]`;

    if (useVideo) {
      // === 비디오 클립 모드 ===
      const inputArgs = [];
      images.forEach(clip => {
        inputArgs.push('-stream_loop', '-1', '-t', String(durationPerImage), '-i', path.join(OUTPUT_DIR, sourceDir, clip));
      });
      inputArgs.push('-i', audioPath);

      let filterComplex = '';
      const scaledLabels = [];
      images.forEach((_, i) => {
        filterComplex += `[${i}:v]scale=${outW}:${outH}:force_original_aspect_ratio=decrease,pad=${outW}:${outH}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30,setpts=PTS-STARTPTS[v${i}];`;
        scaledLabels.push(`v${i}`);
      });

      // 10개 초과 시 xfade 대신 concat 사용 (메모리 절약)
      const useXfade = transType !== 'none' && images.length > 1 && images.length <= 10;
      if (useXfade) {
        let prevLabel = scaledLabels[0];
        for (let i = 1; i < scaledLabels.length; i++) {
          const offset = i * durationPerImage - i * transDur;
          const outLabel = i < scaledLabels.length - 1 ? `xf${i}` : 'vout';
          filterComplex += `[${prevLabel}][${scaledLabels[i]}]xfade=transition=${transType}:duration=${transDur}:offset=${offset.toFixed(2)}[${outLabel}];`;
          prevLabel = outLabel;
        }
      } else {
        if (images.length > 10) console.log(`[Render] 클립 ${images.length}개 → xfade 대신 concat 사용 (메모리 절약)`);
        filterComplex += scaledLabels.map(l => `[${l}]`).join('') + `concat=n=${scaledLabels.length}:v=1:a=0[vout];`;
      }
      // audio normalize 추가
      filterComplex += audioNormFilter.replace('__A__', String(images.length));

      ffmpegArgs = [
        ...inputArgs,
        '-filter_complex', filterComplex,
        '-map', '[vout]', '-map', '[aout]',
        '-c:v', 'libx264', '-preset', 'medium', '-crf', '23',
        '-c:a', 'aac', '-b:a', '192k',
        '-shortest', '-movflags', '+faststart',
        '-y', outputPath
      ];
    } else if (transType !== 'none' && images.length > 1 && images.length <= 10) {
      // === 이미지 모드 + 전환 효과 (10개 이하) ===
      const inputArgs = [];
      images.forEach(img => {
        inputArgs.push('-loop', '1', '-t', String(durationPerImage), '-i', path.join(OUTPUT_DIR, sourceDir, img));
      });
      inputArgs.push('-i', audioPath);

      let filterComplex = '';
      const scaledLabels = [];
      const frames = Math.round(durationPerImage * 30);
      images.forEach((_, i) => {
        filterComplex += `[${i}:v]${getKenBurns(i, frames)}[v${i}];`;
        scaledLabels.push(`v${i}`);
      });

      let prevLabel = scaledLabels[0];
      for (let i = 1; i < scaledLabels.length; i++) {
        const offset = i * durationPerImage - i * transDur;
        const outLabel = i < scaledLabels.length - 1 ? `xf${i}` : 'vout';
        filterComplex += `[${prevLabel}][${scaledLabels[i]}]xfade=transition=${transType}:duration=${transDur}:offset=${offset.toFixed(2)}[${outLabel}];`;
        prevLabel = outLabel;
      }
      // audio normalize 추가
      filterComplex += audioNormFilter.replace('__A__', String(images.length));

      ffmpegArgs = [
        ...inputArgs,
        '-filter_complex', filterComplex,
        '-map', '[vout]', '-map', '[aout]',
        '-c:v', 'libx264', '-preset', 'medium', '-crf', '23',
        '-c:a', 'aac', '-b:a', '192k',
        '-shortest', '-movflags', '+faststart',
        '-y', outputPath
      ];
    } else {
      // === 이미지 모드 + 전환 없음 (concat demuxer) ===
      const concatFile = path.join(OUTPUT_DIR, sourceDir, 'concat.txt');
      const concatContent = images
        .map(img => `file '${path.join(OUTPUT_DIR, sourceDir, img).replace(/\\/g, '/')}'\nduration ${durationPerImage}`)
        .join('\n');
      fs.writeFileSync(concatFile, concatContent + `\nfile '${path.join(OUTPUT_DIR, sourceDir, images[images.length - 1]).replace(/\\/g, '/')}'`);

      ffmpegArgs = [
        '-f', 'concat', '-safe', '0', '-i', concatFile,
        '-i', audioPath,
        '-filter_complex', `[0:v]scale=${outW*2}:${outH*2}:force_original_aspect_ratio=decrease,pad=${outW*2}:${outH*2}:(ow-iw)/2:(oh-ih)/2,zoompan=z='min(zoom+0.0008,1.25)':d=${Math.round(durationPerImage*30)}:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=${outW}x${outH}:fps=30[vout];[1:a]aresample=44100,pan=stereo|c0=c0|c1=c0,loudnorm=I=-16:TP=-1.5:LRA=11[aout]`,
        '-map', '[vout]', '-map', '[aout]',
        '-c:v', 'libx264', '-preset', 'medium', '-crf', '23',
        '-c:a', 'aac', '-b:a', '192k',
        '-shortest', '-movflags', '+faststart',
        '-y', outputPath
      ];
    }

    // === 단계 1: 메인 영상 렌더 (이미지/영상 + 오디오 + Ken Burns + 전환) ===
    console.log(`[Render] 1. 메인 렌더: ${useVideo?'영상 클립':'이미지'} ${images.length}개 × ${durationPerImage.toFixed(2)}초 = ${totalDuration.toFixed(2)}초`);
    let finalOutput = outputPath;
    const bgmPath = bgmFile ? path.join(OUTPUT_DIR, 'bgm', bgmFile) : null;
    const hasBgm = bgmPath && fs.existsSync(bgmPath);

    await new Promise((resolve, reject) => {
      execFile('ffmpeg', ffmpegArgs, { timeout: 1200000, maxBuffer: 50 * 1024 * 1024 }, (error, stdout, stderr) => {
        if (error) reject(new Error(`FFmpeg 오류: ${error.message}\n${stderr}`));
        else resolve(stdout);
      });
    });

    // === 단계 2: BGM 믹싱 (narration 우선, weights 4:1) ===
    if (hasBgm) {
      console.log(`[Render] 2. BGM 믹싱: ${bgmFile} (narration 우선)`);
      const bgmOutput = path.join(OUTPUT_DIR, 'video', `bgm_${outputFile}`);
      const vol = bgmVolume || 0.15;
      // amix weights=4 1 → narration 4배 우선 → BGM에 가려지지 않음
      // 최종 loudnorm으로 전체 -16 LUFS 보장
      const bgmArgs = [
        '-i', outputPath,
        '-stream_loop', '-1', '-i', bgmPath,
        '-filter_complex', `[1:a]volume=${vol}[bgm];[0:a][bgm]amix=inputs=2:weights=4 1:duration=first:dropout_transition=3,loudnorm=I=-16:TP=-1.5:LRA=11[aout]`,
        '-map', '0:v', '-map', '[aout]',
        '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k',
        '-shortest', '-movflags', '+faststart',
        '-y', bgmOutput
      ];
      await new Promise((resolve, reject) => {
        execFile('ffmpeg', bgmArgs, { timeout: 300000, maxBuffer: 50 * 1024 * 1024 }, (error, stdout, stderr) => {
          if (error) reject(new Error(`BGM 믹싱 오류: ${error.message}`));
          else resolve(stdout);
        });
      });
      try { fs.unlinkSync(outputPath); } catch(e) {}
      fs.renameSync(bgmOutput, outputPath);
    }

    // === 단계 3: 썸네일 인트로 prepend (3초, SRT 오프셋 위해 SRT보다 먼저) ===
    let srtOffset = 0;
    const THUMB_INTRO_SEC = 3;
    if (showThumb) {
      const thumbFiles = listFilesByMtime(path.join(OUTPUT_DIR, 'thumbnails'), f => f.endsWith('.png'));
      if (thumbFiles.length > 0) {
        const thumbPath = path.join(OUTPUT_DIR, 'thumbnails', thumbFiles[0]);
        console.log(`[Render] 3. 썸네일 인트로 prepend: ${thumbFiles[0]}`);
        const thumbVid = path.join(OUTPUT_DIR, 'video', `thumb_intro_${Date.now()}.mp4`);
        const thumbOutput = path.join(OUTPUT_DIR, 'video', `withthumb_${outputFile}`);
        await new Promise((resolve, reject) => {
          execFile('ffmpeg', [
            '-loop', '1', '-t', String(THUMB_INTRO_SEC), '-i', thumbPath,
            '-f', 'lavfi', '-t', String(THUMB_INTRO_SEC), '-i', 'anullsrc=r=44100:cl=stereo',
            '-vf', `scale=${outW}:${outH}:force_original_aspect_ratio=decrease,pad=${outW}:${outH}:(ow-iw)/2:(oh-ih)/2,fps=30`,
            '-c:v', 'libx264', '-preset', 'medium', '-crf', '23', '-pix_fmt', 'yuv420p',
            '-c:a', 'aac', '-b:a', '192k', '-ar', '44100', '-shortest',
            '-y', thumbVid
          ], { timeout: 60000, maxBuffer: 50 * 1024 * 1024 }, (error, stdout, stderr) => {
            if (error) reject(new Error(`썸네일 인트로 생성 오류: ${error.message}\n${stderr}`));
            else resolve();
          });
        });
        // concat filter (filter_complex)로 변경 — concat demuxer의 AAC noise gain 경고 폭주 회피
        // 두 입력 모두 명시적으로 video/audio 정규화 → 호환성 보장
        await new Promise((resolve, reject) => {
          execFile('ffmpeg', [
            '-i', thumbVid,
            '-i', outputPath,
            '-filter_complex',
              `[0:v]scale=${outW}:${outH}:force_original_aspect_ratio=decrease,pad=${outW}:${outH}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30,format=yuv420p[v0];` +
              `[1:v]scale=${outW}:${outH}:force_original_aspect_ratio=decrease,pad=${outW}:${outH}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30,format=yuv420p[v1];` +
              `[0:a]aresample=44100,pan=stereo|c0=c0|c1=c0[a0];` +
              `[1:a]aresample=44100,pan=stereo|c0=c0|c1=c0[a1];` +
              `[v0][a0][v1][a1]concat=n=2:v=1:a=1[vout][aout]`,
            '-map', '[vout]', '-map', '[aout]',
            '-c:v', 'libx264', '-preset', 'medium', '-crf', '23', '-pix_fmt', 'yuv420p',
            '-c:a', 'aac', '-b:a', '192k', '-ar', '44100',
            '-loglevel', 'error',
            '-movflags', '+faststart', '-y', thumbOutput
          ], { timeout: 300000, maxBuffer: 50 * 1024 * 1024 }, (error, stdout, stderr) => {
            if (error) reject(new Error(`썸네일 인트로 결합 오류: ${error.message}\n${stderr.substring(0, 2000)}`));
            else resolve();
          });
        });
        try { fs.unlinkSync(outputPath); fs.unlinkSync(thumbVid); } catch(e) {}
        fs.renameSync(thumbOutput, outputPath);
        srtOffset = THUMB_INTRO_SEC;  // 자막 타임라인을 3초 뒤로 밀어야 함
      }
    }

    // === 단계 4: SRT 자막 burn (기존 SRT 파일 우선 사용 → 이중자막 포함) ===
    if (burnSrt) {
      const scriptText = project.script || '';
      if (scriptText) {
        // 기존 SRT 파일 찾기 (이중자막 포함된 파일 우선)
        const existingSrtFiles = listFilesByMtime(path.join(OUTPUT_DIR, 'srt'), f => f.endsWith('.srt'));
        let freshSrtPath;

        if (existingSrtFiles.length > 0 && srtOffset === 0) {
          // 썸네일 인트로 없으면 기존 SRT 사용 (이중자막 포함)
          freshSrtPath = path.join(OUTPUT_DIR, 'srt', existingSrtFiles[0]);
          console.log(`[Render] 4. 기존 SRT 사용: ${existingSrtFiles[0]} (이중자막 포함)`);
        } else {
          // 새로 생성 (썸네일 오프셋 적용 시)
          console.log(`[Render] 4. SRT 새로 생성 (오프셋 ${srtOffset}초)`);
          const isBiSrt = language && language !== 'ko';
          const srtMaxLen = isVertical ? (isBiSrt ? 14 : 18) : (isBiSrt ? 25 : 33);
          let freshSrtContent = scriptToSrt(scriptText, audioDuration, srtOffset, project.ttsAlignment, language || null, srtMaxLen);

          // 외국어면 이중자막 추가
          const lang = language || 'ko';
          if (lang !== 'ko' && anthropic) {
            try {
              console.log(`[Render] SRT 이중자막 생성: ${lang} + 한국어`);
              const srtBlocks = freshSrtContent.trim().split(/\n\n+/).filter(Boolean);
              const origLines = srtBlocks.map(block => {
                const lines = block.split('\n');
                return { idx: lines[0], time: lines[1], text: lines.slice(2).join(' ') };
              });
              const textsToTranslate = origLines.map((l, i) => `[${i}] ${l.text}`).join('\n');
              const langNameMap = { en: '영어', zh: '중국어', ja: '일본어', es: '스페인어' };
              const transMsg = await anthropic.messages.create({
                model: 'claude-sonnet-4-6',
                max_tokens: 8000,
                messages: [{ role: 'user', content: `다음 ${langNameMap[lang]||lang} 자막을 한국어로 번역하세요.\n각 줄의 [번호]를 유지하고, 번역만 작성하세요.\n\n${textsToTranslate}` }]
              });
              const transText = transMsg.content[0].text;
              const transMap = {};
              transText.split('\n').filter(l => l.trim()).forEach(line => {
                const match = line.match(/^\[(\d+)\]\s*(.+)$/);
                if (match) transMap[parseInt(match[1])] = match[2].trim();
              });
              let biSrt = '';
              origLines.forEach((l, i) => {
                biSrt += `${l.idx}\n${l.time}\n${l.text}\n${transMap[i]||''}\n\n`;
              });
              freshSrtContent = biSrt;
            } catch(e) { console.warn('[Render] 이중자막 번역 실패:', e.message); }
          }

          const freshSrtFile = `render_${Date.now()}.srt`;
          freshSrtPath = path.join(OUTPUT_DIR, 'srt', freshSrtFile);
          fs.writeFileSync(freshSrtPath, freshSrtContent, 'utf-8');
        }

        const srtPathEscaped = freshSrtPath.replace(/\\/g, '/').replace(/:/g, '\\:');
        // 이중자막(2줄) 여부 감지
        const isBilingual = language && language !== 'ko';
        // 9:16 세로 + 이중자막: 폰트 더 축소 + 마진 확대
        const srtFontSize = isVertical ? (isBilingual ? 9 : 10) : (isBilingual ? 13 : 16);
        const srtMarginLR = isVertical ? (isBilingual ? 10 : 20) : (isBilingual ? 40 : 80);
        const srtMarginV = isVertical ? (isBilingual ? 30 : 60) : (isBilingual ? 25 : 40);
        const srtOutline = isVertical ? 1.5 : 2;
        const srtOutput = path.join(OUTPUT_DIR, 'video', `srt_${outputFile}`);
        await new Promise((resolve, reject) => {
          execFile('ffmpeg', [
            '-i', outputPath,
            '-vf', `subtitles='${srtPathEscaped}':fontsdir='${(CJK_FONT_PATH ? path.dirname(CJK_FONT_PATH) : path.join(__dirname, 'assets', 'fonts')).replace(/\\/g, '/').replace(/:/g, '\\:')}':force_style='FontName=Noto Sans CJK SC,Fontname=Noto Sans CJK SC,FontSize=${srtFontSize},PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,BackColour=&H80000000,BorderStyle=1,Outline=${srtOutline},Shadow=1,MarginV=${srtMarginV},MarginL=${srtMarginLR},MarginR=${srtMarginLR},WrapStyle=2,Bold=1,Italic=0,Alignment=2'`,
            '-c:a', 'copy', '-c:v', 'libx264', '-preset', 'medium', '-crf', '23',
            '-movflags', '+faststart', '-y', srtOutput
          ], { timeout: 600000, maxBuffer: 50 * 1024 * 1024 }, (error, stdout, stderr) => {
            if (error) reject(new Error(`자막 삽입 오류: ${error.message}\n${stderr}`));
            else resolve(stdout);
          });
        });
        try { fs.unlinkSync(outputPath); } catch(e) {}
        fs.renameSync(srtOutput, outputPath);
      }
    }

    // === 단계 5: 인트로 텍스트 오버레이 (첫 5초, 썸네일 있으면 3~8초) ===
    if (showIntro && project.topic) {
      const introStart = srtOffset;
      const introEnd = srtOffset + 5;
      console.log(`[Render] 5. 인트로 텍스트 오버레이 (${introStart}~${introEnd}초)`);
      const introOutput = path.join(OUTPUT_DIR, 'video', `intro_${outputFile}`);
      const introText = project.topic.replace(/'/g, "'\\''").replace(/:/g, '\\:');
      await new Promise((resolve, reject) => {
        execFile('ffmpeg', [
          '-i', outputPath,
          '-vf', `drawtext=text='${introText}':fontsize=56:fontcolor=white:borderw=3:bordercolor=black:shadowcolor=black@0.6:shadowx=2:shadowy=2:x=(w-text_w)/2:y=(h-text_h)/2:enable='between(t,${introStart},${introEnd})':fontfile='${path.join(__dirname, 'assets', 'fonts', 'KoPubWorldDotumBold.ttf').replace(/\\/g, '/').replace(/:/g, '\\\\:')}'`,
          '-c:a', 'copy', '-c:v', 'libx264', '-preset', 'medium', '-crf', '23',
          '-movflags', '+faststart', '-y', introOutput
        ], { timeout: 300000, maxBuffer: 50 * 1024 * 1024 }, (error, stdout, stderr) => {
          if (error) reject(new Error(`인트로 텍스트 오류: ${error.message}\n${stderr}`));
          else resolve();
        });
      });
      try { fs.unlinkSync(outputPath); } catch(e) {}
      fs.renameSync(introOutput, outputPath);
    }

    project.videoFile = outputFile;
    console.log(`[Render] 최종 파일: ${outputPath}, 존재: ${fs.existsSync(outputPath)}`);
    const stats = fs.statSync(outputPath);
    console.log(`[Render] 파일 크기: ${(stats.size/1024/1024).toFixed(1)}MB`);

    let videoDuration = totalDuration;
    try {
      const dur = await new Promise((resolve, reject) => {
        execFile('ffmpeg', ['-i', outputPath], { timeout: 10000, maxBuffer: 50 * 1024 * 1024 }, (error, stdout, stderr) => {
          const match = (stderr || '').match(/Duration:\s*(\d+):(\d+):(\d+)\.(\d+)/);
          if (match) resolve(parseInt(match[1])*3600 + parseInt(match[2])*60 + parseInt(match[3]));
          else resolve(totalDuration);
        });
      });
      videoDuration = dur;
    } catch(e) {}

    res.json({
      success: true,
      videoUrl: `/output/video/${outputFile}`,
      filename: outputFile,
      fileSize: `${(stats.size / 1024 / 1024).toFixed(1)}MB`,
      imageCount: images.length,
      audioFile,
      transition: transType,
      bgm: hasBgm ? bgmFile : null,
      duration: videoDuration
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// BGM 업로드
app.post('/api/bgm/upload', express.raw({ type: 'audio/*', limit: '50mb' }), (req, res) => {
  try {
    const filename = `bgm_${Date.now()}.mp3`;
    fs.writeFileSync(path.join(OUTPUT_DIR, 'bgm', filename), req.body);
    res.json({ success: true, filename, url: `/output/bgm/${filename}` });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/bgm/list', (req, res) => {
  const bgmDir = path.join(OUTPUT_DIR, 'bgm');
  const files = fs.readdirSync(bgmDir).filter(f => f.endsWith('.mp3') || f.endsWith('.wav') || f.endsWith('.m4a')).map(f => ({
    name: f, url: `/output/bgm/${f}`, size: `${(fs.statSync(path.join(bgmDir, f)).size / 1024).toFixed(0)}KB`
  }));
  res.json({ success: true, files });
});

// 프로젝트 목록 관리
app.get('/api/projects/list', (req, res) => {
  const list = Object.values(projects).map(p => ({
    id: p.id, topic: p.topic, createdAt: p.createdAt,
    hasScript: !!p.script, hasVideo: !!p.videoFile,
    imageCount: p.imageFiles?.length || 0
  }));
  res.json({ success: true, projects: list });
});

app.delete('/api/project/:id', (req, res) => {
  delete projects[req.params.id];
  res.json({ success: true });
});

// ========================
// 7. 제목/설명/태그 생성 (Claude)
// ========================
app.post('/api/meta/generate', async (req, res) => {
  req.setTimeout(300000); res.setTimeout(300000);
  try {
    const { projectId, topic, script, languages } = req.body;
    const project = getProject(projectId);

    const langs = languages || ['ko'];
    const langNames = { ko: '한국어', en: '영어', ja: '일본어', zh: '중국어' };
    const langList = langs.map(l => langNames[l] || l).join(', ');

    const prompt = `유튜브 영상 메타데이터를 생성해주세요.

주제: ${topic || project.topic}
${(script || project.script) ? `대본 요약:\n${(script || project.script).substring(0, 2000)}` : ''}

다음 JSON 형식으로 작성:
{
  "titles": [
    { "lang": "ko", "options": ["제목1", "제목2", "제목3"] }
    ${langs.includes('en') ? ', { "lang": "en", "options": ["Title1", "Title2", "Title3"] }' : ''}
    ${langs.includes('ja') ? ', { "lang": "ja", "options": ["タイトル1", "タイトル2", "タイトル3"] }' : ''}
  ],
  "description": {
    "ko": "아래 형식을 정확히 따라 작성하세요"
    ${langs.includes('en') ? ', "en": "English description"' : ''}
    ${langs.includes('ja') ? ', "ja": "日本語の説明"' : ''}
  },
  "tags": ["태그1", "태그2", "...최소 15개"],
  "pinnedComment": "고정 댓글 (시청자 참여 유도)",
  "category": "YouTube 카테고리 (Education, Entertainment, etc.)"
}

[설명(description) 작성 형식 — 반드시 이 형식을 정확히 따르세요]:

🔍 호기심을 자극하는 1~2줄 도입부 (이모지 포함)

대본 내용 기반 2~3줄 핵심 요약 설명

📌 타임스탬프
00:00 오프닝 - 장면 제목
01:30 장면 2 제목
03:45 장면 3 제목
(대본의 장면 구조를 참고하여 실제 타임스탬프 작성, 최소 5개)

🧬 마무리 한 줄 (시청 유도 문구, 이모지 포함)

규칙:
- 제목: 호기심 극대화, 클릭률 최적화, 50자 이내
- 설명: 위 형식 정확히 준수. 타임스탬프는 대본 장면 기반으로 작성
- 태그: 관련 키워드 15개 이상 (# 없이 단어만)
- 고정 댓글: 시청자 공감 + 댓글 참여 유도
- 설명에 태그(해시태그)는 포함하지 마세요 (별도 tags 필드에 작성)
- 설명에 자막/대본 텍스트를 절대 포함하지 마세요. 설명은 요약+타임스탬프만 작성

JSON만 반환하세요.`;

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 3000,
      messages: [{ role: 'user', content: prompt }]
    });

    const text = message.content[0].text;
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    const meta = jsonMatch ? JSON.parse(jsonMatch[0]) : {};

    project.meta = meta;

    res.json({ success: true, meta });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ========================
// 8. 썸네일 생성 (ChatGPT Images 2.0)
// ========================
app.post('/api/thumbnail/generate', async (req, res) => {
  try {
    const { projectId, topic, style, text, ratio, language } = req.body;
    const thumbLang = language || 'ko';
    const thumbVertical = ratio === '9:16';
    const thumbW = thumbVertical ? 720 : 1280;
    const thumbH = thumbVertical ? 1280 : 720;

    // Claude로 제목을 강조 단어(highlight) + 보조 텍스트(sub) + 한국어 번역(ko)으로 분리
    let hookText = '';
    var subText = '';
    var koText = '';
    const titleForThumb = text || topic || '';
    const langNames2 = { ko: '한국어', en: '영어', zh: '중국어', ja: '일본어', es: '스페인어' };
    const isKorean = thumbLang === 'ko';

    if (titleForThumb && anthropic) {
      try {
        const promptContent = isKorean
          ? `유튜브 썸네일용 텍스트를 JSON으로 생성하세요.

제목: "${titleForThumb}"

규칙:
- highlight: 제목에서 가장 강렬한 핵심 키워드 2~4단어 (노란색 강조)
- sub: 나머지 맥락/설명 (흰색)
- 예: {"highlight":"충격 진실","sub":"역사가 감춘 7가지 비밀"}

JSON만 출력: {"highlight":"...","sub":"..."}`
          : `유튜브 썸네일용 이중 언어 텍스트를 생성하세요.

원본 제목: "${titleForThumb}"
영상 언어: ${langNames2[thumbLang] || thumbLang}

중요: highlight와 sub는 반드시 ${langNames2[thumbLang]}로 번역/작성하세요. 한국어로 쓰지 마세요!
ko는 한국어 번역입니다.

규칙:
- highlight: ${langNames2[thumbLang]}로 핵심 키워드 2~4단어 (반드시 ${langNames2[thumbLang]} 문자로!)
- sub: ${langNames2[thumbLang]}로 보조 설명 (반드시 ${langNames2[thumbLang]} 문자로!)
- ko: 한국어로 제목 전체 번역 (1~2줄)
- 중국어 예: {"highlight":"震撼真相","sub":"历史隐藏的七个秘密","ko":"역사가 감춘 7가지 충격 진실"}
- 영어 예: {"highlight":"SHOCKING TRUTH","sub":"7 Secrets Hidden by History","ko":"역사가 감춘 7가지 충격 진실"}
- 일본어 예: {"highlight":"衝撃の真実","sub":"歴史が隠した7つの秘密","ko":"역사가 감춘 7가지 충격 진실"}

JSON만 출력: {"highlight":"...","sub":"...","ko":"..."}`;

        const hookMsg = await anthropic.messages.create({
          model: 'claude-sonnet-4-6',
          max_tokens: 250,
          messages: [{ role: 'user', content: promptContent }]
        });
        const raw = hookMsg.content[0].text.trim();
        const match = raw.match(/\{[^{}]*"highlight"[^{}]*\}/);
        if (match) {
          const parsed = JSON.parse(match[0]);
          hookText = (parsed.highlight || '').toString().substring(0, 30);
          subText = (parsed.sub || '').toString().substring(0, 45);
          koText = (parsed.ko || '').toString().substring(0, 50);
        } else {
          hookText = titleForThumb.substring(0, 15);
        }
      } catch(e) {
        hookText = titleForThumb.substring(0, 15);
        subText = titleForThumb.length > 15 ? titleForThumb.substring(15, 50) : '';
      }
    } else {
      hookText = titleForThumb.substring(0, 15);
      subText = titleForThumb.length > 15 ? titleForThumb.substring(15, 50) : '';
    }

    const styleGuide = {
      dramatic: 'cinematic lighting, atmospheric composition, depth of field, soft mood',
      clean: 'clean minimal design, modern, professional, white space, sharp typography, gradient background',
      clickbait: 'vibrant colors, bold colorful composition, bright highlights, attention-grabbing',
      cinematic: 'cinematic wide shot, film-like, teal and orange grading, atmospheric, lens flare'
    };

    // === Topic → 안전한 영문 비주얼 묘사 (Claude로 한 번 더 정제) ===
    // 한글 topic을 직접 prompt에 넣으면 OpenAI 안전 필터(abuse)에 걸릴 수 있음.
    // 예: "왕조 멸망", "충격 진실" → 폭력/공포로 오인. 안전한 시각적 명사로 치환.
    let safeVisual = '';
    try {
      const visMsg = await anthropic.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 200,
        messages: [{ role: 'user', content: `다음 한국어 주제를 OpenAI 이미지 생성 API에 안전한 영문 비주얼 묘사로 변환하세요.
주제: "${topic}"
규칙:
- 영문, 1문장 (30단어 이내)
- 폭력/죽음/사고/범죄/마약/무기/공포 직접 어휘 금지 (예: death, kill, blood, weapon, abuse, drug, murder, violence)
- 대신 평화로운/은유적/상징적 시각 명사 사용 (예: ancient palace, vintage clock, glowing book, abstract pattern, mysterious silhouette, golden sunset, atmospheric landscape)
- 추상적·예술적 묘사 위주
- 안전하고 일반적인 단어만 사용

출력: 영문 1문장만 (따옴표/설명 없이).` }]
      });
      safeVisual = visMsg.content[0].text.trim().replace(/^["']|["']$/g, '').split('\n')[0].substring(0, 250);
    } catch(e) {
      console.warn('[Thumbnail] safe visual 변환 실패:', e.message);
      safeVisual = 'abstract cinematic composition with atmospheric lighting';
    }

    console.log(`[Thumbnail] 안전 비주얼: "${safeVisual}"`);

    // 안전한 시각 묘사 + 스타일 + NO TEXT 명시
    const thumbAspect = thumbVertical ? '9:16 vertical portrait' : '16:9 horizontal landscape';
    const thumbImgSize = thumbVertical ? '1024x1536' : '1536x1024';
    function buildPrompt(visual) {
      return `Professional YouTube thumbnail background image, ${thumbAspect} aspect ratio, ${styleGuide[style] || styleGuide.dramatic}, ${visual}. Cinematic composition with empty space for text overlay. IMPORTANT: NO TEXT, NO LETTERS, NO WORDS, NO TYPOGRAPHY, NO CAPTIONS, NO WRITTEN CONTENT of any kind — pure abstract visual scene only, peaceful and artistic.`;
    }

    // 자동 재시도 (safety violation 시 fallback prompt로)
    async function generateWithRetry() {
      const attempts = [
        buildPrompt(safeVisual),
        buildPrompt('atmospheric abstract artistic composition with soft lighting and depth'),
        buildPrompt('minimalist artistic composition with soft gradient background')
      ];
      let lastErr;
      for (let i = 0; i < attempts.length; i++) {
        try {
          console.log(`[Thumbnail] 생성 시도 ${i+1}/${attempts.length}`);
          return await openai.images.generate({
            model: 'gpt-image-1',
            prompt: attempts[i],
            size: thumbImgSize,
            quality: 'high',
            n: 1
          });
        } catch(e) {
          lastErr = e;
          const isSafety = (e?.status === 400) && /safety|abuse|moderation/i.test(e?.message || '');
          if (!isSafety) throw e; // safety 아니면 즉시 throw
          console.warn(`[Thumbnail] safety 차단, fallback 시도 → ${i+1}/${attempts.length}`);
        }
      }
      throw lastErr;
    }

    const image = await generateWithRetry();

    const b64 = image.data[0].b64_json;
    const buffer = Buffer.from(b64, 'base64');
    const rawFile = `thumbnail_raw_${Date.now()}.png`;
    const rawPath = path.join(OUTPUT_DIR, 'thumbnails', rawFile);
    fs.writeFileSync(rawPath, buffer);

    // 1단계: 16:9 크롭
    const croppedFile = `thumbnail_cropped_${Date.now()}.png`;
    const croppedPath = path.join(OUTPUT_DIR, 'thumbnails', croppedFile);
    await new Promise((resolve) => {
      execFile('ffmpeg', [
        '-i', rawPath,
        '-vf', thumbVertical ? `crop=iw:iw*16/9,scale=${thumbW}:${thumbH}` : `crop=ih*16/9:ih,scale=${thumbW}:${thumbH}`,
        '-y', croppedPath
      ], { timeout: 30000, maxBuffer: 50 * 1024 * 1024 }, (error) => {
        if (error) { fs.copyFileSync(rawPath, croppedPath); }
        resolve();
      });
    });

    // 2단계: FFmpeg drawtext로 한글 텍스트 오버레이 — 화면 안에 들어가도록 동적 사이즈/줄바꿈
    const filename = `thumbnail_${Date.now()}.png`;
    const filepath = path.join(OUTPUT_DIR, 'thumbnails', filename);
    // 폰트: 커스텀 파일 우선 → fontconfig name fallback
    const customFont = path.join(__dirname, 'assets', 'fonts', 'KoPubWorldDotumBold.ttf');
    const useCustomFont = fs.existsSync(customFont);
    console.log(`[Thumbnail] 커스텀 폰트: ${useCustomFont ? '있음' : '없음 → Noto Sans CJK 사용'}`);

    // 한글 1글자 = 약 fontSize px 폭 차지 (고딕 굵게)
    // 가용 폭: 16:9→1280-160=1120, 9:16→720-80=640
    const SAFE_W = thumbVertical ? 580 : 1080;

    function wrapLines(text, fontSize) {
      const maxChars = Math.floor(SAFE_W / (fontSize * 0.95));
      const chars = [...text];
      const lines = [];
      let cur = '';
      for (const ch of chars) {
        if ((cur + ch).length > maxChars && cur.length > 0) {
          // 공백/쉼표에서 자르기 우선
          const cutIdx = Math.max(cur.lastIndexOf(' '), cur.lastIndexOf(','), cur.lastIndexOf('，'));
          if (cutIdx > maxChars * 0.5) {
            lines.push(cur.substring(0, cutIdx).trim());
            cur = cur.substring(cutIdx).trim() + ch;
          } else {
            lines.push(cur);
            cur = ch;
          }
        } else {
          cur += ch;
        }
      }
      if (cur) lines.push(cur);
      return lines;
    }

    function pickFontSize(text, baseSize, minSize) {
      const len = [...text].length;
      // 글자 수가 많으면 폰트 줄임
      let size = baseSize;
      while (size > minSize) {
        const maxCharsPerLine = Math.floor(SAFE_W / (size * 0.95));
        if (len <= maxCharsPerLine * 2) break; // 2줄 이내 가능
        size -= 4;
      }
      return size;
    }

    const mainText = (hookText || '').trim();
    const subTxt = (subText || '').trim();

    // === 한국 뉴스 스타일 디자인 — 하단 좌측 정렬 + 빨간 단독 라벨 ===
    // 참고: JTBC 뉴스룸, MBC 뉴스.zip 썸네일 디자인
    // 핵심: 좌측 하단 정렬, 흰 굵은 텍스트 + 검정 외곽선, 빨간 [단독] 라벨
    const mainFontSize = pickFontSize(mainText, thumbVertical ? 64 : 96, thumbVertical ? 40 : 60);
    const mainLines = wrapLines(mainText, mainFontSize);

    const subFontSize = subTxt ? pickFontSize(subTxt, thumbVertical ? 38 : 56, thumbVertical ? 24 : 36) : 0;
    const subLines = subTxt ? wrapLines(subTxt, subFontSize) : [];

    // 한국어 번역 (외국어 선택 시)
    const koFontSize = koText ? pickFontSize(koText, thumbVertical ? 30 : 44, thumbVertical ? 20 : 30) : 0;
    const koLines = koText ? wrapLines(koText, koFontSize) : [];

    const escapeText = (s) => s.replace(/\\/g, '\\\\').replace(/'/g, "'\\''").replace(/:/g, '\\:').replace(/%/g, '\\%');

    const mainLineH = Math.round(mainFontSize * 1.2);
    const subLineH = Math.round(subFontSize * 1.25);
    const koLineH = Math.round(koFontSize * 1.25);
    const mainTotalH = mainLines.length * mainLineH;
    const subTotalH = subLines.length * subLineH;
    const koTotalH = koLines.length * koLineH;

    // 좌측 여백 + 하단 정렬
    const LEFT_MARGIN = thumbVertical ? 60 : 70;
    const BOTTOM_MARGIN = thumbVertical ? 100 : 60;
    const LABEL_H = thumbVertical ? 40 : 56;
    const LABEL_GAP = thumbVertical ? 12 : 18;

    // 전체 텍스트 블록 (라벨 + 메인 + 서브 + 한국어) 하단 정렬
    const subGap = subLines.length > 0 ? (thumbVertical ? 14 : 20) : 0;
    const koGap = koLines.length > 0 ? (thumbVertical ? 10 : 14) : 0;
    const labelGap = LABEL_GAP;
    const blockH = LABEL_H + labelGap + mainTotalH + subGap + subTotalH + koGap + koTotalH;
    const blockY = thumbH - BOTTOM_MARGIN - blockH;

    const filters = [];

    // 1) 하단 그라데이션 비네트 (어두운 영역에 텍스트 — 가독성)
    // 하단 60% 영역 어둡게
    const darkY = thumbVertical ? Math.round(thumbH * 0.5) : 300;
    const darkH = thumbVertical ? Math.round(thumbH * 0.5) : 420;
    filters.push(`drawbox=x=0:y=${darkY}:w=${thumbW}:h=${darkH}:color=black@0.55:t=fill`);

    // 폰트 지정: 전역 감지된 CJK_FONT_PATH 사용
    const fontFile = useCustomFont ? customFont : CJK_FONT_PATH;
    const fontSpec = fontFile
      ? `fontfile='${fontFile.replace(/\\/g, '/').replace(/:/g, '\\:')}'`
      : `font='Noto Sans CJK SC'`;
    console.log(`[Thumbnail] 폰트: ${fontFile || 'fontconfig fallback'}`);

    // 2) [단독] 빨간 라벨 박스 (좌측 상단 텍스트 블록 위)
    const labelX = LEFT_MARGIN;
    const labelY = blockY;
    const labelText = '단독';
    const labelFontSize = thumbVertical ? 26 : 36;
    const labelEsc = escapeText(labelText);
    filters.push(`drawbox=x=${labelX}:y=${labelY}:w=140:h=${LABEL_H}:color=#E50914:t=fill`);
    filters.push(`drawbox=x=${labelX}:y=${labelY}:w=6:h=${LABEL_H}:color=white:t=fill`);
    filters.push(`drawtext=text='${labelEsc}':${fontSpec}:fontsize=${labelFontSize}:fontcolor=white:x=${labelX}+(140-text_w)/2:y=${labelY}+(${LABEL_H}-text_h)/2`);

    // 3) 메인 텍스트 — 하단 좌측 정렬, 굵은 흰색 + 검정 외곽선 + 그림자
    const mainStartY = blockY + LABEL_H + labelGap;
    mainLines.forEach((line, i) => {
      const y = mainStartY + i * mainLineH;
      const esc = escapeText(line);
      filters.push(`drawtext=text='${esc}':${fontSpec}:fontsize=${mainFontSize}:fontcolor=black@0.8:x=${LEFT_MARGIN}+4:y=${y}+4`);
      filters.push(`drawtext=text='${esc}':${fontSpec}:fontsize=${mainFontSize}:fontcolor=#FFD700:borderw=10:bordercolor=black:x=${LEFT_MARGIN}:y=${y}`);
    });

    // 4) 서브 텍스트 (외국어)
    if (subLines.length > 0) {
      const subStartY = mainStartY + mainTotalH + subGap;
      subLines.forEach((line, i) => {
        const y = subStartY + i * subLineH;
        const esc = escapeText(line);
        filters.push(`drawtext=text='${esc}':${fontSpec}:fontsize=${subFontSize}:fontcolor=black@0.6:x=${LEFT_MARGIN}+3:y=${y}+3`);
        filters.push(`drawtext=text='${esc}':${fontSpec}:fontsize=${subFontSize}:fontcolor=white:borderw=6:bordercolor=black:x=${LEFT_MARGIN}:y=${y}`);
      });
    }

    // 5) 한국어 번역 (외국어 선택 시, 하단에 연한 스카이블루)
    if (koLines.length > 0) {
      const koStartY = mainStartY + mainTotalH + subGap + subTotalH + koGap;
      koLines.forEach((line, i) => {
        const y = koStartY + i * koLineH;
        const esc = escapeText(line);
        filters.push(`drawtext=text='${esc}':${fontSpec}:fontsize=${koFontSize}:fontcolor=black@0.5:x=${LEFT_MARGIN}+2:y=${y}+2`);
        filters.push(`drawtext=text='${esc}':${fontSpec}:fontsize=${koFontSize}:fontcolor=#87CEEB:borderw=4:bordercolor=black:x=${LEFT_MARGIN}:y=${y}`);
      });
    }

    const drawFilters = filters.join(',');

    await new Promise((resolve) => {
      execFile('ffmpeg', [
        '-i', croppedPath,
        '-vf', drawFilters,
        '-y', filepath
      ], { timeout: 30000, maxBuffer: 50 * 1024 * 1024 }, (error, stdout, stderr) => {
        if (error) { console.error('[Thumbnail drawtext 실패]', error.message, '\n[stderr]', stderr?.substring(0, 500)); fs.copyFileSync(croppedPath, filepath); }
        resolve();
      });
    });
    try { fs.unlinkSync(rawPath); } catch(e) {}
    try { fs.unlinkSync(croppedPath); } catch(e) {}

    res.json({
      success: true,
      imageUrl: `/output/thumbnails/${filename}`,
      filename,
      hookText,
      subText: subText || ''
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ========================
// 9. 쇼츠 대본 생성 (Claude)
// ========================
app.post('/api/shorts/generate', async (req, res) => {
  try {
    const { projectId, script, count, length } = req.body;
    const project = getProject(projectId);

    const prompt = `다음 유튜브 롱폼 대본에서 핵심 내용을 추출하여, ${count || 3}개의 YouTube Shorts(세로형 9:16) 대본을 작성해주세요.

원본 대본:
${(script || project.script || '').substring(0, 3000)}

규칙:
- 각 쇼츠: ${length || 60}초 분량
- 강력한 후킹으로 시작 (첫 3초가 핵심)
- 세로형 9:16 비율에 맞는 비주얼 가이드 포함
- 마지막에 풀영상 유도 CTA
- 자막 필수 (핵심 단어 강조)

JSON 배열 형식:
[
  {
    "number": 1,
    "title": "쇼츠 제목",
    "hook": "첫 3초 후킹 문장",
    "script": "전체 대본 (타임스탬프 포함)",
    "visualGuide": "비주얼 연출 가이드",
    "duration": ${length || 60}
  }
]

JSON만 반환하세요.`;

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      messages: [{ role: 'user', content: prompt }]
    });

    const text = message.content[0].text;
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    const shorts = jsonMatch ? JSON.parse(jsonMatch[0]) : [];

    res.json({ success: true, shorts });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ========================
// 10. 인트로 생성 (Claude)
// ========================
app.post('/api/intro/generate', async (req, res) => {
  try {
    const { projectId, topic, type, length, script } = req.body;
    const project = getProject(projectId);

    const prompt = `유튜브 영상 인트로(오프닝) 대본을 작성해주세요.

주제: ${topic || project.topic}
인트로 유형: ${type || '질문형'}
길이: ${length || 30}초
${(script || project.script) ? `대본 참고:\n${(script || project.script).substring(0, 1000)}` : ''}

작성 규칙:
1. 첫 5초 안에 시청자를 사로잡을 강력한 후킹
2. 나레이션 톤/감정 지문 표기 (괄호 안에)
3. 비주얼 연출 가이드
4. BGM 분위기 제안
5. 초 단위 타임스탬프

전문적이고 몰입감 있는 인트로를 작성해주세요.`;

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 2000,
      messages: [{ role: 'user', content: prompt }]
    });

    res.json({ success: true, intro: message.content[0].text });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ========================
// 사용자별 설정 저장 (Google 이메일 기준)
// ========================
const USER_SETTINGS_PATH = path.join(__dirname, '.user-settings.json');

// DB 우선, fallback JSON
async function loadUserKeysDB(email) {
  if (db) {
    try {
      const r = await db.query('SELECT api_keys FROM user_settings WHERE email=$1', [email]);
      return r.rows[0]?.api_keys || null;
    } catch(e) { console.error('[DB] loadUserKeys:', e.message); }
  }
  // JSON fallback
  const all = loadUserSettingsJSON();
  return all[email] || null;
}
async function saveUserKeysDB(email, keys, name, picture) {
  if (db) {
    try {
      await db.query(`
        INSERT INTO user_settings (email, name, picture, api_keys, updated_at)
        VALUES ($1, $2, $3, $4, NOW())
        ON CONFLICT (email) DO UPDATE SET
          api_keys = user_settings.api_keys || $4,
          name = COALESCE($2, user_settings.name),
          picture = COALESCE($3, user_settings.picture),
          updated_at = NOW()
      `, [email, name || null, picture || null, JSON.stringify(keys)]);
      return;
    } catch(e) { console.error('[DB] saveUserKeys:', e.message); }
  }
  // JSON fallback
  const all = loadUserSettingsJSON();
  if (!all[email]) all[email] = {};
  Object.assign(all[email], keys);
  saveUserSettingsJSON(all);
}
function loadUserSettingsJSON() {
  if (fs.existsSync(USER_SETTINGS_PATH)) {
    try { return JSON.parse(fs.readFileSync(USER_SETTINGS_PATH, 'utf-8')); } catch(e) {}
  }
  return {};
}
function saveUserSettingsJSON(data) {
  fs.writeFileSync(USER_SETTINGS_PATH, JSON.stringify(data, null, 2), 'utf-8');
}
function applyUserKeys(keys) {
  if (!keys) return;
  const envKeys = ['ANTHROPIC_API_KEY','OPENAI_API_KEY','ELEVENLABS_API_KEY','PEXELS_API_KEY','RUNWAYML_API_KEY','FALAI_API_KEY','YOUTUBE_CLIENT_ID','YOUTUBE_CLIENT_SECRET','YOUTUBE_REFRESH_TOKEN'];
  for (const k of envKeys) {
    if (keys[k]) process.env[k] = keys[k];
  }
  // 전역 키 변수 갱신
  if (keys.ANTHROPIC_API_KEY) {
    ANTHROPIC_KEY = cleanKey(keys.ANTHROPIC_API_KEY);
    try { anthropic = new Anthropic({ apiKey: ANTHROPIC_KEY }); } catch(e) {}
  }
  if (keys.OPENAI_API_KEY) {
    OPENAI_KEY = cleanKey(keys.OPENAI_API_KEY);
    try { openai = new OpenAI({ apiKey: OPENAI_KEY }); } catch(e) {}
  }
  if (keys.ELEVENLABS_API_KEY) { ELEVENLABS_KEY = cleanKey(keys.ELEVENLABS_API_KEY); }
  if (keys.PEXELS_API_KEY) { PEXELS_KEY = cleanKey(keys.PEXELS_API_KEY); }
  if (keys.YOUTUBE_CLIENT_ID) { oauth2Client._clientId = keys.YOUTUBE_CLIENT_ID; }
  if (keys.YOUTUBE_CLIENT_SECRET) { oauth2Client._clientSecret = keys.YOUTUBE_CLIENT_SECRET; }
  if (keys.YOUTUBE_REFRESH_TOKEN) {
    youtubeTokens = { refresh_token: keys.YOUTUBE_REFRESH_TOKEN };
    oauth2Client.setCredentials(youtubeTokens);
    console.log('[Settings] YouTube refresh_token 적용');
  }
  console.log('[Settings] 사용자 API 키 적용 완료');
}

// ========================
// Settings (API Key 관리)
// ========================
function maskKey(key) {
  if (!key || key.length < 8) return '';
  return key.substring(0, 6) + '•'.repeat(Math.min(key.length - 10, 20)) + key.substring(key.length - 4);
}

app.get('/api/settings/status', (req, res) => {
  res.json({
    success: true,
    database: !!db,
    dbEnvKeys: Object.keys(process.env).filter(k => /database|postgres|pg/i.test(k)),
    loggedIn: !!googleUser,
    userEmail: googleUser?.email || null,
    keys: {
      anthropic: !!ANTHROPIC_KEY,
      openai: !!OPENAI_KEY,
      elevenlabs: !!ELEVENLABS_KEY,
      pexels: !!PEXELS_KEY,
      runway: !!process.env.RUNWAYML_API_KEY,
      falai: !!process.env.FALAI_API_KEY,
      youtube: !!process.env.YOUTUBE_CLIENT_ID
    },
    masked: {
      anthropic: ANTHROPIC_KEY ? maskKey(ANTHROPIC_KEY) : '',
      openai: OPENAI_KEY ? maskKey(OPENAI_KEY) : '',
      elevenlabs: ELEVENLABS_KEY ? maskKey(ELEVENLABS_KEY) : '',
      pexels: PEXELS_KEY ? maskKey(PEXELS_KEY) : '',
      runway: process.env.RUNWAYML_API_KEY ? maskKey(process.env.RUNWAYML_API_KEY) : '',
      falai: process.env.FALAI_API_KEY ? maskKey(process.env.FALAI_API_KEY) : '',
      ytClientId: process.env.YOUTUBE_CLIENT_ID ? maskKey(process.env.YOUTUBE_CLIENT_ID) : ''
    }
  });
});

app.post('/api/settings/save', async (req, res) => {
  try {
    const updates = req.body || {};
    const envKeys = ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'ELEVENLABS_API_KEY', 'PEXELS_API_KEY',
                     'RUNWAYML_API_KEY', 'FALAI_API_KEY',
                     'YOUTUBE_CLIENT_ID', 'YOUTUBE_CLIENT_SECRET', 'YOUTUBE_REDIRECT_URI', 'YOUTUBE_REFRESH_TOKEN', 'PORT'];

    // 1. 메모리에 즉시 반영 (가장 중요)
    const keysToApply = {};
    for (const [key, value] of Object.entries(updates)) {
      if (envKeys.includes(key) && value) { process.env[key] = value; keysToApply[key] = value; }
    }
    applyUserKeys(keysToApply);

    // 2. DB에 사용자별 저장 (영구 보존)
    let dbSaved = false;
    if (googleUser?.email) {
      try {
        await saveUserKeysDB(googleUser.email, keysToApply, googleUser.name, googleUser.picture);
        dbSaved = true;
        console.log(`[Settings] DB 저장: ${googleUser.email}`);
      } catch(e) { console.warn('[Settings] DB 저장 실패:', e.message); }
    }

    // 3. .env 파일 저장 (로컬용, 실패해도 무시)
    try {
      const envPath = path.join(__dirname, '.env');
      let envContent = '';
      if (fs.existsSync(envPath)) envContent = fs.readFileSync(envPath, 'utf-8');
      for (const [key, value] of Object.entries(keysToApply)) {
        const regex = new RegExp(`^${key}=.*$`, 'm');
        if (regex.test(envContent)) envContent = envContent.replace(regex, `${key}=${value}`);
        else envContent += `\n${key}=${value}`;
      }
      if (!envContent.includes('PORT=')) envContent += '\nPORT=3003';
      fs.writeFileSync(envPath, envContent.trim() + '\n', 'utf-8');
      console.log('[Settings] .env 저장 완료');
    } catch(e) {
      console.warn('[Settings] .env 저장 실패 (Railway 읽기 전용?):', e.message);
    }

    console.log('[Settings] 즉시 반영 완료');
    res.json({ success: true, message: 'API 키 저장 완료.', dbSaved });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ========================
// Google Login (프로필 표시용)
// ========================
let googleUser = null;

app.get('/api/google/auth', (req, res) => {
  if (!process.env.YOUTUBE_CLIENT_ID) {
    if (req.query.json === '1') {
      return res.json({ success: false, error: 'YOUTUBE_CLIENT_ID 미설정. API 설정에서 YouTube OAuth Client ID를 입력하세요.' });
    }
    return res.send(`<html><head><meta charset="UTF-8"></head>
    <body style="background:#0f0f13;color:#fff;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0">
      <div style="text-align:center;max-width:380px;padding:20px">
        <div style="font-size:48px;margin-bottom:12px">⚠️</div>
        <h2 style="margin:0 0 12px;font-size:16px">Google 로그인 미설정</h2>
        <p style="color:#9898a8;font-size:12px;line-height:1.7">Railway Variables에<br><code style="background:#1c1c26;padding:2px 6px;border-radius:4px;color:#ff3b3b">YOUTUBE_CLIENT_ID</code>와<br><code style="background:#1c1c26;padding:2px 6px;border-radius:4px;color:#ff3b3b">YOUTUBE_CLIENT_SECRET</code>을<br>설정 후 Deploy 해주세요.</p>
        <button onclick="window.close()" style="margin-top:16px;background:#ff3b3b;color:#fff;border:none;padding:8px 24px;border-radius:8px;font-size:12px;cursor:pointer">닫기</button>
      </div>
    </body></html>`);
  }
  // 동적 redirect URI: 요청 호스트 기반
  const host = req.get('host');
  const protocol = req.get('x-forwarded-proto') || req.protocol;
  const dynamicRedirect = cleanKey(process.env.YOUTUBE_REDIRECT_URI) || `${protocol}://${host}/api/google/callback`;
  console.log(`[OAuth auth] redirect_uri: ${dynamicRedirect}`);
  oauth2Client._redirectUri = dynamicRedirect;

  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: [
      'https://www.googleapis.com/auth/userinfo.profile',
      'https://www.googleapis.com/auth/userinfo.email',
      'https://www.googleapis.com/auth/youtube.upload',
      'https://www.googleapis.com/auth/youtube'
    ],
    prompt: 'consent',
    redirect_uri: dynamicRedirect
  });
  if (req.query.json === '1') {
    res.json({ authUrl });
  } else {
    res.redirect(authUrl);
  }
});

app.get('/api/google/callback', async (req, res) => {
  try {
    const { code } = req.query;
    // 동적 redirect URI 설정 (getToken 시 필요)
    const host = req.get('host');
    const protocol = req.get('x-forwarded-proto') || req.protocol;
    const dynamicRedirect = cleanKey(process.env.YOUTUBE_REDIRECT_URI) || `${protocol}://${host}/api/google/callback`;
    console.log(`[OAuth callback] redirect_uri: ${dynamicRedirect}`);
    const { tokens } = await oauth2Client.getToken({ code, redirect_uri: dynamicRedirect });
    console.log('[OAuth callback] 토큰 수신:', { hasAccess: !!tokens.access_token, hasRefresh: !!tokens.refresh_token, expiry: tokens.expiry_date });
    tokens._source = 'oauth_callback';
    oauth2Client.setCredentials(tokens);
    youtubeTokens = tokens;
    try { fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens, null, 2)); } catch(e) {}
    if (tokens.refresh_token) {
      try {
        const envPath = path.join(__dirname, '.env');
        let envContent = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf-8') : '';
        if (envContent.match(/^YOUTUBE_REFRESH_TOKEN=.*/m)) {
          envContent = envContent.replace(/^YOUTUBE_REFRESH_TOKEN=.*/m, `YOUTUBE_REFRESH_TOKEN=${tokens.refresh_token}`);
        } else {
          envContent += `\nYOUTUBE_REFRESH_TOKEN=${tokens.refresh_token}`;
        }
        fs.writeFileSync(envPath, envContent);
        process.env.YOUTUBE_REFRESH_TOKEN = tokens.refresh_token;
        console.log('[OAuth] refresh_token .env 저장 완료');
      } catch(e) { console.warn('[OAuth] .env 저장 실패:', e.message); }
    }
    // DB에 토큰 저장 (Railway 재배포 대비)
    if (db) {
      try {
        await db.query(`CREATE TABLE IF NOT EXISTS oauth_tokens (id VARCHAR(50) PRIMARY KEY, tokens JSONB, updated_at TIMESTAMP DEFAULT NOW())`);
        await db.query(`INSERT INTO oauth_tokens (id, tokens, updated_at) VALUES ('youtube', $1, NOW()) ON CONFLICT (id) DO UPDATE SET tokens = $1, updated_at = NOW()`, [JSON.stringify(tokens)]);
        console.log('[OAuth] YouTube 토큰 DB 저장');
      } catch(e) { console.warn('[OAuth] 토큰 DB 저장 실패:', e.message); }
    }

    // 프로필 가져오기
    const profileRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${tokens.access_token}` }
    });
    if (profileRes.ok) {
      googleUser = await profileRes.json();
      console.log(`[Google] 로그인: ${googleUser.name} (${googleUser.email})`);
      // 사용자별 저장된 API 키 자동 로드 (DB 우선)
      const userKeys = await loadUserKeysDB(googleUser.email);
      if (userKeys) {
        applyUserKeys(userKeys);
        console.log(`[Google] 사용자 API 키 자동 로드: ${googleUser.email}`);
      }
    }

    res.send(`<html><body style="background:#0f0f13;color:#fff;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0">
      <div style="text-align:center">
        <div style="font-size:48px;margin-bottom:12px">✅</div>
        <h2 style="margin:0 0 8px">Google 로그인 완료!</h2>
        <p style="color:#999;font-size:14px">${googleUser?.name || ''}</p>
        <p style="color:#666;font-size:12px">이 창은 자동으로 닫힙니다</p>
      </div>
      <script>window.opener?.postMessage('google-login-success','*');setTimeout(()=>window.close(),1500)</script>
    </body></html>`);
  } catch (error) {
    res.status(500).send(`<html><body style="background:#0f0f13;color:#ff3b3b;font-family:sans-serif;padding:40px"><h2>인증 오류</h2><p>${error.message}</p></body></html>`);
  }
});

app.get('/api/google/profile', (req, res) => {
  if (googleUser) {
    res.json({ loggedIn: true, name: googleUser.name, email: googleUser.email, picture: googleUser.picture });
  } else {
    res.json({ loggedIn: false });
  }
});

app.get('/api/google/logout', (req, res) => {
  googleUser = null;
  res.json({ success: true });
});

// ========================
// YouTube OAuth2 + Upload
// ========================
app.get('/api/youtube/auth', (req, res) => {
  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: [
      'https://www.googleapis.com/auth/youtube.upload',
      'https://www.googleapis.com/auth/youtube'
    ],
    prompt: 'consent'
  });
  res.json({ success: true, authUrl });
});

app.get('/api/youtube/callback', async (req, res) => {
  try {
    const { code } = req.query;
    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);
    youtubeTokens = tokens;
    fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens, null, 2));
    res.send('<html><body><h2>YouTube 연동 완료!</h2><p>이 창을 닫고 대시보드로 돌아가세요.</p><script>window.close()</script></body></html>');
  } catch (error) {
    res.status(500).send(`인증 오류: ${error.message}`);
  }
});

app.get('/api/youtube/status', async (req, res) => {
  // 항상 DB에서 최신 토큰 복원
  if (db) {
    try {
      const r = await db.query(`SELECT tokens, updated_at FROM oauth_tokens WHERE id = 'youtube'`);
      if (r.rows.length && r.rows[0].tokens) {
        const dbTokens = typeof r.rows[0].tokens === 'string' ? JSON.parse(r.rows[0].tokens) : r.rows[0].tokens;
        youtubeTokens = dbTokens;
        oauth2Client.setCredentials(dbTokens);
      }
    } catch(e) {}
  }

  // access_token 없거나 만료됐으면 refresh 시도
  let refreshResult = null;
  const c = oauth2Client.credentials || {};
  const needRefresh = !c.access_token || !c.expiry_date || Date.now() >= c.expiry_date - 60000;
  if (youtubeTokens?.refresh_token && needRefresh) {
    try {
      const tokenRes = await oauth2Client.getAccessToken();
      refreshResult = tokenRes.token ? 'success' : 'no_token';
      // 갱신 성공 → DB에 최신 토큰 저장
      if (tokenRes.token && db) {
        try {
          const merged = { ...youtubeTokens, ...oauth2Client.credentials };
          youtubeTokens = merged;
          await db.query(`INSERT INTO oauth_tokens (id, tokens, updated_at) VALUES ('youtube', $1, NOW()) ON CONFLICT (id) DO UPDATE SET tokens = $1, updated_at = NOW()`, [JSON.stringify(merged)]);
        } catch(e) {}
      }
    } catch(e) {
      refreshResult = e.message;
      // invalid_grant = refresh_token 무효 (재로그인 필요)
      if (e.message?.includes('invalid_grant')) {
        refreshResult = 'invalid_grant: 재로그인 필요';
      }
    }
  }

  const creds = oauth2Client.credentials || {};
  const expiryDate = creds.expiry_date ? new Date(creds.expiry_date).toISOString() : null;
  const isExpired = creds.expiry_date ? Date.now() >= creds.expiry_date : true;
  res.json({
    authenticated: !!youtubeTokens,
    hasRefreshToken: !!youtubeTokens?.refresh_token,
    hasAccessToken: !!creds.access_token,
    accessTokenExpiry: expiryDate,
    accessTokenExpired: isExpired,
    hasClientId: !!process.env.YOUTUBE_CLIENT_ID,
    tokenSource: youtubeTokens?._source || 'unknown',
    refreshResult
  });
});

app.post('/api/youtube/upload', async (req, res) => {
  try {
    // DB에서 토큰 복원 시도 (Railway 재배포 대비)
    if (!youtubeTokens && db) {
      try {
        const r = await db.query(`SELECT tokens FROM oauth_tokens WHERE id = 'youtube'`);
        if (r.rows.length && r.rows[0].tokens) {
          youtubeTokens = typeof r.rows[0].tokens === 'string' ? JSON.parse(r.rows[0].tokens) : r.rows[0].tokens;
          oauth2Client.setCredentials(youtubeTokens);
          console.log('[YouTube Upload] DB에서 토큰 복원 ✅');
        }
      } catch(e) { console.warn('[YouTube Upload] DB 토큰 복원 실패:', e.message); }
    }
    if (!youtubeTokens) throw new Error('YouTube 인증이 필요합니다. 먼저 OAuth 인증을 완료하세요.');
    console.log('[YouTube Upload] 토큰 상태:', { hasRefresh: !!youtubeTokens.refresh_token, hasAccess: !!youtubeTokens.access_token });

    const { projectId, title, description, tags, categoryId, privacyStatus, thumbnailFile } = req.body;
    const project = getProject(projectId);

    const videoFiles = fs.readdirSync(path.join(OUTPUT_DIR, 'video'))
      .filter(f => f.endsWith('.mp4'))
      .sort()
      .reverse();

    if (videoFiles.length === 0) {
      const videoDir = path.join(OUTPUT_DIR, 'video');
      const allFiles = fs.existsSync(videoDir) ? fs.readdirSync(videoDir) : [];
      throw new Error(`업로드할 영상 파일이 없습니다. video/ 폴더: [${allFiles.join(', ')||'비어있음'}], OUTPUT_DIR: ${OUTPUT_DIR}`);
    }

    const videoPath = path.join(OUTPUT_DIR, 'video', project.videoFile || videoFiles[0]);

    const fileSize = fs.statSync(videoPath).size;
    console.log(`[YouTube] 업로드 시작: ${videoPath} (${(fileSize/1024/1024).toFixed(1)}MB)`);

    // Resumable Upload (googleapis 2MB 제한 우회)
    let accessToken;

    // 1) 현재 access_token이 유효하면 그대로 사용
    const creds = oauth2Client.credentials;
    if (creds?.access_token && creds?.expiry_date && Date.now() < creds.expiry_date - 60000) {
      accessToken = creds.access_token;
      console.log('[YouTube] 기존 access_token 사용 (만료까지', Math.round((creds.expiry_date - Date.now())/60000), '분)');
    }

    // 2) 만료됐으면 refresh 시도
    if (!accessToken) {
      try {
        const tokenRes = await oauth2Client.getAccessToken();
        accessToken = tokenRes.token;
        console.log('[YouTube] access_token 갱신 성공');
      } catch (tokenErr) {
        console.error('[YouTube] 토큰 갱신 실패:', tokenErr.message);

        // 3) DB에서 최신 토큰 복원 후 재시도
        if (db && tokenErr.message?.includes('invalid_grant')) {
          console.log('[YouTube] DB에서 최신 토큰 복원 시도...');
          try {
            const r = await db.query(`SELECT tokens FROM oauth_tokens WHERE id = 'youtube'`);
            if (r.rows.length && r.rows[0].tokens) {
              const dbTokens = typeof r.rows[0].tokens === 'string' ? JSON.parse(r.rows[0].tokens) : r.rows[0].tokens;
              // DB 토큰이 현재와 다르면 재시도
              if (dbTokens.refresh_token && dbTokens.refresh_token !== youtubeTokens?.refresh_token) {
                youtubeTokens = dbTokens;
                oauth2Client.setCredentials(dbTokens);
                console.log('[YouTube] DB 토큰으로 교체, 재시도...');
                const retryRes = await oauth2Client.getAccessToken();
                accessToken = retryRes.token;
              }
            }
          } catch(e2) {
            console.error('[YouTube] DB 복원 재시도 실패:', e2.message);
          }
        }

        if (!accessToken) {
          youtubeTokens = null;
          try { fs.unlinkSync(TOKEN_PATH); } catch(e) {}
          // DB 토큰도 삭제 (무효화된 토큰 순환 방지)
          if (db) { try { await db.query(`DELETE FROM oauth_tokens WHERE id = 'youtube'`); } catch(e) {} }
          throw new Error('YouTube 인증이 만료되었습니다. 좌측 메뉴에서 Google 로그인을 다시 해주세요.');
        }
      }
    }
    if (!accessToken) {
      throw new Error('YouTube Access Token을 가져올 수 없습니다. Google 로그인을 다시 해주세요.');
    }
    const videoTitle = title || project.meta?.titles?.[0]?.options?.[0] || project.topic || 'Untitled';
    const videoDesc = description || project.meta?.description?.ko || '';
    const videoTags = tags || project.meta?.tags || [];

    // 1단계: 업로드 세션 시작
    const initRes = await fetch('https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'X-Upload-Content-Type': 'video/mp4',
        'X-Upload-Content-Length': String(fileSize)
      },
      body: JSON.stringify({
        snippet: {
          title: videoTitle,
          description: videoDesc,
          tags: videoTags,
          categoryId: categoryId || '22',
          defaultLanguage: 'ko'
        },
        status: {
          privacyStatus: privacyStatus || 'private',
          selfDeclaredMadeForKids: false
        }
      })
    });

    if (!initRes.ok) {
      const err = await initRes.text();
      throw new Error(`YouTube 업로드 세션 실패 (${initRes.status}): ${err.substring(0, 300)}`);
    }

    const uploadUrl = initRes.headers.get('location');
    if (!uploadUrl) throw new Error('YouTube resumable upload URL 없음');
    console.log(`[YouTube] Resumable URL 획득, 파일 전송 시작...`);

    // 2단계: 파일 스트리밍 전송 (대용량 지원)
    console.log(`[YouTube] 스트리밍 업로드 시작 (${(fileSize/1024/1024).toFixed(0)}MB)...`);
    const uploadRes2 = await fetch(uploadUrl, {
      method: 'PUT',
      headers: {
        'Content-Type': 'video/mp4',
        'Content-Length': String(fileSize)
      },
      body: fs.createReadStream(videoPath),
      duplex: 'half'
    });

    if (!uploadRes2.ok) {
      const err = await uploadRes2.text();
      throw new Error(`YouTube 파일 전송 실패 (${uploadRes2.status}): ${err.substring(0, 300)}`);
    }

    const uploadData = await uploadRes2.json();
    const uploadRes = { data: uploadData };
    console.log(`[YouTube] 업로드 완료: ${uploadData.id}`);

    const videoId = uploadRes.data.id;

    // 썸네일: 지정 파일 → 최신 썸네일 자동 감지
    let thumbToUpload = thumbnailFile;
    if (!thumbToUpload) {
      const thumbFiles = listFilesByMtime(path.join(OUTPUT_DIR, 'thumbnails'), f => f.startsWith('thumbnail_') && f.endsWith('.png'));
      if (thumbFiles.length > 0) thumbToUpload = thumbFiles[0];
    }
    if (thumbToUpload) {
      const thumbPath = path.join(OUTPUT_DIR, 'thumbnails', thumbToUpload);
      if (fs.existsSync(thumbPath)) {
        try {
          const thumbBuffer = fs.readFileSync(thumbPath);
          const thumbRes = await fetch(`https://www.googleapis.com/upload/youtube/v3/thumbnails/set?videoId=${videoId}&uploadType=media`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${accessToken}`,
              'Content-Type': 'image/png',
              'Content-Length': String(thumbBuffer.length)
            },
            body: thumbBuffer
          });
          if (thumbRes.ok) console.log(`[YouTube] 썸네일 설정 완료: ${thumbToUpload}`);
          else console.warn(`[YouTube] 썸네일 설정 실패: ${thumbRes.status}`);
        } catch(e) { console.warn('[YouTube] 썸네일 오류:', e.message); }
      }
    }

    res.json({
      success: true,
      videoId,
      videoUrl: `https://www.youtube.com/watch?v=${videoId}`,
      studioUrl: `https://studio.youtube.com/video/${videoId}/edit`
    });
  } catch (error) {
    console.error(`[YouTube] 업로드 실패:`, error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ========================
// 프로젝트 관리
// ========================
app.get('/api/project/:id', (req, res) => {
  const project = getProject(req.params.id);
  res.json({ success: true, project });
});

app.get('/api/files/list', (req, res) => {
  const result = {};
  ['images', 'audio', 'video', 'thumbnails', 'bgm', 'srt', 'clips'].forEach(dir => {
    const dirPath = path.join(OUTPUT_DIR, dir);
    if (!fs.existsSync(dirPath)) { result[dir] = []; return; }
    result[dir] = fs.readdirSync(dirPath).filter(f => !f.endsWith('.txt')).map(f => ({
      name: f,
      url: `/output/${dir}/${f}`,
      size: `${(fs.statSync(path.join(dirPath, f)).size / 1024).toFixed(0)}KB`
    }));
  });
  res.json({ success: true, files: result });
});

// ========================
// FFmpeg Check
// ========================
app.get('/api/system/ffmpeg', (req, res) => {
  execFile('ffmpeg', ['-version'], { timeout: 5000, maxBuffer: 50 * 1024 * 1024 }, (error, stdout) => {
    if (error) {
      res.json({ success: true, installed: false, error: error.message });
    } else {
      const version = stdout.split('\n')[0] || 'unknown';
      res.json({ success: true, installed: true, version });
    }
  });
});

// ========================
// Audio Duration (via ffprobe)
// ========================
app.get('/api/audio/duration/:filename', (req, res) => {
  const filepath = path.join(OUTPUT_DIR, 'audio', req.params.filename);
  if (!fs.existsSync(filepath)) return res.json({ success: false, error: 'File not found' });

  execFile('ffprobe', ['-v', 'quiet', '-print_format', 'json', '-show_format', filepath],
    { timeout: 10000, maxBuffer: 50 * 1024 * 1024 }, (error, stdout) => {
      if (error) return res.json({ success: true, duration: 0 });
      try {
        const info = JSON.parse(stdout);
        res.json({ success: true, duration: parseFloat(info.format.duration || 0) });
      } catch(e) { res.json({ success: true, duration: 0 }); }
    });
});

// ========================
// File Cleanup
// ========================
app.post('/api/files/clean', (req, res) => {
  let deleted = 0;
  ['images', 'audio', 'video', 'thumbnails', 'bgm', 'srt'].forEach(dir => {
    const dirPath = path.join(OUTPUT_DIR, dir);
    fs.readdirSync(dirPath).forEach(f => {
      if (f === '.gitkeep' || f === 'concat.txt') return;
      fs.unlinkSync(path.join(dirPath, f));
      deleted++;
    });
  });
  res.json({ success: true, deleted });
});

// ========================
// 스케줄 제작 (예약 + 반복)
// ========================
const SCHEDULE_PATH = path.join(__dirname, '.schedules.json');
const schedules = {};
let scheduleIdCounter = 1;

// 저장/로드
function saveSchedules() {
  const data = Object.values(schedules).map(s => ({
    id: s.id, topic: s.topic, settings: s.settings,
    type: s.type, datetime: s.datetime, cronExpr: s.cronExpr,
    repeatLabel: s.repeatLabel, status: s.status,
    lastRun: s.lastRun, runCount: s.runCount, createdAt: s.createdAt
  }));
  fs.writeFileSync(SCHEDULE_PATH, JSON.stringify(data, null, 2), 'utf-8');
}
function loadSchedules() {
  if (!fs.existsSync(SCHEDULE_PATH)) return;
  try {
    const data = JSON.parse(fs.readFileSync(SCHEDULE_PATH, 'utf-8'));
    data.forEach(s => {
      schedules[s.id] = { ...s, cronJob: null, timeout: null };
      if (s.id >= scheduleIdCounter) scheduleIdCounter = s.id + 1;
      if (s.status === 'active') activateSchedule(s.id);
    });
    console.log(`[Schedule] ${data.length}개 스케줄 로드`);
  } catch(e) { console.warn('[Schedule] 로드 실패:', e.message); }
}

// 자동 제작 실행 (서버 내부에서 API 호출)
async function executeAutoPipeline(schedule) {
  const s = schedule;
  const settings = s.settings || {};
  console.log(`[Schedule] 실행: "${s.topic || settings.keywords}" (id=${s.id})`);
  s.status = 'running';
  s.lastRun = new Date().toISOString();
  s.runCount = (s.runCount || 0) + 1;
  s.progress = null;
  saveSchedules();

  try {
    const baseUrl = `http://127.0.0.1:${PORT}`;
    const api = async (apiPath, body) => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 600000); // 10분 타임아웃
      try {
        console.log(`[Schedule API] POST ${apiPath}`);
        const r = await fetch(`${baseUrl}${apiPath}`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: controller.signal
        });
        const d = await r.json();
        if (!d.success) throw new Error(d.error || 'API 실패');
        return d;
      } catch(e) {
        if (e.name === 'AbortError') throw new Error(`${apiPath} 타임아웃 (10분 초과)`);
        throw new Error(`${apiPath}: ${e.message}`);
      } finally {
        clearTimeout(timeout);
      }
    };

    const langNames = { ko: '한국어', en: 'English', zh: '中文', ja: '日本語', es: 'Español' };
    const wordCounts = { 1: '300', 3: '950', 5: '1550', 10: '3100', 15: '4650', 20: '6200', 30: '9300' };
    const len = settings.length || '15';
    const lang = settings.language || 'ko';

    // 0. 주제 자동 생성 (키워드 모드)
    let topic = s.topic;
    if (!topic && settings.keywords) {
      console.log(`[Schedule] 0/8 키워드 기반 주제 자동 생성: "${settings.keywords}"`);
      const topicData = await api('/api/topics/suggest', {
        keyword: settings.keywords,
        category: settings.category || '',
        target: '전 연령'
      });
      if (topicData.topics && topicData.topics.length > 0) {
        // 실행 횟수 기반 다른 주제 선택 (순환)
        const idx = (s.runCount - 1) % topicData.topics.length;
        topic = topicData.topics[idx].title;
        console.log(`[Schedule] 자동 주제 선택 [${idx+1}/${topicData.topics.length}]: "${topic}"`);
      } else {
        throw new Error('키워드 기반 주제 생성 실패');
      }
    }
    if (!topic) throw new Error('주제가 없습니다');

    // 진행률 헬퍼
    const steps = ['기획','대본','프롬프트','이미지/영상','TTS','메타데이터','썸네일','영상 합성'];
    function setProgress(step) { s.progress = { step, pct: Math.round((step / 8) * 100), label: steps[step-1] || '' }; }

    // 1. Plan
    setProgress(1);
    console.log(`[Schedule] 1/8 기획: "${topic}"`);
    const planData = await api('/api/plan/generate', {
      topic, target: '전 연령', length: len,
      tone: '진지하고 무게감 있는', style: settings.style || 'european-animation',
      notes: `언어: ${langNames[lang]}`, refText: settings.refText || ''
    });

    // 2. Script
    setProgress(2);
    console.log(`[Schedule] 2/8 대본...`);
    const scriptData = await api('/api/script/generate', {
      topic, target: '전 연령', plan: planData.plan,
      wordCount: wordCounts[len] || '3000', narration: '3인칭 나레이터',
      language: langNames[lang], refText: settings.refText || '', targetMinutes: len
    });

    // 3. Image prompts + generate
    setProgress(3);
    console.log(`[Schedule] 3/8 이미지 프롬프트...`);
    const promptData = await api('/api/images/generate-prompts', {
      script: scriptData.script, style: settings.style || 'european-animation',
      count: settings.imageCount || '8'
    });

    if (settings.sourceMode === 'video') {
      setProgress(4);
      console.log(`[Schedule] 4/8 영상 클립 다운로드...`);
      await api('/api/clips/generate', {
        scenePrompts: promptData.prompts, perSceneDuration: 10,
        ratio: settings.ratio || '16:9'
      });
    } else {
      setProgress(4);
      console.log(`[Schedule] 4/8 이미지 생성...`);
      for (let i = 0; i < promptData.prompts.length; i++) {
        await api('/api/images/generate', {
          prompt: promptData.prompts[i].prompt,
          style: settings.style || 'european-animation',
          ratio: settings.ratio || '16:9', index: i + 1
        });
        if (i < promptData.prompts.length - 1) await new Promise(r => setTimeout(r, 1500));
      }
    }

    // 5. TTS
    setProgress(5);
    console.log(`[Schedule] 5/8 TTS...`);
    await api('/api/tts/full-script', {
      script: scriptData.script, voiceId: settings.voiceId || '',
      stability: settings.stability ?? 1, similarity: settings.similarity ?? 1,
      language: lang
    });

    // 6. Meta
    setProgress(6);
    console.log(`[Schedule] 6/8 메타데이터...`);
    await api('/api/meta/generate', { topic, script: scriptData.script });

    // 7. Thumbnail
    setProgress(7);
    console.log(`[Schedule] 7/8 썸네일...`);
    await api('/api/thumbnail/generate', {
      topic, style: 'dramatic', text: topic,
      ratio: settings.ratio || '16:9'
    });

    // 8. Render
    setProgress(8);
    console.log(`[Schedule] 8/8 영상 합성...`);
    await api('/api/render/video', {
      transition: settings.transition || 'fade',
      transitionDuration: settings.transitionDuration || 0.8,
      kenburns: settings.kenburns || 'varied',
      burnSrt: true, showThumb: true, showIntro: false,
      sourceMode: settings.sourceMode || 'image',
      language: lang, ratio: settings.ratio || '16:9'
    });

    console.log(`[Schedule] ✅ 완료: "${topic}"`);
    s.status = s.type === 'once' ? 'completed' : 'active';
    s.progress = { step: 8, pct: 100, label: '완료' };
    s.lastTopic = topic;
    s.lastError = null;
    saveSchedules();
  } catch(e) {
    console.error(`[Schedule] ❌ 실패: "${topic || s.settings?.keywords}" — ${e.message}`);
    s.status = s.type === 'once' ? 'failed' : 'active';
    s.lastError = e.message;
    saveSchedules();
  }
}

// 스케줄 활성화
function activateSchedule(id) {
  const s = schedules[id];
  if (!s) return;

  if (s.type === 'once' && s.datetime) {
    const delay = new Date(s.datetime).getTime() - Date.now();
    if (delay <= 0) {
      s.status = 'expired';
      saveSchedules();
      return;
    }
    s.timeout = setTimeout(() => executeAutoPipeline(s), delay);
    s.status = 'active';
    console.log(`[Schedule] 예약 등록: "${s.topic}" → ${s.datetime} (${Math.round(delay/60000)}분 후)`);
  } else if (s.type === 'recurring' && s.cronExpr) {
    if (!cron.validate(s.cronExpr)) {
      s.status = 'invalid_cron';
      saveSchedules();
      return;
    }
    s.cronJob = cron.schedule(s.cronExpr, () => executeAutoPipeline(s), { timezone: 'Asia/Seoul' });
    s.status = 'active';
    console.log(`[Schedule] 반복 등록: "${s.topic}" → ${s.cronExpr} (${s.repeatLabel})`);
  }
  saveSchedules();
}

// 스케줄 중지
function deactivateSchedule(id) {
  const s = schedules[id];
  if (!s) return;
  if (s.timeout) { clearTimeout(s.timeout); s.timeout = null; }
  if (s.cronJob) { s.cronJob.stop(); s.cronJob = null; }
  s.status = 'stopped';
  saveSchedules();
}

// API: 스케줄 생성
app.post('/api/schedule/create', (req, res) => {
  try {
    const { topic, type, datetime, cronExpr, repeatLabel, settings } = req.body;
    if (!topic && !(settings && settings.keywords)) throw new Error('주제 또는 키워드를 입력하세요');
    if (type === 'once' && !datetime) throw new Error('예약 시간을 설정하세요');
    if (type === 'recurring' && !cronExpr) throw new Error('반복 주기를 설정하세요');

    const id = scheduleIdCounter++;
    schedules[id] = {
      id, topic, type, datetime: datetime || null,
      cronExpr: cronExpr || null, repeatLabel: repeatLabel || '',
      settings: settings || {},
      status: 'pending', lastRun: null, lastError: null,
      runCount: 0, createdAt: new Date().toISOString(),
      cronJob: null, timeout: null
    };
    activateSchedule(id);
    res.json({ success: true, schedule: { id, topic, type, status: schedules[id].status } });
  } catch(e) {
    res.status(400).json({ success: false, error: e.message });
  }
});

// API: 스케줄 목록
app.get('/api/schedule/list', (req, res) => {
  const list = Object.values(schedules).map(s => ({
    id: s.id, topic: s.topic, type: s.type,
    datetime: s.datetime, cronExpr: s.cronExpr,
    repeatLabel: s.repeatLabel, status: s.status,
    lastRun: s.lastRun, lastError: s.lastError,
    runCount: s.runCount, createdAt: s.createdAt,
    settings: s.settings || {},
    progress: s.progress || null
  }));
  res.json({ success: true, schedules: list });
});

// API: 스케줄 시간 수정
app.post('/api/schedule/:id/update', (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const s = schedules[id];
    if (!s) return res.status(404).json({ success: false, error: '스케줄 없음' });
    if (s.status === 'running') return res.status(400).json({ success: false, error: '실행 중에는 수정 불가' });

    const { datetime, cronExpr, repeatLabel } = req.body;
    // 기존 스케줄 중지
    deactivateSchedule(id);

    if (datetime) {
      s.datetime = datetime;
      s.type = 'once';
    }
    if (cronExpr) {
      s.cronExpr = cronExpr;
      s.repeatLabel = repeatLabel || cronExpr;
      s.type = 'recurring';
    }

    // 재활성화
    activateSchedule(id);
    res.json({ success: true, status: s.status });
  } catch(e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// API: 스케줄 삭제
app.delete('/api/schedule/:id', (req, res) => {
  const id = parseInt(req.params.id);
  deactivateSchedule(id);
  delete schedules[id];
  saveSchedules();
  res.json({ success: true });
});

// API: 스케줄 토글 (활성/중지)
app.post('/api/schedule/:id/toggle', (req, res) => {
  const id = parseInt(req.params.id);
  const s = schedules[id];
  if (!s) return res.status(404).json({ success: false, error: '스케줄 없음' });
  if (s.status === 'active') {
    deactivateSchedule(id);
  } else {
    activateSchedule(id);
  }
  res.json({ success: true, status: s.status });
});

// 서버 시작 시 저장된 스케줄 로드
loadSchedules();

// 서버 시작 시 저장된 사용자 키 로드 (마지막 로그인 사용자)
(async () => {
  try {
    if (db) {
      const r = await db.query('SELECT email, api_keys, name, picture FROM user_settings ORDER BY updated_at DESC LIMIT 1');
      if (r.rows[0]?.api_keys && Object.keys(r.rows[0].api_keys).length > 0) {
        applyUserKeys(r.rows[0].api_keys);
        googleUser = { email: r.rows[0].email, name: r.rows[0].name, picture: r.rows[0].picture };
        console.log(`[Boot] DB에서 사용자 키 로드: ${r.rows[0].email}`);
      }
    } else {
      const all = loadUserSettingsJSON();
      const emails = Object.keys(all);
      if (emails.length > 0) {
        const lastEmail = emails[emails.length - 1];
        applyUserKeys(all[lastEmail]);
        console.log(`[Boot] JSON에서 사용자 키 로드: ${lastEmail}`);
      }
    }
    // YouTube 토큰 복원
    if (db && !youtubeTokens) {
      try {
        const tr = await db.query('SELECT tokens FROM oauth_tokens WHERE id=$1', ['youtube']);
        if (tr.rows[0]?.tokens) {
          youtubeTokens = tr.rows[0].tokens;
          oauth2Client.setCredentials(youtubeTokens);
          console.log('[Boot] DB에서 YouTube 토큰 복원');
        }
      } catch(e) {}
    }
  } catch(e) { console.warn('[Boot] 사용자 키 로드 실패:', e.message); }
})();

// ========================
// ========================
// 관리자 모드
// ========================
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'aura09#$';

app.post('/api/admin/login', (req, res) => {
  const { password } = req.body;
  if (password === ADMIN_PASSWORD) {
    res.json({ success: true });
  } else {
    res.status(401).json({ success: false, error: '비밀번호 오류' });
  }
});

app.post('/api/admin/users', async (req, res) => {
  try {
    const { password } = req.body;
    if (password !== ADMIN_PASSWORD) return res.status(401).json({ success: false, error: '인증 필요' });

    if (!db) return res.json({ success: true, users: [] });

    // user_settings 테이블에서 회원 목록
    const r = await db.query(`
      SELECT email, name, picture, api_keys,
             created_at, updated_at,
             CASE WHEN api_keys IS NOT NULL AND api_keys != '{}'::jsonb THEN true ELSE false END as approved
      FROM user_settings ORDER BY created_at DESC
    `);

    const users = r.rows.map(u => {
      const keys = u.api_keys || {};
      return {
        name: u.name || '미입력',
        email: u.email,
        picture: u.picture || '',
        joinDate: u.created_at,
        lastActive: u.updated_at,
        approved: !!keys._approved,
        hasKeys: Object.keys(keys).filter(k => !k.startsWith('_')).length,
        subscriptionType: keys._subscription || 'none',
        subscriptionStart: keys._subscriptionStart || null,
        subscriptionEnd: keys._subscriptionEnd || null
      };
    });

    res.json({ success: true, users, total: users.length });
  } catch(e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.post('/api/admin/user/delete', async (req, res) => {
  try {
    const { password, email } = req.body;
    if (password !== ADMIN_PASSWORD) return res.status(401).json({ success: false });
    if (!db) return res.json({ success: false, error: 'DB 미연결' });
    await db.query('DELETE FROM user_settings WHERE email=$1', [email]);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ success: false, error: e.message }); }
});

app.post('/api/admin/user/update', async (req, res) => {
  try {
    const { password, email, field, value } = req.body;
    if (password !== ADMIN_PASSWORD) return res.status(401).json({ success: false });
    if (!db) return res.json({ success: false, error: 'DB 미연결' });

    const r = await db.query('SELECT api_keys FROM user_settings WHERE email=$1', [email]);
    if (r.rows[0]) {
      const keys = r.rows[0].api_keys || {};

      if (field === '_subscription') {
        keys._subscription = value;
        const now = new Date();
        keys._subscriptionStart = now.toISOString();
        if (value === 'monthly') {
          keys._subscriptionEnd = new Date(now.setMonth(now.getMonth() + 1)).toISOString();
        } else if (value === 'yearly') {
          keys._subscriptionEnd = new Date(now.setFullYear(now.getFullYear() + 1)).toISOString();
        } else {
          keys._subscriptionStart = null;
          keys._subscriptionEnd = null;
        }
        // 구독 시 자동 승인
        if (value !== 'none') keys._approved = true;
      } else {
        keys[field] = value;
      }

      await db.query('UPDATE user_settings SET api_keys=$1, updated_at=NOW() WHERE email=$2', [JSON.stringify(keys), email]);
    }
    res.json({ success: true });
  } catch(e) { res.status(500).json({ success: false, error: e.message }); }
});

// ========================
// Runway API
// ========================
const RUNWAY_API_BASE = 'https://api.dev.runwayml.com/v1';

async function runwayFetch(path, method='GET', body=null, apiKey=null) {
  const key = apiKey || process.env.RUNWAYML_API_KEY;
  if (!key) throw new Error('RUNWAYML_API_KEY 미설정. 설정에서 API 키를 입력하세요.');
  const opts = {
    method,
    headers: {
      'Authorization': `Bearer ${key}`,
      'X-Runway-Version': '2024-11-06',
      'Content-Type': 'application/json'
    }
  };
  if (body) opts.body = JSON.stringify(body);
  const r = await fetch(`${RUNWAY_API_BASE}${path}`, opts);
  const data = await r.json();
  if (!r.ok) {
    console.error('[Runway] API 오류', r.status, JSON.stringify(data));
    throw new Error(`Runway API ${r.status}: ${JSON.stringify(data)}`);
  }
  return data;
}

// localhost URL → base64 data URI 변환 (Runway는 공개 URL만 허용)
async function toPublicImageUri(imageUrl) {
  if (!imageUrl) return null;
  // localhost 또는 127.0.0.1인 경우 파일에서 직접 읽어 base64 변환
  if (/localhost|127\.0\.0\.1/.test(imageUrl)) {
    try {
      // URL에서 파일 경로 추출: /output/images/scene_001.png → OUTPUT_DIR/images/scene_001.png
      const urlPath = new URL(imageUrl).pathname;
      const relPath = urlPath.replace(/^\/output\//, '');
      const filePath = path.join(OUTPUT_DIR, relPath);
      const buf = fs.readFileSync(filePath);
      const ext = path.extname(filePath).slice(1).toLowerCase() || 'png';
      const mime = ext === 'jpg' ? 'image/jpeg' : `image/${ext}`;
      return `data:${mime};base64,${buf.toString('base64')}`;
    } catch(e) {
      console.error('[Runway] base64 변환 실패:', e.message);
      return null;
    }
  }
  return imageUrl;
}

// 이미지 → 영상
app.post('/api/runway/image-to-video', async (req, res) => {
  try {
    const { imageUrl, promptText, prompt, duration=5, ratio='1280:768', apiKey } = req.body;
    const resolvedPrompt = promptText || prompt || '';
    const resolvedImage = await toPublicImageUri(imageUrl);
    const body = { model: 'gen3a_turbo', duration, ratio };
    if (resolvedImage) body.promptImage = resolvedImage;
    if (resolvedPrompt) body.promptText = resolvedPrompt;
    if (!body.promptImage && !body.promptText) return res.status(400).json({ success: false, error: '이미지 URL 또는 프롬프트 필요' });
    console.log(`[Runway] image-to-video 요청 (이미지: ${resolvedImage ? (resolvedImage.startsWith('data:') ? 'base64' : resolvedImage) : '없음'})`);
    const data = await runwayFetch('/image_to_video', 'POST', body, apiKey);
    res.json({ success: true, taskId: data.id, status: data.status });
  } catch(e) { console.error('[Runway] image-to-video 오류:', e.message); res.status(500).json({ success: false, error: e.message }); }
});

// 장면별 Runway 전용 motion prompt 생성 (Claude)
app.post('/api/runway/generate-prompts', async (req, res) => {
  try {
    const { script, scenes } = req.body;
    if (!scenes || !scenes.length) return res.status(400).json({ success: false, error: 'scenes 필요' });
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return res.status(400).json({ success: false, error: 'ANTHROPIC_API_KEY 미설정' });

    const sceneList = scenes.map((s, i) => `장면 ${i+1}: ${s.name||''}\n이미지 프롬프트: ${s.prompt||s.description||''}`).join('\n\n');
    const systemPrompt = `당신은 Runway Gen-3 AI 영상 생성 전문가입니다. 각 장면에 대해 Runway image-to-video에 최적화된 영상 모션 프롬프트를 작성하세요.

Runway 프롬프트 규칙:
- 카메라 움직임 명시 (slow pan, zoom in, drone shot, tracking shot 등)
- 구체적인 동작과 분위기 묘사
- 영어로 작성, 40~80단어
- 시네마틱하고 역동적으로`;

    const userMsg = `대본 요약:\n${(script||'').slice(0,500)}\n\n장면 목록:\n${sceneList}\n\n각 장면에 대해 JSON 배열로 Runway 프롬프트를 반환하세요:\n[{"scene":1,"runwayPrompt":"..."},...]`;

    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 2000,
        system: systemPrompt,
        messages: [{ role: 'user', content: userMsg }]
      })
    });
    const data = await resp.json();
    const text = data.content?.[0]?.text || '';
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) throw new Error('JSON 파싱 실패: ' + text.slice(0, 200));
    const prompts = JSON.parse(jsonMatch[0]);
    res.json({ success: true, prompts });
  } catch(e) {
    console.error('[Runway] generate-prompts 오류:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

// 텍스트+이미지 → 영상 (gen3a_turbo, promptImage 필수)
app.post('/api/runway/text-to-video', async (req, res) => {
  try {
    const { prompt, promptImage, duration=5, ratio='1280:768', apiKey } = req.body;
    if (!prompt) return res.status(400).json({ success: false, error: '프롬프트 필요' });
    if (!promptImage) return res.status(400).json({ success: false, error: 'promptImage 필요 (Runway image_to_video는 이미지 필수)' });
    const body = { model: 'gen3a_turbo', promptText: prompt, promptImage, duration, ratio };
    console.log('[Runway] image-to-video 요청 (promptImage 앞 50자):', typeof promptImage === 'string' ? promptImage.slice(0,50) : 'array');
    const data = await runwayFetch('/image_to_video', 'POST', body, apiKey);
    res.json({ success: true, taskId: data.id, status: data.status });
  } catch(e) {
    console.error('[Runway] text-to-video 오류:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

// 작업 상태 폴링
app.get('/api/runway/status/:taskId', async (req, res) => {
  try {
    const { taskId } = req.params;
    const apiKey = req.query.apiKey || process.env.RUNWAYML_API_KEY;
    const data = await runwayFetch(`/tasks/${taskId}`, 'GET', null, apiKey);
    res.json({
      success: true, taskId: data.id,
      status: data.status, // PENDING|RUNNING|SUCCEEDED|FAILED|THROTTLED
      videoUrl: data.output?.[0] || null,
      progress: data.progress || 0
    });
  } catch(e) { res.status(500).json({ success: false, error: e.message }); }
});

// ========================
// fal.ai Wan2.1 이미지→영상
// ========================
const FAL_API_BASE = 'https://queue.fal.run/fal-ai/wan/v2.1/i2v';

async function falFetch(path, method='GET', body=null, apiKey=null) {
  const key = apiKey || process.env.FALAI_API_KEY;
  if (!key) throw new Error('FALAI_API_KEY 미설정. 설정에서 API 키를 입력하세요.');
  const opts = { method, headers: { 'Authorization': `Key ${key}`, 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  const r = await fetch(`${FAL_API_BASE}${path}`, opts);
  const d = await r.json();
  if (!r.ok) throw new Error(d?.detail || d?.error || `fal.ai 오류 ${r.status}`);
  return d;
}

// fal.ai 이미지→영상 생성 요청
app.post('/api/falai/image-to-video', async (req, res) => {
  req.setTimeout(120000); res.setTimeout(120000);
  try {
    const { imageUrl, prompt, duration=5, ratio='16:9', apiKey } = req.body;
    if (!imageUrl) return res.status(400).json({ success: false, error: 'imageUrl 필요' });
    const aspectRatio = ratio === '9:16' ? '9:16' : ratio === '1:1' ? '1:1' : '16:9';
    const data = await falFetch('', 'POST', {
      image_url: imageUrl,
      prompt: prompt || 'cinematic smooth motion',
      duration: String(Math.min(duration, 5)), // Wan2.1 최대 5초
      resolution: '480p',
      aspect_ratio: aspectRatio
    }, apiKey);
    res.json({ success: true, requestId: data.request_id, statusUrl: data.status_url, responseUrl: data.response_url });
  } catch(e) { res.status(500).json({ success: false, error: e.message }); }
});

// fal.ai JSON 안전 파싱 헬퍼
async function falSafeJson(r) {
  const text = await r.text();
  if (!text || !text.trim()) return {};
  try { return JSON.parse(text); } catch(e) {
    console.error('[fal.ai] JSON parse error:', e.message, '| HTTP:', r.status, '| body:', text.substring(0, 200));
    throw new Error(`fal.ai 응답 파싱 실패 (HTTP ${r.status}): ${text.substring(0, 100)}`);
  }
}

// fal.ai 상태 폴링
app.get('/api/falai/status/:requestId', async (req, res) => {
  try {
    const key = req.query.apiKey || process.env.FALAI_API_KEY;
    if (!key) return res.status(400).json({ success: false, error: 'FALAI_API_KEY 미설정' });
    const statusUrl = req.query.statusUrl || `${FAL_API_BASE}/requests/${req.params.requestId}/status`;
    const r = await fetch(statusUrl, {
      headers: { 'Authorization': `Key ${key}` }
    });
    const d = await falSafeJson(r);
    if (!r.ok) return res.status(r.status).json({ success: false, error: d?.detail || d?.error || `fal.ai HTTP ${r.status}` });
    const videoUrl = d?.output?.video?.url || d?.output?.url || d?.video?.url
      || d?.video?.url || d?.url || null;
    if (d.status === 'COMPLETED') console.log('[fal.ai COMPLETED] raw:', JSON.stringify(d).substring(0,500));
    res.json({ success: true, status: d.status || 'IN_QUEUE', queue_position: d.queue_position, logs: d.logs, videoUrl, output: d.output ?? null, _fal: d.status === 'COMPLETED' ? d : undefined });
  } catch(e) { res.status(500).json({ success: false, error: e.message }); }
});

// fal.ai 결과 조회
app.get('/api/falai/result/:requestId', async (req, res) => {
  try {
    const key = req.query.apiKey || process.env.FALAI_API_KEY;
    if (!key) return res.status(400).json({ success: false, error: 'FALAI_API_KEY 미설정' });
    const responseUrl = req.query.responseUrl || `${FAL_API_BASE}/requests/${req.params.requestId}/response`;
    const r = await fetch(responseUrl, {
      headers: { 'Authorization': `Key ${key}` }
    });
    const d = await falSafeJson(r);
    console.log('[fal.ai result] HTTP', r.status, 'keys:', Object.keys(d||{}), 'raw:', JSON.stringify(d).substring(0,300));
    if (!r.ok) return res.status(r.status).json({ success: false, error: d?.detail || d?.error || `fal.ai HTTP ${r.status}` });
    const videoUrl = d?.video?.url
      || d?.output?.video?.url
      || d?.videos?.[0]?.url
      || d?.output?.url
      || d?.video_url
      || d?.url
      || (d?.output && typeof d.output === 'string' ? d.output : null)
      || null;
    res.json({ success: true, videoUrl, status: d.status, _raw: d });
  } catch(e) { res.status(500).json({ success: false, error: e.message }); }
});

// fal.ai 영상 로컬 다운로드
app.post('/api/falai/download', async (req, res) => {
  req.setTimeout(300000); res.setTimeout(300000);
  try {
    const { videoUrl, index=0 } = req.body;
    if (!videoUrl) return res.status(400).json({ success: false, error: 'videoUrl 필요' });
    const r = await fetch(videoUrl);
    if (!r.ok) throw new Error(`다운로드 실패: ${r.status}`);
    const filename = `falai_${String(index).padStart(3,'0')}.mp4`;
    const clipsDir = path.join(OUTPUT_DIR, 'clips');
    fs.mkdirSync(clipsDir, { recursive: true });
    fs.writeFileSync(path.join(clipsDir, filename), Buffer.from(await r.arrayBuffer()));
    res.json({ success: true, filename, url: `/output/clips/${filename}` });
  } catch(e) { res.status(500).json({ success: false, error: e.message }); }
});

// Runway 영상 로컬 다운로드
app.post('/api/runway/download', async (req, res) => {
  try {
    const { videoUrl, index=0 } = req.body;
    if (!videoUrl) return res.status(400).json({ success: false, error: 'videoUrl 필요' });
    const r = await fetch(videoUrl);
    if (!r.ok) throw new Error(`다운로드 실패: ${r.status}`);
    const filename = `runway_${String(index).padStart(3,'0')}.mp4`;
    const clipsDir = path.join(OUTPUT_DIR, 'clips');
    fs.mkdirSync(clipsDir, { recursive: true });
    const filepath = path.join(clipsDir, filename);
    fs.writeFileSync(filepath, Buffer.from(await r.arrayBuffer()));
    res.json({ success: true, filename, url: `/output/clips/${filename}` });
  } catch(e) { res.status(500).json({ success: false, error: e.message }); }
});

// Start
// ========================
app.listen(PORT, () => {
  console.log(`\n${'='.repeat(50)}`);
  console.log(`  YouTube 롱폼 에이전트 서버`);
  console.log(`  http://localhost:${PORT}`);
  console.log(`${'='.repeat(50)}`);
  console.log(`\n  API 상태:`);
  console.log(`  - Claude API: ${process.env.ANTHROPIC_API_KEY ? '✅' : '❌'}`);
  console.log(`  - GPT Image:  ${process.env.OPENAI_API_KEY ? '✅' : '❌'}`);
  console.log(`  - ElevenLabs: ${process.env.ELEVENLABS_API_KEY ? '✅' : '❌'}`);
  console.log(`  - Runway:     ${process.env.RUNWAYML_API_KEY ? '✅' : '❌'}`);
  console.log(`  - YouTube:    ${process.env.YOUTUBE_CLIENT_ID ? '✅' : '❌'}`);
  console.log(`\n  출력 폴더: ${OUTPUT_DIR}\n`);
});
