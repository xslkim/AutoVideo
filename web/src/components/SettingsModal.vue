<template>
  <n-modal
    v-model:show="visible"
    preset="card"
    title="设置"
    style="width: 560px; max-width: 90vw"
    :mask-closable="true"
    @update-show="(v: boolean) => !v && emit('close')"
  >
    <n-tabs v-model:value="activeTab" type="line" size="small">
      <!-- Anthropic -->
      <n-tab-pane name="anthropic" tab="Anthropic">
        <n-form label-placement="left" label-width="90" :style="{ paddingTop: '12px' }">
          <n-form-item label="API Key">
            <n-input
              v-model:value="form.anthropic.apiKey"
              type="password"
              show-password-on="click"
              placeholder="sk-ant-..."
              clearable
            />
          </n-form-item>
          <n-form-item label="Base URL">
            <n-input v-model:value="form.anthropic.baseURL" placeholder="https://api.anthropic.com" clearable />
          </n-form-item>
          <n-form-item label="Model">
            <n-input v-model:value="form.anthropic.model" placeholder="claude-sonnet-4-6" clearable />
          </n-form-item>
          <n-form-item label="动画并发">
            <n-select
              v-model:value="form.anthropic.concurrency"
              :options="anthropicConcurrencyOptions"
              style="width: 100%"
            />
          </n-form-item>
          <n-form-item>
            <n-button size="small" :loading="testing.anthropic" @click="testService('anthropic')">
              测试连通性
            </n-button>
            <span v-if="testResult.anthropic" :style="{ marginLeft: '12px', fontSize: '13px' }">
              <span v-if="testResult.anthropic.ok" style="color: #18a058">连接成功 ({{ testResult.anthropic.latencyMs }}ms)</span>
              <span v-else style="color: #d03050">{{ testResult.anthropic.message }}</span>
            </span>
          </n-form-item>
        </n-form>
      </n-tab-pane>

      <!-- 文生图 -->
      <n-tab-pane name="imageGen" tab="文生图">
        <n-form label-placement="left" label-width="90" :style="{ paddingTop: '12px' }">
          <n-form-item label="Provider">
            <n-select
              v-model:value="form.imageGen.provider"
              :options="imageGenProviderOptions"
              style="width: 100%"
            />
          </n-form-item>
          <n-form-item label="Base URL">
            <n-input
              v-model:value="form.imageGen.baseURL"
              :placeholder="form.imageGen.provider === 'sensenova' ? 'http://127.0.0.1:8765' : 'https://api.openai.com'"
              clearable
            />
          </n-form-item>
          <n-form-item v-if="form.imageGen.provider === 'openai'" label="API Key">
            <n-input
              v-model:value="form.imageGen.apiKey"
              type="password"
              show-password-on="click"
              placeholder="sk-..."
              clearable
            />
          </n-form-item>
          <n-form-item v-if="form.imageGen.provider === 'openai'" label="Model">
            <n-input v-model:value="form.imageGen.model" placeholder="gpt-image-1" clearable />
          </n-form-item>
          <n-form-item v-if="form.imageGen.provider === 'sensenova'" label="Steps">
            <n-input-number v-model:value="form.imageGen.numSteps" :min="1" :max="60" style="width: 100%" />
          </n-form-item>
          <n-form-item v-if="form.imageGen.provider === 'sensenova'" label="CFG Scale">
            <n-input-number v-model:value="form.imageGen.cfgScale" :min="1" :max="15" :step="0.5" style="width: 100%" />
          </n-form-item>
          <n-form-item label="Size">
            <n-select
              v-model:value="form.imageGen.size"
              :options="sizeOptions"
              placeholder="1920x1080"
              clearable
              style="width: 100%"
            />
          </n-form-item>
          <n-form-item label="Timeout">
            <n-input-number v-model:value="form.imageGen.timeoutMs" :min="10000" :max="600000" :step="10000" style="width: 100%">
              <template #suffix>ms</template>
            </n-input-number>
          </n-form-item>
          <n-form-item label="Concurrency">
            <n-input-number v-model:value="form.imageGen.concurrency" :min="1" :max="8" style="width: 100%" />
          </n-form-item>
          <n-form-item>
            <n-button size="small" :loading="testing.imageGen" @click="testService('imageGen')">
              测试连通性
            </n-button>
            <span v-if="testResult.imageGen" :style="{ marginLeft: '12px', fontSize: '13px' }">
              <span v-if="testResult.imageGen.ok" style="color: #18a058">连接成功 ({{ testResult.imageGen.latencyMs }}ms)</span>
              <span v-else style="color: #d03050">{{ testResult.imageGen.message }}</span>
            </span>
          </n-form-item>
        </n-form>
      </n-tab-pane>

      <!-- VoxCPM -->
      <n-tab-pane name="voxcpm" tab="VoxCPM">
        <n-form label-placement="left" label-width="90" :style="{ paddingTop: '12px' }">
          <n-form-item label="Endpoint">
            <n-input v-model:value="form.voxcpm.endpoint" placeholder="http://127.0.0.1:8000" clearable />
          </n-form-item>
          <n-form-item label="Model Dir">
            <n-input v-model:value="form.voxcpm.modelDir" placeholder="/home/ubuntu/model/voxcpm/VoxCPM2" clearable />
          </n-form-item>
          <n-form-item label="Auto Start">
            <n-switch v-model:value="form.voxcpm.autoStart" />
          </n-form-item>
          <n-form-item label="Concurrency">
            <n-input-number v-model:value="form.voxcpm.concurrency" :min="1" :max="8" style="width: 100%" />
          </n-form-item>
          <n-form-item>
            <n-button size="small" :loading="testing.voxcpm" @click="testService('voxcpm')">
              测试连通性
            </n-button>
            <span v-if="testResult.voxcpm" :style="{ marginLeft: '12px', fontSize: '13px' }">
              <span v-if="testResult.voxcpm.ok" style="color: #18a058">连接成功 ({{ testResult.voxcpm.latencyMs }}ms)</span>
              <span v-else style="color: #d03050">{{ testResult.voxcpm.message }}</span>
            </span>
          </n-form-item>
        </n-form>
      </n-tab-pane>

      <!-- MuseTalk -->
      <n-tab-pane name="musetalk" tab="MuseTalk">
        <n-form label-placement="left" label-width="90" :style="{ paddingTop: '12px' }">
          <n-form-item label="服务地址">
            <n-input v-model:value="form.musetalk.url" placeholder="http://localhost:8001" clearable />
          </n-form-item>
          <n-form-item>
            <n-button size="small" :loading="testing.musetalk" @click="testService('musetalk')">
              测试连通性
            </n-button>
            <span v-if="testResult.musetalk" :style="{ marginLeft: '12px', fontSize: '13px' }">
              <span v-if="testResult.musetalk.ok" style="color: #18a058">连接成功 ({{ testResult.musetalk.latencyMs }}ms)</span>
              <span v-else style="color: #d03050">{{ testResult.musetalk.message }}</span>
            </span>
          </n-form-item>
        </n-form>
      </n-tab-pane>

      <!-- 视觉质量 -->
      <n-tab-pane name="visualQuality" tab="视觉质量">
        <n-form label-placement="left" label-width="120" :style="{ paddingTop: '12px' }">
          <n-form-item label="启用质量闭环">
            <n-switch v-model:value="form.visualQuality.enabled" />
            <span style="margin-left: 12px; font-size: 12px; color: #999">
              动画组件生成后渲染一帧，按指标不达标自动重写
            </span>
          </n-form-item>
          <template v-if="form.visualQuality.enabled">
            <n-form-item label="最小字号比例">
              <n-input-number
                v-model:value="form.visualQuality.minFontCoeff"
                :min="0" :max="0.2" :step="0.01" style="width: 100%"
              >
                <template #suffix>× height</template>
              </n-input-number>
            </n-form-item>
            <n-form-item label="最少可见元素">
              <n-input-number v-model:value="form.visualQuality.minElements" :min="1" :max="20" style="width: 100%" />
            </n-form-item>
            <n-form-item label="最小内容覆盖率">
              <n-input-number
                v-model:value="form.visualQuality.minCoverage"
                :min="0" :max="1" :step="0.05" style="width: 100%"
              />
            </n-form-item>
            <n-form-item label="多模态评审">
              <n-switch v-model:value="form.visualQuality.review" />
              <span style="margin-left: 12px; font-size: 12px; color: #999">
                指标通过后再请模型看图精修（更慢、更贵）
              </span>
            </n-form-item>
            <n-form-item v-if="form.visualQuality.review" label="最大评审轮数">
              <n-input-number v-model:value="form.visualQuality.maxReviewRounds" :min="0" :max="3" style="width: 100%" />
            </n-form-item>
          </template>
        </n-form>
      </n-tab-pane>
    </n-tabs>

    <template #footer>
      <n-space justify="end">
        <n-button @click="onCancel">取消</n-button>
        <n-button type="primary" :loading="saving" @click="onSave">保存</n-button>
      </n-space>
    </template>
  </n-modal>
</template>

<script setup lang="ts">
import { ref, reactive, watch } from 'vue'
import { createDiscreteApi } from 'naive-ui'
import { apiGet, apiPut, apiPost } from '../utils/api'
import type { AppConfigPublic } from '../../../server/types/api'

const { message } = createDiscreteApi(['message'])

const props = defineProps<{
  show: boolean
}>()

const emit = defineEmits<{
  close: []
}>()

// ── Local reactive ──────────────────────────────────────────────────────

const visible = ref(props.show)
watch(() => props.show, (v) => { visible.value = v })

const activeTab = ref('anthropic')
const saving = ref(false)

const sizeOptions = [
  { label: '1920×1080 (16:9 横屏)', value: '1920x1080' },
  { label: '1080×1920 (9:16 竖屏)', value: '1080x1920' },
  { label: '1024×1024 (1:1 方形)', value: '1024x1024' },
]

const imageGenProviderOptions = [
  { label: 'SenseNova-U1（本地 :8765）', value: 'sensenova' },
  { label: 'OpenAI 兼容 API', value: 'openai' },
]

const anthropicConcurrencyOptions = [2, 3, 4, 5, 6, 7, 8].map((v) => ({
  label: String(v),
  value: v,
}))

function clampAnthropicConcurrency(value: number | null | undefined): number {
  const n = value ?? 4
  return Math.min(8, Math.max(2, n))
}

// ── Form state (flat structure matching PUT body) ──────────────────────

const form = reactive({
  anthropic: {
    apiKey: '' as string,
    baseURL: '' as string,
    model: '' as string,
    concurrency: 4 as number | null,
  },
  imageGen: {
    provider: 'sensenova' as 'openai' | 'sensenova',
    baseURL: '' as string,
    apiKey: '' as string,
    model: '' as string,
    size: '' as string,
    timeoutMs: 600000 as number | null,
    concurrency: 1 as number | null,
    numSteps: 15 as number | null,
    cfgScale: 4.0 as number | null,
  },
  voxcpm: {
    endpoint: '' as string,
    modelDir: '' as string,
    autoStart: true as boolean,
    concurrency: 2 as number | null,
  },
  musetalk: {
    url: '' as string,
  },
  visualQuality: {
    enabled: true as boolean,
    minFontCoeff: 0.07 as number | null,
    minElements: 4 as number | null,
    minCoverage: 0.7 as number | null,
    review: true as boolean,
    maxReviewRounds: 1 as number | null,
  },
})

// ── Test state ──────────────────────────────────────────────────────────

const testing = reactive({
  anthropic: false,
  imageGen: false,
  voxcpm: false,
  musetalk: false,
})

const testResult = reactive<Record<string, { ok: boolean; latencyMs?: number; message?: string } | null>>({
  anthropic: null,
  imageGen: null,
  voxcpm: null,
  musetalk: null,
})

// ── Load config ─────────────────────────────────────────────────────────

async function loadConfig() {
  const res = await apiGet<AppConfigPublic>('/api/config', { silent: true })
  if (!res.ok) return

  const c = res.data
  form.anthropic.apiKey = ''
  form.anthropic.baseURL = c.anthropic.baseURL ?? ''
  form.anthropic.model = c.anthropic.model ?? ''
  form.anthropic.concurrency = clampAnthropicConcurrency(c.anthropic.concurrency)

  form.imageGen.provider = c.imageGen.provider ?? 'sensenova'
  form.imageGen.baseURL = c.imageGen.baseURL ?? ''
  form.imageGen.apiKey = ''
  form.imageGen.model = c.imageGen.model ?? ''
  form.imageGen.size = c.imageGen.size ?? ''
  form.imageGen.timeoutMs = c.imageGen.timeoutMs ?? 600000
  form.imageGen.concurrency = c.imageGen.concurrency ?? 1
  form.imageGen.numSteps = c.imageGen.numSteps ?? 15
  form.imageGen.cfgScale = c.imageGen.cfgScale ?? 4.0

  form.voxcpm.endpoint = c.voxcpm.endpoint ?? ''
  form.voxcpm.modelDir = c.voxcpm.modelDir ?? ''
  form.voxcpm.autoStart = c.voxcpm.autoStart ?? true
  form.voxcpm.concurrency = c.voxcpm.concurrency ?? 2

  form.musetalk.url = c.musetalk?.url ?? ''

  form.visualQuality.enabled = c.visualQuality?.enabled ?? true
  form.visualQuality.minFontCoeff = c.visualQuality?.minFontCoeff ?? 0.07
  form.visualQuality.minElements = c.visualQuality?.minElements ?? 4
  form.visualQuality.minCoverage = c.visualQuality?.minCoverage ?? 0.7
  form.visualQuality.review = c.visualQuality?.review ?? true
  form.visualQuality.maxReviewRounds = c.visualQuality?.maxReviewRounds ?? 1

  // Preserve key "set" status — if set, show placeholder text
  if (!c.anthropic.apiKey.set) form.anthropic.apiKey = ''
  if (!c.imageGen.apiKey.set) form.imageGen.apiKey = ''
}

// ── Save ────────────────────────────────────────────────────────────────

async function onSave() {
  saving.value = true
  try {
    // Build patch: only include non-empty apiKey if user typed one
    const patch: Record<string, unknown> = {}

    // Anthropic
    const aPatch: Record<string, unknown> = {}
    if (form.anthropic.apiKey) aPatch.apiKey = form.anthropic.apiKey
    aPatch.baseURL = form.anthropic.baseURL || null
    aPatch.model = form.anthropic.model || null
    aPatch.concurrency = form.anthropic.concurrency
    patch.anthropic = aPatch

    // ImageGen
    const igPatch: Record<string, unknown> = {}
    if (form.imageGen.apiKey) igPatch.apiKey = form.imageGen.apiKey
    igPatch.provider = form.imageGen.provider
    igPatch.baseURL = form.imageGen.baseURL || null
    igPatch.model = form.imageGen.model || null
    igPatch.size = form.imageGen.size || null
    igPatch.timeoutMs = form.imageGen.timeoutMs
    igPatch.concurrency = form.imageGen.concurrency
    igPatch.numSteps = form.imageGen.numSteps
    igPatch.cfgScale = form.imageGen.cfgScale
    patch.imageGen = igPatch

    // VoxCPM
    patch.voxcpm = {
      endpoint: form.voxcpm.endpoint || null,
      modelDir: form.voxcpm.modelDir || null,
      autoStart: form.voxcpm.autoStart,
      concurrency: form.voxcpm.concurrency,
    }

    // MuseTalk
    patch.musetalk = {
      url: form.musetalk.url || null,
    }

    // Visual quality (booleans/numbers — sent as-is)
    patch.visualQuality = {
      enabled: form.visualQuality.enabled,
      minFontCoeff: form.visualQuality.minFontCoeff,
      minElements: form.visualQuality.minElements,
      minCoverage: form.visualQuality.minCoverage,
      review: form.visualQuality.review,
      maxReviewRounds: form.visualQuality.maxReviewRounds,
    }

    const res = await apiPut<{ ok: boolean; config: AppConfigPublic }>('/api/config', patch)
    if (res.ok) {
      message.success('设置已保存')
      emit('close')
    }
  } finally {
    saving.value = false
  }
}

function onCancel() {
  emit('close')
}

// ── Connectivity test ───────────────────────────────────────────────────

async function testService(service: 'anthropic' | 'imageGen' | 'voxcpm' | 'musetalk') {
  testing[service] = true
  testResult[service] = null
  try {
    const res = await apiPost<{ ok: boolean; latencyMs?: number; message?: string }>(
      '/api/config/test',
      { service }
    )
    if (res.ok) {
      testResult[service] = res.data
    } else {
      testResult[service] = { ok: false, message: res.error?.message ?? '请求失败' }
    }
  } catch {
    testResult[service] = { ok: false, message: '请求失败' }
  } finally {
    testing[service] = false
  }
}

// ── Load on mount ───────────────────────────────────────────────────────

loadConfig()
</script>
