#!/usr/bin/env bash
# MuseTalk 唇形同步服务启动(参数化)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="${MUSETALK_REPO_DIR:-$SCRIPT_DIR/repo}"

if [ ! -d "$REPO_DIR" ]; then
  echo "[ERROR] 未找到 MuseTalk 仓库: $REPO_DIR" >&2
  echo "请先运行: bash install.sh" >&2
  exit 1
fi
cd "$REPO_DIR"

MUSE_HOST="${MUSE_HOST:-0.0.0.0}"
MUSE_PORT="${MUSE_PORT:-8001}"
CONDA_ENV="${MUSE_CONDA_ENV:-MuseTalk}"

# 激活 conda 环境
CONDA_BASE="${CONDA_BASE:-$(conda info --base 2>/dev/null || echo "$HOME/miniconda3")}"
# shellcheck disable=SC1091
source "$CONDA_BASE/etc/profile.d/conda.sh"
conda activate "$CONDA_ENV"

echo "Starting MuseTalk lipsync API on http://$MUSE_HOST:$MUSE_PORT (POST /lipsync, GET /health)"
exec python lipsync_server.py --host "$MUSE_HOST" --port "$MUSE_PORT" --use_float16 "$@"
