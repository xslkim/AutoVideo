<template>
  <!-- ── Bottom task bar ── -->
  <div class="task-bar" :class="{ 'task-bar--expanded': expanded }">
    <!-- Header (always visible) -->
    <div class="task-bar-header" @click="expanded = !expanded">
      <div class="header-left">
        <!-- Idle state -->
        <span v-if="!store.runningTask" class="task-status task-status--idle">
          ● 空闲
        </span>
        <!-- Running task summary -->
        <template v-else>
          <span class="task-status task-status--running">
            ● {{ runningLabel }}
          </span>
          <TaskProgress
            class="header-progress"
            :percent="runningPercent"
            :step="store.runningTask.lastProgress?.step"
            :status="store.runningTask.status"
          />
        </template>
      </div>
      <div class="header-right">
        <span v-if="taskCount > 0" class="task-count">{{ taskCount }}</span>
        <span class="collapse-icon">{{ expanded ? '▼' : '▲' }}</span>
      </div>
    </div>

    <!-- Expanded content -->
    <div v-show="expanded" class="task-bar-content">
      <template v-if="store.projectTasks.length === 0">
        <n-empty description="暂无任务" size="small" />
      </template>
      <template v-else>
        <TaskItem
          v-for="task in store.projectTasks"
          :key="task.id"
          :task="task"
          @cancel="onCancel"
          @view-log="onViewLog"
        />
        <div v-if="taskCount > 20" class="task-bar-footer">
          <n-button size="tiny" text @click="showAllModal = true">
            查看全部 ({{ taskCount }})
          </n-button>
        </div>
      </template>
    </div>
  </div>

  <!-- ── "View all" modal ── -->
  <n-modal v-model:show="showAllModal" preset="card" title="任务历史" style="max-width: 640px" :mask-closable="true">
    <div class="modal-task-list">
      <TaskItem
        v-for="task in allTasks"
        :key="task.id"
        :task="task"
        @cancel="onCancel"
        @view-log="onViewLog"
      />
    </div>
    <n-empty v-if="allTasks.length === 0" description="暂无任务" size="small" />
  </n-modal>

  <!-- ── Log modal ── -->
  <n-modal v-model:show="showLogModal" preset="card" title="任务日志" style="max-width: 720px" :mask-closable="true">
    <n-spin v-if="logLoading" size="small" />
    <pre v-else class="log-content">{{ logContent || '(日志为空)' }}</pre>
  </n-modal>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { NEmpty, NButton, NModal, NSpin, createDiscreteApi } from 'naive-ui'
import TaskItem from '../task/TaskItem.vue'
import TaskProgress from '../task/TaskProgress.vue'
import { useTaskStore } from '../../stores/taskStore'
import type { TaskRecord } from '../../../../server/types/api'

const { message } = createDiscreteApi(['message'])

const props = defineProps<{
  projectName: string
}>()

const store = useTaskStore()
const expanded = ref(false)
const showAllModal = ref(false)
const showLogModal = ref(false)
const logContent = ref('')
const logLoading = ref(false)

// ── Init store when project name changes ───────────────────────────────

watch(
  () => props.projectName,
  (name) => {
    if (name) store.initForProject(name)
  },
  { immediate: true },
)

// ── Computed ───────────────────────────────────────────────────────────

const runningLabel = computed(() => {
  const t = store.runningTask
  if (!t) return ''
  const labels: Record<string, string> = {
    compile: '编译中',
    tts: '生成音频',
    visuals: '生成视觉',
    render: '渲染中',
    build: '全量构建中',
    merge: '合并视频',
  }
  return labels[t.stage] || t.stage
})

const runningPercent = computed(() => {
  return store.runningTask?.lastProgress?.percent ?? 0
})

const taskCount = computed(() => store.tasks.filter(t => t.project === props.projectName).length)

const allTasks = computed<TaskRecord[]>(() => {
  return store.tasks.filter(t => t.project === props.projectName).slice(0, 50)
})

// ── Cancel ─────────────────────────────────────────────────────────────

async function onCancel(taskId: string) {
  const result = await store.cancelTask(taskId)
  if (result) {
    message.success('任务已取消')
  }
}

// ── View log ───────────────────────────────────────────────────────────

async function onViewLog(taskId: string) {
  showLogModal.value = true
  logLoading.value = true
  logContent.value = ''
  try {
    const resp = await fetch(`/api/tasks/${taskId}/log`)
    if (resp.ok) {
      logContent.value = await resp.text()
    } else {
      logContent.value = '(无法加载日志)'
    }
  } catch {
    logContent.value = '(加载日志失败)'
  }
  logLoading.value = false
}
</script>

<style scoped>
.task-bar {
  flex-shrink: 0;
  border-top: 1px solid var(--n-border-color, #e0e0e6);
  background: var(--n-color, #fff);
}

.task-bar-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 16px;
  cursor: pointer;
  font-size: 13px;
  user-select: none;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 12px;
  flex: 1;
  min-width: 0;
}

.header-right {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.task-status {
  flex-shrink: 0;
}

.task-status--idle {
  color: #18a058;
}

.task-status--running {
  color: #2080f0;
}

.header-progress {
  flex: 1;
  min-width: 0;
  max-width: 300px;
}

.task-count {
  font-size: 11px;
  color: #999;
  background: #f0f0f0;
  border-radius: 8px;
  padding: 0 6px;
  min-width: 18px;
  text-align: center;
}

.collapse-icon {
  font-size: 10px;
  color: #999;
}

/* Expanded content */
.task-bar-content {
  padding: 4px 16px 10px;
  border-top: 1px solid var(--n-border-color, #e0e0e6);
  max-height: 280px;
  overflow-y: auto;
}

.task-bar-footer {
  padding-top: 4px;
  text-align: center;
}

/* Log modal */
.log-content {
  font-size: 12px;
  font-family: monospace;
  white-space: pre-wrap;
  word-break: break-all;
  max-height: 480px;
  overflow-y: auto;
  margin: 0;
  padding: 8px;
  background: #f5f5f5;
  border-radius: 4px;
}

.modal-task-list {
  max-height: 480px;
  overflow-y: auto;
}
</style>
