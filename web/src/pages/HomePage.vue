<template>
  <div class="home-page">
    <div class="page-header">
      <h1>项目列表</h1>
    </div>

    <!-- Loading state -->
    <div v-if="store.loading" class="state-center">
      <n-spin size="large" />
    </div>

    <!-- Error state -->
    <div v-else-if="store.error" class="state-center">
      <n-result status="error" :description="store.error">
        <template #footer>
          <n-button @click="store.fetchProjects()">重试</n-button>
        </template>
      </n-result>
    </div>

    <!-- Empty state -->
    <div v-else-if="store.projects.length === 0" class="state-center">
      <n-empty description="还没有项目">
        <template #extra>
          <n-space>
            <n-button disabled>创建第一个项目</n-button>
            <n-button disabled>试用 Demo</n-button>
          </n-space>
        </template>
      </n-empty>
    </div>

    <!-- Project grid -->
    <div v-else class="project-grid">
      <div
        v-for="proj in store.projects"
        :key="proj.name"
        class="project-card"
        @click="router.push('/project/' + proj.name)"
      >
        <!-- Non-standard badge -->
        <n-tag
          v-if="proj.nonStandard"
          type="warning"
          size="small"
          class="non-standard-tag"
        >
          非标准
        </n-tag>

        <div class="card-title">{{ proj.title }}</div>
        <div class="card-name">{{ proj.name }}</div>

        <n-divider style="margin: 8px 0" />

        <div class="card-meta">
          <span>{{ proj.blockCount }} 个块</span>
          <n-tag v-if="proj.hasFinal" type="success" size="small">有成片</n-tag>
        </div>

        <div v-if="proj.latestBuildAt" class="card-time">
          最近构建：{{ formatDate(proj.latestBuildAt) }}
        </div>
        <div v-else class="card-time card-time--none">尚未构建</div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useProjectStore } from '../stores/projectStore'

const router = useRouter()
const store = useProjectStore()

onMounted(() => {
  store.fetchProjects()
})

function formatDate(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}
</script>

<style scoped>
.home-page {
  padding: 24px;
  max-width: 1200px;
  margin: 0 auto;
}

.page-header h1 {
  margin: 0 0 24px;
  font-size: 24px;
}

.state-center {
  display: flex;
  justify-content: center;
  align-items: center;
  min-height: 300px;
}

.project-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 16px;
}

.project-card {
  position: relative;
  padding: 16px;
  border: 1px solid #e0e0e6;
  border-radius: 8px;
  cursor: pointer;
  background: #fff;
  transition: box-shadow 0.2s, border-color 0.2s;
}

.project-card:hover {
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.1);
  border-color: #18a058;
}

.non-standard-tag {
  position: absolute;
  top: 12px;
  right: 12px;
}

.card-title {
  font-size: 16px;
  font-weight: 600;
  margin-bottom: 4px;
  padding-right: 60px;
}

.card-name {
  font-size: 12px;
  color: #999;
  margin-bottom: 4px;
}

.card-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: #555;
}

.card-time {
  margin-top: 6px;
  font-size: 12px;
  color: #999;
}

.card-time--none {
  color: #bbb;
}
</style>
