<template>
  <div class="block-panel">
    <!-- Block header info -->
    <div class="panel-header-top">
      <span class="block-id-badge">{{ blockId }}</span>
      <span class="block-title-text">{{ blockTitle || '(无标题)' }}</span>
      <n-button size="tiny" text @click="$emit('close')" class="close-btn">✕</n-button>
    </div>

    <!-- Visual mode switcher -->
    <div class="visual-mode-bar">
      <span class="mode-label">视觉</span>
      <n-radio-group
        :value="currentMode"
        size="small"
        :disabled="disabled"
        @update:value="onModeChange"
      >
        <n-radio-button value="animation">动画</n-radio-button>
        <n-radio-button value="image">图片</n-radio-button>
      </n-radio-group>
      <n-spin v-if="modeSwitching" size="small" />
    </div>

    <!-- Animation presets: enter / exit -->
    <div class="anim-bar">
      <span class="mode-label">入场</span>
      <n-select
        :value="currentEnter"
        size="small"
        :options="animOptions"
        :disabled="disabled"
        style="width: 100px"
        @update:value="onEnterChange"
      />
      <span class="mode-label">出场</span>
      <n-select
        :value="currentExit"
        size="small"
        :options="animOptions"
        :disabled="disabled"
        style="width: 100px"
        @update:value="onExitChange"
      />
    </div>

    <n-divider style="margin: 0" />

    <!-- Tabs: A / B -->
    <n-tabs
      v-model:value="activeTab"
      type="line"
      size="small"
      :style="{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minHeight: 0 }"
      :pane-wrapper-style="{ flex: 1, overflow: 'hidden', minHeight: 0 }"
      :pane-style="{ height: '100%', overflow: 'hidden', padding: 0 }"
    >
      <n-tab-pane name="script" tab="脚本编辑" display-directive="show">
        <BlockScriptEditor
          :key="'be-' + blockId + '-' + editorKey"
          :project-name="projectName"
          :block-id="blockId"
          :disabled="disabled"
          @saved="onBlockSaved"
        />
      </n-tab-pane>
      <n-tab-pane name="output" tab="产物预览" display-directive="show">
        <BlockOutputs
          :project-name="projectName"
          :block-id="blockId"
          :visual-mode="currentMode"
          :image-source="imageSource"
        />
      </n-tab-pane>
    </n-tabs>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, computed } from 'vue'
import { NButton, NDivider, NRadioGroup, NRadioButton, NSelect, NSpin, NTabs, NTabPane, createDiscreteApi } from 'naive-ui'
import { apiPut, getEtag } from '../../utils/api'
import BlockScriptEditor from './BlockScriptEditor.vue'
import BlockOutputs from './BlockOutputs.vue'
import type { VisualMode } from '../../../../server/types/api'

const { message } = createDiscreteApi(['message'])

const ANIM_OPTIONS = [
  { label: '渐入', value: 'fade' },
  { label: '渐入↑', value: 'fade-up' },
  { label: '渐入↓', value: 'fade-down' },
  { label: '左滑', value: 'slide-left' },
  { label: '右滑', value: 'slide-right' },
  { label: '放大', value: 'zoom-in' },
  { label: '缩小', value: 'zoom-out' },
  { label: '无', value: 'none' },
]

// ---------------------------------------------------------------------------
// Props / Emits
// ---------------------------------------------------------------------------

const props = defineProps<{
  projectName: string
  blockId: string
  blockTitle: string
  visualMode: VisualMode
  imageSource?: string
  enter: string
  exit: string
  disabled?: boolean
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'block-saved'): void
  (e: 'visual-mode-changed', mode: VisualMode): void
}>()

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const activeTab     = ref('script')
const currentMode   = ref<VisualMode>(props.visualMode)
const currentEnter  = ref(props.enter)
const currentExit   = ref(props.exit)
const modeSwitching = ref(false)
const editorKey     = ref(0)
const animOptions   = ANIM_OPTIONS

// ---------------------------------------------------------------------------
// Sync from props (when switching to a different block)
// ---------------------------------------------------------------------------

watch(
  () => props.visualMode,
  (mode) => { currentMode.value = mode },
)
watch(
  () => props.enter,
  (v) => { currentEnter.value = v },
)
watch(
  () => props.exit,
  (v) => { currentExit.value = v },
)

// ---------------------------------------------------------------------------
// Visual mode switch
// ---------------------------------------------------------------------------

async function onModeChange(mode: VisualMode) {
  if (mode === currentMode.value) return

  modeSwitching.value = true

  const scriptUrl = `/api/projects/${props.projectName}/script`
  const etag = getEtag(scriptUrl)

  const result = await apiPut<{ ok: boolean; etag: string; mode: string }>(
    `/api/projects/${props.projectName}/blocks/${props.blockId}/visual-mode`,
    { mode },
    etag,
  )

  if (result.ok) {
    currentMode.value = mode
    message.success(`已切换为 ${mode === 'animation' ? '动画' : '图片'} 模式 (建议重新生成视觉)`, { duration: 3000 })
    emit('visual-mode-changed', mode)
    emit('block-saved')
  } else if (result.conflict) {
    message.error('保存冲突，请先刷新页面重试')
  }

  modeSwitching.value = false
}

async function onEnterChange(v: string) {
  if (v === currentEnter.value) return
  const result = await apiPut<{ ok: boolean }>(
    `/api/projects/${props.projectName}/blocks/${props.blockId}/visual-mode`,
    { enter: v },
    getEtag(`/api/projects/${props.projectName}/script`),
  )
  if (result.ok) {
    currentEnter.value = v
    emit('block-saved')
  }
}

async function onExitChange(v: string) {
  if (v === currentExit.value) return
  const result = await apiPut<{ ok: boolean }>(
    `/api/projects/${props.projectName}/blocks/${props.blockId}/visual-mode`,
    { exit: v },
    getEtag(`/api/projects/${props.projectName}/script`),
  )
  if (result.ok) {
    currentExit.value = v
    emit('block-saved')
  }
}

// ---------------------------------------------------------------------------
// Block saved → notify parent (to refresh ScriptEditor etc.)
// ---------------------------------------------------------------------------

function onBlockSaved() {
  editorKey.value++
  emit('block-saved')
}
</script>

<style scoped>
.block-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}

/* Block header */
.panel-header-top {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  flex-shrink: 0;
}

.block-id-badge {
  font-size: 12px;
  font-weight: 700;
  color: #1677ff;
  background: rgba(22, 119, 255, 0.08);
  padding: 1px 6px;
  border-radius: 4px;
  flex-shrink: 0;
}

.block-title-text {
  font-size: 13px;
  font-weight: 500;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.close-btn {
  flex-shrink: 0;
  font-size: 14px;
}

/* Visual mode bar */
.visual-mode-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  flex-shrink: 0;
}

.mode-label {
  font-size: 11px;
  color: #999;
  flex-shrink: 0;
}

/* Animation bar */
.anim-bar {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  flex-shrink: 0;
}

</style>
