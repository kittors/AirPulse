import { ArrowLeft, ArrowUp, ChatCircleText, Copy, MagnifyingGlass, NotePencil, Trash, User, WarningCircle } from '@phosphor-icons/react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'

import { extractCode, groupConversations, smsApi, smsSegments, type Conversation, type SmsMessage } from '@/api/sms'
import { hrefOf, navigate } from '@/app/router'
import { Button } from '@/components/ui/button'
import { useConfirm } from '@/components/ui/dialog'
import { EmptyState, Skeleton } from '@/components/ui/feedback'
import { Field, Input, Textarea } from '@/components/ui/input'
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger, Tooltip } from '@/components/ui/overlay'
import { Sheet, SheetContent } from '@/components/ui/sheet'
import { toast } from '@/components/ui/toast'
import { useTelemetry } from '@/hooks/useTelemetry'
import { useT, type Messages } from '@/i18n'
import { copyText } from '@/lib/clipboard'
import { cn } from '@/lib/cn'
import { spring } from '@/lib/motion'


const smsKeys = { all: ['sms', 'all'] as const }
/** 收件箱：未读数变了就换 key 立刻重查（组件和分区预读共用） */
export const inboxQuery = (unread: number) => ({
  queryKey: [...smsKeys.all, unread] as const,
  queryFn: ({ signal }: { signal: AbortSignal }) => smsApi.list(500, signal),
  staleTime: 5_000,
})

/**
 * 收件箱：左边会话列表（搜索 + 新信息），右边对话气泡与输入框。
 * 窄屏上两栏折成一栏：没选会话时显示列表，选了就整屏显示对话。
 * 打开会话时把其中的未读标为已读；发送时先把气泡放上去（转圈），成功后以设备上的为准。
 */
export function Inbox({ selected }: { selected: string | null }) {
  const t = useT()
  const queryClient = useQueryClient()
  const { data: telemetry } = useTelemetry()
  const unread = telemetry?.smsUnread ?? 0
  const sms = useQuery({ ...inboxQuery(unread), refetchInterval: 15_000 })
  const [query, setQuery] = useState('')
  const [composeOpen, setComposeOpen] = useState(false)
  const conversations = useMemo(() => groupConversations(sms.data ?? []), [sms.data])
  const filtered = useMemo(() => {
    const q = query.trim()
    if (!q) return conversations
    return conversations.filter((c) => c.number.includes(q) || c.messages.some((m) => m.body.includes(q)))
  }, [conversations, query])
  const active = selected ? (conversations.find((c) => c.number === selected) ?? null) : null

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: smsKeys.all })
    void queryClient.invalidateQueries({ queryKey: ['telemetry'] })
  }

  return (
    <div className="@container">
      <div className="grid grid-cols-1 h-[min(calc(100dvh-210px),760px)] min-h-[520px] overflow-hidden rounded-card bg-surface shadow-card max-lg:h-[calc(100dvh-var(--ap-tabbar-h,0px)-200px)] @3xl:grid-cols-[320px_minmax(0,1fr)]">
        {/* 会话列表：窄屏上选了会话就隐藏 */}
        <aside className={cn('flex min-h-0 flex-col @3xl:border-r @3xl:border-line', selected && '@max-3xl:hidden')}>
          <div className="flex items-center gap-2 p-3">
            <Input
              size="sm"
              value={query}
              onValueChange={setQuery}
              placeholder={t.messages.search}
              clearable
              prefix={<MagnifyingGlass />}
              shellClassName="flex-1"
            />
            <Tooltip content={t.messages.compose}>
              <Button variant="ghost" size="icon" aria-label={t.messages.compose} onClick={() => setComposeOpen(true)} className="text-accent">
                <NotePencil />
              </Button>
            </Tooltip>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
            {sms.isPending ? (
              <div className="flex flex-col gap-1 p-1">
                {[0, 1, 2, 3, 4].map((i) => (
                  <Skeleton key={i} className="h-[68px] rounded-[12px]" />
                ))}
              </div>
            ) : filtered.length === 0 ? (
              <EmptyState
                icon={<ChatCircleText weight="light" />}
                title={query ? t.messages.noResults : t.messages.empty}
                description={query ? undefined : t.messages.emptyHint}
                className="py-14"
              />
            ) : (
              <ul className="flex flex-col gap-0.5">
                {filtered.map((conversation) => (
                  <ConversationRow key={conversation.number} conversation={conversation} active={conversation.number === selected} />
                ))}
              </ul>
            )}
          </div>
        </aside>

        {/* 对话 */}
        <section className={cn('flex min-h-0 flex-col', !selected && '@max-3xl:hidden')}>
          {active ? (
            <Thread key={active.number} conversation={active} onChanged={refresh} />
          ) : (
            <div className="grid flex-1 place-items-center">
              <EmptyState icon={<ChatCircleText weight="light" />} title={selected ? t.messages.empty : t.messages.pick} />
            </div>
          )}
        </section>
      </div>

      <ComposeSheet
        open={composeOpen}
        onClose={() => setComposeOpen(false)}
        onSent={(number) => {
          setComposeOpen(false)
          refresh()
          navigate('messages', number)
        }}
      />
    </div>
  )
}

/* —— 会话列表里的一行：头像 · 号码 · 时间 / 最后一条预览；未读在左边一颗蓝点 —— */

function ConversationRow({ conversation, active }: { conversation: Conversation; active: boolean }) {
  const t = useT()
  const { last, unread, number } = conversation
  return (
    <li>
      <a
        href={hrefOf('messages', number)}
        aria-current={active ? 'page' : undefined}
        className={cn(
          'relative flex items-start gap-3 rounded-[12px] py-2.5 pr-3 pl-5 transition-colors duration-100',
          active ? 'bg-accent-soft' : 'hover:bg-hover',
        )}
      >
        {unread > 0 && <span aria-label={t.messages.unread(unread)} className="absolute top-[26px] left-1.5 size-2 rounded-full bg-accent" />}
        <span className="grid size-10 shrink-0 place-items-center rounded-full bg-[rgb(120_120_128/0.16)] text-text-3">
          <User className="size-5" weight="fill" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline gap-2">
            <span className={cn('num min-w-0 flex-1 truncate text-[15px] text-text', unread > 0 ? 'font-semibold' : 'font-medium')}>{number}</span>
            <span className="shrink-0 text-caption font-normal text-text-3">{shortTime(t, last.time)}</span>
          </span>
          <span className={cn('mt-0.5 line-clamp-2 text-footnote', unread > 0 ? 'text-text' : 'text-text-2')}>
            {last.outgoing && last.failed && <WarningCircle className="mr-1 inline size-3.5 -translate-y-px text-danger" weight="fill" />}
            {last.body}
          </span>
        </span>
      </a>
    </li>
  )
}

/** 列表里的时间：今天显示时分，昨天显示「昨天」，更早显示月日 */
function shortTime(t: Messages, time: number | null): string {
  if (time == null) return ''
  const date = new Date(time)
  const now = new Date()
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  if (time >= startOfToday) return `${pad(date.getHours())}:${pad(date.getMinutes())}`
  if (time >= startOfToday - 86_400_000) return t.messages.yesterday
  return date.getFullYear() === now.getFullYear()
    ? `${date.getMonth() + 1}/${date.getDate()}`
    : `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()}`
}
const pad = (n: number) => String(n).padStart(2, '0')

/** 对话里的时间分隔：今天 14:32 / 昨天 09:10 / 10月26日 20:05 */
function stampLabel(t: Messages, time: number): string {
  const date = new Date(time)
  const now = new Date()
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const hm = `${pad(date.getHours())}:${pad(date.getMinutes())}`
  if (time >= startOfToday) return `${t.messages.today} ${hm}`
  if (time >= startOfToday - 86_400_000) return `${t.messages.yesterday} ${hm}`
  return `${date.getMonth() + 1}/${date.getDate()} ${hm}`
}

/* —— 对话：顶栏（返回 · 号码 · 操作）+ 气泡 + 输入框 —— */

interface Pending {
  key: number
  body: string
}

function Thread({ conversation, onChanged }: { conversation: Conversation; onChanged: () => void }) {
  const t = useT()
  const confirm = useConfirm()
  const scroller = useRef<HTMLDivElement>(null)
  const [draft, setDraft] = useState('')
  const [pending, setPending] = useState<Pending[]>([])
  const { number, messages } = conversation

  // 打开会话时把未读标为已读（只标一次这批 id）
  const unreadIds = messages.filter((m) => m.unread).map((m) => m.id)
  const unreadKey = unreadIds.join(',')
  useEffect(() => {
    if (!unreadKey) return
    void smsApi.markRead(unreadKey.split(',')).then(onChanged)
    // onChanged 只是刷新查询，不需要作为依赖
  }, [unreadKey])

  // 新消息到达 / 切换会话时滚到底
  useLayoutEffect(() => {
    const el = scroller.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages.length, pending.length, number])

  const send = useMutation({
    mutationFn: (body: string) => smsApi.send(number, body),
  })

  const submit = async (body = draft) => {
    const text = body.trim()
    if (!text || send.isPending) return
    const key = Date.now()
    setPending((list) => [...list, { key, body: text }])
    if (body === draft) setDraft('')
    try {
      await send.mutateAsync(text)
      onChanged()
    } catch {
      toast.error(t.messages.sendFailed)
      if (body === draft) setDraft(text)
    } finally {
      // 等列表刷新出这条再撤掉占位，避免气泡闪一下
      window.setTimeout(() => setPending((list) => list.filter((item) => item.key !== key)), 1200)
    }
  }

  const removeConversation = async () => {
    const ok = await confirm({
      tone: 'danger',
      title: t.messages.deleteConversationTitle(number),
      description: t.messages.deleteConversationBody(messages.length),
      confirmText: t.messages.deleteConversation,
      onConfirm: () => smsApi.remove(messages.map((m) => m.id)),
    })
    if (ok) {
      toast.success(t.messages.deleted)
      onChanged()
      navigate('messages')
    }
  }

  const items = withStamps(messages)
  return (
    <>
      <header className="flex h-14 shrink-0 items-center gap-2 border-b border-line px-3">
        <Button variant="ghost" size="icon" aria-label={t.common.back} className="@3xl:hidden" onClick={() => navigate('messages')}>
          <ArrowLeft />
        </Button>
        <div className="min-w-0 flex-1 pl-1">
          <p className="num truncate text-headline text-text">{number}</p>
          <p className="text-caption text-text-3">{t.messages.count(messages.length)}</p>
        </div>
        <Tooltip content={t.messages.copyNumber}>
          <Button
            variant="ghost"
            size="icon"
            aria-label={t.messages.copyNumber}
            onClick={async () => {
              if (await copyText(number)) toast.success(t.common.copied, { description: number })
            }}
          >
            <Copy />
          </Button>
        </Tooltip>
        <Tooltip content={t.messages.deleteConversation}>
          <Button variant="ghost" size="icon" aria-label={t.messages.deleteConversation} onClick={() => void removeConversation()}>
            <Trash />
          </Button>
        </Tooltip>
      </header>

      <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        <ul className="flex flex-col gap-1.5">
          {items.map((item) =>
            item.kind === 'stamp' ? (
              <li key={`stamp-${item.time}`} className="pt-3 pb-1 text-center text-caption text-text-3 first:pt-0">
                {stampLabel(t, item.time)}
              </li>
            ) : (
              <Bubble key={item.message.id} message={item.message} onResend={() => void submit(item.message.body)} onChanged={onChanged} />
            ),
          )}
          <AnimatePresence initial={false}>
            {pending.map((item) => (
              <motion.li
                key={item.key}
                initial={{ opacity: 0, y: 8, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0 }}
                transition={spring.snappy}
                className="flex justify-end"
              >
                <span className="max-w-[78%] rounded-[18px] bg-accent-solid px-3.5 py-2 text-[15px] leading-[21px] whitespace-pre-wrap text-on-accent opacity-60">
                  {item.body}
                </span>
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
      </div>

      <Composer value={draft} onChange={setDraft} onSend={() => void submit()} busy={send.isPending} />
    </>
  )
}

type Item = { kind: 'stamp'; time: number } | { kind: 'message'; message: SmsMessage }

/** 相隔超过 10 分钟的消息之间插一个时间分隔（像 iMessage） */
function withStamps(messages: SmsMessage[]): Item[] {
  const items: Item[] = []
  let last = -Infinity
  for (const message of messages) {
    const time = message.time ?? 0
    if (time - last > 10 * 60_000) items.push({ kind: 'stamp', time })
    last = time
    items.push({ kind: 'message', message })
  }
  return items
}

function Bubble({ message, onResend, onChanged }: { message: SmsMessage; onResend: () => void; onChanged: () => void }) {
  const t = useT()
  const confirm = useConfirm()
  const code = message.outgoing ? null : extractCode(message.body)
  const remove = async () => {
    const ok = await confirm({
      tone: 'danger',
      title: t.messages.deleteMessageTitle,
      confirmText: t.messages.deleteMessage,
      onConfirm: () => smsApi.remove([message.id]),
    })
    if (ok) {
      toast.success(t.messages.deleted)
      onChanged()
    }
  }
  return (
    <li className={cn('flex flex-col gap-1', message.outgoing ? 'items-end' : 'items-start')}>
      <Menu>
        <MenuTrigger asChild>
          <button
            type="button"
            className={cn(
              'max-w-[78%] rounded-[18px] px-3.5 py-2 text-left text-[15px] leading-[21px] break-words whitespace-pre-wrap transition-[filter] duration-100 active:brightness-95',
              message.outgoing ? 'bg-accent-solid text-on-accent' : 'bg-[rgb(120_120_128/0.14)] text-text dark:bg-[rgb(120_120_128/0.24)]',
              message.failed && 'opacity-70',
            )}
          >
            {message.body}
          </button>
        </MenuTrigger>
        <MenuContent align={message.outgoing ? 'end' : 'start'}>
          <MenuItem
            icon={<Copy />}
            onSelect={async () => {
              if (await copyText(message.body)) toast.success(t.common.copied)
            }}
          >
            {t.messages.copyText}
          </MenuItem>
          <MenuSeparator />
          <MenuItem icon={<Trash />} tone="danger" onSelect={() => void remove()}>
            {t.messages.deleteMessage}
          </MenuItem>
        </MenuContent>
      </Menu>
      {message.failed && (
        <span className="flex items-center gap-1.5 text-caption text-danger-text">
          <WarningCircle className="size-3.5" weight="fill" />
          {t.messages.failedTag}
          <button type="button" onClick={onResend} className="font-medium text-accent-text hover:underline">
            {t.messages.resend}
          </button>
        </span>
      )}
      {code && (
        <Button
          variant="soft"
          size="sm"
          icon={<Copy weight="bold" />}
          className="num"
          onClick={async () => {
            if (await copyText(code)) toast.success(t.overview.codeCopied(code))
          }}
        >
          {t.overview.copyCode(code)}
        </Button>
      )}
    </li>
  )
}

/* —— 输入框：随内容长高（最多 5 行）；桌面上回车发送、Shift+回车换行 —— */

function Composer({ value, onChange, onSend, busy }: { value: string; onChange: (v: string) => void; onSend: () => void; busy: boolean }) {
  const t = useT()
  const ref = useRef<HTMLTextAreaElement>(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 5 * 21 + 16)}px`
  }, [value])
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return
    if (!window.matchMedia('(pointer: fine)').matches) return
    event.preventDefault()
    onSend()
  }
  const segments = smsSegments(value)
  return (
    <div className="shrink-0 border-t border-line p-3">
      <div className="flex items-end gap-2">
        <div className="flex min-w-0 flex-1 flex-col rounded-[20px] bg-[rgb(120_120_128/0.12)] px-3.5 py-2 transition-shadow focus-within:shadow-[0_0_0_3px_color-mix(in_oklab,var(--color-accent)_30%,transparent)] dark:bg-[rgb(120_120_128/0.24)]">
          <textarea
            ref={ref}
            rows={1}
            value={value}
            onChange={(event) => onChange(event.target.value)}
            onKeyDown={onKeyDown}
            placeholder={t.messages.placeholder}
            className="max-h-[121px] resize-none bg-transparent text-[15px] leading-[21px] text-text outline-none placeholder:text-text-4"
          />
          {segments > 1 && <span className="num mt-0.5 self-end text-caption2 text-text-3">{t.messages.segments(segments)}</span>}
        </div>
        <Button
          variant="primary"
          size="icon"
          aria-label={t.messages.send}
          loading={busy}
          disabled={!value.trim()}
          onClick={onSend}
          className="mb-0.5 size-9"
        >
          <ArrowUp weight="bold" />
        </Button>
      </div>
    </div>
  )
}

/* —— 新信息：号码 + 正文 —— */

function ComposeSheet({ open, onClose, onSent }: { open: boolean; onClose: () => void; onSent: (number: string) => void }) {
  const t = useT()
  const [number, setNumber] = useState('')
  const [body, setBody] = useState('')
  const [errors, setErrors] = useState<{ number?: string; body?: string }>({})
  const send = useMutation({ mutationFn: () => smsApi.send(number, body) })
  const submit = async () => {
    const next: typeof errors = {}
    if (!/^\+?\d{3,20}$/.test(number.replace(/[\s-]/g, ''))) next.number = t.messages.numberInvalid
    if (!body.trim()) next.body = t.messages.bodyEmpty
    setErrors(next)
    if (next.number || next.body) return
    try {
      await toast.promise(send.mutateAsync(), { loading: t.messages.sending, success: t.messages.sent, error: t.messages.sendFailed })
      const target = number.replace(/[\s-]/g, '')
      setNumber('')
      setBody('')
      onSent(target)
    } catch {
      /* 错误已提示 */
    }
  }
  const segments = smsSegments(body)
  return (
    <Sheet open={open} onOpenChange={(next) => !next && onClose()}>
      <SheetContent
        title={t.messages.compose}
        footer={
          <>
            <Button variant="secondary" onClick={onClose}>
              {t.common.cancel}
            </Button>
            <Button variant="primary" icon={<ArrowUp weight="bold" />} loading={send.isPending} onClick={() => void submit()}>
              {t.messages.send}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <Field label={t.messages.to} error={errors.number}>
            {(id) => (
              <Input
                id={id}
                value={number}
                onValueChange={(v) => {
                  setNumber(v)
                  if (errors.number) setErrors((e) => ({ ...e, number: undefined }))
                }}
                inputMode="tel"
                mono
                placeholder={t.messages.toPlaceholder}
                invalid={Boolean(errors.number)}
                autoFocus
              />
            )}
          </Field>
          <Field label={t.messages.placeholder} error={errors.body} hint={segments > 0 ? t.messages.segments(segments) : undefined}>
            {(id) => (
              <Textarea
                id={id}
                value={body}
                onChange={(event) => {
                  setBody(event.target.value)
                  if (errors.body) setErrors((e) => ({ ...e, body: undefined }))
                }}
                rows={5}
                invalid={Boolean(errors.body)}
              />
            )}
          </Field>
        </div>
      </SheetContent>
    </Sheet>
  )
}

