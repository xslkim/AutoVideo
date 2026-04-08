# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository Overview

This is the **AutoVideo** base framework — a shell + Node.js + Remotion system that uses Claude as an AI agent to transform a single narration script (with inline asset descriptions) into a finished MP4 video via a 6-stage pipeline.

## Running the System

```bash
bash run.sh \
  --script   ./script.md \           # required: narration + inline asset descriptions (see INPUT_SPEC.md)
  --repo     /path/to/source-repo \  # required: codebase to draw code samples from
  [--out-dir ~/my-video]             # default: ~/teaching-video-YYYYMMDD-HHMMSS
  [--model   opus|sonnet]            # default: opus
  [--voice   zh-CN-YunxiNeural]      # edge-tts voice
  [--aspect  16:9|9:16|1:1]          # resolution: 1920×1080 / 1080×1920 / 1080×1080
  [--source-files "src/foo.cpp,..."]  # comma-separated repo-relative paths; auto-detected if omitted
  [--max-turns 200]
  [--resume]                         # continue from existing pipeline-state.json
  [--dry-run]                        # initialize project dir without launching Claude
```

`run.sh` creates the project directory, writes `video-agent-config.json`, copies inputs, and launches `claude -p --dangerously-skip-permissions`.

To resume a failed run:
```bash
bash run.sh --resume --out-dir ~/my-video --script ./script.md --repo /path/to/repo
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

A single file (`script.md`) contains both narration text and asset descriptions. `>>>` markers define asset blocks:

```markdown
# Video Title

Opening narration (shown over title card)

>>> Asset Title
**[Type]**
Asset description lines...

Narration text during this asset.

>>> Next Asset
**[Type]**
Description...

More narration...
```

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

# 全自动视频制作 Agent 指令

> 本文件由 run.sh 自动生成，包含项目专属配置。通用工作流详见 VIDEO_WORKFLOW.md。

## 你的角色

你是一个全自动视频制作 Agent。你的任务是将口播稿（含内嵌素材描述）转化为一个完整的视频文件（MP4）。

## 项目配置

- 配置文件: `video-agent-config.json`（启动时第一时间读取）
- 视频标题: {{VIDEO_TITLE}}
- 源码仓库: {{REPO_DIR}}
- TTS 声音: {{VOICE}}
- 分辨率: {{WIDTH}}x{{HEIGHT}}

## 关键文件

| 文件 | 用途 |
|------|------|
| `video-agent-config.json` | 项目配置（路径、声音、尺寸等） |
| `VIDEO_WORKFLOW.md` | 完整工作流参考（6 个 Stage 的实现细节） |
| `src/data/script.md` | 口播稿 + 内嵌素材描述（唯一输入文件） |
| `src/data/source-samples/` | 代码样本文件（用于代码展示素材） |
| `pipeline-state.json` | 流水线状态追踪（断点续跑） |
| `scripts/*.sh` | 状态管理脚本 |

## 执行规则

### 1. 启动

```
1. 读取 video-agent-config.json
2. 读取 VIDEO_WORKFLOW.md 了解每个 Stage 的实现细节
3. 检查 pipeline-state.json 是否存在：
   - 存在 → 断点续跑，跳过已完成任务
   - 不存在 → 从头开始
```

### 2. 阶段概览

```
Stage 0: 环境检测（系统依赖、Node.js、edge-tts、Remotion）
Stage 1: 脚本解析（口播稿 → blocks.json）
Stage 2: 语音合成（edge-tts → MP3 + VTT → JSON）    ← 与 Stage 3 并行
Stage 3: 视觉素材（React 组件生成）                   ← 与 Stage 2 并行
Stage 4: Remotion 工程编排（组装所有组件 + 音频）
Stage 5: 渲染输出（Remotion render → MP4）
Stage 6: 后处理 + 校验（音频标准化 + 质量检查）
```

### 3. 状态管理

每个任务执行前后必须更新状态：

```bash
# 开始任务
bash scripts/update-task.sh pipeline-state.json T20_tts_B01 running

# 完成任务
bash scripts/update-task.sh pipeline-state.json T20_tts_B01 completed "28.5s"

# 任务失败
bash scripts/update-task.sh pipeline-state.json T20_tts_B01 error "edge-tts timeout"
```

### 4. 并行执行

- Stage 2（所有 TTS 块）和 Stage 3（所有组件）**必须并行**
- 同一 Stage 内的独立任务尽量并行
- 使用 shell 后台任务 `&` + `wait` 实现 TTS 并行

### 5. 错误处理

- 每个任务最多重试 3 次
- 重试间隔：TTS 5秒，apt/npm 10秒
- 超过重试次数 → 标记为终态错误，继续其他不依赖此任务的分支
- 致命错误（Stage 0 环境不可用、Stage 4 编译失败）→ 停止整个流水线

### 6. 口播稿解析关键规则（Stage 1）

口播稿采用统一格式：旁白文字和素材描述写在同一个文件中，以 `>>>` 标记分割。

**`>>>` 块解析：**

| 部分 | 识别方式 | 处理 |
|------|---------|------|
| `>>>` 行 | `>>>` 开头 | 提取素材标题，不纳入 TTS |
| `**[类型]**` 行 | 紧跟 `>>>` 行之后 | 提取素材类型 |
| 素材描述 | 类型行之后到第一个空行 | 供 Stage 3 组件生成 |
| 旁白文字 | 空行之后到下一个 `>>>` | 纳入 TTS + 字幕 |
| 开场块 | 第一个 `>>>` 之前的文字 | 使用标题卡画面 |

**旁白文字中的特殊标记：**

| 标记 | 含义 | 处理 |
|------|------|------|
| 空行 | 字幕块分隔 | TTS 短暂停顿 ~0.3s，字幕切换到下一块 |
| `（停顿）` | 额外静音 1s | 插入静音，不显示字幕 |
| `（长停顿）` | 额外静音 2s + 黑屏过渡 | 用于主题切换 |
| `**加粗**` | 字幕高亮词 | 字幕中用强调色显示 |
| 块内硬换行 | 字幕行分割 | 保留为字幕内的行分割（TTS 连读） |

**字幕行长度上限**（从 `config.aspect` 派生）：
- 16:9 → 每行 ≤ 20 个中文字符
- 9:16 → 每行 ≤ 14 个中文字符
- 1:1 → 每行 ≤ 16 个中文字符

超长行自动在标点处断行，并输出 WARNING。

### 7. 组件生成原则（Stage 3）

你需要根据 `blocks.json` 中每个 block 的 `asset.description` 和 `asset.rawMarkdown` **动态生成** React 组件：
- 不要硬编码内容，根据描述创建匹配的视觉效果
- 所有组件使用统一 THEME（见 VIDEO_WORKFLOW.md §3.2）
- 每个组件接收 `durationInFrames: number` 作为 prop
- 使用 Remotion 的 `useCurrentFrame()`、`interpolate()`、`spring()` 做动画
- 优先用 CSS/SVG 绘制，不依赖外部图片
- 开场块（无 asset）使用 TitleCard 组件显示视频标题
- 如果某个组件实在难以实现，用通用 TextCard 降级显示文字描述

### 8. 字幕渲染规则（Stage 4）

字幕组件 `SubtitleOverlay` 需要处理：
- 从 `blocks.json` 的 `subtitleBlocks` 读取分块信息
- 与 Stage 2 的 VTT 时间戳配合，在正确的时间显示正确的字幕块
- `highlights` 中的词用 `THEME.textAccent` 颜色高亮
- 每块最多显示 2 行
- 块间切换用快速淡入淡出（0.15s）

### 9. 完成标准

最终输出 `output/final_normalized.mp4`，满足：
- 分辨率: {{WIDTH}}x{{HEIGHT}}
- 编码: h264 + aac
- 时长: 与口播稿匹配（允许 ±15% 偏差）
- 非纯黑帧（5 个抽帧点均有画面内容）
- 中文正确显示
- 字幕无溢出/换行异常
