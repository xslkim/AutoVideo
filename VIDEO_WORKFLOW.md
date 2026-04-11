# AutoVideo v2 工作流参考

> **本文档是 Agent 的执行手册。配合项目目录下的 `CLAUDE.md` 和 `video-agent-config.json` 使用。**
> **所有路径相对于项目目录（`projectDir`）。**
> **版本：2.0（Block-based pipeline）**

---

## 全局概览

```
输入：
  ├── src/data/script.md           （v2 格式口播稿，详见 INPUT_SPEC.md）
  └── src/data/source-samples/     （代码样本）

中间产物（关键）：
  └── blocks.json                  （Stage 1 产出，所有后续 Stage 的唯一数据源）

输出：
  └── output/final_normalized.mp4  （最终视频）

渲染框架：Remotion (React + TypeScript)
```

### Stage 依赖

```
Stage 0: 环境搭建
    │
Stage 1: 脚本编译 (script.md → blocks.json)
    │
    ├──→ Stage 2: 音频合成 (TTS + VTT + 字幕切段)  ← 按 Block 并行
    ├──→ Stage 3: 视觉资产 (组件生成 / 代码读取)    ← 按 Block 并行，与 Stage 2 同时
    │
Stage 4: 时序装配 (计算帧/主音轨/Video.tsx)
    │
Stage 5: Remotion 渲染 (→ MP4)
    │
Stage 6: 后处理 (音频标准化 + 质量校验)
```

---

## STAGE 0：环境搭建

### 0.1 系统依赖检测

```bash
for cmd_pkg in "curl:curl" "jq:jq" "ffmpeg:ffmpeg" "python3:python3" "pip3:python3-pip"; do
  CMD="${cmd_pkg%%:*}"; PKG="${cmd_pkg##*:}"
  command -v "$CMD" &>/dev/null || { sudo apt update && sudo apt install -y "$PKG"; }
done

# Chromium（Remotion 渲染需要）
command -v chromium-browser &>/dev/null || \
  command -v chromium &>/dev/null || \
  sudo apt install -y chromium-browser

# 中文字体
fc-list :lang=zh 2>/dev/null | grep -qi "noto\|wqy" || \
  sudo apt install -y fonts-noto-cjk fonts-noto-cjk-extra && fc-cache -fv
```

### 0.2 Node.js（v20+）

```bash
if ! node -v 2>/dev/null | grep -qE '^v(20|2[2-9]|[3-9][0-9])\.'; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt install -y nodejs
fi
```

### 0.3 Python + edge-tts（TTS 基础依赖）

```bash
VENV_DIR=~/video-agent-venv
[ -f "$VENV_DIR/bin/activate" ] || python3 -m venv "$VENV_DIR"
source "$VENV_DIR/bin/activate"
pip install -q edge-tts

# 可选：Azure TTS（如有 AZURE_SPEECH_KEY）
[ -n "$AZURE_SPEECH_KEY" ] && pip install -q azure-cognitiveservices-speech
```

### 0.4 初始化 Remotion 项目

**先读取 `video-agent-config.json` 获取 `projectDir`。**

```bash
cd "$PROJECT_DIR"
if [ ! -f package.json ]; then
  npx create-video@latest . --template blank-ts --no-git 2>&1
fi

# 安装必要 npm 包
npm install --save \
  remotion @remotion/bundler @remotion/renderer \
  lucide-react \
  shiki

npm install --save-dev \
  @types/node typescript ts-node
```

### 0.5 复制 Remotion 模板文件

从 `agentDir/templates/` 复制引擎核心文件：

```bash
AGENT_DIR=$(jq -r .agentDir video-agent-config.json)

# 创建目录
mkdir -p src/engine src/components/contents src/components/backgrounds
mkdir -p types blocks public/audio output assets/images assets/lottie

# 复制模板（如果目标不存在才复制）
cp -n "$AGENT_DIR/templates/src/engine/theme.ts"       src/engine/
cp -n "$AGENT_DIR/templates/src/engine/rect.ts"        src/engine/
cp -n "$AGENT_DIR/templates/src/engine/animations.ts"  src/engine/
cp -n "$AGENT_DIR/templates/src/engine/block-frame.tsx" src/engine/
cp -n "$AGENT_DIR/templates/src/components/SubtitleOverlay.tsx" src/components/
cp -n "$AGENT_DIR/templates/src/components/ContentRouter.tsx"   src/components/
cp -n "$AGENT_DIR/templates/src/components/contents/"*.tsx      src/components/contents/
cp -n "$AGENT_DIR/templates/src/Video.tsx"             src/
cp -n "$AGENT_DIR/templates/src/Root.tsx"              src/
cp -n "$AGENT_DIR/templates/types/block.ts"            types/
```

更新 `remotion.config.ts`：

```typescript
import { Config } from "@remotion/cli/config";
Config.setEntryPoint("./src/Root.tsx");
Config.setBrowserExecutable(
  process.env.BROWSER_PATH ??
  ("/usr/bin/chromium-browser" /* or chromium/google-chrome */)
);
Config.setConcurrency(2);
```

### 0.6 初始化 pipeline-state.json

**在读取 script.md 之前，必须先创建 pipeline-state.json 的骨架，后续 Stage 1 会在解析完 blocks 后补全任务列表。**

```bash
cat > pipeline-state.json << 'EOF'
{
  "version": "2.0",
  "blocks": {},
  "global": {
    "T00_sudo_check":   { "status": "completed" },
    "T01_apt_install":  { "status": "completed" },
    "T02_nodejs":       { "status": "completed" },
    "T03_python":       { "status": "completed" },
    "T04_remotion":     { "status": "completed" },
    "T05_copy_sources": { "status": "completed" },
    "T06_env_verify":   { "status": "pending" },
    "T10_compile_script": { "status": "pending" },
    "T40_timing":       { "status": "pending" },
    "T41_compose_root": { "status": "pending" },
    "T42_compile_check":{ "status": "pending" },
    "T50_preview_frames":{ "status": "pending" },
    "T51_full_render":  { "status": "pending" },
    "T60_normalize":    { "status": "pending" },
    "T61_quality_check":{ "status": "pending" }
  }
}
EOF
```

更新方式仍然是 `bash scripts/update-task.sh pipeline-state.json <task-id> <status> [note]`。

---

## STAGE 1：脚本编译（script.md → blocks.json）

**这是 v2 最重要的 Stage。** `blocks.json` 是后续一切的数据源。

### 1.1 运行编译器

```bash
source ~/video-agent-venv/bin/activate
ASPECT=$(jq -r .aspect video-agent-config.json)

node "$AGENT_DIR/scripts/compile-script.mjs" \
  src/data/script.md \
  blocks.json \
  "$ASPECT"
```

编译器输出示例：
```
[compile-script] OK: 13 blocks → blocks.json
  Title: 200 行纯 Python 手撕 GPT
  Blocks:
    B00  🎙  [textcard]   标题卡
    B01  🎙  [animation]  文件结构鸟瞰
    B02  🎙  [code]       Value 类字段
    ...
    B12  🔇  [textcard]   片尾
```

🔇 表示无口播（`status.tts = 'skipped'`），该块需要 `@duration` 指定时长。

### 1.2 校验 blocks.json

```bash
# 快速校验：每个 block 都有 id、title、visual.content.type
node -e "
  const b = JSON.parse(require('fs').readFileSync('blocks.json','utf-8'));
  const errors = [];
  for (const blk of b.blocks) {
    if (!blk.id) errors.push('Missing id');
    if (!blk.visual?.content?.type) errors.push(blk.id + ': Missing content type');
  }
  if (errors.length) { console.error(errors); process.exit(1); }
  console.log('blocks.json OK:', b.blocks.length, 'blocks');
"
```

### 1.3 在 pipeline-state.json 中为每个 block 添加任务

读取 blocks.json 的 block 列表，动态写入 per-block 状态：

```bash
node -e "
  const fs = require('fs');
  const blocks = JSON.parse(fs.readFileSync('blocks.json','utf-8')).blocks;
  const state = JSON.parse(fs.readFileSync('pipeline-state.json','utf-8'));
  for (const b of blocks) {
    const skipTts = b.status.tts === 'skipped';
    state.blocks[b.id] = {
      tts:      skipTts ? 'skipped' : 'pending',
      vttAlign: skipTts ? 'skipped' : 'pending',
      subtitle: 'pending',
      component: b.visual.content.type === 'animation' ? 'pending' : 'auto',
    };
  }
  fs.writeFileSync('pipeline-state.json', JSON.stringify(state, null, 2));
  console.log('pipeline-state.json updated with', blocks.length, 'blocks');
"
bash scripts/update-task.sh pipeline-state.json T10_compile_script completed \
  "$(jq '.blocks | length' blocks.json) blocks"
```

---

## STAGE 2：音频合成（并行）

**Stage 2 和 Stage 3 必须并行。** 每个 block 的三个子任务顺序依赖：
`T20_tts_B{xx}` → `T21_vtt_B{xx}` → `T22_sub_B{xx}`

### 2.1 TTS 合成（每块独立）

```bash
source ~/video-agent-venv/bin/activate
AGENT_DIR=$(jq -r .agentDir video-agent-config.json)
VOICE=$(jq -r .voice video-agent-config.json)

synth_block() {
  local ID="$1"
  bash scripts/update-task.sh pipeline-state.json "T20_tts_${ID}" running

  python3 "$AGENT_DIR/scripts/tts/router.py" \
    blocks.json "$ID" public/audio \
    --config video-agent-config.json

  if [ $? -eq 0 ]; then
    DUR=$(jq -r ".duration_s" "public/audio/${ID}.meta.json" 2>/dev/null || echo "?")
    bash scripts/update-task.sh pipeline-state.json "T20_tts_${ID}" completed "${DUR}s"
  else
    bash scripts/update-task.sh pipeline-state.json "T20_tts_${ID}" error "router.py failed"
  fi
}
export -f synth_block

# 并行跑所有需要 TTS 的 block
jq -r '.blocks[] | select(.status.tts != "skipped") | .id' blocks.json | \
  xargs -P 4 -I{} bash -c 'synth_block "$@"' _ {}

wait
```

### 2.2 字幕切段（每块独立，依赖 T20）

```bash
split_subtitle() {
  local ID="$1"
  bash scripts/update-task.sh pipeline-state.json "T22_sub_${ID}" running

  node "$AGENT_DIR/scripts/measure-subtitle.mjs" \
    blocks.json "$ID" \
    "public/audio/${ID}.vtt" \
    "public/audio/${ID}.subtitles.json"

  if [ $? -eq 0 ]; then
    COUNT=$(jq 'length' "public/audio/${ID}.subtitles.json" 2>/dev/null || echo "0")
    bash scripts/update-task.sh pipeline-state.json "T22_sub_${ID}" completed "${COUNT} lines"
  else
    bash scripts/update-task.sh pipeline-state.json "T22_sub_${ID}" error
  fi
}

# 等 TTS 全部完成后串行跑（或可并行）
jq -r '.blocks[].id' blocks.json | while read ID; do
  TTS_STATUS=$(jq -r ".blocks[\"$ID\"].tts" pipeline-state.json)
  [ "$TTS_STATUS" = "completed" ] || [ "$TTS_STATUS" = "skipped" ] && split_subtitle "$ID"
done
```

### 2.3 把字幕写回 blocks.json

```bash
node -e "
  const fs = require('fs');
  const blocks = JSON.parse(fs.readFileSync('blocks.json', 'utf-8'));

  for (const b of blocks.blocks) {
    const subPath = 'public/audio/' + b.id + '.subtitles.json';
    if (fs.existsSync(subPath)) {
      b.subtitles = JSON.parse(fs.readFileSync(subPath, 'utf-8'));
    }

    const metaPath = 'public/audio/' + b.id + '.meta.json';
    if (fs.existsSync(metaPath)) {
      const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
      b.timing.ttsDuration = meta.duration_s;
      b.timing.audioPath   = 'public/audio/' + b.id + '.wav';
      b.timing.vttPath     = 'public/audio/' + b.id + '.vtt';
      b.timing.provider    = meta.provider_used;
    }
  }

  fs.writeFileSync('blocks.json', JSON.stringify(blocks, null, 2));
  console.log('blocks.json updated with timing + subtitles');
"
```

---

## STAGE 3：视觉资产（并行，与 Stage 2 同时）

**Stage 3 只处理 `animation` 类型的 block。** 其他类型（image/code/icon/textcard）由框架的静态组件渲染，无需 AI 生成代码。

### 3.1 读取全局主题（一次性）

主题来自 `src/engine/theme.ts`，无需修改。

### 3.2 为 animation 类型生成 React 组件

对每个 `visual.content.type === 'animation'` 的 block，生成 `src/blocks/{id}/Component.tsx`：

```bash
bash scripts/update-task.sh pipeline-state.json "T31_component_${ID}" running

# 创建目录
mkdir -p "src/blocks/${ID}"
```

**组件生成 Prompt（内嵌在 Agent 执行流程里）：**

```
基于以下信息，生成一个 Remotion React 动画组件：

Block ID: {id}
Block Title: {title}
Description:
{spec.description}

Timeline hints:
{spec.timeline as JSON}

必须满足的接口：
interface AnimationProps {
  frame: number;               // 当前块内帧（0 起）
  durationInFrames: number;    // 本块总帧数
  rect: { x: number; y: number; w: number; h: number };  // 归一化，只作参考，组件本身用 width/height:100%
  theme: Theme;                // 从 import { getTheme } from '../../engine/theme'
  fps: number;
}

要求：
1. 默认导出：export default function Component(props: AnimationProps): JSX.Element
2. 组件根元素：<div style={{ width:'100%', height:'100%', ... }}>
3. 使用 Remotion 的 useCurrentFrame()、interpolate()、spring() 做动画
4. 从 theme 取颜色（theme.accent、theme.bg 等）
5. 优先 CSS/SVG，不依赖外部图片
6. 文字用 theme.fonts.body 或 theme.fonts.mono
7. 如无法实现，降级为 TextCardContent 显示 description 文字

保存到：src/blocks/{id}/Component.tsx
```

### 3.3 为 code 类型预处理源码

```bash
preprocess_code() {
  local ID="$1"
  local SPEC=$(jq -r ".blocks[] | select(.id == \"$ID\") | .visual.content.spec" blocks.json)
  local SOURCE=$(echo "$SPEC" | jq -r '.source // empty')
  local RANGE_START=$(echo "$SPEC" | jq -r '.range[0] // 1')
  local RANGE_END=$(echo "$SPEC" | jq -r '.range[1] // 9999')

  SRC_FILE="src/data/source-samples/$SOURCE"
  if [ -z "$SOURCE" ] || [ ! -f "$SRC_FILE" ]; then return; fi

  # Extract lines and embed into blocks.json as __lines
  node -e "
    const fs = require('fs');
    const lines = fs.readFileSync('$SRC_FILE', 'utf-8').split('\n');
    const start = $RANGE_START - 1;
    const end   = Math.min($RANGE_END, lines.length);
    const sliced = lines.slice(start, end);

    const blocks = JSON.parse(fs.readFileSync('blocks.json', 'utf-8'));
    const blk = blocks.blocks.find(b => b.id === '$ID');
    if (blk && blk.visual.content.type === 'code') {
      blk.visual.content.spec.__lines = sliced;
      blk.artifacts.assetFiles = ['$SRC_FILE'];
    }
    fs.writeFileSync('blocks.json', JSON.stringify(blocks, null, 2));
    console.log('Code preprocessed for $ID:', sliced.length, 'lines');
  "
}
export -f preprocess_code

jq -r '.blocks[] | select(.visual.content.type == "code") | .id' blocks.json | \
  xargs -I{} bash -c 'preprocess_code "$@"' _ {}
```

---

## STAGE 4：时序装配

**等待 Stage 2（TTS）和 Stage 3（组件生成）都完成后执行。**

### 4.1 计算每个 block 的 startFrame 和 frames

```javascript
// 在 Node.js 中执行
const blocks = JSON.parse(fs.readFileSync('blocks.json', 'utf-8'));
const { fps } = blocks.meta;

const ENTER_DEF = 0.5;  // default enter duration seconds
const EXIT_DEF  = 0.3;  // default exit duration seconds
const MIN_HOLD  = 1.5;  // minimum hold for any block

let cursor = 0;  // current frame

for (const b of blocks.blocks) {
  const enterDur  = b.visual.enter.duration ?? ENTER_DEF;
  const exitDur   = b.visual.exit.duration  ?? EXIT_DEF;
  const ttsDur    = b.timing.ttsDuration ?? 0;
  const pauseAfter = b.narration.hints?.pauseAfter ?? 0;
  const explicitHold = b.timing.holdDuration; // set if @duration was specified

  const holdDur = explicitHold ?? Math.max(ttsDur + pauseAfter, MIN_HOLD);
  const totalDur = enterDur + holdDur + exitDur;

  b.timing.enterDuration  = enterDur;
  b.timing.holdDuration   = holdDur;
  b.timing.exitDuration   = exitDur;
  b.timing.totalDuration  = totalDur;
  b.timing.startFrame     = cursor;
  b.timing.frames         = Math.round(totalDur * fps);

  cursor += b.timing.frames;
}

fs.writeFileSync('blocks.json', JSON.stringify(blocks, null, 2));
console.log('Total duration:', (cursor / fps).toFixed(1), 's');
```

### 4.2 拼接主音轨

```bash
# 生成 FFmpeg concat 列表
node -e "
  const fs = require('fs');
  const blocks = JSON.parse(fs.readFileSync('blocks.json', 'utf-8'));
  const lines = ['ffconcat version 1.0'];

  for (const b of blocks.blocks) {
    if (b.timing.audioPath && fs.existsSync(b.timing.audioPath)) {
      const hold = b.timing.holdDuration ?? 3;
      // If audio is shorter than hold, pad with silence
      const dur  = b.timing.ttsDuration ?? 0;
      lines.push('file ' + b.timing.audioPath);
      if (hold - dur > 0.1) {
        // We'll handle padding with ffmpeg filter
      }
    } else {
      // No audio: generate silence
      const dur = b.timing.holdDuration ?? 3;
      const silFile = 'public/audio/' + b.id + '_silence.wav';
      lines.push('file ' + silFile);
    }
  }

  // Simpler approach: use sox or ffmpeg concat with durations
  fs.writeFileSync('public/audio/concat.txt', lines.join('\n'));
"

# Better: build master track with proper timing using ffmpeg
node -e "
  const fs = require('fs');
  const { execSync } = require('child_process');
  const blocks = JSON.parse(fs.readFileSync('blocks.json', 'utf-8'));
  const { fps } = blocks.meta;

  // Build a silent base track of total duration
  const totalFrames = Math.max(...blocks.blocks.map(b => (b.timing.startFrame ?? 0) + (b.timing.frames ?? 0)));
  const totalSecs   = totalFrames / fps;

  // Create silence base
  execSync(\`ffmpeg -y -f lavfi -i anullsrc=r=24000:cl=mono -t \${totalSecs} -acodec pcm_s16le public/audio/master_silence.wav\`);

  // Build amix/adelay filter chain
  const filterParts = ['[0:a]'];
  const inputs = ['-i public/audio/master_silence.wav'];
  const delays = [];

  let audioIdx = 1;
  for (const b of blocks.blocks) {
    const wavPath = b.timing.audioPath;
    if (!wavPath || !fs.existsSync(wavPath)) continue;
    const delayMs = Math.round(((b.timing.startFrame ?? 0) + (b.timing.enterDuration ?? 0) * fps) / fps * 1000);
    inputs.push('-i ' + wavPath);
    delays.push(\`[1:a]adelay=\${delayMs}|0[a\${audioIdx}]\`);
    filterParts.push(\`[a\${audioIdx}]\`);
    audioIdx++;
  }

  if (audioIdx === 1) {
    // No audio files at all
    fs.copyFileSync('public/audio/master_silence.wav', 'public/audio/master.wav');
  } else {
    const filterStr = delays.join(';') + ';' + filterParts.join('') + 'amix=inputs=' + audioIdx + ':normalize=0[out]';
    const cmd = 'ffmpeg -y ' + inputs.join(' ') + ' -filter_complex \"' + filterStr + '\" -map [out] -acodec pcm_s16le public/audio/master.wav';
    execSync(cmd);
  }
  console.log('master.wav created:', totalSecs.toFixed(1) + 's');
" 2>&1

bash scripts/update-task.sh pipeline-state.json T40_timing completed
```

### 4.3 编译检查

```bash
npx tsc --noEmit 2>&1 | head -50
if [ ${PIPESTATUS[0]} -ne 0 ]; then
  echo "TypeScript compile error — fix before rendering"
  bash scripts/update-task.sh pipeline-state.json T42_compile_check error "TypeScript error"
  exit 1
fi

TOTAL_FRAMES=$(jq '[.blocks[] | (.timing.startFrame // 0) + (.timing.frames // 0)] | max' blocks.json)
TOTAL_SECS=$(node -e "console.log(($TOTAL_FRAMES/$(jq .meta.fps blocks.json)).toFixed(1))")
bash scripts/update-task.sh pipeline-state.json T42_compile_check completed "${TOTAL_FRAMES} frames ${TOTAL_SECS}s"
```

---

## STAGE 5：渲染

### 5.1 预览帧验证（快速）

```bash
bash scripts/update-task.sh pipeline-state.json T50_preview_frames running

W=$(jq -r .meta.resolution.w blocks.json)
H=$(jq -r .meta.resolution.h blocks.json)
TOTAL=$(jq '[.blocks[] | (.timing.startFrame // 0) + (.timing.frames // 0)] | max' blocks.json)

# 渲染 5 个抽样帧
for FRAC in 0.1 0.3 0.5 0.7 0.9; do
  FRAME=$(node -e "console.log(Math.floor($TOTAL * $FRAC))")
  npx remotion still \
    --config remotion.config.ts \
    --frame "$FRAME" \
    --output "output/preview_${FRAME}.png" \
    src/Root.tsx Video \
    2>&1 || true
done

bash scripts/update-task.sh pipeline-state.json T50_preview_frames completed
```

### 5.2 完整渲染

```bash
bash scripts/update-task.sh pipeline-state.json T51_full_render running

W=$(jq -r .meta.resolution.w blocks.json)
H=$(jq -r .meta.resolution.h blocks.json)

npx remotion render \
  --config remotion.config.ts \
  --codec h264 \
  --output output/final.mp4 \
  --log error \
  src/Root.tsx Video \
  2>&1 | tail -20

if [ -f output/final.mp4 ]; then
  SIZE=$(du -sh output/final.mp4 | cut -f1)
  bash scripts/update-task.sh pipeline-state.json T51_full_render completed "$SIZE"
else
  bash scripts/update-task.sh pipeline-state.json T51_full_render error "MP4 not created"
  exit 1
fi
```

---

## STAGE 6：后处理 + 校验

### 6.1 音频标准化（响度平衡）

```bash
bash scripts/update-task.sh pipeline-state.json T60_normalize running

ffmpeg -y -i output/final.mp4 \
  -af "loudnorm=I=-16:TP=-1.5:LRA=11" \
  -c:v copy \
  output/final_normalized.mp4 \
  2>&1 | tail -5

bash scripts/update-task.sh pipeline-state.json T60_normalize completed
```

### 6.2 质量校验

```bash
bash scripts/update-task.sh pipeline-state.json T61_quality_check running

W=$(jq -r .meta.resolution.w blocks.json)
H=$(jq -r .meta.resolution.h blocks.json)

ERRORS=0

# 1. 文件存在且大于 100KB
SIZE_BYTES=$(stat -c%s output/final_normalized.mp4 2>/dev/null || echo 0)
[ "$SIZE_BYTES" -gt 102400 ] || { echo "ERROR: output too small"; ERRORS=$((ERRORS+1)); }

# 2. 分辨率正确
RES=$(ffprobe -v quiet -select_streams v:0 \
  -show_entries stream=width,height -of csv=p=0 output/final_normalized.mp4)
echo "$RES" | grep -q "^${W},${H}$" || { echo "ERROR: resolution mismatch: $RES"; ERRORS=$((ERRORS+1)); }

# 3. 时长与预期接近（±20%）
EXPECTED_SECS=$(jq '([.blocks[] | (.timing.startFrame // 0) + (.timing.frames // 0)] | max) / .meta.fps' blocks.json)
ACTUAL_SECS=$(ffprobe -v quiet -show_entries format=duration \
  -of default=noprint_wrappers=1:nokey=1 output/final_normalized.mp4)
node -e "
  const expected = $EXPECTED_SECS;
  const actual   = $ACTUAL_SECS;
  const ratio    = actual / expected;
  if (ratio < 0.8 || ratio > 1.2) {
    console.error('ERROR: duration mismatch: expected', expected.toFixed(1), 's, got', actual.toFixed(1), 's');
    process.exit(1);
  }
  console.log('Duration OK:', actual.toFixed(1) + 's');
" || ERRORS=$((ERRORS+1))

# 4. 抽查 5 帧，确认非纯黑
TOTAL=$(jq '[.blocks[] | (.timing.startFrame // 0) + (.timing.frames // 0)] | max' blocks.json)
FPS=$(jq -r .meta.fps blocks.json)
for FRAC in 0.1 0.3 0.5 0.7 0.9; do
  T=$(node -e "console.log(($TOTAL * $FRAC / $FPS).toFixed(2))")
  ffmpeg -y -ss "$T" -i output/final_normalized.mp4 -frames:v 1 /tmp/check_frame.png 2>/dev/null
  BRIGHT=$(ffprobe -f lavfi -i "movie=/tmp/check_frame.png,signalstats" \
    -show_entries frame_tags=lavfi.signalstats.YAVG -of default=noprint_wrappers=1:nokey=1 2>/dev/null || echo 5)
  node -e "if ($BRIGHT < 2) { console.error('ERROR: black frame at t=$T'); process.exit(1); }" || \
    ERRORS=$((ERRORS+1))
done

if [ "$ERRORS" -eq 0 ]; then
  bash scripts/update-task.sh pipeline-state.json T61_quality_check completed "all checks passed"
  echo "✅ 视频生成完成: output/final_normalized.mp4"
  ls -lh output/final_normalized.mp4
else
  bash scripts/update-task.sh pipeline-state.json T61_quality_check error "$ERRORS check(s) failed"
fi
```

---

## 状态管理速查

```bash
# 更新单个 task 状态
bash scripts/update-task.sh pipeline-state.json <task-id> <status> [note]
# status: pending | running | completed | error | skipped

# 查看所有非 pending 任务
jq '.global | to_entries | map(select(.value.status != "pending")) | from_entries' pipeline-state.json

# 查看 block 状态摘要
jq '.blocks | to_entries | map({id:.key, tts:.value.tts, component:.value.component})' pipeline-state.json

# 进度条
bash scripts/progress.sh pipeline-state.json
```

## Task ID 命名规范

```
T{stage}{seq}_{kind}[_{BlockId}]

全局任务（无 BlockId）:
  T00_sudo_check, T01_apt_install, T02_nodejs, T03_python,
  T04_remotion, T05_copy_sources, T06_env_verify
  T10_compile_script
  T30_theme, T30_code_highlight
  T40_timing, T41_compose_root, T42_compile_check
  T50_preview_frames, T51_full_render
  T60_normalize, T61_quality_check

Per-block 任务（BlockId = B00 ... B99）:
  T20_tts_B03        Stage 2 TTS 合成
  T21_vtt_B03        Stage 2 VTT 对齐（当 TTS 无词级时间戳时）
  T22_sub_B03        Stage 2 字幕切段
  T31_component_B03  Stage 3 animation 组件生成
```

## 错误处理原则

| 场景 | 处理 |
|------|------|
| TTS 失败（单块） | 最多重试 3 次，间隔 5s；失败后降级到 edge-tts |
| 组件生成失败 | 最多重试 2 次；失败后降级到 TextCardContent |
| Stage 0 环境不可用 | **停止整个流水线** |
| TypeScript 编译失败 | **停止整个流水线，必须修复** |
| 非致命错误 | 标记 error，继续其他 block |

---

## 常见调试命令

```bash
# 检查某个 block 的字幕
jq '.blocks[] | select(.id == "B03") | .subtitles' blocks.json

# 检查某个 block 的时序
jq '.blocks[] | select(.id == "B03") | .timing' blocks.json

# 手动运行单块 TTS
source ~/video-agent-venv/bin/activate
python3 "$AGENT_DIR/scripts/tts/router.py" blocks.json B03 public/audio

# 手动运行字幕切段
node "$AGENT_DIR/scripts/measure-subtitle.mjs" blocks.json B03 public/audio/B03.vtt /tmp/B03_subs.json

# 编译检查（不渲染）
npx tsc --noEmit 2>&1 | head -50
```
