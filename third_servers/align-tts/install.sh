#!/usr/bin/env bash
# align-tts 强制对齐服务安装:Python 3.10 venv + FunASR/ModelScope 依赖 + 模型下载。
# 所有第三方依赖只装进 .venv,不污染系统 Python。
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

SKIP_MODEL="${SKIP_MODEL:-0}"
# ModelScope 上的字级时间戳预测模型(FunASR fa-zh 对应的模型 ID)
ALIGN_MODEL_ID="${ALIGN_MODEL_ID:-iic/speech_timestamp_prediction-v1-16k-offline}"
ALIGN_MODEL_DIR="${ALIGN_MODEL_DIR:-$SCRIPT_DIR/models/speech_timestamp_prediction-v1-16k-offline}"
# RTX 5090 (sm_120) 需 cu128 构建的 torch:TORCH_INDEX_URL=https://download.pytorch.org/whl/cu128
# 默认空 —— FunASR 依赖解析自带 torch;时间戳模型可纯 CPU 跑,通常无需折腾
TORCH_INDEX_URL="${TORCH_INDEX_URL-}"

echo "=== [1/3] 创建 Python 3.10 venv ==="
if ! command -v python3.10 >/dev/null 2>&1; then
  echo "[ERROR] 未找到 python3.10(Ubuntu: sudo apt install python3.10 python3.10-venv)" >&2
  exit 1
fi
python3.10 -m venv .venv
.venv/bin/pip install --upgrade pip

echo "=== [2/3] 安装依赖(funasr + modelscope + fastapi) ==="
# funasr 会带入 torch/torchaudio;modelscope 用于 install.sh 预下载模型
.venv/bin/pip install fastapi "uvicorn[standard]" soundfile modelscope funasr
if [ -n "$TORCH_INDEX_URL" ]; then
  echo "=== [2/3+] 升级 torch/torchaudio(新显卡需要更新的 CUDA 构建) ==="
  .venv/bin/pip install --upgrade torch torchaudio --index-url "$TORCH_INDEX_URL"
fi

echo ""
if [ "$SKIP_MODEL" = "1" ]; then
  echo "=== [3/3] [跳过模型下载](首次启动时 FunASR 会自动从 ModelScope 拉取) ==="
else
  echo "=== [3/3] ModelScope 下载 $ALIGN_MODEL_ID ==="
  .venv/bin/python - "$ALIGN_MODEL_ID" "$ALIGN_MODEL_DIR" <<'EOF'
import sys
from modelscope import snapshot_download
snapshot_download(sys.argv[1], revision="v2.0.4", local_dir=sys.argv[2])
EOF
fi

echo ""
echo "=== 安装完成。启动:bash start.sh ==="
