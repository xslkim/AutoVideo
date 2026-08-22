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
      <n-space size="small" align="center">
        <span class="concurrency-label">动画并发</span>
        <n-select
          v-model:value="visualConcurrency"
          :options="visualConcurrencyOptions"
          size="small"
          :loading="concurrencySaving"
          :disabled="concurrencySaving"
          style="width: 72px"
          @update:value="onVisualConcurrencyChange"
        />
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
        <!-- Health indicator -->
        <n-popover trigger="hover" placement="bottom-end" :width="260">
          <template #trigger>
            <div
              class="health-dot"
              :class="healthOk ? 'health-ok' : 'health-bad'"
              @click="showDoctor = true"
              title="系统健康状态"
            />
          </template>
          <div class="health-tooltip">
            <div class="health-row">
              <span class="health-label">VoxCPM</span>
              <span :class="doctorStatus.voxcpm">{{ doctorStatus.voxcpm === 'ok' ? '正常' : '异常' }}</span>
            </div>
            <div class="health-row">
              <span class="health-label">Anthropic</span>
              <span :class="doctorStatus.anthropic">{{ doctorStatus.anthropic === 'ok' ? '正常' : '未配置' }}</span>
            </div>
            <div class="health-row">
              <span class="health-label">文生图</span>
              <span :class="doctorStatus.imageGen">{{ doctorStatus.imageGen === 'ok' ? '正常' : '未配置' }}</span>
            </div>
            <div class="health-row">
              <span class="health-label">FFmpeg</span>
              <span :class="doctorStatus.ffmpeg">{{ doctorStatus.ffmpeg === 'ok' ? '正常' : '缺失' }}</span>
            </div>
            <div class="health-row">
              <span class="health-label">Remotion</span>
              <span class="health-ok-text">正常</span>
            </div>
          </div>
        </n-popover>
        <n-button size="small" quaternary @click="showSettings = true">⚙ 设置</n-button>
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

    <!-- Settings modal -->
    <SettingsModal v-if="showSettings" :show="showSettings" @close="showSettings = false" />

    <!-- Doctor diagnostic panel -->
    <n-modal v-model:show="showDoctor" title="系统健康诊断" preset="card" style="width: 480px" :mask-closable="true">
      <div class="doctor-panel" v-if="doctorReport">
        <div class="doctor-item" v-for="item in doctorItems" :key="item.label">
          <div class="doctor-item-header">
            <n-tag :type="item.ok ? 'success' : 'error'" size="small">{{ item.ok ? '正常' : '异常' }}</n-tag>
            <span class="doctor-item-label">{{ item.label }}</span>
          </div>
          <div class="doctor-item-detail" v-if="item.detail">{{ item.detail }}</div>
        </div>
        <div class="doctor-actions">
          <n-button size="small" @click="refreshDoctor" :loading="doctorLoading">重新检测</n-button>
        </div>
      </div>
    </n-modal>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch, onMounted, reactive } from 'vue'
import { useRouter } from 'vue-router'
import { useTaskStore } from '../../stores/taskStore'
import { createDiscreteApi } from 'naive-ui'
import SettingsModal from '../SettingsModal.vue'
import type { DoctorReport, AppConfigPublic } from '../../../../server/types/api'
import { apiGet, apiPut } from '../../utils/api'

const VISUAL_CONCURRENCY_MIN = 2
const VISUAL_CONCURRENCY_MAX = 8

const visualConcurrencyOptions = Array.from(
  { length: VISUAL_CONCURRENCY_MAX - VISUAL_CONCURRENCY_MIN + 1 },
  (_, i) => {
    const v = VISUAL_CONCURRENCY_MIN + i
    return { label: String(v), value: v }
  },
)

function clampVisualConcurrency(value: number | null | undefined): number {
  const n = value ?? 4
  return Math.min(VISUAL_CONCURRENCY_MAX, Math.max(VISUAL_CONCURRENCY_MIN, n))
}

const { message, dialog } = createDiscreteApi(['message', 'dialog'])

const props = defineProps<{
  projectName: string
  nonStandard?: boolean
}>()

const router = useRouter()
const taskStore = useTaskStore()

// ── Loading states ────────────────────────────────────────────────────

const compileLoading = ref(false)
const buildLoading   = ref(false)
const mergeLoading   = ref(false)

// ── Disable logic: same stage already has a pending/running task ──────

const compileDisabled = computed(() =>
  props.nonStandard || taskStore.hasActiveStage('compile') || taskStore.hasActiveStage('build'),
)

const buildDisabled = computed(() =>
  props.nonStandard || taskStore.hasActiveStage('build') || taskStore.hasActiveStage('compile'),
)

const mergeDisabled = computed(() =>
  props.nonStandard || taskStore.hasActiveStage('merge'),
)

// ── Final video preview/download ──────────────────────────────────────

const outputUrl = computed(() =>
  `/api/projects/${props.projectName}/output`,
)

const showPreview = ref(false)
const previewError = ref('')
const showSettings = ref(false)

// ── Animation generation concurrency (anthropic.concurrency) ─────────

const visualConcurrency = ref(4)
const concurrencySaving = ref(false)

async function loadVisualConcurrency() {
  const res = await apiGet<AppConfigPublic>('/api/config', { silent: true })
  if (res.ok) {
    visualConcurrency.value = clampVisualConcurrency(res.data.anthropic?.concurrency)
  }
}

async function onVisualConcurrencyChange(value: number) {
  concurrencySaving.value = true
  try {
    const res = await apiPut<{ ok: boolean }>('/api/config', {
      anthropic: { concurrency: value },
    }, undefined, { silent: true })
    if (!res.ok) {
      message.error('保存并发数失败')
      await loadVisualConcurrency()
    }
  } finally {
    concurrencySaving.value = false
  }
}

// ── Doctor / health indicator ──────────────────────────────────────────

const showDoctor = ref(false)
const doctorReport = ref<DoctorReport | null>(null)
const doctorLoading = ref(false)

const doctorStatus = reactive({
  voxcpm: 'fail' as string,
  anthropic: 'missing' as string,
  imageGen: 'missing' as string,
  ffmpeg: 'missing' as string,
  remotion: 'ok' as string,
})

const healthOk = computed(() =>
  doctorStatus.voxcpm === 'ok' &&
  doctorStatus.anthropic === 'ok' &&
  doctorStatus.imageGen === 'ok' &&
  doctorStatus.ffmpeg === 'ok' &&
  doctorStatus.remotion === 'ok',
)

const doctorItems = computed(() => {
  if (!doctorReport.value) return []
  const r = doctorReport.value
  return [
    {
      label: 'VoxCPM 语音服务',
      ok: r.voxcpm.status === 'ok',
      detail: r.voxcpm.status !== 'ok' && r.voxcpm.message ? r.voxcpm.message : (r.voxcpm.status === 'ok' ? '服务正常' : ''),
    },
    {
      label: 'Anthropic API',
      ok: r.anthropic.status === 'ok',
      detail: r.anthropic.status !== 'ok' && r.anthropic.message ? r.anthropic.message : (r.anthropic.status === 'ok' ? '已配置' : '未配置 API Key'),
    },
    {
      label: '文生图服务',
      ok: r.imageGen.status === 'ok',
      detail: r.imageGen.status !== 'ok' && r.imageGen.message ? r.imageGen.message : (r.imageGen.status === 'ok' ? '已配置' : ''),
    },
    {
      label: 'FFmpeg',
      ok: r.ffmpeg.status === 'ok',
      detail: r.ffmpeg.version ? `版本: ${r.ffmpeg.version}` : '未安装',
    },
    {
      label: 'Remotion / Chromium',
      ok: true,
      detail: r.remotion.version,
    },
  ]
})

async function refreshDoctor() {
  doctorLoading.value = true
  try {
    const resp = await fetch('/api/doctor')
    const data = await resp.json() as DoctorReport
    doctorReport.value = data
    doctorStatus.voxcpm = data.voxcpm.status
    doctorStatus.anthropic = data.anthropic.status
    doctorStatus.imageGen = data.imageGen.status
    doctorStatus.ffmpeg = data.ffmpeg.status
    doctorStatus.remotion = data.remotion.status
  } catch {
    // keep previous state
  } finally {
    doctorLoading.value = false
  }
}

onMounted(() => {
  refreshDoctor()
  loadVisualConcurrency()
})

watch(showSettings, (open) => {
  if (!open) {
    loadVisualConcurrency()
    refreshDoctor()
  }
})

// Clear preview error when modal opens or closes
watch(showPreview, (val) => {
  if (val) previewError.value = ''
})

function onPreviewError() {
  previewError.value = '无法加载成片视频，请确认已执行全量构建'
}

function onDownload() {
  window.open(`${outputUrl.value}?download=1`, '_blank')
}

// ── Action handlers ───────────────────────────────────────────────────

/** Returns true if avatar video exists for this project */
async function hasAvatar(): Promise<boolean> {
  try {
    const resp = await fetch(`/api/projects/${props.projectName}/avatar`, { method: 'HEAD' })
    return resp.ok
  } catch {
    return false
  }
}

/**
 * Show a confirmation dialog when no avatar is found.
 * Resolves true  → user wants to continue without avatar
 * Resolves false → user wants to go back and upload
 */
function confirmNoAvatar(): Promise<boolean> {
  return new Promise((resolve) => {
    dialog.warning({
      title: '未配置头像视频',
      content: '该项目尚未上传头像视频，无法生成口型动画。\n\n上传头像后可在左下角叠加说话的人物头像。',
      positiveText: '继续（不用头像）',
      negativeText: '返回去上传',
      onPositiveClick: () => resolve(true),
      onNegativeClick: () => resolve(false),
      onClose:        () => resolve(false),
    })
  })
}

async function onCompile() {
  compileLoading.value = true
  const task = await taskStore.createTask(props.projectName, 'compile')
  compileLoading.value = false
  if (task) {
    message.success('编译任务已提交')
  }
}

async function onBuild() {
  const avatar = await hasAvatar()
  if (!avatar) {
    const proceed = await confirmNoAvatar()
    if (!proceed) return
  }
  buildLoading.value = true
  const task = await taskStore.createTask(props.projectName, 'build')
  buildLoading.value = false
  if (task) {
    message.success('全量构建任务已提交')
  }
}

async function onMerge() {
  const avatar = await hasAvatar()
  if (!avatar) {
    const proceed = await confirmNoAvatar()
    if (!proceed) return
  }
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

.concurrency-label {
  font-size: 12px;
  color: var(--n-text-color-2, #666);
  white-space: nowrap;
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

/* ── Health indicator ────────────────────────────────────────────────── */

.health-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  cursor: pointer;
  margin-right: 4px;
  transition: background-color 0.2s;
}

.health-dot.health-ok {
  background-color: #18a058;
  box-shadow: 0 0 4px rgba(24, 160, 88, 0.5);
}

.health-dot.health-bad {
  background-color: #d03050;
  box-shadow: 0 0 4px rgba(208, 48, 80, 0.5);
}

.health-tooltip {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 12px;
}

.health-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.health-label {
  color: var(--n-text-color-2, #666);
}

.health-row .ok,
.health-row .health-ok-text {
  color: #18a058;
}

.health-row .fail,
.health-row .missing {
  color: #d03050;
}

/* ── Doctor panel ────────────────────────────────────────────────────── */

.doctor-panel {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.doctor-item {
  padding: 8px 12px;
  border: 1px solid var(--n-border-color, #e0e0e6);
  border-radius: 6px;
}

.doctor-item-header {
  display: flex;
  align-items: center;
  gap: 8px;
}

.doctor-item-label {
  font-weight: 500;
  font-size: 13px;
}

.doctor-item-detail {
  margin-top: 4px;
  font-size: 12px;
  color: var(--n-text-color-2, #999);
  padding-left: 32px;
}

.doctor-actions {
  display: flex;
  justify-content: flex-end;
  padding-top: 8px;
}
</style>
