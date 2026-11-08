# ---------- 构建前端 + 安装全部依赖 ----------
FROM node:22-bookworm-slim AS builder
# 网络受限时可覆盖：--build-arg DEBIAN_MIRROR=mirrors.aliyun.com
#                 --build-arg NPM_REGISTRY=https://registry.npmmirror.com
ARG DEBIAN_MIRROR=deb.debian.org
ARG NPM_REGISTRY=https://registry.npmjs.org
WORKDIR /app

# better-sqlite3 是原生模块，直接源码编译，避免从 GitHub 拉预编译包
ENV npm_config_build_from_source=true

RUN sed -i "s|deb.debian.org|${DEBIAN_MIRROR}|g" /etc/apt/sources.list.d/debian.sources \
 && apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ \
 && rm -rf /var/lib/apt/lists/*

RUN npm install -g pnpm@9 --registry="${NPM_REGISTRY}"

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --registry="${NPM_REGISTRY}"

COPY web ./web
RUN pnpm build

COPY server ./server
COPY skills ./skills

# ---------- 仅生产依赖 ----------
FROM node:22-bookworm-slim AS prod-deps
ARG DEBIAN_MIRROR=deb.debian.org
ARG NPM_REGISTRY=https://registry.npmjs.org
WORKDIR /app

ENV npm_config_build_from_source=true

RUN sed -i "s|deb.debian.org|${DEBIAN_MIRROR}|g" /etc/apt/sources.list.d/debian.sources \
 && apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ \
 && rm -rf /var/lib/apt/lists/*

RUN npm install -g pnpm@9 --registry="${NPM_REGISTRY}"

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --prod --frozen-lockfile --registry="${NPM_REGISTRY}"

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
