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
# MuseTalk 1.5(v15)为默认权重;MUSE_VERSION=v1 可回退(需 MUSETALK_WEIGHTS=all 安装)
MUSE_VERSION="${MUSE_VERSION:-v15}"
MUSE_MAX_AVATAR_SECONDS="${MUSE_MAX_AVATAR_SECONDS:-15}"

# 激活 conda 环境
CONDA_BASE="${CONDA_BASE:-$(conda info --base 2>/dev/null || echo "$HOME/miniconda3")}"
# shellcheck disable=SC1091
source "$CONDA_BASE/etc/profile.d/conda.sh"
conda activate "$CONDA_ENV"

EXTRA_ARGS=(--max-avatar-seconds "$MUSE_MAX_AVATAR_SECONDS")
# 新版 lipsync_server.py 接受 --version(选择 musetalkV15/musetalk 权重目录);
# 旧版脚本内部已固定 v15,检测不到该参数则跳过,保持向后兼容。
if grep -q -- '--version' "$REPO_DIR/lipsync_server.py" 2>/dev/null; then
  EXTRA_ARGS+=(--version "$MUSE_VERSION")
fi

echo "Starting MuseTalk lipsync API on http://$MUSE_HOST:$MUSE_PORT (version=$MUSE_VERSION, POST /lipsync, GET /health)"
exec python lipsync_server.py --host "$MUSE_HOST" --port "$MUSE_PORT" --use_float16 "${EXTRA_ARGS[@]}" "$@"
