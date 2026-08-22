#!/usr/bin/env bash
# Fun-CosyVoice3-0.5B TTS 服务启动脚本(参数化,无硬编码路径)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

VENV_PYTHON="${VENV_PYTHON:-$SCRIPT_DIR/.venv/bin/python}"
# 模型默认在服务目录内(models/Fun-CosyVoice3-0.5B),可用软链接指向真实权重
COSYVOICE_MODEL_DIR="${COSYVOICE_MODEL_DIR:-$SCRIPT_DIR/models/Fun-CosyVoice3-0.5B}"
COSYVOICE_REPO_DIR="${COSYVOICE_REPO_DIR:-$SCRIPT_DIR/CosyVoice}"
COSYVOICE_VOICE_DIR="${COSYVOICE_VOICE_DIR:-$SCRIPT_DIR/voices}"
COSYVOICE_HOST="${COSYVOICE_HOST:-127.0.0.1}"
COSYVOICE_PORT="${COSYVOICE_PORT:-8002}"

if [ ! -f "$VENV_PYTHON" ]; then
  echo "[ERROR] 未找到虚拟环境: $VENV_PYTHON" >&2
  echo "请先运行: bash install.sh" >&2
  exit 1
fi

if [ ! -d "$COSYVOICE_REPO_DIR/cosyvoice" ]; then
  echo "[ERROR] CosyVoice 仓库不存在: $COSYVOICE_REPO_DIR" >&2
  echo "请先运行: bash install.sh" >&2
  exit 1
fi

if [ ! -d "$COSYVOICE_MODEL_DIR" ]; then
  echo "[ERROR] 模型目录不存在: $COSYVOICE_MODEL_DIR" >&2
  echo "请运行 bash install.sh 下载模型,或通过 COSYVOICE_MODEL_DIR 指定正确路径" >&2
  exit 1
fi

echo "[CosyVoice] 服务目录: $SCRIPT_DIR"
echo "[CosyVoice] 模型目录: $COSYVOICE_MODEL_DIR"
echo "[CosyVoice] 监听地址: http://$COSYVOICE_HOST:$COSYVOICE_PORT"

export COSYVOICE_MODEL_DIR COSYVOICE_REPO_DIR COSYVOICE_VOICE_DIR
exec "$VENV_PYTHON" -m uvicorn server:app --host "$COSYVOICE_HOST" --port "$COSYVOICE_PORT"
