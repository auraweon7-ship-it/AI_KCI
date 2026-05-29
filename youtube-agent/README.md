# YouTube 롱폼 자동 제작 에이전트

AI 기반 YouTube 롱폼 영상 End-to-End 자동 제작 시스템. 주제 선정부터 대본·이미지/영상·음성·자막·썸네일·YouTube 업로드까지 한 번에 처리.

## 핵심 기능

| 단계 | 기술 | 설명 |
|------|------|------|
| 1. 주제 추천 | Claude Sonnet 4 | 카테고리/타겟/키워드 기반 5개 추천, 메타 자동 매핑 |
| 2. 대본 기획 | Claude Sonnet 4 | 영상 구조 + 장면 설계 |
| 3. 대본 작성 | Claude Sonnet 4 | 1~30분 분량 자동 조절, 메타 라벨 제거 |
| 4. 이미지/영상 생성 | GPT Image-1 / Pexels API | 두 가지 소스 모드 선택 |
| 5. TTS 음성 | ElevenLabs Multilingual v2 | 글자별 timestamps 추출 (정확한 SRT) |
| 6. 영상 합성 | FFmpeg | Ken Burns + xfade + BGM + SRT burn |
| 7. 메타데이터 | Claude Sonnet 4 | 제목·설명·태그·고정 댓글 |
| 8. 썸네일 | GPT Image-1 + FFmpeg drawtext | 한글 텍스트 오버레이, 16:9 |
| 9. YouTube 업로드 | YouTube Data API v3 | OAuth2, privacy 설정 |

## 두 가지 소스 모드

### 🖼️ 이미지 기반 (기본)
- OpenAI GPT Image-1로 장면별 1536×1024 이미지 생성
- 32종 스타일 (시네마틱/애니메이션/회화/판타지/그래픽 5개 카테고리)
- FFmpeg Ken Burns 효과 (8가지 pan/zoom 패턴)

### 🎬 영상 기반 (Pexels 스톡)
- Pexels API로 장면별 키워드 매칭 HD 영상 다운로드
- 무료 (PEXELS_API_KEY 발급 필요)
- search_keywords 영문 필드로 정확한 매칭

## 음성 옵션

영상 언어별 추천 음성 자동 갱신 (5개 언어 지원):

| 언어 | 추천 1순위 ⭐ | 추천 2순위 ⭐ |
|------|---------------|---------------|
| 🇰🇷 한국어 | Anna Kim, Hyun Bin, 박정원 (네이티브) | Rachel (US) |
| 🇺🇸 영어 | Adam (Deep narrator) | Rachel (Calm anchor) |
| 🇨🇳 중국어 | Rachel, Adam | Bella |
| 🇯🇵 일본어 | Rachel, Adam | Bella |
| 🇪🇸 스페인어 | Antoni, Rachel | Adam |

음성 안정성/유사도 슬라이더로 톤 조절.

## 설치

```bash
git clone https://github.com/auraweon7-ship-it/-YouTube_Auto.git youtube-agent
cd youtube-agent
npm install
```

### 의존성
- Node.js 18+
- FFmpeg (시스템 PATH)
- Anthropic / OpenAI / ElevenLabs / Pexels API 키
- Google Cloud Console에서 YouTube Data API v3 + OAuth2 클라이언트 (선택)

### .env 설정

```env
# Claude (대본/메타데이터)
ANTHROPIC_API_KEY=sk-ant-...

# OpenAI (이미지/썸네일)
OPENAI_API_KEY=sk-...

# ElevenLabs (TTS)
ELEVENLABS_API_KEY=sk_...

# Pexels (영상 모드, 선택)
PEXELS_API_KEY=...

# YouTube (업로드, 선택)
YOUTUBE_CLIENT_ID=...
YOUTUBE_CLIENT_SECRET=...
YOUTUBE_REDIRECT_URI=http://localhost:3003/api/youtube/callback
YOUTUBE_REFRESH_TOKEN=...

# 서버
PORT=3003
```

API 키 발급:
- [Anthropic Console](https://console.anthropic.com/)
- [OpenAI Platform](https://platform.openai.com/api-keys)
- [ElevenLabs](https://elevenlabs.io/app/settings/api-keys)
- [Pexels API](https://www.pexels.com/api/) — 무료
- [Google Cloud Console](https://console.cloud.google.com/) — YouTube Data API v3

## 실행

```bash
npm start
```

브라우저 → `http://localhost:3003`

## 사용 흐름

### 원클릭 자동 제작 (`/auto`)
1. 영상 주제 입력 (또는 ✨ AI 자동 생성)
2. 카테고리/타겟 시청자/길이/언어/스타일/음성 선택
3. 소스 모드 선택 (이미지/영상)
4. YouTube 자동 업로드 옵션 (선택)
5. 🚀 자동 제작 시작 → 10단계 자동 실행

### 단계별 수동 제작
사이드바 1~14단계 순서대로 진행:
1. 주제 선정
2. 대본 기획
3. 대본 작성
4. 이미지, 영상 생성
5. TTS 음성
6. 영상 합성
7. 제목/설명
8. 썸네일
9. 인트로 (선택)
10. 타임라인 (선택)
11. SRT 자막
12. 프로젝트 관리
13. Analytics
14. YouTube 업로드

## 영상 합성 파이프라인

```
이미지/영상 클립 + 오디오 + Ken Burns + 전환 효과
      ↓
BGM 믹싱 (선택)
      ↓
썸네일 인트로 prepend (3초, 선택)
      ↓
SRT 자막 burn (with-timestamps 기반 정확)
      ↓
인트로 텍스트 오버레이 (선택)
      ↓
최종 1080p MP4
```

오디오/자막 싱크 정확도:
- ElevenLabs with-timestamps API로 글자별 실제 시각 추출
- SRT 생성 시 alignment 기반 매칭 (글자 비례 fallback)
- 청크 결합은 libmp3lame 재인코딩으로 stream copy 오정렬 방지

## 자막

- 30~35자 단위 1행 분할 (자연스러운 위치: 쉼표/공백)
- Malgun Gothic Bold, FontSize 16
- 하단 MarginV 40, Outline 2, Shadow 1
- 메타 라벨 (이미지:/배경:/효과음: 등) 22종 자동 제거 (3중 패턴: bold/prefix/inline)

## 썸네일

- gpt-image-1로 NO TEXT 배경 이미지 생성 (16:9, 1280×720)
- Claude로 메인/서브 hook text 생성
- FFmpeg drawtext로 한글 텍스트 오버레이 (Malgun Bold)
- 동적 fontsize (90→48 자동 축소) + 자동 줄바꿈 (공백/쉼표 우선)

## API 엔드포인트

| Method | Path | 설명 |
|--------|------|------|
| POST | `/api/topics/suggest` | 주제 추천 (5개) |
| POST | `/api/plan/generate` | 대본 기획 |
| POST | `/api/script/generate` | 대본 작성 |
| POST | `/api/images/generate-prompts` | 이미지 프롬프트 + search_keywords |
| POST | `/api/images/generate` | 단일 이미지 생성 |
| POST | `/api/clips/generate` | Pexels 영상 일괄 다운로드 |
| GET | `/api/clips/list` | 클립 목록 |
| POST | `/api/tts/full-script` | TTS + alignment |
| POST | `/api/render/video` | 영상 합성 (sourceMode: image/video) |
| POST | `/api/meta/generate` | 메타데이터 |
| POST | `/api/thumbnail/generate` | 썸네일 |
| POST | `/api/srt/generate` | SRT 자막 |
| GET | `/api/youtube/auth` | OAuth 시작 |
| GET | `/api/youtube/callback` | OAuth 콜백 |
| GET | `/api/youtube/status` | 인증 상태 |
| POST | `/api/youtube/upload` | 영상 업로드 |

## 디렉토리 구조

```
youtube-agent/
├── server.js          # Express 서버 (모든 API)
├── public/
│   └── index.html     # SPA 대시보드
├── output/
│   ├── images/        # 생성된 이미지
│   ├── clips/         # Pexels 영상 클립
│   ├── audio/         # TTS MP3
│   ├── video/         # 합성된 MP4
│   ├── thumbnails/    # 썸네일 PNG
│   ├── bgm/           # 업로드된 BGM
│   └── srt/           # 자막 파일
├── package.json
└── .env
```

## 기술 스택

- **Backend**: Node.js, Express, ESM
- **AI**: Anthropic SDK (`@anthropic-ai/sdk`), OpenAI SDK (`openai`)
- **Video**: FFmpeg (외부 바이너리)
- **YouTube**: googleapis
- **Frontend**: Vanilla JS + CSS (단일 HTML 파일)
- **Theme**: 다크/라이트 (localStorage)

## 모델 정보

- Claude: `claude-sonnet-4-20250514` (max_tokens 16000)
- OpenAI: `gpt-image-1` (quality: high, 1536×1024)
- ElevenLabs: `eleven_multilingual_v2`

## 라이선스

MIT

## 작성자

[@auraweon7-ship-it](https://github.com/auraweon7-ship-it)
