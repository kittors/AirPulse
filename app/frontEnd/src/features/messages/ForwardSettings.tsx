import { CaretRight, PaperPlaneRight, PaperPlaneTilt } from '@phosphor-icons/react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'

import { cleanLines, forwardApi, forwardKeys, validPhoneList } from '@/api/forward'
import { hrefOf } from '@/app/router'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ListGroup, ListRow, Panel, PanelHeader } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/feedback'
import { SaveActions, SwitchRow } from '@/components/ui/form-rows'
import { Field, Textarea } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { toast } from '@/components/ui/toast'
import { useT } from '@/i18n'
import { cn } from '@/lib/cn'
import { errorMessage } from '@/lib/errors'
import { versionInfoQuery } from '@/hooks/queries'

import { guardQuery } from '../settings/TrafficSection'

import { ChannelSheet } from './ChannelSheet'
import { CHANNEL_ICONS, channelName, MORE_CHANNELS, PRIMARY_CHANNELS, useActiveChannel, type ChannelId } from './forwardChannels'

/**
 * 短信转发：左边是总开关与渠道（像 iOS 的「邮件 → 账户」，点一行进去配置），
 * 右边是附带的通知和过滤规则。原版的问题在这里都避开了：
 * 生效渠道单独标「使用中」、总开关关着也能先配好、保存即发测试消息并如实说明「已发出」而非「已送达」。
 */
export function ForwardSettings() {
  const t = useT()
  const [sheet, setSheet] = useState<ChannelId | null>(null)
  return (
    <div className="@container">
      <div className="grid grid-cols-1 items-start gap-x-6 gap-y-7 @4xl:grid-cols-2">
        <div className="flex flex-col gap-7">
          <StatusPanel />
          <ChannelList ids={PRIMARY_CHANNELS} title={t.forward.common} onOpen={setSheet} />
          <ChannelList ids={MORE_CHANNELS} title={t.forward.more} footer={t.forward.channelsFooter} onOpen={setSheet} />
        </div>
        <div className="flex flex-col gap-7">
          <OtherNotifications />
          <FilterRules />
          <p className="px-4 text-footnote text-text-3 max-sm:px-3">{t.forward.howItWorks}</p>
        </div>
      </div>
      <ChannelSheet channel={sheet} onClose={() => setSheet(null)} />
    </div>
  )
}

function StatusPanel() {
  const t = useT()
  const queryClient = useQueryClient()
  const enabled = useQuery({ queryKey: forwardKeys.enabled, queryFn: forwardApi.enabled })
  const { active, loading } = useActiveChannel()

  const toggle = useMutation({
    mutationFn: forwardApi.setEnabled,
    onMutate: (next) => {
      const previous = queryClient.getQueryData<boolean>(forwardKeys.enabled)
      queryClient.setQueryData(forwardKeys.enabled, next)
      return { previous }
    },
    onSuccess: (_data, next) => toast.success(next ? t.forward.enabledToast : t.forward.disabledToast),
    onError: (error, _next, context) => {
      queryClient.setQueryData(forwardKeys.enabled, context?.previous)
      toast.error(t.common.operationFailed, { description: errorMessage(error) })
    },
  })

  const name = active ? channelName(t, active) : null
  const test = useMutation({
    mutationFn: () => forwardApi.test(t.forward.testBody),
    onSuccess: () => toast.success(t.forward.testSent, { description: t.forward.testSentBody(name ?? '') }),
    onError: (error) => toast.error(t.common.operationFailed, { description: errorMessage(error) }),
  })

  const on = enabled.data === true
  const ChannelIcon = active ? CHANNEL_ICONS[active] : null
  const status = enabled.isError
    ? errorMessage(enabled.error)
    : enabled.isPending || loading
      ? t.common.loading
      : !on
        ? t.forward.off
        : name
          ? t.forward.on(name)
          : t.forward.onNoChannel

  return (
    <Panel>
      <div className="flex items-start gap-3.5">
        <span
          className={cn(
            'grid size-10 shrink-0 place-items-center rounded-[12px] transition-colors duration-200',
            !on ? 'bg-sunken text-text-3' : active ? 'bg-success-soft text-success' : 'bg-warning-soft text-warning',
          )}
        >
          <PaperPlaneTilt className="size-[22px]" weight={on ? 'fill' : 'regular'} />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-headline text-text">{t.forward.title}</h2>
          <p className={cn('mt-0.5 text-footnote', enabled.isError ? 'text-danger-text' : on && active === null ? 'text-warning-text' : 'text-text-2')}>{status}</p>
        </div>
        <Switch
          className="mt-[7px]"
          checked={on}
          disabled={enabled.data == null}
          loading={toggle.isPending}
          onCheckedChange={(next) => toggle.mutate(next)}
          aria-label={t.forward.title}
        />
      </div>

      <div className="mt-4 flex items-center gap-3 border-t border-line pt-4">
        <div className="min-w-0 flex-1">
          <p className="text-caption text-text-3">{t.forward.channel}</p>
          {active === undefined ? (
            <Skeleton className="mt-0.5 h-5 w-24" />
          ) : (
            <p className={cn('mt-0.5 flex items-center gap-1.5 text-subhead font-medium', active ? 'text-text' : 'text-text-3')}>
              {ChannelIcon && <ChannelIcon className="size-4 text-text-2" />}
              <span className="truncate">{name ?? t.forward.noChannel}</span>
            </p>
          )}
        </div>
        <Button variant="soft" size="sm" icon={<PaperPlaneRight />} disabled={!active} loading={test.isPending} onClick={() => test.mutate()}>
          {t.forward.test}
        </Button>
      </div>
    </Panel>
  )
}

function ChannelList({ ids, title, footer, onOpen }: { ids: ChannelId[]; title: string; footer?: string; onOpen: (id: ChannelId) => void }) {
  const t = useT()
  const { active } = useActiveChannel()
  const mail = useQuery({ queryKey: forwardKeys.mail, queryFn: forwardApi.mail })
  const dingtalk = useQuery({ queryKey: forwardKeys.dingtalk, queryFn: forwardApi.dingtalk })

  const subtitleOf = (id: ChannelId) => {
    if (id === 'email' && mail.data?.smtp_host && mail.data.smtp_to) return t.forward.sentTo(mail.data.smtp_to)
    if (id === 'dingtalk' && dingtalk.data?.webhook_url) return t.forward.configured
    return t.forward.channels[id].tagline
  }

  return (
    <ListGroup title={title} footer={footer}>
      {ids.map((id) => {
        const Icon = CHANNEL_ICONS[id]
        return (
          <ListRow
            key={id}
            leading={<Icon className="size-[22px] text-text-3" />}
            title={channelName(t, id)}
            subtitle={subtitleOf(id)}
            trailing={
              <>
                {active === id && (
                  <Badge tone="success" size="sm" dot>
                    {t.forward.inUse}
                  </Badge>
                )}
                <CaretRight className="size-3.5 text-text-4" weight="bold" />
              </>
            }
            onClick={() => onOpen(id)}
          />
        )
      })}
    </ListGroup>
  )
}

function OtherNotifications() {
  const t = useT()
  const queryClient = useQueryClient()
  const power = useQuery({ queryKey: forwardKeys.power, queryFn: forwardApi.powerEnabled })
  const guard = useQuery(guardQuery)
  const version = useQuery(versionInfoQuery)

  const toggle = useMutation({
    mutationFn: forwardApi.setPowerEnabled,
    onMutate: (next) => {
      const previous = queryClient.getQueryData<boolean>(forwardKeys.power)
      queryClient.setQueryData(forwardKeys.power, next)
      return { previous }
    },
    onSuccess: (_data, next) => toast.success(next ? t.forward.powerOn : t.forward.powerOff),
    onError: (error, _next, context) => {
      queryClient.setQueryData(forwardKeys.power, context?.previous)
      toast.error(t.common.operationFailed, { description: errorMessage(error) })
    },
  })

  const caret = <CaretRight className="size-3.5 text-text-4" weight="bold" />
  return (
    <ListGroup title={t.forward.others} footer={t.forward.othersFooter}>
      <SwitchRow
        title={t.forward.power}
        subtitle={t.forward.powerHint}
        checked={power.data === true}
        disabled={power.data == null}
        loading={toggle.isPending}
        onCheckedChange={(next) => toggle.mutate(next)}
      />
      <ListRow
        href={hrefOf('settings', 'traffic')}
        title={t.forward.traffic}
        trailing={
          <>
            {guard.data && <span>{guard.data.notify ? t.common.enabled : t.common.disabled}</span>}
            {caret}
          </>
        }
      />
      <ListRow
        href={hrefOf('settings', 'device')}
        title={t.forward.nickname}
        trailing={
          <>
            <span className="max-w-40 truncate">{version.data?.nickname || version.data?.model || ''}</span>
            {caret}
          </>
        }
      />
    </ListGroup>
  )
}

const countLines = (text: string) => cleanLines(text).split('\n').filter(Boolean).length
const cleanPhones = (text: string) => cleanLines(text.replace(/[ \t]+/g, ''))

function FilterRules() {
  const t = useT()
  const queryClient = useQueryClient()
  const rules = useQuery({ queryKey: forwardKeys.blacklist, queryFn: forwardApi.blacklist })
  const [phones, setPhones] = useState<string | null>(null)
  const [keywords, setKeywords] = useState<string | null>(null)

  useEffect(() => {
    if (rules.data && phones === null) {
      setPhones(rules.data.phone)
      setKeywords(rules.data.keywords)
    }
  }, [rules.data, phones])

  const revert = () => {
    setPhones(rules.data?.phone ?? '')
    setKeywords(rules.data?.keywords ?? '')
  }
  const phoneError = phones && !validPhoneList(phones.replace(/\t/g, ' ')) ? t.forward.filter.phonesInvalid : null
  const dirty =
    rules.data != null &&
    phones != null &&
    keywords != null &&
    (cleanPhones(phones) !== cleanPhones(rules.data.phone) || cleanLines(keywords) !== cleanLines(rules.data.keywords))

  const save = useMutation({
    mutationFn: () => forwardApi.saveBlacklist(cleanPhones(phones ?? ''), cleanLines(keywords ?? '')),
    onSuccess: () => {
      const next = { phone: cleanPhones(phones ?? ''), keywords: cleanLines(keywords ?? '') }
      queryClient.setQueryData(forwardKeys.blacklist, next)
      setPhones(next.phone)
      setKeywords(next.keywords)
      toast.success(t.forward.filter.saved)
    },
    onError: (error) => toast.error(t.forward.saveFailed, { description: errorMessage(error) }),
  })

  return (
    <div>
      <Panel>
        <PanelHeader
          title={t.forward.filter.title}
          detail={rules.data ? t.forward.filter.summary(countLines(rules.data.phone), countLines(rules.data.keywords)) : undefined}
        />
        {phones == null || keywords == null ? (
          rules.isError ? (
            <div className="flex flex-col items-center gap-3 rounded-inner bg-sunken px-4 py-8 text-center">
              <p className="text-footnote text-danger-text">{errorMessage(rules.error)}</p>
              <Button variant="secondary" size="sm" loading={rules.isFetching} onClick={() => void rules.refetch()}>
                {t.common.retry}
              </Button>
            </div>
          ) : (
            <div className="flex flex-col gap-5">
              <Skeleton className="h-28 rounded-control" />
              <Skeleton className="h-28 rounded-control" />
            </div>
          )
        ) : (
          <div className="flex flex-col gap-5">
            <Field label={t.forward.filter.phones} hint={t.forward.filter.phonesHint} error={phoneError}>
              {(id) => (
                <Textarea
                  id={id}
                  value={phones}
                  onChange={(event) => setPhones(event.target.value)}
                  rows={4}
                  spellCheck={false}
                  invalid={Boolean(phoneError)}
                  placeholder={t.forward.filter.phonesPlaceholder}
                  className="num"
                />
              )}
            </Field>
            <Field label={t.forward.filter.keywords} hint={t.forward.filter.keywordsHint}>
              {(id) => (
                <Textarea
                  id={id}
                  value={keywords}
                  onChange={(event) => setKeywords(event.target.value)}
                  rows={4}
                  spellCheck={false}
                  placeholder={t.forward.filter.keywordsPlaceholder}
                />
              )}
            </Field>
          </div>
        )}
      </Panel>
      <SaveActions dirty={dirty} saving={save.isPending} disabled={Boolean(phoneError)} onRevert={revert} onSave={() => save.mutate()} />
    </div>
  )
}
