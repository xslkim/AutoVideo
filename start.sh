#!/usr/bin/env bash
# AutoVideo 启动脚本（后台运行）
# 用法：
#   ./start.sh          # 开发模式（默认，后台：server :3030 + Vite :5173）
#   ./start.sh dev      # 开发模式（后台）
#   ./start.sh prod     # 生产模式（后台，先 build，再启动 server :3030）
#   ./start.sh build    # 仅执行 build，不启动服务器
#   ./start.sh check    # 仅检查环境，不启动
#   ./stop.sh           # 停止一切（Web + AI 服务）
#
# dev/prod 模式会自动拉起已部署的 AI 服务（TTS / 文生图 / 口型）。
# 所有服务均在后台常驻，退出脚本不会停止任何东西；停止请用 ./stop.sh。
# 日志与 PID 文件在 logs/ 下。
# 环境变量：
#   HOST=0.0.0.0                  # Web/Vite 绑定地址（默认 0.0.0.0，局域网与 WSL 可访问）
#   PORT=3030                     # 后端端口（默认 3030）
#   AV_SKIP_SERVICES=1            # 不启动任何 AI 服务（仅 Web）
#   AV_SERVICES="cosy t2i"        # 只启动指定服务（tts=voxcpm / cosy=cosyvoice / t2i / lipsync；默认 auto = 按 tts.provider 配置自动选择）

set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MODE="${1:-dev}"
# 默认绑所有网卡：WSL 下 Windows 浏览器访问 localhost / 局域网 IP 才能连上
# 不在此 export PORT：svc_port t2i 会回落到 PORT，避免把文生图端口误设成 3030
export HOST="${HOST:-0.0.0.0}"

# ── 颜色 ──────────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
BOLD='\033[1m'
NC='\033[0m'

info()    { echo -e "${BLUE}[info]${NC}  $*"; }
ok()      { echo -e "${GREEN}[ok]${NC}    $*"; }
warn()    { echo -e "${YELLOW}[warn]${NC}  $*"; }
err()     { echo -e "${RED}[error]${NC} $*" >&2; }
section() { echo -e "\n${BOLD}=== $* ===${NC}"; }

# ── 前置检查 ──────────────────────────────────────────────────────────────────
check_env() {
  section "环境检查"

  # Node.js
  if ! command -v node &>/dev/null; then
    err "未找到 node，请安装 Node.js >= 20"
    exit 1
  fi
  NODE_VER=$(node -e "process.stdout.write(process.versions.node)")
  NODE_MAJOR="${NODE_VER%%.*}"
  if (( NODE_MAJOR < 20 )); then
    err "Node.js 版本 ${NODE_VER} 低于要求的 20，请升级"
    exit 1
  fi
  ok "Node.js ${NODE_VER}"

  # npm
  if ! command -v npm &>/dev/null; then
    err "未找到 npm"
    exit 1
  fi
  ok "npm $(npm --version)"

  # FFmpeg（视频渲染必需）
  if ! command -v ffmpeg &>/dev/null; then
    warn "未找到 ffmpeg，视频渲染功能将不可用"
  else
    ok "ffmpeg $(ffmpeg -version 2>&1 | head -1 | awk '{print $3}')"
  fi

  # tsx（dev 模式需要）
  if [[ "$MODE" == "dev" ]] && ! npx --no tsx --version &>/dev/null 2>&1; then
    warn "tsx 未安装，将在安装依赖后继续"
  fi
}

# ── 安装依赖 ──────────────────────────────────────────────────────────────────
install_deps() {
  section "检查依赖"
  cd "$REPO_DIR"

  # 根目录依赖
  if [[ ! -d node_modules ]] || [[ package.json -nt node_modules/.package-lock.json ]]; then
    info "安装根目录依赖..."
    npm install
  else
    ok "根目录依赖已是最新"
  fi

  # 前端依赖
  if [[ -d web ]]; then
    if [[ ! -d web/node_modules ]] || [[ web/package.json -nt web/node_modules/.package-lock.json ]]; then
      info "安装前端依赖..."
      cd web && npm install && cd ..
    else
      ok "前端依赖已是最新"
    fi
  fi
}

# ── 构建 ──────────────────────────────────────────────────────────────────────
build_all() {
  section "构建"
  cd "$REPO_DIR"

  info "编译服务端 TypeScript..."
  npm run build:server
  ok "服务端编译完成 → dist/server/"

  info "构建前端..."
  npm run build:client
  ok "前端构建完成 → web/dist/"
}

# ── 后台启动辅助 ──────────────────────────────────────────────────────────────
# 以独立会话后台启动命令，写 PID 文件；stop.sh 按 PID 杀整个进程组。
launch_bg() {
  local name="$1" logfile="$2" pidfile="$3"; shift 3
  if [[ -f "$pidfile" ]] && kill -0 "$(cat "$pidfile")" 2>/dev/null; then
    warn "$name 已在运行 (PID $(cat "$pidfile"))，如需重启请先 ./stop.sh"
    return 0
  fi
  rm -f "$pidfile"
  info "后台启动 $name（日志: ${logfile#$REPO_DIR/}）"
  setsid "$@" > "$logfile" 2>&1 &
  echo $! > "$pidfile"
}

# 等待端口就绪（最多 ~30s），仅用于启动反馈，失败不阻断
wait_port() {
  local name="$1" port="$2"
  for _ in $(seq 1 10); do
    if port_busy "$port"; then ok "$name 就绪 → http://${HOST}:$port"; return 0; fi
    sleep 3
  done
  warn "$name 30s 内未就绪，详见日志（服务可能仍在启动中）"
}

# ── 启动开发模式（后台） ─────────────────────────────────────────────────────
start_dev() {
  section "启动开发模式（后台）"
  cd "$REPO_DIR"
  mkdir -p "$LOG_DIR"
  export PORT="${PORT:-3030}"
  launch_bg "dev-web" "$LOG_DIR/dev-web.log" "$LOG_DIR/dev-web.pid" \
    npx concurrently -k "tsx server/index.ts" "cd web && npx vite --host ${HOST} --port 5173"
  wait_port "后端 server" "${PORT}"
  wait_port "前端 vite" 5173
  echo
  ok "已在后台运行。停止: ./stop.sh    日志: logs/dev-web.log"
}

# ── 启动生产模式（后台） ─────────────────────────────────────────────────────
start_prod() {
  section "启动生产模式（后台）"
  cd "$REPO_DIR"

  if [[ ! -f dist/server/server/index.js ]]; then
    err "服务端未编译，请先运行 ./start.sh build 或选择 prod 模式会自动构建"
    exit 1
  fi
  if [[ ! -f web/dist/index.html ]]; then
    err "前端未构建，请先运行 ./start.sh build 或选择 prod 模式会自动构建"
    exit 1
  fi

  mkdir -p "$LOG_DIR"
  export PORT="${PORT:-3030}"
  launch_bg "web(prod)" "$LOG_DIR/web.log" "$LOG_DIR/web.pid" npm run start:web
  wait_port "生产服务" "$PORT"
  echo
  ok "已在后台运行: http://${HOST}:${PORT}    停止: ./stop.sh    日志: logs/web.log"
}

# ── 第三方 AI 服务 ──────────────────────────────────────────────────────────────
SERVICES_DIR="$REPO_DIR/third_servers"
LOG_DIR="$REPO_DIR/logs"
AV_SERVICES="${AV_SERVICES:-auto}"          # auto = 自动探测已部署的全部
AV_SKIP_SERVICES="${AV_SKIP_SERVICES:-0}"
SERVICES_STARTED=()

svc_port() {
  case "$1" in
    tts)     echo "${VOXCPM_PORT:-8000}" ;;
    cosy)    echo "${COSYVOICE_PORT:-8002}" ;;
    t2i)     echo "${SENSENOVA_PORT:-${PORT:-8765}}" ;;
    lipsync) echo "${MUSE_PORT:-8001}" ;;
  esac
}

svc_script() {
  case "$1" in
    tts)     echo "$SERVICES_DIR/voxcpm-tts/start.sh" ;;
    cosy)    echo "$SERVICES_DIR/cosyvoice-tts/start.sh" ;;
    t2i)     echo "$SERVICES_DIR/sensenova-t2i/start.sh" ;;
    lipsync) echo "$SERVICES_DIR/musetalk-lipsync/start.sh" ;;
  esac
}

# 端口被监听 → 返回 0
port_busy() { (echo > "/dev/tcp/127.0.0.1/$1") >/dev/null 2>&1; }

# 该服务在本机是否已部署(venv / repo 就位) → 返回 0
svc_deployable() {
  case "$1" in
    tts)     [[ -x "$SERVICES_DIR/voxcpm-tts/.venv/bin/python" ]] \
               && { [[ -d "$SERVICES_DIR/voxcpm-tts/models/VoxCPM2" ]] || [[ -n "${VOXCPM_MODEL_DIR:-}" ]]; } ;;
    cosy)    [[ -x "$SERVICES_DIR/cosyvoice-tts/.venv/bin/python" ]] \
               && { [[ -d "$SERVICES_DIR/cosyvoice-tts/models/Fun-CosyVoice3-0.5B" ]] || [[ -n "${COSYVOICE_MODEL_DIR:-}" ]]; } ;;
    t2i)     [[ -f "$SERVICES_DIR/sensenova-t2i/repo/.venv/bin/activate" ]] ;;
    lipsync) [[ -f "$SERVICES_DIR/musetalk-lipsync/repo/lipsync_server.py" ]] ;;
  esac
}

# 读取配置的 TTS provider（web 设置面板覆盖优先于仓库根配置）
tts_provider() {
  local f p
  for f in "$REPO_DIR/.autovideo-web/config.json" "$REPO_DIR/autovideo.config.json"; do
    [[ -f "$f" ]] || continue
    p=$(node -e "try{const c=JSON.parse(require('fs').readFileSync('$f','utf-8'));const v=c&&c.tts&&c.tts.provider;if(v)console.log(v)}catch(e){}" 2>/dev/null)
    [[ -n "$p" ]] && { echo "$p"; return 0; }
  done
}

start_services() {
  if [[ "$AV_SKIP_SERVICES" == "1" ]]; then
    warn "AV_SKIP_SERVICES=1 —— 跳过 AI 服务,仅启动 Web"
    return 0
  fi
  section "启动 AI 服务"
  mkdir -p "$LOG_DIR"

  # auto 模式：按配置的 tts.provider 选择 TTS 引擎（cosyvoice → cosy，否则 voxcpm），
  # 避免拉起配置之外的引擎，也避免配置用 cosyvoice 时没人启动它。
  local list="$AV_SERVICES"
  if [[ "$list" == "auto" ]]; then
    local provider; provider="$(tts_provider)"
    if [[ "$provider" == "cosyvoice" ]]; then
      list="cosy t2i lipsync"
    else
      [[ "$provider" != "voxcpm" && -n "$provider" ]] && warn "未知 tts.provider '$provider'，按 voxcpm 处理"
      list="tts t2i lipsync"
    fi
    info "TTS provider: ${provider:-voxcpm(默认)} → 服务清单: $list"
  fi

  local svc port
  for svc in $list; do
    port="$(svc_port "$svc")"
    if [[ -z "$port" ]]; then warn "未知服务 '$svc',跳过"; continue; fi
    if port_busy "$port"; then
      ok "$svc 已在 :$port 运行,复用"
      continue
    fi
    if ! svc_deployable "$svc"; then
      if [[ "$AV_SERVICES" == "auto" ]]; then
        warn "$svc 未部署,跳过(参见 third_servers/ 下对应目录)"
        continue
      fi
      warn "$svc 未部署,但被显式指定,仍尝试启动"
    fi
    info "启动 $svc → :$port  (日志: logs/$svc.log)"
    bash "$(svc_script "$svc")" > "$LOG_DIR/$svc.log" 2>&1 &
    SERVICES_STARTED+=("$svc")
  done

  # 仅阻塞等待 TTS(必需且加载较快);GPU 服务后台预热,不卡 Web 启动
  local tts_svc=""
  [[ " ${SERVICES_STARTED[*]:-} " == *" tts "* ]] && tts_svc="tts"
  [[ " ${SERVICES_STARTED[*]:-} " == *" cosy "* ]] && tts_svc="cosy"
  if [[ -n "$tts_svc" ]]; then
    local p; p="$(svc_port "$tts_svc")"
    info "等待 TTS($tts_svc) 就绪(:$p)..."
    local ready=0
    for _ in $(seq 1 60); do
      if curl -s -m 2 "http://127.0.0.1:$p/health" >/dev/null 2>&1; then ready=1; break; fi
      sleep 3
    done
    if [[ "$ready" == "1" ]]; then ok "TTS 就绪"; else warn "TTS 未在约 180s 内就绪,详见 logs/$tts_svc.log"; fi
  fi
  if [[ " ${SERVICES_STARTED[*]:-} " == *" t2i "* || " ${SERVICES_STARTED[*]:-} " == *" lipsync "* ]]; then
    info "文生图/口型为 GPU 服务,首次加载需数分钟;可用 'npx tsx bin/autovideo.ts doctor' 复查"
  fi
}

# AI 服务由 start_services 后台拉起后常驻；停止统一走 ./stop.sh（内部调用
# third_servers/stop.sh），这里不再挂 trap 随脚本退出而停止。

# ── 主流程 ────────────────────────────────────────────────────────────────────
echo -e "${BOLD}AutoVideo 启动脚本${NC}  (模式: ${MODE})"

case "$MODE" in
  check)
    check_env
    echo
    ok "环境检查通过"
    ;;
  build)
    check_env
    install_deps
    build_all
    echo
    ok "构建完成，可运行 ./start.sh prod 启动生产服务器"
    ;;
  dev)
    check_env
    install_deps
    start_services
    start_dev
    ;;
  prod)
    check_env
    install_deps
    # 如果 dist 不存在则自动构建
    if [[ ! -f dist/server/server/index.js ]] || [[ ! -f web/dist/index.html ]]; then
      warn "未找到构建产物，自动执行构建..."
      build_all
    fi
    start_services
    start_prod
    ;;
  *)
    err "未知模式: ${MODE}"
    echo "用法: $0 [dev|prod|build|check]"
    exit 1
    ;;
esac
