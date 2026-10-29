import type { TaskInfo } from '@/model/tasks'

import { api } from './client'

export * from '@/model/tasks'

/**
 * 定时任务（AirPulse 后端调度，按设备本地时间触发）。同 id 再次 add_task 即覆盖，
 * 执行记录随之清零；后端没有启停字段，也没有「立即执行」接口。见 docs/legacy-tools.md §3。
 */
export const tasksApi = {
  list: async () => (await api<{ tasks?: TaskInfo[] }>('/list_tasks')).tasks ?? [],
  save: (task: { id: string; time: string; repeatDaily: boolean; action: Record<string, string> }) =>
    api<{ result?: string }>('/add_task', { method: 'POST', json: task }),
  remove: (id: string) => api<{ result?: string }>('/remove_task', { method: 'POST', json: { id } }),
  clear: () => api<{ result?: string }>('/clear_task', { method: 'POST' }),
}
