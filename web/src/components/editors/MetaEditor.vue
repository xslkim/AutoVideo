<template>
  <div class="meta-editor">
    <!-- Avatar upload section -->
    <div class="avatar-section">
      <div class="avatar-header">
        <span class="avatar-label">口型同步 Avatar</span>
        <n-button
          v-if="avatarExists"
          size="tiny"
          type="error"
          :loading="avatarDeleting"
          @click="deleteAvatar"
        >
          删除
        </n-button>
      </div>
      <div class="avatar-body">
        <div v-if="avatarExists || hasAvatarRef" class="lipsync-toggle">
          <n-switch
            v-model:value="lipsyncEnabled"
            size="small"
            :disabled="disabled || (!avatarExists && !hasAvatarRef)"
            @update:value="onLipsyncToggle"
          />
          <span class="lipsync-label">
            {{ lipsyncEnabled ? '口型同步（MuseTalk）' : '仅循环头像（无口型）' }}
          </span>
          <span v-if="isDirty" class="dirty-hint">请先保存 meta.md</span>
        </div>
        <div v-if="avatarExists || hasAvatarRef" class="avatar-radius-row">
          <span class="radius-label">画中画圆角</span>
          <n-select
            v-model:value="avatarRadius"
            :options="avatarRadiusOptions"
            size="small"
            style="width: 88px"
            :disabled="disabled"
            @update:value="onAvatarRadiusChange"
          />
          <span class="radius-unit">px</span>
        </div>
        <div v-if="avatarExists" class="avatar-preview-row">
          <div class="avatar-preview">
            <video
              :src="`/api/projects/${projectName}/avatar`"
              class="avatar-video"
              muted
              loop
              autoplay
              @mouseenter="($event.target as HTMLVideoElement)?.play()"
              @mouseleave="($event.target as HTMLVideoElement)?.pause()"
            />
            <span class="avatar-filename">avatar.mp4</span>
          </div>
          <div class="pip-preview">
            <span class="pip-preview-title">左下角效果预览</span>
            <div class="pip-preview-frame" :style="{ height: `${previewFrameHeight}px` }">
              <video
                :src="`/api/projects/${projectName}/avatar`"
                class="pip-preview-avatar"
                :style="pipPreviewStyle"
                muted
                loop
                autoplay
                playsinline
                @loadedmetadata="onPreviewVideoMetadata"
              />
            </div>
          </div>
        </div>
        <div v-else class="avatar-empty">
          <n-upload
            :max="1"
            accept=".mp4"
            :show-file-list="false"
            :custom-request="uploadAvatar"
          >
            <n-button size="small" :loading="avatarUploading">
              上传 Avatar 视频
            </n-button>
          </n-upload>
          <span class="avatar-hint">按上传分辨率叠加（如 128×128），30fps mp4</span>
        </div>
      </div>
    </div>

    <!-- Toolbar -->
    <div class="editor-toolbar">
      <span v-if="isDirty" class="dirty-badge">● 未保存</span>
      <n-button size="small" type="primary" :loading="saving" :disabled="disabled" @click="save">
        保存
      </n-button>
    </div>

    <!-- CodeMirror container -->
    <div ref="editorEl" class="cm-container" />

    <!-- Loading overlay -->
    <div v-if="loading" class="editor-overlay">
      <n-spin size="large" />
    </div>

    <!-- 409 Conflict dialog -->
    <n-modal
      v-model:show="conflictVisible"
      title="保存冲突"
      preset="card"
      style="width: 600px"
      :mask-closable="false"
    >
      <p>文件已被其他标签页修改，你的版本与服务端当前版本不一致。</p>

      <n-tabs v-if="showDiff" type="line" size="small">
        <n-tab-pane name="yours" tab="你的版本">
          <pre class="diff-pre">{{ conflictData?.yourContent }}</pre>
        </n-tab-pane>
        <n-tab-pane name="server" tab="服务端版本">
          <pre class="diff-pre">{{ conflictData?.currentContent }}</pre>
        </n-tab-pane>
      </n-tabs>

      <template #footer>
        <n-space justify="end">
          <n-button @click="conflictVisible = false">取消</n-button>
          <n-button @click="showDiff = !showDiff">
            {{ showDiff ? '隐藏 Diff' : '查看 Diff' }}
          </n-button>
          <n-button type="error" :loading="saving" @click="overwrite">
            覆盖保存
          </n-button>
        </n-space>
      </template>
    </n-modal>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import { EditorState } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { yaml } from '@codemirror/lang-yaml'
import { oneDark } from '@codemirror/theme-one-dark'
import { apiGet, apiPut, apiPost, getEtag, setEtag } from '../../utils/api'
import { createDiscreteApi, type UploadCustomRequestOptions } from 'naive-ui'

const { message } = createDiscreteApi(['message'])

const props = defineProps<{
  projectName: string
  disabled?: boolean
}>()

// Refs
const editorEl = ref<HTMLDivElement | null>(null)
const loading = ref(false)
const saving = ref(false)
const isDirty = ref(false)

// Avatar state
const avatarExists = ref(false)
const avatarUploading = ref(false)
const avatarDeleting = ref(false)
const hasAvatarRef = ref(false)
const lipsyncEnabled = ref(true)
const avatarRadius = ref(24)
const previewVideoWidth = ref(128)
const previewVideoHeight = ref(128)
const previewAspect = ref<'16:9' | '9:16' | '1:1'>('16:9')

const AVATAR_RADIUS_MIN = 8
const AVATAR_RADIUS_MAX = 128
const DEFAULT_AVATAR_RADIUS = 24
const PREVIEW_FRAME_WIDTH = 280

const avatarRadiusChoices = [
  ...Array.from({ length: (64 - AVATAR_RADIUS_MIN) / 4 + 1 }, (_, i) => AVATAR_RADIUS_MIN + i * 4),
  96,
  128,
]

const avatarRadiusOptions = avatarRadiusChoices.map((value) => ({
  label: String(value),
  value,
}))

const previewFrameHeight = computed(() => {
  if (previewAspect.value === '9:16') return Math.round(PREVIEW_FRAME_WIDTH * 16 / 9)
  if (previewAspect.value === '1:1') return PREVIEW_FRAME_WIDTH
  return Math.round(PREVIEW_FRAME_WIDTH * 9 / 16)
})

const pipPreviewStyle = computed(() => {
  const metaWidth = previewAspect.value === '9:16' ? 1080 : previewAspect.value === '1:1' ? 1080 : 1920
  const metaHeight = previewAspect.value === '9:16' ? 1920 : previewAspect.value === '1:1' ? 1080 : 1080
  const scale = PREVIEW_FRAME_WIDTH / metaWidth
  const w = Math.max(1, Math.round(previewVideoWidth.value * scale))
  const h = Math.max(1, Math.round(previewVideoHeight.value * scale))
  const r = Math.min(
    avatarRadius.value * (w / previewVideoWidth.value),
    w / 2,
    h / 2,
  )
  return {
    width: `${w}px`,
    height: `${h}px`,
    borderRadius: `${r}px`,
  }
})

function readAvatarRadius(content: string): number {
  const match = content.match(/^avatarRadius:\s*(\d+)\s*$/m)
  if (!match) return DEFAULT_AVATAR_RADIUS
  const parsed = Number(match[1])
  if (!Number.isFinite(parsed)) return DEFAULT_AVATAR_RADIUS
  return Math.min(AVATAR_RADIUS_MAX, Math.max(AVATAR_RADIUS_MIN, parsed))
}

function readAspect(content: string): '16:9' | '9:16' | '1:1' {
  const match = content.match(/^aspect:\s*(\S+)/m)
  if (match?.[1] === '9:16' || match?.[1] === '1:1') return match[1]
  return '16:9'
}

function applyAvatarRadiusToMeta(content: string, radius: number): string {
  const line = `avatarRadius: ${radius}`
  if (/^avatarRadius:\s*\d+\s*$/m.test(content)) {
    return content.replace(/^avatarRadius:\s*\d+\s*$/m, line)
  }
  if (/^avatarRef:\s*.+$/m.test(content)) {
    return content.replace(/^(avatarRef:\s*.+)$/m, `$1\n${line}`)
  }
  if (/^skipLipsync:\s*.+$/m.test(content)) {
    return content.replace(/^(skipLipsync:\s*.+)$/m, `$1\n${line}`)
  }
  return content.replace(/^---\s*$/m, `${line}\n---`)
}

function onPreviewVideoMetadata(event: Event) {
  const video = event.target as HTMLVideoElement
  if (video.videoWidth > 0) previewVideoWidth.value = video.videoWidth
  if (video.videoHeight > 0) previewVideoHeight.value = video.videoHeight
}

async function onAvatarRadiusChange(value: number) {
  if (!view) return
  const current = view.state.doc.toString()
  const updated = applyAvatarRadiusToMeta(current, value)
  if (updated === current) return
  view.dispatch({
    changes: { from: 0, to: current.length, insert: updated },
  })
  await save()
}

function readLipsyncEnabled(content: string): boolean {
  const match = content.match(/^skipLipsync:\s*(.+)$/m)
  if (!match) return true
  return match[1].trim().toLowerCase() !== 'true'
}

function applyLipsyncToMeta(content: string, enabled: boolean): string {
  const line = enabled ? 'skipLipsync: false' : 'skipLipsync: true'
  if (/^skipLipsync:\s*.+$/m.test(content)) {
    return content.replace(/^skipLipsync:\s*.+$/m, line)
  }
  if (/^avatarRef:\s*.+$/m.test(content)) {
    return content.replace(/^(avatarRef:\s*.+)$/m, `$1\n${line}`)
  }
  return content.replace(/^---\s*$/m, `${line}\n---`)
}

function syncLipsyncState(content: string) {
  hasAvatarRef.value = /^avatarRef:\s*.+$/m.test(content)
  lipsyncEnabled.value = readLipsyncEnabled(content)
  avatarRadius.value = readAvatarRadius(content)
  previewAspect.value = readAspect(content)
}

async function onLipsyncToggle(enabled: boolean) {
  if (!view) return
  const current = view.state.doc.toString()
  const updated = applyLipsyncToMeta(current, enabled)
  if (updated === current) return
  view.dispatch({
    changes: { from: 0, to: current.length, insert: updated },
  })
  await save()
}

// Conflict state
const conflictVisible = ref(false)
const showDiff = ref(false)
interface ConflictInfo {
  yourContent: string
  currentContent: string
  currentEtag: string
}
const conflictData = ref<ConflictInfo | null>(null)

// CodeMirror view
let view: EditorView | null = null

// Whether the system prefers dark mode
function prefersDark(): boolean {
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

// Build EditorView extensions
function buildExtensions(onSave: () => void) {
  const exts = [
    history(),
    keymap.of([
      ...defaultKeymap,
      ...historyKeymap,
      {
        key: 'Ctrl-s',
        mac: 'Cmd-s',
        run: () => { onSave(); return true },
        preventDefault: true,
      },
    ]),
    yaml(),
    EditorView.updateListener.of((update) => {
      if (update.docChanged) {
        isDirty.value = true
        const content = update.state.doc.toString()
        hasAvatarRef.value = /^avatarRef:\s*.+$/m.test(content)
        lipsyncEnabled.value = readLipsyncEnabled(content)
        avatarRadius.value = readAvatarRadius(content)
        previewAspect.value = readAspect(content)
      }
    }),
    EditorView.theme({
      '&': { height: '100%' },
      '.cm-scroller': { overflow: 'auto', fontFamily: 'monospace', fontSize: '13px' },
    }),
  ]
  if (prefersDark()) {
    exts.push(oneDark)
  }
  return exts
}

// Check if avatar.mp4 exists
async function checkAvatar() {
  try {
    const res = await fetch(`/api/projects/${props.projectName}/avatar`, { method: 'HEAD' })
    avatarExists.value = res.ok
  } catch {
    avatarExists.value = false
  }
}

// Upload avatar video
async function uploadAvatar(options: UploadCustomRequestOptions) {
  const { file } = options
  avatarUploading.value = true
  try {
    const formData = new FormData()
    formData.append('file', file.file as File)
    const res = await fetch(`/api/projects/${props.projectName}/avatar`, {
      method: 'POST',
      body: formData,
    })
    const data = await res.json()
    if (res.ok && data.ok) {
      avatarExists.value = true
      message.success('Avatar 上传成功')
      // Reload editor to reflect updated meta.md
      await initEditor()
    } else {
      message.error(data.error?.message ?? '上传失败')
    }
  } catch {
    message.error('上传失败')
  } finally {
    avatarUploading.value = false
  }
}

// Delete avatar
async function deleteAvatar() {
  avatarDeleting.value = true
  try {
    const res = await fetch(`/api/projects/${props.projectName}/avatar`, { method: 'DELETE' })
    if (res.ok) {
      avatarExists.value = false
      message.success('Avatar 已删除')
      await initEditor()
    }
  } catch {
    message.error('删除失败')
  } finally {
    avatarDeleting.value = false
  }
}

// Initialize or re-initialize the editor
async function initEditor() {
  loading.value = true
  isDirty.value = false

  const metaUrl = `/api/projects/${props.projectName}/meta`
  const result = await apiGet<{ content: string }>(metaUrl, { silent: true })

  if (!result.ok) {
    loading.value = false
    message.error('加载 meta.md 失败: ' + (result.error?.message ?? '未知错误'))
    return
  }

  const content = result.data.content

  // Destroy old view if present
  if (view) {
    view.destroy()
    view = null
  }

  if (!editorEl.value) {
    loading.value = false
    return
  }

  view = new EditorView({
    state: EditorState.create({
      doc: content,
      extensions: buildExtensions(save),
    }),
    parent: editorEl.value,
  })

  syncLipsyncState(content)
  loading.value = false
}

// Save content
async function save() {
  if (!view) return
  const content = view.state.doc.toString()
  const metaUrl = `/api/projects/${props.projectName}/meta`
  const etag = getEtag(metaUrl)

  saving.value = true
  const result = await apiPut<{ ok: boolean; etag: string }>(
    metaUrl,
    { content },
    etag,
  )
  saving.value = false

  if (result.ok) {
    isDirty.value = false
    if (result.data.etag) {
      setEtag(metaUrl, result.data.etag)
    }
    message.success('已保存', { duration: 1500 })
  } else if (result.conflict) {
    // 409 conflict
    conflictData.value = {
      yourContent: content,
      currentContent: result.conflict.currentContent ?? '',
      currentEtag: result.conflict.currentEtag,
    }
    showDiff.value = false
    conflictVisible.value = true
  }
  // Other errors are shown by apiFetch
}

// Overwrite with current editor content (using the server's etag from conflict)
async function overwrite() {
  if (!view || !conflictData.value) return
  const content = view.state.doc.toString()
  const metaUrl = `/api/projects/${props.projectName}/meta`

  saving.value = true
  const result = await apiPut<{ ok: boolean; etag: string }>(
    metaUrl,
    { content },
    conflictData.value.currentEtag,
  )
  saving.value = false

  if (result.ok) {
    conflictVisible.value = false
    conflictData.value = null
    isDirty.value = false
    if (result.data.etag) {
      setEtag(metaUrl, result.data.etag)
    }
    message.success('覆盖保存成功', { duration: 1500 })
  } else if (result.conflict) {
    // Another conflict occurred during overwrite
    conflictData.value = {
      yourContent: content,
      currentContent: result.conflict.currentContent ?? '',
      currentEtag: result.conflict.currentEtag,
    }
    message.warning('服务端再次变更，请重试')
  }
}

// beforeunload
function handleBeforeUnload(e: BeforeUnloadEvent) {
  if (isDirty.value) {
    e.preventDefault()
    e.returnValue = ''
  }
}

// Watch for system color scheme change
let darkMQ: MediaQueryList | null = null
function handleColorSchemeChange() {
  if (!view) return
  // Recreate editor to apply new theme
  const content = view.state.doc.toString()
  view.destroy()
  view = new EditorView({
    state: EditorState.create({
      doc: content,
      extensions: buildExtensions(save),
    }),
    parent: editorEl.value!,
  })
}

onMounted(async () => {
  await initEditor()
  await checkAvatar()
  window.addEventListener('beforeunload', handleBeforeUnload)
  darkMQ = window.matchMedia('(prefers-color-scheme: dark)')
  darkMQ.addEventListener('change', handleColorSchemeChange)
})

onUnmounted(() => {
  if (view) {
    view.destroy()
    view = null
  }
  window.removeEventListener('beforeunload', handleBeforeUnload)
  darkMQ?.removeEventListener('change', handleColorSchemeChange)
})

watch(
  () => props.projectName,
  () => initEditor(),
)
</script>

<style scoped>
.meta-editor {
  display: flex;
  flex-direction: column;
  height: 100%;
  position: relative;
}

.avatar-section {
  padding: 8px 12px;
  border-bottom: 1px solid var(--n-border-color, #e0e0e6);
  flex-shrink: 0;
}

.avatar-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 4px;
}

.avatar-label {
  font-size: 12px;
  font-weight: 500;
  color: var(--n-text-color, #333);
}

.avatar-body {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}

.lipsync-toggle {
  display: flex;
  align-items: center;
  gap: 8px;
}

.lipsync-label {
  font-size: 12px;
  color: var(--n-text-color-2, #666);
}

.dirty-hint {
  font-size: 11px;
  color: #f0a020;
}

.avatar-radius-row {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
}

.radius-label {
  font-size: 12px;
  color: var(--n-text-color-2, #666);
}

.radius-unit {
  font-size: 12px;
  color: var(--n-text-color-3, #999);
}

.avatar-preview-row {
  display: flex;
  align-items: flex-start;
  gap: 16px;
  width: 100%;
}

.avatar-preview {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.avatar-video {
  width: 48px;
  height: 48px;
  border-radius: 6px;
  object-fit: cover;
  background: #000;
}

.pip-preview {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.pip-preview-title {
  font-size: 11px;
  color: var(--n-text-color-3, #999);
}

.pip-preview-frame {
  position: relative;
  width: 280px;
  background: #0d1117;
  border: 1px solid #30363d;
  border-radius: 4px;
  overflow: hidden;
}

.pip-preview-avatar {
  position: absolute;
  left: 0;
  bottom: 0;
  object-fit: cover;
  background: #000;
}

.avatar-filename {
  font-size: 12px;
  color: var(--n-text-color-3, #999);
}

.avatar-empty {
  display: flex;
  align-items: center;
  gap: 8px;
}

.avatar-hint {
  font-size: 11px;
  color: var(--n-text-color-3, #999);
}

.editor-toolbar {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  padding: 6px 12px;
  border-bottom: 1px solid var(--n-border-color, #e0e0e6);
  flex-shrink: 0;
}

.dirty-badge {
  font-size: 12px;
  color: #f0a020;
}

.cm-container {
  flex: 1;
  overflow: hidden;
  min-height: 0;
}

.cm-container :deep(.cm-editor) {
  height: 100%;
}

.cm-container :deep(.cm-scroller) {
  overflow: auto;
}

.editor-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(255, 255, 255, 0.7);
}

.diff-pre {
  white-space: pre-wrap;
  word-break: break-word;
  font-family: monospace;
  font-size: 12px;
  padding: 8px;
  background: var(--n-color-modal, #f5f5f5);
  border-radius: 4px;
  max-height: 300px;
  overflow-y: auto;
  margin: 0;
}
</style>
