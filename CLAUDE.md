# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository Overview

This is the **AutoVideo** base framework — a shell + Node.js + Remotion system that uses Claude as an AI agent to transform a single narration script (with inline asset descriptions) into a finished MP4 video via a 6-stage pipeline.

## Running the System

```bash
bash run.sh \
  --script   "part1.md,part2.md" \   # required: comma-separated input files (blocks only, no frontmatter)
  --title    "视频标题" \              # required: video title (CLI param, not in file)
  [--theme   dark-code]              # optional: visual theme (default: dark-code)
  [--repo    /path/to/source-repo]   # optional: codebase to draw code samples from
  [--out-dir ~/my-video]             # default: ~/teaching-video-YYYYMMDD-HHMMSS
  [--model   opus|sonnet]            # default: sonnet
  [--voice   zh-CN-YunxiNeural]      # edge-tts fallback voice
  [--aspect  16:9|9:16|1:1]          # resolution: 1920×1080 / 1080×1920 / 1080×1080
  [--source-files "src/foo.cpp,..."]  # comma-separated repo-relative paths; auto-detected if omitted
  [--reuse-from ~/prev-video]        # scan previous project for reusable animation components
  [--cosyvoice-dir ~/tools/CosyVoice] # CosyVoice install dir (omit to use edge-tts only)
  [--max-turns 200]
  [--resume]                         # continue from existing pipeline-state.json
  [--dry-run]                        # initialize project dir without launching Claude
```

`run.sh` creates the project directory, writes `video-agent-config.json`, copies inputs, and launches `claude -p --dangerously-skip-permissions`.

To resume a failed run:
```bash
bash run.sh --resume --out-dir ~/my-video --script ./script.md
```

## Architecture: Base Repo vs. Project Directory

The base repo contains only the **framework**. Each invocation of `run.sh` creates a new self-contained project directory:

```
AutoVideo/                    ← this repo (framework only)
├── run.sh                    ← entry point
├── CLAUDE.md                 ← this file; ALSO a template copied into project dirs
│                               (run.sh fills {{PLACEHOLDER}} vars with sed)
├── VIDEO_WORKFLOW.md         ← full 6-stage implementation spec (copied to project)
├── INPUT_SPEC.md             ← input format rules for script.md
├── USAGE_GUIDE.md            ← user-facing guide
└── scripts/                  ← state management scripts (copied to project)
    ├── update-task.sh        ← thread-safe task status update (uses flock)
    ├── next-tasks.sh         ← dependency-aware task scheduler
    └── progress.sh           ← renders █░ progress bar from pipeline-state.json

~/teaching-video-*/           ← generated project dir (one per run)
├── video-agent-config.json   ← title, voice, resolution, paths, model
├── pipeline-state.json       ← task graph with statuses for resume support
├── CLAUDE.md                 ← filled-in copy of this template
├── VIDEO_WORKFLOW.md         ← copy of workflow spec
├── scripts/                  ← copies of state management scripts
├── src/data/
│   ├── script.md             ← narration input (with inline asset descriptions)
│   └── source-samples/       ← code files copied from --repo
├── public/audio/             ← TTS output: B{xx}.mp3 + B{xx}.vtt
├── output/                   ← final_normalized.mp4
└── logs/agent.log            ← Claude agent execution log
```

The Remotion TypeScript project (`src/`, `package.json`, `remotion.config.ts`) is created dynamically during Stage 0 of the pipeline inside the project directory.

## Input Format

Input files contain **only blocks** (delimited by `>>>` markers). No frontmatter. Any text before the first `>>>` is ignored. Multiple input files can be specified (comma-separated), and blocks are numbered continuously across files.

Video metadata (title, theme, voice, aspect) is passed via CLI parameters, not written in the file.

```markdown
>>> Asset Title
@type: animation
@rect: safe

Narration line 1 (= subtitle line 1)
Narration line 2 (= subtitle line 2)

Narration line 3 after a blank line (blank lines are ignored for subtitles)

>>> Next Asset
@type: code
@source: example.py

More narration...
```

**Subtitle rule:** Each non-empty narration line becomes exactly one subtitle entry. Empty lines are ignored. Subtitle timing is computed from TTS VTT word-level timestamps (fallback: proportional by character count).

See `INPUT_SPEC.md` for full syntax.

## State Management Scripts

All three scripts operate on `pipeline-state.json`:

```bash
bash scripts/update-task.sh  <state-file> <task-id> <status> [note]
# statuses: pending | running | completed | error | skipped

bash scripts/next-tasks.sh   <state-file>
# returns: READY:t1,t2 | WAITING | BLOCKED:reason | ALL_DONE

bash scripts/progress.sh     <state-file>
# prints visual progress bar
```

Task IDs follow `T{stage}{seq}_{name}` (e.g. `T20_tts_B01` = Stage 2, TTS for block 1).

---

> Below this line is the **project-specific agent template**. `run.sh` copies this file into each generated project directory and replaces the `{{PLACEHOLDER}}` variables. When working in the base repo, the sections above are the relevant guidance.

---

# 全自动视频制作 Agent 指令（v2）

> 本文件由 run.sh 自动生成，包含项目专属配置。完整工作流详见 VIDEO_WORKFLOW.md。

## 你的角色

你是全自动视频制作 Agent（v2）。将 v2 格式口播稿编译为 `blocks.json`，经过 TTS、组件生成、时序装配，最终输出 MP4。

## 项目配置

- 配置文件: `video-agent-config.json`（**启动后第一时间读取**）
- 视频标题: {{VIDEO_TITLE}}
- TTS 声音（edge 兜底）: {{VOICE}}
- 分辨率: {{WIDTH}}x{{HEIGHT}}

## 关键文件

| 文件 | 用途 |
|------|------|
| `video-agent-config.json` | 项目配置（路径、TTS、尺寸等） |
| `VIDEO_WORKFLOW.md` | **完整执行手册**（Stage 0–6 每步命令） |
| `src/data/script.md` | v2 格式口播稿（唯一输入） |
| `src/data/source-samples/` | 代码样本文件 |
| `blocks.json` | Stage 1 编译产物，后续所有 Stage 的数据源 |
| `pipeline-state.json` | 任务状态图（断点续跑） |
| `scripts/` | 状态管理脚本 + TTS router |

## 启动流程

```
1. 读取 video-agent-config.json
2. 读取 VIDEO_WORKFLOW.md（全文）
3. 检查 pipeline-state.json：
   存在 → 断点续跑，跳过 completed/skipped 任务
   不存在 → 从头执行 Stage 0 → Stage 6
```

## Stage 概览

```
Stage 0: 环境搭建（apt、Node、Python venv、Remotion init、启动 CosyVoice 服务）
Stage 1: 脚本编译（compile-script.mjs: script.md → blocks.json）
Stage 2: 音频合成（TTS router → WAV + VTT + 字幕切段，自动查全局缓存）  ← 与 Stage 3 并行
Stage 3: 视觉资产（代码预处理 + animation 组件生成，自动查全局缓存）      ← 与 Stage 2 并行
Stage 4: 时序装配（帧计算 + 主音轨拼接 + Video.tsx）
Stage 5: Remotion 渲染（→ MP4）
Stage 6: 后处理（音频标准化 + 质量校验）
```

## Task ID 规范

```
T00_sudo_check          T01_apt_install         T02_nodejs
T03_python              T04_cosyvoice_server     T05_remotion_init
T06_copy_templates      T07_env_verify
T10_compile_script
T20_tts_B{nn}           T21_vtt_align_B{nn}     T22_subtitle_B{nn}
T31_component_B{nn}
T40_timing              T41_master_audio        T42_compose_video
T43_compile_check
T50_preview_frames      T51_full_render
T60_normalize           T61_quality_check
```

## 状态管理

```bash
bash scripts/update-task.sh pipeline-state.json T20_tts_B01 running
bash scripts/update-task.sh pipeline-state.json T20_tts_B01 completed "11.2s"
bash scripts/update-task.sh pipeline-state.json T20_tts_B01 error "timeout"
```

## TTS 路由规则

TTS 通过 `scripts/tts/router.py` 调用，**自动选择**最佳 provider：
- 纯中文短句 → edge-tts（兜底，无需服务）
- 中英混读 / 有代码术语 / 有强调词 → **CosyVoice**（本地 GPU）
- CosyVoice 不可用 → edge-tts 兜底

```bash
# 合成单个 block
source ~/video-agent-venv/bin/activate
python3 scripts/tts/router.py blocks.json B03 public/audio/ \
  --config video-agent-config.json
# 输出: public/audio/B03.wav + B03.vtt + B03.meta.json
```

**并行执行 TTS**（Stage 2 必须这样做）：

```bash
for BLOCK_ID in $(jq -r '.blocks[].id' blocks.json); do
  (
    source ~/video-agent-venv/bin/activate
    python3 scripts/tts/router.py blocks.json "$BLOCK_ID" public/audio/ \
      --config video-agent-config.json \
      && bash scripts/update-task.sh pipeline-state.json "T20_tts_${BLOCK_ID}" completed \
      || bash scripts/update-task.sh pipeline-state.json "T20_tts_${BLOCK_ID}" error
  ) &
done
wait
```

## 组件生成原则（Stage 3）

**Step 1: 先检查复用计划**

如果 `reuse-plan.json` 存在，先复用已匹配的组件（直接复制文件，标记 T31 为 completed "reused"）。
如果 `video-agent-config.json` 的 `reuseFrom` 字段非空但无 `reuse-plan.json`，先运行扫描：

```bash
REUSE_FROM=$(jq -r '.reuseFrom // empty' video-agent-config.json)
AGENT_DIR=$(jq -r '.agentDir' video-agent-config.json)
[[ -n "$REUSE_FROM" ]] && node "$AGENT_DIR/scripts/scan-reusable-assets.mjs" \
  --prev-project "$REUSE_FROM" --new-blocks blocks.json --out reuse-plan.json
```

**Step 2: 为未复用的 animation block 生成组件**

对 `type: animation` 且 T31 未 completed 的 block，在 `src/blocks/{id}/Component.tsx` 生成 React 组件：

```typescript
// 必须满足此签名
interface AnimationProps {
  frame: number;
  durationInFrames: number;
  rect: { x: number; y: number; w: number; h: number };
  theme: Theme;
  fps: number;
}
```

- 使用 Remotion `useCurrentFrame()`、`interpolate()`、`spring()`
- 优先 CSS/SVG，不依赖外部图片
- 实在难以实现 → 将 block 的 `visual.content.type` 改为 `textcard` 降级
- `type: code` 的 block 需在此阶段用 shiki 预处理代码，写入 `spec.__lines`（见 VIDEO_WORKFLOW.md §3.4）

## 全局资产缓存（~/.autovideo-cache）

所有生成的音频和视觉组件都会被缓存到 `~/.autovideo-cache/`，下次内容相同时直接复用，无需重新调用模型或 TTS。

```
~/.autovideo-cache/
  manifest.json          # 索引：hash → {type, title, project, createdAt, hitCount, files}
  audio/{md5}.wav/vtt    # 缓存音频（key = 口播文本 + voice + provider）
  components/{md5}.tsx   # 缓存动画组件（key = block.title + spec全字段 + 源码行内容）
  shiki/{md5}.json       # 缓存 shiki 高亮结果（key = 源码行内容 + lang + highlights + theme）
```

**缓存规则：**
- 音频 hash 输入：`narration`（归一化空白）+ `voice` + `provider`（edge/cosyvoice/...）
- 组件 hash 输入：`title` + `spec.*`（全部字段，不含 narration/timing/subtitles）；code 块额外包含实际源码行内容
- 任一输入变化 → hash 不同 → 自动重新生成
- 缓存文件被删除 → 静默 miss，重新生成并重新写入缓存
- 查看缓存统计：`node scripts/cache.mjs stats`

## 完成标准

`output/final_normalized.mp4` 满足：
- 分辨率 {{WIDTH}}×{{HEIGHT}}，h264 + aac
- 时长与口播稿匹配（±15% 以内）
- 5 个抽帧点均有画面内容（非纯黑）
- 中文字幕正确显示，无溢出
