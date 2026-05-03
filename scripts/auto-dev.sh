#!/usr/bin/env bash
# =============================================================================
# AutoVideo Web UI — 全自动开发脚本
#
# 用法：
#   ./scripts/auto-dev.sh              # 默认用 sonnet，从下一个 pending 任务开始
#   ./scripts/auto-dev.sh --model opus  # 用 opus 模型（更强但更慢更贵）
#   ./scripts/auto-dev.sh --from WP2.1  # 从指定任务开始
#   ./scripts/auto-dev.sh --dry-run     # 只打印将执行的任务，不实际运行
#   ./scripts/auto-dev.sh --max-tasks 3 # 最多执行 3 个任务后停止
#
# 前置条件：
#   1. 已安装 claude CLI（npm i -g @anthropic-ai/claude-code）
#   2. 已登录 claude（claude login 或设置 ANTHROPIC_API_KEY）
#   3. 在仓库根目录运行
# =============================================================================

set -euo pipefail

# ---------------------------------------------------------------------------
# 配置（可通过命令行参数覆盖）
# ---------------------------------------------------------------------------

MODEL="sonnet"           # 默认模型：sonnet 够用且快；复杂任务可换 opus
MAX_TURNS=200            # 每个任务最大工具调用轮次
FROM_TASK=""             # 从指定任务开始（空 = 自动从下一个 pending 开始）
DRY_RUN=false            # 只打印不执行
MAX_TASKS=0              # 最多执行多少个任务（0 = 不限）
PAUSE_ON_FAIL=true       # 任务失败时暂停等待确认

PROGRESS_FILE="WEB_PROGRESS.md"
TASKS_FILE="WEB_TASKS.md"

# ---------------------------------------------------------------------------
# 参数解析
# ---------------------------------------------------------------------------

while [[ $# -gt 0 ]]; do
  case $1 in
    --model)     MODEL="$2"; shift 2 ;;
    --max-turns) MAX_TURNS="$2"; shift 2 ;;
    --from)      FROM_TASK="$2"; shift 2 ;;
    --dry-run)   DRY_RUN=true; shift ;;
    --max-tasks) MAX_TASKS="$2"; shift 2 ;;
    --no-pause)  PAUSE_ON_FAIL=false; shift ;;
    -h|--help)
      head -16 "$0" | tail -14
      exit 0
      ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

# ---------------------------------------------------------------------------
# 前置检查
# ---------------------------------------------------------------------------

if ! command -v claude &>/dev/null; then
  echo "错误：未找到 claude 命令。请先安装：npm i -g @anthropic-ai/claude-code"
  exit 1
fi

if [[ ! -f "$PROGRESS_FILE" ]]; then
  echo "错误：未找到 $PROGRESS_FILE，请在仓库根目录运行"
  exit 1
fi

# ---------------------------------------------------------------------------
# 辅助函数
# ---------------------------------------------------------------------------

# 从 WEB_PROGRESS.md 提取下一个 pending 任务的 ID
get_next_task() {
  grep '| pending |' "$PROGRESS_FILE" \
    | head -1 \
    | sed 's/^[[:space:]]*//' \
    | awk -F'|' '{print $2}' \
    | xargs
}

# 检查指定任务是否已完成
is_task_done() {
  local task_id="$1"
  grep -q "$task_id.*| done |" "$PROGRESS_FILE"
}

# 从 WEB_TASKS.md 提取任务标题
get_task_title() {
  local task_id="$1"
  grep "### $task_id " "$TASKS_FILE" \
    | sed "s/### $task_id //" \
    | xargs
}

# 统计完成进度
get_progress() {
  local done=$(grep -c '| done |' "$PROGRESS_FILE" 2>/dev/null || echo 0)
  local total=$(grep -cE '^\| WP[0-9]' "$PROGRESS_FILE" 2>/dev/null || echo 0)
  echo "$done / $total"
}

# 日志
log() { echo "[$(date '+%H:%M:%S')] $*"; }
log_ok() { echo "[$(date '+%H:%M:%S')] ✓ $*"; }
log_err() { echo "[$(date '+%H:%M:%S')] ✗ $*" >&2; }

# ---------------------------------------------------------------------------
# 主循环
# ---------------------------------------------------------------------------

TASKS_DONE=0

log "AutoVideo Web UI 自动开发"
log "模型: $MODEL | 最大轮次: $MAX_TURNS | 进度: $(get_progress)"
echo "---"

while true; do
  # 确定下一个任务
  if [[ -n "$FROM_TASK" ]]; then
    TASK_ID="$FROM_TASK"
    FROM_TASK=""  # 只用一次，后续自动取 pending
  else
    TASK_ID=$(get_next_task)
  fi

  # 没有更多任务
  if [[ -z "$TASK_ID" ]]; then
    echo ""
    log_ok "所有任务已完成！进度: $(get_progress)"
    break
  fi

  # 已达到最大任务数
  if [[ $MAX_TASKS -gt 0 && $TASKS_DONE -ge $MAX_TASKS ]]; then
    echo ""
    log "已完成 $TASKS_DONE 个任务（达到 --max-tasks 限制）。进度: $(get_progress)"
    break
  fi

  TASK_TITLE=$(get_task_title "$TASK_ID")
  log "▶ 开始任务 $TASK_ID: $TASK_TITLE"

  if $DRY_RUN; then
    log "  [dry-run] 跳过执行"
    TASKS_DONE=$((TASKS_DONE + 1))
    # 模拟跳过：找下一个 pending
    FROM_TASK=""
    # 为 dry-run 读取下一个 pending（跳过当前行）
    NEXT=$(grep '| pending |' "$PROGRESS_FILE" \
      | grep -v "$TASK_ID" \
      | head -1 \
      | sed 's/^[[:space:]]*//' \
      | awk -F'|' '{print $2}' \
      | xargs)
    if [[ -z "$NEXT" ]]; then
      log "  [dry-run] 没有更多任务"
      break
    fi
    FROM_TASK="$NEXT"
    continue
  fi

  # -----------------------------------------------------------------------
  # 构造 prompt
  # -----------------------------------------------------------------------

  PROMPT="你正在自动开发 AutoVideo Web UI。

当前任务：**$TASK_ID $TASK_TITLE**

## 工作流程

1. 读 WEB_TASKS.md 找到 $TASK_ID 的完整描述（输入/输出/做什么/验收）
2. 如果任务引用了 WEB_PRD.md 的章节，去读对应章节
3. 更新 WEB_PROGRESS.md：将 $TASK_ID 的 status 改为 in_progress
4. 实现任务的全部要求
5. 运行验收步骤，确保全部通过
6. 用 git 提交所有改动，commit message 格式：web: $TASK_ID $TASK_TITLE
7. 更新 WEB_PROGRESS.md：
   - 将 $TASK_ID 的 status 改为 done
   - 填写 Commit 列为实际 commit hash
   - 更新顶部的 completed 计数
   - 更新 next_action 为下一个 pending 任务
8. 完成后直接结束，不要开始下一个任务

## 重要规则

- 只做 $TASK_ID 这一个任务，不要做其他任务
- 验收不通过就修复，不要跳过
- 启动 server 测试时用 PORT=3050 避免端口冲突，测试完一定要 kill 掉进程
- 前端代码在 web/src/，后端代码在 server/
- 类型检查：后端 npx tsc -p tsconfig.server.json --noEmit，前端 cd web && npx vue-tsc --noEmit
- 提交前确保两边类型检查都通过"

  # -----------------------------------------------------------------------
  # 执行 claude
  # -----------------------------------------------------------------------

  START_TIME=$(date +%s)

  set +e
  claude -p "$PROMPT" \
    --dangerously-skip-permissions \
    --max-turns "$MAX_TURNS" \
    --model "$MODEL" \
    2>&1 | tee "/tmp/auto-dev-${TASK_ID}.log"
  EXIT_CODE=${PIPESTATUS[0]}
  set -e

  END_TIME=$(date +%s)
  DURATION=$(( END_TIME - START_TIME ))

  # -----------------------------------------------------------------------
  # 检查结果
  # -----------------------------------------------------------------------

  if is_task_done "$TASK_ID"; then
    TASKS_DONE=$((TASKS_DONE + 1))
    log_ok "$TASK_ID 完成 (${DURATION}s) | 进度: $(get_progress)"
    echo "---"
  else
    log_err "$TASK_ID 未完成 (exit=$EXIT_CODE, ${DURATION}s)"
    log_err "日志：/tmp/auto-dev-${TASK_ID}.log"

    if $PAUSE_ON_FAIL; then
      echo ""
      read -rp "任务未完成。选择：[r]重试 / [s]跳过 / [q]退出: " choice
      case "$choice" in
        r|R)
          FROM_TASK="$TASK_ID"
          log "重试 $TASK_ID..."
          continue
          ;;
        s|S)
          log "跳过 $TASK_ID"
          # 手动标记为 skipped 以便循环继续
          sed -i "s/| $TASK_ID |.*| pending |/| $TASK_ID | ... | skipped |/" "$PROGRESS_FILE" 2>/dev/null || true
          TASKS_DONE=$((TASKS_DONE + 1))
          continue
          ;;
        *)
          log "退出。进度: $(get_progress)"
          exit 1
          ;;
      esac
    else
      log_err "继续下一个任务..."
      TASKS_DONE=$((TASKS_DONE + 1))
    fi
  fi
done

log "总计完成 $TASKS_DONE 个任务"
