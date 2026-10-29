import { Copy, DotsThree, Eye, EyeSlash, PencilSimple, Prohibit, WifiHigh } from '@phosphor-icons/react'
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useMemo, useState } from 'react'

import {
  AUTH_MODES,
  hotspotApi,
  validSsid,
  validWifiPassword,
  wifiQrPayload,
  withBand,
  type AccessPoint,
  type Client,
} from '@/api/hotspot'
import { systemApi, type DeviceSwitches } from '@/api/system'
import { settle } from '@/app/pending'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ListGroup, ListRow, PageHeader, Panel, PanelHeader } from '@/components/ui/card'
import { Dialog, DialogContent, useConfirm } from '@/components/ui/dialog'
import { EmptyState, Skeleton } from '@/components/ui/feedback'
import { InputRow, SaveActions, SwitchRow } from '@/components/ui/form-rows'
import { Field, Input } from '@/components/ui/input'
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger, Tooltip } from '@/components/ui/overlay'
import { SegmentedControl } from '@/components/ui/segmented'
import { Select } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { toast } from '@/components/ui/toast'
import { QrCode } from '@/components/viz/qr-code'
import { useTelemetry } from '@/hooks/useTelemetry'
import { useT } from '@/i18n'
import { copyText } from '@/lib/clipboard'
import { isApiError } from '@/lib/errors'
import { collapse } from '@/lib/motion'
import { guessDevice } from '@/model/device-kind'

import { switchesKey, switchesQuery, useSwitch } from '../settings/switches'
import { DeviceAvatar } from './DeviceAvatar'
import { clientsKey, clientsQuery, wifiKey, wifiQuery } from './queries'
import { lastBand, useViaWifi, useWifiPower, type OnBand } from './wifiPower'

const SLEEP_OPTIONS = [-1, 5, 10, 20, 30, 60, 120]

/** 首屏数据：切页前预读（见 AppShell） */
export const preload = (client: QueryClient) =>
  Promise.all([client.prefetchQuery(wifiQuery), client.prefetchQuery(clientsQuery), client.prefetchQuery(switchesQuery)])

/**
 * 热点：Wi-Fi（开关、频段、扫码连接、网络设置、省电）与已连接设备（改名、拉黑 / 解除）。
 * 会让 Wi-Fi 断开的操作都先确认；如果浏览器本身就是经这个 Wi-Fi 接入的，确认里明确说「页面会断开」。
 */
export default function HotspotPage() {
  const t = useT()
  const wifi = useQuery({ ...wifiQuery, refetchInterval: 30_000 })
  const clients = useQuery({ ...clientsQuery, refetchInterval: 8_000 })
  const { data: telemetry } = useTelemetry()
  const clientIp = telemetry?.device.clientIp ?? null
  const viaWifi = useViaWifi()
  const active = wifi.data?.active ?? null
  // Wi-Fi 关着时网络设置照常显示（只读，内容是上次在用的频段）：整块不随开关出现 / 消失，页面不跳
  const ap = wifi.data ? (active ?? withBand(wifi.data, lastBand()).active) : null
  const online = clients.data?.clients.length ?? 0

  return (
    <>
      <PageHeader
        title={t.hotspot.title}
        subtitle={
          wifi.data ? (
            active ? (
              <span className="num">
                {active.ssid} · {active.chip === '0' ? t.hotspot.ghz24 : t.hotspot.ghz5} · {t.hotspot.devicesOnline(online)}
              </span>
            ) : (
              t.hotspot.wifiOff
            )
          ) : null
        }
      />
      <div className="@container">
        <div className="grid grid-cols-1 gap-x-6 gap-y-7 @4xl:grid-cols-2 @4xl:items-start">
          <div className="flex flex-col gap-7">
            <WifiCard />
            <NetworkGroup key={ap ? `${ap.chip}-${ap.ssid}` : 'loading'} ap={ap} locked={!active} viaWifi={viaWifi} />
            <PowerGroup />
          </div>
          <div className="flex flex-col gap-7">
            <ClientsPanel clientIp={clientIp} />
          </div>
        </div>
      </div>
    </>
  )
}

/* —— Wi-Fi：总开关 + 频段 + 扫码连接 —— */

function WifiCard() {
  const t = useT()
  const [reveal, setReveal] = useState(false)
  const { wifi, band, on, switching, toggle, switchBand } = useWifiPower()

  const active = wifi.data?.active ?? null
  const hint = switching
    ? { on: t.hotspot.turningOn, off: t.hotspot.turningOff, band: t.hotspot.switchingBand }[switching.kind]
    : on
      ? t.hotspot.wifiOnHint
      : t.hotspot.wifiOffHint
  return (
    <Panel className="@container">
      <div className="flex min-h-8 items-center gap-4">
        <div className="min-w-0 flex-1">
          <h2 className="text-headline text-text">Wi-Fi</h2>
          <p className="mt-0.5 text-footnote text-text-2">
            {wifi.data ? hint : <span className="ap-skeleton inline-block h-[0.9em] w-52 max-w-full align-[-0.1em]" aria-hidden />}
          </p>
        </div>
        {wifi.data ? (
          <Switch aria-label="Wi-Fi" checked={on} loading={Boolean(switching)} onCheckedChange={(next) => void toggle(next)} />
        ) : (
          <Skeleton className="h-[26px] w-[44px] rounded-full" />
        )}
      </div>
      {!wifi.data ? (
        <WifiBodySkeleton />
      ) : (
        <AnimatePresence initial={false}>
          {on && (
            <motion.div key="on" {...collapse} className="overflow-hidden">
              <div className="pt-4">
                <SegmentedControl<OnBand>
                  ariaLabel={t.hotspot.band}
                  value={band === 'chip1' || band === 'chip2' ? band : undefined}
                  pending={switching?.kind === 'band'}
                  disabled={Boolean(switching)}
                  fullWidth
                  onChange={(next) => void switchBand(next)}
                  options={[
                    { value: 'chip1', label: t.hotspot.ghz24 },
                    { value: 'chip2', label: t.hotspot.ghz5 },
                  ]}
                />
                <p className="mt-2 text-caption text-text-3">{t.hotspot.bandHint}</p>
              </div>
              {active && (
                // 卡片窄时二维码和文字上下排、整体水平居中；够宽时左右排
                <div className="mt-5 flex flex-col items-center gap-4 text-center @md:flex-row @md:gap-5 @md:text-left">
                  <QrCode value={wifiQrPayload(active)} size={128} className="shrink-0 shadow-[inset_0_0_0_1px_rgb(0_0_0/0.08)]" />
                  <div className="max-w-full min-w-0 @md:flex-1">
                    <p className="text-caption text-text-3">{t.hotspot.scanToJoin}</p>
                    <p className="mt-0.5 truncate text-[20px] leading-7 font-semibold tracking-[-0.01em] text-text">{active.ssid}</p>
                    <p className="text-footnote text-text-2">{t.hotspot.auth[active.authMode as keyof typeof t.hotspot.auth] ?? active.authMode}</p>
                    {active.authMode !== 'OPEN' && (
                      <div className="mt-3 flex items-center justify-center gap-1 @md:justify-start">
                        <span className="num min-w-0 truncate font-mono text-[15px] text-text">{reveal ? active.password : '•'.repeat(Math.min(12, active.password.length || 8))}</span>
                        <Tooltip content={reveal ? t.common.hide : t.common.show}>
                          <Button variant="ghost" size="icon-sm" aria-label={reveal ? t.common.hide : t.common.show} onClick={() => setReveal((v) => !v)}>
                            {reveal ? <EyeSlash /> : <Eye />}
                          </Button>
                        </Tooltip>
                        <Tooltip content={t.hotspot.copyPassword}>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label={t.hotspot.copyPassword}
                            onClick={async () => {
                              if (await copyText(active.password)) toast.success(t.common.copied)
                            }}
                          >
                            <Copy />
                          </Button>
                        </Tooltip>
                      </div>
                    )}
                    <p className="mt-2 text-caption text-text-3">{t.hotspot.scanHint}</p>
                  </div>
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      )}
    </Panel>
  )
}

/** Wi-Fi 卡片的加载态：按「开着」的布局占位（频段控件 + 二维码 + 文字），数据到了原位替换 */
function WifiBodySkeleton() {
  return (
    <div aria-hidden>
      <div className="pt-4">
        <Skeleton className="h-8 rounded-[9px] max-sm:h-9" />
        <Skeleton className="mt-2.5 h-3 w-44" />
      </div>
      <div className="mt-5 flex flex-col items-center gap-4 @md:flex-row @md:gap-5">
        <Skeleton className="size-32 shrink-0 rounded-[12px]" />
        <div className="flex w-full max-w-60 flex-col items-center gap-2 @md:items-start">
          <Skeleton className="h-3 w-16" />
          <Skeleton className="h-6 w-40" />
          <Skeleton className="h-3 w-12" />
          <Skeleton className="mt-3 h-5 w-36" />
          <Skeleton className="mt-1 h-3 w-48" />
        </div>
      </div>
    </div>
  )
}

/* —— 网络设置：名称、加密、密码、隐藏、最多连接 —— */

const EMPTY_AP: AccessPoint = { index: '0', chip: '0', enabled: false, ssid: '', password: '', authMode: 'WPA2PSK', hidden: false, maxStations: 10, isolate: null }

/**
 * ap 为 null（还在加载）时按同样的行占位；locked（Wi-Fi 关着）时只读，脚注说明打开后才能改。
 * 这块始终在页面上，开关 Wi-Fi 时不会整块出现 / 消失把下面的内容推来推去。
 */
function NetworkGroup({ ap: source, locked, viaWifi }: { ap: AccessPoint | null; locked: boolean; viaWifi: boolean }) {
  const t = useT()
  const confirm = useConfirm()
  const queryClient = useQueryClient()
  const ap = source ?? EMPTY_AP
  const readOnly = locked || !source
  const [draft, setDraft] = useState({ ssid: ap.ssid, authMode: ap.authMode, password: ap.password, hidden: ap.hidden, max: String(ap.maxStations) })
  const reset = () => setDraft({ ssid: ap.ssid, authMode: ap.authMode, password: ap.password, hidden: ap.hidden, max: String(ap.maxStations) })
  // Wi-Fi 关着时不能改：草稿跟着设备走
  useEffect(() => {
    if (readOnly) setDraft({ ssid: ap.ssid, authMode: ap.authMode, password: ap.password, hidden: ap.hidden, max: String(ap.maxStations) })
  }, [readOnly, ap.ssid, ap.authMode, ap.password, ap.hidden, ap.maxStations])
  const save = useMutation({ mutationFn: (next: AccessPoint) => hotspotApi.save(next) })
  const open = draft.authMode === 'OPEN'
  const max = Number(draft.max)
  const errors = {
    ssid: validSsid(draft.ssid) ? null : t.hotspot.invalidSsid,
    password: open || validWifiPassword(draft.password) ? null : t.hotspot.invalidPassword,
    max: Number.isInteger(max) && max >= 1 && max <= 32 ? null : t.hotspot.invalidMax,
  }
  const dirty =
    draft.ssid !== ap.ssid || draft.authMode !== ap.authMode || (!open && draft.password !== ap.password) || draft.hidden !== ap.hidden || max !== ap.maxStations
  const authOptions = (AUTH_MODES as string[]).includes(ap.authMode) ? AUTH_MODES : [...AUTH_MODES, ap.authMode]

  const submit = async () => {
    const ok = await confirm({
      tone: 'warning',
      title: t.hotspot.saveTitle,
      description: viaWifi ? t.hotspot.saveViaWifi : t.hotspot.saveBody,
      confirmText: t.common.save,
    })
    if (!ok) return
    try {
      await save.mutateAsync({ ...ap, ssid: draft.ssid, authMode: draft.authMode, password: draft.password, hidden: draft.hidden, maxStations: max })
      toast.success(t.hotspot.saved)
    } catch (error) {
      if (isApiError(error, 'timeout') || isApiError(error, 'network')) toast.info(t.hotspot.maybeApplied)
      else toast.error(t.common.operationFailed)
    } finally {
      void queryClient.invalidateQueries({ queryKey: wifiKey })
    }
  }

  return (
    <div>
      <ListGroup title={t.hotspot.networkTitle} footer={locked && source ? t.hotspot.networkLocked : t.hotspot.networkFooter}>
        <InputRow label={t.hotspot.ssid} value={draft.ssid} onChange={(ssid) => setDraft({ ...draft, ssid })} error={readOnly ? null : errors.ssid} disabled={readOnly} />
        <ListRow
          title={<span className={readOnly ? 'opacity-50' : undefined}>{t.hotspot.security}</span>}
          trailing={
            <Select
              size="sm"
              ariaLabel={t.hotspot.security}
              value={draft.authMode}
              disabled={readOnly}
              onValueChange={(authMode) => setDraft({ ...draft, authMode })}
              options={authOptions.map((mode) => ({ value: mode, label: t.hotspot.auth[mode as keyof typeof t.hotspot.auth] ?? mode }))}
              className="w-36"
            />
          }
        />
        {!open && (
          <InputRow
            label={t.hotspot.password}
            value={draft.password}
            onChange={(password) => setDraft({ ...draft, password })}
            secret
            mono
            error={readOnly ? null : errors.password}
            disabled={readOnly}
          />
        )}
        <SwitchRow
          title={t.hotspot.hidden}
          subtitle={t.hotspot.hiddenHint}
          checked={draft.hidden}
          disabled={readOnly}
          onCheckedChange={(hidden) => setDraft({ ...draft, hidden })}
        />
        <InputRow
          label={t.hotspot.maxStations}
          value={draft.max}
          onChange={(v) => setDraft({ ...draft, max: v.replace(/\D/g, '') })}
          inputMode="numeric"
          mono
          suffix={t.hotspot.maxUnit || undefined}
          error={readOnly ? null : errors.max}
          disabled={readOnly}
        />
      </ListGroup>
      <SaveActions
        dirty={dirty && !readOnly}
        saving={save.isPending}
        disabled={Boolean(errors.ssid || errors.password || errors.max)}
        onRevert={reset}
        onSave={() => void submit()}
      />
    </div>
  )
}

/* —— 省电：无人连接时自动关闭、NFC —— */

function PowerGroup() {
  const t = useT()
  const queryClient = useQueryClient()
  const switches = useQuery(switchesQuery)
  const nfc = useSwitch('nfc', systemApi.setNfc)
  const sleep = useMutation({
    mutationFn: (minutes: number) =>
      settle(queryClient, switchesKey, {
        patch: (s: DeviceSwitches) => ({ ...s, wifiSleepMinutes: minutes }),
        write: () => systemApi.setWifiSleep(minutes),
        read: systemApi.switches,
        reached: (s) => s.wifiSleepMinutes === minutes,
        timeout: 8_000,
        interval: 800,
      }),
    onError: () => toast.error(t.common.operationFailed),
  })
  const s = switches.data
  if (!s) {
    return (
      <ListGroup title={t.hotspot.powerTitle}>
        <ListRow title={t.hotspot.sleep} trailing={<Skeleton className="h-8 w-28 rounded-[8px]" />} />
      </ListGroup>
    )
  }
  if (s.wifiSleepMinutes === null && !s.nfcSupported) return null
  const current = s.wifiSleepMinutes ?? -1
  const options = SLEEP_OPTIONS.includes(current) ? SLEEP_OPTIONS : [...SLEEP_OPTIONS, current]
  return (
    <ListGroup title={t.hotspot.powerTitle}>
      {s.wifiSleepMinutes !== null && (
        <ListRow
          title={t.hotspot.sleep}
          trailing={
            <Select
              size="sm"
              ariaLabel={t.hotspot.sleep}
              value={String(current)}
              onValueChange={(v) => sleep.mutate(Number(v))}
              options={options.map((minutes) => ({ value: String(minutes), label: minutes < 0 ? t.hotspot.sleepNever : t.hotspot.sleepMinutes(minutes) }))}
              className="w-28"
            />
          }
        />
      )}
      {s.nfcSupported && <SwitchRow title={t.hotspot.nfc} subtitle={t.hotspot.nfcHint} checked={s.nfc} onCheckedChange={(v) => nfc.mutate(v)} />}
    </ListGroup>
  )
}

/* —— 已连接设备 + 已拉黑 —— */

function ClientsPanel({ clientIp }: { clientIp: string | null }) {
  const t = useT()
  const confirm = useConfirm()
  const queryClient = useQueryClient()
  const clients = useQuery({ ...clientsQuery, refetchInterval: 8_000 })
  const [renaming, setRenaming] = useState<Client | null>(null)
  const acl = clients.data?.acl
  const list = useMemo(() => {
    const items = clients.data?.clients ?? []
    // 本机排在最前，其余按名称
    return [...items].sort((a, b) => Number(b.ip === clientIp) - Number(a.ip === clientIp) || a.name.localeCompare(b.name))
  }, [clients.data, clientIp])

  const setBlocked = useMutation({
    mutationFn: (blocked: { mac: string; name: string }[]) => hotspotApi.setBlocked(acl!, blocked),
    onSettled: () => void queryClient.invalidateQueries({ queryKey: clientsKey }),
  })

  const block = async (client: Client) => {
    const self = client.ip === clientIp
    const ok = await confirm({
      tone: 'danger',
      title: t.hotspot.blockTitle(client.name),
      description: self ? `${t.hotspot.blockBody} ${t.hotspot.blockSelf}` : t.hotspot.blockBody,
      confirmText: t.hotspot.block,
    })
    if (!ok || !acl) return
    try {
      await setBlocked.mutateAsync([{ mac: client.mac, name: client.name }, ...acl.blocked.filter((item) => item.mac !== client.mac)])
      toast.success(t.hotspot.blocked)
    } catch {
      toast.error(t.common.operationFailed)
    }
  }

  const unblock = async (mac: string) => {
    if (!acl) return
    try {
      await setBlocked.mutateAsync(acl.blocked.filter((item) => item.mac !== mac))
      toast.success(t.hotspot.unblocked)
    } catch {
      toast.error(t.common.operationFailed)
    }
  }

  return (
    <>
      <Panel className="pb-2 max-sm:pb-2">
        <PanelHeader title={t.hotspot.clientsTitle} detail={clients.data ? t.hotspot.devicesOnline(list.length) : undefined} className="mb-2" />
        {clients.isPending ? (
          <div className="flex flex-col gap-2 pb-3">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-14" />
            ))}
          </div>
        ) : list.length === 0 ? (
          <EmptyState icon={<WifiHigh weight="light" />} title={t.hotspot.clientsEmpty} description={t.hotspot.clientsEmptyHint} className="py-10" />
        ) : (
          <ul className="-mx-2">
            <AnimatePresence initial={false}>
              {list.map((client) => (
                // 设备上下线时整行收起 / 展开，其余行跟着平滑移动；不用 layout 动画（页面别处一变高，它会从旧位置飞过来）
                <motion.li key={client.mac} {...collapse} className="overflow-hidden">
                  <div className="group/row relative flex items-center gap-3 rounded-[12px] px-2 py-2.5 transition-colors hover:bg-hover">
                  <DeviceAvatar guess={guessDevice([client.name, client.reportedName], client.mac, client.via)} />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="truncate text-[15px] font-medium text-text">{client.name}</span>
                      {client.ip === clientIp && (
                        <Badge size="sm" tone="accent">
                          {t.hotspot.thisDevice}
                        </Badge>
                      )}
                    </span>
                    <span className="num block truncate text-footnote text-text-3">
                      {[client.via === 'wifi' ? t.hotspot.viaWifi : t.hotspot.viaUsb, client.ip, client.mac].filter(Boolean).join(' · ')}
                    </span>
                  </span>
                  <Menu>
                    <MenuTrigger asChild>
                      <Button variant="ghost" size="icon-sm" aria-label={t.common.more} className="text-text-3">
                        <DotsThree weight="bold" />
                      </Button>
                    </MenuTrigger>
                    <MenuContent align="end">
                      <MenuItem icon={<PencilSimple />} onSelect={() => setRenaming(client)}>
                        {t.hotspot.rename}
                      </MenuItem>
                      <MenuItem
                        icon={<Copy />}
                        onSelect={async () => {
                          if (await copyText(client.mac)) toast.success(t.common.copied, { description: client.mac })
                        }}
                      >
                        {t.hotspot.copyMac}
                      </MenuItem>
                      <MenuSeparator />
                      <MenuItem icon={<Prohibit />} tone="danger" disabled={!acl} onSelect={() => void block(client)}>
                        {t.hotspot.block}
                      </MenuItem>
                    </MenuContent>
                  </Menu>
                  </div>
                </motion.li>
              ))}
            </AnimatePresence>
          </ul>
        )}
      </Panel>

      {acl && acl.blocked.length > 0 && (
        <ListGroup title={t.hotspot.blockedTitle}>
          {acl.blocked.map((item) => (
            <ListRow
              key={item.mac}
              leading={<DeviceAvatar guess={guessDevice([item.name], item.mac, 'wifi')} className="size-9 opacity-60" />}
              title={item.name}
              subtitle={<span className="num">{item.mac}</span>}
              trailing={
                <Button variant="secondary" size="sm" disabled={setBlocked.isPending} onClick={() => void unblock(item.mac)}>
                  {t.hotspot.unblock}
                </Button>
              }
            />
          ))}
        </ListGroup>
      )}

      <RenameDialog client={renaming} onClose={() => setRenaming(null)} />
    </>
  )
}

function RenameDialog({ client, onClose }: { client: Client | null; onClose: () => void }) {
  const t = useT()
  const queryClient = useQueryClient()
  const [name, setName] = useState('')
  useEffect(() => {
    if (client) setName(client.name === client.mac ? '' : client.name)
  }, [client])
  const rename = useMutation({
    mutationFn: () => hotspotApi.rename(client!.mac, name),
    onSuccess: () => {
      toast.success(t.hotspot.renamed)
      void queryClient.invalidateQueries({ queryKey: clientsKey })
      onClose()
    },
    onError: () => toast.error(t.common.operationFailed),
  })
  return (
    <Dialog open={Boolean(client)} onOpenChange={(open) => !open && !rename.isPending && onClose()}>
      <DialogContent
        title={t.hotspot.renameTitle}
        description={client ? <span className="num">{client.mac}</span> : undefined}
        size="sm"
        busy={rename.isPending}
        footer={
          <>
            <Button variant="secondary" disabled={rename.isPending} onClick={onClose}>
              {t.common.cancel}
            </Button>
            <Button variant="primary" loading={rename.isPending} disabled={!name.trim()} onClick={() => rename.mutate()}>
              {t.common.save}
            </Button>
          </>
        }
      >
        <Field label={t.device.name}>
          {(id) => <Input id={id} value={name} onValueChange={setName} placeholder={t.hotspot.renamePlaceholder} autoFocus maxLength={64} clearable />}
        </Field>
      </DialogContent>
    </Dialog>
  )
}

