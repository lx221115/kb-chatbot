#!/usr/bin/env bash
# kb-chatbot 一键重新部署（Docker 单容器，默认保留数据卷）
#
# 用法：bash scripts/redeploy.sh [选项]
# 本地模式：重新构建镜像 → 复用旧容器的镜像名/端口/数据卷/环境变量 → 重建容器
# 远程模式（--ssh user@host）：本地构建镜像 → 流式传输到服务器 → 在服务器上重建容器
# 构建或健康检查失败时自动回滚到旧容器。
set -euo pipefail

# 可选：deploy/remote.env 配置线上目标（见 deploy/remote.env.example）
# 在线上执行的这一份脚本带 KB_DEPLOY_REMOTE_CHILD，避免读回配置后再次远程部署
if [[ -z "${KB_DEPLOY_REMOTE_CHILD:-}" && -f deploy/remote.env ]]; then
  while IFS= read -r line; do
    line="${line%$'\r'}"
    [[ -z "$line" || "$line" == \#* || "$line" != *=* ]] && continue
    eval "$line"
  done < deploy/remote.env
fi

IMAGE="${IMAGE:-kb-chatbot:latest}"
CONTAINER="${CONTAINER:-kb-chatbot}"
HOST_PORT="${HOST_PORT:-3000}"
VOLUME="${VOLUME:-kb-chatbot-data}"
CONTAINER_PORT=3000
HEALTH_TIMEOUT="${HEALTH_TIMEOUT:-30}"

# 远程模式：SSH_HOST 非空即启用
SSH_HOST="${SSH_HOST:-}"
SSH_PORT="${SSH_PORT:-22}"
SSH_KEY="${SSH_KEY:-}"
REMOTE_DIR="${REMOTE_DIR:-/tmp/kb-chatbot-deploy}"

DO_BUILD=1
DO_PULL=0
ENV_FILE=""
IMAGE_SET=0
PORT_SET=0
VOLUME_SET=0

SCRIPT_FILE="${BASH_SOURCE[0]}"

usage() {
  cat <<'EOF'
用法：bash scripts/redeploy.sh [选项]

重新构建镜像并重建 Docker 容器；默认从旧容器继承镜像名、宿主机端口、
/app/data 数据卷、环境变量与重启策略，数据不会丢失。

选项：
  -i, --image NAME:TAG     镜像名（默认继承旧容器，否则 kb-chatbot:latest）
  -c, --container NAME     容器名（默认 kb-chatbot）
  -p, --port PORT          宿主机端口（默认继承旧容器，否则 3000）
  -v, --volume NAME|PATH   /app/data 的数据卷或宿主机目录（默认继承旧容器）
  -e, --env-file FILE      额外传入环境变量文件（如 .env）
      --ssh USER@HOST      远程模式：本地构建后经 SSH 推送到服务器部署
      --ssh-port PORT      SSH 端口（默认 22）
      --ssh-key FILE       SSH 私钥（默认走 ssh-agent / 默认密钥）
      --remote-dir DIR     服务器上的临时目录（默认 /tmp/kb-chatbot-deploy）
      --no-build           跳过镜像构建，仅用现有镜像重建容器
      --pull               构建前拉取最新基础镜像
  -h, --help               显示本帮助

可选环境变量：
  IMAGE / CONTAINER / HOST_PORT / VOLUME / HEALTH_TIMEOUT
  DEBIAN_MIRROR / NPM_REGISTRY / SQLITE3_BINARY_MIRROR   透传给 docker build
  INSTALL_BUILD_TOOLS=1     安装编译链（better-sqlite3 预编译不可用时兜底）
  PLATFORM                  透传 --platform，如 linux/amd64
  SSH_HOST / SSH_PORT / SSH_KEY / REMOTE_DIR  远程模式默认值

示例：
  bash scripts/redeploy.sh
  bash scripts/redeploy.sh --no-build
  bash scripts/redeploy.sh --ssh root@192.168.1.10
  DEBIAN_MIRROR=deb.debian.org NPM_REGISTRY=https://registry.npmjs.org \
    bash scripts/redeploy.sh -i kb-chatbot:latest
EOF
}

die() {
  printf '错误：%s\n' "$*" >&2
  exit 1
}

need_arg() {
  [[ $# -ge 2 && -n "$2" ]] || die "参数 $1 缺少值"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    -i|--image) need_arg "$@"; IMAGE="$2"; IMAGE_SET=1; shift 2 ;;
    -c|--container) need_arg "$@"; CONTAINER="$2"; shift 2 ;;
    -p|--port) need_arg "$@"; HOST_PORT="$2"; PORT_SET=1; shift 2 ;;
    -v|--volume) need_arg "$@"; VOLUME="$2"; VOLUME_SET=1; shift 2 ;;
    -e|--env-file) need_arg "$@"; ENV_FILE="$2"; shift 2 ;;
    --ssh) need_arg "$@"; SSH_HOST="$2"; shift 2 ;;
    --ssh-port) need_arg "$@"; SSH_PORT="$2"; shift 2 ;;
    --ssh-key) need_arg "$@"; SSH_KEY="$2"; shift 2 ;;
    --remote-dir) need_arg "$@"; REMOTE_DIR="$2"; shift 2 ;;
    --no-build) DO_BUILD=0; shift ;;
    --pull) DO_PULL=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) die "未知参数：$1（-h 查看帮助）" ;;
  esac
done

command -v docker >/dev/null 2>&1 || die "未找到 docker 命令"
[[ "$HEALTH_TIMEOUT" =~ ^[0-9]+$ ]] || die "HEALTH_TIMEOUT 必须是整数秒"
if [[ -n "$SSH_HOST" && ! "$SSH_PORT" =~ ^[0-9]+$ ]]; then
  die "SSH 端口必须是数字"
fi
if [[ -n "$SSH_KEY" && ! -f "$SSH_KEY" ]]; then
  die "SSH 私钥不存在：$SSH_KEY"
fi
if [[ -n "$ENV_FILE" && ! -f "$ENV_FILE" ]]; then
  die "环境变量文件不存在：$ENV_FILE"
fi
if [[ $DO_BUILD -eq 1 && ! -f Dockerfile ]]; then
  die "请在项目根目录运行本脚本"
fi

build_image() {
  local build_args=()
  if [[ -n "${DEBIAN_MIRROR:-}" ]]; then build_args+=(--build-arg "DEBIAN_MIRROR=$DEBIAN_MIRROR"); fi
  if [[ -n "${NPM_REGISTRY:-}" ]]; then build_args+=(--build-arg "NPM_REGISTRY=$NPM_REGISTRY"); fi
  if [[ -n "${SQLITE3_BINARY_MIRROR:-}" ]]; then build_args+=(--build-arg "SQLITE3_BINARY_MIRROR=$SQLITE3_BINARY_MIRROR"); fi
  if [[ -n "${INSTALL_BUILD_TOOLS:-}" ]]; then build_args+=(--build-arg "INSTALL_BUILD_TOOLS=$INSTALL_BUILD_TOOLS"); fi
  if [[ -n "${PLATFORM:-}" ]]; then build_args+=(--platform "$PLATFORM"); fi
  if [[ $DO_PULL -eq 1 ]]; then build_args+=(--pull); fi

  printf '==> 构建镜像 %s\n' "$IMAGE"
  docker build ${build_args[@]+"${build_args[@]}"} -t "$IMAGE" .
}

# ---------- 远程模式：本地构建 → SSH 传镜像 → 服务器上重建容器 ----------

SSH_OPTS=()
build_ssh_opts() {
  SSH_OPTS=(-p "$SSH_PORT" -o StrictHostKeyChecking=accept-new -o ConnectTimeout=10)
  if [[ -n "$SSH_KEY" ]]; then
    SSH_OPTS+=(-i "$SSH_KEY")
  fi
  return 0
}

remote_run() {
  local cmd=""
  local arg
  for arg in "$@"; do
    cmd+=" $(printf '%q' "$arg")"
  done
  ssh ${SSH_OPTS[@]+"${SSH_OPTS[@]}"} "$SSH_HOST" "$cmd"
}

upload_file() {
  local src="$1" dest="$2"
  sed 's/\r$//' "$src" | ssh ${SSH_OPTS[@]+"${SSH_OPTS[@]}"} "$SSH_HOST" "cat > $(printf '%q' "$dest")"
}

deploy_remote() {
  command -v ssh >/dev/null 2>&1 || die "未找到 ssh 命令"
  command -v gzip >/dev/null 2>&1 || die "未找到 gzip 命令"
  build_ssh_opts

  printf '==> 远程部署目标：%s（容器 %s，镜像 %s）\n' "$SSH_HOST" "$CONTAINER" "$IMAGE"

  if ! remote_run docker version >/dev/null 2>&1; then
    die "无法连接线上 Docker：$SSH_HOST（请确认 SSH 免密登录与远程 docker 权限）"
  fi

  if [[ $DO_BUILD -eq 1 ]]; then
    build_image
  fi

  local local_has=0
  if docker image inspect "$IMAGE" >/dev/null 2>&1; then
    local_has=1
  fi

  if [[ $local_has -eq 1 ]]; then
    local local_id remote_id
    local_id=$(docker image inspect -f '{{.Id}}' "$IMAGE")
    remote_id=$(remote_run docker image inspect -f '{{.Id}}' "$IMAGE" 2>/dev/null || true)
    if [[ "$local_id" == "$remote_id" ]]; then
      printf '==> 线上已存在相同镜像，跳过传输\n'
    else
      printf '==> 流式传输镜像到 %s（gzip 压缩）\n' "$SSH_HOST"
      docker save "$IMAGE" | gzip -1 | ssh ${SSH_OPTS[@]+"${SSH_OPTS[@]}"} "$SSH_HOST" 'gunzip | docker load'
    fi
  elif remote_run docker image inspect "$IMAGE" >/dev/null 2>&1; then
    printf '==> 本地未构建镜像，直接使用线上已有的 %s\n' "$IMAGE"
  else
    die "本地与线上都不存在镜像 $IMAGE，请去掉 --no-build 重新构建"
  fi

  remote_run mkdir -p "$REMOTE_DIR" >/dev/null

  local remote_env=""
  if [[ -n "$ENV_FILE" ]]; then
    remote_env="$REMOTE_DIR/env-file"
    printf '==> 上传环境变量文件 %s\n' "$ENV_FILE"
    upload_file "$ENV_FILE" "$remote_env"
  fi

  upload_file "$SCRIPT_FILE" "$REMOTE_DIR/redeploy.sh"

  local args=(--no-build --container "$CONTAINER" --image "$IMAGE")
  [[ $PORT_SET -eq 1 ]] && args+=(--port "$HOST_PORT")
  [[ $VOLUME_SET -eq 1 ]] && args+=(--volume "$VOLUME")
  [[ -n "$remote_env" ]] && args+=(--env-file "$remote_env")

  printf '==> 在线上重建容器\n'
  if ! remote_run env KB_DEPLOY_REMOTE_CHILD=1 bash "$REMOTE_DIR/redeploy.sh" "${args[@]}"; then
    die "线上部署失败，详见上方输出"
  fi

  local url_host="${SSH_HOST#*@}"
  url_host="${url_host%%:*}"
  local remote_port
  remote_port=$(remote_run docker port "$CONTAINER" "${CONTAINER_PORT}/tcp" 2>/dev/null | head -n 1 || true)
  remote_port="${remote_port##*:}"
  [[ -n "$remote_port" ]] || remote_port="$HOST_PORT"
  printf '==> 线上部署完成：http://%s:%s\n' "$url_host" "$remote_port"
}

if [[ -n "$SSH_HOST" ]]; then
  deploy_remote
  exit 0
fi

# ---------- 本地模式 ----------

# 显式 --env-file 中的键优先于从旧容器继承的值，便于更新密钥等配置
declare -A ENV_FILE_KEYS=()
if [[ -n "$ENV_FILE" ]]; then
  while IFS='=' read -r key _; do
    [[ -z "$key" || "$key" == \#* ]] && continue
    ENV_FILE_KEYS["$key"]=1
  done < "$ENV_FILE"
fi

OLD_EXISTS=0
if docker container inspect "$CONTAINER" >/dev/null 2>&1; then
  OLD_EXISTS=1
fi

ENV_ARGS=()
RESTART_ARGS=()
NETWORK_ARGS=()

if [[ $OLD_EXISTS -eq 1 ]]; then
  printf '==> 检测到已有容器 %s，继承其运行配置\n' "$CONTAINER"

  if [[ $IMAGE_SET -eq 0 ]]; then
    inherited=$(docker inspect -f '{{.Config.Image}}' "$CONTAINER")
    [[ -n "$inherited" ]] && IMAGE="$inherited"
  fi

  if [[ $PORT_SET -eq 0 ]]; then
    inherited=$(docker inspect -f '{{with index .HostConfig.PortBindings "3000/tcp"}}{{range .}}{{.HostPort}}{{end}}{{end}}' "$CONTAINER")
    inherited="${inherited%%$'\n'*}"
    [[ -n "$inherited" ]] && HOST_PORT="$inherited"
  fi

  if [[ $VOLUME_SET -eq 0 ]]; then
    mount=$(docker inspect -f '{{range .Mounts}}{{if eq .Destination "/app/data"}}{{.Type}}|{{.Name}}|{{.Source}}{{end}}{{end}}' "$CONTAINER")
    mount="${mount%%$'\n'*}"
    if [[ -n "$mount" ]]; then
      IFS='|' read -r mount_type mount_name mount_source <<< "$mount"
      if [[ "$mount_type" == "volume" && -n "$mount_name" ]]; then
        VOLUME="$mount_name"
      elif [[ "$mount_type" == "bind" && -n "$mount_source" ]]; then
        VOLUME="$mount_source"
      fi
    fi
  fi

  # 原容器的自定义环境变量（密钥等）原样带过去；镜像固有项、脚本固定项与 env-file 覆盖项除外
  while IFS= read -r line; do
    [[ -z "$line" ]] && continue
    key="${line%%=*}"
    [[ -n "${ENV_FILE_KEYS[$key]:-}" ]] && continue
    ENV_ARGS+=("-e" "$line")
  done < <(docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' "$CONTAINER" \
    | grep -Ev '^(PATH|HOSTNAME|HOME|NODE_VERSION|YARN_VERSION|NODE_ENV|PORT|DATA_DIR)=' || true)

  policy=$(docker inspect -f '{{.HostConfig.RestartPolicy.Name}}' "$CONTAINER")
  retries=$(docker inspect -f '{{.HostConfig.RestartPolicy.MaximumRetryCount}}' "$CONTAINER")
  if [[ -n "$policy" && "$policy" != "no" ]]; then
    if [[ "$policy" == "on-failure" && "$retries" != "0" ]]; then
      RESTART_ARGS=(--restart "on-failure:${retries}")
    else
      RESTART_ARGS=(--restart "$policy")
    fi
  fi

  network=$(docker inspect -f '{{range $name, $conf := .NetworkSettings.Networks}}{{$name}}{{end}}' "$CONTAINER")
  network="${network%%$'\n'*}"
  if [[ -n "$network" && "$network" != "bridge" ]]; then
    NETWORK_ARGS=(--network "$network")
  fi
fi

ENV_FILE_ARGS=()
[[ -n "$ENV_FILE" ]] && ENV_FILE_ARGS=(--env-file "$ENV_FILE")

if [[ $DO_BUILD -eq 1 ]]; then
  build_image
fi

PREV="${CONTAINER}-prev-$(date +%s)"

rollback() {
  printf '==> 部署失败，尝试回滚\n' >&2
  docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
  if [[ $OLD_EXISTS -eq 1 ]]; then
    docker rename "$PREV" "$CONTAINER"
    docker start "$CONTAINER" >/dev/null
    printf '==> 已恢复旧容器 %s\n' "$CONTAINER" >&2
  fi
  exit 1
}

if [[ $OLD_EXISTS -eq 1 ]]; then
  printf '==> 停止旧容器并保留为 %s\n' "$PREV"
  docker stop "$CONTAINER" >/dev/null
  docker rename "$CONTAINER" "$PREV"
fi

printf '==> 启动新容器 %s（镜像 %s，端口 %s -> %s，数据卷 %s）\n' \
  "$CONTAINER" "$IMAGE" "$HOST_PORT" "$CONTAINER_PORT" "$VOLUME"
if ! docker run -d --name "$CONTAINER" \
  -p "${HOST_PORT}:${CONTAINER_PORT}" \
  -v "${VOLUME}:/app/data" \
  ${RESTART_ARGS[@]+"${RESTART_ARGS[@]}"} \
  ${NETWORK_ARGS[@]+"${NETWORK_ARGS[@]}"} \
  ${ENV_ARGS[@]+"${ENV_ARGS[@]}"} \
  ${ENV_FILE_ARGS[@]+"${ENV_FILE_ARGS[@]}"} \
  "$IMAGE" >/dev/null; then
  rollback
fi

printf '==> 等待健康检查（最长 %ss）\n' "$HEALTH_TIMEOUT"
healthy=0
for _ in $(seq 1 "$HEALTH_TIMEOUT"); do
  if docker exec "$CONTAINER" node -e \
    "fetch('http://127.0.0.1:${CONTAINER_PORT}/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" \
    >/dev/null 2>&1; then
    healthy=1
    break
  fi
  sleep 1
done

if [[ $healthy -ne 1 ]]; then
  printf '新容器健康检查未通过，最近日志：\n' >&2
  docker logs --tail 50 "$CONTAINER" >&2 || true
  rollback
fi

if [[ $OLD_EXISTS -eq 1 ]]; then
  docker rm "$PREV" >/dev/null
fi

printf '==> 部署完成：http://localhost:%s\n' "$HOST_PORT"
docker inspect -f '    容器 {{.Name}}  状态 {{.State.Status}}  镜像 {{.Config.Image}}' "$CONTAINER" || true
