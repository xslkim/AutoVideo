#!/usr/bin/env bash
set -euo pipefail

VOXCPM_MODEL_DIR="${VOXCPM_MODEL_DIR:-/home/xsl/models/VoxCPM2}"
VOXCPM_HOST="${VOXCPM_HOST:-127.0.0.1}"
VOXCPM_PORT="${VOXCPM_PORT:-8000}"

VENV_PYTHON="/home/xsl/tts-server/.venv/bin/python"
TTS_SERVER_DIR="/home/xsl/AutoVideo/tts-server"
PYTHONPATH="/home/xsl/tts-server/.venv/lib/python3.13/site-packages"

# 检查模型目录
if [ ! -d "$VOXCPM_MODEL_DIR" ]; then
  echo "[ERROR] 模型目录不存在: $VOXCPM_MODEL_DIR"
  echo "请先下载模型权重，或通过 VOXCPM_MODEL_DIR 环境变量指定路径"
  exit 1
fi

# 检查 Python 虚拟环境
if [ ! -f "$VENV_PYTHON" ]; then
  echo "[ERROR] 虚拟环境 Python 不存在: $VENV_PYTHON"
  exit 1
fi

echo "[VoxCPM] 模型目录: $VOXCPM_MODEL_DIR"
echo "[VoxCPM] 监听地址: http://$VOXCPM_HOST:$VOXCPM_PORT"
echo "[VoxCPM] 启动中..."

export VOXCPM_MODEL_DIR
export PYTHONPATH

exec "$VENV_PYTHON" -m uvicorn server:app \
  --host "$VOXCPM_HOST" \
  --port "$VOXCPM_PORT" \
  --app-dir "$TTS_SERVER_DIR"
