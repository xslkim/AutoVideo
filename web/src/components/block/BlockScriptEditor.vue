<template>
  <div class="block-script-editor">
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
      <n-spin size="small" />
    </div>

    <!-- Referenced assets -->
    <div v-if="assetPaths.length > 0" class="asset-references">
      <div class="asset-title">引用资源</div>
      <div class="asset-list">
        <div
          v-for="ap in assetPaths"
          :key="ap"
          class="asset-item"
          @click="previewAsset(ap)"
        >
          <span class="asset-icon">🖼</span>
          <span class="asset-path">{{ ap }}</span>
        </div>
      </div>
    </div>

    <!-- Asset preview modal -->
    <n-modal
      v-model:show="previewVisible"
      title="图片预览"
      preset="card"
      style="width: 640px"
    >
      <div class="preview-container">
        <img v-if="previewSrc" :src="previewSrc" class="preview-image" />
        <n-spin v-else size="medium" />
      </div>
    </n-modal>

    <!-- 409 Conflict dialog (simplified for single block) -->
    <n-modal
      v-model:show="conflictVisible"
      title="保存冲突"
      preset="card"
      style="width: 500px"
      :mask-closable="false"
    >
      <p>脚本已被其他标签页修改，你的版本与服务端当前版本不一致。</p>
      <template #footer>
        <n-space justify="end">
          <n-button @click="conflictVisible = false">取消</n-button>
          <n-button type="error" :loading="saving" @click="overwrite">
            覆盖保存
          </n-button>
        </n-space>
      </template>
    </n-modal>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch } from 'vue'
import { EditorState } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import {
  StreamLanguage,
  HighlightStyle,
  syntaxHighlighting,
} from '@codemirror/language'
import { tags } from '@lezer/highlight'
import { oneDark } from '@codemirror/theme-one-dark'
import { apiGet, apiPut, getEtag, setEtag } from '../../utils/api'
import { extractBlock, extractAssetPaths } from '../../utils/scriptParser'
import { createDiscreteApi } from 'naive-ui'

const { message } = createDiscreteApi(['message'])

// ---------------------------------------------------------------------------
// Props / Emits
// ---------------------------------------------------------------------------

const props = defineProps<{
  projectName: string
  blockId: string
  disabled?: boolean
}>()

const emit = defineEmits<{
  (e: 'saved'): void
}>()

// ---------------------------------------------------------------------------
// Custom StreamLanguage — same as ScriptEditor (§4.2.2 + §B.1)
// ---------------------------------------------------------------------------

const scriptLanguage = StreamLanguage.define({
  token(stream) {
    if (stream.sol()) {
      if (stream.match(/^>>>/)) {
        stream.skipToEnd()
        return 'blockHeader'
      }
      if (stream.match(/^@(?:enter|exit|duration|visual):/)) {
        stream.skipToEnd()
        return 'directive'
      }
      if (stream.match(/^---\s+(?:visual|narration)\s+---/)) {
        stream.skipToEnd()
        return 'section'
      }
    }
    if (stream.match(/\*\*[^*]+\*\*/)) return 'bold'
    if (stream.match(/\.\/assets\/[^\s)\]]+/)) return 'assetPath'
    stream.next()
    return null
  },

  tokenTable: {
    blockHeader: tags.heading1,
    directive:   tags.keyword,
    section:     tags.string,
    bold:        tags.strong,
    assetPath:   tags.url,
  },
})

const scriptHighlight = HighlightStyle.define([
  { tag: tags.heading1,  color: '#1677ff', fontWeight: 'bold' },
  { tag: tags.keyword,   color: '#e67e22' },
  { tag: tags.string,    color: '#18a058' },
  { tag: tags.strong,    fontWeight: 'bold' },
  { tag: tags.url,       textDecoration: 'underline', color: 'inherit' },
])

// ---------------------------------------------------------------------------
// Refs
// ---------------------------------------------------------------------------

const editorEl    = ref<HTMLDivElement | null>(null)
const loading     = ref(true)
const saving      = ref(false)
const isDirty     = ref(false)

const assetPaths      = ref<string[]>([])
const previewVisible  = ref(false)
const previewSrc      = ref<string | null>(null)

const conflictVisible = ref(false)
const conflictEtag    = ref('')

let view: EditorView | null = null
let scriptEtag = ''

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function prefersDark(): boolean {
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

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
    scriptLanguage,
    syntaxHighlighting(scriptHighlight),
    EditorView.updateListener.of((update) => {
      if (update.docChanged) {
        isDirty.value = true
      }
    }),
    EditorView.theme({
      '&': { height: '100%' },
      '.cm-scroller': {
        overflow: 'auto',
        fontFamily: 'monospace',
        fontSize: '12px',
      },
    }),
  ]
  if (prefersDark()) exts.push(oneDark)
  return exts
}

// ---------------------------------------------------------------------------
// Load block content
// ---------------------------------------------------------------------------

async function loadBlock() {
  loading.value = true
  isDirty.value = false

  const scriptUrl = `/api/projects/${props.projectName}/script`
  const result = await apiGet<{ content: string }>(scriptUrl, { silent: true })

  if (!result.ok) {
    loading.value = false
    message.error('加载 script.md 失败: ' + (result.error?.message ?? '未知错误'))
    return
  }

  const scriptMd = result.data.content
  scriptEtag = result.etag ?? ''

  // Extract block content
  let blockContent = ''
  try {
    const extracted = extractBlock(scriptMd, props.blockId)
    blockContent = extracted.content
  } catch {
    message.error(`未找到块 ${props.blockId}`)
    loading.value = false
    return
  }

  // Extract asset paths from block content
  assetPaths.value = extractAssetPaths(blockContent)

  if (view) { view.destroy(); view = null }
  if (!editorEl.value) { loading.value = false; return }

  view = new EditorView({
    state: EditorState.create({
      doc: blockContent,
      extensions: buildExtensions(save),
    }),
    parent: editorEl.value,
  })

  loading.value = false
}

// ---------------------------------------------------------------------------
// Save block (PUT /api/projects/:name/blocks/:id)
// ---------------------------------------------------------------------------

async function save() {
  if (!view) return
  const content = view.state.doc.toString()
  const blockUrl = `/api/projects/${props.projectName}/blocks/${props.blockId}`

  saving.value = true
  const result = await apiPut<{ ok: boolean; etag: string }>(
    blockUrl,
    { content },
    scriptEtag,
  )
  saving.value = false

  if (result.ok) {
    isDirty.value = false
    // Update scriptEtag from the new script.md ETag
    if (result.data.etag) {
      scriptEtag = result.data.etag
      setEtag(`/api/projects/${props.projectName}/script`, result.data.etag)
    }
    // Re-scan asset paths after save
    assetPaths.value = extractAssetPaths(content)
    message.success('已保存', { duration: 1500 })
    emit('saved')
  } else if (result.conflict) {
    conflictEtag.value = result.conflict.currentEtag
    conflictVisible.value = true
  }
  // 422 or 404 errors are already toasted by apiPut
}

// ---------------------------------------------------------------------------
// Overwrite after conflict
// ---------------------------------------------------------------------------

async function overwrite() {
  if (!view) return
  const content = view.state.doc.toString()
  const blockUrl = `/api/projects/${props.projectName}/blocks/${props.blockId}`

  saving.value = true
  const result = await apiPut<{ ok: boolean; etag: string }>(
    blockUrl,
    { content },
    conflictEtag.value,
  )
  saving.value = false

  if (result.ok) {
    conflictVisible.value = false
    isDirty.value = false
    if (result.data.etag) {
      scriptEtag = result.data.etag
      setEtag(`/api/projects/${props.projectName}/script`, result.data.etag)
    }
    assetPaths.value = extractAssetPaths(content)
    message.success('覆盖保存成功', { duration: 1500 })
    emit('saved')
  } else if (result.conflict) {
    conflictEtag.value = result.conflict.currentEtag
    message.warning('服务端再次变更，请重试')
  }
}

// ---------------------------------------------------------------------------
// Asset preview
// ---------------------------------------------------------------------------

function previewAsset(assetPath: string) {
  previewSrc.value = null
  previewVisible.value = true
  // Load the image via the API (will fully work after WP2.6)
  const imgUrl = `/api/projects/${props.projectName}/assets/${encodeURIComponent(assetPath.replace('assets/', ''))}`
  previewSrc.value = imgUrl
}

// ---------------------------------------------------------------------------
// beforeunload
// ---------------------------------------------------------------------------

function handleBeforeUnload(e: BeforeUnloadEvent) {
  if (isDirty.value) {
    e.preventDefault()
    e.returnValue = ''
  }
}

// ---------------------------------------------------------------------------
// Color scheme change
// ---------------------------------------------------------------------------

let darkMQ: MediaQueryList | null = null

function handleColorSchemeChange() {
  if (!view) return
  const content = view.state.doc.toString()
  const wasDirty = isDirty.value
  view.destroy()
  view = new EditorView({
    state: EditorState.create({
      doc: content,
      extensions: buildExtensions(save),
    }),
    parent: editorEl.value!,
  })
  isDirty.value = wasDirty
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

onMounted(async () => {
  await loadBlock()
  window.addEventListener('beforeunload', handleBeforeUnload)
  darkMQ = window.matchMedia('(prefers-color-scheme: dark)')
  darkMQ.addEventListener('change', handleColorSchemeChange)
})

onUnmounted(() => {
  if (view) { view.destroy(); view = null }
  window.removeEventListener('beforeunload', handleBeforeUnload)
  darkMQ?.removeEventListener('change', handleColorSchemeChange)
})

watch(
  [() => props.projectName, () => props.blockId],
  () => loadBlock(),
)
</script>

<style scoped>
.block-script-editor {
  display: flex;
  flex-direction: column;
  height: 100%;
  position: relative;
}

.editor-toolbar {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  padding: 4px 8px;
  border-bottom: 1px solid var(--n-border-color, #e0e0e6);
  flex-shrink: 0;
}

.dirty-badge {
  font-size: 11px;
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
  z-index: 1;
}

/* Asset references */
.asset-references {
  border-top: 1px solid var(--n-border-color, #e0e0e6);
  flex-shrink: 0;
}

.asset-title {
  font-size: 11px;
  font-weight: 600;
  color: #999;
  padding: 6px 10px 4px;
}

.asset-list {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  padding: 0 10px 8px;
}

.asset-item {
  display: flex;
  align-items: center;
  gap: 3px;
  padding: 2px 6px;
  background: var(--n-color-embedded, #f5f5f5);
  border-radius: 4px;
  cursor: pointer;
  font-size: 11px;
  border: 1px solid var(--n-border-color, #e0e0e6);
  transition: border-color 0.15s;
}

.asset-item:hover {
  border-color: var(--n-color-primary, #1677ff);
}

.asset-icon {
  font-size: 12px;
}

.asset-path {
  color: var(--n-text-color-2, #666);
  max-width: 160px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.preview-container {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 200px;
}

.preview-image {
  max-width: 100%;
  max-height: 400px;
  object-fit: contain;
}
</style>
