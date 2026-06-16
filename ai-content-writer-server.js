// AI 콘텐츠 글쓰기 비서 — 무설치 백엔드 (Node 18+ 내장 http/fetch만 사용)
//
// 역할: ai-content-writer.html 정적 서빙 + Claude API 프록시.
// 프록시가 켜져 있으면(ANTHROPIC_API_KEY 존재) 프론트의 "AI 실연동" 모드가
// 탭별로 진짜 Claude 생성 결과(Markdown)를 받아 렌더링한다.
//
// 실행:
//   PowerShell:  $env:ANTHROPIC_API_KEY="sk-ant-..."; node ai-content-writer-server.js
//   bash:        ANTHROPIC_API_KEY=sk-ant-... node ai-content-writer-server.js
//
// 키가 없어도 서버는 뜨고, 프론트는 템플릿 생성 모드로 정상 동작한다.

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const PORT = process.env.PORT || 8787;
const API_KEY = process.env.ANTHROPIC_API_KEY || '';
const MODEL = process.env.ANTHROPIC_MODEL || 'claude-opus-4-8';
const HTML_FILE = path.join(__dirname, 'ai-content-writer.html');

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
  const inst = TAB_PROMPTS[tab] || TAB_PROMPTS.blog;
  return `# 입력
- 주제: ${d.topic}
- 대상 독자: ${d.audience || '일반'}
- 키워드: ${d.keywords || d.topic}
- 글의 목적: ${d.purpose}
- 문체: ${d.tone}
- 글자 수: ${d.length}
- 이미지 스타일: ${d.imgStyle}

# 작업
${inst}`;
}

/* ---------- Claude 호출 ---------- */
async function callClaude(d, tab) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
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

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  // 상태 확인 — 프론트가 AI 모드 노출 여부를 결정
  if (url.pathname === '/api/status') {
    return sendJson(res, 200, { enabled: !!API_KEY, model: API_KEY ? MODEL : null });
  }

  // 생성 프록시
  if (url.pathname === '/api/generate' && req.method === 'POST') {
    if (!API_KEY) return sendJson(res, 503, { error: 'ANTHROPIC_API_KEY 미설정 — 템플릿 모드만 가능' });
    let raw = '';
    req.on('data', (c) => {
      raw += c;
      if (raw.length > 1e6) req.destroy(); // 1MB 방어
    });
    req.on('end', async () => {
      try {
        const d = JSON.parse(raw || '{}');
        if (!d.topic) return sendJson(res, 400, { error: '주제(topic) 필요' });
        const out = await callClaude(d, d.tab || 'blog');
        sendJson(res, 200, out);
      } catch (e) {
        sendJson(res, 500, { error: String(e.message || e) });
      }
    });
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
