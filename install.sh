#!/usr/bin/env bash
# AutoVideo — one-shot installer
# Target environment: Ubuntu 22.04 + NVIDIA GPU (3090 / 4090)
#
# Installs the framework plus the recommended third-party AI service stack:
#   Fun-CosyVoice3 (TTS, required) + align-tts (char-level alignment) +
#   ComfyUI + Z-Image-Turbo (text-to-image). EchoMimicV3 avatar is opt-in
#   (--with-avatar). Services run as separate HTTP servers; see
#   third_servers/README.md for details.
#
# Usage:
#   bash install.sh                       # framework + recommended services
#   bash install.sh --skip-services       # framework only
#   bash install.sh --skip-tts            # skip Fun-CosyVoice3 TTS (required for narration)
#   bash install.sh --skip-align          # skip align-tts (karaoke subtitles fall back to estimates)
#   bash install.sh --skip-t2i            # skip ComfyUI text-to-image
#   bash install.sh --with-avatar         # also install EchoMimicV3-Flash avatar (GPU-heavy)
#   bash install.sh --skip-model          # skip model weight downloads
#   bash install.sh --skip-align --with-avatar --skip-model   # combine flags

set -euo pipefail

SKIP_TTS=false
SKIP_ALIGN=false
SKIP_T2I=false
WITH_AVATAR=false
SKIP_MODEL=false
for arg in "$@"; do
  case "$arg" in
    --skip-tts)      SKIP_TTS=true ;;
    --skip-align)    SKIP_ALIGN=true ;;
    --skip-t2i)      SKIP_T2I=true ;;
    --with-avatar)   WITH_AVATAR=true ;;
    --skip-services) SKIP_TTS=true; SKIP_ALIGN=true; SKIP_T2I=true ;;
    --skip-model)    SKIP_MODEL=true ;;
    *) echo "[WARN] unknown flag: $arg" ;;
  esac
done
# Exported to child install.sh scripts (they read SKIP_MODEL as 0/1)
[[ "$SKIP_MODEL" == "true" ]] && export SKIP_MODEL=1 || export SKIP_MODEL=0

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
info()  { echo -e "${GREEN}[INFO]${NC} $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC} $*"; }
step()  { echo -e "\n${CYAN}=== $* ===${NC}"; }
error() { echo -e "${RED}[ERROR]${NC} $*"; exit 1; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# ── Step 1: System packages ────────────────────────────────────────────────
step "System packages (ffmpeg / chromium / fonts / python / build tools)"
sudo apt-get update -qq
sudo apt-get install -y -qq \
  ffmpeg chromium-browser fonts-noto-cjk fonts-noto-color-emoji \
  python3-venv python3-pip build-essential util-linux curl git ca-certificates \
  2>/dev/null || warn "some system packages failed to install (continue anyway)"

FFVER=$(ffmpeg -version 2>/dev/null | head -1 | grep -oP '\d+\.\d+' | head -1 || echo "0")
[[ "$(echo "$FFVER" | awk -F. '{print $1}')" -lt 5 ]] \
  && warn "ffmpeg $FFVER < 5.0 — loudnorm two-pass may have issues"

# ── Step 2: Node.js 20+ ────────────────────────────────────────────────────
step "Node.js 20+"
NODE_MAJOR=0
if command -v node &>/dev/null; then
  NODE_MAJOR=$(node -e "console.log(process.version.match(/\d+/)[0])")
fi
if [[ "$NODE_MAJOR" -lt 20 ]]; then
  info "Installing Node.js 20 via nvm..."
  [[ -d "$HOME/.nvm" ]] || curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
  export NVM_DIR="$HOME/.nvm"; [[ -s "$NVM_DIR/nvm.sh" ]] && . "$NVM_DIR/nvm.sh"
  nvm install 20 && nvm use 20
fi
info "Node.js $(node -v)"

# ── Step 3: Framework npm dependencies ─────────────────────────────────────
step "Framework npm dependencies"
npm install
info "npm dependencies installed."

# 本地 config(从 example 复制;用户按需改真实路径)
if [[ ! -f autovideo.config.json && -f autovideo.config.example.json ]]; then
  cp autovideo.config.example.json autovideo.config.json
  info "已从 example 创建 autovideo.config.json — 请修改其中的真实路径(模型权重 / endpoint)"
fi

# ── Step 4: Fun-CosyVoice3 TTS (required for narration) ────────────────────
if [[ "$SKIP_TTS" == "true" ]]; then
  warn "Skipping Fun-CosyVoice3 TTS (--skip-tts) — TTS stage will be unavailable."
else
  step "Fun-CosyVoice3 TTS service (default tts.provider)"
  bash third_servers/cosyvoice-tts/install.sh || warn "CosyVoice TTS install incomplete"
fi

# ── Step 5: align-tts char-level alignment (recommended, CPU-only OK) ──────
if [[ "$SKIP_ALIGN" == "true" ]]; then
  warn "Skipping align-tts (--skip-align) — karaoke subtitles fall back to uniform estimates."
else
  step "align-tts (FunASR) char-level alignment"
  bash third_servers/align-tts/install.sh || warn "align-tts install incomplete"
fi

# ── Step 6: ComfyUI + Z-Image-Turbo text-to-image (recommended) ───────────
if [[ "$SKIP_T2I" == "true" ]]; then
  warn "Skipping ComfyUI text-to-image (--skip-t2i)."
else
  step "ComfyUI + Z-Image-Turbo text-to-image (needs GPU)"
  bash third_servers/comfyui/install.sh || warn "ComfyUI install incomplete (manual setup may be needed)"
fi

# ── Step 7: EchoMimicV3-Flash avatar (opt-in, GPU-heavy) ───────────────────
if [[ "$WITH_AVATAR" == "true" ]]; then
  step "EchoMimicV3-Flash avatar (needs GPU + conda; ~24GB VRAM per inference)"
  bash third_servers/echomimic-avatar/install.sh || warn "EchoMimic install incomplete (manual setup may be needed)"
fi

# ── Step 8: Self-check ─────────────────────────────────────────────────────
step "Self-check (autovideo doctor)"
npx tsx bin/autovideo.ts doctor || true

echo ""
info "========================================="
info " AutoVideo installation complete!"
info "========================================="
echo ""
info "Next steps:"
info "  1. Start the services you need (see third_servers/README.md), e.g.:"
info "       bash third_servers/cosyvoice-tts/start.sh &   # TTS (必需)"
info "       bash third_servers/align-tts/start.sh &       # 字级对齐 (推荐)"
info "       bash third_servers/comfyui/start.sh &         # 文生图 (推荐)"
info "  2. Create and build a video:"
info "       npx tsx bin/autovideo.ts init my-project && cd my-project"
info "       npx tsx bin/autovideo.ts build project.json"
