<template>
  <n-modal
    :show="show"
    preset="card"
    title="上传缺失文件"
    style="max-width: 480px"
    :mask-closable="false"
  >
    <div class="upload-dialog-body">
      <n-alert type="warning" :bordered="false" style="margin-bottom: 16px">
        <p class="error-info">
          <strong>文件缺失：</strong> {{ fileName }}
        </p>
        <p class="error-info" v-if="blockId">
          <strong>关联块：</strong> {{ blockId }}
        </p>
      </n-alert>

      <n-upload
        :multiple="false"
        :accept="accept"
        :max-size="maxUploadBytes"
        @change="handleChange"
      >
        <n-button>选择文件</n-button>
      </n-upload>

      <p v-if="selectedFile" class="file-info">
        已选择：{{ selectedFile.name }}（{{ formatSize(selectedFile.size) }}）
      </p>
    </div>

    <template #footer>
      <n-space justify="end">
        <n-button @click="handleCancel">取消</n-button>
        <n-button
          type="primary"
          :loading="uploading"
          :disabled="!selectedFile"
          @click="handleUpload"
        >
          上传
        </n-button>
      </n-space>
    </template>
  </n-modal>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { NModal, NButton, NUpload, NAlert, NSpace, useMessage } from 'naive-ui'
import type { UploadFileInfo } from 'naive-ui'

const message = useMessage()

const props = defineProps<{
  show: boolean
  errorMessage: string
  projectName: string
}>()

const emit = defineEmits<{
  (e: 'update:show', v: boolean): void
  (e: 'uploaded'): void
}>()

// ── Parse error message ─────────────────────────────────────────────────

const blockId = computed(() => {
  const m = props.errorMessage.match(/Block\s+(\w+):/)
  return m?.[1] ?? null
})

const fileName = computed(() => {
  const m = props.errorMessage.match(/from\s+"([^"]+)"/)
  if (m) return m[1].replace(/^\.\//, '')
  const alt = props.errorMessage.match(/file not found:\s*(.+)/)
  if (alt) return alt[1].split('/').pop() || 'unknown'
  return 'unknown'
})

const accept = computed(() => {
  const ext = fileName.value.split('.').pop()?.toLowerCase()
  if (ext === 'png') return 'image/png'
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg'
  if (ext === 'wav') return 'audio/wav'
  if (ext === 'gif') return 'image/gif'
  if (ext === 'svg') return 'image/svg+xml'
  if (ext === 'mp4') return 'video/mp4,.mp4'
  return 'image/*,audio/wav,video/mp4,.mp4'
})

const maxUploadBytes = computed(() => {
  const ext = fileName.value.split('.').pop()?.toLowerCase()
  return ext === 'mp4' ? 500 * 1024 * 1024 : 10 * 1024 * 1024
})

// ── Upload ──────────────────────────────────────────────────────────────

const selectedFile = ref<File | null>(null)
const uploading = ref(false)

function handleChange(data: { file: UploadFileInfo; fileList: UploadFileInfo[] }) {
  if (data.file.file) {
    selectedFile.value = data.file.file
  }
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

async function handleUpload() {
  if (!selectedFile.value) return
  uploading.value = true

  try {
    const formData = new FormData()
    formData.append('file', selectedFile.value)
    // Tell the server the exact relative path (may include subdirs like "generated_images/image1.png")
    if (fileName.value && fileName.value !== 'unknown') {
      formData.append('savePath', fileName.value)
    }

    // Upload to project root
    const resp = await fetch(
      `/api/projects/${encodeURIComponent(props.projectName)}/upload-root`,
      { method: 'POST', body: formData },
    )

    if (resp.ok) {
      const body = await resp.json()
      if (body.error) {
        message.error(body.error.message || '上传失败')
      } else if (body.errors?.length && !body.uploaded?.length) {
        message.error(body.errors.map((e: { reason: string }) => e.reason).join('；'))
      } else if (body.uploaded?.length) {
        message.success(`${fileName.value} 上传成功，可以重新运行任务`)
        emit('uploaded')
        handleCancel()
        return
      } else {
        message.error('上传失败')
      }
    } else {
      const body = await resp.json().catch(() => ({}))
      message.error((body as any).error?.message || '上传失败')
    }
  } catch {
    message.error('上传失败：网络错误')
  } finally {
    uploading.value = false
  }
}

function handleCancel() {
  emit('update:show', false)
}
</script>

<style scoped>
.upload-dialog-body {
  padding: 4px 0;
}

.error-info {
  margin: 2px 0;
  font-size: 13px;
}

.file-info {
  margin-top: 12px;
  font-size: 12px;
  color: #666;
}
</style>
