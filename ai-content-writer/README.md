# AI 콘텐츠 글쓰기 비서

주제 하나만 입력하면 **블로그·SEO·스레드·썸네일·카드뉴스·커뮤니티 홍보글·유튜브·AI 프롬프트**를 한 번에 생성하는 웹앱.

블로그 운영자, 강사, 1인 크리에이터, 마케터, 교육자를 위한 콘텐츠 패키지 제작 도구.

## 두 가지 동작 모드

| 모드 | 방법 | 특징 |
|------|------|------|
| **정적 (템플릿)** | `public/index.html` 더블클릭 | 오프라인·즉시. 문체/목적별 템플릿 생성 |
| **AI 실연동** | `node server.js` + API 키 | 탭별 실제 Claude 생성 (Markdown) |

## 빠른 실행

### 1) 정적 — 설치 없음
`public/index.html`을 브라우저로 열면 끝. 서버 불필요.

### 2) AI 실연동 — 무설치 서버 (의존성 0, Node 18+)

```powershell
# PowerShell
$env:ANTHROPIC_API_KEY="sk-ant-..."; node server.js
```
```bash
# bash
ANTHROPIC_API_KEY=sk-ant-... node server.js
```

→ http://localhost:8787 접속. 우측 탭마다 **"AI로 생성"** 버튼이 뜬다.

## 주요 기능

- **9개 결과 탭** — 블로그글 / SEO제목 / 스레드 / 썸네일문구 / 썸네일이미지 / 카드뉴스 / 백링크·커뮤니티 / 유튜브·쇼츠 / AI프롬프트
- **썸네일 디자이너** — 비율·텍스트위치·아이콘 + **배경 테마 14종**, html2canvas로 PNG 다운로드
- **카드뉴스 8장** — 1:1 카드, 디자인 테마 6종, 개별 PNG / 전체 ZIP(JSZip)
- **다운로드** — 탭별 TXT·Markdown + 전체 패키지 MD
- 다크모드, 최근 프로젝트 저장(localStorage), 샘플 주제, 반응형

### 구글 로그인 + 내 키로 사용 (BYO Key)

서버에 키가 없어도, 로그인 후 **본인 API 키를 직접 입력**해 AI 생성을 쓸 수 있다.

1. 헤더 **로그인 설정** → Google OAuth Client ID 입력(Google Cloud Console에서 발급, 승인된 JS 원본에 배포 주소 등록)
2. 구글 로그인 → 헤더 **설정(⚙️)** 에서 Anthropic API Key / 네이버 ID·Secret / YouTube Key 입력 후 저장
3. 저장된 Anthropic 키는 생성 시 자동으로 사용(요청 본문으로 동일 출처 백엔드에 전달)

> ⚠️ 입력값은 **이 브라우저 localStorage에만** 저장된다. 공용 PC에서는 사용 후 로그아웃/삭제할 것.
> 서버 환경변수 `ANTHROPIC_API_KEY`가 있으면 입력 없이도 동작한다(서버 키 우선 아님 — 사용자 키가 있으면 사용자 키 우선).

## 환경변수

| 변수 | 필수 | 기본값 | 설명 |
|------|------|--------|------|
| `ANTHROPIC_API_KEY` | AI 모드만 | — | Claude API 키. 프론트에 절대 노출 안 됨 |
| `ANTHROPIC_MODEL` | 아니오 | `claude-opus-4-8` | 사용 모델 |
| `PORT` | 아니오 | `8787` | 서버 포트 |

## API

| 엔드포인트 | 설명 |
|-----------|------|
| `GET /api/health` | 헬스체크 |
| `GET /api/status` | AI 모드 활성 여부 `{enabled, model}` |
| `POST /api/generate` | 탭별 생성 `{topic, ..., tab}` → `{markdown}` |

## 배포 (Railway / Docker)

```bash
docker build -t ai-content-writer .
docker run -p 8787:8787 -e ANTHROPIC_API_KEY=sk-ant-... ai-content-writer
```

Railway는 `railway.toml`이 Dockerfile 빌드 + `/api/health` 헬스체크를 자동 설정.
대시보드에서 `ANTHROPIC_API_KEY` 환경변수만 등록하면 끝.

## 기술

- 프론트: 단일 HTML + Tailwind/Lucide/html2canvas/JSZip/marked (CDN)
- 백엔드: Node 18+ 내장 `http`/`fetch`만 사용 — **npm install 불필요**
- 보안: API 키는 서버 환경변수로만 관리, 클라이언트 노출 없음
