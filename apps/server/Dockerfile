FROM node:20-alpine AS deps
RUN corepack enable pnpm
WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/server/package.json ./apps/server/package.json
COPY apps/web/package.json ./apps/web/package.json

RUN pnpm install --frozen-lockfile --filter mafia-server --prod

# ── Runner ─────────────────────────────────────────────────────────────────────
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nodeapp

COPY --from=deps --chown=nodeapp:nodejs /app/node_modules ./node_modules
COPY --chown=nodeapp:nodejs apps/server ./apps/server
COPY --chown=nodeapp:nodejs package.json ./

USER nodeapp
WORKDIR /app/apps/server

EXPOSE 3002
ENV SERVER_PORT=3002

CMD ["node", "index.js"]
