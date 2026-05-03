<template>
  <div class="meta-editor">
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
import { ref, onMounted, onUnmounted, watch } from 'vue'
import { EditorState } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { yaml } from '@codemirror/lang-yaml'
import { oneDark } from '@codemirror/theme-one-dark'
import { apiGet, apiPut, getEtag, setEtag } from '../../utils/api'
import { createDiscreteApi } from 'naive-ui'

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
      currentContent: result.conflict.currentContent,
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
      currentContent: result.conflict.currentContent,
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
