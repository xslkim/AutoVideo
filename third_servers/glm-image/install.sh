#!/usr/bin/env bash
# GLM-Image 文生图服务安装:创建 venv + 安装 sglang[diffusion] + (可选)预下载模型
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

VENV_DIR="$SCRIPT_DIR/.venv"
MODEL_ID="${GLM_IMAGE_MODEL_ID:-zai-org/GLM-Image}"
MODEL_DIR="${GLM_IMAGE_MODEL_PATH:-$SCRIPT_DIR/models/GLM-Image}"
SKIP_MODEL="${SKIP_MODEL:-0}"

echo "=== [1/3] 创建 Python 虚拟环境 ==="
command -v uv >/dev/null 2>&1 || { echo "[ERROR] 未安装 uv:pip install uv,或见 https://github.com/astral-sh/uv" >&2; exit 1; }
if [ ! -f "$VENV_DIR/bin/activate" ]; then
  uv venv "$VENV_DIR" --python 3.10
else
  echo "已存在: $VENV_DIR(跳过创建)"
fi
# shellcheck source=/dev/null
source "$VENV_DIR/bin/activate"

echo "=== [2/3] 安装 sglang[diffusion](含 GLM-Image 文生图支持) ==="
# sglang 的 diffusion/image 支持迭代快,默认从 GitHub 主干安装;
# 如需稳定版可: uv pip install "sglang[diffusion]" (PyPI)
SGLANG_SPEC="${SGLANG_SPEC:-sglang[diffusion] @ git+https://github.com/sgl-project/sglang.git#subdirectory=python}"
uv pip install "$SGLANG_SPEC"

if [ "$SKIP_MODEL" = "1" ]; then
  echo "[跳过模型预下载] 首次 start.sh 时 sglang 会自动下载 $MODEL_ID"
else
  echo "=== [3/3] 预下载模型权重 $MODEL_ID(数十 GB,可能耗时很久) ==="
  export HF_ENDPOINT="${HF_ENDPOINT:-https://hf-mirror.com}"
  if command -v hf >/dev/null 2>&1; then
    hf download "$MODEL_ID" --local-dir "$MODEL_DIR" \
      || echo "[WARN] hf 下载失败,可跳过(start.sh 会自动下载)或手动下载到 $MODEL_DIR"
  else
    uv pip install "huggingface_hub[cli]"
    hf download "$MODEL_ID" --local-dir "$MODEL_DIR" \
      || echo "[WARN] hf 下载失败,可跳过(start.sh 会自动下载)或手动下载到 $MODEL_DIR"
  fi
fi

echo ""
echo "=== 安装完成。启动:bash start.sh ==="
