FROM node:20-slim

RUN apt-get update && apt-get install -y \
    ffmpeg \
    fonts-noto-cjk \
    fonts-noto-core \
    fonts-noto-extra \
    && rm -rf /var/lib/apt/lists/* \
    && fc-cache -f -v

WORKDIR /app

COPY package*.json ./
RUN npm install --production

COPY . .

EXPOSE 3003

CMD ["node", "server.js"]
