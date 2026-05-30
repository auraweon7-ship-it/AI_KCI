# 인수인계: chinatext 저장소로 "古文 학습 마스터" 배포

> 이 파일을 **chinatext에서 새로 연 Claude Code 세션의 채팅창에 첨부**하고
> "이 인수인계대로 chinatext에 배포해줘"라고 말하면, 그 세션의 Claude가
> 아래 작업을 그대로 수행합니다. 함께 첨부한 HTML 파일들을 사용하세요.

## 무엇인가
중·고·대학생·일반 학습자용 **고문/한문 학습 단일 HTML 웹앱**.
원문 → 독음 → 현대어 풀이 → 어휘 → 문법 → 문장구조 → 퀴즈 → 오답복습 흐름.
빌드 과정 없이 HTML 파일 하나로 실행됩니다.

## 함께 첨부되는 파일
1. **gomun-master.html** — 본체(CDN 버전, 가벼움, 인터넷 필요)
2. **gomun-master.offline.html** — 완전 자체완결(오프라인) 빌드. Tailwind·Chart.js·
   Font Awesome 내장. 서버·인터넷 없이도 스타일·차트·아이콘 모두 동작.
3. **gomun-master.README.md** — 기능·실행법·데이터 정확도 안내 문서.

## 주요 기능(이미 구현 완료)
- 작품/문장 데이터: 약 396문장 / 62작품. 짧은 대구는 **완전한 문장으로 병합**.
  유명 글은 **전문 수록**: 출사표(45)·귀거래사(16)·난정집서(15)·애련설(11)·사설(10)·
  당시 전편(춘망·정야사·강설·등관작루·황학루송맹호연·상사·송원이사안서·죽리관).
- 플래시카드(3D 뒤집기), 통합검색, 갈래·난이도·**문장 길이** 필터.
- **공식 분석**(박정원 『공식으로 읽는 논어명구』 방법론): 문장성분 S/V/O/E 표기,
  사건의미(변화결과·상태·활동), 논리관계(순접·역접·조건), 백화(白话) 참고 풀이.
- 퀴즈(즉시 피드백+오답 자동 저장), 간격반복 복습, 단어장, 오답노트, 성취 배지,
  Chart.js 대시보드, 관리자 화면(기본 비번 admin123), JSON 내보내기/가져오기.
- 하단 푸터: 박정원 교수(한국외대 중국언어문화학부)·K-AI 교육네트워크(k-ai.it.kr)·
  APP kletter.kr/kteacher.kr.

## chinatext에 배포하는 절차 (새 세션 Claude가 할 일)
1. 첨부된 세 파일을 저장소 루트에 추가:
   - `gomun-master.html`, `gomun-master.offline.html`, `gomun-master.README.md`
2. GitHub Pages 배포용 `docs/` 폴더 구성:
   - `docs/index.html` ← gomun-master.offline.html 복사(자체완결이라 Pages에서 확실히 렌더)
   - `docs/app-cdn.html` ← gomun-master.html 복사
   - `docs/.nojekyll` (빈 파일)
3. 커밋 후 지정 브랜치로 push.
4. 사용자에게 **Settings → Pages → Deploy from branch → (해당 브랜치)/docs** 활성화를 안내.
   활성화되면 공개 URL: `https://auraweon7-ship-it.github.io/chinatext/`

## 데이터 정확도 주의(사용자에게 고지)
- 핵심 필드(원문·현대어 풀이·출전)는 검증된 고전에서 큐레이션.
- 부가 필드(독음·어휘·문법·문장구조·퀴즈·공식분석·백화)는 사전+규칙 **자동 생성 근사치**.
  부정사·도치·복문에서 오류 가능. 교육 자료로 쓰기 전 교사·전문가 검토 권장.

## 재현이 필요할 경우(데이터 재생성)
원본 AI_KCI 저장소의 `data-gen/` 폴더에 생성기 일체(corpus*.txt, full_*.txt,
dict*.js, merge.js, build.js)가 있습니다. `node build.js` → `generated.js` 생성 후
HTML의 `const GENERATED_WORKS = [...]` 블록을 교체하는 구조입니다.
