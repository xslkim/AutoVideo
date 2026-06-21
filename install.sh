#!/usr/bin/env bash
# AutoVideo — one-shot installer
# Target environment: Ubuntu 22.04 + NVIDIA GPU (3090 / 4090)
#
# Installs the framework plus optional third-party AI services (TTS /
# text-to-image / lip-sync). Services run as separate HTTP servers; see
# third_servers/README.md for details.
#
# Usage:
#   bash install.sh                       # framework + all services
#   bash install.sh --skip-services       # framework only
#   bash install.sh --skip-tts            # skip VoxCPM TTS (required for narration)
#   bash install.sh --skip-t2i            # skip SenseNova text-to-image
#   bash install.sh --skip-musetalk       # skip MuseTalk lip-sync
#   bash install.sh --skip-model          # skip model weight downloads
#   bash install.sh --skip-t2i --skip-musetalk --skip-model   # combine flags

set -euo pipefail

SKIP_TTS=false
SKIP_T2I=false
SKIP_MUSETALK=false
SKIP_MODEL=false
for arg in "$@"; do
  case "$arg" in
    --skip-tts)      SKIP_TTS=true ;;
    --skip-t2i)      SKIP_T2I=true ;;
    --skip-musetalk) SKIP_MUSETALK=true ;;
    --skip-services) SKIP_TTS=true; SKIP_T2I=true; SKIP_MUSETALK=true ;;
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

# ── Step 4: VoxCPM2 TTS (required for narration) ───────────────────────────
if [[ "$SKIP_TTS" == "true" ]]; then
  warn "Skipping VoxCPM TTS (--skip-tts) — TTS stage will be unavailable."
else
  step "VoxCPM2 TTS service"
  # Download weights first (so we can point the service at them), then let the
  # service installer skip its own model step.
  if [[ "$SKIP_MODEL" == "0" ]]; then
    VOXCPM_CACHE="${VOXCPM_MODEL_DIR:-$HOME/.cache/voxcpm/VoxCPM2}"
    if [[ -d "$VOXCPM_CACHE" && -n "$(ls -A "$VOXCPM_CACHE" 2>/dev/null)" ]]; then
      info "VoxCPM2 weights already present at $VOXCPM_CACHE"
    else
      info "Downloading VoxCPM2 weights (~4-8 GB) to $VOXCPM_CACHE..."
      mkdir -p "$VOXCPM_CACHE"
      if command -v huggingface-cli &>/dev/null; then
        huggingface-cli download openbmb/VoxCPM2 --local-dir "$VOXCPM_CACHE"
      else
        warn "huggingface-cli not found. Install: pip install huggingface_hub"
        warn "Then: huggingface-cli download openbmb/VoxCPM2 --local-dir $VOXCPM_CACHE"
      fi
    fi
    export VOXCPM_MODEL_DIR="$VOXCPM_CACHE"
    info "Set voxcpm.modelDir in autovideo.config.json to: $VOXCPM_CACHE"
  fi
  SKIP_MODEL=1 bash third_servers/voxcpm-tts/install.sh || warn "VoxCPM TTS install incomplete"
fi

# ── Step 5: SenseNova-U1 text-to-image (optional, image visual mode) ───────
if [[ "$SKIP_T2I" == "true" ]]; then
  warn "Skipping SenseNova text-to-image (--skip-t2i)."
else
  step "SenseNova-U1 text-to-image (optional; needs GPU + uv)"
  bash third_servers/sensenova-t2i/install.sh || warn "SenseNova install incomplete (manual setup may be needed)"
fi

# ── Step 6: MuseTalk lip-sync (optional, avatar mode) ──────────────────────
if [[ "$SKIP_MUSETALK" == "true" ]]; then
  warn "Skipping MuseTalk lip-sync (--skip-musetalk)."
else
  step "MuseTalk lip-sync (optional; needs GPU + conda)"
  bash third_servers/musetalk-lipsync/install.sh || warn "MuseTalk install incomplete (manual setup may be needed)"
fi

# ── Step 7: Self-check ─────────────────────────────────────────────────────
step "Self-check (autovideo doctor)"
npx tsx bin/autovideo.ts doctor || true

echo ""
info "========================================="
info " AutoVideo installation complete!"
info "========================================="
echo ""
info "Next steps:"
info "  1. Start the services you need (see third_servers/README.md), e.g.:"
info "       bash third_servers/voxcpm-tts/start.sh &"
info "  2. Create and build a video:"
info "       npx tsx bin/autovideo.ts init my-project && cd my-project"
info "       npx tsx bin/autovideo.ts build project.json"
