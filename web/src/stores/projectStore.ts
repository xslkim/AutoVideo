import { defineStore } from 'pinia'
import { ref } from 'vue'
import { apiGet } from '../utils/api'

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

  return { projects, loading, error, fetchProjects }
})
