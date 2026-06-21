#!/usr/bin/env bash
# VoxCPM2 TTS 服务启动脚本(参数化,无硬编码路径)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

VENV_PYTHON="${VENV_PYTHON:-$SCRIPT_DIR/.venv/bin/python}"
VOXCPM_MODEL_DIR="${VOXCPM_MODEL_DIR:?VOXCPM_MODEL_DIR 未设置,请导出指向 VoxCPM2 权重目录}"
VOXCPM_HOST="${VOXCPM_HOST:-127.0.0.1}"
VOXCPM_PORT="${VOXCPM_PORT:-8000}"
VOXCPM_ENABLE_DENOISER="${VOXCPM_ENABLE_DENOISER:-1}"

if [ ! -f "$VENV_PYTHON" ]; then
  echo "[ERROR] 未找到虚拟环境: $VENV_PYTHON" >&2
  echo "请先运行: bash install.sh" >&2
  exit 1
fi

if [ ! -d "$VOXCPM_MODEL_DIR" ]; then
  echo "[ERROR] 模型目录不存在: $VOXCPM_MODEL_DIR" >&2
  echo "请下载 VoxCPM2 权重,或通过 VOXCPM_MODEL_DIR 指定正确路径" >&2
  exit 1
fi

PYTHONPATH="$("$VENV_PYTHON" -c 'import site; print(site.getsitepackages()[0])')"

echo "[VoxCPM] 服务目录: $SCRIPT_DIR"
echo "[VoxCPM] 模型目录: $VOXCPM_MODEL_DIR"
echo "[VoxCPM] 监听地址: http://$VOXCPM_HOST:$VOXCPM_PORT"
echo "[VoxCPM] Denoiser: $VOXCPM_ENABLE_DENOISER"

export VOXCPM_MODEL_DIR VOXCPM_ENABLE_DENOISER PYTHONPATH
exec "$VENV_PYTHON" -m uvicorn server:app --host "$VOXCPM_HOST" --port "$VOXCPM_PORT"
