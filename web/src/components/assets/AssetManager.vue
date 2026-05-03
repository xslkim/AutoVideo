<template>
  <div class="asset-manager">
    <!-- Upload area -->
    <div
      class="upload-area"
      :class="{ 'upload-area--dragover': isDragOver }"
      @click="triggerUpload"
      @dragover.prevent="onDragOver"
      @dragleave.prevent="onDragLeave"
      @drop.prevent="onDrop"
    >
      <div class="upload-icon">📁</div>
      <div class="upload-text">拖拽图片到此处或点击上传</div>
      <div class="upload-hint">支持 PNG / JPG / GIF / WebP / SVG，单文件不超过 10MB</div>
    </div>

    <!-- Hidden file input -->
    <input
      ref="fileInputRef"
      type="file"
      accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml"
      multiple
      style="display: none"
      @change="onFileInput"
    />

    <!-- Loading state -->
    <n-spin v-if="loading" size="small" class="loading-spin" />

    <!-- Error state -->
    <n-alert
      v-else-if="errorMsg"
      type="error"
      class="error-alert"
      closable
      @close="errorMsg = ''"
    >
      {{ errorMsg }}
      <template #footer>
        <n-button size="small" @click="fetchAssets">重试</n-button>
      </template>
    </n-alert>

    <!-- Empty state -->
    <n-empty
      v-else-if="!loading && assets.length === 0"
      description="暂无资源，上传图片开始管理"
      size="small"
      class="empty-state"
    />

    <!-- Asset grid -->
    <div v-else class="asset-grid">
      <div
        v-for="asset in assets"
        :key="asset.name"
        class="asset-card"
        @click="onClickAsset(asset)"
        @dblclick="onPreviewAsset(asset)"
      >
        <div class="asset-thumb">
          <img
            :src="`/api/projects/${projectName}/assets/${encodeURIComponent(asset.name)}`"
            :alt="asset.name"
            class="asset-img"
            loading="lazy"
          />
        </div>
        <div class="asset-info">
          <n-ellipsis class="asset-name" :tooltip="false">{{ asset.name }}</n-ellipsis>
          <span class="asset-size">{{ formatSize(asset.size) }}</span>
        </div>
        <div class="asset-actions">
          <n-button
            size="tiny"
            quaternary
            @click.stop="onCopyPath(asset.name)"
            title="复制路径"
          >
            📋
          </n-button>
          <n-button
            size="tiny"
            quaternary
            type="error"
            @click.stop="onDeleteAsset(asset.name)"
            title="删除"
          >
            🗑
          </n-button>
        </div>
      </div>
    </div>

    <!-- Upload progress -->
    <div v-if="uploading" class="upload-progress">
      <n-progress type="line" :percentage="uploadProgress" :indicator-placement="'inside'" />
      <span class="upload-progress-text">上传中... {{ uploadProgress }}%</span>
    </div>

    <!-- Preview modal -->
    <n-modal
      v-model:show="previewVisible"
      preset="card"
      title="图片预览"
      size="huge"
      :bordered="false"
    >
      <div class="preview-body">
        <img
          v-if="previewSrc"
          :src="previewSrc"
          :alt="previewName"
          class="preview-img"
        />
        <div class="preview-info">
          <span>{{ previewName }}</span>
          <n-button size="small" @click="onCopyPath(previewName)">复制路径</n-button>
        </div>
      </div>
    </n-modal>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useMessage, useDialog } from 'naive-ui'
import { apiGet, apiFetch, getEtag } from '../../utils/api'

interface AssetFile {
  name: string
  size: number
  mime: string
}

const props = defineProps<{
  projectName: string
}>()

const message = useMessage()
const dialog = useDialog()

const assets = ref<AssetFile[]>([])
const loading = ref(false)
const errorMsg = ref('')
const isDragOver = ref(false)
const fileInputRef = ref<HTMLInputElement | null>(null)
const uploading = ref(false)
const uploadProgress = ref(0)
const previewVisible = ref(false)
const previewSrc = ref('')
const previewName = ref('')

// Fetch asset list
async function fetchAssets() {
  loading.value = true
  errorMsg.value = ''
  try {
    const result = await apiGet<AssetFile[]>(`/api/projects/${props.projectName}/assets`)
    if (result.ok) {
      assets.value = result.data
    } else if (result.error) {
      errorMsg.value = result.error.message
    }
  } catch {
    errorMsg.value = '加载资源列表失败'
  } finally {
    loading.value = false
  }
}

// Upload
function triggerUpload() {
  fileInputRef.value?.click()
}

function onDragOver(_e: DragEvent) {
  isDragOver.value = true
}

function onDragLeave(_e: DragEvent) {
  isDragOver.value = false
}

function onDrop(e: DragEvent) {
  isDragOver.value = false
  const files = e.dataTransfer?.files
  if (files && files.length > 0) {
    uploadFiles(files)
  }
}

function onFileInput() {
  const files = fileInputRef.value?.files
  if (files && files.length > 0) {
    uploadFiles(files)
  }
  // Reset input so same file can be re-uploaded
  if (fileInputRef.value) {
    fileInputRef.value.value = ''
  }
}

async function uploadFiles(fileList: FileList) {
  const files = Array.from(fileList)
  const maxSize = 10 * 1024 * 1024

  for (const file of files) {
    if (file.size > maxSize) {
      message.warning(`文件 ${file.name} 超过 10MB 限制，已跳过`)
      continue
    }
  }

  const validFiles = files.filter(f => f.size <= maxSize)
  if (validFiles.length === 0) return

  uploading.value = true
  uploadProgress.value = 0

  const formData = new FormData()
  for (const file of validFiles) {
    formData.append('file', file)
  }

  try {
    const result = await apiFetch<{ uploaded: { name: string; size: number }[]; errors: { name: string; reason: string }[] }>(
      `/api/projects/${props.projectName}/assets`,
      { method: 'POST', body: formData },
    )

    if (result.ok) {
      uploadProgress.value = 100
      const { uploaded, errors } = result.data

      if (uploaded.length > 0) {
        message.success(`成功上传 ${uploaded.length} 个文件`)
      }
      for (const err of errors) {
        message.warning(`${err.name}: ${err.reason}`)
      }
      if (uploaded.length === 0 && errors.length === 0) {
        message.warning('未选择任何文件')
      }

      await fetchAssets()
    } else if (result.error) {
      message.error(result.error.message)
    } else if (result.conflict) {
      message.error('上传冲突，请重试')
    }
  } finally {
    uploading.value = false
  }
}

// Click to copy path
async function onClickAsset(asset: AssetFile) {
  await onCopyPath(asset.name)
}

function onPreviewAsset(asset: AssetFile) {
  previewSrc.value = `/api/projects/${props.projectName}/assets/${encodeURIComponent(asset.name)}`
  previewName.value = asset.name
  previewVisible.value = true
}

async function onCopyPath(name: string) {
  const assetPath = `./assets/${name}`
  try {
    await navigator.clipboard.writeText(assetPath)
    message.success(`已复制: ${assetPath}`)
  } catch {
    // Fallback for older browsers
    message.info(assetPath)
  }
}

// Delete with confirmation + reference check
async function onDeleteAsset(fileName: string) {
  // Check if the asset is referenced in script.md
  let isReferenced = false
  try {
    const result = await apiGet<{ content: string }>(`/api/projects/${props.projectName}/script`, { silent: true })
    if (result.ok) {
      isReferenced = result.data.content.includes(`./assets/${fileName}`)
    }
  } catch { /* ignore */ }

  const title = isReferenced
    ? `此资源正在被 script.md 引用，确定要删除吗？`
    : `确定要删除 ${fileName} 吗？`

  dialog.warning({
    title: '确认删除',
    content: title,
    positiveText: '删除',
    negativeText: '取消',
    onPositiveClick: async () => {
      const result = await apiFetch<{ ok: boolean }>(
        `/api/projects/${props.projectName}/assets/${encodeURIComponent(fileName)}`,
        { method: 'DELETE' },
      )
      if (result.ok) {
        message.success(`已删除 ${fileName}`)
        await fetchAssets()
      } else if (result.error) {
        message.error(`删除失败: ${result.error.message}`)
      }
    },
  })
}

// Helpers
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

onMounted(fetchAssets)
</script>

<style scoped>
.asset-manager {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}

/* Upload area */
.upload-area {
  flex-shrink: 0;
  margin: 12px;
  padding: 24px 16px;
  border: 2px dashed var(--n-border-color, #d0d0d6);
  border-radius: 8px;
  text-align: center;
  cursor: pointer;
  transition: border-color 0.2s, background 0.2s;
}

.upload-area:hover,
.upload-area--dragover {
  border-color: var(--n-primary-color, #2080f0);
  background: rgba(32, 128, 240, 0.04);
}

.upload-icon {
  font-size: 28px;
  margin-bottom: 8px;
}

.upload-text {
  font-size: 14px;
  color: var(--n-text-color, #333);
  margin-bottom: 4px;
}

.upload-hint {
  font-size: 12px;
  color: var(--n-text-color-3, #999);
}

/* Loading / error / empty */
.loading-spin,
.error-alert,
.empty-state {
  margin: 24px 12px;
}

/* Asset grid */
.asset-grid {
  flex: 1;
  overflow-y: auto;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(130px, 1fr));
  gap: 10px;
  padding: 0 12px 12px;
  align-content: start;
}

.asset-card {
  display: flex;
  flex-direction: column;
  border: 1px solid var(--n-border-color, #e0e0e6);
  border-radius: 6px;
  overflow: hidden;
  cursor: pointer;
  transition: box-shadow 0.2s;
  background: var(--n-card-color, #fff);
}

.asset-card:hover {
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
}

.asset-thumb {
  width: 100%;
  aspect-ratio: 1;
  overflow: hidden;
  background: #f0f0f0;
  display: flex;
  align-items: center;
  justify-content: center;
}

.asset-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.asset-info {
  padding: 6px 8px 2px;
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.asset-name {
  font-size: 12px;
  color: var(--n-text-color, #333);
  line-height: 1.3;
}

.asset-size {
  font-size: 11px;
  color: var(--n-text-color-3, #999);
  margin-top: 1px;
}

.asset-actions {
  display: flex;
  justify-content: flex-end;
  padding: 0 4px 4px;
  gap: 2px;
}

/* Upload progress */
.upload-progress {
  margin: 0 12px 12px;
  display: flex;
  align-items: center;
  gap: 8px;
}

.upload-progress :deep(.n-progress) {
  flex: 1;
}

.upload-progress-text {
  font-size: 12px;
  color: var(--n-text-color-3, #999);
  white-space: nowrap;
}

/* Preview modal */
.preview-body {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
}

.preview-img {
  max-width: 100%;
  max-height: 70vh;
  object-fit: contain;
}

.preview-info {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 13px;
  color: var(--n-text-color, #333);
}
</style>
