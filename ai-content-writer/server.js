// AI 콘텐츠 글쓰기 비서 — 무설치 백엔드 (Node 18+ 내장 http/fetch만 사용)
//
// 역할: ai-content-writer.html 정적 서빙 + Claude API 프록시.
// 프록시가 켜져 있으면(ANTHROPIC_API_KEY 존재) 프론트의 "AI 실연동" 모드가
// 탭별로 진짜 Claude 생성 결과(Markdown)를 받아 렌더링한다.
//
// 실행:
//   PowerShell:  $env:ANTHROPIC_API_KEY="sk-ant-..."; node server.js
//   bash:        ANTHROPIC_API_KEY=sk-ant-... node server.js
//
// 키가 없어도 서버는 뜨고, 프론트는 템플릿 생성 모드로 정상 동작한다.

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { TOOLS, SECTIONS } = require('./tools');
const TOOL_MAP = Object.fromEntries(TOOLS.map((t) => [t.id, t]));

const PORT = process.env.PORT || 8787;
const API_KEY = process.env.ANTHROPIC_API_KEY || '';
const MODEL = process.env.ANTHROPIC_MODEL || 'claude-opus-4-8';
const BASE_URL = process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com';
const HTML_FILE = path.join(__dirname, 'public', 'index.html');

/* ---------- 탭별 생성 지시문 ---------- */
const TAB_PROMPTS = {
  blog: `네이버 블로그 + 구글 SEO 글을 작성하라. 다음 순서로 Markdown 출력:
1) SEO 최적화 제목 10개
2) 클릭 유도 도입문
3) 본문 목차
4) 본문 초안 (소제목 5개, 키워드 자연 삽입)
5) FAQ 5개
6) 메타디스크립션 (155자 이내)
7) 해시태그 20개
8) 네이버 블로그용 마무리 멘트
9) 구글 SEO용 H1/H2/H3 구조화 글`,
  seo: `검색 의도를 반영한 SEO 최적화 제목 10개를 번호 목록으로 작성하라. 클릭을 유도하되 과장하지 말 것.`,
  thread: `스레드(X)용 글타래를 작성하라: 강한 훅 첫 문장 → 5~7개 짧은 포스트 → 저장/공유 유도 마무리 → 해시태그 5개.`,
  thumbtxt: `썸네일/카드뉴스 표지 문구를 5개 카테고리(강한 제목형, 궁금증 유발형, 수익형, 교육형, 카드뉴스 표지)로 각 10개씩, 15자 이내·25자 이내 두 버전을 함께 작성하라.`,
  card: `카드뉴스 8장(표지→문제제기→핵심3장→사례→요약→행동유도)을 작성하라. 각 카드: 제목 / 핵심 문장(20자 이내) / 보조 설명 / 추천 이미지 프롬프트.`,
  community: `외부 유입용 홍보글을 작성하라(과한 광고 톤 금지): 네이버 카페글 / 지식인 답변형 / 커뮤니티 게시글 / 백링크용 요약문 / 댓글 유도 문장 / 카드뉴스 공유 문구 / SNS 짧은 소개글.`,
  youtube: `영상 콘텐츠를 작성하라: 유튜브 제목 10개 / 쇼츠 제목 10개 / 30초 쇼츠 대본 / 1분 쇼츠 대본 / 영상 설명문 / 고정 댓글 / 썸네일 문구 / 해시태그.`,
  prompt: `ChatGPT·Gemini·Claude에 바로 쓸 수 있는 프롬프트 8종(블로그 글쓰기 / 상위노출 / 썸네일 / 카드뉴스 / 스레드 / 키워드 분석 / 요약봇 / 홍보글)을 작성하라.`,
};

const SYSTEM_PROMPT = `너는 한국어 콘텐츠 마케팅 전문가다. 다음 품질 기준을 지켜라:
- 제목은 클릭을 유도하되 과장하지 않는다.
- 본문은 검색 키워드를 자연스럽게 포함한다.
- 네이버 블로그 글은 친근하고 실용적으로, 구글 SEO 글은 구조적·정보 중심으로 작성한다.
- 카드뉴스/썸네일 문구는 짧고 명확하게, 썸네일은 15자·25자 버전을 함께 제공한다.
- 목적별(정보전달/상품홍보/강의홍보/수익형/교육/브랜딩)로 톤을 다르게 한다.
출력은 깔끔한 Markdown만. 잡담·서론 없이 결과만.`;

function buildUserPrompt(d, tab) {
  // tab 이 툴 레지스트리 id 면 그 프롬프트, 아니면 기존 탭 프롬프트
  const tool = TOOL_MAP[tab];
  const inst = tool ? tool.prompt : (TAB_PROMPTS[tab] || TAB_PROMPTS.blog);
  const src = (tool && tool.needsSource && d.sourceText)
    ? `\n\n# 원본 글\n${String(d.sourceText).slice(0, 8000)}` : '';
  return `# 입력
- 주제: ${d.topic}
- 대상 독자: ${d.audience || '일반'}
- 키워드: ${d.keywords || d.topic}
- 글의 목적: ${d.purpose || '정보 전달'}
- 문체: ${d.tone || '친근한'}
- 글자 수: ${d.length || 'mid'}
- 이미지 스타일: ${d.imgStyle || '그라데이션'}

# 작업
${inst}${src}`;
}

/* ---------- Claude 호출 ---------- */
// key: 사용자가 설정에 저장한 자기 키(BYO). 없으면 서버 환경변수 키 사용.
async function callClaude(d, tab, key) {
  const useKey = key || API_KEY;
  const res = await fetch(`${BASE_URL}/v1/messages`, {
    method: 'POST',
    headers: {
      'x-api-key': useKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: d.model || MODEL,
      max_tokens: 8000,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: buildUserPrompt(d, tab) }],
    }),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Claude API ${res.status}: ${t.slice(0, 500)}`);
  }
  const json = await res.json();
  const text = (json.content || [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('\n');
  return { markdown: text, model: json.model, usage: json.usage };
}

/* ---------- HTTP 서버 ---------- */
function sendJson(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' });
  res.end(body);
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on('data', (c) => { chunks.push(c); size += c.length; if (size > 1e6) req.destroy(); });
    req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}
// 네이버 검색 결과의 <b> 태그·HTML 엔티티 제거
function strip(s) {
  return String(s || '').replace(/<[^>]+>/g, '')
    .replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ');
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  // 헬스체크 — Railway/Docker
  if (url.pathname === '/api/health') {
    return sendJson(res, 200, { ok: true });
  }

  // 툴 메뉴 메타(프롬프트 제외) — 클라이언트 메뉴판 렌더용
  if (url.pathname === '/api/tools') {
    return sendJson(res, 200, {
      sections: SECTIONS,
      tools: TOOLS.map((t) => ({ id: t.id, section: t.section, label: t.label, desc: t.desc, needsSource: !!t.needsSource })),
    });
  }

  // 상태 확인 — 프론트가 AI 모드 노출 여부를 결정
  // serverKey: 서버에 환경변수 키가 있으면 별도 입력 없이 AI 사용 가능
  if (url.pathname === '/api/status') {
    return sendJson(res, 200, { enabled: !!API_KEY, serverKey: !!API_KEY, model: API_KEY ? MODEL : null });
  }

  // 생성 프록시
  if (url.pathname === '/api/generate' && req.method === 'POST') {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      chunks.push(c); size += c.length;
      if (size > 1e6) req.destroy(); // 1MB 방어
    });
    req.on('end', async () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8'); // 멀티바이트 청크 분할 대비
        const d = JSON.parse(raw || '{}');
        // 사용자 BYO 키(설정에 저장한 본인 키) 또는 서버 환경변수 키
        const userKey = typeof d.apiKey === 'string' && d.apiKey.startsWith('sk-ant-') ? d.apiKey : '';
        if (!userKey && !API_KEY) return sendJson(res, 503, { error: 'API 키 없음 — 설정에서 Anthropic 키를 입력하거나 서버에 ANTHROPIC_API_KEY를 설정하세요' });
        if (!d.topic) return sendJson(res, 400, { error: '주제(topic) 필요' });
        const out = await callClaude(d, d.tab || 'blog', userKey);
        sendJson(res, 200, out);
      } catch (e) {
        sendJson(res, 500, { error: String(e.message || e) });
      }
    });
    return;
  }

  // 네이버 검색 프록시 (브라우저 CORS 회피, 사용자 저장 키 사용)
  if (url.pathname === '/api/naver/search' && req.method === 'POST') {
    readBody(req).then(async (d) => {
      const { clientId, clientSecret, query } = d;
      const type = ['blog', 'news', 'webkr', 'cafearticle'].includes(d.type) ? d.type : 'blog';
      if (!clientId || !clientSecret) return sendJson(res, 400, { error: '네이버 Client ID/Secret 필요 — 설정에서 입력하세요' });
      if (!query) return sendJson(res, 400, { error: '검색어 필요' });
      const r = await fetch(`https://openapi.naver.com/v1/search/${type}.json?query=${encodeURIComponent(query)}&display=10&sort=sim`, {
        headers: { 'X-Naver-Client-Id': clientId, 'X-Naver-Client-Secret': clientSecret },
      });
      const j = await r.json();
      if (!r.ok) return sendJson(res, r.status, { error: j.errorMessage || `네이버 API ${r.status}` });
      sendJson(res, 200, { items: (j.items || []).map((it) => ({ title: strip(it.title), desc: strip(it.description), link: it.link, date: it.postdate || it.pubDate || '' })) });
    }).catch((e) => sendJson(res, 500, { error: String(e.message || e) }));
    return;
  }

  // 네이버 데이터랩 검색어 트렌드 (상대 비율, 사용자 저장 키)
  if (url.pathname === '/api/naver/datalab' && req.method === 'POST') {
    readBody(req).then(async (d) => {
      const { clientId, clientSecret } = d;
      const kws = (Array.isArray(d.keywords) ? d.keywords : String(d.keywords || '').split(','))
        .map((s) => String(s).trim()).filter(Boolean).slice(0, 5);
      if (!clientId || !clientSecret) return sendJson(res, 400, { error: '네이버 Client ID/Secret 필요 — 설정에서 입력하세요' });
      if (!kws.length) return sendJson(res, 400, { error: '키워드 필요' });
      const end = new Date(); const start = new Date(); start.setFullYear(start.getFullYear() - 1);
      const fmt = (dt) => dt.toISOString().slice(0, 10);
      const r = await fetch('https://openapi.naver.com/v1/datalab/search', {
        method: 'POST',
        headers: { 'X-Naver-Client-Id': clientId, 'X-Naver-Client-Secret': clientSecret, 'Content-Type': 'application/json' },
        body: JSON.stringify({ startDate: fmt(start), endDate: fmt(end), timeUnit: 'month', keywordGroups: kws.map((k) => ({ groupName: k, keywords: [k] })) }),
      });
      const j = await r.json();
      if (!r.ok) return sendJson(res, r.status, { error: j.errorMessage || `데이터랩 ${r.status}` });
      const out = (j.results || []).map((g) => {
        const ratios = (g.data || []).map((p) => p.ratio);
        const last = ratios[ratios.length - 1] || 0;
        const first = ratios[0] || 0;
        const avg = ratios.length ? ratios.reduce((a, b) => a + b, 0) / ratios.length : 0;
        return { keyword: g.title, last: Math.round(last), avg: Math.round(avg), trend: last > first ? '상승' : last < first ? '하락' : '유지', series: ratios.map((v) => Math.round(v)) };
      });
      sendJson(res, 200, { results: out });
    }).catch((e) => sendJson(res, 500, { error: String(e.message || e) }));
    return;
  }

  // 유튜브 검색 프록시 (사용자 저장 Data API 키 사용)
  if (url.pathname === '/api/youtube/search' && req.method === 'POST') {
    readBody(req).then(async (d) => {
      const { key, query } = d;
      if (!key) return sendJson(res, 400, { error: 'YouTube API Key 필요 — 설정에서 입력하세요' });
      if (!query) return sendJson(res, 400, { error: '검색어 필요' });
      const r = await fetch(`https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&maxResults=10&q=${encodeURIComponent(query)}&key=${encodeURIComponent(key)}`);
      const j = await r.json();
      if (!r.ok) return sendJson(res, r.status, { error: (j.error && j.error.message) || `YouTube API ${r.status}` });
      sendJson(res, 200, { items: (j.items || []).map((it) => ({ id: it.id.videoId, title: strip(it.snippet.title), channel: it.snippet.channelTitle, date: it.snippet.publishedAt, thumb: it.snippet.thumbnails && it.snippet.thumbnails.medium ? it.snippet.thumbnails.medium.url : '' })) });
    }).catch((e) => sendJson(res, 500, { error: String(e.message || e) }));
    return;
  }

  // AI 이미지 생성 프록시 (OpenAI gpt-image-1, 사용자 저장 키)
  if (url.pathname === '/api/image' && req.method === 'POST') {
    readBody(req).then(async (d) => {
      const key = typeof d.key === 'string' && d.key.startsWith('sk-') ? d.key : '';
      if (!key) return sendJson(res, 400, { error: 'OpenAI API Key 필요 — 설정에서 입력하세요' });
      if (!d.prompt) return sendJson(res, 400, { error: '프롬프트 필요' });
      const size = ['1024x1024', '1536x1024', '1024x1536'].includes(d.size) ? d.size : '1024x1024';
      const r = await fetch('https://api.openai.com/v1/images/generations', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'gpt-image-1', prompt: String(d.prompt).slice(0, 1000), size, n: 1 }),
      });
      const j = await r.json();
      if (!r.ok) return sendJson(res, r.status, { error: (j.error && j.error.message) || `이미지 API ${r.status}` });
      const b64 = j.data && j.data[0] && j.data[0].b64_json;
      if (!b64) return sendJson(res, 502, { error: '이미지 응답 없음' });
      sendJson(res, 200, { dataUrl: 'data:image/png;base64,' + b64 });
    }).catch((e) => sendJson(res, 500, { error: String(e.message || e) }));
    return;
  }

  // 생성 프록시 (스트리밍 SSE)
  if (url.pathname === '/api/generate/stream' && req.method === 'POST') {
    readBody(req).then(async (d) => {
      const userKey = typeof d.apiKey === 'string' && d.apiKey.startsWith('sk-ant-') ? d.apiKey : '';
      if (!userKey && !API_KEY) return sendJson(res, 503, { error: 'API 키 없음 — 설정에서 Anthropic 키를 입력하세요' });
      if (!d.topic) return sendJson(res, 400, { error: '주제(topic) 필요' });
      res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache', connection: 'keep-alive' });
      try {
        const ar = await fetch(`${BASE_URL}/v1/messages`, {
          method: 'POST',
          headers: { 'x-api-key': userKey || API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
          body: JSON.stringify({ model: d.model || MODEL, max_tokens: 8000, stream: true, system: SYSTEM_PROMPT, messages: [{ role: 'user', content: buildUserPrompt(d, d.tab || 'blog') }] }),
        });
        if (!ar.ok || !ar.body) {
          const t = ar.ok ? '' : await ar.text();
          res.write(`event: error\ndata: ${JSON.stringify({ error: `Claude ${ar.status} ${t.slice(0, 200)}` })}\n\n`);
          return res.end();
        }
        const reader = ar.body.getReader();
        const dec = new TextDecoder();
        let buf = '';
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          let i;
          while ((i = buf.indexOf('\n')) >= 0) {
            const line = buf.slice(0, i); buf = buf.slice(i + 1);
            if (!line.startsWith('data:')) continue;
            const data = line.slice(5).trim();
            if (!data || data === '[DONE]') continue;
            try {
              const ev = JSON.parse(data);
              if (ev.type === 'content_block_delta' && ev.delta && ev.delta.type === 'text_delta') {
                res.write(`data: ${JSON.stringify({ t: ev.delta.text })}\n\n`);
              }
            } catch (_) { /* 부분 JSON 무시 */ }
          }
        }
        res.write('event: done\ndata: {}\n\n');
        res.end();
      } catch (e) {
        res.write(`event: error\ndata: ${JSON.stringify({ error: String(e.message || e) })}\n\n`);
        res.end();
      }
    }).catch((e) => sendJson(res, 500, { error: String(e.message || e) }));
    return;
  }

  // 정적: 루트 또는 HTML
  if (url.pathname === '/' || url.pathname === '/ai-content-writer.html') {
    fs.readFile(HTML_FILE, (err, data) => {
      if (err) {
        res.writeHead(404);
        return res.end('ai-content-writer.html not found');
      }
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(data);
    });
    return;
  }

  res.writeHead(404);
  res.end('Not found');
});

server.listen(PORT, () => {
  console.log(`\n  AI 콘텐츠 글쓰기 비서`);
  console.log(`  → http://localhost:${PORT}`);
  console.log(`  AI 실연동: ${API_KEY ? `ON (model: ${MODEL})` : 'OFF (ANTHROPIC_API_KEY 미설정 → 템플릿 모드)'}\n`);
});
