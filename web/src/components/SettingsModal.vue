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
      <!-- AI Agent（组件生成 / 视觉评审） -->
      <n-tab-pane name="anthropic" tab="AI Agent">
        <n-form label-placement="left" label-width="90" :style="{ paddingTop: '12px' }">
          <n-form-item label="Provider">
            <n-select
              v-model:value="form.anthropic.provider"
              :options="agentProviderOptions"
              style="width: 100%"
            />
          </n-form-item>

          <!-- API 模式：key / baseURL / model -->
          <template v-if="form.anthropic.provider === 'anthropic-api'">
            <n-form-item label="API Key">
              <n-input
                v-model:value="form.anthropic.apiKey"
                type="password"
                show-password-on="click"
                :placeholder="anthropicApiKeyPlaceholder"
                clearable
                autocomplete="off"
              />
            </n-form-item>
            <n-form-item label="Base URL">
              <n-select
                v-model:value="form.anthropic.baseURL"
                :options="agentBaseUrlOptions"
                placeholder="https://api.anthropic.com"
                filterable
                tag
                clearable
                style="width: 100%"
              />
            </n-form-item>
            <n-form-item label="Model">
              <n-select
                v-model:value="form.anthropic.model"
                :options="agentModelOptions"
                placeholder="claude-sonnet-4-6"
                filterable
                tag
                clearable
                style="width: 100%"
              />
            </n-form-item>
            <n-form-item label="思考强度">
              <n-select
                v-model:value="form.anthropic.thinking"
                :options="thinkingOptions"
                style="width: 100%"
              />
            </n-form-item>
          </template>

          <!-- CLI 模式：binary 路径 / 超时 / opencode·codex 模型 -->
          <template v-else>
            <n-form-item label="CLI 路径">
              <n-input
                v-model:value="form.anthropic.cliPath"
                :placeholder="cliPathPlaceholder"
                clearable
              />
            </n-form-item>
            <n-form-item v-if="form.anthropic.provider === 'opencode-cli'" label="Model">
              <n-input
                v-model:value="form.anthropic.model"
                placeholder="provider/model（如 deepseek/deepseek-chat）"
                clearable
              />
            </n-form-item>
            <template v-else-if="form.anthropic.provider === 'codex-cli'">
              <n-form-item label="Model">
                <n-select
                  v-model:value="form.anthropic.model"
                  :options="codexModelOptions"
                  placeholder="留空 = codex 默认模型"
                  filterable
                  tag
                  clearable
                  style="width: 100%"
                />
              </n-form-item>
              <n-form-item label="Base URL">
                <n-select
                  v-model:value="form.anthropic.baseURL"
                  :options="codexBaseUrlOptions"
                  placeholder="留空 = 使用 codex 自身配置（ChatGPT 登录 / config.toml）"
                  filterable
                  tag
                  clearable
                  style="width: 100%"
                />
              </n-form-item>
              <n-form-item label="API Key">
                <n-input
                  v-model:value="form.anthropic.apiKey"
                  type="password"
                  show-password-on="click"
                  :placeholder="anthropicApiKeyPlaceholder"
                  clearable
                  autocomplete="off"
                />
              </n-form-item>
            </template>
            <n-form-item v-else label="Model">
              <span style="font-size: 12px; color: #999">
                claude CLI 使用 claude login 账号的默认模型（不透传 model）
              </span>
            </n-form-item>
            <n-form-item label="CLI 超时">
              <n-input-number
                v-model:value="form.anthropic.cliTimeoutMs"
                :min="30000" :max="3600000" :step="30000" style="width: 100%"
              >
                <template #suffix>ms</template>
              </n-input-number>
            </n-form-item>
          </template>

          <n-form-item label="动画并发">
            <n-select
              v-model:value="form.anthropic.concurrency"
              :options="anthropicConcurrencyOptions"
              style="width: 100%"
            />
          </n-form-item>

          <n-divider style="margin: 4px 0 12px" />
          <n-form-item label="独立评审模型">
            <n-switch v-model:value="form.anthropic.reviewEnabled" />
            <span style="margin-left: 12px; font-size: 12px; color: #999">
              生成模型无视觉能力时（如 deepseek-chat），评审需指定支持看图的模型
            </span>
          </n-form-item>
          <template v-if="form.anthropic.reviewEnabled">
            <n-form-item label="Provider">
              <n-select
                v-model:value="form.anthropic.review.provider"
                :options="agentProviderOptions"
                placeholder="同生成 provider"
                clearable
                style="width: 100%"
              />
            </n-form-item>
            <n-form-item label="Model">
              <n-select
                v-model:value="form.anthropic.review.model"
                :options="agentModelOptions"
                placeholder="同生成模型"
                filterable
                tag
                clearable
                style="width: 100%"
              />
            </n-form-item>
            <n-form-item label="Base URL">
              <n-select
                v-model:value="form.anthropic.review.baseURL"
                :options="agentBaseUrlOptions"
                placeholder="同生成 Base URL"
                filterable
                tag
                clearable
                style="width: 100%"
              />
            </n-form-item>
            <n-form-item label="API Key">
              <n-input
                v-model:value="form.anthropic.review.apiKey"
                type="password"
                show-password-on="click"
                :placeholder="reviewApiKeyPlaceholder"
                clearable
                autocomplete="off"
              />
            </n-form-item>
          </template>

          <n-form-item>
            <n-button size="small" :loading="testing.anthropic" @click="testService('anthropic')">
              测试连通性
            </n-button>
            <span v-if="testResult.anthropic" :style="{ marginLeft: '12px', fontSize: '13px' }">
              <span v-if="testResult.anthropic.ok" style="color: #18a058">
                连接成功 ({{ testResult.anthropic.latencyMs }}ms{{ testResult.anthropic.message ? ' · ' + testResult.anthropic.message : '' }})
              </span>
              <span v-else style="color: #d03050">{{ testResult.anthropic.message }}</span>
            </span>
            <div style="margin-top: 6px; font-size: 12px; color: #999">
              测试使用当前输入，不必先保存；构建任务仍需点右下角「保存」。
            </div>
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
              :placeholder="imageGenApiKeyPlaceholder"
              clearable
              autocomplete="off"
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

      <!-- 语音合成（TTS 底座切换） -->
      <n-tab-pane name="voxcpm" tab="语音合成">
        <n-form label-placement="left" label-width="90" :style="{ paddingTop: '12px' }">
          <n-form-item label="TTS 底座">
            <n-select
              v-model:value="form.tts.provider"
              :options="ttsProviderOptions"
              style="width: 100%"
            />
          </n-form-item>
          <n-alert type="info" :bordered="false" style="margin-bottom: 12px; font-size: 12px">
            切换底座后需启动对应服务，见 third_servers/README.md
          </n-alert>

          <!-- VoxCPM2：行级延续链 -->
          <template v-if="form.tts.provider === 'voxcpm'">
            <n-form-item label="Endpoint">
              <n-input v-model:value="form.voxcpm.endpoint" placeholder="http://127.0.0.1:8000" clearable />
            </n-form-item>
            <n-form-item label="Model Dir">
              <n-input v-model:value="form.voxcpm.modelDir" placeholder="/path/to/VoxCPM2" clearable />
            </n-form-item>
            <n-form-item label="Concurrency">
              <n-input-number v-model:value="form.voxcpm.concurrency" :min="1" :max="8" style="width: 100%" />
            </n-form-item>
          </template>

          <!-- Fun-CosyVoice3：固定参考音 -->
          <template v-else>
            <n-form-item label="Endpoint">
              <n-input v-model:value="form.cosyvoice.endpoint" placeholder="http://127.0.0.1:8002" clearable />
            </n-form-item>
            <n-form-item label="Model Dir">
              <n-input v-model:value="form.cosyvoice.modelDir" placeholder="/path/to/Fun-CosyVoice3-0.5B" clearable />
            </n-form-item>
            <n-form-item label="参考文本">
              <n-input
                v-model:value="form.cosyvoice.referenceText"
                placeholder="参考音频逐字稿（zero-shot 必需；留空回退 voiceRef 同名 .txt）"
                clearable
              />
            </n-form-item>
            <n-form-item label="文本规范化">
              <n-switch v-model:value="form.cosyvoice.normalize" />
            </n-form-item>
            <n-form-item label="Concurrency">
              <n-input-number v-model:value="form.cosyvoice.concurrency" :min="1" :max="8" style="width: 100%" />
            </n-form-item>
          </template>

          <n-form-item label="合成 QA 门">
            <n-switch v-model:value="form.tts.qa.enabled" />
            <span style="margin-left: 12px; font-size: 12px; color: #999">
              每条 take 先过 ffmpeg 分析，不达标自动加盐重 roll
            </span>
          </n-form-item>

          <n-form-item>
            <n-button size="small" :loading="currentTtsTesting" @click="testService(form.tts.provider)">
              测试连通性
            </n-button>
            <span v-if="currentTtsResult" :style="{ marginLeft: '12px', fontSize: '13px' }">
              <span v-if="currentTtsResult.ok" style="color: #18a058">连接成功 ({{ currentTtsResult.latencyMs }}ms)</span>
              <span v-else style="color: #d03050">{{ currentTtsResult.message }}</span>
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
            <n-form-item label="主标题最小字号比例">
              <n-input-number
                v-model:value="form.visualQuality.minFontCoeff"
                :min="0" :max="0.2" :step="0.01" style="width: 100%"
              >
                <template #suffix>× height</template>
              </n-input-number>
            </n-form-item>
            <n-form-item label="正文最小字号比例">
              <n-input-number
                v-model:value="form.visualQuality.minAnyFontCoeff"
                :min="0" :max="0.1" :step="0.002" style="width: 100%"
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
import { ref, reactive, watch, computed } from 'vue'
import { createDiscreteApi } from 'naive-ui'
import { apiGet, apiPut, apiPost } from '../utils/api'
import type { AppConfigPublic, ThinkingMode } from '../../../server/types/api'

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

const ttsProviderOptions = [
  { label: 'Fun-CosyVoice3（固定参考音，推荐）', value: 'cosyvoice' },
  { label: 'VoxCPM2（行级延续链）', value: 'voxcpm' },
]

const agentProviderOptions = [
  { label: 'Anthropic 兼容 API（Claude / DeepSeek / GLM / Kimi）', value: 'anthropic-api' },
  { label: 'Claude CLI（claude login 凭证）', value: 'claude-cli' },
  { label: 'OpenCode CLI（模型在 opencode 里配置）', value: 'opencode-cli' },
  { label: 'Codex CLI（ChatGPT 登录 / DeepSeek / GLM via OpenRouter）', value: 'codex-cli' },
]

const agentBaseUrlOptions = [
  { label: 'Anthropic 官方 (api.anthropic.com)', value: 'https://api.anthropic.com' },
  { label: 'DeepSeek (api.deepseek.com/anthropic)', value: 'https://api.deepseek.com/anthropic' },
  { label: '智谱 GLM (open.bigmodel.cn/api/anthropic)', value: 'https://open.bigmodel.cn/api/anthropic' },
  { label: 'Kimi 月之暗面 (api.moonshot.cn/anthropic)', value: 'https://api.moonshot.cn/anthropic' },
  { label: 'Kimi 国际版 (api.moonshot.ai/anthropic)', value: 'https://api.moonshot.ai/anthropic' },
  { label: 'Kimi Code 订阅包月 (api.kimi.com/coding)', value: 'https://api.kimi.com/coding' },
]

const agentModelOptions = [
  { label: 'claude-sonnet-4-6', value: 'claude-sonnet-4-6' },
  { label: 'deepseek-chat', value: 'deepseek-chat' },
  { label: 'deepseek-reasoner', value: 'deepseek-reasoner' },
  { label: 'glm-4.6', value: 'glm-4.6' },
  { label: 'kimi-k3（Kimi K3 / Kimi Code 订阅）', value: 'kimi-k3' },
  { label: 'k3-256k（Kimi K3，256K 上下文）', value: 'k3-256k' },
]

// 思考强度（仅 anthropic-api 生效）：off = thinking disabled；
// 其余档位对应 thinking.budget_tokens，驱动会 clamp 到 max_tokens-1。
const thinkingOptions = [
  { label: '关闭（默认）', value: 'off' },
  { label: '低（budget 2048）', value: 'low' },
  { label: '中（budget 8192）', value: 'medium' },
  { label: '高（budget 32768）', value: 'high' },
]

// codex 只支持 OpenAI Responses API：DeepSeek 官方端点原生支持；
// GLM 官方端点不支持，需经 OpenRouter（z-ai/*）或本地转换代理接入。
const codexBaseUrlOptions = [
  { label: 'DeepSeek 官方 (api.deepseek.com)', value: 'https://api.deepseek.com' },
  { label: 'OpenRouter（GLM 等第三方模型）(openrouter.ai/api/v1)', value: 'https://openrouter.ai/api/v1' },
]

const codexModelOptions = [
  { label: 'deepseek-chat（DeepSeek 官方）', value: 'deepseek-chat' },
  { label: 'deepseek-reasoner（DeepSeek 官方）', value: 'deepseek-reasoner' },
  { label: 'z-ai/glm-4.6（OpenRouter）', value: 'z-ai/glm-4.6' },
]

const cliPathPlaceholder = computed(() => {
  if (form.anthropic.provider === 'opencode-cli') return 'opencode'
  if (form.anthropic.provider === 'codex-cli') return 'codex'
  return 'claude'
})

const anthropicConcurrencyOptions = [2, 3, 4, 5, 6, 7, 8].map((v) => ({
  label: String(v),
  value: v,
}))

const savedKeys = reactive({
  anthropicLast4: '' as string,
  imageGenLast4: '' as string,
  reviewLast4: '' as string,
})

const anthropicApiKeyPlaceholder = computed(() => {
  if (form.anthropic.provider === 'codex-cli') {
    return savedKeys.anthropicLast4
      ? `已保存（末四位 ${savedKeys.anthropicLast4}），留空保持不变`
      : '配了 Base URL 时填写（DeepSeek / OpenRouter / GLM key）'
  }
  return savedKeys.anthropicLast4
    ? `已保存（末四位 ${savedKeys.anthropicLast4}），留空保持不变`
    : 'sk-ant-... / sk-...（DeepSeek）/ GLM key / Kimi key'
})

const reviewApiKeyPlaceholder = computed(() => {
  return savedKeys.reviewLast4
    ? `已保存（末四位 ${savedKeys.reviewLast4}），留空保持不变`
    : '留空沿用生成配置的 Key'
})

const imageGenApiKeyPlaceholder = computed(() => {
  return savedKeys.imageGenLast4
    ? `已保存（末四位 ${savedKeys.imageGenLast4}），留空保持不变`
    : 'sk-...'
})

function clampAnthropicConcurrency(value: number | null | undefined): number {
  const n = value ?? 4
  return Math.min(8, Math.max(2, n))
}

// ── Form state (flat structure matching PUT body) ──────────────────────

const form = reactive({
  anthropic: {
    provider: 'anthropic-api' as 'anthropic-api' | 'claude-cli' | 'opencode-cli' | 'codex-cli',
    apiKey: '' as string,
    baseURL: '' as string | null,
    model: '' as string | null,
    cliPath: '' as string,
    cliTimeoutMs: 600000 as number | null,
    concurrency: 4 as number | null,
    thinking: 'off' as ThinkingMode,
    reviewEnabled: false as boolean,
    review: {
      provider: null as 'anthropic-api' | 'claude-cli' | 'opencode-cli' | 'codex-cli' | null,
      model: '' as string | null,
      baseURL: '' as string | null,
      apiKey: '' as string,
    },
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
    concurrency: 2 as number | null,
  },
  tts: {
    provider: 'voxcpm' as 'voxcpm' | 'cosyvoice',
    qa: {
      enabled: true as boolean,
      maxRetries: 2 as number | null,
    },
  },
  cosyvoice: {
    endpoint: '' as string,
    modelDir: '' as string,
    concurrency: 1 as number | null,
    referenceText: '' as string,
    normalize: true as boolean,
  },
  musetalk: {
    url: '' as string,
  },
  visualQuality: {
    enabled: true as boolean,
    minFontCoeff: 0.07 as number | null,
    minAnyFontCoeff: 0.028 as number | null,
    minElements: 4 as number | null,
    minCoverage: 0.6 as number | null,
    review: true as boolean,
    maxReviewRounds: 1 as number | null,
  },
})

// ── Test state ──────────────────────────────────────────────────────────

const testing = reactive({
  anthropic: false,
  imageGen: false,
  voxcpm: false,
  cosyvoice: false,
  musetalk: false,
})

const testResult = reactive<Record<string, { ok: boolean; latencyMs?: number; message?: string } | null>>({
  anthropic: null,
  imageGen: null,
  voxcpm: null,
  cosyvoice: null,
  musetalk: null,
})

// 语音合成 tab：连通性测试跟随当前选中的 TTS 底座
const currentTtsTesting = computed(() => testing[form.tts.provider])
const currentTtsResult = computed(() => testResult[form.tts.provider])

// ── Load config ─────────────────────────────────────────────────────────

async function loadConfig() {
  const res = await apiGet<AppConfigPublic>('/api/config', { silent: true })
  if (!res.ok) return

  const c = res.data
  form.anthropic.provider =
    c.anthropic.provider ?? (c.anthropic.useCLI ? 'claude-cli' : 'anthropic-api')
  form.anthropic.apiKey = ''
  form.anthropic.baseURL = c.anthropic.baseURL ?? ''
  form.anthropic.model = c.anthropic.model ?? ''
  form.anthropic.cliPath = c.anthropic.cliPath ?? ''
  form.anthropic.cliTimeoutMs = c.anthropic.cliTimeoutMs ?? 600000
  form.anthropic.concurrency = clampAnthropicConcurrency(c.anthropic.concurrency)
  form.anthropic.thinking = c.anthropic.thinking ?? 'off'
  form.anthropic.reviewEnabled = !!c.anthropic.review
  form.anthropic.review.provider = c.anthropic.review?.provider ?? null
  form.anthropic.review.model = c.anthropic.review?.model ?? ''
  form.anthropic.review.baseURL = c.anthropic.review?.baseURL ?? ''
  form.anthropic.review.apiKey = ''

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
  form.voxcpm.concurrency = c.voxcpm.concurrency ?? 2

  form.tts.provider = c.tts?.provider ?? 'voxcpm'
  form.tts.qa.enabled = c.tts?.qa?.enabled ?? true
  form.tts.qa.maxRetries = c.tts?.qa?.maxRetries ?? 2

  form.cosyvoice.endpoint = c.cosyvoice?.endpoint ?? ''
  form.cosyvoice.modelDir = c.cosyvoice?.modelDir ?? ''
  form.cosyvoice.concurrency = c.cosyvoice?.concurrency ?? 1
  form.cosyvoice.referenceText = c.cosyvoice?.referenceText ?? ''
  form.cosyvoice.normalize = c.cosyvoice?.normalize ?? true

  form.musetalk.url = c.musetalk?.url ?? ''

  form.visualQuality.enabled = c.visualQuality?.enabled ?? true
  form.visualQuality.minFontCoeff = c.visualQuality?.minFontCoeff ?? 0.07
  form.visualQuality.minAnyFontCoeff = c.visualQuality?.minAnyFontCoeff ?? 0.028
  form.visualQuality.minElements = c.visualQuality?.minElements ?? 4
  form.visualQuality.minCoverage = c.visualQuality?.minCoverage ?? 0.6
  form.visualQuality.review = c.visualQuality?.review ?? true
  form.visualQuality.maxReviewRounds = c.visualQuality?.maxReviewRounds ?? 1

  savedKeys.anthropicLast4 = c.anthropic.apiKey.set ? (c.anthropic.apiKey.last4 ?? '') : ''
  savedKeys.imageGenLast4 = c.imageGen.apiKey.set ? (c.imageGen.apiKey.last4 ?? '') : ''
  savedKeys.reviewLast4 = c.anthropic.review?.apiKey.set ? (c.anthropic.review.apiKey.last4 ?? '') : ''
}

// ── Save ────────────────────────────────────────────────────────────────

async function onSave() {
  saving.value = true
  try {
    // Build patch: only include non-empty apiKey if user typed one
    const patch: Record<string, unknown> = {}

    // AI Agent
    const aPatch: Record<string, unknown> = {}
    aPatch.provider = form.anthropic.provider
    const anthropicKey = form.anthropic.apiKey.trim()
    if (anthropicKey) aPatch.apiKey = anthropicKey
    aPatch.baseURL = form.anthropic.baseURL || null
    aPatch.model = form.anthropic.model || null
    aPatch.cliPath = form.anthropic.cliPath || null
    aPatch.cliTimeoutMs = form.anthropic.cliTimeoutMs
    aPatch.concurrency = form.anthropic.concurrency
    aPatch.thinking = form.anthropic.thinking
    if (form.anthropic.reviewEnabled) {
      aPatch.review = {
        provider: form.anthropic.review.provider || null,
        model: form.anthropic.review.model || null,
        baseURL: form.anthropic.review.baseURL || null,
        // 留空 = 沿用已保存的 review key（如有）
        ...(form.anthropic.review.apiKey.trim() ? { apiKey: form.anthropic.review.apiKey.trim() } : {}),
      }
    } else {
      aPatch.review = null
    }
    patch.anthropic = aPatch

    // ImageGen
    const igPatch: Record<string, unknown> = {}
    const imageGenKey = form.imageGen.apiKey.trim()
    if (imageGenKey) igPatch.apiKey = imageGenKey
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
      concurrency: form.voxcpm.concurrency,
    }

    // TTS 底座 + 合成 QA 门
    patch.tts = {
      provider: form.tts.provider,
      qa: {
        enabled: form.tts.qa.enabled,
        maxRetries: form.tts.qa.maxRetries,
      },
    }

    // CosyVoice
    patch.cosyvoice = {
      endpoint: form.cosyvoice.endpoint || null,
      modelDir: form.cosyvoice.modelDir || null,
      concurrency: form.cosyvoice.concurrency,
      referenceText: form.cosyvoice.referenceText || null,
      normalize: form.cosyvoice.normalize,
    }

    // MuseTalk
    patch.musetalk = {
      url: form.musetalk.url || null,
    }

    // Visual quality (booleans/numbers — sent as-is)
    patch.visualQuality = {
      enabled: form.visualQuality.enabled,
      minFontCoeff: form.visualQuality.minFontCoeff,
      minAnyFontCoeff: form.visualQuality.minAnyFontCoeff,
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

async function testService(service: 'anthropic' | 'imageGen' | 'voxcpm' | 'cosyvoice' | 'musetalk') {
  testing[service] = true
  testResult[service] = null
  try {
    const res = await apiPost<{ ok: boolean; latencyMs?: number; message?: string }>(
      '/api/config/test',
      { service, draft: buildTestDraft(service) },
    )
    if (res.ok) {
      const data = res.data
      const typedUnsavedKey = service === 'anthropic' && !!form.anthropic.apiKey.trim() && !savedKeys.anthropicLast4
      testResult[service] = data.ok && typedUnsavedKey
        ? { ...data, message: data.message || '请点右下角保存后才会用于构建' }
        : data
    } else {
      testResult[service] = { ok: false, message: res.error?.message ?? '请求失败' }
    }
  } catch {
    testResult[service] = { ok: false, message: '请求失败' }
  } finally {
    testing[service] = false
  }
}

function buildTestDraft(service: 'anthropic' | 'imageGen' | 'voxcpm' | 'musetalk') {
  if (service === 'anthropic') {
    return {
      anthropic: {
        provider: form.anthropic.provider,
        ...(form.anthropic.apiKey.trim() ? { apiKey: form.anthropic.apiKey.trim() } : {}),
        ...(form.anthropic.baseURL ? { baseURL: form.anthropic.baseURL } : {}),
        ...(form.anthropic.model ? { model: form.anthropic.model } : {}),
        ...(form.anthropic.cliPath ? { cliPath: form.anthropic.cliPath } : {}),
        ...(form.anthropic.cliTimeoutMs ? { cliTimeoutMs: form.anthropic.cliTimeoutMs } : {}),
      },
    }
  }
  if (service === 'imageGen') {
    return {
      imageGen: {
        provider: form.imageGen.provider,
        ...(form.imageGen.apiKey.trim() ? { apiKey: form.imageGen.apiKey.trim() } : {}),
        ...(form.imageGen.baseURL ? { baseURL: form.imageGen.baseURL } : {}),
        ...(form.imageGen.model ? { model: form.imageGen.model } : {}),
      },
    }
  }
  if (service === 'voxcpm') {
    return {
      voxcpm: {
        ...(form.voxcpm.endpoint ? { endpoint: form.voxcpm.endpoint } : {}),
      },
    }
  }
  return {
    musetalk: {
      ...(form.musetalk.url ? { url: form.musetalk.url } : {}),
    },
  }
}

// ── Load on mount ───────────────────────────────────────────────────────

loadConfig()
</script>
