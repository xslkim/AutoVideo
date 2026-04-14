#!/usr/bin/env bash
# resume-heal.sh — 断点续跑修复脚本
#
# 重启后调用，做两件事：
#   1. 将所有 "running" 状态重置为 "pending"（上次中断时留下的脏状态）
#   2. 验证 "completed" 任务的产物文件是否真实存在，缺失则重置为 "pending"
#
# 用法:
#   bash scripts/resume-heal.sh <pipeline-state.json> [blocks.json]
#
# run.sh 在 --resume 模式下自动调用本脚本。

set -euo pipefail

STATE_FILE="${1:?Usage: resume-heal.sh <pipeline-state.json> [blocks.json]}"
BLOCKS_FILE="${2:-blocks.json}"

if [ ! -f "$STATE_FILE" ]; then
  echo "[resume-heal] $STATE_FILE not found, nothing to heal"
  exit 0
fi

echo "[resume-heal] Scanning $STATE_FILE for stale states..."

# ── Step 1: reset running → pending ───────────────────────────────────────────
HEALED=$(node -e "
const fs = require('fs');
const state = JSON.parse(fs.readFileSync(process.argv[1], 'utf-8'));
let n = 0;

// Global tasks: { status, note }
for (const [k, v] of Object.entries(state.global ?? {})) {
  if (v && typeof v === 'object' && v.status === 'running') {
    v.status = 'pending';
    v.note = 'reset by resume-heal';
    n++;
    process.stderr.write('  reset global.' + k + '\n');
  }
}

// Per-block tasks: either { status } or plain string
for (const [bid, tasks] of Object.entries(state.blocks ?? {})) {
  if (!tasks || typeof tasks !== 'object') continue;
  for (const [tk, tv] of Object.entries(tasks)) {
    if (typeof tv === 'object' && tv && tv.status === 'running') {
      tv.status = 'pending';
      tv.note = 'reset by resume-heal';
      n++;
      process.stderr.write('  reset blocks.' + bid + '.' + tk + '\n');
    } else if (tv === 'running') {
      state.blocks[bid][tk] = 'pending';
      n++;
      process.stderr.write('  reset blocks.' + bid + '.' + tk + '\n');
    }
  }
}

fs.writeFileSync(process.argv[1], JSON.stringify(state, null, 2));
process.stdout.write(n + '\n');
" "$STATE_FILE")

echo "[resume-heal] $HEALED stale 'running' tasks reset to 'pending'"

# ── Step 2: verify completed task outputs ─────────────────────────────────────

# Helper: reset a task if its output file is missing
check_file() {
  local FILE="$1"
  local TASK_TYPE="$2"  # "global" or "block"
  local TASK_KEY="$3"
  local BLOCK_ID="${4:-}"

  if [ ! -f "$FILE" ]; then
    echo "[resume-heal] WARN: output missing for $TASK_KEY ($FILE) — resetting to pending"
    node -e "
const fs = require('fs');
const state = JSON.parse(fs.readFileSync(process.argv[1], 'utf-8'));
const type = process.argv[2], key = process.argv[3], bid = process.argv[4];
if (type === 'global' && state.global?.[key]) {
  state.global[key] = { status: 'pending', note: 'output missing on resume' };
} else if (type === 'block' && bid && state.blocks?.[bid]) {
  state.blocks[bid][key] = 'pending';
}
fs.writeFileSync(process.argv[1], JSON.stringify(state, null, 2));
" "$STATE_FILE" "$TASK_TYPE" "$TASK_KEY" "$BLOCK_ID"
  fi
}

# Check master.wav (Stage 4)
check_file "public/audio/master.wav" "global" "T41_master_audio"

# Check render output (Stage 5)
check_file "output/final.mp4" "global" "T51_full_render"

# Check per-block TTS audio files
if [ -f "$BLOCKS_FILE" ]; then
  for ID in $(jq -r '.blocks[].id' "$BLOCKS_FILE" 2>/dev/null); do
    # TTS status: check in blocks[] map (string) or global
    TTS_STATUS=$(node -e "
const s = JSON.parse(require('fs').readFileSync(process.argv[1], 'utf-8'));
const bid = process.argv[2];
// Check blocks map first (stage-2 uses per-block string)
const bmap = s.blocks?.[bid];
if (bmap && typeof bmap === 'object') {
  if (typeof bmap.tts === 'string') { process.stdout.write(bmap.tts); process.exit(0); }
}
// Fallback: global T20 task
const gk = 'T20_tts_' + bid;
process.stdout.write(s.global?.[gk]?.status ?? 'unknown');
" "$STATE_FILE" "$ID" 2>/dev/null || echo "unknown")

    if [ "$TTS_STATUS" = "completed" ] && [ ! -f "public/audio/${ID}.wav" ]; then
      echo "[resume-heal] WARN: $ID audio missing — resetting TTS/subtitle tasks"
      node -e "
const fs = require('fs');
const state = JSON.parse(fs.readFileSync(process.argv[1], 'utf-8'));
const bid = process.argv[2];
// Reset per-block
if (state.blocks?.[bid]) {
  state.blocks[bid].tts      = 'pending';
  state.blocks[bid].vttAlign = 'pending';
  state.blocks[bid].subtitle = 'pending';
}
// Reset global T20/T21/T22
for (const prefix of ['T20_tts_', 'T21_vtt_align_', 'T22_sub_']) {
  const k = prefix + bid;
  if (state.global?.[k]) state.global[k] = { status: 'pending', note: 'audio missing on resume' };
}
// Also reset downstream timing tasks since audio is gone
for (const k of ['T40_timing', 'T41_master_audio', 'T42_compose_video', 'T51_full_render']) {
  if (state.global?.[k]?.status === 'completed') {
    state.global[k] = { status: 'pending', note: 'reset: upstream audio missing' };
  }
}
fs.writeFileSync(process.argv[1], JSON.stringify(state, null, 2));
" "$STATE_FILE" "$ID"
    fi
  done
fi

echo "[resume-heal] Done."
