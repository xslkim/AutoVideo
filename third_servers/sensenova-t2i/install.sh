#!/usr/bin/env bash
# SenseNova-U1 文生图服务安装:clone 上游 + uv sync + 下载模型
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

REPO_URL="${SENSENOVA_REPO_URL:-https://github.com/OpenSenseNova/SenseNova-U1.git}"
REPO_DIR="$SCRIPT_DIR/repo"
SKIP_MODEL="${SKIP_MODEL:-0}"

echo "=== [1/3] clone 上游仓库 ==="
if [ -d "$REPO_DIR" ]; then
  echo "已存在: $REPO_DIR(跳过 clone)"
else
  git clone "$REPO_URL" "$REPO_DIR"
fi

echo "=== [2/3] 安装依赖(uv sync --extra web) ==="
cd "$REPO_DIR"
command -v uv >/dev/null 2>&1 || { echo "[ERROR] 未安装 uv:pip install uv,或见 https://github.com/astral-sh/uv" >&2; exit 1; }
uv sync --extra web

if [ "$SKIP_MODEL" = "1" ]; then
  echo "[跳过模型下载]"
else
  echo "=== [3/3] 下载模型权重(数十 GB,可能耗时很久) ==="
  MODEL_DIR="${SENSENOVA_MODEL_PATH:-$REPO_DIR/.model/SenseNova-U1-8B-MoT}"
  modelscope download --model sensenova/SenseNova-U1-8B-MoT --local_dir "$MODEL_DIR" \
    || echo "[WARN] modelscope 下载失败或未安装,请手动下载到 $MODEL_DIR"
fi

echo ""
echo "=== 安装完成。启动:bash start.sh ==="
