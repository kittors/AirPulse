import { ArrowClockwise, CaretRight, FileCode, HardDrives, PuzzlePiece, ShieldCheck, Warning } from '@phosphor-icons/react'
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'

import { ADB_PORT, advancedApi, hasRoot, TTYD_PORT, uploadUrl } from '@/api/advanced'
import { credentialsStore } from '@/api/auth'
import { adminPasswordDigest } from '@/api/crypto'
import { systemApi } from '@/api/system'
import { Button } from '@/components/ui/button'
import { ListGroup, ListRow, Panel } from '@/components/ui/card'
import { Dialog, DialogContent, useConfirm } from '@/components/ui/dialog'
import { Skeleton, Spinner } from '@/components/ui/feedback'
import { SwitchRow } from '@/components/ui/form-rows'
import { Field, IntegerInput, PasswordInput } from '@/components/ui/input'
import { Meter } from '@/components/ui/meter'
import { Tooltip } from '@/components/ui/overlay'
import { Switch } from '@/components/ui/switch'
import { toast } from '@/components/ui/toast'
import { useT } from '@/i18n'
import { cn } from '@/lib/cn'
import { errorMessage } from '@/lib/errors'
import { storage } from '@/lib/storage'
import { createStore, useStore } from '@/lib/store'
import { parseCustomHead } from '@/model/plugins'
import { userBlockedPorts, V4_SYSTEM_PORTS, withPortBlocked, type BlockedPorts } from '@/model/ports'

import { switchesQuery, useSwitch } from '../settings/switches'
import { BootScriptSheet } from './BootScriptSheet'
import { CustomHeadSheet } from './CustomHeadSheet'
import { adbWifiQuery, capabilitiesKey, customHeadQuery, portsQuery, rootKey, useCapabilities, useRoot } from './keys'
import { UploadsGroup } from './UploadsGroup'

const WAIT_MS = 180_000

/** 开启高级功能后要等 root 真正可用（30 s – 2 min）：进度放在模块里，切走再回来还在 */
const enablingStore = createStore<number | null>(null)

async function waitForRoot(queryClient: QueryClient, done: (ok: boolean) => void) {
  const started = Date.now()
  enablingStore.set(started)
  while (Date.now() - started < WAIT_MS) {
    await new Promise((resolve) => setTimeout(resolve, 3_000))
    if (await hasRoot()) {
      enablingStore.set(null)
      queryClient.setQueryData(rootKey, true)
      void queryClient.invalidateQueries({ queryKey: capabilitiesKey })
      void queryClient.invalidateQueries({ queryKey: ['tools', 'ttyd'] })
      return done(true)
    }
  }
  enablingStore.set(null)
  done(false)
}

/**
 * 高级：顶部一张状态卡（高级功能是否生效 + 无线 ADB / 设备管理密码两个前置条件），
 * 下面按用途分组：ADB、文件共享、端口防护、脚本与自定义代码、上传的文件。
 * 依赖 root 的项在没有 root 时直接置灰并说明原因。
 */
export function AdvancedSection() {
  return (
    <div className="@container">
      <div className="grid grid-cols-1 items-start gap-x-6 gap-y-7 @4xl:grid-cols-2">
        <div className="flex flex-col gap-7">
          <AdvancedHero />
          <AdbGroup />
          <SambaGroup />
          <ScriptsGroup />
        </div>
        <div className="flex flex-col gap-7">
          <PortsGroup />
          <UploadsGroup />
        </div>
      </div>
    </div>
  )
}

function AdvancedHero() {
  const t = useT()
  const confirm = useConfirm()
  const queryClient = useQueryClient()
  const caps = useCapabilities()
  const enablingSince = useStore(enablingStore)
  const [now, setNow] = useState(() => Date.now())
  const waiting = enablingSince != null
  // 等待期间每秒刷新一次计时
  useEffect(() => {
    if (!waiting) return
    const timer = window.setInterval(() => setNow(Date.now()), 1_000)
    return () => window.clearInterval(timer)
  }, [waiting])

  const enable = useMutation({
    mutationFn: advancedApi.enableAdvanced,
    onSuccess: (message) => {
      toast.info(t.tools.advanced.enableSent, { description: message || undefined })
      void waitForRoot(queryClient, (ok) =>
        ok ? toast.success(t.tools.advanced.enabledToast) : toast.warning(t.tools.advanced.enableSlow, { description: t.tools.advanced.enableSlowBody }),
      )
    },
    onError: (error) => toast.error(t.tools.advanced.enableFailed, { description: errorMessage(error) }),
  })
  const disable = useMutation({
    mutationFn: advancedApi.disableAdvanced,
    onSuccess: (message) => {
      toast.success(t.tools.advanced.disabledToast, { description: message || undefined })
      queryClient.setQueryData(rootKey, false)
      void queryClient.invalidateQueries({ queryKey: capabilitiesKey })
    },
    onError: (error) => toast.error(t.common.operationFailed, { description: errorMessage(error) }),
  })

  const root = caps.data?.root
  const onAction = async () => {
    if (root) {
      const ok = await confirm({ tone: 'danger', title: t.tools.advanced.disableTitle, description: t.tools.advanced.disableBody, confirmText: t.tools.advanced.disable })
      if (ok) disable.mutate()
      return
    }
    const ok = await confirm({
      tone: 'warning',
      title: t.tools.advanced.enableTitle,
      description: t.tools.advanced.enableBody,
      details: !caps.data?.adb ? <span className="text-warning-text">{t.tools.advanced.enableNoAdb}</span> : undefined,
      confirmText: t.tools.advanced.enable,
    })
    if (ok) enable.mutate()
  }

  const elapsed = waiting ? Math.max(0, now - enablingSince) : 0
  return (
    <Panel>
      <div className="flex items-start gap-3.5">
        <span className={cn('grid size-10 shrink-0 place-items-center rounded-[12px]', root ? 'bg-success-soft text-success' : 'bg-sunken text-text-3')}>
          <ShieldCheck className="size-[22px]" weight={root ? 'fill' : 'regular'} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h2 className="text-headline text-text">{t.tools.advanced.title}</h2>
            <Tooltip content={t.common.refresh}>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={t.common.refresh}
                className="-my-1"
                onClick={() => void queryClient.invalidateQueries({ queryKey: capabilitiesKey })}
              >
                <ArrowClockwise className={cn(caps.isFetching && 'ap-spin')} />
              </Button>
            </Tooltip>
          </div>
          <p className="mt-0.5 text-footnote text-text-2">
            {!caps.data ? t.common.loading : waiting ? t.tools.advanced.waiting : root ? t.tools.advanced.onBody : t.tools.advanced.offBody}
          </p>
        </div>
        {caps.data && !waiting && (
          <Button variant={root ? 'danger-soft' : 'primary'} size="sm" className="shrink-0" loading={enable.isPending || disable.isPending} onClick={() => void onAction()}>
            {root ? t.tools.advanced.disable : t.tools.advanced.enable}
          </Button>
        )}
      </div>

      {waiting && (
        <div className="mt-4">
          <Meter value={elapsed} max={WAIT_MS} tone="accent" size="sm" />
          <p className="mt-2 flex items-center gap-2 text-footnote text-text-3">
            <Spinner className="size-3.5" />
            {t.tools.advanced.waitingFor(Math.floor(elapsed / 1000))}
          </p>
        </div>
      )}

      <div className="mt-4 grid grid-cols-2 gap-3 border-t border-line pt-4 max-sm:grid-cols-1">
        {!caps.data ? (
          <>
            <Skeleton className="h-10" />
            <Skeleton className="h-10" />
          </>
        ) : (
          <>
            <Requirement ok={caps.data.adb} label={t.tools.advanced.adbStatus} value={caps.data.adb ? t.tools.advanced.adbReady : t.tools.advanced.adbWaiting} />
            <Requirement
              ok={caps.data.adminSynced}
              label={t.tools.advanced.adminStatus}
              value={caps.data.adminSynced ? t.tools.advanced.adminSynced : t.tools.advanced.adminMissing}
            />
          </>
        )}
      </div>
    </Panel>
  )
}

function Requirement({ ok, label, value }: { ok: boolean; label: string; value: string }) {
  return (
    <div className="flex min-w-0 items-start gap-2.5">
      <span className={cn('mt-[7px] size-2 shrink-0 rounded-full', ok ? 'bg-success' : 'bg-warning')} />
      <div className="min-w-0">
        <p className="text-caption text-text-3">{label}</p>
        <p className={cn('text-subhead font-medium', ok ? 'text-text' : 'text-warning-text')}>{value}</p>
      </div>
    </div>
  )
}

/* —— ADB —— */

function AdbGroup() {
  const t = useT()
  const confirm = useConfirm()
  const queryClient = useQueryClient()
  const switches = useQuery(switchesQuery)
  const wifi = useQuery(adbWifiQuery)
  const root = useRoot()
  const usb = useSwitch('usbDebug', systemApi.setUsbDebug)
  const [asking, setAsking] = useState(false)

  const setWifi = useMutation({
    mutationFn: ({ enabled, password }: { enabled: boolean; password: string }) => advancedApi.setAdbWifi(enabled, password),
    onMutate: ({ enabled }) => queryClient.setQueryData(['tools', 'adb-wifi'], enabled),
    onSuccess: (_data, { enabled }) => {
      toast.success(enabled ? t.tools.adb.wifiOn : t.tools.adb.wifiOff, { description: t.tools.adb.rebootToApply })
      void queryClient.invalidateQueries({ queryKey: capabilitiesKey })
    },
    onError: (error) => toast.error(t.common.operationFailed, { description: errorMessage(error) }),
    onSettled: () => void queryClient.invalidateQueries({ queryKey: ['tools', 'adb-wifi'] }),
  })

  const toggleWifi = async (enabled: boolean) => {
    const saved = await advancedApi.officialPassword().catch(() => '')
    if (!enabled) return setWifi.mutate({ enabled, password: saved })
    // 后端要明文：已同步且与登录时的密码一致就直接用，否则请用户输入一次
    const digest = credentialsStore.get()?.adminDigest
    if (saved && (!digest || adminPasswordDigest(saved) === digest)) return setWifi.mutate({ enabled, password: saved })
    setAsking(true)
  }

  return (
    <>
      <ListGroup title={t.tools.adb.title} footer={t.tools.adb.footer(ADB_PORT)}>
        <SwitchRow
          title={t.tools.adb.usb}
          subtitle={t.tools.adb.usbHint}
          checked={Boolean(switches.data?.usbDebug)}
          disabled={!switches.data}
          loading={usb.isPending}
          onCheckedChange={async (value) => {
            if (value && root.data) {
              const ok = await confirm({ tone: 'warning', title: t.tools.adb.usbConflictTitle, description: t.tools.adb.usbConflictBody, confirmText: t.common.turnOn })
              if (!ok) return
            }
            usb.mutate(value)
          }}
        />
        <SwitchRow
          title={t.tools.adb.wifi}
          subtitle={t.tools.adb.wifiHint}
          checked={Boolean(wifi.data)}
          disabled={wifi.data == null}
          loading={setWifi.isPending}
          onCheckedChange={(value) => void toggleWifi(value)}
        />
      </ListGroup>
      <AdminPasswordPrompt
        open={asking}
        onOpenChange={setAsking}
        onSubmit={(password) => {
          setAsking(false)
          setWifi.mutate({ enabled: true, password })
        }}
      />
    </>
  )
}

function AdminPasswordPrompt({ open, onOpenChange, onSubmit }: { open: boolean; onOpenChange: (open: boolean) => void; onSubmit: (password: string) => void }) {
  const t = useT()
  const [value, setValue] = useState('')
  const [error, setError] = useState<string | null>(null)
  const submit = () => {
    const digest = credentialsStore.get()?.adminDigest
    // 和登录一致：密码去掉首尾空白再比对
    const password = value.trim()
    if (!password) return setError(t.tools.adb.passwordRequired)
    if (digest && adminPasswordDigest(password) !== digest) return setError(t.tools.adb.passwordWrong)
    setError(null)
    setValue('')
    onSubmit(password)
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        size="sm"
        title={t.tools.adb.passwordTitle}
        description={t.tools.adb.passwordBody}
        footer={
          <>
            <Button variant="secondary" onClick={() => onOpenChange(false)}>
              {t.common.cancel}
            </Button>
            <Button variant="primary" onClick={submit}>
              {t.common.confirm}
            </Button>
          </>
        }
      >
        <Field label={t.tools.adb.password} error={error}>
          {(id) => (
            <PasswordInput
              id={id}
              value={value}
              onValueChange={setValue}
              autoFocus
              autoComplete="current-password"
              onKeyDown={(event) => event.key === 'Enter' && submit()}
              invalid={Boolean(error)}
            />
          )}
        </Field>
      </DialogContent>
    </Dialog>
  )
}

/* —— 文件共享 —— */

function SambaGroup() {
  const t = useT()
  const confirm = useConfirm()
  const switches = useQuery(switchesQuery)
  const root = useRoot()
  const samba = useSwitch('samba', systemApi.setSamba)
  const locked = Boolean(root.data && switches.data?.samba)
  return (
    <ListGroup title={t.tools.samba.title} footer={locked ? t.tools.samba.locked : t.tools.samba.footer}>
      <SwitchRow
        title={t.tools.samba.switch}
        subtitle={t.tools.samba.hint}
        checked={Boolean(switches.data?.samba)}
        disabled={!switches.data}
        loading={samba.isPending}
        onCheckedChange={async (value) => {
          if (!value && locked) {
            const ok = await confirm({ tone: 'danger', title: t.tools.samba.offTitle, description: t.tools.samba.offBody, confirmText: t.common.turnOff })
            if (!ok) return
          }
          samba.mutate(value)
        }}
      />
    </ListGroup>
  )
}

/* —— 端口防护 —— */

function PortsGroup() {
  const t = useT()
  const queryClient = useQueryClient()
  const root = useRoot()
  const blocked = useQuery({ ...portsQuery, enabled: Boolean(root.data) })
  const [ipv6, setIpv6] = useState(() => storage.get('ports-ipv6', true))
  const [onBoot, setOnBoot] = useState(() => storage.get('ports-boot', true))
  const [custom, setCustom] = useState('')
  const [busy, setBusy] = useState<number | null>(null)
  const available = Boolean(root.data)

  const set = async (port: number, allow: boolean) => {
    setBusy(port)
    try {
      await advancedApi.setPortBlocked(port, !allow, { ipv6, onBoot })
      // 先按写入结果更新开关，再去设备上读一遍确认
      queryClient.setQueryData<BlockedPorts>(portsQuery.queryKey, (prev) => prev && withPortBlocked(prev, port, !allow, ipv6))
      toast.success(allow ? t.tools.ports.allowed(port) : t.tools.ports.blocked(port))
    } catch (error) {
      toast.error(t.common.operationFailed, { description: errorMessage(error) })
    } finally {
      setBusy(null)
      void queryClient.invalidateQueries({ queryKey: portsQuery.queryKey })
    }
  }

  const known = [
    { port: TTYD_PORT, label: t.tools.ports.ttyd },
    { port: ADB_PORT, label: t.tools.ports.adb },
  ]
  const extra = blocked.data ? userBlockedPorts(blocked.data, known.map((k) => k.port)) : []
  const customPort = Number(custom)
  // 固件管的端口（8080 官方后台等）不让在这里改
  const customSystem = V4_SYSTEM_PORTS.has(customPort)
  const customValid = Number.isInteger(customPort) && customPort > 0 && customPort < 65536 && !customSystem

  return (
    <ListGroup title={t.tools.ports.title} footer={available ? t.tools.ports.footer : t.tools.ports.needsRoot}>
      {[...known, ...extra.map((port) => ({ port, label: t.tools.ports.custom }))].map(({ port, label }) => (
        <ListRow
          key={port}
          disabled={!available}
          title={label}
          subtitle={
            <span className="num">
              TCP {port}
              {blocked.data?.v6.has(port) && ` · ${t.tools.ports.v6Blocked}`}
            </span>
          }
          trailing={
            busy === port ? (
              <Spinner />
            ) : (
              <span className="flex items-center gap-2.5">
                <span className="text-footnote text-text-3">{blocked.data?.v4.has(port) ? t.tools.ports.blockedState : t.tools.ports.allowedState}</span>
                <Switch
                  checked={available && !blocked.data?.v4.has(port)}
                  disabled={!available || !blocked.data}
                  onCheckedChange={(allow) => void set(port, allow)}
                  aria-label={`${label} ${port}`}
                />
              </span>
            )
          }
        />
      ))}
      <div className={cn('flex items-center gap-2 py-2.5 pr-4 pl-4 max-sm:px-3', !available && 'opacity-50')}>
        <IntegerInput
          size="sm"
          value={custom}
          onValueChange={setCustom}
          placeholder={t.tools.ports.portPlaceholder}
          maxLength={5}
          disabled={!available}
          aria-label={t.tools.ports.portPlaceholder}
          shellClassName="max-w-40"
        />
        <Button
          size="sm"
          variant="secondary"
          disabled={!available || !customValid || busy != null}
          onClick={() => {
            void set(customPort, false)
            setCustom('')
          }}
        >
          {t.tools.ports.block}
        </Button>
      </div>
      {customSystem && <p className="-mt-1 px-4 pb-2.5 text-footnote text-warning-text max-sm:px-3">{t.tools.ports.systemPort(customPort)}</p>}
      <SwitchRow
        title={t.tools.ports.onBoot}
        checked={onBoot}
        disabled={!available}
        onCheckedChange={(v) => {
          setOnBoot(v)
          storage.set('ports-boot', v)
        }}
      />
      <SwitchRow
        title={t.tools.ports.ipv6}
        subtitle={t.tools.ports.ipv6Hint}
        checked={ipv6}
        disabled={!available}
        onCheckedChange={(v) => {
          setIpv6(v)
          storage.set('ports-ipv6', v)
        }}
      />
    </ListGroup>
  )
}

/* —— 启动脚本与自定义代码 —— */

/** 触发浏览器下载（上传目录里的文件由 AirPulse 后端直接提供） */
function download(name: string) {
  const a = document.createElement('a')
  a.href = uploadUrl(name)
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
}

function ScriptsGroup() {
  const t = useT()
  const confirm = useConfirm()
  const queryClient = useQueryClient()
  const root = useRoot()
  const backup = useMutation({
    mutationFn: advancedApi.extractBoot,
    onMutate: () => toast.loading(t.tools.scripts.backupBootRunning),
    onSuccess: (name, _vars, toastId) => {
      toast.update(toastId, { tone: 'success', title: t.tools.scripts.backupBootDone(name), duration: 10_000, action: { label: t.tools.scripts.download, onClick: () => download(name) } })
      void queryClient.invalidateQueries({ queryKey: ['tools', 'uploads'] })
    },
    onError: (error, _vars, toastId) => {
      if (toastId != null) toast.dismiss(toastId)
      toast.error(t.common.operationFailed, { description: errorMessage(error) })
    },
  })
  const head = useQuery(customHeadQuery)
  const [sheet, setSheet] = useState<'boot' | 'head' | null>(null)
  const parsed = head.data != null ? parseCustomHead(head.data) : null
  const enabled = parsed?.blocks.filter((b) => b.enabled).length ?? 0
  return (
    <>
      <ListGroup title={t.tools.scripts.title}>
        <ListRow
          leading={<FileCode className="size-5 text-text-3" />}
          title={t.tools.scripts.boot}
          subtitle={root.data ? t.tools.scripts.bootHint : t.tools.scripts.needsRoot}
          disabled={!root.data}
          onClick={() => setSheet('boot')}
          trailing={<CaretRight className="size-3.5 text-text-4" weight="bold" />}
        />
        <ListRow
          leading={<PuzzlePiece className="size-5 text-text-3" />}
          title={t.tools.scripts.head}
          subtitle={
            parsed == null
              ? head.isError
                ? errorMessage(head.error)
                : t.common.loading
              : parsed.blocks.length || parsed.loose
                ? t.tools.scripts.headSummary(parsed.blocks.length + (parsed.loose ? 1 : 0), enabled + (parsed.loose ? 1 : 0))
                : t.tools.scripts.headEmpty
          }
          onClick={() => setSheet('head')}
          trailing={
            <>
              {(enabled > 0 || parsed?.loose) && <Warning className="size-4 text-warning" weight="fill" aria-label={t.tools.scripts.activeWarning} />}
              <CaretRight className="size-3.5 text-text-4" weight="bold" />
            </>
          }
        />
        <ListRow
          leading={<HardDrives className="size-5 text-text-3" />}
          title={t.tools.scripts.backupBoot}
          subtitle={root.data ? t.tools.scripts.backupBootHint : t.tools.scripts.needsRoot}
          disabled={!root.data || backup.isPending}
          onClick={() =>
            void confirm({ title: t.tools.scripts.backupBootTitle, description: t.tools.scripts.backupBootBody, confirmText: t.tools.scripts.backupBoot }).then(
              (ok) => ok && backup.mutate(),
            )
          }
          trailing={backup.isPending ? <Spinner /> : <CaretRight className="size-3.5 text-text-4" weight="bold" />}
        />
      </ListGroup>
      <BootScriptSheet open={sheet === 'boot'} onOpenChange={(open) => setSheet(open ? 'boot' : null)} />
      <CustomHeadSheet open={sheet === 'head'} onOpenChange={(open) => setSheet(open ? 'head' : null)} />
    </>
  )
}
