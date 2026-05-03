<template>
  <div class="task-progress">
    <div class="progress-bar-track">
      <div
        class="progress-bar-fill"
        :style="{ width: pct + '%', backgroundColor: barColor }"
        :class="{ 'progress-bar-fill--indeterminate': pending }"
      />
    </div>
    <span v-if="step" class="progress-step">{{ step }}</span>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { TaskStatus } from '../../../../server/types/api'

const props = defineProps<{
  percent: number
  step?: string
  status: TaskStatus
  pending?: boolean
}>()

const pct = computed(() => Math.max(0, Math.min(100, props.percent)))

const barColor = computed(() => {
  switch (props.status) {
    case 'completed': return '#18a058'
    case 'failed':    return '#d03050'
    case 'cancelled': return '#999'
    case 'cancelling': return '#f0a020'
    case 'running':   return '#2080f0'
    case 'pending':
    default:          return '#ccc'
  }
})
</script>

<style scoped>
.task-progress {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.progress-bar-track {
  flex: 1;
  height: 4px;
  background: var(--n-border-color, #e0e0e6);
  border-radius: 2px;
  overflow: hidden;
  min-width: 40px;
}

.progress-bar-fill {
  height: 100%;
  border-radius: 2px;
  transition: width 0.3s ease;
}

.progress-bar-fill--indeterminate {
  width: 30% !important;
  animation: indeterminate-slide 1.5s ease-in-out infinite;
}

@keyframes indeterminate-slide {
  0%   { transform: translateX(-100%); }
  100% { transform: translateX(400%); }
}

.progress-step {
  font-size: 11px;
  color: #999;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 160px;
  flex-shrink: 0;
}
</style>
