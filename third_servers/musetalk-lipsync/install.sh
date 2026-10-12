#!/usr/bin/env bash
# MuseTalk 唇形同步服务安装:clone 上游 + conda 环境 + 下载权重
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

REPO_URL="${MUSETALK_REPO_URL:-https://github.com/TMElyralab/MuseTalk.git}"
REPO_DIR="$SCRIPT_DIR/repo"
CONDA_ENV="${MUSE_CONDA_ENV:-MuseTalk}"
SKIP_MODEL="${SKIP_MODEL:-0}"
# 权重集:v15(默认, MuseTalk 1.5 + 共享辅助模型)| all(上游 download_weights.sh, 含 V1.0)
MUSETALK_WEIGHTS="${MUSETALK_WEIGHTS:-v15}"

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
elif [ "$MUSETALK_WEIGHTS" = "all" ]; then
  echo "=== [3/3] 下载权重(全量: V1.0 + V1.5 + 辅助模型)==="
  bash download_weights.sh || echo "[WARN] 权重下载失败,请手动运行 download_weights.sh"
else
  echo "=== [3/3] 下载权重(MuseTalk 1.5 / v15 集)==="
  # 与上游 download_weights.sh 相同来源,仅去掉 V1.0(musetalk/)部分。
  export HF_ENDPOINT="${HF_ENDPOINT:-https://hf-mirror.com}"
  pip install -U "huggingface_hub[cli]" gdown
  mkdir -p models/musetalkV15 models/syncnet models/dwpose models/face-parse-bisent models/sd-vae models/whisper
  huggingface-cli download TMElyralab/MuseTalk \
    --local-dir models \
    --include "musetalkV15/musetalk.json" "musetalkV15/unet.pth"
  huggingface-cli download stabilityai/sd-vae-ft-mse \
    --local-dir models/sd-vae --include "config.json" "diffusion_pytorch_model.bin"
  huggingface-cli download openai/whisper-tiny \
    --local-dir models/whisper --include "config.json" "pytorch_model.bin" "preprocessor_config.json"
  huggingface-cli download yzd-v/DWPose \
    --local-dir models/dwpose --include "dw-ll_ucoco_384.pth"
  huggingface-cli download ByteDance/LatentSync \
    --local-dir models/syncnet --include "latentsync_syncnet.pt"
  gdown --id 154JgKpzCPW82qINcVieuPH3fZ2e0P812 -O models/face-parse-bisent/79999_iter.pth
  curl -L https://download.pytorch.org/models/resnet18-5c106cde.pth \
    -o models/face-parse-bisent/resnet18-5c106cde.pth
fi

echo ""
echo "=== 安装完成。启动:bash start.sh ==="
