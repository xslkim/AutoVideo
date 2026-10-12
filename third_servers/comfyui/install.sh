#!/usr/bin/env bash
# ComfyUI(server 模式)+ Z-Image-Turbo FP8 安装:clone 上游 + venv + 下载模型权重
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

REPO_URL="${COMFYUI_REPO_URL:-https://github.com/comfyanonymous/ComfyUI.git}"
REPO_DIR="$SCRIPT_DIR/repo"
SKIP_MODEL="${SKIP_MODEL:-0}"

echo "=== [1/3] clone ComfyUI ==="
if [ -d "$REPO_DIR" ]; then
  echo "已存在: $REPO_DIR(跳过 clone)"
else
  git clone "$REPO_URL" "$REPO_DIR"
fi

echo "=== [2/3] 创建 venv 并安装依赖 ==="
command -v uv >/dev/null 2>&1 || { echo "[ERROR] 未安装 uv:pip install uv,或见 https://github.com/astral-sh/uv" >&2; exit 1; }
if [ ! -f "$REPO_DIR/.venv/bin/activate" ]; then
  uv venv "$REPO_DIR/.venv" --python 3.12
fi
# shellcheck source=/dev/null
source "$REPO_DIR/.venv/bin/activate"
uv pip install -r "$REPO_DIR/requirements.txt"

if [ "$SKIP_MODEL" = "1" ]; then
  echo "[跳过模型下载]"
else
  echo "=== [3/3] 下载 Z-Image-Turbo FP8 模型权重(约 20 GB) ==="
  export HF_ENDPOINT="${HF_ENDPOINT:-https://hf-mirror.com}"
  MODELS_DIR="$REPO_DIR/models"

  # 文件名与上游仓库均可通过环境变量覆盖(上游改名时不必改脚本)
  UNET_FILE="${COMFYUI_UNET_FILE:-z-image-turbo-fp8-e4m3fn.safetensors}"
  UNET_URL="${COMFYUI_UNET_URL:-$HF_ENDPOINT/T5B/Z-Image-Turbo-FP8/resolve/main/$UNET_FILE}"
  CLIP_FILE="${COMFYUI_CLIP_FILE:-qwen_3_4b.safetensors}"
  CLIP_URL="${COMFYUI_CLIP_URL:-$HF_ENDPOINT/Comfy-Org/z_image_turbo/resolve/main/split_files/text_encoders/$CLIP_FILE}"
  VAE_FILE="${COMFYUI_VAE_FILE:-ae.safetensors}"
  VAE_URL="${COMFYUI_VAE_URL:-$HF_ENDPOINT/Comfy-Org/z_image_turbo/resolve/main/split_files/vae/$VAE_FILE}"

  mkdir -p "$MODELS_DIR/diffusion_models" "$MODELS_DIR/text_encoders" "$MODELS_DIR/vae"

  download() { # download <url> <dest>
    local url="$1" dest="$2"
    if [ -f "$dest" ]; then
      echo "已存在: $dest(跳过)"
    else
      echo "下载: $url"
      curl -fL -C - -o "$dest" "$url" || { echo "[WARN] 下载失败: $url(可稍后重跑 install.sh)" >&2; return 1; }
    fi
  }

  download "$UNET_URL" "$MODELS_DIR/diffusion_models/$UNET_FILE" || true
  download "$CLIP_URL" "$MODELS_DIR/text_encoders/$CLIP_FILE" || true
  download "$VAE_URL"  "$MODELS_DIR/vae/$VAE_FILE" || true
fi

echo ""
echo "=== 安装完成。启动:bash start.sh ==="
