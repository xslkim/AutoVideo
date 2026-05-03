import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { apiGet, apiPost, apiDelete } from '../utils/api'
import { connectSSE } from '../utils/sse'
import type { TaskRecord, Stage, ProgressEvent } from '../../../server/types/api'

// ---------------------------------------------------------------------------
// Stage → Chinese label
// ---------------------------------------------------------------------------

const STAGE_LABEL: Record<Stage, string> = {
  compile: '编译',
  tts: '生成音频',
  visuals: '生成视觉',
  render: '渲染',
  build: '全量构建',
  merge: '合并视频',
}

export function getStageLabel(stage: Stage): string {
  return STAGE_LABEL[stage]
}

export function formatStage(stage: Stage, blockIds?: string[]): string {
  const label = getStageLabel(stage)
  if (blockIds && blockIds.length > 0) {
    return `${label} ${blockIds.join(', ')}`
  }
  return label
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useTaskStore = defineStore('tasks', () => {
  // ── State ──────────────────────────────────────────────────────────────

  const tasks = ref<TaskRecord[]>([])
  const projectName = ref('')
  const lastFetchProject = ref('')

  // Active SSE connections: taskId → { close, taskId }
  const sseMap = new Map<string, { close: () => void }>()

  // ── Getters ────────────────────────────────────────────────────────────

  /** Running or pending task (for the current project), if any */
  const activeTask = computed<TaskRecord | null>(() => {
    return tasks.value.find(
      t => t.project === projectName.value && (t.status === 'running' || t.status === 'pending' || t.status === 'cancelling'),
    ) ?? null
  })

  /** Running task only */
  const runningTask = computed<TaskRecord | null>(() => {
    return tasks.value.find(
      t => t.project === projectName.value && t.status === 'running',
    ) ?? null
  })

  /** Tasks for current project (max 20 for display) */
  const projectTasks = computed<TaskRecord[]>(() => {
    return tasks.value
      .filter(t => t.project === projectName.value)
      .slice(0, 20)
  })

  /** Check if a given stage already has a non-terminal task */
  function hasActiveStage(stage: Stage): boolean {
    return tasks.value.some(
      t =>
        t.project === projectName.value &&
        t.stage === stage &&
        (t.status === 'pending' || t.status === 'running' || t.status === 'cancelling'),
    )
  }

  // ── Actions ────────────────────────────────────────────────────────────

  /** Initialize store for a project — fetch tasks and subscribe running */
  async function initForProject(name: string) {
    // If switching projects, clean up old SSE
    if (projectName.value && projectName.value !== name) {
      closeAllSSE()
    }
    projectName.value = name
    await fetchTasks()
    subscribeRunningTasks()
  }

  /** Fetch tasks from server for current project */
  async function fetchTasks() {
    const url = projectName.value
      ? `/api/tasks?project=${encodeURIComponent(projectName.value)}`
      : '/api/tasks'
    const result = await apiGet<TaskRecord[]>(url, { silent: true })
    if (result.ok) {
      // Merge with existing tasks: preserve any in-memory progress for running tasks
      const newTasks = result.data
      const existingMap = new Map(tasks.value.map(t => [t.id, t]))

      // For running tasks from API, keep our in-memory progress if we were tracking it
      tasks.value = newTasks.map(t => {
        const existing = existingMap.get(t.id)
        if (
          existing &&
          t.status === 'running' &&
          existing.lastProgress &&
          (!t.lastProgress || (existing.lastProgress.percent > (t.lastProgress?.percent ?? 0)))
        ) {
          // Our in-memory copy has fresher progress from SSE
          return { ...t, lastProgress: existing.lastProgress }
        }
        return t
      })
      lastFetchProject.value = projectName.value
    }
  }

  /** Create a new task */
  async function createTask(
    project: string,
    stage: Stage,
    blockIds?: string[],
    force?: boolean,
  ): Promise<TaskRecord | null> {
    const result = await apiPost<TaskRecord>('/api/tasks', {
      project,
      stage,
      blockIds,
      force: force ?? false,
    })

    if (result.ok) {
      const task = result.data
      tasks.value.unshift(task)
      // Start SSE for this task if it's not already completed/failed
      if (task.status === 'pending' || task.status === 'running') {
        subscribeTask(task)
      }
      return task
    }
    return null
  }

  /** Cancel a task */
  async function cancelTask(id: string): Promise<TaskRecord | null> {
    const result = await apiDelete<TaskRecord>(`/api/tasks/${id}`)
    if (result.ok) {
      const updated = result.data
      updateTaskInList(updated)
      // SSE will handle the terminal event; if status is already terminal, close SSE
      if (updated.status === 'cancelled') {
        closeSSE(id)
      }
      return updated
    }
    return null
  }

  /** Fetch a single task detail */
  async function fetchTask(id: string): Promise<TaskRecord | null> {
    const result = await apiGet<TaskRecord>(`/api/tasks/${id}`, { silent: true })
    if (result.ok) {
      const task = result.data

      // Check if task is terminal — if so, close SSE
      if (task.status === 'completed' || task.status === 'failed' || task.status === 'cancelled') {
        closeSSE(id)
      }

      updateTaskInList(task)
      return task
    }
    return null
  }

  /** Subscribe to SSE for all running tasks */
  function subscribeRunningTasks() {
    for (const task of tasks.value) {
      if (
        task.project === projectName.value &&
        (task.status === 'running' || task.status === 'pending' || task.status === 'cancelling')
      ) {
        subscribeTask(task)
      }
    }
  }

  /** Subscribe to SSE for a single task */
  function subscribeTask(task: TaskRecord) {
    // Avoid duplicate subscriptions
    if (sseMap.has(task.id)) return
    // Don't subscribe to terminal tasks
    if (task.status === 'completed' || task.status === 'failed' || task.status === 'cancelled') return

    const { close } = connectSSE(
      task.id,
      {
        onProgress(event: ProgressEvent) {
          const t = findTask(task.id)
          if (t) {
            t.lastProgress = event
            // The task might have transitioned from pending to running
            if (t.status === 'pending') t.status = 'running'
          }
        },
        onDone(data: { status: string; durationMs: number }) {
          const t = findTask(task.id)
          if (t) {
            t.status = 'completed'
            t.durationMs = data.durationMs
            t.finishedAt = Date.now()
            t.lastProgress = { percent: 100, step: '完成', stage: t.stage }
          }
          closeSSE(task.id)
        },
        onError(data: { message: string; code: string; stage: string }) {
          const t = findTask(task.id)
          if (t) {
            t.status = 'failed'
            t.errorMessage = data.message
            t.errorCode = data.code
            t.finishedAt = Date.now()
          }
          closeSSE(task.id)
        },
        onCancelled(data: { durationMs: number }) {
          const t = findTask(task.id)
          if (t) {
            t.status = 'cancelled'
            t.durationMs = data.durationMs
            t.finishedAt = Date.now()
          }
          closeSSE(task.id)
        },
      },
      // Before reconnect: sync latest task state from API
      async () => {
        await fetchTask(task.id)
      },
    )

    sseMap.set(task.id, { close })
  }

  /** Close a single SSE connection */
  function closeSSE(taskId: string) {
    const entry = sseMap.get(taskId)
    if (entry) {
      entry.close()
      sseMap.delete(taskId)
    }
  }

  /** Close all SSE connections */
  function closeAllSSE() {
    for (const [, entry] of sseMap) {
      entry.close()
    }
    sseMap.clear()
    tasks.value = []
  }

  // ── Internal helpers ──────────────────────────────────────────────────

  function findTask(id: string): TaskRecord | null {
    return tasks.value.find(t => t.id === id) ?? null
  }

  function updateTaskInList(updated: TaskRecord) {
    const idx = tasks.value.findIndex(t => t.id === updated.id)
    if (idx !== -1) {
      tasks.value[idx] = updated
    } else {
      tasks.value.unshift(updated)
    }
  }

  // ── Public API ────────────────────────────────────────────────────────

  return {
    // state
    tasks,
    projectName,
    // getters
    activeTask,
    runningTask,
    projectTasks,
    // action helpers
    hasActiveStage,
    // actions
    initForProject,
    fetchTasks,
    createTask,
    cancelTask,
    fetchTask,
    subscribeRunningTasks,
    closeSSE,
    closeAllSSE,
  }
})
