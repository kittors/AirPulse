import { ArrowsClockwise, CaretRight, Eye, EyeSlash, LockKey, Warning } from '@phosphor-icons/react'
import { useQuery } from '@tanstack/react-query'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useId, useState, type FormEvent } from 'react'

import { signOutReasonStore, type LoginMethod } from '@/api/auth'
import { deviceApi } from '@/api/device'
import { DeviceLoginError } from '@/api/goform'
import { Logo } from '@/components/brand/logo'
import { Button } from '@/components/ui/button'
import { Callout } from '@/components/ui/feedback'
import { SegmentedControl } from '@/components/ui/segmented'
import { Switch } from '@/components/ui/switch'
import { toast } from '@/components/ui/toast'
import { useT } from '@/i18n'
import { cn } from '@/lib/cn'
import { errorMessage, isApiError } from '@/lib/errors'
import { collapse, spring } from '@/lib/motion'
import { storage } from '@/lib/storage'
import { useStore } from '@/lib/store'

import { PreferencesMenu } from '../shell/preferences'
import { attemptsLeft, signIn } from './session'

type Errors = { token?: string; password?: string; form?: string }

/**
 * 登录：纯色背景上居中的应用图标 + 一组合并的输入框（iOS 设置式：标签在左、输入在右），
 * 说明统一放在分组下方一句话里，不在每个框下面挂提示。设备探测结果就在标题下面一行。
 */
export function LoginPage() {
  const t = useT()
  const reason = useStore(signOutReasonStore)
  const [token, setToken] = useState('')
  const [password, setPassword] = useState('')
  const [loginMethod, setLoginMethod] = useState<LoginMethod>(() => storage.get<LoginMethod>('login-method', 'standard'))
  const [remember, setRemember] = useState(true)
  const [advanced, setAdvanced] = useState(() => storage.get<LoginMethod>('login-method', 'standard') === 'multi')
  const [busy, setBusy] = useState(false)
  const [errors, setErrors] = useState<Errors>({})
  const [lockedUntil, setLockedUntil] = useState(0)
  const [now, setNow] = useState(() => Date.now())

  const version = useQuery({ queryKey: ['login', 'version'], queryFn: deviceApi.versionInfo, retry: 1, staleTime: 30_000 })
  const needTokenQuery = useQuery({ queryKey: ['login', 'need-token'], queryFn: deviceApi.needToken, retry: 1 })
  const needToken = needTokenQuery.data?.need_token !== false

  useEffect(() => {
    if (lockedUntil <= now) return
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [lockedUntil, now])
  const lockSeconds = Math.max(0, Math.ceil((lockedUntil - now) / 1000))

  const lockFor = (seconds: string | null) => {
    setLockedUntil(Date.now() + Number(seconds ?? 60) * 1000)
    setNow(Date.now())
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const next: Errors = {}
    if (needToken && !token.trim()) next.token = t.auth.tokenRequired
    if (!password.trim()) next.password = t.auth.passwordRequired
    setErrors(next)
    if (next.token || next.password || lockSeconds > 0) return

    setBusy(true)
    storage.set('login-method', loginMethod)
    try {
      await signIn({ token, password, loginMethod, remember, needToken })
      toast.success(t.auth.welcome)
    } catch (error) {
      if (isApiError(error, 'unauthorized')) {
        setErrors({ token: t.auth.tokenWrong })
      } else if (error instanceof DeviceLoginError && error.reason === 'locked') {
        lockFor(error.lockSeconds)
      } else if (error instanceof DeviceLoginError && error.reason === 'wrong-password') {
        try {
          const left = await attemptsLeft()
          setErrors({ password: left ? t.auth.passwordWrongLeft(left) : t.auth.passwordWrong })
        } catch (lockError) {
          if (lockError instanceof DeviceLoginError) lockFor(lockError.lockSeconds)
        }
      } else if (isApiError(error, 'network') || isApiError(error, 'timeout')) {
        setErrors({ form: t.auth.connectFailed })
      } else {
        setErrors({ form: errorMessage(error) })
      }
    } finally {
      setBusy(false)
    }
  }

  const notice =
    lockSeconds > 0
      ? { tone: 'danger' as const, icon: <LockKey weight="fill" />, text: t.auth.locked(String(lockSeconds)) }
      : errors.form
        ? { tone: 'danger' as const, icon: <Warning weight="fill" />, text: errors.form }
        : reason === 'expired' || reason === 'device-session'
          ? { tone: 'warning' as const, icon: <Warning weight="fill" />, text: reason === 'expired' ? t.auth.sessionExpired : t.auth.deviceSessionLost }
          : null
  const fieldError = errors.token ?? errors.password

  return (
    <div className="flex min-h-dvh flex-col items-center px-5 pt-[min(14vh,120px)] pb-10 max-sm:pt-16">
      <div className="ap-page flex w-full max-w-[380px] flex-col">
        <div className="flex flex-col items-center text-center">
          <Logo size={64} />
          <h1 className="mt-5 text-[26px] leading-8 font-bold tracking-[-0.02em] text-text">{t.auth.title}</h1>
          <DeviceProbe
            loading={version.isPending}
            model={version.data?.model}
            version={version.data?.app_ver}
            failed={version.isError}
            onRetry={() => {
              void version.refetch()
              void needTokenQuery.refetch()
            }}
          />
        </div>

        <AnimatePresence initial={false}>
          {notice && (
            <motion.div {...collapse} className="overflow-hidden">
              <Callout tone={notice.tone} icon={notice.icon} className="mt-6">
                {notice.text}
              </Callout>
            </motion.div>
          )}
        </AnimatePresence>

        <form className="mt-7 flex flex-col" onSubmit={submit} noValidate>
          <div className="overflow-hidden rounded-card bg-surface shadow-card">
            {needToken && (
              <CredentialRow
                label={t.auth.token}
                value={token}
                invalid={Boolean(errors.token)}
                autoComplete="current-password"
                placeholder={t.auth.tokenPlaceholder}
                autoFocus
                onChange={(v) => {
                  setToken(v)
                  if (errors.token) setErrors((e) => ({ ...e, token: undefined }))
                }}
              />
            )}
            <CredentialRow
              label={t.auth.adminShort}
              value={password}
              invalid={Boolean(errors.password)}
              autoComplete="off"
              placeholder={t.auth.adminPasswordPlaceholder}
              autoFocus={!needToken}
              onChange={(v) => {
                setPassword(v)
                if (errors.password) setErrors((e) => ({ ...e, password: undefined }))
              }}
            />
          </div>
          <p className={cn('mt-2 px-4 text-footnote', fieldError ? 'font-medium text-danger-text' : 'text-text-3')} role={fieldError ? 'alert' : undefined}>
            {fieldError ?? t.auth.credentialsHint}
          </p>

          <div className="mt-5 overflow-hidden rounded-card bg-surface shadow-card">
            <label className="flex min-h-[52px] cursor-pointer items-center justify-between gap-4 px-4 py-2.5">
              <span className="min-w-0">
                <span className="block text-body text-text">{t.auth.remember}</span>
                <span className="block text-footnote text-text-3">{t.auth.rememberHint}</span>
              </span>
              <Switch checked={remember} onCheckedChange={setRemember} aria-label={t.auth.remember} />
            </label>
          </div>

          <div className="mt-3 flex flex-col">
            <button
              type="button"
              aria-expanded={advanced}
              onClick={() => setAdvanced((v) => !v)}
              className="flex h-9 w-fit items-center gap-1 rounded-full px-2 text-footnote font-medium text-text-2 transition-colors hover:text-text"
            >
              <motion.span animate={{ rotate: advanced ? 90 : 0 }} transition={spring.snappy} className="grid place-items-center">
                <CaretRight className="size-3 text-text-3" weight="bold" />
              </motion.span>
              {t.auth.advanced}
            </button>
            <AnimatePresence initial={false}>
              {advanced && (
                <motion.div {...collapse} className="overflow-hidden">
                  <div className="flex flex-col gap-2 px-2 pt-1 pb-2">
                    <span className="text-footnote font-medium text-text-2">{t.auth.loginMethod}</span>
                    <SegmentedControl<LoginMethod>
                      ariaLabel={t.auth.loginMethod}
                      value={loginMethod}
                      onChange={setLoginMethod}
                      fullWidth
                      options={[
                        { value: 'standard', label: t.auth.loginMethodStandard },
                        { value: 'multi', label: t.auth.loginMethodMulti },
                      ]}
                    />
                    <p className="text-footnote text-text-3">{t.auth.loginMethodHint}</p>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <Button type="submit" variant="primary" size="lg" loading={busy} disabled={lockSeconds > 0} className="mt-4 w-full">
            {busy ? t.auth.submitting : t.auth.submit}
          </Button>
        </form>

        <div className="mt-8 flex items-center justify-center gap-1 text-footnote text-text-3">
          <span>{t.auth.footer}</span>
          <span className="text-text-4">·</span>
          <PreferencesMenu className="-ml-1" />
        </div>
      </div>
    </div>
  )
}

/** 分组里的一行输入：标签在左、密码框在右，右端一个显隐按钮；行间发丝线从文字处开始 */
function CredentialRow({
  label,
  value,
  invalid,
  placeholder,
  autoComplete,
  autoFocus,
  onChange,
}: {
  label: string
  value: string
  invalid: boolean
  placeholder: string
  autoComplete: string
  autoFocus?: boolean
  onChange: (value: string) => void
}) {
  const t = useT()
  const id = useId()
  const [visible, setVisible] = useState(false)
  return (
    <div className="group/row relative flex min-h-[52px] items-center gap-3 pl-4 transition-colors duration-150 focus-within:bg-[color-mix(in_oklab,var(--color-accent)_5%,transparent)]">
      <label htmlFor={id} className={cn('w-[84px] shrink-0 text-body', invalid ? 'text-danger-text' : 'text-text')}>
        {label}
      </label>
      <input
        id={id}
        type={visible ? 'text' : 'password'}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        autoComplete={autoComplete}
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        autoFocus={autoFocus}
        aria-invalid={invalid || undefined}
        className="h-[52px] min-w-0 flex-1 bg-transparent text-body text-text outline-none placeholder:text-text-4"
      />
      <button
        type="button"
        tabIndex={-1}
        aria-label={visible ? t.common.hide : t.common.show}
        aria-pressed={visible}
        onClick={() => setVisible((v) => !v)}
        className="mr-2 grid size-8 shrink-0 place-items-center rounded-full text-text-3 transition-colors hover:bg-hover hover:text-text"
      >
        {visible ? <EyeSlash className="size-[18px]" /> : <Eye className="size-[18px]" />}
      </button>
      <span aria-hidden className="absolute right-0 bottom-0 left-4 h-px bg-line group-last/row:hidden" />
    </div>
  )
}

function DeviceProbe({
  loading,
  failed,
  model,
  version,
  onRetry,
}: {
  loading: boolean
  failed: boolean
  model?: string
  version?: string
  onRetry: () => void
}) {
  const t = useT()
  if (loading) {
    return (
      <p className="mt-2 flex items-center gap-2 text-subhead text-text-3">
        <span className="ap-live-dot size-1.5 bg-text-4" data-breathing="true" />
        {t.auth.searching}
      </p>
    )
  }
  if (failed || !model) {
    return (
      <p className="mt-2 flex flex-wrap items-center justify-center gap-x-2 text-subhead text-danger-text">
        {t.auth.deviceNotFound}
        <button type="button" onClick={onRetry} className="flex items-center gap-1 font-medium text-accent-text hover:underline">
          <ArrowsClockwise className="size-3.5" weight="bold" />
          {t.common.retry}
        </button>
      </p>
    )
  }
  return (
    <p className="mt-2 flex items-center gap-2 text-subhead text-text-2">
      <span className="ap-live-dot size-1.5 bg-success" data-breathing="true" />
      {t.auth.deviceFound(model, version ?? '—')}
    </p>
  )
}
