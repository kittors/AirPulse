import { hotspotApi } from '@/api/hotspot'
import { patched } from '@/app/pending'

export const wifiKey = ['hotspot', 'wifi'] as const
export const clientsKey = ['hotspot', 'clients'] as const

/** 同一个 key 的 useQuery 都用这里的选项：Wi-Fi 的读取要带「等生效」补丁（见 app/pending.ts） */
export const wifiQuery = { queryKey: wifiKey, queryFn: patched(wifiKey, hotspotApi.wifi) }
/** 已连接设备：热点页和总览的「已连接设备」共用一份 */
export const clientsQuery = { queryKey: clientsKey, queryFn: hotspotApi.clients }
