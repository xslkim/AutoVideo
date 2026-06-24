#!/usr/bin/env bash
# 停止 AutoVideo 第三方服务(按监听端口定位进程,优雅关停)。
#
# 用法:
#   bash third_servers/stop.sh              # 停止全部(tts + t2i + lipsync)
#   bash third_servers/stop.sh tts          # 只停某个/某几个
#   bash third_servers/stop.sh t2i lipsync
#
# 端口可用环境变量覆盖(与各 start.sh 默认一致):
#   VOXCPM_PORT(8000) / SENSENOVA_PORT(8765) / MUSE_PORT(8001)
set -uo pipefail

VOXCPM_PORT="${VOXCPM_PORT:-8000}"
SENSENOVA_PORT="${SENSENOVA_PORT:-${PORT:-8765}}"
MUSE_PORT="${MUSE_PORT:-8001}"

# 列出监听指定 TCP 端口的进程 PID(优先 lsof,退而求其次 ss / fuser)
pids_on_port() {
  local port="$1"
  if command -v lsof >/dev/null 2>&1; then
    lsof -ti "tcp:${port}" -s "tcp:LISTEN" 2>/dev/null
  elif command -v ss >/dev/null 2>&1; then
    ss -ltnpH "sport = :${port}" 2>/dev/null \
      | grep -oP 'pid=\K[0-9]+' | sort -u
  elif command -v fuser >/dev/null 2>&1; then
    fuser "${port}/tcp" 2>/dev/null | tr -s ' ' '\n' | grep -E '^[0-9]+$'
  fi
}

stop_one() {
  local name="$1" port="$2"
  local pids
  pids="$(pids_on_port "$port")"
  if [ -z "$pids" ]; then
    echo "[$name] :$port 未在运行"
    return 0
  fi

  echo "[$name] :$port 进程 $(echo "$pids" | tr '\n' ' ')— 发送 SIGTERM"
  # shellcheck disable=SC2086
  kill $pids 2>/dev/null || true

  # 最多等 10s 让其优雅退出
  for _ in $(seq 1 10); do
    pids="$(pids_on_port "$port")"
    [ -z "$pids" ] && { echo "[$name] 已停止"; return 0; }
    sleep 1
  done

  echo "[$name] 仍存活,发送 SIGKILL"
  # shellcheck disable=SC2086
  kill -9 $pids 2>/dev/null || true
  sleep 1
  if [ -z "$(pids_on_port "$port")" ]; then
    echo "[$name] 已强制停止"
  else
    echo "[$name] 警告:仍有进程占用 :$port" >&2
    return 1
  fi
}

targets=("$@")
[ ${#targets[@]} -eq 0 ] && targets=(tts t2i lipsync)

rc=0
for t in "${targets[@]}"; do
  case "$t" in
    tts|voxcpm)        stop_one "VoxCPM TTS"  "$VOXCPM_PORT"    || rc=1 ;;
    t2i|sensenova)     stop_one "SenseNova"   "$SENSENOVA_PORT" || rc=1 ;;
    lipsync|musetalk)  stop_one "MuseTalk"    "$MUSE_PORT"      || rc=1 ;;
    *) echo "未知服务: $t (可选: tts | t2i | lipsync)" >&2; rc=1 ;;
  esac
done

exit "$rc"
