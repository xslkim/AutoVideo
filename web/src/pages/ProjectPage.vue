<template>
  <div class="project-page">
    <!-- Top bar -->
    <TopBar :project-name="projectName" />

    <!-- Body: left sidebar + center + right panel -->
    <div class="project-body">
      <!-- Left sidebar: block list (placeholder) -->
      <div class="sidebar-left">
        <div class="sidebar-header">块列表</div>
        <div class="sidebar-content">
          <n-empty description="块列表（待实现）" size="small" />
        </div>
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
            <div class="placeholder-pane">脚本编辑器（待实现）</div>
          </n-tab-pane>
          <n-tab-pane name="assets" tab="资源" display-directive="show">
            <div class="placeholder-pane">资源管理（待实现）</div>
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
          <n-empty description="点击块查看详情" size="small" />
        </div>
      </div>
    </div>

    <!-- Bottom task bar (collapsible) -->
    <div class="task-bar" :class="{ 'task-bar--expanded': taskBarExpanded }">
      <div class="task-bar-header" @click="taskBarExpanded = !taskBarExpanded">
        <span class="task-status">● 空闲</span>
        <span class="collapse-icon">{{ taskBarExpanded ? '▼' : '▲' }}</span>
      </div>
      <div v-show="taskBarExpanded" class="task-bar-content">
        <n-empty description="暂无任务" size="small" />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { useRoute } from 'vue-router'
import TopBar from '../components/layout/TopBar.vue'
import MetaEditor from '../components/editors/MetaEditor.vue'

const route = useRoute()
const projectName = computed(() => route.params.name as string)

const activeTab = ref('meta')
const rightCollapsed = ref(false)
const taskBarExpanded = ref(false)
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
  padding: 12px;
}

.collapse-icon {
  font-size: 10px;
  color: #999;
}

/* Bottom task bar */
.task-bar {
  flex-shrink: 0;
  border-top: 1px solid var(--n-border-color, #e0e0e6);
}

.task-bar-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 16px;
  cursor: pointer;
  font-size: 13px;
}

.task-status {
  color: #18a058;
}

.task-bar-content {
  padding: 8px 16px 12px;
  border-top: 1px solid var(--n-border-color, #e0e0e6);
  max-height: 180px;
  overflow-y: auto;
}
</style>
