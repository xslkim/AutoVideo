#!/usr/bin/env bash
# EchoMimicV3-Flash 半身数字人服务启动(参数化)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="${ECHOMIMIC_REPO_DIR:-$SCRIPT_DIR/repo}"

if [ ! -d "$REPO_DIR" ]; then
  echo "[ERROR] 未找到 echomimic_v3 仓库: $REPO_DIR" >&2
  echo "请先运行: bash install.sh" >&2
  exit 1
fi

ECHO_HOST="${ECHO_HOST:-0.0.0.0}"
ECHO_PORT="${ECHO_PORT:-8006}"
CONDA_ENV="${ECHO_CONDA_ENV:-echomimic_v3}"

# 激活 conda 环境
CONDA_BASE="${CONDA_BASE:-$(conda info --base 2>/dev/null || echo "$HOME/miniconda3")}"
# shellcheck disable=SC1091
source "$CONDA_BASE/etc/profile.d/conda.sh"
conda activate "$CONDA_ENV"

echo "Starting EchoMimicV3-Flash avatar API on http://$ECHO_HOST:$ECHO_PORT (POST /avatar, GET /health)"
exec python "$SCRIPT_DIR/server.py" --host "$ECHO_HOST" --port "$ECHO_PORT" --repo-dir "$REPO_DIR" "$@"
