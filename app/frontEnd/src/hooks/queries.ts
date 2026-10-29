import { deviceApi } from '@/api/device'

/* 多个页面共用的查询选项：组件里的 useQuery 和页面预读（preload）用同一份，key 与读取函数不会各写各的 */

/** 版本信息（型号、版本号、设备名…）：1 分钟内不重复读 */
export const versionInfoQuery = { queryKey: ['version-info'] as const, queryFn: deviceApi.versionInfo, staleTime: 60_000 }
