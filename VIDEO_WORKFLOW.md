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
Stage 4: 时序装配 (计算每块帧数 + TypeScript 编译检查)
    │
Stage 5: Remotion 逐块渲染 (每块独立 MP4) + ffmpeg concat → output/final.mp4
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
```

### 0.4 启动 CosyVoice 服务（本地 GPU TTS）

CosyVoice 是备选 TTS 引擎（中英混读质量较好）。必须在 TTS 任务开始前启动。

```bash
COSYVOICE_DIR=$(jq -r '.cosyvoiceDir // ""' video-agent-config.json)
COSYVOICE_LOG="/tmp/cosyvoice-server.log"
COSYVOICE_PORT=50000

# 如果未配置 cosyvoiceDir，跳过（TTS 降级到 edge-tts）
if [[ -z "$COSYVOICE_DIR" ]] || [[ ! -d "$COSYVOICE_DIR" ]]; then
  echo "[CosyVoice] cosyvoiceDir 未配置或目录不存在，跳过启动（TTS 将使用 edge-tts）"
# 检查服务是否已在运行
elif curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:${COSYVOICE_PORT}/inference_sft" \
    2>/dev/null | grep -qE "200|422"; then
  echo "[CosyVoice] 服务已在运行"
else
  echo "[CosyVoice] 启动服务: $COSYVOICE_DIR"
  cd "$COSYVOICE_DIR"
  source .venv/bin/activate
  nohup python runtime/python/fastapi/server.py \
    --port "$COSYVOICE_PORT" \
    --model_dir pretrained_models/CosyVoice2-0.5B \
    > "$COSYVOICE_LOG" 2>&1 &
  COSYVOICE_PID=$!
  echo "[CosyVoice] PID=$COSYVOICE_PID，等待模型加载..."

  # 等待最多 60 秒
  for i in $(seq 1 30); do
    sleep 2
    if curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:${COSYVOICE_PORT}/inference_sft" \
        2>/dev/null | grep -qE "200|422"; then
      echo "[CosyVoice] 服务就绪（${i}*2s）"
      break
    fi
    if [ $i -eq 30 ]; then
      echo "[CosyVoice] 启动超时，TTS 将降级到 edge-tts（不影响流程）"
    fi
  done
  cd -
  deactivate 2>/dev/null || true
fi
```

### 0.4b 启动 VoxCPM 服务（高质量多语言 TTS，最高优先级）

VoxCPM2 是主力 TTS 引擎（支持 30 种语言，音质最佳，支持声音设计和声音克隆）。需要在 TTS 任务开始前启动。

```bash
VOXCPM_DIR=$(jq -r '.voxcpmDir // ""' video-agent-config.json)
VOXCPM_ENDPOINT=$(jq -r '.tts.voxcpm.endpoint // "http://127.0.0.1:50001"' video-agent-config.json)
VOXCPM_PORT=$(echo "$VOXCPM_ENDPOINT" | sed 's|.*:||')
VOXCPM_LOG="/tmp/voxcpm-server.log"

# 确定模型路径：优先用本地缓存，其次 voxcpmDir，最后用 HuggingFace 自动下载
VOXCPM_MODEL="$HOME/.cache/voxcpm/VoxCPM2"
if [[ ! -d "$VOXCPM_MODEL" ]] && [[ -n "$VOXCPM_DIR" ]]; then
  VOXCPM_MODEL="$VOXCPM_DIR"
fi
if [[ ! -d "$VOXCPM_MODEL" ]]; then
  VOXCPM_MODEL="openbmb/VoxCPM2"  # HuggingFace 自动下载
fi

# 检查服务是否已在运行
if curl -s -o /dev/null -w "%{http_code}" "${VOXCPM_ENDPOINT}/health" \
    2>/dev/null | grep -q "200"; then
  echo "[VoxCPM] 服务已在运行"
else
  # 安装 voxcpm（如果未安装）
  source ~/video-agent-venv/bin/activate
  pip install -q voxcpm fastapi uvicorn 2>/dev/null || true

  echo "[VoxCPM] 启动服务 (port=$VOXCPM_PORT, model=$VOXCPM_MODEL)..."
  nohup python scripts/tts/voxcpm_server.py \
    --port "$VOXCPM_PORT" \
    --model "$VOXCPM_MODEL" \
    > "$VOXCPM_LOG" 2>&1 &
  VOXCPM_PID=$!
  echo "[VoxCPM] PID=$VOXCPM_PID，等待模型加载..."

  # 等待最多 120 秒（首次下载模型可能较慢）
  for i in $(seq 1 60); do
    sleep 2
    if curl -s -o /dev/null -w "%{http_code}" "${VOXCPM_ENDPOINT}/health" \
        2>/dev/null | grep -q "200"; then
      echo "[VoxCPM] 服务就绪（${i}*2s）"
      break
    fi
    if [ $i -eq 60 ]; then
      echo "[VoxCPM] 启动超时，TTS 将降级到 CosyVoice 或 edge-tts（不影响流程）"
    fi
  done
fi
```

**VoxCPM 声音配置**（在 `video-agent-config.json` 的 `tts.voxcpm` 中）：

| 字段 | 说明 | 示例 |
|------|------|------|
| `voiceDesign` | 声音设计描述（自然语言） | `"年轻男声，温和专业"` |
| `referenceWav` | 参考音频路径（声音克隆） | `"assets/voice-prompts/voxcpm-ref.wav"` |
| `promptText` | 参考音频的文字稿（高保真克隆） | `"这是参考音频的内容"` |

- 仅填 `voiceDesign` → 声音设计模式（不需要参考音频）
- 仅填 `referenceWav` → 声音克隆模式
- 同时填 `referenceWav` + `promptText` → 高保真克隆模式
- 都不填 → 使用默认音色

### 0.5 初始化 Remotion 项目

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

### 0.6 复制 Remotion 模板文件

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

### 0.7 初始化 pipeline-state.json

**在读取 script.md 之前，必须先创建 pipeline-state.json 的骨架，后续 Stage 1 会在解析完 blocks 后补全任务列表。**

```bash
cat > pipeline-state.json << 'EOF'
{
  "version": "2.0",
  "blocks": {},
  "global": {
    "T00_sudo_check":        { "status": "completed" },
    "T01_apt_install":       { "status": "completed" },
    "T02_nodejs":            { "status": "completed" },
    "T03_python":            { "status": "completed" },
    "T04_cosyvoice_server":  { "status": "completed" },
    "T05_remotion_init":     { "status": "completed" },
    "T06_copy_templates":    { "status": "completed" },
    "T07_env_verify":        { "status": "pending" },
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
AGENT_DIR=$(jq -r .agentDir video-agent-config.json)

node "$AGENT_DIR/scripts/compile-script.mjs" \
  src/data/script.md \
  blocks.json \
  --title  "$(jq -r .title  video-agent-config.json)" \
  --aspect "$(jq -r .aspect video-agent-config.json)" \
  --theme  "$(jq -r .theme  video-agent-config.json)" \
  --voice  "$(jq -r .voice  video-agent-config.json)" \
  --fps    "$(jq -r .fps    video-agent-config.json)"
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

### 2.1 TTS 合成（每块独立，自动走全局缓存）

`router.py` 在合成前自动查询 `~/.autovideo-cache/`：
- **命中** → 直接复制缓存文件，跳过模型调用，日志打印 `cache hit (xxxxxxxx…)`
- **未命中** → 正常合成，成功后自动写入缓存

缓存 key = MD5(narration文本归一化 + voice名称 + TTS provider)，任一项变化即失效。

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

### 3.2 检查并应用复用计划（reuse-plan.json）

**优先复用上一个项目的动画组件，避免重复生成。**

如果 `reuse-plan.json` 存在（由 `run.sh --reuse-from` 生成），先处理复用：

```bash
if [[ -f reuse-plan.json ]]; then
  # 对每个匹配到的 block，直接复制组件文件
  node -e "
    const plan = JSON.parse(require('fs').readFileSync('reuse-plan.json','utf8'));
    const fs = require('fs');
    const path = require('path');
    for (const [newId, m] of Object.entries(plan.components)) {
      const destDir = path.dirname(m.destPath);
      fs.mkdirSync(destDir, { recursive: true });
      fs.copyFileSync(m.sourcePath, m.destPath);
      console.log('Reused:', newId, '<-', m.sourceBlock, '(conf='+m.confidence.toFixed(2)+')');
    }
    // 复制图片
    for (const [filename, im] of Object.entries(plan.images || {})) {
      const destDir = path.dirname(im.destPath);
      fs.mkdirSync(destDir, { recursive: true });
      fs.copyFileSync(im.sourcePath, im.destPath);
      console.log('Reused image:', filename);
    }
  "
  # 对每个复用的 block，标记 T31 为 completed
  for BLOCK_ID in $(node -e "const p=JSON.parse(require('fs').readFileSync('reuse-plan.json','utf8')); console.log(Object.keys(p.components).join(' '))"); do
    bash scripts/update-task.sh pipeline-state.json "T31_component_${BLOCK_ID}" completed "reused from prev project"
  done
fi
```

如果还未有 `reuse-plan.json` 但 `video-agent-config.json` 里有 `reuseFrom` 字段，手动生成：

```bash
REUSE_FROM=$(jq -r '.reuseFrom // empty' video-agent-config.json)
AGENT_DIR=$(jq -r '.agentDir' video-agent-config.json)
if [[ -n "$REUSE_FROM" && -d "$REUSE_FROM" ]]; then
  node "$AGENT_DIR/scripts/scan-reusable-assets.mjs" \
    --prev-project "$REUSE_FROM" \
    --new-blocks   blocks.json \
    --out          reuse-plan.json
fi
```

### 3.3 为 animation 类型生成 React 组件

对每个 `visual.content.type === 'animation'` 的 block（**跳过已在 3.2 复用的**），
**先查全局缓存**，命中则直接复制，跳过模型调用：

```bash
AGENT_DIR=$(jq -r .agentDir video-agent-config.json)

# 将当前 block 导出为临时 JSON 文件供 cache.mjs 使用
node -e "
  const b = require('./blocks.json').blocks.find(b => b.id === process.argv[1]);
  require('fs').writeFileSync('/tmp/block-\${ID}.json', JSON.stringify(b));
" "$ID"

# 计算 hash（包含 spec 全部字段；code 块还包含实际源码行内容）
HASH=$(node "$AGENT_DIR/scripts/cache.mjs" hash \
  --type component \
  --block-json "/tmp/block-${ID}.json" \
  --source-dir src/data/source-samples)

# 查缓存
CACHE_RESULT=$(node "$AGENT_DIR/scripts/cache.mjs" lookup --hash "$HASH" --type component 2>/dev/null)
CACHE_HIT=$(echo "$CACHE_RESULT" | node -e "process.stdin.resume();let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>console.log(JSON.parse(d).hit||false))" 2>/dev/null)

if [[ "$CACHE_HIT" == "true" ]]; then
  CACHED_FILE=$(echo "$CACHE_RESULT" | python3 -c "import sys,json; print(json.load(sys.stdin)['file'])")
  mkdir -p "src/blocks/${ID}"
  cp "$CACHED_FILE" "src/blocks/${ID}/Component.tsx"
  echo "[Stage3] ${ID}: cache hit (${HASH:0:8}…) — skipping generation"
  bash scripts/update-task.sh pipeline-state.json "T31_component_${ID}" completed "cache-hit:${HASH:0:8}"
else
  # Cache miss — generate with AI (see prompt below), then store
  bash scripts/update-task.sh pipeline-state.json "T31_component_${ID}" running
  mkdir -p "src/blocks/${ID}"
  # ... AI generation writes to src/blocks/${ID}/Component.tsx ...
  # After generation:
  node "$AGENT_DIR/scripts/cache.mjs" store \
    --hash    "$HASH" \
    --type    component \
    --file    "src/blocks/${ID}/Component.tsx" \
    --title   "$(jq -r ".blocks[] | select(.id==\"${ID}\") | .title" blocks.json)" \
    --project "$(pwd)"
  bash scripts/update-task.sh pipeline-state.json "T31_component_${ID}" completed
fi
```

缓存 key = MD5(block.title + block.spec全字段)，对 code 块还包含实际源码行内容。
`narration`、`timing`、`subtitles` 不影响视觉，不参与 hash。

**组件生成 Prompt（cache miss 时，内嵌在 Agent 执行流程里）：**

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

### 3.4 为 code 类型预处理源码（shiki 语法高亮，带缓存）

`preprocess-code.mjs` 内部对每个 code block 先查全局 shiki 缓存（key = 实际源码行内容 + lang + highlights + code-theme），命中直接读取，未命中才调用 shiki 并写入缓存。

```bash
AGENT_DIR=$(jq -r .agentDir video-agent-config.json)
node "$AGENT_DIR/scripts/preprocess-code.mjs" \
  blocks.json \
  src/data/source-samples/ \
  --cache-dir ~/.autovideo-cache
```

输出示例：
```
[preprocess-code] Processing 3 code block(s)...
[preprocess-code] B02: microgpt.py [29-72] → 44 lines (lang: python)
[preprocess-code] B05: microgpt.py [74-90] → 17 lines (lang: python)
[preprocess-code] B09: microgpt.py [146-184] → 39 lines (lang: python)
[preprocess-code] Done. Modified 3 block(s) in blocks.json
```

---

## STAGE 4：时序装配

**等待 Stage 2（TTS）和 Stage 3（组件生成）都完成后执行。**

每个 block 是独立的 Remotion composition，`startFrame` 固定为 0，只需计算该块自身的帧数。

### 4.1 计算每个 block 的帧数

```javascript
// 在 Node.js 中执行
const fs = require('fs');
const blocks = JSON.parse(fs.readFileSync('blocks.json', 'utf-8'));
const { fps } = blocks.meta;

const ENTER_DEF = 0.5;
const EXIT_DEF  = 0.3;
const MIN_HOLD  = 1.5;

for (const b of blocks.blocks) {
  const enterDur   = b.visual.enter.duration ?? ENTER_DEF;
  const exitDur    = b.visual.exit.duration  ?? EXIT_DEF;
  const ttsDur     = b.timing.ttsDuration ?? 0;
  const pauseAfter = b.narration.hints?.pauseAfter ?? 0;
  const explicitMin = b.timing.holdDuration ?? 0;

  const holdDur  = Math.max(explicitMin, ttsDur + pauseAfter, MIN_HOLD);
  const totalDur = enterDur + holdDur + exitDur;

  b.timing.enterDuration = enterDur;
  b.timing.holdDuration  = holdDur;
  b.timing.exitDuration  = exitDur;
  b.timing.totalDuration = totalDur;
  b.timing.startFrame    = 0;          // each block is its own composition
  b.timing.frames        = Math.round(totalDur * fps);
}

fs.writeFileSync('blocks.json', JSON.stringify(blocks, null, 2));
console.log('Timing written. Blocks:', blocks.blocks.length);
```

```bash
bash scripts/update-task.sh pipeline-state.json T40_timing completed
```

### 4.2 TypeScript 编译检查

```bash
bash scripts/update-task.sh pipeline-state.json T41_compile_check running

npx tsc --noEmit 2>&1 | head -50
if [ ${PIPESTATUS[0]} -ne 0 ]; then
  echo "TypeScript compile error — fix before rendering"
  bash scripts/update-task.sh pipeline-state.json T41_compile_check error "TypeScript error"
  exit 1
fi

BLOCK_COUNT=$(jq '.blocks | length' blocks.json)
bash scripts/update-task.sh pipeline-state.json T41_compile_check completed "${BLOCK_COUNT} blocks ready"
```

---

## STAGE 5：逐块渲染 + 拼接

每个 block 渲染为独立 MP4，已完成的块跳过（断点续渲）。所有块完成后 ffmpeg concat。

### 5.1 逐块渲染

```bash
mkdir -p output/blocks

for BLOCK_ID in $(jq -r '.blocks[].id' blocks.json); do
  TASK="T50_render_${BLOCK_ID}"

  # 断点续渲：已 completed 的块直接跳过
  STATUS=$(jq -r ".global[\"${TASK}\"].status // \"pending\"" pipeline-state.json 2>/dev/null || echo "pending")
  if [[ "$STATUS" == "completed" && -f "output/blocks/${BLOCK_ID}.mp4" ]]; then
    echo "[Stage5] ${BLOCK_ID}: already rendered, skipping"
    continue
  fi

  bash scripts/update-task.sh pipeline-state.json "${TASK}" running

  npx remotion render \
    --config remotion.config.ts \
    --codec h264 \
    --output "output/blocks/${BLOCK_ID}.mp4" \
    --log error \
    src/Root.tsx "${BLOCK_ID}" \
    2>&1 | tail -5

  if [[ -f "output/blocks/${BLOCK_ID}.mp4" ]]; then
    SIZE=$(du -sh "output/blocks/${BLOCK_ID}.mp4" | cut -f1)
    bash scripts/update-task.sh pipeline-state.json "${TASK}" completed "${SIZE}"
    echo "[Stage5] ${BLOCK_ID}: rendered (${SIZE})"
  else
    bash scripts/update-task.sh pipeline-state.json "${TASK}" error "MP4 not created"
    echo "[Stage5] ERROR: ${BLOCK_ID} failed"
  fi
done
```

### 5.2 拼接所有块

```bash
bash scripts/update-task.sh pipeline-state.json T51_concat running

mkdir -p output

# 验证所有块都已渲染
MISSING=0
for BLOCK_ID in $(jq -r '.blocks[].id' blocks.json); do
  [[ -f "output/blocks/${BLOCK_ID}.mp4" ]] || { echo "Missing: output/blocks/${BLOCK_ID}.mp4"; MISSING=$((MISSING+1)); }
done
if [[ "$MISSING" -gt 0 ]]; then
  bash scripts/update-task.sh pipeline-state.json T51_concat error "${MISSING} block(s) missing"
  exit 1
fi

# 生成 concat 列表（按 blocks.json 顺序）
jq -r '.blocks[].id' blocks.json | \
  while read ID; do echo "file '$(pwd)/output/blocks/${ID}.mp4'"; done \
  > output/blocks/concat.txt

ffmpeg -y -f concat -safe 0 -i output/blocks/concat.txt \
  -c copy output/final.mp4 \
  2>&1 | tail -5

if [[ -f output/final.mp4 ]]; then
  SIZE=$(du -sh output/final.mp4 | cut -f1)
  bash scripts/update-task.sh pipeline-state.json T51_concat completed "${SIZE}"
  echo "[Stage5] concat OK: output/final.mp4 (${SIZE})"
else
  bash scripts/update-task.sh pipeline-state.json T51_concat error "concat failed"
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
EXPECTED_SECS=$(jq '[.blocks[].timing.totalDuration // 0] | add' blocks.json)
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
TOTAL_SECS=$(jq '[.blocks[].timing.totalDuration // 0] | add' blocks.json)
for FRAC in 0.1 0.3 0.5 0.7 0.9; do
  T=$(node -e "console.log(($TOTAL_SECS * $FRAC).toFixed(2))")
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
  T04_voxcpm_server, T05_remotion_init, T06_copy_templates, T07_env_verify
  T10_compile_script
  T40_timing, T41_compile_check
  T51_concat
  T60_normalize, T61_quality_check

Per-block 任务（BlockId = B00 ... B99）:
  T20_tts_B03        Stage 2 TTS 合成
  T22_sub_B03        Stage 2 字幕切段
  T31_component_B03  Stage 3 animation 组件生成
  T50_render_B03     Stage 5 Remotion 单块渲染
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
