#!/usr/bin/env bash
# Fun-CosyVoice3-0.5B TTS 服务安装:Python 3.10 venv + clone CosyVoice 仓库
# (含 third_party/Matcha-TTS 子模块) + 安装依赖 + ttsfrd(可选) + 模型下载。
# 所有第三方依赖只装进 .venv,不污染系统 Python。
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

SKIP_MODEL="${SKIP_MODEL:-0}"
SKIP_TTSFRD="${SKIP_TTSFRD:-0}"
COSYVOICE_REPO_URL="${COSYVOICE_REPO_URL:-https://github.com/FunAudioLLM/CosyVoice.git}"
COSYVOICE_REPO_DIR="$SCRIPT_DIR/CosyVoice"
# ModelScope 上 Fun-CosyVoice3-0.5B 的实际模型 ID(无 -2512 后缀的 ID 不存在)
COSYVOICE_MODEL_ID="${COSYVOICE_MODEL_ID:-FunAudioLLM/Fun-CosyVoice3-0.5B-2512}"
COSYVOICE_MODEL_DIR="${COSYVOICE_MODEL_DIR:-$SCRIPT_DIR/models/Fun-CosyVoice3-0.5B}"
TTSFRD_DIR="$COSYVOICE_REPO_DIR/pretrained_models/CosyVoice-ttsfrd"
# RTX 5090 (sm_120) 需要 CUDA 12.8 构建的 torch(官方 requirements 锁的
# torch 2.3.1+cu121 不支持 Blackwell);老卡可设 TORCH_INDEX_URL="" 跳过升级
TORCH_INDEX_URL="${TORCH_INDEX_URL-https://download.pytorch.org/whl/cu128}"

echo "=== [1/5] 创建 Python 3.10 venv ==="
# 官方 requirements 面向 py3.10;ttsfrd whl 也只有 cp310 构建
if ! command -v python3.10 >/dev/null 2>&1; then
  echo "[ERROR] 未找到 python3.10(Ubuntu: sudo apt install python3.10 python3.10-venv)" >&2
  exit 1
fi
python3.10 -m venv .venv
.venv/bin/pip install --upgrade pip

echo "=== [2/5] clone CosyVoice 仓库(含子模块) ==="
if [ -d "$COSYVOICE_REPO_DIR/.git" ]; then
  echo "[已存在] 更新子模块"
  git -C "$COSYVOICE_REPO_DIR" submodule update --init --recursive
elif [ -e "$COSYVOICE_REPO_DIR" ]; then
  echo "[警告] $COSYVOICE_REPO_DIR 存在但不是完整 git 克隆(无 .git),删除后重新 clone"
  rm -rf "$COSYVOICE_REPO_DIR"
  git clone --recursive "$COSYVOICE_REPO_URL" "$COSYVOICE_REPO_DIR"
else
  git clone --recursive "$COSYVOICE_REPO_URL" "$COSYVOICE_REPO_DIR"
fi
# 子模块可能因网络中断而不完整,补拉直到成功(最多 3 次)
for i in 1 2 3; do
  if git -C "$COSYVOICE_REPO_DIR" submodule update --init --recursive; then
    break
  fi
  echo "[重试 $i/3] 子模块拉取失败"
  [ "$i" = "3" ] && { echo "[ERROR] 子模块拉取失败" >&2; exit 1; }
  sleep 3
done

echo "=== [3/5] 安装依赖(CosyVoice requirements) ==="
# openai-whisper==20231117 的 setup.py 依赖 pkg_resources,而 pip 隔离构建环境
# 会拉最新 setuptools(已移除 pkg_resources)——先用旧版 setuptools 无隔离预装
.venv/bin/pip install "setuptools<81" wheel
.venv/bin/pip install --no-build-isolation "openai-whisper==20231117"
.venv/bin/pip install -r "$COSYVOICE_REPO_DIR/requirements.txt"
if [ -n "$TORCH_INDEX_URL" ]; then
  echo "=== [3/5+] 升级 torch/torchaudio(RT 5090 需要 cu128 构建) ==="
  # 钉 2.8.0:已在本机验证与 transformers==4.51.3 / deepspeed / modelscope 兼容;
  # 不钉版本会装到最新版,兼容性需重新验证
  .venv/bin/pip install "torch==2.8.0" "torchaudio==2.8.0" --index-url "$TORCH_INDEX_URL"
fi

echo "=== [4/5] ttsfrd 文本前端(可选,失败则用 wetext 兜底) ==="
if [ "$SKIP_TTSFRD" = "1" ]; then
  echo "[跳过 ttsfrd]"
else
  # ttsfrd 不在 PyPI;官方发布渠道是 ModelScope 的 iic/CosyVoice-ttsfrd 资源包
  # (内含 resource.zip + 两个 whl)。frontend 期望资源位于仓库内 pretrained_models/ 下。
  if .venv/bin/python - "$TTSFRD_DIR" <<'EOF'
import sys
from modelscope import snapshot_download
snapshot_download("iic/CosyVoice-ttsfrd", local_dir=sys.argv[1])
EOF
  then
    ( cd "$TTSFRD_DIR" && [ ! -d resource ] && unzip -q resource.zip -d . ) || true
    # ttsfrd whl 仅 cp310 构建,与上面 venv 的 python3.10 对应
    ( cd "$TTSFRD_DIR" && "$SCRIPT_DIR/.venv/bin/pip" install ttsfrd_dependency-0.1-py3-none-any.whl ttsfrd-0.4.2-cp310-cp310-linux_x86_64.whl ) \
      && echo "[ttsfrd 安装完成]" \
      || echo "[警告] ttsfrd whl 安装失败,运行时将自动回退 wetext"
  else
    echo "[警告] ttsfrd 资源下载失败,运行时将自动回退 wetext(可稍后手动安装,见 README)"
  fi
fi

echo ""
if [ "$SKIP_MODEL" = "1" ]; then
  echo "=== [5/5] [跳过模型下载] ==="
else
  echo "=== [5/5] ModelScope 下载 $COSYVOICE_MODEL_ID ==="
  .venv/bin/python - "$COSYVOICE_MODEL_ID" "$COSYVOICE_MODEL_DIR" <<'EOF'
import sys
from modelscope import snapshot_download
snapshot_download(sys.argv[1], local_dir=sys.argv[2])
EOF
fi

echo ""
echo "=== 安装完成。启动:bash start.sh ==="
