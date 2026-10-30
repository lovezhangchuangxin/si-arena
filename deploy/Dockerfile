# syntax=docker/dockerfile:1

# app/web 双 target：server 与 worker 共用 app（保留完整 workspace 布局，
# 使启动脚本、drizzle 迁移与官方 bot 的相对路径解析继续成立；isolated-vm 的
# linux 预编译二进制随 --ignore-scripts 安装，由 node-gyp-build 在加载时选取）；
# web 基于 Caddy 托管 SPA 静态文件（Caddyfile 见 deploy/Caddyfile）。
# 构建上下文是仓库根：docker build -f deploy/Dockerfile --target app .
FROM node:26-slim AS build
WORKDIR /app
RUN npm install --global pnpm@12.14.0

# 先只安装依赖，让源码改动命中层缓存。
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY apps/server/package.json apps/server/
COPY apps/worker/package.json apps/worker/
COPY apps/web/package.json apps/web/
COPY packages/protocol/package.json packages/protocol/
COPY packages/development/package.json packages/development/
COPY packages/engine/package.json packages/engine/
COPY packages/sandbox/package.json packages/sandbox/
COPY packages/player/package.json packages/player/
COPY packages/cli/package.json packages/cli/
COPY packages/db/package.json packages/db/
COPY games/paper/package.json games/paper/
COPY games/royale/package.json games/royale/
COPY games/cube/package.json games/cube/
COPY games/danmaku/package.json games/danmaku/
COPY games/investment/package.json games/investment/
RUN pnpm install --frozen-lockfile --ignore-scripts

COPY . .
RUN pnpm build

FROM build AS app
ENV NODE_ENV=production
CMD ["pnpm", "--filter", "@si-arena/server", "start"]

FROM caddy:2-alpine AS web
COPY --from=build /app/apps/web/dist /srv/web
COPY deploy/Caddyfile /etc/caddy/Caddyfile
