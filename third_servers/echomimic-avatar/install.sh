#!/usr/bin/env bash
# EchoMimicV3-Flash 半身数字人服务安装:clone 上游 + conda 环境 + 下载权重
#
# 显存要求:>= 12 GB(Flash 8 步推理, 768x768, bfloat16)。
# 环境变量:
#   SKIP_MODEL=1            跳过权重下载
#   ECHOMIMIC_REPO_URL      上游仓库地址
#   ECHO_CONDA_ENV          conda 环境名(默认 echomimic_v3)
#   HF_ENDPOINT             HuggingFace 镜像(默认 https://hf-mirror.com)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

REPO_URL="${ECHOMIMIC_REPO_URL:-https://github.com/antgroup/echomimic_v3.git}"
REPO_DIR="$SCRIPT_DIR/repo"
CONDA_ENV="${ECHO_CONDA_ENV:-echomimic_v3}"
SKIP_MODEL="${SKIP_MODEL:-0}"
WEIGHT_ROOT="$REPO_DIR/flash"
HF_CACHE_DIR="$SCRIPT_DIR/models-hf"

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
pip install fastapi "uvicorn[standard]" python-multipart

if [ "$SKIP_MODEL" = "1" ]; then
  echo "[跳过权重下载]"
else
  echo "=== [3/3] 下载权重(Flash: transformer + Wan2.1-Fun 底模 + chinese-wav2vec2)==="
  export HF_ENDPOINT="${HF_ENDPOINT:-https://hf-mirror.com}"
  pip install -U "huggingface_hub[cli]"
  mkdir -p "$WEIGHT_ROOT"

  # Flash 权重(transformer;部分快照内含 chinese-wav2vec2-base)
  huggingface-cli download BadToBest/EchoMimicV3 \
    --local-dir "$HF_CACHE_DIR" --include "echomimicv3-flash-pro/*"
  cp -rn "$HF_CACHE_DIR/echomimicv3-flash-pro/." "$WEIGHT_ROOT/"

  # 基础模型 Wan2.1-Fun-V1.1-1.3B-InP(VAE / text encoder 等)
  if [ ! -d "$WEIGHT_ROOT/Wan2.1-Fun-V1.1-1.3B-InP" ]; then
    huggingface-cli download alibaba-pai/Wan2.1-Fun-V1.1-1.3B-InP \
      --local-dir "$WEIGHT_ROOT/Wan2.1-Fun-V1.1-1.3B-InP"
  fi

  # Flash 用中文音频编码器(若 flash 快照未带,则从 ModelScope 拉取)
  if [ ! -d "$WEIGHT_ROOT/chinese-wav2vec2-base" ]; then
    if pip install -q modelscope; then
      python - "$WEIGHT_ROOT/chinese-wav2vec2-base" <<'PY'
import shutil, sys
from modelscope import snapshot_download
src = snapshot_download("TencentGameMate/chinese-wav2vec2-base")
shutil.copytree(src, sys.argv[1], dirs_exist_ok=True)
print(f"chinese-wav2vec2-base -> {sys.argv[1]}")
PY
    else
      echo "[WARN] 无法安装 modelscope,请手动下载 chinese-wav2vec2-base 到 $WEIGHT_ROOT/"
      echo "       来源: https://modelscope.cn/models/TencentGameMate/chinese-wav2vec2-base"
    fi
  fi

  echo "权重布局(应为):"
  echo "  $WEIGHT_ROOT/transformer/diffusion_pytorch_model.safetensors"
  echo "  $WEIGHT_ROOT/Wan2.1-Fun-V1.1-1.3B-InP/"
  echo "  $WEIGHT_ROOT/chinese-wav2vec2-base/"
fi

echo ""
echo "=== 安装完成。显存需求 >= 12GB。启动:bash start.sh(默认端口 8006)==="
