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
const UPLOAD_DIR = path.join(__dirname, 'uploads');
// 인스타 발행용 공개 베이스 URL(배포 도메인). 미설정 시 요청 host 사용(로컬은 외부 접근 불가).
const PUBLIC_BASE = process.env.PUBLIC_BASE_URL || '';
const IG_VER = 'v21.0';
try { fs.mkdirSync(UPLOAD_DIR, { recursive: true }); } catch (_) {}

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
  naverblog: `네이버 블로그 상위노출용 글을 '친근한 후기·경험담체'로 작성하라(존댓말, 이모지 약간, 체류시간 중심). 구조화·SEO 티를 내지 말고 사람 냄새나게:
1) 네이버 블로그 제목 10개 (클릭 유도, 자연스럽게)
2) 첫 문단 후킹 문장
3) 체류시간을 높이는 도입부
4) 소제목 구성
5) 본문 초안 (경험담·후기·정보 자연스럽게 섞기, 키워드 자연 삽입)
6) 마무리 멘트 + 댓글·공감 유도 문장
7) 해시태그 20개`,
  googleblog: `구글 검색 상위노출용 글을 '구조적·정보 중심·전문체'로 작성하라(검색 의도 충족, 군더더기 없이):
1) SEO 제목 10개
2) H1 제목
3) 검색 의도 분석
4) H2·H3 목차
5) 도입문 (첫 100자 안에 핵심 답)
6) 본문 초안 (H2/H3 구조, 키워드 밀도 적정)
7) FAQ 5개
8) 메타디스크립션 (155자)
9) URL 슬러그 + 내부링크 추천 문장 + 관련/롱테일 키워드`,
  'naverblog-html': `네이버 블로그 에디터에 붙여넣을 '잡지처럼 화려하고 파격적인 본문 HTML'을 생성하라. 평범하지 않게, 시각적으로 강렬하게 디자인하라.

[필수 디자인 요소 — 최대한 풍부하게]
- 🎬 히어로 헤더: 그라데이션 배경(linear-gradient) + 큰 제목(font-size 28~34px, 굵게) + 이모지 + 한 줄 후킹. 둥근 모서리(border-radius 16px), 안쪽 여백 넉넉히.
- 📊 핵심 수치/포인트 카드: 큰 숫자(font-size 40px, 컬러)나 키워드를 배경색 카드(box-shadow, border-radius)에 담아 강조.
- 🟢 섹션마다 이모지 소제목 + 좌측 굵은 컬러 바(border-left:6px). h2는 22~26px.
- 💬 형광펜 강조: 중요한 구절은 <span style="background:#d4f8d4;padding:2px 6px;border-radius:4px;font-weight:700">…</span> 처럼 배경 형광펜.
- ✅ 체크리스트: 항목마다 ✅/👉 이모지 + 연배경 박스.
- 1️⃣ 단계 카드: 번호 원형 뱃지(원형 배경, 흰 글씨) + 설명.
- 📌 콜아웃/팁 박스: 연한 배경 + 좌측 컬러 바 + 이모지, 둥근 모서리.
- ❝ 인용/포인트: 큰 따옴표 스타일 풀쿼트(이탤릭, 컬러).
- 📋 표: 헤더 행 배경색(컬러)+흰 글씨, 줄무늬 배경.
- 🔘 마무리 CTA 박스: 그라데이션 배경의 버튼풍 박스(둥근, 굵은 글씨).
- 📷 이미지 자리: 점선 박스 + '📷 이미지 추천: …'.

[톤·색상] 친근한 후기·정보체, 존댓말, 이모지 적극 사용. 네이버 그린 계열(#03c75a 메인) + 따뜻한 보조색(연녹·연노랑·연분홍). 폰트 크기 대비 크게(소제목 vs 본문), 여백 넉넉히, 둥근 모서리·그림자.
[규칙] 모든 스타일 inline style만(class/외부CSS 금지). 본문 요소만(html/head/body 래퍼 금지). 출력은 HTML 코드만, 코드펜스(\`\`\`)·설명 금지.`,
  'googleblog-html': `구글 SEO 최적 + '세련되고 파격적인 매거진형 본문 HTML'을 생성하라. 정보 신뢰감과 시각적 임팩트를 동시에.

[필수 디자인 요소]
- 🏛 히어로 헤더: 딥블루 그라데이션 배경 + H1(28~34px) + 이모지 + 핵심 요약 한 줄. 둥근 모서리.
- 🔎 검색 의도 요약 박스(상단): 연청 배경 카드에 '이 글의 핵심' 3줄.
- 📑 목차: 번호 + 앵커 링크 리스트를 연회색 박스에.
- 📈 핵심 수치 강조 카드: 큰 숫자(40px, 컬러) + 라벨, box-shadow.
- 🔵 섹션 소제목: 이모지 + 좌측 굵은 컬러 바(border-left). H2 22~26px 위계 명확.
- 💡 인포 콜아웃 박스: 연배경 + 좌측 컬러 바 + 이모지.
- 🖊 형광펜 강조 span(배경색), 굵게.
- 📊 비교 표: 컬러 헤더 행 + 줄무늬.
- ✅ 체크리스트 / 1️⃣ 단계 카드(번호 원형 뱃지).
- ❓ FAQ: 질문은 컬러 굵은 글씨, 답변은 연배경 박스.
- 🔘 결론 CTA 박스(그라데이션).
- 📷 이미지 자리 점선 박스.

[톤·색상] 전문·정보 중심, 첫 문단에 핵심 답. 비즈 블루 계열(#2563eb 메인) + 보조(연청·민트·연회색). 폰트 크기 대비 크게, 여백·둥근 모서리·그림자 적극.
[규칙] 모든 스타일 inline style만(class/외부CSS 금지). 본문 요소만(래퍼 금지). 출력은 HTML 코드만, 코드펜스·설명 금지.`,
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
function readBody(req, maxBytes) {
  const limit = maxBytes || 1e6;
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on('data', (c) => { chunks.push(c); size += c.length; if (size > limit) req.destroy(new Error('본문 크기 초과')); });
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

  // 정적: 업로드된 카드 이미지 공개 서빙 (인스타가 가져갈 공개 URL)
  if (url.pathname.startsWith('/uploads/')) {
    const name = path.basename(url.pathname); // 경로 traversal 방지
    const fp = path.join(UPLOAD_DIR, name);
    return fs.readFile(fp, (err, data) => {
      if (err) { res.writeHead(404); return res.end('not found'); }
      res.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'public, max-age=86400' });
      res.end(data);
    });
  }

  // 카드 이미지 업로드 → 공개 URL 반환 (인스타 발행용)
  if (url.pathname === '/api/upload' && req.method === 'POST') {
    readBody(req, 40e6).then((d) => {  // 카드 이미지 다수 → 40MB 허용
      const imgs = Array.isArray(d.images) ? d.images : [];
      if (!imgs.length) return sendJson(res, 400, { error: '이미지 없음' });
      const base = (PUBLIC_BASE || `http://${req.headers.host}`).replace(/\/+$/, '');
      const stamp = Date.now();
      const urls = [];
      imgs.forEach((dataUrl, i) => {
        const m = /^data:image\/png;base64,(.+)$/.exec(String(dataUrl));
        if (!m) return;
        const name = `card_${stamp}_${i}.png`;
        fs.writeFileSync(path.join(UPLOAD_DIR, name), Buffer.from(m[1], 'base64'));
        urls.push(`${base}/uploads/${name}`);
      });
      sendJson(res, 200, { urls, publicBaseUsed: base, note: base.includes('localhost') ? '로컬 주소 — 인스타가 접근 불가. 배포(PUBLIC_BASE_URL) 필요' : '' });
    }).catch((e) => sendJson(res, 500, { error: String(e.message || e) }));
    return;
  }

  // 인스타그램 캐러셀 자동 발행 (Graph API)
  if (url.pathname === '/api/instagram/publish' && req.method === 'POST') {
    readBody(req).then(async (d) => {
      const { token, igUserId, caption } = d;
      const imageUrls = Array.isArray(d.imageUrls) ? d.imageUrls.slice(0, 10) : [];
      if (!token || !igUserId) return sendJson(res, 400, { error: '인스타 access token·IG User ID 필요(설정)' });
      if (imageUrls.length < 2) return sendJson(res, 400, { error: '캐러셀은 이미지 2장 이상 필요' });
      const g = (p, params) => fetch(`https://graph.facebook.com/${IG_VER}/${p}?${new URLSearchParams({ ...params, access_token: token })}`, { method: 'POST' }).then((r) => r.json());
      try {
        // 1) 자식 컨테이너
        const children = [];
        for (const u of imageUrls) {
          const c = await g(`${igUserId}/media`, { image_url: u, is_carousel_item: 'true' });
          if (c.error) throw new Error(c.error.message);
          children.push(c.id);
        }
        // 2) 캐러셀 컨테이너
        const carousel = await g(`${igUserId}/media`, { media_type: 'CAROUSEL', children: children.join(','), caption: caption || '' });
        if (carousel.error) throw new Error(carousel.error.message);
        // 3) 발행
        const pub = await g(`${igUserId}/media_publish`, { creation_id: carousel.id });
        if (pub.error) throw new Error(pub.error.message);
        sendJson(res, 200, { ok: true, id: pub.id });
      } catch (e) {
        sendJson(res, 400, { error: String(e.message || e) });
      }
    }).catch((e) => sendJson(res, 500, { error: String(e.message || e) }));
    return;
  }

  // 발행 프록시 — 워드프레스 REST / 티스토리 (사용자 저장 자격증명)
  if (url.pathname === '/api/publish' && req.method === 'POST') {
    readBody(req).then(async (d) => {
      const title = String(d.title || '').slice(0, 300);
      const contentHtml = String(d.contentHtml || '');
      if (!title || !contentHtml) return sendJson(res, 400, { error: '제목·내용 필요' });
      if (d.provider === 'wordpress') {
        const { wpUrl, wpUser, wpAppPassword } = d;
        if (!wpUrl || !wpUser || !wpAppPassword) return sendJson(res, 400, { error: '워드프레스 주소·사용자·앱 비밀번호 필요' });
        const base = String(wpUrl).replace(/\/+$/, '');
        const auth = Buffer.from(`${wpUser}:${wpAppPassword}`).toString('base64');
        const r = await fetch(`${base}/wp-json/wp/v2/posts`, {
          method: 'POST',
          headers: { 'Authorization': 'Basic ' + auth, 'Content-Type': 'application/json' },
          body: JSON.stringify({ title, content: contentHtml, status: d.status === 'publish' ? 'publish' : 'draft' }),
        });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) return sendJson(res, r.status, { error: (j.message) || `워드프레스 ${r.status}` });
        return sendJson(res, 200, { ok: true, url: j.link, id: j.id, status: j.status });
      }
      if (d.provider === 'tistory') {
        const { token, blogName } = d;
        if (!token || !blogName) return sendJson(res, 400, { error: '티스토리 access_token·blogName 필요' });
        const vis = { private: '0', protected: '1', publish: '3' }[d.status] || '0';
        const params = new URLSearchParams({ access_token: token, output: 'json', blogName, title, content: contentHtml, visibility: vis });
        const r = await fetch('https://www.tistory.com/apis/post/write', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: params });
        const j = await r.json().catch(() => ({}));
        if (!r.ok || (j.tistory && j.tistory.status !== '200')) return sendJson(res, 400, { error: (j.tistory && j.tistory.error_message) || `티스토리 ${r.status} (구 API — 신규 앱 발급 중단 상태일 수 있음)` });
        return sendJson(res, 200, { ok: true, url: j.tistory && j.tistory.url, id: j.tistory && j.tistory.postId });
      }
      sendJson(res, 400, { error: '지원하지 않는 provider' });
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
        let usage = { input_tokens: 0, output_tokens: 0 };
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
              } else if (ev.type === 'message_start' && ev.message && ev.message.usage) {
                usage.input_tokens = ev.message.usage.input_tokens || 0;
              } else if (ev.type === 'message_delta' && ev.usage) {
                usage.output_tokens = ev.usage.output_tokens || usage.output_tokens;
              }
            } catch (_) { /* 부분 JSON 무시 */ }
          }
        }
        res.write(`event: done\ndata: ${JSON.stringify({ usage })}\n\n`);
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
