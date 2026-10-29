import { useQuery } from '@tanstack/react-query'

import { userShell } from '@/api/advanced'
import { parseProcUptime, type Telemetry } from '@/model/telemetry'

/**
 * 运行时长（毫秒）。新版后端在 baseDeviceInfo 里给 boot_time；旧版后端没有这个字段，
 * 就用普通用户 shell 读一次 /proc/uptime（不需要 root）推算开机时刻，之后随遥测刷新在本地累加。
 * 每 5 分钟重读一次，设备重启过也能对上。两处都读不到时返回 null，界面上直接不显示这一项。
 */
export function useUptimeMs(telemetry: Telemetry | undefined): number | null {
  const fallback = telemetry != null && telemetry.uptimeMs == null
  const bootAt = useQuery({
    queryKey: ['device', 'boot-at'],
    queryFn: async () => {
      const seconds = parseProcUptime(await userShell('cat /proc/uptime', 8_000))
      return seconds == null ? null : Date.now() - seconds * 1000
    },
    enabled: fallback,
    staleTime: 5 * 60_000,
    refetchInterval: fallback ? 5 * 60_000 : false,
    retry: 1,
  })
  if (telemetry?.uptimeMs != null) return telemetry.uptimeMs
  return bootAt.data == null ? null : Math.max(0, Date.now() - bootAt.data)
}
