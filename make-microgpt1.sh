#!/usr/bin/env bash
set -euo pipefail

bash /home/ubuntu/AutoVideo/run.sh \
  --script  "/home/ubuntu/AutoVideo/script-microgpt-part1-1.md" \
  --title   "MicroGPT Part1" \
  --out-dir "/home/ubuntu/video/microgpt1" \
  --model   sonnet \
  --voice   "zh-CN-YunxiNeural"
