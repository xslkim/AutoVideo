#!/usr/bin/env bash
# align-tts 强制对齐服务启动脚本(参数化,无硬编码路径)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

VENV_PYTHON="${VENV_PYTHON:-$SCRIPT_DIR/.venv/bin/python}"
ALIGN_HOST="${ALIGN_HOST:-127.0.0.1}"
ALIGN_PORT="${ALIGN_PORT:-8003}"
# 优先用 install.sh 下载到服务目录内的模型;没有则给 ModelScope ID,
# FunASR 首次启动会自动下载
ALIGN_MODEL_DIR_DEFAULT="$SCRIPT_DIR/models/speech_timestamp_prediction-v1-16k-offline"
if [ -z "${ALIGN_MODEL:-}" ]; then
  if [ -d "$ALIGN_MODEL_DIR_DEFAULT" ]; then
    ALIGN_MODEL="$ALIGN_MODEL_DIR_DEFAULT"
  else
    ALIGN_MODEL="iic/speech_timestamp_prediction-v1-16k-offline"
  fi
fi
ALIGN_DEVICE="${ALIGN_DEVICE:-cpu}"

if [ ! -f "$VENV_PYTHON" ]; then
  echo "[ERROR] 未找到虚拟环境: $VENV_PYTHON" >&2
  echo "请先运行: bash install.sh" >&2
  exit 1
fi

echo "[align-tts] 服务目录: $SCRIPT_DIR"
echo "[align-tts] 对齐模型: $ALIGN_MODEL"
echo "[align-tts] 推理设备: $ALIGN_DEVICE"
echo "[align-tts] 监听地址: http://$ALIGN_HOST:$ALIGN_PORT"

export ALIGN_MODEL ALIGN_DEVICE
exec "$VENV_PYTHON" -m uvicorn server:app --host "$ALIGN_HOST" --port "$ALIGN_PORT"
