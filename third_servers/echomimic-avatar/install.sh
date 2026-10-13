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
PYBIN="$CONDA_PREFIX/bin/python"
if command -v uv >/dev/null 2>&1; then
  # 本机 pip 拉镜像站大文件会挂死(CLOSE-WAIT 僵尸连接),uv 无此问题
  uv pip install --python "$PYBIN" -r requirements.txt \
    --index-url https://mirrors.bfsu.edu.cn/pypi/simple \
    --extra-index-url https://mirrors.cloud.tencent.com/pypi/simple
  uv pip install --python "$PYBIN" fastapi "uvicorn[standard]" python-multipart pyloudnorm modelscope \
    --index-url https://mirrors.bfsu.edu.cn/pypi/simple \
    --extra-index-url https://mirrors.cloud.tencent.com/pypi/simple
else
  pip install -r requirements.txt
  pip install fastapi "uvicorn[standard]" python-multipart pyloudnorm modelscope
fi
# 版本钉死(本机实测可用组合;requirements.txt 只有下界,装到最新会踩坑):
# - transformers 5.x 让 src/wav2vec2 的 hidden_states 返回 None(4.56.2 正常)
# - diffusers 0.41 需要 huggingface_hub>=1.0,与 transformers 4.x(<1.0)冲突;
#   0.34.0 同时兼容 hub 0.36 与上游 0.33+ 加载分支
# - pyloudnorm 是 infer_flash.py 的响度归一化依赖,requirements.txt 漏了
PINNED="transformers==4.56.2 huggingface_hub==0.36.2 diffusers==0.34.0 tokenizers==0.22.2"
if command -v uv >/dev/null 2>&1; then
  uv pip install --python "$PYBIN" $PINNED \
    --index-url https://mirrors.bfsu.edu.cn/pypi/simple \
    --extra-index-url https://mirrors.cloud.tencent.com/pypi/simple
else
  pip install $PINNED
fi

if [ "$SKIP_MODEL" = "1" ]; then
  echo "[跳过权重下载]"
else
  echo "=== [3/3] 下载权重(Flash: transformer + Wan2.1-Fun 底模 + chinese-wav2vec2)==="
  export HF_ENDPOINT="${HF_ENDPOINT:-https://hf-mirror.com}"
  pip install -U "huggingface_hub[cli]<1.0" || pip install "huggingface_hub[cli]==0.36.2"
  mkdir -p "$WEIGHT_ROOT"

  # Flash 权重(transformer;快照内文件在根目录,server.py 期望 transformer/ 子目录)
  huggingface-cli download BadToBest/EchoMimicV3 \
    --local-dir "$HF_CACHE_DIR" --include "echomimicv3-flash-pro/*"
  mkdir -p "$WEIGHT_ROOT/transformer"
  cp -n "$HF_CACHE_DIR/echomimicv3-flash-pro/config.json" "$WEIGHT_ROOT/transformer/" 2>/dev/null || true
  cp -n "$HF_CACHE_DIR/echomimicv3-flash-pro/diffusion_pytorch_model.safetensors" "$WEIGHT_ROOT/transformer/"

  # 基础模型 Wan2.1-Fun-V1.1-1.3B-InP(VAE / text encoder 等)
  # 本机 hf-mirror 对 >4GB 文件会断流僵尸化:两个大文件(T5 编码器 11.4GB /
  # CLIP 4.8GB)改从 ModelScope 的 Wan-AI 官方仓库拉取(字节级一致,已校验大小),
  # 其余小文件仍走 HF。
  if [ ! -d "$WEIGHT_ROOT/Wan2.1-Fun-V1.1-1.3B-InP" ]; then
    huggingface-cli download alibaba-pai/Wan2.1-Fun-V1.1-1.3B-InP \
      --local-dir "$WEIGHT_ROOT/Wan2.1-Fun-V1.1-1.3B-InP" \
      --exclude "models_t5_umt5-xxl-enc-bf16.pth" "models_clip_open-clip-xlm-roberta-large-vit-huge-14.pth"
  fi
  "$CONDA_PREFIX/bin/python" - "$WEIGHT_ROOT/Wan2.1-Fun-V1.1-1.3B-InP" <<'PY'
import os, sys
from modelscope import snapshot_download
wan = sys.argv[1]
def need(name, size):
    p = os.path.join(wan, name)
    return not (os.path.isfile(p) and os.path.getsize(p) == size)
if need("models_t5_umt5-xxl-enc-bf16.pth", 11361920418):
    snapshot_download("Wan-AI/Wan2.1-T2V-1.3B",
                      allow_patterns=["models_t5_umt5-xxl-enc-bf16.pth"], local_dir=wan)
if need("models_clip_open-clip-xlm-roberta-large-vit-huge-14.pth", 4772359047):
    snapshot_download("Wan-AI/Wan2.1-I2V-14B-480P",
                      allow_patterns=["models_clip_open-clip-xlm-roberta-large-vit-huge-14.pth"], local_dir=wan)
print("Wan2.1-Fun 大文件就绪")
PY

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
