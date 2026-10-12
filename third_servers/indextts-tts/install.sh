#!/usr/bin/env bash
# IndexTTS-2.5 TTS 服务安装:Python 3.10 venv + clone index-tts 仓库
# + 安装依赖 + 模型下载。所有第三方依赖只装进 .venv,不污染系统 Python。
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

SKIP_MODEL="${SKIP_MODEL:-0}"
INDEXTTS_REPO_URL="${INDEXTTS_REPO_URL:-https://github.com/index-tts/index-tts.git}"
INDEXTTS_REPO_DIR="$SCRIPT_DIR/index-tts"
INDEXTTS_REPO_REF="${INDEXTTS_REPO_REF:-}"   # 例如 tags/v2.5;留空用默认分支
# 模型 ID 以官方发布为准(HuggingFace / ModelScope 二选一,用环境变量覆盖)
INDEXTTS_MODEL_ID="${INDEXTTS_MODEL_ID:-IndexTeam/IndexTTS-2.5}"
INDEXTTS_MODEL_DIR="${INDEXTTS_MODEL_DIR:-$SCRIPT_DIR/models/IndexTTS-2.5}"
# RTX 5090 (sm_120) 需要 CUDA 12.8 构建的 torch;老卡可设 TORCH_INDEX_URL="" 跳过
TORCH_INDEX_URL="${TORCH_INDEX_URL-https://download.pytorch.org/whl/cu128}"

echo "=== [1/4] 创建 Python 3.10 venv ==="
if ! command -v python3.10 >/dev/null 2>&1; then
  echo "[ERROR] 未找到 python3.10(Ubuntu: sudo apt install python3.10 python3.10-venv)" >&2
  exit 1
fi
python3.10 -m venv .venv
.venv/bin/pip install --upgrade pip

echo "=== [2/4] clone index-tts 仓库 ==="
if [ -d "$INDEXTTS_REPO_DIR/.git" ]; then
  echo "[已存在] 跳过 clone"
else
  git clone "$INDEXTTS_REPO_URL" "$INDEXTTS_REPO_DIR"
fi
if [ -n "$INDEXTTS_REPO_REF" ]; then
  git -C "$INDEXTTS_REPO_DIR" checkout "$INDEXTTS_REPO_REF"
fi

echo "=== [3/4] 安装依赖 ==="
# indextts 包本身 + 服务依赖。sox 的 tempo 效果用于 duration_factor 语速调整
# (缺 sox 时该参数退化为日志告警,不影响合成)。
.venv/bin/pip install -e "$INDEXTTS_REPO_DIR"
.venv/bin/pip install fastapi "uvicorn[standard]" soundfile
if [ -n "$TORCH_INDEX_URL" ]; then
  echo "=== [3/4+] 升级 torch/torchaudio(RT 5090 需要 cu128 构建) ==="
  .venv/bin/pip install "torch==2.8.0" "torchaudio==2.8.0" --index-url "$TORCH_INDEX_URL"
fi

echo ""
if [ "$SKIP_MODEL" = "1" ]; then
  echo "=== [4/4] [跳过模型下载] ==="
else
  echo "=== [4/4] 下载 $INDEXTTS_MODEL_ID(优先 ModelScope,失败回退 HuggingFace) ==="
  .venv/bin/python - "$INDEXTTS_MODEL_ID" "$INDEXTTS_MODEL_DIR" <<'EOF'
import sys
model_id, model_dir = sys.argv[1], sys.argv[2]
try:
    from modelscope import snapshot_download
    snapshot_download(model_id, local_dir=model_dir)
except Exception as e:
    print(f"[modelscope 失败,回退 huggingface] {e}")
    from huggingface_hub import snapshot_download
    snapshot_download(model_id, local_dir=model_dir)
EOF
fi

echo ""
echo "=== 安装完成。启动:bash start.sh ==="
echo "提示:模型目录也可软链接到已有权重: ln -s /path/to/IndexTTS-2.5 $INDEXTTS_MODEL_DIR"
