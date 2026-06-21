#!/usr/bin/env bash
# SenseNova-U1 文生图服务启动(参数化)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="${SENSENOVA_REPO_DIR:-$SCRIPT_DIR/repo}"

if [ ! -d "$REPO_DIR" ]; then
  echo "[ERROR] 未找到 SenseNova-U1 仓库: $REPO_DIR" >&2
  echo "请先运行: bash install.sh" >&2
  exit 1
fi
cd "$REPO_DIR"

PORT="${PORT:-8765}"
HOST="${HOST:-0.0.0.0}"
MODEL_DIR="${SENSENOVA_MODEL_PATH:-$REPO_DIR/.model/SenseNova-U1-8B-MoT}"

if [ ! -f "$REPO_DIR/.venv/bin/activate" ]; then
  echo "[ERROR] 未找到 .venv,请在仓库根运行: uv sync --extra web" >&2
  exit 1
fi
if [ ! -f "$MODEL_DIR/config.json" ]; then
  echo "[ERROR] 模型目录缺失 config.json: $MODEL_DIR" >&2
  echo "下载: modelscope download --model sensenova/SenseNova-U1-8B-MoT --local_dir $MODEL_DIR" >&2
  exit 1
fi

# shellcheck source=/dev/null
source "$REPO_DIR/.venv/bin/activate"

export HF_ENDPOINT="${HF_ENDPOINT:-https://hf-mirror.com}"
export SENSENOVA_MODEL_PATH="$MODEL_DIR"
export SENSENOVA_DEVICE_MAP="${SENSENOVA_DEVICE_MAP:-auto}"
export HOST PORT

echo "=== SenseNova-U1 文生图服务 ==="
echo "模型: $MODEL_DIR"
echo "地址: http://127.0.0.1:$PORT/"
exec python -m examples.web_t2i
