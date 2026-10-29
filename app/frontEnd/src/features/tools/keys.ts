import { useQuery } from '@tanstack/react-query'

import { advancedApi, hasRoot } from '@/api/advanced'
import { deviceApi } from '@/api/device'
import { tasksApi } from '@/api/tasks'

/* 工具页各分区的查询选项：组件里的 useQuery 和分区预读（ToolsPage.preload）用同一份 */

export const rootKey = ['tools', 'root'] as const
export const capabilitiesKey = ['tools', 'capabilities'] as const
export const tasksKey = ['tools', 'tasks'] as const
export const uploadsKey = ['tools', 'uploads'] as const

/** root 是否可用、三项前置条件：10 秒内不重复探测（每次探测都是一条 root shell 命令） */
export const rootQuery = { queryKey: rootKey, queryFn: hasRoot, staleTime: 10_000 }
export const capabilitiesQuery = { queryKey: capabilitiesKey, queryFn: advancedApi.capabilities, staleTime: 10_000 }
export const ttydQuery = { queryKey: ['tools', 'ttyd'] as const, queryFn: () => advancedApi.ttyd(), staleTime: 15_000 }
export const adbWifiQuery = { queryKey: ['tools', 'adb-wifi'] as const, queryFn: advancedApi.adbWifi }
export const customHeadQuery = { queryKey: ['tools', 'custom-head'] as const, queryFn: advancedApi.customHead }
export const uploadsQuery = { queryKey: uploadsKey, queryFn: advancedApi.listUploads }
export const tasksQuery = { queryKey: tasksKey, queryFn: tasksApi.list }
export const portsQuery = { queryKey: ['tools', 'ports'] as const, queryFn: advancedApi.blockedPorts }
export const storageQuery = { queryKey: ['tools', 'storage'] as const, queryFn: () => deviceApi.baseInfo(), staleTime: 30_000 }

export const useRoot = () => useQuery(rootQuery)
export const useCapabilities = () => useQuery(capabilitiesQuery)
