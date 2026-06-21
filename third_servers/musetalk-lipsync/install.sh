#!/usr/bin/env bash
# MuseTalk 唇形同步服务安装:clone 上游 + conda 环境 + 下载权重
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

REPO_URL="${MUSETALK_REPO_URL:-https://github.com/TMElyralab/MuseTalk.git}"
REPO_DIR="$SCRIPT_DIR/repo"
CONDA_ENV="${MUSE_CONDA_ENV:-MuseTalk}"
SKIP_MODEL="${SKIP_MODEL:-0}"

echo "=== [1/3] clone 上游仓库 ==="
if [ -d "$REPO_DIR" ]; then
  echo "已存在: $REPO_DIR(跳过 clone)"
else
  git clone "$REPO_URL" "$REPO_DIR"
fi

echo "=== [2/3] 创建 conda 环境 $CONDA_ENV ==="
CONDA_BASE="${CONDA_BASE:-$(conda info --base 2>/dev/null || echo "$HOME/miniconda3")}"
# shellcheck disable=SC1091
source "$CONDA_BASE/etc/profile.d/conda.sh"
conda env list | grep -q "^$CONDA_ENV " || conda create -y -n "$CONDA_ENV" python=3.10
conda activate "$CONDA_ENV"
cd "$REPO_DIR"
pip install -r requirements.txt

if [ "$SKIP_MODEL" = "1" ]; then
  echo "[跳过权重下载]"
else
  echo "=== [3/3] 下载权重 ==="
  bash download_weights.sh || echo "[WARN] 权重下载失败,请手动运行 download_weights.sh"
fi

echo ""
echo "=== 安装完成。启动:bash start.sh ==="
