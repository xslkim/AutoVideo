<template>
  <div class="project-page">
    <!-- Top bar -->
    <TopBar :project-name="projectName" :non-standard="nonStandard" />

    <!-- Non-standard project warning banner -->
    <n-alert
      v-if="nonStandard"
      type="error"
      :bordered="false"
      class="nonstandard-banner"
    >
      <template #header>
        该项目使用非标准 project.json 配置，编辑功能已禁用
      </template>
      项目的 project.json 包含非标准字段（如自定义 meta 路径或多脚本文件），在此模式下不支持写入操作。请将 project.json 恢复为标准格式后方可编辑。
    </n-alert>

    <!-- Body: left sidebar + center + right panel (resizable) -->
    <div class="project-body">
      <n-split direction="horizontal" default-size="220px" :min="120" :max="400">
        <template #1>
          <div class="sidebar-left">
            <BlockSidebar
              :project-name="projectName"
              :parsed-blocks="parsedBlocks"
              :disabled="nonStandard"
              @block-selected="onBlockSelected"
              @script-changed="onScriptChanged"
            />
          </div>
        </template>
        <template #2>
          <div class="right-side">
            <n-split direction="horizontal" :default-size="0.72" :min="0.35" :max="0.9">
              <template #1>
                <div class="main-area">
                  <n-tabs
                    v-model:value="activeTab"
                    type="line"
                    size="small"
                    :style="{ height: '100%', display: 'flex', flexDirection: 'column' }"
                    :pane-wrapper-style="{ flex: 1, overflow: 'hidden', minHeight: 0 }"
                    :pane-style="{ height: '100%', overflow: 'hidden', padding: 0 }"
                  >
                    <n-tab-pane name="meta" tab="meta.md" display-directive="show">
                      <MetaEditor :project-name="projectName" :disabled="nonStandard" />
                    </n-tab-pane>
                    <n-tab-pane name="script" tab="script.md" display-directive="show">
                      <ScriptEditor :key="'script-' + scriptEditorKey" :project-name="projectName" :disabled="nonStandard" @blocks-updated="onBlocksUpdated" />
                    </n-tab-pane>
                    <n-tab-pane name="assets" tab="资源" display-directive="show">
                      <AssetManager :project-name="projectName" />
                    </n-tab-pane>
                  </n-tabs>
                </div>
              </template>
              <template #2>
                <div class="panel-right" :class="{ 'panel-right--collapsed': rightCollapsed }">
                  <div class="panel-header" @click="rightCollapsed = !rightCollapsed">
                    <span>块详情</span>
                    <span class="collapse-icon">{{ rightCollapsed ? '◀' : '▶' }}</span>
                  </div>
                  <div v-show="!rightCollapsed" class="panel-content">
                    <BlockPanel
                      v-if="selectedBlockId"
                      :key="'bp-' + selectedBlockId"
                      :project-name="projectName"
                      :block-id="selectedBlockId"
                      :block-title="selectedBlockTitle"
                      :visual-mode="selectedBlockVisualMode"
                      :enter="selectedBlockEnter"
                      :exit="selectedBlockExit"
                      :image-source="selectedBlockImageSource"
                      :disabled="nonStandard"
                      @close="onBlockSelected('')"
                      @block-saved="onScriptChanged"
                      @visual-mode-changed="onVisualModeChanged"
                    />
                    <n-empty v-else description="点击块查看详情" size="small" />
                  </div>
                </div>
              </template>
            </n-split>
          </div>
        </template>
      </n-split>
    </div>

    <!-- Bottom task bar -->
    <TaskBar :project-name="projectName" />

    <!-- Asset upload dialog (shown on missing-file errors) -->
    <AssetUploadDialog
      :show="showUploadDialog"
      :error-message="uploadErrorMsg"
      :project-name="projectName"
      @update:show="showUploadDialog = $event"
      @uploaded="onUploadDone"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { useRoute } from 'vue-router'
import { NSplit } from 'naive-ui'
import TopBar from '../components/layout/TopBar.vue'
import BlockSidebar from '../components/layout/BlockSidebar.vue'
import BlockPanel from '../components/block/BlockPanel.vue'
import TaskBar from '../components/layout/TaskBar.vue'
import MetaEditor from '../components/editors/MetaEditor.vue'
import ScriptEditor from '../components/editors/ScriptEditor.vue'
import AssetManager from '../components/assets/AssetManager.vue'
import AssetUploadDialog from '../components/task/AssetUploadDialog.vue'
import { useTaskStore } from '../stores/taskStore'
import { apiGet } from '../utils/api'
import type { ParseResult } from '../utils/scriptParser'
import type { VisualMode } from '../../../server/types/api'

const route = useRoute()
const projectName = computed(() => route.params.name as string)

const activeTab = ref('meta')
const rightCollapsed = ref(false)
const scriptEditorKey = ref(0)
const nonStandard = ref(false)

// Parsed blocks from ScriptEditor (for BlockSidebar)
const parsedBlocks = ref<ParseResult | null>(null)

// Selected block for right panel
const selectedBlockId = ref<string | null>(null)
const selectedBlockTitle = ref('')
const selectedBlockVisualMode = ref<VisualMode>('animation')
const selectedBlockImageSource = ref<string | undefined>(undefined)
const selectedBlockEnter = ref('fade')
const selectedBlockExit = ref('fade')

// Fetch project detail (for nonStandard flag)
async function fetchProjectDetail() {
  const result = await apiGet<{ nonStandard: boolean }>(`/api/projects/${projectName.value}`, { silent: true })
  if (result.ok) {
    nonStandard.value = result.data.nonStandard
  }
}

onMounted(() => {
  fetchProjectDetail()
})

watch(projectName, () => {
  fetchProjectDetail()
})

function onBlocksUpdated(result: ParseResult) {
  parsedBlocks.value = result
}

function onBlockSelected(id: string) {
  if (!id) {
    selectedBlockId.value = null
    selectedBlockTitle.value = ''
    return
  }
  selectedBlockId.value = id
  const block = parsedBlocks.value?.blocks.find(b => b.id === id)
  selectedBlockTitle.value = block?.title ?? ''
  selectedBlockVisualMode.value = block?.visualMode ?? 'animation'
  selectedBlockImageSource.value = (block as any)?.imageSource ?? undefined
  selectedBlockEnter.value = (block as any)?.enter ?? 'fade'
  selectedBlockExit.value = (block as any)?.exit ?? 'fade'
}

function onVisualModeChanged(mode: VisualMode) {
  selectedBlockVisualMode.value = mode
}

function onScriptChanged() {
  // Force reload ScriptEditor to pick up changes made by BlockSidebar
  scriptEditorKey.value++
}

// ── Global asset upload dialog ─────────────────────────────────────────

const taskStore = useTaskStore()
const showUploadDialog = ref(false)
const uploadErrorMsg = ref('')
let shownUploadForTaskIds = new Set<string>()
// Only trigger for tasks that fail after page load (avoid stale tasks in history)
let pageLoadTime = Date.now()

watch(
  () => taskStore.projectTasks,
  (tasks) => {
    for (const task of tasks) {
      if (task.status !== 'failed') continue
      if (shownUploadForTaskIds.has(task.id)) continue
      // Skip tasks that failed before this page was loaded
      if (task.finishedAt && task.finishedAt < pageLoadTime) continue
      const msg = task.errorMessage ?? ''
      if (/referenced file not found/.test(msg) || /voiceRef file not found/.test(msg)) {
        shownUploadForTaskIds.add(task.id)
        uploadErrorMsg.value = msg
        showUploadDialog.value = true
        return
      }
    }
  },
  { deep: true },
)

function onUploadDone() {
  showUploadDialog.value = false
}
</script>

<style scoped>
.project-page {
  display: flex;
  flex-direction: column;
  height: 100vh;
  overflow: hidden;
}

.project-body {
  display: flex;
  flex: 1;
  overflow: hidden;
  min-height: 0;
}

/* Right side wrapper (contains main-area + panel-right split) */
.right-side {
  flex: 1;
  display: flex;
  overflow: hidden;
  min-width: 0;
}

/* Left sidebar */
.sidebar-left {
  height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.sidebar-header {
  padding: 10px 12px;
  font-size: 13px;
  font-weight: 600;
  color: #666;
  border-bottom: 1px solid var(--n-border-color, #e0e0e6);
  flex-shrink: 0;
}

.sidebar-content {
  flex: 1;
  overflow-y: auto;
  padding: 12px;
}

/* Center main area */
.main-area {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  min-width: 0;
}

.main-area :deep(.n-tabs-nav) {
  flex-shrink: 0;
  padding: 0 8px;
}

.placeholder-pane {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: #999;
  font-size: 14px;
}

/* Right panel */
.panel-right {
  height: 100%;
  display: flex;
  flex-direction: column;
  border-left: 1px solid var(--n-border-color, #e0e0e6);
  overflow: hidden;
}

.panel-right--collapsed {
  width: 32px;
}

.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 10px;
  font-size: 13px;
  font-weight: 600;
  color: #666;
  border-bottom: 1px solid var(--n-border-color, #e0e0e6);
  cursor: pointer;
  flex-shrink: 0;
  white-space: nowrap;
  overflow: hidden;
}

.panel-right--collapsed .panel-header {
  flex-direction: column;
  gap: 6px;
  padding: 10px 6px;
  writing-mode: vertical-lr;
  text-orientation: mixed;
}

.panel-content {
  flex: 1;
  overflow-y: auto;
  padding: 0;
}

.collapse-icon {
  font-size: 10px;
  color: #999;
}

/* Non-standard banner */
.nonstandard-banner {
  border-radius: 0;
  flex-shrink: 0;
}
</style>
