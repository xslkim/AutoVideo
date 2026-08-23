#!/usr/bin/env bash
# AutoVideo 停止脚本 —— 停止 Web 服务（dev/prod）与第三方 AI 服务。
#
# 用法：
#   ./stop.sh           # 停止一切（Web + TTS/文生图/口型等 AI 服务）
#   ./stop.sh web       # 只停 Web（server :3030 / vite :5173）
#   ./stop.sh ai        # 只停 AI 服务（等价于 bash third_servers/stop.sh）
#
# Web 进程按 logs/ 下的 PID 文件定位（start.sh 以 setsid 启动，杀整个进程组），
# PID 文件丢失时回退为按端口 3030/5173 查找。

set -uo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG_DIR="$REPO_DIR/logs"

info() { echo -e "\033[0;34m[info]\033[0m  $*"; }
ok()   { echo -e "\033[0;32m[ok]\033[0m    $*"; }
warn() { echo -e "\033[1;33m[warn]\033[0m  $*"; }

# 列出监听指定 TCP 端口的进程 PID（与 third_servers/stop.sh 同一套回退）
pids_on_port() {
  local port="$1"
  if command -v lsof >/dev/null 2>&1; then
    lsof -ti "tcp:${port}" -s "tcp:LISTEN" 2>/dev/null
  elif command -v ss >/dev/null 2>&1; then
    ss -ltnpH "sport = :${port}" 2>/dev/null | grep -oP 'pid=\K[0-9]+' | sort -u
  elif command -v fuser >/dev/null 2>&1; then
    fuser "${port}/tcp" 2>/dev/null | tr -s ' ' '\n' | grep -E '^[0-9]+$'
  fi
}

# 按 PID 文件停止进程组（SIGTERM → 10s 等待 → SIGKILL）
stop_pidfile() {
  local name="$1" pidfile="$2"
  [[ -f "$pidfile" ]] || return 0
  local pid
  pid="$(cat "$pidfile" 2>/dev/null)"
  rm -f "$pidfile"
  if [[ -z "$pid" ]] || ! kill -0 "$pid" 2>/dev/null; then
    echo "[$name] 进程已不在（清理了过期 PID 文件）"
    return 0
  fi
  echo "[$name] 停止进程组 $pid"
  kill -- -"$pid" 2>/dev/null || kill "$pid" 2>/dev/null || true
  for _ in $(seq 1 10); do
    kill -0 "$pid" 2>/dev/null || return 0
    sleep 1
  done
  kill -9 -- -"$pid" 2>/dev/null || kill -9 "$pid" 2>/dev/null || true
  sleep 1
  if kill -0 "$pid" 2>/dev/null; then
    warn "[$name] 仍有进程存活，请手动检查 (PID $pid)"
    return 1
  fi
  ok "[$name] 已停止"
}

# 端口兜底：PID 文件丢失时按端口杀
stop_port() {
  local name="$1" port="$2"
  local pids
  pids="$(pids_on_port "$port")"
  if [[ -z "$pids" ]]; then
    echo "[$name] :$port 未在运行"
    return 0
  fi
  echo "[$name] :$port 进程 $(echo "$pids" | tr '\n' ' ')— 发送 SIGTERM"
  # shellcheck disable=SC2086
  kill $pids 2>/dev/null || true
  for _ in $(seq 1 10); do
    pids="$(pids_on_port "$port")"
    [[ -z "$pids" ]] && { ok "[$name] 已停止"; return 0; }
    sleep 1
  done
  # shellcheck disable=SC2086
  kill -9 $pids 2>/dev/null || true
  sleep 1
  [[ -z "$(pids_on_port "$port")" ]] && ok "[$name] 已强制停止" || { warn "[$name] 仍有进程占用 :$port"; return 1; }
}

stop_web() {
  local rc=0
  stop_pidfile "dev-web"   "$LOG_DIR/dev-web.pid" || rc=1
  stop_pidfile "web(prod)" "$LOG_DIR/web.pid"     || rc=1
  # 端口兜底（PID 文件丢失或手动启动的进程）
  stop_port "server" 3030 || rc=1
  stop_port "vite"   5173 || rc=1
  return $rc
}

TARGET="${1:-all}"
rc=0
case "$TARGET" in
  all)
    stop_web || rc=1
    bash "$REPO_DIR/third_servers/stop.sh" || rc=1
    ;;
  web)
    stop_web || rc=1
    ;;
  ai|services)
    bash "$REPO_DIR/third_servers/stop.sh" || rc=1
    ;;
  *)
    echo "未知目标: $TARGET（可选: all | web | ai）" >&2
    exit 1
    ;;
esac

echo
[[ $rc -eq 0 ]] && ok "全部停止完成" || warn "部分进程停止失败，见上方输出"
exit "$rc"
