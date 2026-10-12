#!/usr/bin/env bash
# ComfyUI 文生图服务启动(server 模式,/prompt + /history + /view API)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="${COMFYUI_REPO_DIR:-$SCRIPT_DIR/repo}"

if [ ! -d "$REPO_DIR" ]; then
  echo "[ERROR] 未找到 ComfyUI 仓库: $REPO_DIR" >&2
  echo "请先运行: bash install.sh" >&2
  exit 1
fi
if [ ! -f "$REPO_DIR/.venv/bin/activate" ]; then
  echo "[ERROR] 未找到 .venv,请先运行: bash install.sh" >&2
  exit 1
fi

UNET_FILE="${COMFYUI_UNET_FILE:-z-image-turbo-fp8-e4m3fn.safetensors}"
CLIP_FILE="${COMFYUI_CLIP_FILE:-qwen_3_4b.safetensors}"
VAE_FILE="${COMFYUI_VAE_FILE:-ae.safetensors}"
for f in "diffusion_models/$UNET_FILE" "text_encoders/$CLIP_FILE" "vae/$VAE_FILE"; do
  if [ ! -f "$REPO_DIR/models/$f" ]; then
    echo "[ERROR] 模型缺失: $REPO_DIR/models/$f" >&2
    echo "请重跑: bash install.sh(或 SKIP_MODEL=0)" >&2
    exit 1
  fi
done

PORT="${PORT:-8188}"
HOST="${HOST:-0.0.0.0}"

# shellcheck source=/dev/null
source "$REPO_DIR/.venv/bin/activate"

echo "=== ComfyUI 文生图服务(Z-Image-Turbo FP8) ==="
echo "地址: http://127.0.0.1:$PORT/"
echo "工作流模板: $SCRIPT_DIR/workflow-z-image-turbo-fp8.api.json"
cd "$REPO_DIR"
exec python main.py --listen "$HOST" --port "$PORT" ${COMFYUI_EXTRA_ARGS:-}
