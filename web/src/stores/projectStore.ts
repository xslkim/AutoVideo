import { defineStore } from 'pinia'
import { ref } from 'vue'
import { apiGet, apiPost, apiDelete } from '../utils/api'

export interface ProjectSummary {
  name: string
  title: string
  blockCount: number
  latestBuildAt: string | null
  hasFinal: boolean
  nonStandard: boolean
}

export const useProjectStore = defineStore('projects', () => {
  const projects = ref<ProjectSummary[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)

  async function fetchProjects() {
    loading.value = true
    error.value = null
    const result = await apiGet<ProjectSummary[]>('/api/projects', { silent: true })
    if (result.ok) {
      projects.value = result.data
    } else {
      error.value = result.error?.message ?? '获取项目列表失败'
    }
    loading.value = false
  }

  async function createProject(name: string, title?: string, slug?: string) {
    const result = await apiPost<ProjectSummary>('/api/projects', { name, title, slug })
    if (result.ok) {
      await fetchProjects()
      return { ok: true as const, data: result.data }
    }
    if (result.conflict) {
      return { ok: false as const, conflict: result.conflict }
    }
    return { ok: false as const, error: result.error }
  }

  async function deleteProject(name: string) {
    const result = await apiDelete<{ ok: boolean }>(`/api/projects/${name}`)
    if (result.ok) {
      await fetchProjects()
      return { ok: true as const }
    }
    return { ok: false as const, error: result.error }
  }

  async function clearProjectCache(name: string) {
    const result = await apiPost<{ ok: boolean }>(`/api/projects/${name}/cache/clear`)
    if (result.ok) {
      await fetchProjects()
      return { ok: true as const }
    }
    return { ok: false as const, error: result.error }
  }

  async function createDemo() {
    return createProject('demo', 'Demo 项目')
  }

  return { projects, loading, error, fetchProjects, createProject, deleteProject, clearProjectCache, createDemo }
})
