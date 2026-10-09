FROM node:20-slim

WORKDIR /app

# 安装构建依赖（better-sqlite3 需要编译）
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

COPY . .

# 确保 data/books 目录存在
RUN mkdir -p data/books

EXPOSE 3000

CMD ["node", "server.js"]
