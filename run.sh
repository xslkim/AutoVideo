#!/usr/bin/env bash
set -euo pipefail

# ============================================================================
# video-agent/run.sh — 全自动视频制作入口
#
# 用法:
#   ~/video-agent/run.sh \
#     --script    "part1.md,part2.md"     # 必选，逗号分隔多文件合并
#     --title     "视频标题"               # 必选
#     --theme     dark-code               # 可选，默认 dark-code
#     --repo      /path/to/project-repo \
#     --out-dir   ~/my-video              # 可选，默认 ~/teaching-video-$(date)
#     --model     sonnet                  # 可选，默认 sonnet
#     --voice     zh-CN-YunxiNeural       # 可选，默认 zh-CN-YunxiNeural
#     --aspect    16:9                    # 可选，默认 16:9（支持 9:16 竖屏）
#     --source-files "src/core/Foo.h,src/Bar.cpp"  # 可选，展示的代码文件
#     --resume                            # 可选，断点续跑
#     --dry-run                           # 可选，只初始化不执行
# ============================================================================

AGENT_DIR="$(cd "$(dirname "$0")" && pwd)"

# ── 默认值 ──
SCRIPT_FILES=""       # comma-separated list of script files
TITLE=""              # video title (required if not --resume)
THEME="dark-code"     # visual theme
REPO_DIR=""
OUT_DIR=""
MODEL="sonnet"
VOICE="zh-CN-YunxiNeural"
ASPECT="16:9"
SOURCE_FILES=""
REUSE_FROM=""
RESUME=false
DRY_RUN=false
MAX_TURNS=200

# ── 参数解析 ──
while [[ $# -gt 0 ]]; do
  case "$1" in
    --script)       SCRIPT_FILES="$2"; shift 2 ;;
    --title)        TITLE="$2"; shift 2 ;;
    --theme)        THEME="$2"; shift 2 ;;
    --visual)       echo "WARN: --visual 已废弃"; shift 2 ;;
    --repo)         REPO_DIR="$(realpath "$2")"; shift 2 ;;
    --out-dir)      OUT_DIR="$2"; shift 2 ;;
    --model)        MODEL="$2"; shift 2 ;;
    --voice)        VOICE="$2"; shift 2 ;;
    --aspect)       ASPECT="$2"; shift 2 ;;
    --source-files) SOURCE_FILES="$2"; shift 2 ;;
    --reuse-from)   REUSE_FROM="$(realpath "$2")"; shift 2 ;;
    --max-turns)    MAX_TURNS="$2"; shift 2 ;;
    --resume)       RESUME=true; shift ;;
    --dry-run)      DRY_RUN=true; shift ;;
    -h|--help)
      cat <<'USAGE'
全自动视频制作工具

必选参数:
  --script FILES      口播稿文件（逗号分隔可传多个，按顺序合并为单个视频）
  --title  TEXT       视频标题

可选参数:
  --theme  THEME      视觉主题（默认: dark-code）
  --repo   DIR        项目 Git 仓库路径（用于代码展示素材，可省略）
  --out-dir DIR       输出项目目录（默认: ~/teaching-video-YYYYMMDD-HHMMSS）
  --model MODEL       Claude 模型: opus / sonnet（默认: sonnet）
  --voice VOICE       TTS 声音（默认: zh-CN-YunxiNeural）
  --aspect RATIO      画面比例: 16:9 / 9:16 / 1:1（默认: 16:9）
  --source-files LIST 要展示的代码文件，逗号分隔的相对路径（相对于 repo）
                      省略则自动选择 repo 中最有代表性的文件
  --reuse-from DIR    上一个项目目录，扫描可复用的动画组件（Stage 3 使用）
  --max-turns N       Claude 最大工具调用轮数（默认: 200）
  --resume            断点续跑（检测已有 pipeline-state.json）
  --dry-run           只初始化项目目录，不启动 Claude
USAGE
      exit 0 ;;
    *) echo "未知参数: $1"; exit 1 ;;
  esac
done

# ── 参数校验 ──
err() { echo "ERROR: $1" >&2; exit 1; }

[[ -n "$SCRIPT_FILES" ]] || err "缺少 --script 参数"
[[ -n "$TITLE" ]] || [[ "$RESUME" == true ]] || err "缺少 --title 参数"
[[ -z "$REPO_DIR" ]] || [[ -d "$REPO_DIR" ]] || err "仓库目录不存在: $REPO_DIR"

# Validate each script file exists
IFS=',' read -ra _SCRIPTS <<< "$SCRIPT_FILES"
for _sf in "${_SCRIPTS[@]}"; do
  _sf="$(echo "$_sf" | xargs)"
  [[ -f "$_sf" ]] || err "口播稿文件不存在: $_sf"
done

# ── 查找 claude CLI（延迟到实际需要时才报错） ──
find_claude() {
  # 1. 环境变量指定
  if [[ -n "${CLAUDE_BIN:-}" ]] && [[ -x "$CLAUDE_BIN" ]]; then return 0; fi
  # 2. PATH 中
  if command -v claude &>/dev/null; then CLAUDE_BIN="claude"; return 0; fi
  # 3. 常见安装路径
  for p in ~/.local/bin/claude ~/.npm-global/bin/claude /usr/local/bin/claude; do
    if [[ -x "$p" ]]; then CLAUDE_BIN="$p"; return 0; fi
  done
  # 4. ccd-cli（Claude Code remote/desktop 安装方式）
  local latest_ccd=$(ls -t ~/.claude/remote/ccd-cli/* 2>/dev/null | head -1)
  if [[ -n "$latest_ccd" ]] && [[ -x "$latest_ccd" ]]; then CLAUDE_BIN="$latest_ccd"; return 0; fi
  # 5. npx 回退
  if command -v npx &>/dev/null && npx claude --version &>/dev/null 2>&1; then CLAUDE_BIN="npx claude"; return 0; fi
  return 1
}

# ── 解析画面尺寸 ──
case "$ASPECT" in
  16:9)  WIDTH=1920; HEIGHT=1080 ;;
  9:16)  WIDTH=1080; HEIGHT=1920 ;;
  1:1)   WIDTH=1080; HEIGHT=1080 ;;
  *)     err "不支持的画面比例: $ASPECT（支持 16:9, 9:16, 1:1）" ;;
esac

# ── 创建项目目录 ──
if [[ -z "$OUT_DIR" ]]; then
  OUT_DIR="$HOME/teaching-video-$(date +%Y%m%d-%H%M%S)"
fi

if [[ "$RESUME" == true ]]; then
  if [[ ! -d "$OUT_DIR" ]]; then
    err "断点续跑模式但项目目录不存在: $OUT_DIR"
  fi
  if [[ ! -f "$OUT_DIR/pipeline-state.json" ]]; then
    echo "WARN: 项目目录存在但无 pipeline-state.json，将作为新项目初始化"
    RESUME=false
  fi
fi

mkdir -p "$OUT_DIR"/{src/data/source-samples,public/audio,output,logs,scripts,assets/{images,lottie,clips,voice-prompts}}

# ── 复制输入文件（多文件合并） ──
> "$OUT_DIR/src/data/script.md"
IFS=',' read -ra _SCRIPTS <<< "$SCRIPT_FILES"
for _sf in "${_SCRIPTS[@]}"; do
  _sf="$(echo "$_sf" | xargs)"
  cat "$(realpath "$_sf")" >> "$OUT_DIR/src/data/script.md"
  echo "" >> "$OUT_DIR/src/data/script.md"  # ensure newline between files
done

# ── 自动检测或复制源码文件 ──
if [[ -z "$REPO_DIR" ]]; then
  echo "未指定 --repo，跳过源码文件复制"
elif [[ -n "$SOURCE_FILES" ]]; then
  # 用户指定的文件
  IFS=',' read -ra FILES <<< "$SOURCE_FILES"
  for f in "${FILES[@]}"; do
    f="$(echo "$f" | xargs)"  # trim
    if [[ -f "$REPO_DIR/$f" ]]; then
      cp "$REPO_DIR/$f" "$OUT_DIR/src/data/source-samples/"
    else
      echo "WARN: 源码文件不存在: $REPO_DIR/$f"
    fi
  done
else
  # 自动选择：找 repo 中最有代表性的源码文件（按大小和类型筛选）
  echo "自动检测代码文件..."
  find "$REPO_DIR/src" "$REPO_DIR/lib" "$REPO_DIR/core" "$REPO_DIR/app" \
    -maxdepth 3 \
    -type f \( -name '*.h' -o -name '*.hpp' -o -name '*.cpp' -o -name '*.py' \
               -o -name '*.ts' -o -name '*.js' -o -name '*.go' -o -name '*.rs' \
               -o -name '*.java' -o -name '*.cs' \) \
    -size +500c -size -50k \
    2>/dev/null | head -10 | while read -r f; do
      cp "$f" "$OUT_DIR/src/data/source-samples/"
  done || true

  # 如果上面没找到，搜索整个 repo
  if [[ -z "$(ls -A "$OUT_DIR/src/data/source-samples/" 2>/dev/null)" ]]; then
    find "$REPO_DIR" \
      -maxdepth 4 \
      -type f \( -name '*.h' -o -name '*.hpp' -o -name '*.cpp' -o -name '*.py' \
                 -o -name '*.ts' -o -name '*.js' -o -name '*.go' -o -name '*.rs' \) \
      -not -path '*/node_modules/*' -not -path '*/.git/*' -not -path '*/vendor/*' \
      -size +500c -size -50k \
      2>/dev/null | head -6 | while read -r f; do
        cp "$f" "$OUT_DIR/src/data/source-samples/"
    done || true
  fi
fi

SOURCE_SAMPLE_LIST=$(ls "$OUT_DIR/src/data/source-samples/" 2>/dev/null | tr '\n' ',' | sed 's/,$//' | tr -d '\n')

# ── 视频标题 ──
VIDEO_TITLE="${TITLE:-教学视频}"

# ── 写入配置文件 ──
jq -n \
  --arg title "$VIDEO_TITLE" \
  --arg repoDir "$REPO_DIR" \
  --arg projectDir "$OUT_DIR" \
  --arg agentDir "$AGENT_DIR" \
  --arg scriptFile "src/data/script.md" \
  --arg sourceCodeSamples "src/data/source-samples/" \
  --arg sourceFileList "$SOURCE_SAMPLE_LIST" \
  --arg voice "$VOICE" \
  --arg model "$MODEL" \
  --argjson width "$WIDTH" \
  --argjson height "$HEIGHT" \
  --argjson fps 30 \
  --arg aspect "$ASPECT" \
  --arg reuseFrom "$REUSE_FROM" \
  --arg theme "$THEME" \
  '{title: $title, repoDir: $repoDir, projectDir: $projectDir, agentDir: $agentDir,
    reuseFrom: $reuseFrom, theme: $theme,
    scriptFile: $scriptFile,
    sourceCodeSamples: $sourceCodeSamples, sourceFileList: $sourceFileList,
    voice: $voice, model: $model, width: $width, height: $height, fps: $fps, aspect: $aspect,
    tts: {
      strategy: "auto",
      edge:      { voice: $voice },
      cosyvoice: {
        endpoint:    "http://127.0.0.1:50000",
        promptWav:   "assets/voice-prompts/default.wav",
        promptText:  "希望你以后能够做的比我还好呦。"
      },
      routing: {
        mixedLangThreshold: 0.15,
        minLengthForUpgrade: 30,
        upgradeOnEmphasis: true,
        fallbackChain: ["cosyvoice","edge"]
      }
    }}' \
  > "$OUT_DIR/video-agent-config.json"

# ── 复制工作流文档和脚本 ──
cp "$AGENT_DIR/VIDEO_WORKFLOW.md" "$OUT_DIR/VIDEO_WORKFLOW.md"
cp "$AGENT_DIR/INPUT_SPEC.md"    "$OUT_DIR/INPUT_SPEC.md"
cp "$AGENT_DIR/scripts/"*.sh     "$OUT_DIR/scripts/"
cp "$AGENT_DIR/scripts/"*.mjs    "$OUT_DIR/scripts/" 2>/dev/null || true
chmod +x "$OUT_DIR/scripts/"*.sh

# 复制 TTS provider 脚本
mkdir -p "$OUT_DIR/scripts/tts/providers"
cp "$AGENT_DIR/scripts/tts/"*.py           "$OUT_DIR/scripts/tts/"         2>/dev/null || true
cp "$AGENT_DIR/scripts/tts/providers/"*.py "$OUT_DIR/scripts/tts/providers/" 2>/dev/null || true

# 复制 CosyVoice 默认音色参考音频
COSYVOICE_PROMPT="/home/ubuntu/tools/CosyVoice/asset/zero_shot_prompt.wav"
if [[ -f "$COSYVOICE_PROMPT" ]]; then
  cp "$COSYVOICE_PROMPT" "$OUT_DIR/assets/voice-prompts/default.wav"
else
  echo "WARN: CosyVoice 参考音频不存在: $COSYVOICE_PROMPT（TTS 将降级到 edge-tts）"
fi

# ── 生成项目 CLAUDE.md ──
sed \
  -e "s|{{PROJECT_DIR}}|$OUT_DIR|g" \
  -e "s|{{REPO_DIR}}|$REPO_DIR|g" \
  -e "s|{{VOICE}}|$VOICE|g" \
  -e "s|{{WIDTH}}|$WIDTH|g" \
  -e "s|{{HEIGHT}}|$HEIGHT|g" \
  -e "s|{{VIDEO_TITLE}}|$VIDEO_TITLE|g" \
  "$AGENT_DIR/CLAUDE.md" > "$OUT_DIR/CLAUDE.md"

# ── 资产复用扫描（可选） ──
if [[ -n "$REUSE_FROM" ]]; then
  if [[ ! -d "$REUSE_FROM" ]]; then
    echo "WARN: --reuse-from 目录不存在: $REUSE_FROM，跳过复用扫描"
  else
    echo "扫描可复用资产: $REUSE_FROM ..."
    node "$AGENT_DIR/scripts/scan-reusable-assets.mjs" \
      --prev-project "$REUSE_FROM" \
      --new-blocks   "$OUT_DIR/src/data/script.md" \
      --out          "$OUT_DIR/reuse-plan.json" \
      2>/dev/null || echo "WARN: 资产扫描失败（脚本可能还未运行 Stage 1 编译），Stage 3 时 Agent 可手动运行"
    if [[ -f "$OUT_DIR/reuse-plan.json" ]]; then
      echo "复用计划已生成: $OUT_DIR/reuse-plan.json"
    fi
  fi
fi

# ── 磁盘空间预检 ──
AVAIL_KB=$(df --output=avail "$OUT_DIR" | tail -1)
AVAIL_GB=$((AVAIL_KB / 1024 / 1024))
if [[ $AVAIL_GB -lt 3 ]]; then
  echo "WARNING: 可用磁盘空间仅 ${AVAIL_GB}GB，视频渲染需要至少 3GB"
  echo "         建议在空间充足的分区运行"
fi

# ── 打印摘要 ──
cat << SUMMARY

╔══════════════════════════════════════════════╗
║         视频制作 Agent 项目已初始化           ║
╚══════════════════════════════════════════════╝

  标题:     $VIDEO_TITLE
  主题:     $THEME
  项目目录: $OUT_DIR
  口播稿:   $SCRIPT_FILES
  源码仓库: $REPO_DIR
  代码样本: ${SOURCE_SAMPLE_LIST:-（无）}
  TTS 声音: $VOICE
  画面尺寸: ${WIDTH}x${HEIGHT} ($ASPECT)
  模型:     $MODEL
  复用来源: ${REUSE_FROM:-（无）}
  断点续跑: $RESUME
  磁盘空间: ${AVAIL_GB}GB 可用

SUMMARY

if [[ "$DRY_RUN" == true ]]; then
  echo "  [dry-run] 项目已初始化，未启动 Claude。"
  echo ""
  echo "  手动启动:"
  echo "    cd $OUT_DIR && claude -p --model $MODEL --dangerously-skip-permissions --max-turns $MAX_TURNS \"读取 CLAUDE.md 和 video-agent-config.json，执行全流程\""
  echo ""
  echo "  断点续跑:"
  echo "    $0 --resume --out-dir $OUT_DIR --script $SCRIPT_FILES --repo $REPO_DIR"
  exit 0
fi

# ── 查找 Claude CLI（仅在非 dry-run 时需要） ──
if ! find_claude; then
  err "找不到 claude CLI。请先安装: npm install -g @anthropic-ai/claude-code
  或设置环境变量: export CLAUDE_BIN=/path/to/claude"
fi
echo "使用 Claude CLI: $CLAUDE_BIN"

# ── 启动 Claude Agent ──
echo "启动 Claude Agent..."
echo "日志: $OUT_DIR/logs/agent.log"
echo "────────────────────────────────────────────"

PROMPT="你是全自动视频制作 Agent。

请执行以下操作：
1. 读取 video-agent-config.json 了解项目配置
2. 读取 VIDEO_WORKFLOW.md 了解完整工作流
3. $(if [[ "$RESUME" == true ]]; then echo "检测到断点续跑模式：读取 pipeline-state.json，跳过已完成的任务，从第一个未完成任务继续"; else echo "从头开始执行全流程（Stage 0 → Stage 6）"; fi)

执行过程中：
- 每完成一个任务立即用 scripts/update-task.sh 更新状态
- 遇到错误最多重试 3 次
- Stage 2（TTS）和 Stage 3（素材生成）必须并行执行
- 所有日志写入 logs/ 目录

开始执行。"

cd "$OUT_DIR"
"$CLAUDE_BIN" -p \
  --model "$MODEL" \
  --dangerously-skip-permissions \
  --max-turns "$MAX_TURNS" \
  "$PROMPT" \
  2>&1 | tee "$OUT_DIR/logs/agent.log"

EXIT_CODE=${PIPESTATUS[0]}

echo ""
echo "────────────────────────────────────────────"
if [[ $EXIT_CODE -eq 0 ]]; then
  echo "Agent 执行完毕。"
  if [[ -f "$OUT_DIR/output/final_normalized.mp4" ]]; then
    echo "最终视频: $OUT_DIR/output/final_normalized.mp4"
    ls -lh "$OUT_DIR/output/final_normalized.mp4"
  elif [[ -f "$OUT_DIR/output/final.mp4" ]]; then
    echo "视频（未标准化）: $OUT_DIR/output/final.mp4"
  else
    echo "WARNING: 未找到输出视频文件，请检查日志: $OUT_DIR/logs/agent.log"
  fi
else
  echo "Agent 异常退出 (code=$EXIT_CODE)。"
  echo "检查日志: $OUT_DIR/logs/agent.log"
  echo "断点续跑: $0 --resume --out-dir $OUT_DIR --script $SCRIPT_FILES --repo $REPO_DIR"
fi

# 打印进度
if [[ -f "$OUT_DIR/pipeline-state.json" ]]; then
  echo ""
  bash "$OUT_DIR/scripts/progress.sh" "$OUT_DIR/pipeline-state.json"
fi

exit $EXIT_CODE
