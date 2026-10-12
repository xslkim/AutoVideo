#!/usr/bin/env bash
# IndexTTS-2.5 TTS 服务启动脚本(参数化,无硬编码路径)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

VENV_PYTHON="${VENV_PYTHON:-$SCRIPT_DIR/.venv/bin/python}"
# 模型默认在服务目录内(models/IndexTTS-2.5),可用软链接指向真实权重
INDEXTTS_MODEL_DIR="${INDEXTTS_MODEL_DIR:-$SCRIPT_DIR/models/IndexTTS-2.5}"
INDEXTTS_REPO_DIR="${INDEXTTS_REPO_DIR:-$SCRIPT_DIR/index-tts}"
INDEXTTS_VOICE_DIR="${INDEXTTS_VOICE_DIR:-$SCRIPT_DIR/voices}"
INDEXTTS_HOST="${INDEXTTS_HOST:-127.0.0.1}"
INDEXTTS_PORT="${INDEXTTS_PORT:-8004}"

if [ ! -f "$VENV_PYTHON" ]; then
  echo "[ERROR] 未找到虚拟环境: $VENV_PYTHON" >&2
  echo "请先运行: bash install.sh" >&2
  exit 1
fi

if [ ! -d "$INDEXTTS_REPO_DIR/indextts" ]; then
  echo "[ERROR] index-tts 仓库不存在: $INDEXTTS_REPO_DIR" >&2
  echo "请先运行: bash install.sh" >&2
  exit 1
fi

if [ ! -d "$INDEXTTS_MODEL_DIR" ]; then
  echo "[ERROR] 模型目录不存在: $INDEXTTS_MODEL_DIR" >&2
  echo "请运行 bash install.sh 下载模型,或通过 INDEXTTS_MODEL_DIR 指定正确路径" >&2
  exit 1
fi

echo "[IndexTTS] 服务目录: $SCRIPT_DIR"
echo "[IndexTTS] 模型目录: $INDEXTTS_MODEL_DIR"
echo "[IndexTTS] 监听地址: http://$INDEXTTS_HOST:$INDEXTTS_PORT"

export INDEXTTS_MODEL_DIR INDEXTTS_REPO_DIR INDEXTTS_VOICE_DIR
exec "$VENV_PYTHON" -m uvicorn server:app --host "$INDEXTTS_HOST" --port "$INDEXTTS_PORT"
