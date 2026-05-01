#!/usr/bin/env bash
# AutoVideo — one-shot installer (Ubuntu 22.04+)
# Usage: bash install.sh [--skip-model]

set -euo pipefail

SKIP_MODEL=false
if [[ "${1:-}" == "--skip-model" ]]; then
  SKIP_MODEL=true
fi

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

info()  { echo -e "${GREEN}[INFO]${NC} $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC} $*"; }
error() { echo -e "${RED}[ERROR]${NC} $*"; exit 1; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ── Step 1: System packages ────────────────────────────────────────────────
info "Installing system packages..."

sudo apt-get update -qq
sudo apt-get install -y -qq \
  ffmpeg \
  chromium-browser \
  fonts-noto-cjk \
  fonts-noto-color-emoji \
  python3-venv \
  python3-pip \
  build-essential \
  util-linux \
  curl \
  git \
  ca-certificates \
  2>/dev/null

# Verify ffmpeg >= 5.0
FFVER=$(ffmpeg -version 2>/dev/null | head -1 | grep -oP '\d+\.\d+' | head -1)
if [[ "$(echo "$FFVER" | awk -F. '{print $1}')" -lt 5 ]]; then
  warn "ffmpeg version $FFVER is below 5.0 — loudnorm two-pass may have issues"
fi

info "System packages installed."

# ── Step 2: Node.js 20+ ────────────────────────────────────────────────────
if command -v node &>/dev/null; then
  NODE_MAJOR=$(node -e "console.log(process.version.match(/\d+/)[0])")
  if [[ "$NODE_MAJOR" -ge 20 ]]; then
    info "Node.js $(node -v) already installed."
  else
    warn "Node.js $(node -v) found but < 20. Installing via nvm..."
    NODE_MAJOR=0
  fi
else
  NODE_MAJOR=0
fi

if [[ "$NODE_MAJOR" -lt 20 ]]; then
  info "Installing Node.js 20 via nvm..."
  if [[ ! -d "$HOME/.nvm" ]]; then
    curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
  fi
  export NVM_DIR="$HOME/.nvm"
  [[ -s "$NVM_DIR/nvm.sh" ]] && . "$NVM_DIR/nvm.sh"
  nvm install 20
  nvm use 20
  info "Node.js $(node -v) installed."
fi

# ── Step 3: Project npm dependencies ───────────────────────────────────────
info "Installing npm dependencies..."
cd "$SCRIPT_DIR"
npm install
info "npm dependencies installed."

# ── Step 4: Python venv for TTS server ─────────────────────────────────────
if [[ -f "tts-server/requirements.txt" ]]; then
  info "Setting up Python venv for TTS server..."
  python3 -m venv tts-server/.venv
  tts-server/.venv/bin/pip install --quiet -r tts-server/requirements.txt
  info "Python venv ready."
else
  warn "tts-server/requirements.txt not found — skipping Python venv setup."
fi

# ── Step 5: VoxCPM2 model weights ──────────────────────────────────────────
if [[ "$SKIP_MODEL" == "true" ]]; then
  warn "Skipping VoxCPM2 model download (--skip-model)."
else
  VOXCPM_CACHE="$HOME/.cache/voxcpm/VoxCPM2"
  if [[ -d "$VOXCPM_CACHE" ]] && [[ -n "$(ls -A "$VOXCPM_CACHE" 2>/dev/null)" ]]; then
    info "VoxCPM2 model weights already present at $VOXCPM_CACHE."
  else
    info "Downloading VoxCPM2 model weights (~4-8 GB)..."
    mkdir -p "$VOXCPM_CACHE"
    if command -v huggingface-cli &>/dev/null; then
      huggingface-cli download openbmb/VoxCPM2 --local-dir "$VOXCPM_CACHE"
    else
      warn "huggingface-cli not found. Install with: pip install huggingface_hub"
      warn "Then run: huggingface-cli download openbmb/VoxCPM2 --local-dir $VOXCPM_CACHE"
    fi
    info "VoxCPM2 model weights downloaded."
  fi
fi

# ── Step 6: Self-check ─────────────────────────────────────────────────────
info "Running autovideo doctor..."
if [[ -f "bin/autovideo.ts" ]]; then
  npx tsx bin/autovideo.ts doctor || true
else
  warn "bin/autovideo.ts not found — skipping doctor check."
fi

echo ""
info "========================================="
info " AutoVideo installation complete!"
info "========================================="
echo ""
info "Quick start:"
info "  autovideo init my-project"
info "  cd my-project"
info "  autovideo build project.json"
