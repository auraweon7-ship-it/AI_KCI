# 古文 학습 마스터 — GitHub Pages 배포

이 폴더(`docs/`)는 GitHub Pages 진입점입니다.

- `index.html` — 자체완결(offline) 빌드. CDN·서버 없이 어디서든 동일하게 렌더됩니다.
- `app-cdn.html` — CDN 버전(가벼움, 인터넷 필요).

## Pages 활성화 방법
GitHub 저장소 → **Settings → Pages** →
- **Source**: Deploy from a branch
- **Branch**: `claude/serene-wozniak-tbNOV` (또는 main에 병합 후 main) / 폴더 `/docs`
저장하면 잠시 후 공개 URL이 발급됩니다.
