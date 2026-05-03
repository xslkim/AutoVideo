<template>
  <div class="block-outputs">
    <!-- ═══════════════════════════════════════════════════════════════ -->
    <!-- ① Audio (WAV)                                                 -->
    <!-- ═══════════════════════════════════════════════════════════════ -->
    <div class="output-section">
      <div class="section-label">音频</div>
      <div v-if="audioExists" class="output-body">
        <audio
          ref="audioEl"
          controls
          preload="metadata"
          :src="audioUrl"
          class="audio-player"
          @loadedmetadata="onAudioMeta"
          @error="onAudioError"
        />
        <span v-if="audioDurationSec > 0" class="meta-duration">
          {{ formatDuration(audioDurationSec) }}
        </span>
      </div>
      <div v-else class="output-empty">
        <span class="empty-text">未生成</span>
        <n-button size="tiny" quaternary @click="onBlockAction('audio', 'tts')">
          生成音频
        </n-button>
      </div>
    </div>

    <!-- ═══════════════════════════════════════════════════════════════ -->
    <!-- ② Visual (mode-dependent)                                     -->
    <!-- ═══════════════════════════════════════════════════════════════ -->
    <div class="output-section">
      <div class="section-label">视觉</div>

      <!-- ── Animation mode ───────────────────────────────────────── -->
      <template v-if="visualMode === 'animation'">
        <div v-if="componentContent !== null" class="output-body">
          <!-- Component.tsx read-only -->
          <div class="component-header">
            <span class="component-label">Component.tsx</span>
            <n-button size="tiny" text @click="copyComponent">复制全文</n-button>
          </div>
          <div ref="cmEl" class="cm-readonly" />

          <!-- Frame preview -->
          <div class="frame-preview">
            <div class="frame-controls">
              <span class="frame-label">帧预览</span>
              <input
                type="range"
                class="frame-slider"
                :min="0"
                :max="maxFrame"
                :value="currentFrame"
                @input="onFrameInput"
                @mouseup="onFrameMouseUp"
                @touchend="onFrameMouseUp"
              />
              <span class="frame-number">帧 {{ currentFrame }}</span>
            </div>
            <div class="frame-display" :class="{ loading: frameLoading }">
              <div v-if="frameSrc" class="frame-img-wrap">
                <img
                  :src="frameSrc"
                  class="frame-img"
                  :class="{ dimmed: frameLoading }"
                />
                <n-spin v-if="frameLoading" size="medium" class="frame-spinner" />
              </div>
              <span v-else-if="!frameLoading" class="frame-empty">
                拖动滑块预览帧
              </span>
              <n-spin v-if="frameLoading && !frameSrc" size="medium" />
            </div>
            <div v-if="frameError" class="frame-error">{{ frameError }}</div>
          </div>
        </div>
        <div v-else class="output-empty">
          <span class="empty-text">未生成</span>
          <n-button size="tiny" quaternary @click="onBlockAction('visual', 'visuals')">
            生成视觉
          </n-button>
        </div>
      </template>

      <!-- ── Image mode ────────────────────────────────────────────── -->
      <template v-else>
        <div v-if="imageExists" class="output-body">
          <img
            :src="imageUrl"
            class="preview-image"
            @load="onImageLoad"
            @error="onImageError"
            @click="showImageModal = true"
            title="点击查看原图"
          />
          <div v-if="imageWidth > 0" class="image-info">
            <span>{{ imageWidth }} × {{ imageHeight }}</span>
          </div>
          <div class="image-actions">
            <n-button size="tiny" text @click="showImageModal = true">查看大图</n-button>
            <n-button size="tiny" text @click="copyImagePath">显示路径</n-button>
            <n-button size="tiny" text @click="downloadImage">下载</n-button>
          </div>
        </div>
        <div v-else class="output-empty">
          <span class="empty-text">未生成</span>
          <n-button size="tiny" quaternary @click="onBlockAction('visual', 'visuals')">
            生成图片
          </n-button>
        </div>
        <!-- Image lightbox modal -->
        <n-modal
          v-model:show="showImageModal"
          preset="card"
          title="图片预览"
          style="max-width: 95vw; max-height: 95vh"
          :segmented="true"
        >
          <img :src="imageUrl" class="lightbox-image" />
        </n-modal>
      </template>
    </div>

    <!-- ═══════════════════════════════════════════════════════════════ -->
    <!-- ③ Partial video (MP4)                                         -->
    <!-- ═══════════════════════════════════════════════════════════════ -->
    <div class="output-section">
      <div class="section-label">分段视频</div>
      <div v-if="videoExists" class="output-body">
        <video
          controls
          preload="metadata"
          :src="videoUrl"
          class="video-player"
          @error="onVideoError"
        />
      </div>
      <div v-else class="output-empty">
        <span class="empty-text">未生成</span>
        <n-button size="tiny" quaternary @click="onBlockAction('render', 'render')">
          渲染分段
        </n-button>
      </div>
    </div>

    <!-- ═══════════════════════════════════════════════════════════════ -->
    <!-- ④ Single-block action buttons                                 -->
    <!-- ═══════════════════════════════════════════════════════════════ -->
    <div class="output-actions">
      <div class="actions-title">单块操作</div>
      <n-space vertical size="small">
        <n-dropdown trigger="click" :options="audioMenuOpts" @select="(k: string) => onBlockAction(k, 'tts')">
          <n-button size="small" block :disabled="taskStore.hasActiveStage('tts')" :loading="actionLoading === 'tts'">
            生成音频
          </n-button>
        </n-dropdown>

        <n-dropdown trigger="click" :options="visualMenuOpts" @select="(k: string) => onBlockAction(k, 'visuals')">
          <n-button size="small" block :disabled="taskStore.hasActiveStage('visuals')" :loading="actionLoading === 'visuals'">
            {{ visualMode === 'image' ? '生成图片' : '生成视觉' }}
          </n-button>
        </n-dropdown>

        <n-dropdown trigger="click" :options="renderMenuOpts" @select="(k: string) => onBlockAction(k, 'render')">
          <n-button size="small" block :disabled="taskStore.hasActiveStage('render')" :loading="actionLoading === 'render'">
            渲染分段
          </n-button>
        </n-dropdown>

        <n-dropdown trigger="click" :options="compileMenuOpts" @select="(k: string) => onBlockAction(k, 'compile')">
          <n-button size="small" block :disabled="taskStore.hasActiveStage('compile') || taskStore.hasActiveStage('build')" :loading="actionLoading === 'compile'">
            重新编译
          </n-button>
        </n-dropdown>
      </n-space>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted, computed, nextTick } from 'vue'
import { NButton, NSpin, NSpace, NDropdown, NModal, createDiscreteApi } from 'naive-ui'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { javascript } from '@codemirror/lang-javascript'
import { oneDark } from '@codemirror/theme-one-dark'
import { useTaskStore } from '../../stores/taskStore'
import { apiPost } from '../../utils/api'
import type { Stage, CacheClearKind } from '../../../../server/types/api'

const { message } = createDiscreteApi(['message'])
const taskStore = useTaskStore()

// ── Props / Emits ─────────────────────────────────────────────────────────

const props = defineProps<{
  projectName: string
  blockId: string
  visualMode: 'animation' | 'image'
}>()

// No emits needed — component handles all task creation internally

// ── URLs ──────────────────────────────────────────────────────────────────

const base = computed(() => `/api/projects/${props.projectName}/blocks/${props.blockId}`)
const audioUrl   = computed(() => `${base.value}/audio`)
const componentUrl = computed(() => `${base.value}/component`)
const imageUrl   = computed(() => `${base.value}/image`)
const videoUrl   = computed(() => `${base.value}/video`)
const previewUrl = computed(() => `${base.value}/preview`)

// ── ① Audio ──────────────────────────────────────────────────────────────

const audioEl = ref<HTMLAudioElement | null>(null)
const audioExists = ref(true)
const audioDurationSec = ref(0)

function onAudioMeta() {
  if (audioEl.value) {
    audioDurationSec.value = audioEl.value.duration
    // Update maxFrame if we have audio duration and fps
    if (audioDurationSec.value > 0) {
      updateMaxFrame()
    }
  }
}

function onAudioError() {
  audioExists.value = false
}

function formatDuration(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

// ── ② Visual: Animation mode ─────────────────────────────────────────────

const cmEl = ref<HTMLDivElement | null>(null)
const componentContent = ref<string | null | undefined>(undefined) // undefined=not checked, null=fetched but missing, string=available
let cmView: EditorView | null = null

const currentFrame = ref(0)
const maxFrame = ref(299) // default ~10s @ 30fps
const frameSrc = ref('')
const frameLoading = ref(false)
const frameError = ref('')
let frameAbort: AbortController | null = null
let frameTimer: ReturnType<typeof setTimeout> | null = null

function updateMaxFrame() {
  // Use audio duration as hint; cap at a reasonable range
  if (audioDurationSec.value > 0) {
    const fps = 30
    const frames = Math.round(audioDurationSec.value * fps) - 1
    maxFrame.value = Math.max(29, Math.min(frames, 1200))
  }
}

async function fetchComponent() {
  try {
    const resp = await fetch(componentUrl.value)
    if (resp.ok) {
      componentContent.value = await resp.text()
      await nextTick()
      mountComponentEditor()
    } else {
      componentContent.value = null
    }
  } catch {
    componentContent.value = null
  }
}

function mountComponentEditor() {
  if (!cmEl.value || componentContent.value === null) return
  if (cmView) { cmView.destroy(); cmView = null }

  cmView = new EditorView({
    state: EditorState.create({
      doc: componentContent.value,
      extensions: [
        javascript({ typescript: true }),
        EditorState.readOnly.of(true),
        EditorView.editable.of(false),
        EditorView.theme({
          '&': { height: '100%' },
          '.cm-scroller': { overflow: 'auto', fontFamily: 'monospace', fontSize: '11px' },
        }),
        ...(prefersDark() ? [oneDark] : []),
      ],
    }),
    parent: cmEl.value,
  })
}

function prefersDark(): boolean {
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

function copyComponent() {
  if (componentContent.value) {
    navigator.clipboard.writeText(componentContent.value)
    message.success('已复制到剪贴板', { duration: 1500 })
  }
}

// Frame preview
function onFrameInput(e: Event) {
  const target = e.target as HTMLInputElement
  currentFrame.value = parseInt(target.value, 10)
  frameError.value = ''
}

function onFrameMouseUp() {
  // Debounce 300ms
  if (frameTimer) clearTimeout(frameTimer)
  frameTimer = setTimeout(() => {
    fetchFrame(currentFrame.value)
  }, 300)
}

async function fetchFrame(frame: number) {
  // Abort previous in-flight request
  if (frameAbort) {
    frameAbort.abort()
    frameAbort = null
  }

  frameLoading.value = true
  frameError.value = ''

  const ctrl = new AbortController()
  frameAbort = ctrl

  try {
    const resp = await fetch(`${previewUrl.value}?frame=${frame}`, { signal: ctrl.signal })

    if (resp.status === 422) {
      // Frame out of range
      try {
        const err = await resp.json() as { error?: { message?: string } }
        frameError.value = err.error?.message ?? '帧超出范围'
      } catch {
        frameError.value = '帧超出范围'
      }
      return
    }

    if (!resp.ok) {
      frameError.value = `请求失败 (${resp.status})`
      return
    }

    const blob = await resp.blob()
    // Revoke old URL to avoid memory leaks
    if (frameSrc.value) URL.revokeObjectURL(frameSrc.value)
    frameSrc.value = URL.createObjectURL(blob)
  } catch (err: any) {
    if (err.name === 'AbortError') return // expected on re-trigger
    frameError.value = err.message ?? '加载帧失败'
  } finally {
    if (frameAbort === ctrl) {
      frameAbort = null
    }
    frameLoading.value = false
  }
}

// ── ② Visual: Image mode ─────────────────────────────────────────────────

const imageExists = ref(true)
const showImageModal = ref(false)
const imageWidth = ref(0)
const imageHeight = ref(0)

function onImageLoad(e: Event) {
  const img = e.target as HTMLImageElement
  imageWidth.value = img.naturalWidth
  imageHeight.value = img.naturalHeight
}

function onImageError() {
  imageExists.value = false
}

function openImage() {
  showImageModal.value = true
}

function copyImagePath() {
  navigator.clipboard.writeText(imageUrl.value)
  message.success('图片路径已复制到剪贴板', { duration: 1500 })
}

function downloadImage() {
  window.open(`${imageUrl.value}?download=1`, '_blank')
}

// ── ③ Video ──────────────────────────────────────────────────────────────

const videoExists = ref(true)

function onVideoError() {
  videoExists.value = false
}

// ── ④ Action buttons ─────────────────────────────────────────────────────

const actionLoading = ref<string | null>(null)

function makeMenuOpts(label: string) {
  return [
    { key: `${label}-force`, label: '强制重跑（忽略缓存）' },
    { key: `${label}-clear-cache`, label: `清${label === 'audio' ? '音频' : label === 'visual' ? '视觉' : label === 'render' ? '渲染' : ''}缓存` },
  ]
}

const audioMenuOpts   = computed(() => makeMenuOpts('audio'))
const visualMenuOpts  = computed(() => makeMenuOpts('visual'))
const renderMenuOpts  = computed(() => makeMenuOpts('render'))
const compileMenuOpts = computed(() => [
  { key: 'compile-force', label: '强制重跑（忽略缓存）' },
  { key: 'compile-clear-cache', label: '清编译缓存' },
])

async function onBlockAction(key: string, stage: Stage) {
  // Handle cache clear actions
  if (key.endsWith('-clear-cache')) {
    await onCacheClear(key.replace('-clear-cache', '') as 'audio' | 'visual' | 'render' | 'compile')
    return
  }

  const force = key.includes('-force')
  actionLoading.value = stage

  const blockIds = stage === 'compile' ? undefined : [props.blockId]
  const task = await taskStore.createTask(props.projectName, stage, blockIds, force)
  actionLoading.value = null

  if (task) {
    const labels: Record<string, string> = {
      tts: '生成音频',
      visuals: '生成视觉',
      render: '渲染',
      compile: '编译',
    }
    message.success(`${labels[stage] || stage}任务已提交`)
  }
}

async function onCacheClear(scope: 'audio' | 'visual' | 'render' | 'compile') {
  const kindMap: Record<string, CacheClearKind> = {
    audio: 'audio',
    visual: 'visual',
    render: 'partial',
    compile: 'all',
  }
  const kind = kindMap[scope] as CacheClearKind
  if (!kind) return

  actionLoading.value = scope === 'render' ? 'render' : scope === 'audio' ? 'tts' : 'visuals'
  const result = await apiPost<{ ok: boolean }>(
    `/api/projects/${props.projectName}/blocks/${props.blockId}/cache/clear`,
    { kind },
    { silent: true },
  )
  actionLoading.value = null

  if (result.ok) {
    message.success(`已清除${scope === 'audio' ? '音频' : scope === 'visual' ? '视觉' : scope === 'render' ? '渲染' : '编译'}缓存`)
    refreshAll()
  }
}

// ── Auto-refresh on task completion ──────────────────────────────────────

let lastCompletedId = ''

watch(
  () => taskStore.tasks,
  () => {
    // Check if any task for this block just completed
    for (const task of taskStore.tasks) {
      if (
        task.project === props.projectName &&
        task.status === 'completed' &&
        task.id !== lastCompletedId
      ) {
        const blockIds = task.blockIds ?? []
        // If it's a compile task, refresh everything
        if (task.stage === 'compile' || task.stage === 'build') {
          lastCompletedId = task.id
          refreshAll()
          return
        }
        // If it targets this block (or is project-wide and affects this block)
        if (blockIds.length === 0 || blockIds.includes(props.blockId)) {
          lastCompletedId = task.id
          refreshForStage(task.stage)
        }
      }
    }
  },
  { deep: true },
)

function refreshForStage(stage: Stage) {
  switch (stage) {
    case 'tts':
      audioExists.value = true
      break
    case 'visuals':
      if (props.visualMode === 'animation') {
        if (componentContent.value === null) fetchComponent()
      } else {
        imageExists.value = true
      }
      break
    case 'render':
      videoExists.value = true
      break
    case 'compile':
    case 'build':
      refreshAll()
      break
  }
}

function refreshAll() {
  audioExists.value = true
  if (props.visualMode === 'animation') {
    componentContent.value = undefined
  } else {
    imageExists.value = true
  }
  videoExists.value = true
  if (componentContent.value === undefined) {
    fetchComponent()
  }
}

// ── Lifecycle ─────────────────────────────────────────────────────────────

let darkMQ: MediaQueryList | null = null

function handleColorSchemeChange() {
  if (cmView && componentContent.value !== null) {
    mountComponentEditor()
  }
}

onMounted(() => {
  // Check audio/video/image existence — just set flags, elements handle errors
  // Fetch Component.tsx for animation mode
  if (props.visualMode === 'animation') {
    fetchComponent()
  }

  darkMQ = window.matchMedia('(prefers-color-scheme: dark)')
  darkMQ.addEventListener('change', handleColorSchemeChange)
})

onUnmounted(() => {
  if (cmView) { cmView.destroy(); cmView = null }
  if (frameAbort) { frameAbort.abort(); frameAbort = null }
  if (frameTimer) clearTimeout(frameTimer)
  if (frameSrc.value) URL.revokeObjectURL(frameSrc.value)
  darkMQ?.removeEventListener('change', handleColorSchemeChange)
})

// Re-fetch when block/project changes (already handled by key on parent, but be safe)
watch(
  () => `${props.projectName}/${props.blockId}`,
  () => {
    if (cmView) { cmView.destroy(); cmView = null }
    if (frameAbort) { frameAbort.abort(); frameAbort = null }
    if (frameSrc.value) { URL.revokeObjectURL(frameSrc.value); frameSrc.value = '' }
    audioExists.value = true
    audioDurationSec.value = 0
    componentContent.value = undefined
    imageExists.value = true
    imageWidth.value = 0
    imageHeight.value = 0
    showImageModal.value = false
    videoExists.value = true
    frameError.value = ''
    currentFrame.value = 0
    lastCompletedId = ''

    if (props.visualMode === 'animation') {
      fetchComponent()
    }
  },
)

// Re-fetch component when visualMode changes
watch(
  () => props.visualMode,
  (mode) => {
    if (mode === 'animation' && componentContent.value === (undefined as unknown as null)) {
      fetchComponent()
    }
  },
)
</script>

<style scoped>
.block-outputs {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow-y: auto;
  gap: 0;
}

/* ── Section ─────────────────────────────────────────────────────────── */

.output-section {
  border-bottom: 1px solid var(--n-border-color, #eee);
}

.section-label {
  font-size: 10px;
  font-weight: 700;
  color: #999;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  padding: 6px 10px 2px;
}

.output-body {
  padding: 6px 10px 10px;
}

.output-empty {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 10px;
}

.empty-text {
  font-size: 12px;
  color: #aaa;
}

/* ── Audio ───────────────────────────────────────────────────────────── */

.audio-player {
  width: 100%;
  height: 28px;
}

.meta-duration {
  font-size: 10px;
  color: #999;
  margin-top: 2px;
  display: inline-block;
}

/* ── Component.tsx ───────────────────────────────────────────────────── */

.component-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 4px;
}

.component-label {
  font-size: 11px;
  font-weight: 600;
  color: #666;
}

.cm-readonly {
  height: 80px;
  border: 1px solid var(--n-border-color, #e0e0e6);
  border-radius: 4px;
  overflow: hidden;
}

/* ── Frame preview ───────────────────────────────────────────────────── */

.frame-preview {
  margin-top: 8px;
}

.frame-controls {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 4px;
}

.frame-label {
  font-size: 11px;
  color: #666;
  white-space: nowrap;
}

.frame-slider {
  flex: 1;
  height: 4px;
  cursor: pointer;
}

.frame-number {
  font-size: 10px;
  color: #999;
  font-variant-numeric: tabular-nums;
  min-width: 36px;
  text-align: right;
}

.frame-display {
  position: relative;
  min-height: 80px;
  background: var(--n-color-embedded, #f5f5f5);
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.frame-img-wrap {
  position: relative;
  width: 100%;
  height: 100%;
}

.frame-img {
  width: 100%;
  max-height: 180px;
  object-fit: contain;
  display: block;
  border-radius: 4px;
}

.frame-img.dimmed {
  opacity: 0.4;
}

.frame-spinner {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
}

.frame-empty {
  font-size: 11px;
  color: #aaa;
}

.frame-error {
  font-size: 10px;
  color: #d03050;
  margin-top: 4px;
  padding: 0 2px;
}

/* ── Image mode ──────────────────────────────────────────────────────── */

.preview-image {
  width: 100%;
  max-height: 200px;
  object-fit: contain;
  border-radius: 4px;
  display: block;
  cursor: pointer;
}

.preview-image:hover {
  opacity: 0.85;
}

.image-info {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 4px;
  font-size: 10px;
  color: #999;
}

.image-actions {
  display: flex;
  gap: 8px;
  margin-top: 4px;
  justify-content: flex-end;
}

.lightbox-image {
  width: 100%;
  max-height: 80vh;
  object-fit: contain;
  display: block;
}

/* ── Video ───────────────────────────────────────────────────────────── */

.video-player {
  width: 100%;
  max-height: 180px;
}

/* ── Action buttons ──────────────────────────────────────────────────── */

.output-actions {
  flex-shrink: 0;
  padding: 10px 12px;
  border-top: 1px solid var(--n-border-color, #e0e0e6);
}

.actions-title {
  font-size: 10px;
  font-weight: 700;
  color: #999;
  margin-bottom: 6px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}
</style>
