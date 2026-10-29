import { CaretRight, Check, Plus } from '@phosphor-icons/react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AnimatePresence, motion } from 'motion/react'
import { useState } from 'react'

import { apnApi, firstEmptySlot, validApnText, type ApnAuth, type ApnDraft, type ApnProfile, type ApnState, type PdpType } from '@/api/apn'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ListGroup, ListRow } from '@/components/ui/card'
import { useConfirm } from '@/components/ui/dialog'
import { Callout, Skeleton } from '@/components/ui/feedback'
import { SwitchRow } from '@/components/ui/form-rows'
import { Field, Input, PasswordInput } from '@/components/ui/input'
import { SegmentedControl } from '@/components/ui/segmented'
import { Sheet, SheetContent } from '@/components/ui/sheet'
import { toast } from '@/components/ui/toast'
import { useT, type Messages } from '@/i18n'
import { errorMessage } from '@/lib/errors'
import { collapse } from '@/lib/motion'

import { apnKey, apnQuery } from './ipv6'

const PDP_LABELS: Record<PdpType, string> = { IP: 'IPv4', IPv6: 'IPv6', IPv4v6: 'IPv4v6' }
const authLabel = (auth: ApnAuth, t: Messages) => (auth === 'none' ? t.netSettings.apnAuthNone : auth.toUpperCase())

/**
 * APN：当前 APN + 「自动选择」开关 + 已保存的配置列表（像 iOS 的 Wi-Fi 列表：当前那条打勾，点一行看详情）。
 * 详情里再决定使用、修改还是删除；切换会重建数据连接，统一二次确认。
 */
export function ApnGroup() {
  const t = useT()
  const confirm = useConfirm()
  const queryClient = useQueryClient()
  const state = useQuery(apnQuery)
  const [sheet, setSheet] = useState<{ profile: ApnProfile | null; slot: number } | null>(null)

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: apnKey })
    void queryClient.invalidateQueries({ queryKey: ['telemetry'] })
  }

  const use = (profile: ApnProfile) =>
    confirm({
      title: t.netSettings.apnUseTitle(profile.name),
      description: t.netSettings.apnUseBody,
      confirmText: t.netSettings.apnUseNow,
      onConfirm: async () => {
        await apnApi.use(profile.slot, profile.pdp)
        await refresh()
        toast.success(t.netSettings.apnUsed(profile.name))
      },
    })

  const openNew = (data: ApnState) => {
    const slot = firstEmptySlot(data.profiles)
    if (slot == null) return toast.error(t.netSettings.apnFull)
    setSheet({ profile: null, slot })
  }

  const toggleAuto = async (data: ApnState, auto: boolean) => {
    if (auto) {
      await confirm({
        title: t.netSettings.apnAutoTitle,
        description: t.netSettings.apnAutoBody,
        confirmText: t.common.confirm,
        onConfirm: async () => {
          await apnApi.setAuto()
          await refresh()
          toast.success(t.netSettings.apnAutoDone)
        },
      })
      return
    }
    // 手动模式必须指定一条配置：优先用和当前 APN 一样的那条
    const candidate = data.profiles.find((p) => p.name === data.current.name && p.apn === data.current.apn) ?? data.profiles[0]
    if (!candidate) {
      toast.info(t.netSettings.apnNeedProfile)
      return openNew(data)
    }
    await confirm({
      title: t.netSettings.apnManualTitle,
      description: t.netSettings.apnManualBody(candidate.name),
      confirmText: t.common.confirm,
      onConfirm: async () => {
        await apnApi.use(candidate.slot, candidate.pdp)
        await refresh()
        toast.success(t.netSettings.apnUsed(candidate.name))
      },
    })
  }

  if (!state.data) {
    return (
      <ListGroup title={t.netSettings.apnTitle}>
        <div className="p-4">{state.isError ? <p className="text-footnote text-danger-text">{errorMessage(state.error)}</p> : <Skeleton className="h-24" />}</div>
      </ListGroup>
    )
  }

  const data = state.data
  return (
    <div className="flex flex-col gap-7">
      <ListGroup title={t.netSettings.apnTitle}>
        <ListRow
          title={t.netSettings.apnCurrent}
          subtitle={data.current.name || undefined}
          trailing={<span className="num max-w-48 truncate">{data.current.apn || '—'}</span>}
        />
        <SwitchRow
          title={t.netSettings.apnAuto}
          subtitle={t.netSettings.apnAutoHint}
          checked={data.mode === 'auto'}
          onCheckedChange={(auto) => void toggleAuto(data, auto)}
        />
      </ListGroup>

      <ListGroup footer={t.netSettings.apnFooter}>
        {data.profiles.map((profile) => {
          const current = data.mode === 'manual' && data.currentSlot === profile.slot
          return (
            <ListRow
              key={profile.slot}
              leading={<span className="flex w-5 justify-center">{current && <Check className="size-[18px] text-accent" weight="bold" />}</span>}
              title={profile.name || profile.apn}
              subtitle={<span className="num">{[profile.apn, authLabel(profile.auth, t), PDP_LABELS[profile.pdp]].join(' · ')}</span>}
              trailing={
                <>
                  {profile.slot < data.presetCount && <Badge size="sm">{t.netSettings.apnPreset}</Badge>}
                  <CaretRight className="size-3.5 text-text-4" weight="bold" />
                </>
              }
              onClick={() => setSheet({ profile, slot: profile.slot })}
            />
          )
        })}
        <ListRow
          leading={<span className="flex w-5 justify-center"><Plus className="size-[18px] text-accent" weight="bold" /></span>}
          title={<span className="text-accent-text">{t.netSettings.apnAdd}</span>}
          onClick={() => openNew(data)}
        />
      </ListGroup>

      <ApnSheet
        target={sheet}
        state={data}
        onClose={() => setSheet(null)}
        onUse={(profile) => {
          setSheet(null)
          void use(profile)
        }}
        onChanged={refresh}
      />
    </div>
  )
}

const EMPTY: ApnDraft = { name: '', apn: '', auth: 'none', username: '', password: '', pdp: 'IP' }

function ApnSheet({
  target,
  state,
  onClose,
  onUse,
  onChanged,
}: {
  target: { profile: ApnProfile | null; slot: number } | null
  state: ApnState
  onClose: () => void
  onUse: (profile: ApnProfile) => void
  onChanged: () => Promise<void>
}) {
  const t = useT()
  const confirm = useConfirm()
  // 打开时按目标回填（关闭动画期间保留上一次的内容）
  const [opened, setOpened] = useState(target)
  const [draft, setDraft] = useState<ApnDraft>(EMPTY)
  const [submitted, setSubmitted] = useState(false)
  if (target && target !== opened) {
    setOpened(target)
    setDraft(target.profile ? { ...target.profile } : EMPTY)
    setSubmitted(false)
  }

  const shown = target ?? opened
  const profile = shown?.profile ?? null
  const isNew = profile == null
  const preset = profile != null && profile.slot < state.presetCount
  const current = profile != null && state.mode === 'manual' && state.currentSlot === profile.slot
  const original: ApnDraft = profile ?? EMPTY
  const dirty = (Object.keys(EMPTY) as (keyof ApnDraft)[]).some((key) => draft[key] !== original[key])

  const fieldsOk = [draft.name, draft.apn, draft.username, draft.password].every(validApnText)
  const error = !draft.name.trim() || !draft.apn.trim() ? t.netSettings.apnRequired : !fieldsOk ? t.netSettings.apnInvalidChars : null
  const patch = (next: Partial<ApnDraft>) => setDraft((d) => ({ ...d, ...next }))

  const save = useMutation({
    mutationFn: async () => {
      const clean: ApnDraft = { ...draft, name: draft.name.trim(), apn: draft.apn.trim(), username: draft.auth === 'none' ? '' : draft.username, password: draft.auth === 'none' ? '' : draft.password }
      await apnApi.save(clean, shown!.slot)
      return { ...clean, slot: shown!.slot }
    },
    onSuccess: async (saved) => {
      await onChanged()
      onClose()
      // 保存只写配置，不会切换正在使用的 APN（改的就是当前这条时也要重新应用一次）
      toast.success(t.netSettings.apnSaved, { duration: 8_000, action: { label: t.netSettings.apnUseNow, onClick: () => onUse(saved) } })
    },
    onError: (err) => toast.error(t.common.operationFailed, { description: errorMessage(err) }),
  })

  const remove = () =>
    profile &&
    void confirm({
      tone: 'danger',
      title: t.netSettings.apnDeleteTitle(profile.name),
      description: t.netSettings.apnDeleteBody,
      confirmText: t.common.delete,
      onConfirm: async () => {
        await apnApi.remove(profile.slot)
        await onChanged()
        onClose()
        toast.success(t.netSettings.apnDeleted)
      },
    })

  const submit = () => {
    setSubmitted(true)
    if (!error) save.mutate()
  }

  const readOnly = preset
  const primary =
    !readOnly && (isNew || dirty) ? (
      <Button variant="primary" loading={save.isPending} onClick={submit}>
        {t.common.save}
      </Button>
    ) : profile && !current ? (
      <Button variant="primary" onClick={() => onUse(profile)}>
        {t.netSettings.apnUseNow}
      </Button>
    ) : (
      <Button variant="primary" onClick={onClose}>
        {t.common.done}
      </Button>
    )

  return (
    <Sheet open={target != null} onOpenChange={(open) => !open && !save.isPending && onClose()}>
      <SheetContent
        title={isNew ? t.netSettings.apnAddTitle : readOnly ? t.netSettings.apnViewTitle : t.netSettings.apnEditTitle}
        description={profile && current ? t.netSettings.apnCurrentTag : undefined}
        footer={
          <>
            {profile && !readOnly && !current && (
              <Button variant="danger-soft" className="mr-auto max-sm:flex-none" disabled={save.isPending} onClick={remove}>
                {t.common.delete}
              </Button>
            )}
            <Button variant="secondary" disabled={save.isPending} onClick={onClose}>
              {t.common.cancel}
            </Button>
            {primary}
          </>
        }
      >
        <div className="flex flex-col gap-5">
          {readOnly && <Callout>{t.netSettings.apnPresetHint}</Callout>}
          <Field label={t.netSettings.apnName}>
            {(id) => (
              <Input
                id={id}
                value={draft.name}
                onValueChange={(name) => patch({ name })}
                placeholder={t.netSettings.apnNamePlaceholder}
                maxLength={32}
                disabled={readOnly}
                invalid={submitted && (!draft.name.trim() || !validApnText(draft.name))}
              />
            )}
          </Field>
          <Field label={t.netSettings.apnApn}>
            {(id) => (
              <Input
                id={id}
                mono
                value={draft.apn}
                onValueChange={(apn) => patch({ apn: apn.replace(/\s/g, '') })}
                placeholder="cmnet"
                maxLength={64}
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                disabled={readOnly}
                invalid={submitted && (!draft.apn.trim() || !validApnText(draft.apn))}
              />
            )}
          </Field>
          <Field label={t.netSettings.apnAuth}>
            {() => (
              <SegmentedControl
                fullWidth
                ariaLabel={t.netSettings.apnAuth}
                value={draft.auth}
                disabled={readOnly}
                onChange={(auth) => patch({ auth })}
                options={[
                  { value: 'none', label: t.netSettings.apnAuthNone },
                  { value: 'pap', label: 'PAP' },
                  { value: 'chap', label: 'CHAP' },
                ]}
              />
            )}
          </Field>
          <AnimatePresence initial={false}>
            {draft.auth !== 'none' && (
              <motion.div {...collapse} className="-mt-5 overflow-hidden">
                <div className="flex flex-col gap-5 pt-5">
                  <Field label={t.netSettings.apnUsername}>
                    {(id) => (
                      <Input
                        id={id}
                        value={draft.username}
                        onValueChange={(username) => patch({ username })}
                        autoCapitalize="off"
                        autoCorrect="off"
                        spellCheck={false}
                        autoComplete="off"
                        disabled={readOnly}
                      />
                    )}
                  </Field>
                  <Field label={t.netSettings.apnPassword}>
                    {(id) => <PasswordInput id={id} value={draft.password} onValueChange={(password) => patch({ password })} autoComplete="new-password" disabled={readOnly} />}
                  </Field>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
          <Field label={t.netSettings.apnPdp}>
            {() => (
              <SegmentedControl
                fullWidth
                ariaLabel={t.netSettings.apnPdp}
                value={draft.pdp}
                disabled={readOnly}
                onChange={(pdp) => patch({ pdp })}
                options={(Object.keys(PDP_LABELS) as PdpType[]).map((value) => ({ value, label: PDP_LABELS[value] }))}
              />
            )}
          </Field>
          {submitted && error && (
            <p role="alert" className="text-footnote text-danger-text">
              {error}
            </p>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}
