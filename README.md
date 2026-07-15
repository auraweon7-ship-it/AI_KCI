# 🧭 연구나침반 AI

> AI 기반 학술연구 지원 대시보드 — KCI 논문 검색·인용 분석·연구역량 시각화

**교육 공공데이터 활용 경진대회 출품작**

---

## 📌 프로젝트 개요

KCI(한국학술지인용색인) Open API를 활용하여 학술 논문 검색, 인용 분석, 대학별 연구역량을 시각화하는 웹 대시보드입니다.

- **단일 SPA** — `index.html` 하나로 전체 UI 구현
- **KCI API 프록시** — CORS 우회를 위한 Node.js 백엔드
- **PostgreSQL** — 사용자 프로필·연구이력 클라우드 저장
- **Google OAuth 2.0** — 로그인 후 데이터 영속성 보장

---

## 🎯 핵심 기능

### 1. 🔍 KCI 논문 검색
- 키워드·저자·학술지별 논문 검색
- 검색 결과 체크 → 연구이력 저장

### 2. 📊 인용 분석
- H-index, 피인용수, 연구 트렌드 차트
- Chart.js 기반 도넛·라인·바·레이더 차트

### 3. 🗺 대학 연구역량 지도
- Google Maps로 전국 201개 대학교 연구역량 시각화
- 마커 클러스터링, 실시간 필터링

### 4. 🤖 Claude AI 연구 지원
- Claude API 연동 학술 분석
- 연구 동향 요약, 논문 추천

### 5. 👤 사용자 프로필
- Google 로그인 기반 프로필 관리
- 대학·전공·연구 키워드·단계 설정
- 로그아웃 후 재로그인 시 데이터 유지 (PostgreSQL)

---

## 🚀 실행 방법

```bash
# 로컬 실행
npm install
node server.js
# → http://localhost:8080

# 환경변수 (선택)
DATABASE_URL=postgresql://...  # PostgreSQL 연결 (미설정 시 localStorage 폴백)
```

---

## 🛠 기술 스택

| 구분 | 기술 |
|------|------|
| 프론트엔드 | HTML5 · CSS3 · Vanilla JS |
| 차트 | Chart.js 4.x |
| 지도 | Google Maps JavaScript API |
| 인증 | Google Identity Services (OAuth 2.0) |
| 백엔드 | Node.js (http 모듈) |
| 데이터베이스 | PostgreSQL (pg) |
| AI | Claude API (Anthropic) |
| 배포 | Railway |
| 도메인 | aikci.kr |

---

## 📁 프로젝트 구조

```
AI_KCI/
├── index.html       # 메인 SPA (연구나침반 AI 대시보드)
├── server.js        # KCI API 프록시 + PostgreSQL API + 정적 파일 서빙
├── package.json     # Node.js 의존성 (pg)
├── nixpacks.toml    # Railway 빌드 설정
├── instructor.jpg   # 강사 이미지
└── .gitignore
```

---

## 📡 API 엔드포인트

| 경로 | 메서드 | 설명 |
|------|--------|------|
| `/api/kci` | GET | KCI Open API 프록시 |
| `/api/user/login` | POST | 사용자 등록/업데이트 |
| `/api/user/profile` | GET/POST | 프로필 조회/저장 |
| `/api/user/history` | GET/POST/DELETE | 연구이력 CRUD |
| `/health` | GET | 서버 상태 확인 |

---

## 🔑 활용 공공데이터

| 제공기관 | 데이터명 | URL |
|----------|----------|-----|
| 한국학술지인용색인(KCI) | KCI 논문 검색 API | open.kci.go.kr |
| NRF 한국연구재단 | KCI 피인용 지수 API | open.kci.go.kr |
| 공공데이터포털 | 전국 대학교 좌표 정보 | api.data.go.kr |

---

*Built with Claude Code · Anthropic*
