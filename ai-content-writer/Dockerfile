FROM node:20-slim

WORKDIR /app

# 의존성 없음 — package.json만 복사(캐시용)
COPY package*.json ./

COPY . .

EXPOSE 8787

CMD ["node", "server.js"]
