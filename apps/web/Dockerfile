FROM node:20-alpine AS deps
RUN corepack enable pnpm
WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json ./apps/web/package.json
COPY apps/server/package.json ./apps/server/package.json

RUN pnpm install --frozen-lockfile --filter mafia-web

# ── Build ──────────────────────────────────────────────────────────────────────
FROM node:20-alpine AS builder
RUN corepack enable pnpm
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/web/node_modules ./apps/web/node_modules 2>/dev/null || true

COPY apps/web ./apps/web
COPY package.json ./

# NEXT_PUBLIC_* vars muszą być dostępne w czasie budowania (bake into bundle)
ARG NEXT_PUBLIC_SOCKET_URL
ARG NEXT_PUBLIC_POCKETBASE_URL
ARG NEXT_PUBLIC_ROOM_HOST_EMAIL
ENV NEXT_PUBLIC_SOCKET_URL=$NEXT_PUBLIC_SOCKET_URL \
    NEXT_PUBLIC_POCKETBASE_URL=$NEXT_PUBLIC_POCKETBASE_URL \
    NEXT_PUBLIC_ROOM_HOST_EMAIL=$NEXT_PUBLIC_ROOM_HOST_EMAIL

WORKDIR /app/apps/web
RUN pnpm build

# ── Runner ─────────────────────────────────────────────────────────────────────
FROM node:20-alpine AS runner
RUN corepack enable pnpm
WORKDIR /app

ENV NODE_ENV=production

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

COPY --from=deps --chown=nextjs:nodejs /app/node_modules ./node_modules
COPY --from=deps --chown=nextjs:nodejs /app/apps/web/node_modules ./apps/web/node_modules 2>/dev/null || true
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next ./apps/web/.next
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/public ./apps/web/public 2>/dev/null || true
COPY --chown=nextjs:nodejs apps/web/package.json ./apps/web/package.json
COPY --chown=nextjs:nodejs package.json ./

USER nextjs
WORKDIR /app/apps/web

EXPOSE 3000
ENV PORT=3000 HOSTNAME=0.0.0.0

CMD ["pnpm", "start"]
