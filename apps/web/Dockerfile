FROM node:20-alpine
RUN corepack enable pnpm
WORKDIR /app

# Instalacja zależności
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json ./apps/web/package.json
COPY apps/server/package.json ./apps/server/package.json
RUN pnpm install --frozen-lockfile --filter mafia-web

# Skopiuj kod i zbuduj
COPY apps/web ./apps/web

ARG NEXT_PUBLIC_SOCKET_URL
ARG NEXT_PUBLIC_POCKETBASE_URL
ARG NEXT_PUBLIC_ROOM_HOST_EMAIL
ENV NEXT_PUBLIC_SOCKET_URL=$NEXT_PUBLIC_SOCKET_URL \
    NEXT_PUBLIC_POCKETBASE_URL=$NEXT_PUBLIC_POCKETBASE_URL \
    NEXT_PUBLIC_ROOM_HOST_EMAIL=$NEXT_PUBLIC_ROOM_HOST_EMAIL

WORKDIR /app/apps/web
RUN /app/node_modules/.bin/next build

ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0
EXPOSE 3000
CMD ["/app/node_modules/.bin/next", "start"]
