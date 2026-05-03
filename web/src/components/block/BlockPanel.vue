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
      <span class="mode-label">视觉模式</span>
      <n-radio-group
        :value="currentMode"
        size="small"
        @update:value="onModeChange"
      >
        <n-radio-button value="animation">动画</n-radio-button>
        <n-radio-button value="image">图片</n-radio-button>
      </n-radio-group>
      <n-spin v-if="modeSwitching" size="small" />
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
          @saved="onBlockSaved"
        />
      </n-tab-pane>
      <n-tab-pane name="output" tab="产物预览" display-directive="show">
        <div class="output-pane">
          <!-- Output preview placeholder -->
          <div class="output-placeholder">
            <n-empty description="产物预览（待实现）" size="small" />
          </div>

          <!-- Single-block action buttons -->
          <div class="output-actions">
            <div class="output-actions-title">单块操作</div>
            <n-space vertical size="small">
              <!-- Generate audio -->
              <n-dropdown trigger="click" :options="audioMenuOpts" @select="(k: string) => onBlockAction(k, 'tts')">
                <n-button
                  size="small"
                  block
                  :disabled="taskStore.hasActiveStage('tts')"
                  :loading="actionLoading === 'tts'"
                >
                  生成音频
                </n-button>
              </n-dropdown>

              <!-- Generate visual (label changes per mode) -->
              <n-dropdown trigger="click" :options="visualMenuOpts" @select="(k: string) => onBlockAction(k, 'visuals')">
                <n-button
                  size="small"
                  block
                  :disabled="taskStore.hasActiveStage('visuals')"
                  :loading="actionLoading === 'visuals'"
                >
                  {{ currentMode === 'image' ? '生成图片' : '生成视觉' }}
                </n-button>
              </n-dropdown>

              <!-- Render segment -->
              <n-dropdown trigger="click" :options="renderMenuOpts" @select="(k: string) => onBlockAction(k, 'render')">
                <n-button
                  size="small"
                  block
                  :disabled="taskStore.hasActiveStage('render')"
                  :loading="actionLoading === 'render'"
                >
                  渲染分段
                </n-button>
              </n-dropdown>

              <!-- Recompile -->
              <n-dropdown trigger="click" :options="compileMenuOpts" @select="(k: string) => onBlockAction(k, 'compile')">
                <n-button
                  size="small"
                  block
                  :disabled="taskStore.hasActiveStage('compile') || taskStore.hasActiveStage('build')"
                  :loading="actionLoading === 'compile'"
                >
                  重新编译
                </n-button>
              </n-dropdown>
            </n-space>
          </div>
        </div>
      </n-tab-pane>
    </n-tabs>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, computed } from 'vue'
import { NButton, NDivider, NRadioGroup, NRadioButton, NSpin, NTabs, NTabPane, NEmpty, NDropdown, NSpace, createDiscreteApi } from 'naive-ui'
import { apiPut, getEtag } from '../../utils/api'
import { useTaskStore } from '../../stores/taskStore'
import BlockScriptEditor from './BlockScriptEditor.vue'
import type { VisualMode, Stage } from '../../../../server/types/api'

const { message } = createDiscreteApi(['message'])
const taskStore = useTaskStore()

// ---------------------------------------------------------------------------
// Props / Emits
// ---------------------------------------------------------------------------

const props = defineProps<{
  projectName: string
  blockId: string
  blockTitle: string
  visualMode: VisualMode
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
const modeSwitching = ref(false)
const editorKey     = ref(0)
const actionLoading = ref<string | null>(null)

// ---------------------------------------------------------------------------
// Sync visualMode from props (when switching to a different block)
// ---------------------------------------------------------------------------

watch(
  () => props.visualMode,
  (mode) => {
    currentMode.value = mode
  },
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

// ---------------------------------------------------------------------------
// Block action buttons (Tab B)
// ---------------------------------------------------------------------------

function makeMenuOpts(label: string) {
  return [
    {
      key: `${label}-force`,
      label: '强制重跑（忽略缓存）',
    },
    {
      key: `${label}-clear-cache`,
      label: '清缓存（即将推出）',
      disabled: true,
    },
  ]
}

const audioMenuOpts   = computed(() => makeMenuOpts('audio'))
const visualMenuOpts  = computed(() => makeMenuOpts('visual'))
const renderMenuOpts  = computed(() => makeMenuOpts('render'))
const compileMenuOpts = computed(() => makeMenuOpts('compile'))

async function onBlockAction(key: string, stage: Stage) {
  const force = key.includes('-force')

  actionLoading.value = stage
  const task = await taskStore.createTask(
    props.projectName,
    stage,
    stage === 'compile' ? undefined : [props.blockId],
    force,
  )
  actionLoading.value = null

  if (task) {
    const stageLabels: Record<string, string> = {
      tts: '生成音频',
      visuals: '生成视觉',
      render: '渲染',
      compile: '编译',
    }
    const label = stageLabels[stage] || stage
    message.success(`${label}任务已提交`)
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

/* Tab B — output pane */
.output-pane {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.output-placeholder {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 100px;
}

.output-actions {
  flex-shrink: 0;
  padding: 10px 12px;
  border-top: 1px solid var(--n-border-color, #e0e0e6);
}

.output-actions-title {
  font-size: 11px;
  font-weight: 600;
  color: #999;
  margin-bottom: 6px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}
</style>
