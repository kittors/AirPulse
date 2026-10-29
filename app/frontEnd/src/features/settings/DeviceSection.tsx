import { ArrowClockwise, Power } from '@phosphor-icons/react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'

import { advancedApi } from '@/api/advanced'
import { credentialsStore, persistCredentials } from '@/api/auth'
import { adminPasswordDigest } from '@/api/crypto'
import { systemApi, truthy } from '@/api/system'
import { hrefOf } from '@/app/router'
import { Button } from '@/components/ui/button'
import { ListGroup, ListRow } from '@/components/ui/card'
import { Dialog, DialogContent, useConfirm } from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/feedback'
import { InputRow, SaveActions, SwitchRow } from '@/components/ui/form-rows'
import { Field, PasswordInput } from '@/components/ui/input'
import { SegmentedControl } from '@/components/ui/segmented'
import { toast } from '@/components/ui/toast'
import { useTelemetry } from '@/hooks/useTelemetry'
import { useT } from '@/i18n'
import { errorMessage } from '@/lib/errors'
import { storage } from '@/lib/storage'
import { formatTimeInput, normalizeTime } from '@/model/tasks'
import { versionInfoQuery } from '@/hooks/queries'

import { useCapabilities } from '../tools/keys'
import { askReboot, switchesKey, switchesQuery, usePerformanceMode, useSwitch } from './switches'

const WAKELOCK_KEY = 'wakelock'
export const logStatusQuery = { queryKey: ['system', 'log-status'] as const, queryFn: systemApi.logStatus }

/**
 * 设备：名称、指示灯、性能模式、定时重启；设备管理密码；电源（重启 / 关机）；维护开关。
 */
export function DeviceSection() {
  return (
    <div className="@container">
      <div className="grid grid-cols-1 gap-x-6 gap-y-7 @4xl:grid-cols-2 @4xl:items-start">
        <div className="flex flex-col gap-7">
          <GeneralGroup />
          <AdminPasswordGroup />
        </div>
        <div className="flex flex-col gap-7">
          <PowerGroup />
          <MaintenanceGroup />
        </div>
      </div>
    </div>
  )
}

function GeneralGroup() {
  const t = useT()
  const queryClient = useQueryClient()
  const switches = useQuery(switchesQuery)
  const version = useQuery(versionInfoQuery)
  const [name, setName] = useState<string | null>(null)
  const [time, setTime] = useState<string | null>(null)
  useEffect(() => {
    if (version.data && name === null) setName(version.data.nickname ?? '')
  }, [version.data, name])
  useEffect(() => {
    if (switches.data && time === null) setTime(switches.data.restartTime)
  }, [switches.data, time])

  const indicator = useSwitch('indicatorLight', systemApi.setIndicatorLight)
  const performance = usePerformanceMode()
  const schedule = useSwitch('restartSchedule', (enabled) => systemApi.setRestartSchedule(enabled, switches.data?.restartTime ?? '03:00'))
  const saveTime = useMutation({
    mutationFn: (value: string) => systemApi.setRestartSchedule(true, value),
    onSuccess: (_data, value) => {
      toast.success(t.device.changed)
      setTime(value)
      void queryClient.invalidateQueries({ queryKey: switchesKey })
    },
    onError: () => toast.error(t.common.operationFailed),
  })
  const saveName = useMutation({
    mutationFn: (value: string) => systemApi.setNickname(value.trim()),
    onSuccess: async () => {
      toast.success(t.device.nameSaved)
      // 名称清空时设备会改回型号名：以读回的为准，免得输入框留空、保存按钮一直在
      await queryClient.invalidateQueries({ queryKey: ['version-info'] })
      setName(queryClient.getQueryData<{ nickname?: string }>(['version-info'])?.nickname ?? '')
    },
    onError: () => toast.error(t.common.operationFailed),
  })

  if (!switches.data) {
    return (
      <ListGroup title={t.device.title}>
        <div className="p-4">
          <Skeleton className="h-40" />
        </div>
      </ListGroup>
    )
  }
  const s = switches.data
  const normalizedTime = normalizeTime(time ?? '')
  const timeValid = normalizedTime !== null
  const nameDirty = name !== null && name.trim() !== (version.data?.nickname ?? '')
  // 设备读回名称时用字符串模板拼 JSON，这两个字符会让免鉴权的 version_info 返回坏掉的 JSON
  const nameInvalid = /["\\]/.test(name ?? '')
  const timeDirty = time !== null && normalizedTime !== s.restartTime
  return (
    <div>
      <ListGroup title={t.device.title}>
        <InputRow
          label={t.device.name}
          value={name ?? ''}
          onChange={setName}
          placeholder={t.device.namePlaceholder}
          maxLength={64}
          error={nameInvalid ? t.device.nameInvalid : null}
        />
        <SwitchRow title={t.device.indicator} subtitle={t.device.indicatorHint} checked={s.indicatorLight} onCheckedChange={(v) => indicator.mutate(v)} />
        <SwitchRow title={t.device.performance} subtitle={t.device.performanceHint} checked={s.performanceMode} onCheckedChange={performance.set} />
        <SwitchRow title={t.device.restartSchedule} subtitle={t.device.restartScheduleHint} checked={s.restartSchedule} onCheckedChange={(v) => schedule.mutate(v)} />
        {s.restartSchedule && (
          <InputRow
            label={t.device.restartTime}
            value={time ?? ''}
            onChange={(v) => setTime(formatTimeInput(v))}
            inputMode="numeric"
            mono
            placeholder="03:00"
            error={time !== null && !timeValid ? t.device.invalidTime : null}
          />
        )}
      </ListGroup>
      <SaveActions
        dirty={nameDirty || (s.restartSchedule && timeDirty)}
        saving={saveName.isPending || saveTime.isPending}
        disabled={(s.restartSchedule && timeDirty && !timeValid) || nameInvalid}
        onRevert={() => {
          setName(version.data?.nickname ?? '')
          setTime(s.restartTime)
        }}
        onSave={() => {
          if (nameDirty && name !== null) saveName.mutate(name)
          if (s.restartSchedule && timeDirty && normalizedTime) saveTime.mutate(normalizedTime)
        }}
      />
    </div>
  )
}

function AdminPasswordGroup() {
  const t = useT()
  const [open, setOpen] = useState(false)
  return (
    <>
      <ListGroup title={t.device.adminTitle} footer={t.device.adminFooter}>
        <ListRow title={<span className="text-accent-text">{t.device.adminChange}</span>} onClick={() => setOpen(true)} />
      </ListGroup>
      <AdminPasswordDialog open={open} onOpenChange={setOpen} />
    </>
  )
}

function AdminPasswordDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const t = useT()
  const [form, setForm] = useState({ old: '', next: '', repeat: '' })
  const [error, setError] = useState<string | null>(null)
  const change = useMutation({
    // 登录时密码会去掉首尾空白，这里保持一致
    mutationFn: () => systemApi.changeAdminPassword(form.old.trim(), form.next),
    onSuccess: () => {
      // 本地只存密码摘要，会话续登和无线 ADB 的密码比对都靠它：不换成新的，下次续登就会被当成密码错误
      const current = credentialsStore.get()
      if (current) persistCredentials({ ...current, adminDigest: adminPasswordDigest(form.next) })
      toast.success(t.device.adminChanged)
      setForm({ old: '', next: '', repeat: '' })
      onOpenChange(false)
    },
    onError: (err) => setError(errorMessage(err)),
  })
  const submit = () => {
    if (!form.old.trim() || !form.next || !form.repeat) return setError(t.device.adminEmpty)
    if (form.next !== form.next.trim()) return setError(t.device.adminSpaces)
    if (form.next !== form.repeat) return setError(t.device.adminMismatch)
    setError(null)
    change.mutate()
  }
  return (
    <Dialog open={open} onOpenChange={(next) => !change.isPending && onOpenChange(next)}>
      <DialogContent
        title={t.device.adminChange}
        size="sm"
        busy={change.isPending}
        footer={
          <>
            <Button variant="secondary" disabled={change.isPending} onClick={() => onOpenChange(false)}>
              {t.common.cancel}
            </Button>
            <Button variant="primary" loading={change.isPending} onClick={submit}>
              {t.common.save}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          {(['old', 'next', 'repeat'] as const).map((key) => (
            <Field key={key} label={key === 'old' ? t.device.adminOld : key === 'next' ? t.device.adminNew : t.device.adminRepeat}>
              {(id) => (
                <PasswordInput
                  id={id}
                  value={form[key]}
                  onValueChange={(v) => setForm((f) => ({ ...f, [key]: v }))}
                  autoComplete={key === 'old' ? 'current-password' : 'new-password'}
                  autoFocus={key === 'old'}
                />
              )}
            </Field>
          ))}
          {error && <p className="text-footnote text-danger-text">{error}</p>}
        </div>
      </DialogContent>
    </Dialog>
  )
}

/** 「立即重启」：很多设置要重启才生效，toast 上的按钮和电源分组共用这一个确认 */
function PowerGroup() {
  const t = useT()
  const confirm = useConfirm()
  const { data: telemetry } = useTelemetry()
  const hasBattery = Boolean(telemetry?.battery)
  return (
    <ListGroup title={t.device.powerTitle}>
      <ListRow leading={<ArrowClockwise className="size-5 text-accent" weight="bold" />} title={t.device.reboot} onClick={() => askReboot(confirm, t)} />
      {hasBattery && (
        <ListRow
          leading={<Power className="size-5 text-danger" weight="bold" />}
          title={<span className="text-danger-text">{t.device.shutdown}</span>}
          onClick={() =>
            void confirm({
              tone: 'danger',
              title: t.device.shutdownTitle,
              description: t.device.shutdownBody,
              confirmText: t.device.shutdown,
              onConfirm: () => systemApi.shutdown(),
            }).then((ok) => ok && toast.info(t.device.shuttingDown))
          }
        />
      )}
    </ListGroup>
  )
}

function MaintenanceGroup() {
  const t = useT()
  const confirm = useConfirm()
  const queryClient = useQueryClient()
  const status = useQuery(logStatusQuery)
  const toggleLog = async (value: boolean) => {
    queryClient.setQueryData(['system', 'log-status'], { ...status.data, debug_log_enabled: value })
    try {
      await systemApi.setLogStatus(value)
    } catch (error) {
      toast.error(t.common.operationFailed, { description: errorMessage(error) })
    } finally {
      void queryClient.invalidateQueries({ queryKey: ['system', 'log-status'] })
    }
  }
  // 唤醒锁只有写接口、读不回来：记住这台浏览器上一次的设置，没有记录时两边都不选中
  const [wakeLast, setWakeLast] = useState(() => storage.get<boolean | null>(WAKELOCK_KEY, null))
  const wake = useMutation({
    mutationFn: (on: boolean) => systemApi.setWakelock(on),
    onSuccess: (_data, on) => {
      storage.set(WAKELOCK_KEY, on)
      setWakeLast(on)
      toast.success(t.device.wakelockDone(on))
    },
    onError: (error) => toast.error(t.common.operationFailed, { description: errorMessage(error) }),
  })
  const wakeShown = wake.isPending ? wake.variables : wakeLast
  const caps = useCapabilities()
  const fotaReady = caps.data != null && (caps.data.root || caps.data.adb)
  const fota = useMutation({
    mutationFn: () => advancedApi.disableFota(caps.data?.root === true),
    onSuccess: () => toast.success(t.device.disableFotaDone, { description: caps.data?.root ? t.device.disableFotaViaRoot : t.device.disableFotaViaAdb }),
    onError: (error) => toast.error(t.common.operationFailed, { description: errorMessage(error) }),
  })
  const runFota = () =>
    void confirm({ tone: 'warning', title: t.device.disableFotaTitle, description: t.device.disableFotaBody, confirmText: t.device.run }).then((ok) => ok && fota.mutate())
  return (
    <ListGroup title={t.device.maintenanceTitle}>
      <SwitchRow
        title={t.device.debugLog}
        subtitle={t.device.debugLogHint}
        checked={truthy(status.data?.debug_log_enabled)}
        disabled={!status.data}
        onCheckedChange={(value) => void toggleLog(value)}
      />
      <ListRow
        title={t.device.wakelock}
        subtitle={
          wakeLast == null ? (
            <>
              {t.device.wakelockHint}
              <span className="block text-text-4">{t.device.wakelockUnknown}</span>
            </>
          ) : (
            t.device.wakelockHint
          )
        }
        trailing={
          <SegmentedControl
            size="sm"
            ariaLabel={t.device.wakelock}
            value={wakeShown == null ? undefined : wakeShown ? 'on' : 'off'}
            pending={wake.isPending}
            onChange={(next) => wake.mutate(next === 'on')}
            options={[
              { value: 'on', label: t.device.wakelockOn },
              { value: 'off', label: t.device.wakelockOff },
            ]}
          />
        }
      />
      <ListRow
        title={t.device.disableFota}
        subtitle={caps.data && !fotaReady ? <span className="text-warning-text">{t.device.disableFotaNeeds}</span> : t.device.disableFotaHint}
        trailing={
          caps.data && !fotaReady ? (
            <Button variant="secondary" size="sm" asChild>
              <a href={hrefOf('tools', 'advanced')}>{t.device.goAdvanced}</a>
            </Button>
          ) : (
            <Button variant="secondary" size="sm" loading={fota.isPending} disabled={!caps.data} onClick={runFota}>
              {t.device.run}
            </Button>
          )
        }
      />
    </ListGroup>
  )
}
