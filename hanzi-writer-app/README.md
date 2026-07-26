# 漢字 쓰기마스터 v2.5

한자 획순 애니메이션 & 쓰기 연습 웹앱

**Live:** https://hanzi.up.railway.app/

## 주요 기능

- **6,646자 수록** — HSK 1~6급 + 확장 한자
- **획순 애니메이션** — HanziWriter 기반 실시간 획순 재생/반복/일시정지
- **쓰기 연습 (퀴즈)** — 직접 손으로 획을 그려 학습, 자동 채점
- **2글자 동시 학습** — 검색창에 2글자 입력 시 side-by-side 듀얼 모드
- **한자어휘 섹션** — 각 한자별 관련 2글자 어휘 표시, 클릭 시 쓰기 연습
- **고사성어 400개** — 카테고리별 분류, 출처/유래 포함, 퀴즈 모드
- **SRS 반복 학습** — 간격 반복 알고리즘 기반 복습 시스템
- **성취 배지** — 학습 목표 달성 시 배지 획득
- **Google OAuth 로그인** — 학습 기록 클라우드 저장
- **관리자 대시보드** — 학습자 관리, 통계 차트
- **다크/라이트 테마** — 자동 전환 지원
- **모바일 반응형** — sticky 네비게이션, 터치 최적화

## 기술 스택

| 구분 | 기술 |
|------|------|
| Frontend | HTML/CSS/JS (SPA), HanziWriter v3.5 |
| Backend | Node.js, Express |
| Database | PostgreSQL |
| Auth | Google OAuth 2.0, JWT |
| Deploy | Railway (auto-deploy from GitHub) |

## 배포 방법

```bash
# 메인 레포에서 hanzi subtree push
git subtree split --prefix=hanzi-writer-app -b hanzi-deploy
git push hanzi hanzi-deploy:main --force
git branch -D hanzi-deploy
```

Railway가 `hanzi` 리모트의 `main` 브랜치를 감지하여 자동 배포.

## 환경 변수 (Railway)

| 변수 | 설명 |
|------|------|
| `DATABASE_URL` | PostgreSQL 연결 문자열 |
| `JWT_SECRET` | JWT 서명 키 |
| `ADMIN_PASSWORD` | 관리자 로그인 비밀번호 |
| `GOOGLE_CLIENT_ID` | Google OAuth Client ID |

## 파일 구조

```
hanzi-writer-app/
├── index.html          # 메인 SPA (HTML/CSS/JS)
├── server.js           # Express 서버 + API
├── auth.js             # 클라이언트 인증 모듈
├── data.js             # 한자 카테고리 데이터
├── data-extra.js       # 확장 한자 데이터
├── hsk-data.js         # HSK 급수 데이터
├── pinyin-data.js      # 병음 데이터
├── radical-data.js     # 부수 데이터
├── idiom-data.js       # 고사성어 400개
├── idiom-detail-data.js# 고사성어 상세
├── example-data.js     # 예문 데이터
├── vocab-data.js       # 2글자 한자어휘 2000개
├── package.json        # 의존성
└── README.md
```

## 버전 이력

| 버전 | 날짜 | 변경 내용 |
|------|------|-----------|
| v2.5 | 2026-07-26 | 이모지 구체화, 고사성어 이미지 카드 디자인 매칭 |
| v2.4 | 2026-07-26 | 어휘 2000개, 듀얼 독음 표시, 이미지 카드 생성 |
| v2.3 | 2026-07-26 | 상단 탭 메뉴 (한자쓰기/고사성어) 분리 |
| v2.2 | 2026-07-26 | 획순 기본 속도 2x, 레이아웃 접근성 개선 |
| v2.1 | 2026-07-26 | 2글자 동시 학습, 한자어휘 섹션, 고사성어 400개 |
| v2.0 | 2026-07-25 | 즐겨찾기/예문 버튼, 이모지 카드, 승인 오류 수정 |
