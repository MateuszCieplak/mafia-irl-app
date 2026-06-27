FROM node:20-alpine
RUN corepack enable pnpm
WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/server/package.json ./apps/server/package.json
COPY apps/web/package.json ./apps/web/package.json

RUN pnpm install --frozen-lockfile --filter mafia-server

COPY apps/server ./apps/server

ENV NODE_ENV=production SERVER_PORT=3002
WORKDIR /app/apps/server
EXPOSE 3002

CMD ["node", "index.js"]
