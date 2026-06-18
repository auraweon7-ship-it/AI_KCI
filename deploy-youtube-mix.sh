#!/usr/bin/env bash
# YouTube MIX — Railway 배포 스크립트
# 사용: bash deploy-youtube-mix.sh "커밋 메시지"
set -e

MSG="${1:-chore: youtube-mix 업데이트}"
cd "$(dirname "$0")"

echo "▶ 스테이징..."
git add youtube-agent/

echo "▶ 커밋: $MSG"
git commit -m "$MSG" || echo "(변경사항 없음, 배포만 진행)"

echo "▶ Railway 배포 (subtree push)..."
git push youutbe-mix "$(git subtree split --prefix=youtube-agent main):main" --force

echo "✅ 완료 — https://youutbe-mix.up.railway.app"
