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
        <n-button
          size="small"
          :disabled="compileDisabled"
          :loading="compileLoading"
          @click="onCompile"
        >
          编译
        </n-button>
        <n-button
          size="small"
          :disabled="buildDisabled"
          :loading="buildLoading"
          @click="onBuild"
        >
          全量构建
        </n-button>
        <n-button
          size="small"
          :disabled="mergeDisabled"
          :loading="mergeLoading"
          @click="onMerge"
        >
          合并视频
        </n-button>
        <n-button size="small" @click="showPreview = true">预览成片</n-button>
        <n-button size="small" @click="onDownload">下载成片</n-button>
        <n-button size="small" quaternary disabled>⚙ 设置</n-button>
      </n-space>
    </div>

    <!-- Final video preview modal -->
    <n-modal v-model:show="showPreview" title="预览成片" preset="card" style="width: 720px" :mask-closable="true">
      <div class="preview-modal-body">
        <video
          v-if="showPreview"
          controls
          autoplay
          :src="outputUrl"
          class="preview-video"
          @error="onPreviewError"
        />
        <div v-if="previewError" class="preview-error">{{ previewError }}</div>
      </div>
    </n-modal>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useTaskStore } from '../../stores/taskStore'
import { createDiscreteApi } from 'naive-ui'

const { message } = createDiscreteApi(['message'])

const props = defineProps<{
  projectName: string
}>()

const router = useRouter()
const taskStore = useTaskStore()

// ── Loading states ────────────────────────────────────────────────────

const compileLoading = ref(false)
const buildLoading   = ref(false)
const mergeLoading   = ref(false)

// ── Disable logic: same stage already has a pending/running task ──────

const compileDisabled = computed(() =>
  taskStore.hasActiveStage('compile') || taskStore.hasActiveStage('build'),
)

const buildDisabled = computed(() =>
  taskStore.hasActiveStage('build') || taskStore.hasActiveStage('compile'),
)

const mergeDisabled = computed(() =>
  taskStore.hasActiveStage('merge'),
)

// ── Final video preview/download ──────────────────────────────────────

const outputUrl = computed(() =>
  `/api/projects/${props.projectName}/output`,
)

const showPreview = ref(false)
const previewError = ref('')

function onPreviewError() {
  previewError.value = '无法加载成片视频，请确认已执行全量构建'
}

function onDownload() {
  window.open(`${outputUrl.value}?download=1`, '_blank')
}

// ── Action handlers ───────────────────────────────────────────────────

async function onCompile() {
  compileLoading.value = true
  const task = await taskStore.createTask(props.projectName, 'compile')
  compileLoading.value = false
  if (task) {
    message.success('编译任务已提交')
  }
}

async function onBuild() {
  buildLoading.value = true
  const task = await taskStore.createTask(props.projectName, 'build')
  buildLoading.value = false
  if (task) {
    message.success('全量构建任务已提交')
  }
}

async function onMerge() {
  mergeLoading.value = true
  const task = await taskStore.createTask(props.projectName, 'merge')
  mergeLoading.value = false
  if (task) {
    message.success('合并视频任务已提交')
  }
}
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

/* ── Preview modal ──────────────────────────────────────────────────── */

.preview-modal-body {
  display: flex;
  flex-direction: column;
  align-items: center;
  min-height: 200px;
}

.preview-video {
  width: 100%;
  max-height: 480px;
  border-radius: 4px;
}

.preview-error {
  color: #d03050;
  font-size: 13px;
  margin-top: 12px;
}
</style>
