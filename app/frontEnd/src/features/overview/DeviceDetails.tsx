import { Copy } from '@phosphor-icons/react'

import { Panel, PanelHeader } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/feedback'
import { Tooltip } from '@/components/ui/overlay'
import { toast } from '@/components/ui/toast'
import { useT } from '@/i18n'
import { copyText } from '@/lib/clipboard'
import { cn } from '@/lib/cn'
import { formatBytes, formatDuration, joinQuantity } from '@/lib/format'
import type { Telemetry } from '@/model/telemetry'

import { useUptimeMs } from './useUptime'

/**
 * 设备信息：规格表式的双列清单（标签左、值右、发丝线分隔），
 * 标识类字段（IMEI、ICCID、MAC……）点一下复制。放在页面最下面，安静地待着。
 */
export function DeviceDetails({ telemetry, className }: { telemetry: Telemetry | undefined; className?: string }) {
  const t = useT()
  const uptimeMs = useUptimeMs(telemetry)
  if (!telemetry) return <Skeleton className={cn('h-64 rounded-card', className)} />
  const d = telemetry.device
  const storage = telemetry.storage.internal
  const rows: [label: string, value: string | null, copy: boolean, mono: boolean][] = [
    [t.overview.model, d.model, false, false],
    [t.overview.firmware, d.firmware, true, true],
    [t.overview.imei, d.imei, true, true],
    [t.overview.iccid, d.iccid, true, true],
    [t.overview.imsi, d.imsi, true, true],
    [t.overview.msisdn, d.msisdn, true, true],
    [t.overview.lanIp, d.lanIp, true, true],
    [t.overview.mac, d.mac, true, true],
    [t.overview.clientIp, d.clientIp, true, true],
    [t.overview.ipv6, d.ipv6, true, true],
    [t.overview.storage, storage ? `${joinQuantity(formatBytes(storage.used))} / ${joinQuantity(formatBytes(storage.total))}` : null, false, false],
    [t.overview.uptime, uptimeMs == null ? null : formatDuration(uptimeMs / 1000, t.units), false, false],
  ]
  // 设备没给的项整行不显示，不留「—」占位（没插卡没有手机号、没有 IPv6 地址等）
  const known = rows.filter(([, value]) => value != null)
  return (
    <Panel className={cn('@container pb-2 max-sm:pb-1', className)}>
      <PanelHeader title={t.overview.deviceTitle} detail={d.appVersion ? `${t.overview.service} v${d.appVersion}` : undefined} className="mb-1" />
      <dl className="grid grid-cols-1 @3xl:grid-cols-2 @3xl:gap-x-10">
        {known.map(([label, value, copy, mono]) => (
          <div key={label} className="flex min-h-11 items-center justify-between gap-6 border-b border-line last:border-b-0 @3xl:[&:nth-last-child(2)]:border-b-0">
            <dt className="shrink-0 text-subhead text-text-2">{label}</dt>
            <dd className={cn('min-w-0', value && copy && '-mr-2')}>
              {value && copy ? (
                <Tooltip content={t.overview.clickToCopy} side="left">
                  <button
                    type="button"
                    onClick={async () => {
                      if (await copyText(value)) toast.success(t.common.copied, { description: value })
                      else toast.error(t.common.copyFailed)
                    }}
                    className="group relative flex max-w-full items-center rounded-[8px] px-2 py-1 transition-colors hover:bg-hover"
                  >
                    {/* 复制图标挂在值的左侧、不占位：有没有复制功能的值都右对齐到同一条线 */}
                    <Copy
                      className="pointer-events-none absolute top-1/2 right-full mr-1 size-3.5 -translate-y-1/2 text-text-4 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
                      weight="bold"
                    />
                    <span className={cn('truncate text-subhead text-text', mono && 'font-mono text-[13px]')}>{value}</span>
                  </button>
                </Tooltip>
              ) : (
                <span className={cn('block truncate text-subhead text-text', mono && 'font-mono text-[13px]')}>{value ?? '—'}</span>
              )}
            </dd>
          </div>
        ))}
      </dl>
    </Panel>
  )
}
