<template>
  <div class="task-item" :class="'task-item--' + task.status">
    <!-- Status icon -->
    <span class="task-icon">{{ statusIcon }}</span>

    <!-- Main info -->
    <div class="task-info">
      <div class="task-title-row">
        <span class="task-label">{{ stageLabel }}</span>
        <span class="task-status-badge">{{ statusBadge }}</span>
      </div>

      <!-- Progress bar (running / cancelling) -->
      <TaskProgress
        v-if="isActive"
        :percent="lastPercent"
        :step="task.lastProgress?.step"
        :status="task.status"
        :pending="task.status === 'pending'"
      />

      <!-- Meta line: ETA, duration, error summary -->
      <div class="task-meta">
        <!-- ETA for running tasks -->
        <span v-if="task.status === 'running' && etaText" class="task-eta">{{ etaText }}</span>

        <!-- Duration -->
        <span v-if="durationText" class="task-duration">{{ durationText }}</span>

        <!-- Error summary -->
        <span v-if="task.status === 'failed' && task.errorMessage" class="task-error-msg">
          {{ task.errorMessage }}
        </span>
      </div>
    </div>

    <!-- Actions -->
    <div class="task-actions">
      <!-- Cancel button -->
      <n-button
        v-if="task.status === 'pending' || task.status === 'running' || task.status === 'cancelling'"
        size="tiny"
        text
        type="error"
        :disabled="task.status === 'cancelling'"
        @click="$emit('cancel', task.id)"
      >
        取消
      </n-button>

      <!-- View log (failed) -->
      <n-button
        v-if="task.status === 'failed'"
        size="tiny"
        text
        @click="$emit('view-log', task.id)"
      >
        查看日志
      </n-button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { NButton } from 'naive-ui'
import TaskProgress from './TaskProgress.vue'
import { formatStage } from '../../stores/taskStore'
import type { TaskRecord, TaskStatus } from '../../../../server/types/api'

// ── Props / Emits ──────────────────────────────────────────────────────

const props = defineProps<{
  task: TaskRecord
}>()

defineEmits<{
  (e: 'cancel', id: string): void
  (e: 'view-log', id: string): void
}>()

// ── Computed ───────────────────────────────────────────────────────────

const lastPercent = computed(() => props.task.lastProgress?.percent ?? 0)

const stageLabel = computed(() => formatStage(props.task.stage, props.task.blockIds))

const isActive = computed(() =>
  props.task.status === 'pending' || props.task.status === 'running' || props.task.status === 'cancelling',
)

// ── Status icon ────────────────────────────────────────────────────────

const STATUS_ICON: Record<TaskStatus, string> = {
  pending:    '◌',
  running:    '●',
  cancelling: '◐',
  completed:  '✓',
  failed:     '✗',
  cancelled:  '⊘',
}

const statusIcon = computed(() => STATUS_ICON[props.task.status])

// ── Status badge ───────────────────────────────────────────────────────

const STATUS_BADGE: Record<TaskStatus, string> = {
  pending:    '等待中',
  running:    '运行中',
  cancelling: '强制停止中',
  completed:  '已完成',
  failed:     '失败',
  cancelled:  '已取消',
}

const statusBadge = computed(() => STATUS_BADGE[props.task.status])

// ── Duration ───────────────────────────────────────────────────────────

const durationText = computed(() => {
  const ms = props.task.durationMs
  if (ms === undefined || ms === null) {
    // Show live duration for running tasks
    if (props.task.status === 'running' && props.task.startedAt) {
      return formatDuration(Date.now() - props.task.startedAt)
    }
    return ''
  }
  return formatDuration(ms)
})

function formatDuration(ms: number): string {
  const sec = Math.floor(ms / 1000)
  if (sec < 60) return `${sec}s`
  const min = Math.floor(sec / 60)
  const s = sec % 60
  if (min < 60) return `${min}:${String(s).padStart(2, '0')}`
  const h = Math.floor(min / 60)
  const m = min % 60
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

// ── ETA ────────────────────────────────────────────────────────────────

const etaText = computed(() => {
  if (props.task.status !== 'running') return ''
  if (!props.task.startedAt) return ''
  const percent = lastPercent.value
  if (percent < 5) return '估算中…'

  const elapsed = Date.now() - props.task.startedAt
  const total = elapsed / (percent / 100)
  const remaining = total - elapsed
  if (remaining <= 0) return '即将完成'

  const sec = Math.ceil(remaining / 1000)
  if (sec < 60) return `剩余 ${sec}s`
  if (sec < 3600) {
    const m = Math.floor(sec / 60)
    const s = sec % 60
    return `剩余 ${m}:${String(s).padStart(2, '0')}`
  }
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  return `剩余 ${h}:${String(m).padStart(2, '0')}`
})
</script>

<style scoped>
.task-item {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 6px 0;
  font-size: 12px;
}

.task-item:not(:last-child) {
  border-bottom: 1px solid var(--n-border-color, #f0f0f0);
}

/* Status icon */
.task-icon {
  flex-shrink: 0;
  width: 16px;
  text-align: center;
  font-size: 11px;
  padding-top: 2px;
}

.task-item--pending .task-icon { color: #999; }
.task-item--running .task-icon { color: #2080f0; }
.task-item--cancelling .task-icon { color: #f0a020; }
.task-item--completed .task-icon { color: #18a058; }
.task-item--failed .task-icon { color: #d03050; }
.task-item--cancelled .task-icon { color: #999; }

/* Info area */
.task-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.task-title-row {
  display: flex;
  align-items: center;
  gap: 6px;
}

.task-label {
  font-weight: 500;
  color: var(--n-text-color, #333);
}

.task-status-badge {
  font-size: 10px;
  padding: 0 4px;
  border-radius: 3px;
  line-height: 16px;
  flex-shrink: 0;
}

.task-item--pending .task-status-badge { background: #f0f0f0; color: #999; }
.task-item--running .task-status-badge { background: rgba(32, 128, 240, 0.1); color: #2080f0; }
.task-item--cancelling .task-status-badge { background: rgba(240, 160, 32, 0.1); color: #f0a020; }
.task-item--completed .task-status-badge { background: rgba(24, 160, 88, 0.1); color: #18a058; }
.task-item--failed .task-status-badge { background: rgba(208, 48, 80, 0.1); color: #d03050; }
.task-item--cancelled .task-status-badge { background: #f0f0f0; color: #999; }

/* Meta line */
.task-meta {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 11px;
  color: #999;
  min-height: 16px;
}

.task-eta {
  color: #666;
}

.task-error-msg {
  color: #d03050;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* Actions */
.task-actions {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 4px;
}
</style>
