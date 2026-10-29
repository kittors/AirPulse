import { ArrowsLeftRight, CaretDown, Copy, Info } from '@phosphor-icons/react'
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useRef, useState, type ReactNode } from 'react'

import {
  DEVICE_PLACEHOLDERS,
  detectPreset,
  forwardApi,
  forwardKeys,
  missingPlaceholders,
  normalizeCurl,
  presetById,
  smartFill,
  SMS_PLACEHOLDERS,
  SSL_PORTS,
  validEmail,
  validParam,
  type MailConfig,
  type PresetField,
  type PresetId,
} from '@/api/forward'
import { Button } from '@/components/ui/button'
import { Callout, Skeleton } from '@/components/ui/feedback'
import { Field, Input, IntegerInput, PasswordInput, Textarea } from '@/components/ui/input'
import { SegmentedControl } from '@/components/ui/segmented'
import { SheetContent, Sheet } from '@/components/ui/sheet'
import { Switch } from '@/components/ui/switch'
import { toast } from '@/components/ui/toast'
import { useT, type Messages } from '@/i18n'
import { copyText } from '@/lib/clipboard'
import { cn } from '@/lib/cn'
import { errorMessage } from '@/lib/errors'
import { collapse } from '@/lib/motion'

import { CHANNEL_ICONS, channelName, isCurlChannel, useActiveChannel, type ChannelId } from './forwardChannels'

interface FormProps {
  onClose: () => void
  onBusy: (busy: boolean) => void
}

/**
 * 渠道配置抽屉。每次打开都重新挂载表单（key 带打开次数），关闭动画期间保留上一次的内容。
 * 保存中不允许关闭，避免用户以为没保存上。
 */
export function ChannelSheet({ channel, onClose }: { channel: ChannelId | null; onClose: () => void }) {
  const [state, setState] = useState({ last: channel, shown: channel, session: 0 })
  if (channel !== state.last) {
    setState({ last: channel, shown: channel ?? state.shown, session: channel ? state.session + 1 : state.session })
  }
  const busy = useRef(false)
  const close = () => {
    if (!busy.current) onClose()
  }
  const id = channel ?? state.shown
  const props: FormProps = { onClose: close, onBusy: (next) => (busy.current = next) }
  return (
    <Sheet open={channel != null} onOpenChange={(open) => !open && close()}>
      {id &&
        (id === 'email' ? (
          <EmailForm key={`email-${state.session}`} {...props} />
        ) : id === 'dingtalk' ? (
          <DingtalkForm key={`dingtalk-${state.session}`} {...props} />
        ) : id === 'custom' ? (
          <CustomForm key={`custom-${state.session}`} {...props} />
        ) : (
          <PresetForm key={`${id}-${state.session}`} id={id} {...props} />
        ))}
    </Sheet>
  )
}

/* —— 共用 —— */

function enableForwarding(queryClient: QueryClient, t: Messages) {
  void forwardApi
    .setEnabled(true)
    .then(() => {
      queryClient.setQueryData(forwardKeys.enabled, true)
      toast.success(t.forward.enabledToast)
    })
    .catch((error: unknown) => toast.error(t.common.operationFailed, { description: errorMessage(error) }))
}

/** 保存即切换生效渠道，后端随即推送一条测试消息（异步入队，所以说「已推送」而不是「已送达」） */
function useSave(id: ChannelId, { onClose, onBusy }: FormProps) {
  const t = useT()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (run: () => Promise<unknown>) => run(),
    onMutate: () => onBusy(true),
    onSettled: () => onBusy(false),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: forwardKeys.all })
      const name = channelName(t, id)
      if (queryClient.getQueryData<boolean>(forwardKeys.enabled) === false) {
        toast.success(t.forward.saved, {
          description: t.forward.savedOffBody(name),
          duration: 8_000,
          action: { label: t.forward.enableNow, onClick: () => enableForwarding(queryClient, t) },
        })
      } else {
        toast.success(t.forward.saved, { description: t.forward.savedBody(name) })
      }
      // onSettled 在 onSuccess 之后才执行：先解除「保存中」，否则抽屉会被当成忙而关不掉
      onBusy(false)
      onClose()
    },
    onError: (error) => toast.error(t.forward.saveFailed, { description: errorMessage(error) }),
  })
}

function FormSheet({
  id,
  ready,
  saving,
  onSave,
  onClose,
  children,
}: {
  id: ChannelId
  ready: boolean
  saving: boolean
  onSave: () => void
  onClose: () => void
  children: ReactNode
}) {
  const t = useT()
  const Icon = CHANNEL_ICONS[id]
  return (
    <SheetContent
      title={
        <span className="flex items-center gap-2">
          <Icon className="size-5 text-text-2" />
          {channelName(t, id)}
        </span>
      }
      description={t.forward.channels[id].tagline}
      footer={
        <>
          <Button variant="secondary" disabled={saving} onClick={onClose}>
            {t.common.cancel}
          </Button>
          <Button variant="primary" loading={saving} disabled={!ready} onClick={onSave}>
            {t.forward.saveAndTest}
          </Button>
        </>
      }
    >
      {ready ? (
        <div className="flex flex-col gap-5">
          {children}
          <SwitchNotice id={id} />
        </div>
      ) : (
        <div className="flex flex-col gap-5">
          <Skeleton className="h-16 rounded-inner" />
          <Skeleton className="h-16 rounded-inner" />
          <Skeleton className="h-16 rounded-inner" />
        </div>
      )}
    </SheetContent>
  )
}

/** 保存会切换生效渠道：说清楚当前在用的那个会怎样（保留还是被替换） */
function SwitchNotice({ id }: { id: ChannelId }) {
  const t = useT()
  const { active } = useActiveChannel()
  if (!active || active === id) return null
  const next = channelName(t, id)
  const current = channelName(t, active)
  return (
    <p className="flex gap-2 text-footnote text-text-3">
      <ArrowsLeftRight className="mt-px size-4 shrink-0" />
      <span>{isCurlChannel(id) && isCurlChannel(active) ? t.forward.switchReplace(next, current) : t.forward.switchKeep(next, current)}</span>
    </p>
  )
}

function DeviceInfoSwitch({ checked, onChange }: { checked: boolean; onChange: (checked: boolean) => void }) {
  const t = useT()
  return (
    <div className="flex items-center gap-3 rounded-inner bg-sunken py-3 pr-3.5 pl-4">
      <div className="min-w-0 flex-1">
        <p className="text-body text-text">{t.forward.deviceInfo}</p>
        <p className="text-footnote text-text-3">{t.forward.deviceInfoHint}</p>
      </div>
      <Switch checked={checked} onCheckedChange={onChange} aria-label={t.forward.deviceInfo} />
    </div>
  )
}

const optionalLabel = (label: string, t: Messages) => (
  <>
    {label}
    <span className="ml-1.5 font-normal text-text-3">{t.forward.optional}</span>
  </>
)

/* —— 邮件 —— */

const PROVIDERS = [
  { id: 'qq', host: 'smtp.qq.com', port: '465' },
  { id: 'netease', host: 'smtp.163.com', port: '465' },
  { id: 'gmail', host: 'smtp.gmail.com', port: '465' },
] as const
type ProviderId = (typeof PROVIDERS)[number]['id'] | 'other'

function EmailForm(props: FormProps) {
  const t = useT()
  const mail = useQuery({ queryKey: forwardKeys.mail, queryFn: forwardApi.mail })
  const [form, setForm] = useState<MailConfig | null>(null)
  const [submitted, setSubmitted] = useState(false)
  const save = useSave('email', props)

  useEffect(() => {
    if (form == null && (mail.data || mail.isError)) {
      setForm(
        mail.data ?? { smtp_host: '', smtp_port: '465', smtp_username: '', smtp_password: '', smtp_from: '', smtp_from_name: '', smtp_to: '', forward_dev_info: '0' },
      )
    }
  }, [form, mail.data, mail.isError])

  const f = form
  const patch = (next: Partial<MailConfig>) => setForm((current) => (current ? { ...current, ...next } : current))
  const provider: ProviderId = PROVIDERS.find((p) => p.host === f?.smtp_host.trim().toLowerCase())?.id ?? 'other'
  const port = Number(f?.smtp_port)
  const to = (f?.smtp_to.trim() || f?.smtp_username.trim()) ?? ''
  const errors = f && {
    host: !f.smtp_host.trim() ? t.forward.email.hostRequired : null,
    port: !Number.isInteger(port) || port < 1 || port > 65535 ? t.forward.email.portInvalid : null,
    username: !f.smtp_username.trim() ? t.forward.email.usernameRequired : null,
    password: !f.smtp_password ? t.forward.email.passwordRequired : null,
    to: !validEmail(to) ? t.forward.email.emailInvalid : null,
    from: f.smtp_from.trim() && !validEmail(f.smtp_from) ? t.forward.email.emailInvalid : null,
  }
  const show = (key: keyof NonNullable<typeof errors>) => (submitted && errors ? errors[key] : null)

  const submit = () => {
    setSubmitted(true)
    if (!f || !errors || Object.values(errors).some(Boolean)) return
    save.mutate(() =>
      forwardApi.saveMail({
        ...f,
        smtp_host: f.smtp_host.trim(),
        smtp_port: String(port),
        smtp_username: f.smtp_username.trim(),
        smtp_to: to,
        smtp_from: f.smtp_from.trim(),
        smtp_from_name: f.smtp_from_name.trim(),
      }),
    )
  }

  return (
    <FormSheet id="email" ready={f != null} saving={save.isPending} onSave={submit} onClose={props.onClose}>
      {f && (
        <>
          <SegmentedControl
            fullWidth
            ariaLabel={t.forward.email.provider}
            value={provider}
            onChange={(next) => {
              const preset = PROVIDERS.find((p) => p.id === next)
              if (preset) patch({ smtp_host: preset.host, smtp_port: preset.port })
              else if (provider !== 'other') patch({ smtp_host: '' })
            }}
            options={[
              { value: 'qq', label: t.forward.email.qq },
              { value: 'netease', label: t.forward.email.netease },
              { value: 'gmail', label: t.forward.email.gmail },
              { value: 'other', label: t.forward.email.other },
            ]}
          />
          <div className="grid grid-cols-[minmax(0,1fr)_96px] items-start gap-3">
            <Field label={t.forward.email.host} error={show('host')}>
              {(id) => (
                <Input
                  id={id}
                  value={f.smtp_host}
                  onValueChange={(smtp_host) => patch({ smtp_host })}
                  placeholder="smtp.example.com"
                  autoCapitalize="off"
                  autoCorrect="off"
                  spellCheck={false}
                  invalid={Boolean(show('host'))}
                />
              )}
            </Field>
            <Field label={t.forward.email.port} hint={SSL_PORTS.includes(f.smtp_port.trim()) ? t.forward.email.ssl : t.forward.email.starttls} error={show('port')}>
              {(id) => (
                <IntegerInput id={id} value={f.smtp_port} onValueChange={(smtp_port) => patch({ smtp_port })} maxLength={5} placeholder="465" invalid={Boolean(show('port'))} />
              )}
            </Field>
          </div>
          <Field label={t.forward.email.username} error={show('username')}>
            {(id) => (
              <Input
                id={id}
                value={f.smtp_username}
                onValueChange={(smtp_username) => patch({ smtp_username })}
                type="email"
                inputMode="email"
                autoComplete="off"
                placeholder="name@example.com"
                invalid={Boolean(show('username'))}
              />
            )}
          </Field>
          <Field label={t.forward.email.password} hint={t.forward.email.passwordHint} error={show('password')}>
            {(id) => (
              <PasswordInput
                id={id}
                value={f.smtp_password}
                onValueChange={(smtp_password) => patch({ smtp_password })}
                autoComplete="new-password"
                invalid={Boolean(show('password'))}
              />
            )}
          </Field>
          <Field label={t.forward.email.to} hint={t.forward.email.toHint} error={show('to')}>
            {(id) => (
              <Input
                id={id}
                value={f.smtp_to}
                onValueChange={(smtp_to) => patch({ smtp_to })}
                type="email"
                inputMode="email"
                autoComplete="off"
                placeholder={f.smtp_username.trim() || 'name@example.com'}
                invalid={Boolean(show('to'))}
              />
            )}
          </Field>
          <div className="grid grid-cols-2 items-start gap-3 max-sm:grid-cols-1">
            <Field label={optionalLabel(t.forward.email.fromName, t)}>
              {(id) => <Input id={id} value={f.smtp_from_name} onValueChange={(smtp_from_name) => patch({ smtp_from_name })} placeholder="AirPulse" maxLength={60} />}
            </Field>
            <Field label={optionalLabel(t.forward.email.from, t)} error={show('from')}>
              {(id) => (
                <Input
                  id={id}
                  value={f.smtp_from}
                  onValueChange={(smtp_from) => patch({ smtp_from })}
                  type="email"
                  inputMode="email"
                  autoComplete="off"
                  placeholder={t.forward.email.fromPlaceholder}
                  invalid={Boolean(show('from'))}
                />
              )}
            </Field>
          </div>
          <DeviceInfoSwitch checked={f.forward_dev_info === '1'} onChange={(on) => patch({ forward_dev_info: on ? '1' : '0' })} />
        </>
      )}
    </FormSheet>
  )
}

/* —— 钉钉 —— */

/** 后端读回钉钉配置时用字符串模板拼 JSON，这两个字符会让它返回坏掉的 JSON */
const UNSAFE_CHARS = /["\\]/

function DingtalkForm(props: FormProps) {
  const t = useT()
  const config = useQuery({ queryKey: forwardKeys.dingtalk, queryFn: forwardApi.dingtalk })
  const [form, setForm] = useState<{ webhook: string; secret: string; deviceInfo: boolean } | null>(null)
  const [submitted, setSubmitted] = useState(false)
  const save = useSave('dingtalk', props)

  useEffect(() => {
    if (form == null && (config.data || config.isError)) {
      setForm({ webhook: config.data?.webhook_url ?? '', secret: config.data?.secret ?? '', deviceInfo: config.data?.forward_dev_info === '1' })
    }
  }, [form, config.data, config.isError])

  const webhook = form?.webhook.trim() ?? ''
  const secret = form?.secret.trim() ?? ''
  const webhookError = UNSAFE_CHARS.test(webhook)
    ? t.forward.dingtalk.charsInvalid
    : !/^https?:\/\/\S+$/i.test(webhook) || !/[?&]access_token=[^&\s]+/.test(webhook)
      ? t.forward.dingtalk.webhookInvalid
      : null
  const secretError = UNSAFE_CHARS.test(secret) ? t.forward.dingtalk.charsInvalid : null

  const submit = () => {
    setSubmitted(true)
    if (!form || webhookError || secretError) return
    save.mutate(() => forwardApi.saveDingtalk({ webhook_url: webhook, secret, forward_dev_info: form.deviceInfo ? '1' : '0' }))
  }

  return (
    <FormSheet id="dingtalk" ready={form != null} saving={save.isPending} onSave={submit} onClose={props.onClose}>
      {form && (
        <>
          <Field label={t.forward.dingtalk.webhook} hint={t.forward.dingtalk.webhookHint} error={submitted ? webhookError : null}>
            {(id) => (
              <Textarea
                id={id}
                value={form.webhook}
                onChange={(event) => setForm({ ...form, webhook: event.target.value.replace(/\s+/g, '') })}
                rows={3}
                spellCheck={false}
                autoCapitalize="off"
                autoCorrect="off"
                placeholder="https://oapi.dingtalk.com/robot/send?access_token=…"
                invalid={submitted && Boolean(webhookError)}
                className="min-h-0 font-mono text-[13px] leading-5 break-all"
              />
            )}
          </Field>
          <Field label={optionalLabel(t.forward.dingtalk.secret, t)} hint={t.forward.dingtalk.secretHint} error={secretError}>
            {(id) => <PasswordInput id={id} value={form.secret} onValueChange={(next) => setForm({ ...form, secret: next })} placeholder="SEC…" invalid={Boolean(secretError)} />}
          </Field>
          <DeviceInfoSwitch checked={form.deviceInfo} onChange={(deviceInfo) => setForm({ ...form, deviceInfo })} />
        </>
      )}
    </FormSheet>
  )
}

/* —— curl 预设 —— */

function PresetForm({ id, ...props }: FormProps & { id: PresetId }) {
  const t = useT()
  const preset = presetById(id)
  const { active, curl } = useActiveChannel()
  const [params, setParams] = useState<Record<string, string> | null>(null)
  const [submitted, setSubmitted] = useState(false)
  const [showCommand, setShowCommand] = useState(false)
  const save = useSave(id, props)

  // 正在用的就是这个预设时，把参数从已保存的命令里反解回来
  useEffect(() => {
    if (params != null || active === undefined) return
    const detected = active === id && curl ? detectPreset(curl) : null
    setParams(detected?.params ?? Object.fromEntries(preset.fields.map((field) => [field.key, field.default ?? ''])))
  }, [params, active, curl, id, preset])

  const labelOf = (field: PresetField) => t.forward.preset.fields[field.key] ?? field.key
  const errorOf = (field: PresetField) => {
    const value = params?.[field.key]?.trim() ?? ''
    if (!value) return t.forward.preset.required
    if (!validParam(field, value)) return field.kind === 'url' ? t.forward.preset.invalidUrl : t.forward.preset.invalidToken
    return null
  }
  const trimmed = Object.fromEntries(preset.fields.map((field) => [field.key, params?.[field.key]?.trim() ?? '']))
  const command = preset.build(Object.fromEntries(preset.fields.map((field) => [field.key, trimmed[field.key] || `<${labelOf(field)}>`])))
  const fill = (field: PresetField, raw: string) => setParams((current) => ({ ...current, ...smartFill(id, field.key, raw) }))

  const submit = () => {
    setSubmitted(true)
    if (!params || preset.fields.some((field) => errorOf(field))) return
    save.mutate(() => forwardApi.saveCurl(preset.build(trimmed)))
  }

  return (
    <FormSheet id={id} ready={params != null} saving={save.isPending} onSave={submit} onClose={props.onClose}>
      {params && (
        <>
          {t.forward.preset.help[id] && <p className="text-subhead text-text-2">{t.forward.preset.help[id]}</p>}
          {preset.fields.map((field) => {
            const error = submitted ? errorOf(field) : null
            return (
              <Field key={field.key} label={labelOf(field)} error={error}>
                {(inputId) => (
                  <Input
                    id={inputId}
                    mono
                    value={params[field.key] ?? ''}
                    onValueChange={(value) => setParams({ ...params, [field.key]: value })}
                    onPaste={(event) => {
                      const text = event.clipboardData.getData('text')
                      const filled = smartFill(id, field.key, text)
                      if (filled[field.key] !== text || Object.keys(filled).length > 1) {
                        event.preventDefault()
                        setParams({ ...params, ...filled })
                      }
                    }}
                    onBlur={(event) => fill(field, event.target.value)}
                    placeholder={field.placeholder}
                    autoCapitalize="off"
                    autoCorrect="off"
                    spellCheck={false}
                    autoComplete="off"
                    invalid={Boolean(error)}
                  />
                )}
              </Field>
            )
          })}

          <div>
            <button
              type="button"
              onClick={() => setShowCommand((v) => !v)}
              aria-expanded={showCommand}
              className="-ml-1 inline-flex h-8 items-center gap-1 rounded-[8px] px-1 text-subhead text-accent-text transition-colors hover:bg-hover"
            >
              {showCommand ? t.forward.preset.hideCommand : t.forward.preset.showCommand}
              <CaretDown className={cn('size-3.5 transition-transform duration-200', showCommand && 'rotate-180')} weight="bold" />
            </button>
            <AnimatePresence initial={false}>
              {showCommand && (
                <motion.div {...collapse} className="overflow-hidden">
                  <div className="relative mt-2 rounded-inner bg-sunken">
                    <pre className="max-h-48 overflow-auto px-3.5 py-3 pr-11 font-mono text-[12px] leading-5 break-all whitespace-pre-wrap text-text-2">{command}</pre>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={t.common.copy}
                      className="absolute top-1.5 right-1.5 text-text-3"
                      onClick={() => void copyText(command).then((ok) => (ok ? toast.success(t.common.copied) : toast.error(t.common.copyFailed)))}
                    >
                      <Copy />
                    </Button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <Callout icon={<Info weight="fill" />}>{t.forward.preset.quoteCaveat}</Callout>
        </>
      )}
    </FormSheet>
  )
}

/* —— 自定义 curl —— */

const CURL_EXAMPLE = `curl -s -X POST "https://example.com/hook" -H 'Content-Type: application/json' -d '{"from":"{{sms-from}}","text":"{{sms-body}}","time":"{{sms-time}}"}'`

function CustomForm(props: FormProps) {
  const t = useT()
  const curl = useQuery({ queryKey: forwardKeys.curl, queryFn: forwardApi.curl })
  const [text, setText] = useState<string | null>(null)
  const [submitted, setSubmitted] = useState(false)
  const area = useRef<HTMLTextAreaElement>(null)
  const save = useSave('custom', props)

  useEffect(() => {
    if (text == null && (curl.data != null || curl.isError)) setText(curl.data ?? '')
  }, [text, curl.data, curl.isError])

  const normalized = normalizeCurl(text ?? '')
  const missing = missingPlaceholders(normalized)
  const error = !/^curl\s/i.test(normalized) ? t.forward.custom.startCurl : missing.length ? t.forward.custom.missing(missing.join(' ')) : null

  const insert = (token: string) => {
    const el = area.current
    const value = text ?? ''
    const start = el?.selectionStart ?? value.length
    const end = el?.selectionEnd ?? value.length
    setText(value.slice(0, start) + token + value.slice(end))
    requestAnimationFrame(() => {
      el?.focus()
      el?.setSelectionRange(start + token.length, start + token.length)
    })
  }

  const submit = () => {
    setSubmitted(true)
    if (error) return
    setText(normalized)
    save.mutate(() => forwardApi.saveCurl(normalized))
  }

  return (
    <FormSheet id="custom" ready={text != null} saving={save.isPending} onSave={submit} onClose={props.onClose}>
      {text != null && (
        <>
          <Field label={t.forward.custom.command} error={submitted ? error : null}>
            {(id) => (
              <Textarea
                ref={area}
                id={id}
                value={text}
                onChange={(event) => setText(event.target.value)}
                rows={7}
                spellCheck={false}
                autoCapitalize="off"
                autoCorrect="off"
                placeholder={CURL_EXAMPLE}
                invalid={submitted && Boolean(error)}
                className="font-mono text-[12.5px] leading-5 break-all"
              />
            )}
          </Field>

          <div>
            <p className="text-footnote font-medium text-text-2">{t.forward.custom.placeholders}</p>
            <p className="mt-0.5 text-footnote text-text-3">{t.forward.custom.placeholdersHint}</p>
            <p className="mt-3 text-caption text-text-3">{t.forward.custom.sms}</p>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {SMS_PLACEHOLDERS.map((token) => (
                <TokenChip key={token} token={token} required used={text.includes(token)} onInsert={insert} />
              ))}
            </div>
            <p className="mt-3 text-caption text-text-3">{t.forward.custom.device}</p>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {DEVICE_PLACEHOLDERS.map((token) => (
                <TokenChip key={token} token={token} used={text.includes(token)} onInsert={insert} />
              ))}
            </div>
          </div>

          <Callout icon={<Info weight="fill" />}>{t.forward.custom.rules}</Callout>
        </>
      )}
    </FormSheet>
  )
}

function TokenChip({ token, required = false, used, onInsert }: { token: string; required?: boolean; used: boolean; onInsert: (token: string) => void }) {
  return (
    <button
      type="button"
      // 不抢走输入框的焦点和光标位置
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => onInsert(token)}
      className={cn(
        'ap-press inline-flex h-7 items-center gap-1.5 rounded-chip px-2.5 font-mono text-[12px] transition-colors max-sm:h-8',
        used ? 'bg-accent-soft text-accent-text' : 'bg-sunken text-text-2 hover:bg-hover',
      )}
    >
      {required && <span aria-hidden className={cn('size-1.5 rounded-full', used ? 'bg-success' : 'bg-warning')} />}
      {token}
    </button>
  )
}
