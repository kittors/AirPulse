import { Key } from '@phosphor-icons/react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'

import { credentialsStore, persistCredentials } from '@/api/auth'
import { api, suspendUnauthorizedRedirect } from '@/api/client'
import { sha256Hex } from '@/api/crypto'
import { Logo } from '@/components/brand/logo'
import { Button } from '@/components/ui/button'
import { ListGroup, ListRow } from '@/components/ui/card'
import { Dialog, DialogContent, useConfirm } from '@/components/ui/dialog'
import { Field, PasswordInput } from '@/components/ui/input'
import { toast } from '@/components/ui/toast'
import { useT } from '@/i18n'
import { errorMessage } from '@/lib/errors'
import { useStore } from '@/lib/store'
import { versionInfoQuery } from '@/hooks/queries'

import { signOutManually } from '../auth/session'
import { AccentPicker, LanguageSelect, ThemeModeControl } from '../shell/preferences'

/** 与后端 /api/set_token 的校验规则一致 */
const TOKEN_RULE = /^(?=.*[a-zA-Z])(?=.*\d).{8,128}$/

/** 通用：外观、账户、关于（iOS 式分组列表） */
export function GeneralSection() {
  const t = useT()
  const confirm = useConfirm()
  const credentials = useStore(credentialsStore)
  const version = useQuery(versionInfoQuery)
  const [tokenOpen, setTokenOpen] = useState(false)

  return (
    <>
      <div className="@container">
        <div className="grid grid-cols-1 gap-x-6 gap-y-7 @4xl:grid-cols-2 @4xl:items-start">
          <div className="flex flex-col gap-7">
            <ListGroup title={t.theme.title} footer={t.settings.appearanceHint}>
              <ListRow title={t.theme.mode} trailing={<ThemeModeControl compact="responsive" />} />
              <ListRow title={t.theme.accent} trailing={<AccentPicker />} />
              <ListRow title={t.theme.language} trailing={<LanguageSelect className="w-36" />} />
            </ListGroup>

            <ListGroup title={t.settings.account} footer={credentials?.remember ? t.settings.remembered : t.settings.sessionOnly}>
              <ListRow
                title={t.settings.signedIn}
                trailing={
                  <span className="flex items-center gap-1.5 text-subhead text-success-text">
                    <span className="size-1.5 rounded-full bg-success" aria-hidden />
                    {version.data?.model ?? 'AirPulse'}
                  </span>
                }
              />
              {credentials?.tokenHash !== null && (
                <ListRow
                  title={t.settings.token}
                  subtitle={t.settings.tokenDescription}
                  trailing={
                    <Button variant="secondary" size="sm" icon={<Key weight="bold" />} onClick={() => setTokenOpen(true)}>
                      {t.settings.change}
                    </Button>
                  }
                />
              )}
              <ListRow
                title={<span className="text-danger-text">{t.shell.logout}</span>}
                onClick={() =>
                  void confirm({ tone: 'danger', title: t.shell.logout, description: t.shell.logoutConfirm, confirmText: t.shell.logout }).then(
                    (ok) => ok && signOutManually(),
                  )
                }
              />
            </ListGroup>
          </div>

          <ListGroup title={t.settings.about} footer={t.settings.aboutBody}>
            <ListRow
              leading={<Logo size={36} />}
              title={<span className="font-semibold">AirPulse</span>}
              subtitle={t.brand.cn}
              className="[&>span:last-child]:min-h-[64px]"
            />
            <ListRow title={t.settings.model} trailing={<span className="num">{version.data?.model ?? '—'}</span>} />
            <ListRow
              title={t.settings.serviceVersion}
              trailing={
                <span className="num">
                  {version.data ? `${version.data.app_ver}` : '—'}
                  {version.data?.app_ver_code && <span className="ml-1.5 text-text-3">({version.data.app_ver_code})</span>}
                </span>
              }
            />
          </ListGroup>
        </div>
      </div>

      <ChangeTokenDialog open={tokenOpen} onOpenChange={setTokenOpen} />
    </>
  )
}

function ChangeTokenDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const t = useT()
  const queryClient = useQueryClient()
  const [token, setToken] = useState('')
  const [repeat, setRepeat] = useState('')
  const [errors, setErrors] = useState<{ token?: string; repeat?: string; form?: string }>({})
  const [busy, setBusy] = useState(false)

  const reset = () => {
    setToken('')
    setRepeat('')
    setErrors({})
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const next: typeof errors = {}
    if (!TOKEN_RULE.test(token)) next.token = t.settings.tokenInvalid
    else if (token !== repeat) next.repeat = t.settings.tokenMismatch
    setErrors(next)
    if (next.token || next.repeat) return
    setBusy(true)
    try {
      suspendUnauthorizedRedirect(8_000)
      await queryClient.cancelQueries()
      await api('/set_token', { method: 'POST', json: { token } })
      const current = credentialsStore.get()
      if (current) persistCredentials({ ...current, tokenHash: sha256Hex(token) })
      await queryClient.invalidateQueries({ queryKey: ['weak-token'] })
      toast.success(t.settings.tokenChanged)
      onOpenChange(false)
      reset()
    } catch (error) {
      setErrors({ form: errorMessage(error) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset()
        onOpenChange(next)
      }}
    >
      <DialogContent
        title={t.settings.changeToken}
        description={t.settings.tokenRules}
        busy={busy}
        size="sm"
        footer={
          <>
            <Button variant="secondary" disabled={busy} onClick={() => onOpenChange(false)}>
              {t.common.cancel}
            </Button>
            <Button variant="primary" loading={busy} type="submit" form="ap-change-token">
              {t.common.save}
            </Button>
          </>
        }
      >
        <form id="ap-change-token" className="flex flex-col gap-4" onSubmit={submit} noValidate>
          <Field label={t.settings.newToken} error={errors.token}>
            {(id) => (
              <PasswordInput id={id} value={token} onValueChange={setToken} invalid={Boolean(errors.token)} autoComplete="new-password" autoFocus />
            )}
          </Field>
          <Field label={t.settings.confirmToken} error={errors.repeat ?? errors.form}>
            {(id) => (
              <PasswordInput
                id={id}
                value={repeat}
                onValueChange={setRepeat}
                invalid={Boolean(errors.repeat ?? errors.form)}
                autoComplete="new-password"
              />
            )}
          </Field>
        </form>
      </DialogContent>
    </Dialog>
  )
}
