#!/usr/bin/env bash
# GLM-Image 文生图服务启动(sglang serve,OpenAI 兼容 /v1/images/generations)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VENV_DIR="${GLM_IMAGE_VENV_DIR:-$SCRIPT_DIR/.venv}"

if [ ! -f "$VENV_DIR/bin/activate" ]; then
  echo "[ERROR] 未找到 .venv,请先运行: bash install.sh" >&2
  exit 1
fi
# shellcheck source=/dev/null
source "$VENV_DIR/bin/activate"

PORT="${PORT:-8005}"
HOST="${HOST:-0.0.0.0}"

# 本地预下载目录存在 config.json 时直接用本地路径,否则用 HF 模型 ID(首次启动自动下载)
MODEL_DIR="${GLM_IMAGE_MODEL_PATH:-$SCRIPT_DIR/models/GLM-Image}"
if [ -f "$MODEL_DIR/config.json" ]; then
  MODEL_PATH="$MODEL_DIR"
else
  MODEL_PATH="${GLM_IMAGE_MODEL_ID:-zai-org/GLM-Image}"
fi

export HF_ENDPOINT="${HF_ENDPOINT:-https://hf-mirror.com}"

echo "=== GLM-Image 文生图服务(sglang) ==="
echo "模型: $MODEL_PATH"
echo "地址: http://127.0.0.1:$PORT/v1/images/generations"
exec sglang serve --model-path "$MODEL_PATH" --host "$HOST" --port "$PORT" ${SGLANG_EXTRA_ARGS:-}
