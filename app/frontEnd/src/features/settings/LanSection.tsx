import { ArrowSquareOut } from '@phosphor-icons/react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useEffectEvent, useRef, useState } from 'react'

import { deviceApi } from '@/api/device'
import { ensureDeviceSession } from '@/api/goform'

import { intToIp, ipToInt, lanApi, MASKS, poolSize, subnetOf, validateLan, type LanConfig, type LanErrors, type Subnet } from '@/api/lan'
import { Button } from '@/components/ui/button'
import { ListGroup, ListRow, Panel, PanelHeader } from '@/components/ui/card'
import { Dialog, DialogContent, useConfirm } from '@/components/ui/dialog'
import { Skeleton, Spinner } from '@/components/ui/feedback'
import { InputRow, SaveActions, SwitchRow, ValueRow } from '@/components/ui/form-rows'
import { Meter } from '@/components/ui/meter'
import { Select } from '@/components/ui/select'
import { toast } from '@/components/ui/toast'
import { useT } from '@/i18n'
import { cn } from '@/lib/cn'
import { errorMessage, isApiError } from '@/lib/errors'

const lanKey = ['settings', 'lan'] as const
export const lanQuery = { queryKey: lanKey, queryFn: lanApi.get, staleTime: 0 }
const RESTART_MS = 60_000
const REDIRECT_S = 30
/** 地址没变时轮询设备是否重启完成：多久问一次；没观察到掉线时最早多久算「已恢复」 */
const PROBE_MS = 3_000
const ASSUME_BACK_MS = 45_000
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const pick = ({ ip, mask, dhcp, start, end, lease }: LanConfig): LanConfig => ({ ip, mask, dhcp, start, end, lease })
const same = (a: LanConfig, b: LanConfig) => JSON.stringify(pick(a)) === JSON.stringify(pick(b))
/** 有些语言的小数键盘上是逗号而不是点 */
const ipInput = (value: string) => value.replace(/,/g, '.').replace(/[^\d.]/g, '')

/**
 * 局域网：左边是网关、掩码与 DHCP 地址池（iOS 式表单行），右边一张「地址规划」把子网、网关和地址池画成一条刻度，
 * 改数字时实时看到池子落在哪里、会不会盖住网关。保存会重启设备，网关变了还要换地址访问——强确认，并接管后续跳转。
 */
export function LanSection() {
  const t = useT()
  const confirm = useConfirm()
  const lan = useQuery(lanQuery)
  const [draft, setDraft] = useState<LanConfig | null>(null)
  const [submitted, setSubmitted] = useState(false)
  const [restart, setRestart] = useState<{ newIp: string | null; since: number } | null>(null)

  useEffect(() => {
    if (lan.data && draft == null) setDraft(pick(lan.data))
  }, [lan.data, draft])

  // 写请求是否真的发出去了：会话检查、取 RD 这些前置请求超时，设备什么都没收到
  const sent = useRef(false)
  const save = useMutation({
    mutationFn: (config: LanConfig) => {
      sent.current = false
      return lanApi.save(config, () => {
        sent.current = true
      })
    },
    onSuccess: (_data, config) => setRestart({ newIp: config.ip !== lan.data?.ip ? config.ip.trim() : null, since: Date.now() }),
    onError: (error, config) => {
      // 写请求发出后设备可能来不及回应就开始重启了：这时连接断开 / 超时都按「已提交」处理
      if (sent.current && (isApiError(error, 'network') || isApiError(error, 'timeout'))) {
        setRestart({ newIp: config.ip !== lan.data?.ip ? config.ip.trim() : null, since: Date.now() })
      } else {
        toast.error(t.common.operationFailed, { description: errorMessage(error) })
      }
    },
  })

  if (!draft || !lan.data) {
    return (
      <div className="grid grid-cols-1 items-start gap-x-6 gap-y-7 @4xl:grid-cols-2">
        <ListGroup title={t.lan.title}>
          <div className="p-4">{lan.isError ? <p className="text-footnote text-danger-text">{errorMessage(lan.error)}</p> : <Skeleton className="h-40" />}</div>
        </ListGroup>
      </div>
    )
  }

  const errors = validateLan(draft)
  // 改过的字段即时校验，没碰过的等点保存再提示
  const show = (key: keyof LanErrors) => (submitted || draft[key] !== lan.data![key] ? errors[key] : undefined)
  const message = (key: keyof LanErrors) => {
    const error = show(key)
    return error ? t.lan.errors[error] : null
  }
  const dirty = !same(draft, lan.data)
  const patch = (next: Partial<LanConfig>) => setDraft((d) => (d ? { ...d, ...next } : d))

  const submit = async () => {
    setSubmitted(true)
    if (Object.keys(errors).length) return
    const ipChanged = draft.ip.trim() !== lan.data!.ip
    await confirm({
      tone: 'danger',
      title: t.lan.confirmTitle,
      description: t.lan.confirmBody,
      details: ipChanged ? <span className="text-text">{t.lan.confirmNewIp(draft.ip.trim())}</span> : undefined,
      requireText: ipChanged ? draft.ip.trim() : undefined,
      confirmText: t.lan.save,
      onConfirm: () => save.mutate(draft),
    })
  }

  return (
    <div className="@container">
      <div className="grid grid-cols-1 items-start gap-x-6 gap-y-7 @4xl:grid-cols-2">
        <div className="flex flex-col gap-7">
          <ListGroup title={t.lan.title}>
            <InputRow label={t.lan.gateway} value={draft.ip} onChange={(ip) => patch({ ip: ipInput(ip) })} inputMode="decimal" mono maxLength={15} error={message('ip')} />
            <ListRow
              title={<span className={cn(show('mask') && 'text-danger-text')}>{t.lan.mask}</span>}
              trailing={
                <Select
                  size="sm"
                  className="w-52"
                  ariaLabel={t.lan.mask}
                  value={MASKS.some((m) => m.mask === draft.mask) ? draft.mask : undefined}
                  placeholder={draft.mask || '—'}
                  onValueChange={(mask) => patch({ mask })}
                  options={MASKS.map((m) => ({ value: m.mask, label: <span className="num">{`${m.mask}  /${m.bits}`}</span> }))}
                />
              }
            />
            {lan.data.mac && <ValueRow title={t.lan.mac} value={lan.data.mac.toUpperCase()} mono />}
          </ListGroup>

          <div>
            <ListGroup title={t.lan.dhcpTitle} footer={t.lan.footer}>
              <SwitchRow title={t.lan.dhcp} subtitle={t.lan.dhcpHint} checked={draft.dhcp} onCheckedChange={(dhcp) => patch({ dhcp })} />
              {draft.dhcp && (
                <>
                  <InputRow label={t.lan.start} value={draft.start} onChange={(start) => patch({ start: ipInput(start) })} inputMode="decimal" mono maxLength={15} error={message('start')} />
                  <InputRow label={t.lan.end} value={draft.end} onChange={(end) => patch({ end: ipInput(end) })} inputMode="decimal" mono maxLength={15} error={message('end')} />
                  <InputRow
                    label={t.lan.lease}
                    value={draft.lease}
                    onChange={(lease) => patch({ lease: lease.replace(/\D/g, '') })}
                    inputMode="numeric"
                    mono
                    maxLength={4}
                    suffix={t.lan.hours}
                    error={message('lease')}
                  />
                </>
              )}
            </ListGroup>
            <SaveActions
              dirty={dirty}
              saving={save.isPending}
              saveLabel={t.lan.save}
              onRevert={() => {
                setDraft(pick(lan.data!))
                setSubmitted(false)
              }}
              onSave={() => void submit()}
            />
          </div>
        </div>

        <AddressPlan config={draft} />
      </div>

      <RestartDialog state={restart} oldIp={lan.data.ip} onClose={() => setRestart(null)} />
    </div>
  )
}

/* —— 地址规划：子网刻度 + 网关 + 地址池 —— */

function AddressPlan({ config }: { config: LanConfig }) {
  const t = useT()
  const subnet = subnetOf(config.ip, config.mask)
  const pool = config.dhcp ? poolSize(config.start, config.end) : null
  return (
    <Panel>
      <PanelHeader title={t.lan.planTitle} />
      {subnet ? (
        <SubnetBar subnet={subnet} config={config} />
      ) : (
        <p className="rounded-inner bg-sunken px-4 py-6 text-center text-footnote text-text-3">{t.lan.planInvalid}</p>
      )}
      <dl className="mt-5 grid grid-cols-2 gap-x-4 gap-y-4 border-t border-line pt-4">
        <Stat label={t.lan.subnet} value={subnet ? `${intToIp(subnet.network)}/${subnet.prefix}` : '—'} />
        <Stat label={t.lan.usable} value={subnet ? subnet.hosts.toLocaleString() : '—'} />
        <Stat label={t.lan.pool} value={config.dhcp ? (pool != null ? t.lan.poolCount(pool) : '—') : t.common.off} />
        <Stat label={t.lan.lease} value={config.dhcp && config.lease ? `${config.lease} ${t.lan.hours}` : '—'} />
      </dl>
      {!config.dhcp && <p className="mt-4 text-footnote text-warning-text">{t.lan.dhcpOff}</p>}
    </Panel>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-caption text-text-3">{label}</dt>
      <dd className="num mt-0.5 truncate text-subhead font-medium text-text">{value}</dd>
    </div>
  )
}

function SubnetBar({ subnet, config }: { subnet: Subnet; config: LanConfig }) {
  const t = useT()
  const span = Math.max(1, subnet.broadcast - subnet.network)
  const at = (n: number) => Math.min(1, Math.max(0, (n - subnet.network) / span)) * 100
  const gateway = ipToInt(config.ip)
  const start = ipToInt(config.start)
  const end = ipToInt(config.end)
  const inSubnet = (n: number | null): n is number => n != null && n >= subnet.network && n <= subnet.broadcast
  const showPool = config.dhcp && inSubnet(start) && inSubnet(end) && end >= start
  const showGateway = inSubnet(gateway)
  const overlap = showPool && showGateway && gateway >= start && gateway <= end
  const tail = (n: number) => (subnet.prefix >= 24 ? `.${n & 255}` : intToIp(n))

  return (
    <div>
      <div className="relative h-10">
        {/* 刻度轨道 */}
        <div className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-sunken" />
        {/* 地址池 */}
        {showPool && (
          <div
            className={cn(
              'absolute inset-y-2 rounded-[6px] ring-1 ring-inset transition-[left,width] duration-300 ease-out',
              overlap ? 'bg-danger-soft ring-danger' : 'bg-accent-soft ring-accent/50',
            )}
            style={{ left: `${at(start)}%`, width: `max(4px, ${at(end) - at(start)}%)` }}
          />
        )}
        {/* 网关 */}
        {showGateway && (
          <div className="absolute inset-y-0 w-0 transition-[left] duration-300 ease-out" style={{ left: `${at(gateway)}%` }}>
            <span className={cn('absolute top-1/2 left-0 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full ring-[3px] ring-surface', overlap ? 'bg-danger' : 'bg-text')} />
          </div>
        )}
      </div>
      <div className="num mt-1 flex justify-between text-caption text-text-4">
        <span>{intToIp(subnet.network)}</span>
        <span>{intToIp(subnet.broadcast)}</span>
      </div>
      <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5 text-footnote text-text-2">
        {showGateway && (
          <li className="flex items-center gap-2">
            <span className={cn('size-2.5 rounded-full', overlap ? 'bg-danger' : 'bg-text')} />
            {t.lan.gatewayMark}
            <span className="num text-text">{tail(gateway)}</span>
          </li>
        )}
        {showPool && (
          <li className="flex items-center gap-2">
            <span className={cn('h-2.5 w-4 rounded-[3px] ring-1 ring-inset', overlap ? 'bg-danger-soft ring-danger' : 'bg-accent-soft ring-accent/50')} />
            {t.lan.pool}
            <span className="num text-text">
              {tail(start)} – {tail(end)}
            </span>
          </li>
        )}
      </ul>
    </div>
  )
}

/* —— 重启与跳转 —— */

function RestartDialog({ state, oldIp, onClose }: { state: { newIp: string | null; since: number } | null; oldIp: string; onClose: () => void }) {
  const t = useT()
  const [now, setNow] = useState(() => Date.now())
  const open = state != null
  useEffect(() => {
    if (!open) return
    const timer = window.setInterval(() => setNow(Date.now()), 500)
    return () => window.clearInterval(timer)
  }, [open])

  const newIp = state?.newIp ?? null
  const port = window.location.port ? `:${window.location.port}` : ''
  const target = newIp ? `${window.location.protocol}//${newIp}${port}/` : null
  // 只有当前就是用旧网关地址访问时才自动跳转（经域名、隧道或本地开发访问时不乱跳）
  const autoRedirect = target != null && window.location.hostname === oldIp
  const elapsed = state ? now - state.since : 0
  const left = Math.max(0, REDIRECT_S - Math.floor(elapsed / 1000))

  useEffect(() => {
    if (open && autoRedirect && left === 0 && target) window.location.href = target
  }, [open, autoRedirect, left, target])

  // 地址没变：等设备掉线再恢复响应（或超过 45 s 一直能连上），续上官方后台会话、刷新数据，自动关掉
  const queryClient = useQueryClient()
  const recovered = useEffectEvent(() => {
    void queryClient.invalidateQueries()
    toast.success(t.lan.restarted)
    onClose()
  })
  const since = state?.since ?? null
  useEffect(() => {
    if (since == null || target) return
    let stopped = false
    let sawDown = false
    void (async () => {
      while (!stopped) {
        await wait(PROBE_MS)
        if (stopped) return
        const up = await deviceApi.versionInfo().then(
          () => true,
          () => false,
        )
        if (!up) sawDown = true
        if (!up || (!sawDown && Date.now() - since < ASSUME_BACK_MS)) continue
        await ensureDeviceSession().catch(() => undefined)
        if (!stopped) recovered()
        return
      }
    })()
    return () => {
      stopped = true
    }
  }, [since, target])

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent
        title={t.lan.restarting}
        description={t.lan.restartingBody}
        size="sm"
        footer={
          target ? (
            <Button variant="primary" asChild>
              <a href={target}>
                {t.lan.openNow}
                <ArrowSquareOut />
              </a>
            </Button>
          ) : (
            <Button variant="secondary" onClick={onClose}>
              {t.common.close}
            </Button>
          )
        }
      >
        <Meter value={Math.min(elapsed, RESTART_MS)} max={RESTART_MS} tone="accent" size="sm" />
        <p className="mt-2.5 flex items-center gap-2 text-footnote text-text-3">
          <Spinner className="size-3.5" />
          {target ? (autoRedirect && left > 0 ? t.lan.redirectIn(left) : t.lan.reconnectHint) : t.lan.restartingSame}
        </p>
        {target && (
          <div className="mt-4 rounded-inner bg-sunken px-4 py-3">
            <p className="text-caption text-text-3">{t.lan.newAddress}</p>
            <p className="num mt-0.5 text-headline text-text">{target.replace(/\/$/, '')}</p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
