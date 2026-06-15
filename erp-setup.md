# A&D AGE ERP — 설치/설정 가이드

ERP 앱(`erp.html`)을 실제로 쓰려면 **구글 로그인 1회 설정**이 필요하다. (DB·테이블·권한은 이미 적용 완료)

---

## 0. 현재 구축 상태
| 항목 | 상태 |
|------|------|
| Supabase 프로젝트 | ✅ `and-age-erp` (서울 리전) |
| DB 테이블 9종 + 권한(RLS) | ✅ 적용 완료 |
| 매출 자동화 트리거 (계약승인→매출) | ✅ 적용 완료 |
| 프론트엔드 `erp.html` | ✅ 완성 |
| 구글 로그인 | ⛔ **아래 설정 필요** |

- 프로젝트 URL: `https://kaupqakpfnxheegykxfg.supabase.co`
- 대시보드: https://supabase.com/dashboard/project/kaupqakpfnxheegykxfg

---

## 1. 구글 OAuth 클라이언트 생성 (Google Cloud Console)
1. https://console.cloud.google.com → 프로젝트 생성(또는 기존)
2. **API 및 서비스 → OAuth 동의 화면**
   - User Type: **내부(Internal)** 선택 → 회사 구글 워크스페이스 계정만 로그인 가능 (도메인 화이트리스트 효과)
   - (워크스페이스 아니면 External + 테스트 사용자 등록)
3. **사용자 인증 정보 → 사용자 인증 정보 만들기 → OAuth 클라이언트 ID**
   - 유형: **웹 애플리케이션**
   - **승인된 리디렉션 URI**에 아래 추가:
     ```
     https://kaupqakpfnxheegykxfg.supabase.co/auth/v1/callback
     ```
4. 생성된 **클라이언트 ID / 클라이언트 보안 비밀** 복사

## 2. Supabase에 구글 provider 연결
1. 대시보드 → **Authentication → Sign In / Providers → Google**
2. **Enable** 켜기
3. 1번에서 받은 **Client ID / Client Secret** 붙여넣기 → Save

## 3. 리디렉션 URL 등록 (앱 주소 허용)
대시보드 → **Authentication → URL Configuration**
- **Site URL**: 앱 배포 주소 (예: `https://erp.and-age.com` 또는 로컬 `http://localhost:8899`)
- **Redirect URLs**에 앱 주소 추가 (예: `http://localhost:8899/erp.html`, 배포 주소 둘 다)

---

## 4. 첫 로그인 = 자동 관리자
- **맨 처음 로그인한 사람이 자동으로 관리자(admin)** 가 된다. → 대표님이 먼저 로그인할 것
- 이후 로그인하는 직원은 `대기(pending)` 상태로 등록됨
- 관리자가 **직원관리** 메뉴에서 **승인 + 부서/권한 지정**

## 5. 권한별 메뉴
| 권한 | 보이는 메뉴 |
|------|------------|
| 관리자 | 대시보드·근태·휴가·프로젝트·전자결재·**매출·직원관리** |
| 중간관리자 | 대시보드·근태·휴가·프로젝트·전자결재 (+팀 근태/휴가/결재 승인) |
| 사용자 | 대시보드·근태·휴가·프로젝트(담당)·전자결재(상신) |

---

## 6. 핵심 동작 흐름
1. **프로젝트 등록**(관리자/중간관리자) → 상세에서 인력 배정
2. 상세 화면에서 **기획 승인 상신 → 계약(선계약금) 상신 → (필요시)파기 상신**
3. 결재함에서 **승인** 클릭:
   - 기획 승인 → 프로젝트 `기획승인`
   - **계약 승인 → 매출 자동 생성 + 프로젝트 `개발진행`** (매출 메뉴에 즉시 반영)
   - 파기 승인 → 프로젝트 `파기` + 매출 취소
4. **근태**: 출근/퇴근 버튼 → 자동 기록
5. **휴가**: 신청 → 중간관리자/관리자 승인 → 연차 자동 차감

---

## 7. 배포
`erp.html` 단일 파일 → 어디든 정적 호스팅 가능. 셋 중 택1.

### (A) Netlify Drop — 가장 빠름 (30초, 무료, HTTPS 자동)
1. https://app.netlify.com/drop 접속
2. `erp.html` **파일을 드래그&드롭** (또는 erp.html 든 폴더)
3. 즉시 `https://랜덤이름.netlify.app` 주소 생성
4. 사이트 설정에서 도메인 이름 변경 가능 (예: `and-age-erp.netlify.app`)
5. ⚠️ 파일명이 `index.html`이 아니면 주소는 `.../erp.html`. 헷갈리면 erp.html → index.html 로 복사 후 드롭

### (B) Vercel
1. https://vercel.com → New Project → 이 GitHub 저장소 import
2. Output 디렉토리 루트, 빌드 없음(Other) → Deploy
3. `erp.html` 경로로 접근

### (C) Railway (기존 사용중)
- 정적 서빙 서비스 추가 또는 youtube-agent처럼 express에 정적 라우트 추가

### 배포 후 필수
배포 주소를 **3번 URL Configuration**의 Site URL + Redirect URLs에 추가
(예: `https://and-age-erp.netlify.app`, `https://and-age-erp.netlify.app/erp.html`)
안 하면 구글 로그인 후 리디렉션이 막힌다.

---

## 8. 로컬 테스트
```powershell
cd "C:\Users\park9\AI KCI"
python -m http.server 8899
```
브라우저 → `http://localhost:8899/erp.html`
(단, OAuth URL Configuration에 `http://localhost:8899/erp.html` 등록 후 가능)
