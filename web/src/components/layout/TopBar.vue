<template>
  <div class="top-bar">
    <div class="top-bar-left">
      <n-breadcrumb>
        <n-breadcrumb-item @click="router.push('/')" style="cursor: pointer">
          首页
        </n-breadcrumb-item>
        <n-breadcrumb-item>{{ projectName }}</n-breadcrumb-item>
      </n-breadcrumb>
    </div>
    <div class="top-bar-actions">
      <n-space size="small">
        <n-button size="small" disabled>编译</n-button>
        <n-button size="small" disabled>全量构建</n-button>
        <n-button size="small" disabled>合并视频</n-button>
        <n-button size="small" disabled>预览成片</n-button>
        <n-button size="small" disabled>下载成片</n-button>
        <n-button size="small" quaternary>⚙ 设置</n-button>
      </n-space>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useRouter } from 'vue-router'

const props = defineProps<{
  projectName: string
}>()

const router = useRouter()
</script>

<style scoped>
.top-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 16px;
  height: 48px;
  border-bottom: 1px solid var(--n-border-color, #e0e0e6);
  background: var(--n-color, #fff);
  flex-shrink: 0;
}

.top-bar-left {
  display: flex;
  align-items: center;
}

.top-bar-actions {
  display: flex;
  align-items: center;
}
</style>
