#!/usr/bin/env bash
# VoxCPM2 TTS 服务安装:创建 venv + 安装依赖。模型权重需单独下载。
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

SKIP_MODEL="${SKIP_MODEL:-0}"

echo "=== [1/2] 创建 Python venv ==="
python3 -m venv .venv

echo "=== [2/2] 安装依赖 ==="
.venv/bin/pip install -r requirements.txt

echo ""
if [ "$SKIP_MODEL" = "1" ]; then
  echo "[跳过模型下载]"
else
  echo "=== 模型权重(需手动) ==="
  echo "请从 VoxCPM2 上游下载权重,然后:"
  echo "  export VOXCPM_MODEL_DIR=/path/to/VoxCPM2"
fi

echo ""
echo "=== 安装完成。启动:bash start.sh ==="
