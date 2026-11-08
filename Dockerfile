# ---------- 公共基础：镜像源、pnpm、可选编译链 ----------
FROM node:22-bookworm-slim AS base
# 默认使用国内镜像源；海外环境可覆盖回官方源：
#   --build-arg DEBIAN_MIRROR=deb.debian.org --build-arg NPM_REGISTRY=https://registry.npmjs.org
ARG DEBIAN_MIRROR=mirrors.aliyun.com
ARG NPM_REGISTRY=https://registry.npmmirror.com
ARG SQLITE3_BINARY_MIRROR=https://registry.npmmirror.com/-/binary/better-sqlite3
# 预编译下载失败需要源码编译时，用 --build-arg INSTALL_BUILD_TOOLS=1 装回编译链
ARG INSTALL_BUILD_TOOLS=0

# better-sqlite3 直接下载对应 Node ABI 的预编译二进制，省去 node-gyp 编译
ENV npm_config_better_sqlite3_binary_host_mirror=${SQLITE3_BINARY_MIRROR}

# 默认不装编译链（better-sqlite3 用预编译包）；按需兜底时才下载 deb
RUN --mount=type=cache,id=apt-cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,id=apt-lists,target=/var/lib/apt/lists,sharing=locked \
    if [ "$INSTALL_BUILD_TOOLS" = "1" ]; then \
      sed -i "s|deb.debian.org|${DEBIAN_MIRROR}|g" /etc/apt/sources.list.d/debian.sources \
      && apt-get update \
      && apt-get install -y --no-install-recommends python3 make g++ ; \
    fi

RUN --mount=type=cache,id=npm-cache,target=/root/.npm \
    npm install -g pnpm@9 --registry="${NPM_REGISTRY}"

# ---------- 构建前端（含开发依赖） ----------
FROM base AS builder
ARG NPM_REGISTRY=https://registry.npmmirror.com
WORKDIR /app

COPY package.json pnpm-lock.yaml ./
RUN --mount=type=cache,id=pnpm-store,target=/pnpm-store \
    --mount=type=cache,id=prebuild-cache,target=/root/.npm/_prebuilds \
    pnpm install --store-dir=/pnpm-store --frozen-lockfile --prefer-offline --registry="${NPM_REGISTRY}"

COPY web ./web
RUN pnpm build

COPY server ./server
COPY skills ./skills

# ---------- 生产依赖（独立阶段，node_modules 只含 dependencies） ----------
FROM base AS prod-deps
ARG NPM_REGISTRY=https://registry.npmmirror.com
WORKDIR /app

COPY package.json pnpm-lock.yaml ./
RUN --mount=type=cache,id=pnpm-store,target=/pnpm-store \
    --mount=type=cache,id=prebuild-cache,target=/root/.npm/_prebuilds \
    pnpm install --store-dir=/pnpm-store --prod --frozen-lockfile \
    --prefer-offline --registry="${NPM_REGISTRY}"

# ---------- 运行镜像 ----------
FROM node:22-bookworm-slim AS runner
WORKDIR /app

ENV NODE_ENV=production \
    PORT=3000 \
    DATA_DIR=/app/data

COPY --from=prod-deps --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/package.json ./package.json
COPY --from=builder --chown=node:node /app/server ./server
COPY --from=builder --chown=node:node /app/web/dist ./web/dist
COPY --from=builder --chown=node:node /app/skills ./skills

# 非 root 运行；挂载 PVC 后由 Pod 的 fsGroup 修正卷权限
RUN mkdir -p "$DATA_DIR" /app/logs && chown -R node:node "$DATA_DIR" /app/logs

USER node
EXPOSE 3000

CMD ["node", "server/index.js"]
