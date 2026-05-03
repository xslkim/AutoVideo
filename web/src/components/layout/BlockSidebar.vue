<template>
  <div class="block-sidebar">
    <!-- Header: title + add button -->
    <div class="sidebar-header">
      <span>块列表</span>
      <n-button size="tiny" :loading="addingBlock" :disabled="disabled" @click="addBlock">
        + 新建块
      </n-button>
    </div>

    <!-- Batch operations bar -->
    <div v-if="checkedIds.size > 0" class="batch-bar">
      <span class="batch-count">已选 {{ checkedIds.size }} 项</span>
      <div class="batch-row">
        <n-button
          size="tiny"
          :disabled="disabled || taskStore.hasActiveStage('tts') || batchLoading === 'tts'"
          :loading="batchLoading === 'tts'"
          @click="batchCreate('tts')"
        >批量音频</n-button>
        <n-button
          size="tiny"
          :disabled="disabled || taskStore.hasActiveStage('visuals') || batchLoading === 'visuals'"
          :loading="batchLoading === 'visuals'"
          @click="batchCreate('visuals')"
        >批量视觉</n-button>
        <n-button
          size="tiny"
          :disabled="disabled || taskStore.hasActiveStage('render') || batchLoading === 'render'"
          :loading="batchLoading === 'render'"
          @click="batchCreate('render')"
        >批量渲染</n-button>
        <n-button
          size="tiny"
          :disabled="disabled || batchLoading === 'clear'"
          :loading="batchLoading === 'clear'"
          @click="batchClearCache"
        >批量清缓存</n-button>
        <n-button size="tiny" quaternary :type="batchForce ? 'primary' : 'default'" @click="batchForce = !batchForce">
          强制{{ batchForce ? ' ✓' : '' }}
        </n-button>
        <n-button size="tiny" @click="clearSelection">取消选择</n-button>
      </div>
    </div>

    <!-- Warnings -->
    <div v-if="displayWarnings.length > 0" class="sidebar-warnings">
      <div
        v-for="w in displayWarnings"
        :key="w.line"
        class="warning-item"
      >
        ⚠ 行 {{ w.line }}: {{ w.message }}
      </div>
    </div>

    <!-- Loading -->
    <div v-if="loading" class="sidebar-loading">
      <n-spin size="small" />
    </div>

    <!-- Block list -->
    <div v-else class="sidebar-content">
      <div
        v-for="block in displayBlocks"
        :key="block.id"
        class="block-item"
        :class="{ 'block-item--selected': selectedId === block.id }"
        @click="selectBlock(block.id)"
      >
        <n-checkbox
          :checked="checkedIds.has(block.id)"
          @click.stop
          @update:checked="(val: boolean) => toggleCheck(block.id, val)"
          size="small"
        />
        <span class="block-info">
          <span class="block-id">{{ block.id }}</span>
          <span class="block-title">{{ block.title || '(无标题)' }}</span>
        </span>
        <span class="block-status">
          <span class="badge" :class="{ 'badge--on': block.audio }" title="音频">🎙</span>
          <span class="badge" :class="{ 'badge--on': block.visual }" :title="block.visualMode === 'image' ? '图片' : '视觉'">
            {{ block.visualMode === 'image' ? '🖼' : '🎨' }}
          </span>
          <span class="badge" :class="{ 'badge--on': block.rendered }" title="已渲染">🎬</span>
        </span>
      </div>

      <n-empty v-if="displayBlocks.length === 0 && !loading" description="暂无块" size="small" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, nextTick } from 'vue'
import { NButton, NCheckbox, NSpin, NSpace, NEmpty, createDiscreteApi } from 'naive-ui'
import { apiGet, apiPut, apiPost, getEtag, setEtag } from '../../utils/api'
import { parseScript, type ParseResult, type ParsedBlock } from '../../utils/scriptParser'
import { useTaskStore } from '../../stores/taskStore'
import type { BlockStatus, Stage, CacheClearKind } from '../../../../server/types/api'

const { message } = createDiscreteApi(['message'])
const taskStore = useTaskStore()

// ---------------------------------------------------------------------------
// Props / Emits
// ---------------------------------------------------------------------------

const props = defineProps<{
  projectName: string
  parsedBlocks: ParseResult | null
  disabled?: boolean
}>()

const emit = defineEmits<{
  (e: 'block-selected', id: string): void
  (e: 'script-changed'): void
}>()

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const loading       = ref(true)
const addingBlock   = ref(false)
const selectedId    = ref<string | null>(null)
const checkedIds    = ref<Set<string>>(new Set())

// API status data (audio/visual/rendered booleans) — merged with parser data
const apiBlocks     = ref<BlockStatus[]>([])

// ---------------------------------------------------------------------------
// Derived: merge parser structure with API status
// ---------------------------------------------------------------------------

interface DisplayBlock {
  id: string
  title: string
  line: number
  visualMode: 'animation' | 'image'
  audio: boolean
  visual: boolean
  rendered: boolean
}

const displayBlocks = computed<DisplayBlock[]>(() => {
  if (!props.parsedBlocks) {
    // Before parser emits, use API data directly
    return apiBlocks.value.map(b => ({
      id: b.id,
      title: b.title,
      line: b.line,
      visualMode: b.visualMode,
      audio: b.audio,
      visual: b.visual,
      rendered: b.rendered,
    }))
  }

  // Build a lookup from API blocks for status
  const statusMap = new Map<string, BlockStatus>()
  for (const b of apiBlocks.value) {
    statusMap.set(b.id, b)
  }

  return props.parsedBlocks.blocks.map(pb => {
    const status = statusMap.get(pb.id)
    return {
      id: pb.id,
      title: pb.title,
      line: pb.line,
      visualMode: pb.visualMode,
      audio: status?.audio ?? false,
      visual: status?.visual ?? false,
      rendered: status?.rendered ?? false,
    }
  })
})

const displayWarnings = computed(() => {
  if (!props.parsedBlocks) return []
  return props.parsedBlocks.warnings
})

// ---------------------------------------------------------------------------
// Fetch API blocks (initial status)
// ---------------------------------------------------------------------------

async function fetchBlocks() {
  loading.value = true
  const result = await apiGet<{ blocks: BlockStatus[]; warnings: { line: number; message: string }[]; currentSlug: string }>(
    `/api/projects/${props.projectName}/blocks`,
    { silent: true },
  )
  if (result.ok) {
    apiBlocks.value = result.data.blocks
  }
  loading.value = false
}

// ---------------------------------------------------------------------------
// Selection
// ---------------------------------------------------------------------------

function toggleCheck(id: string, checked: boolean) {
  const next = new Set(checkedIds.value)
  if (checked) {
    next.add(id)
  } else {
    next.delete(id)
  }
  checkedIds.value = next
}

function clearSelection() {
  checkedIds.value = new Set()
}

// ---------------------------------------------------------------------------
// Batch operations
// ---------------------------------------------------------------------------

const batchForce = ref(false)
const batchLoading = ref<string | null>(null)

const checkedIdsArray = computed(() => Array.from(checkedIds.value))

async function batchCreate(stage: Stage) {
  if (checkedIdsArray.value.length === 0) return

  batchLoading.value = stage
  const task = await taskStore.createTask(
    props.projectName,
    stage,
    checkedIdsArray.value,
    batchForce.value,
  )
  batchLoading.value = null

  if (task) {
    const labels: Record<string, string> = {
      tts: '批量生成音频',
      visuals: '批量生成视觉',
      render: '批量渲染',
    }
    message.success(`${labels[stage] || stage}任务已提交`)
    clearSelection()
    batchForce.value = false
  }
}

async function batchClearCache() {
  if (checkedIdsArray.value.length === 0) return

  batchLoading.value = 'clear'
  let success = 0
  let fail = 0

  for (const id of checkedIdsArray.value) {
    const result = await apiPost<{ ok: boolean }>(
      `/api/projects/${props.projectName}/blocks/${id}/cache/clear`,
      { kind: 'all' },
      { silent: true },
    )
    if (result.ok) {
      success++
    } else {
      fail++
    }
  }

  batchLoading.value = null

  if (fail === 0) {
    message.success(`已清除 ${success} 个块的缓存`)
  } else {
    message.warning(`清除完成：${success} 成功，${fail} 失败`)
  }

  // Refresh block status
  clearSelection()
  batchForce.value = false
  await fetchBlocks()
}

// ---------------------------------------------------------------------------
// Select block → emit
// ---------------------------------------------------------------------------

function selectBlock(id: string) {
  if (selectedId.value === id) {
    selectedId.value = null
    emit('block-selected', '')
  } else {
    selectedId.value = id
    emit('block-selected', id)
  }
}

// ---------------------------------------------------------------------------
// Add new block
// ---------------------------------------------------------------------------

function nextBlockId(existingIds: string[]): string {
  let max = 0
  for (const id of existingIds) {
    const m = id.match(/^B(\d+)$/)
    if (m) {
      const n = parseInt(m[1], 10)
      if (n > max) max = n
    }
  }
  return `B${String(max + 1).padStart(2, '0')}`
}

async function addBlock() {
  addingBlock.value = true

  try {
    const scriptUrl = `/api/projects/${props.projectName}/script`
    const result = await apiGet<{ content: string }>(scriptUrl, { silent: true })
    if (!result.ok) {
      message.error('无法读取 script.md')
      return
    }

    const content = result.data.content
    const parsed = parseScript(content)
    const newId = nextBlockId(parsed.blocks.map(b => b.id))

    const template = [
      `>>> 新块标题 #${newId}`,
      '@visual: animation',
      '',
      '--- narration ---',
      '新旁白内容',
      '',
      '--- visual ---',
      '新视觉描述',
      '',
    ].join('\n')

    const newContent = content.endsWith('\n') ? content + template : content + '\n' + template

    const etag = getEtag(scriptUrl)
    const putResult = await apiPut<{ ok: boolean; etag: string }>(
      scriptUrl,
      { content: newContent },
      etag,
    )

    if (putResult.ok) {
      if (putResult.data.etag) setEtag(scriptUrl, putResult.data.etag)
      message.success(`已添加块 ${newId}`, { duration: 1500 })
      emit('script-changed')
    } else if (putResult.conflict) {
      message.error('保存冲突，请先刷新页面重试')
    }
  } finally {
    addingBlock.value = false
  }
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

onMounted(() => {
  fetchBlocks()
})

// When project changes, re-fetch API blocks
watch(
  () => props.projectName,
  () => {
    selectedId.value = null
    checkedIds.value = new Set()
    fetchBlocks()
  },
)
</script>

<style scoped>
.block-sidebar {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}

/* Header */
.sidebar-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px;
  font-size: 13px;
  font-weight: 600;
  color: #666;
  border-bottom: 1px solid var(--n-border-color, #e0e0e6);
  flex-shrink: 0;
}

/* Batch bar */
.batch-bar {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--n-border-color, #e0e0e6);
  background: var(--n-color-embedded, #f8f8fa);
  flex-shrink: 0;
}

.batch-count {
  font-size: 12px;
  color: #666;
  font-weight: 500;
}

.batch-row {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  align-items: center;
}

/* Warnings */
.sidebar-warnings {
  flex-shrink: 0;
  border-bottom: 1px solid var(--n-border-color, #e0e0e6);
}

.warning-item {
  font-size: 11px;
  color: #e6a23c;
  padding: 6px 12px;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
}

/* Loading */
.sidebar-loading {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
}

/* Block list */
.sidebar-content {
  flex: 1;
  overflow-y: auto;
  padding: 4px 0;
}

.block-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  cursor: pointer;
  transition: background 0.15s;
  min-height: 36px;
}

.block-item:hover {
  background: var(--n-color-hover, rgba(0, 0, 0, 0.04));
}

.block-item--selected {
  background: var(--n-color-selected, rgba(51, 102, 255, 0.08));
}

.block-info {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 4px;
  overflow: hidden;
}

.block-id {
  font-size: 12px;
  font-weight: 600;
  color: var(--n-text-color, #333);
  flex-shrink: 0;
}

.block-title {
  font-size: 12px;
  color: var(--n-text-color-2, #666);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.block-status {
  display: flex;
  gap: 2px;
  flex-shrink: 0;
}

.badge {
  font-size: 11px;
  opacity: 0.3;
  filter: grayscale(1);
  transition: opacity 0.2s, filter 0.2s;
}

.badge--on {
  opacity: 1;
  filter: none;
}
</style>
