<template>
  <div class="project-page">
    <!-- Top bar -->
    <TopBar :project-name="projectName" />

    <!-- Body: left sidebar + center + right panel -->
    <div class="project-body">
      <!-- Left sidebar: block list -->
      <div class="sidebar-left">
        <BlockSidebar
          :project-name="projectName"
          :parsed-blocks="parsedBlocks"
          @block-selected="onBlockSelected"
          @script-changed="onScriptChanged"
        />
      </div>

      <!-- Center: main editor area -->
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
            <MetaEditor :project-name="projectName" />
          </n-tab-pane>
          <n-tab-pane name="script" tab="script.md" display-directive="show">
            <ScriptEditor :key="'script-' + scriptEditorKey" :project-name="projectName" @blocks-updated="onBlocksUpdated" />
          </n-tab-pane>
          <n-tab-pane name="assets" tab="资源" display-directive="show">
            <AssetManager :project-name="projectName" />
          </n-tab-pane>
        </n-tabs>
      </div>

      <!-- Right panel: block details (collapsible) -->
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
            @close="onBlockSelected('')"
            @block-saved="onScriptChanged"
            @visual-mode-changed="onVisualModeChanged"
          />
          <n-empty v-else description="点击块查看详情" size="small" />
        </div>
      </div>
    </div>

    <!-- Bottom task bar -->
    <TaskBar :project-name="projectName" />
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { useRoute } from 'vue-router'
import TopBar from '../components/layout/TopBar.vue'
import BlockSidebar from '../components/layout/BlockSidebar.vue'
import BlockPanel from '../components/block/BlockPanel.vue'
import TaskBar from '../components/layout/TaskBar.vue'
import MetaEditor from '../components/editors/MetaEditor.vue'
import ScriptEditor from '../components/editors/ScriptEditor.vue'
import AssetManager from '../components/assets/AssetManager.vue'
import type { ParseResult } from '../utils/scriptParser'
import type { VisualMode } from '../../../server/types/api'

const route = useRoute()
const projectName = computed(() => route.params.name as string)

const activeTab = ref('meta')
const rightCollapsed = ref(false)
const scriptEditorKey = ref(0)

// Parsed blocks from ScriptEditor (for BlockSidebar)
const parsedBlocks = ref<ParseResult | null>(null)

// Selected block for right panel
const selectedBlockId = ref<string | null>(null)
const selectedBlockTitle = ref('')
const selectedBlockVisualMode = ref<VisualMode>('animation')

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
}

function onVisualModeChanged(mode: VisualMode) {
  selectedBlockVisualMode.value = mode
}

function onScriptChanged() {
  // Force reload ScriptEditor to pick up changes made by BlockSidebar
  scriptEditorKey.value++
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

/* Left sidebar */
.sidebar-left {
  width: 220px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  border-right: 1px solid var(--n-border-color, #e0e0e6);
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
  width: 300px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  border-left: 1px solid var(--n-border-color, #e0e0e6);
  transition: width 0.2s;
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
</style>
