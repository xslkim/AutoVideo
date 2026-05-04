<template>
  <div class="home-page">
    <div class="page-header">
      <h1>项目列表</h1>
      <n-space v-if="store.projects.length > 0">
        <n-button type="primary" @click="showCreateModal = true">
          + 新建项目
        </n-button>
        <n-button @click="handleCreateDemo" :loading="demoCreating">
          试用 Demo
        </n-button>
      </n-space>
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
            <n-button type="primary" @click="showCreateModal = true">创建第一个项目</n-button>
            <n-button @click="handleCreateDemo" :loading="demoCreating">试用 Demo</n-button>
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

        <div class="card-menu" @click.stop>
          <n-dropdown trigger="click" :options="cardMenuOptions(proj.name)" @select="(key: string) => handleCardMenu(key, proj.name)">
            <n-button quaternary size="small">···</n-button>
          </n-dropdown>
        </div>

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

    <!-- Create Project Modal -->
    <n-modal v-model:show="showCreateModal" preset="card" title="新建项目" style="width: 480px">
      <n-form ref="formRef" :model="createForm" :rules="createRules" label-placement="top">
        <n-form-item label="项目名" path="name">
          <n-input
            v-model:value="createForm.name"
            placeholder="英文字母、数字、下划线、连字符"
            :maxlength="40"
            @input="validateName"
          />
          <template #feedback>
            <span v-if="nameValidation" :style="{ color: nameValidation.ok ? 'green' : 'red' }">
              {{ nameValidation.msg }}
            </span>
          </template>
        </n-form-item>
        <n-form-item label="标题（可选）" path="title">
          <n-input v-model:value="createForm.title" placeholder="项目显示标题" />
        </n-form-item>
        <n-form-item label="Slug（可选）" path="slug">
          <n-input v-model:value="createForm.slug" placeholder="构建输出目录名，默认与项目名相同" />
        </n-form-item>
      </n-form>
      <template #footer>
        <n-space justify="end">
          <n-button @click="showCreateModal = false">取消</n-button>
          <n-button type="primary" @click="handleCreate" :loading="creating">创建</n-button>
        </n-space>
      </template>
    </n-modal>

    <!-- Delete confirmation modal -->
    <n-modal v-model:show="showDeleteConfirm" preset="card" title="确认删除" style="width: 420px">
      <p>确定要删除项目 <strong>{{ deletingProject }}</strong> 吗？</p>
      <p style="color: #999; font-size: 13px">此操作不可撤销，整个项目目录将被删除。</p>
      <template #footer>
        <n-space justify="end">
          <n-button @click="showDeleteConfirm = false">取消</n-button>
          <n-button type="error" @click="handleDeleteConfirm" :loading="deleting">确认删除</n-button>
        </n-space>
      </template>
    </n-modal>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive } from 'vue'
import { useRouter } from 'vue-router'
import { useProjectStore } from '../stores/projectStore'
import { useMessage } from 'naive-ui'
import type { FormInst, FormRules } from 'naive-ui'

const router = useRouter()
const store = useProjectStore()
const message = useMessage()

// ---- Create modal ----
const showCreateModal = ref(false)
const creating = ref(false)
const formRef = ref<FormInst | null>(null)
const createForm = reactive({ name: '', title: '', slug: '' })
const nameValidation = ref<{ ok: boolean; msg: string } | null>(null)
const NAME_RE = /^[a-zA-Z0-9_-]{1,40}$/

const createRules: FormRules = {
  name: [{ required: true, message: '请输入项目名', trigger: 'blur' }],
}

function validateName() {
  const v = createForm.name.trim()
  if (!v) { nameValidation.value = null; return }
  if (!NAME_RE.test(v)) {
    nameValidation.value = { ok: false, msg: '项目名只能包含英文字母、数字、下划线、连字符，1-40字符' }
  } else {
    nameValidation.value = { ok: true, msg: '项目名有效' }
  }
}

async function handleCreate() {
  if (!createForm.name.trim() || !nameValidation.value?.ok) {
    message.warning('请输入有效的项目名')
    return
  }
  creating.value = true
  const result = await store.createProject(
    createForm.name.trim(),
    createForm.title.trim() || undefined,
    createForm.slug.trim() || undefined,
  )
  creating.value = false
  if (result.ok) {
    message.success('项目创建成功')
    showCreateModal.value = false
    createForm.name = ''
    createForm.title = ''
    createForm.slug = ''
    nameValidation.value = null
    router.push('/project/' + result.data.name)
  } else {
    message.error(result.error?.message || '创建失败')
  }
}

// ---- Delete ----
const showDeleteConfirm = ref(false)
const deletingProject = ref('')
const deleting = ref(false)

function handleDeleteConfirm() {
  doDelete(deletingProject.value)
}

async function doDelete(name: string) {
  deleting.value = true
  const result = await store.deleteProject(name)
  deleting.value = false
  if (result.ok) {
    message.success('项目已删除')
    showDeleteConfirm.value = false
  } else {
    message.error(result.error?.message || '删除失败')
  }
}

// ---- Cache clear ----
async function handleClearCache(name: string) {
  const result = await store.clearProjectCache(name)
  if (result.ok) {
    message.success('缓存已清空')
  } else {
    message.error(result.error?.message || '清空缓存失败')
  }
}

// ---- Demo ----
const demoCreating = ref(false)

async function handleCreateDemo() {
  demoCreating.value = true
  const result = await store.createDemo()
  demoCreating.value = false
  if (result.ok) {
    message.success('Demo 项目已创建')
    router.push('/project/demo')
  } else if (result.conflict) {
    // Demo already exists, just navigate to it
    message.info('Demo 项目已存在，进入项目')
    router.push('/project/demo')
  } else {
    message.error(result.error?.message || '创建 Demo 失败')
  }
}

// ---- Card menu ----
function cardMenuOptions(name: string) {
  return [
    { label: '进入项目', key: 'enter' },
    { label: '清空缓存', key: 'clear-cache' },
    { label: '删除项目', key: 'delete' },
  ]
}

function handleCardMenu(key: string, name: string) {
  switch (key) {
    case 'enter':
      router.push('/project/' + name)
      break
    case 'clear-cache':
      handleClearCache(name)
      break
    case 'delete':
      deletingProject.value = name
      showDeleteConfirm.value = true
      break
  }
}

// ---- Date format ----
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

.page-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 24px;
}

.page-header h1 {
  margin: 0;
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

.card-menu {
  position: absolute;
  top: 8px;
  right: 8px;
}

.project-card:has(.non-standard-tag) .card-menu {
  right: 70px;
}

.card-title {
  font-size: 16px;
  font-weight: 600;
  margin-bottom: 4px;
  padding-right: 36px;
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
