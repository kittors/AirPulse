import { DotsThree, PencilSimple, Plus, Trash, Warning } from '@phosphor-icons/react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useState } from 'react'

import { advancedApi } from '@/api/advanced'
import { Button } from '@/components/ui/button'
import { Callout, Skeleton } from '@/components/ui/feedback'
import { Field, Input, Textarea } from '@/components/ui/input'
import { Menu, MenuContent, MenuItem, MenuTrigger } from '@/components/ui/overlay'
import { SegmentedControl } from '@/components/ui/segmented'
import { Sheet, SheetContent } from '@/components/ui/sheet'
import { Switch } from '@/components/ui/switch'
import { toast } from '@/components/ui/toast'
import { useT } from '@/i18n'
import { cn } from '@/lib/cn'
import { errorMessage } from '@/lib/errors'
import { formatBytes, joinQuantity } from '@/lib/format'
import { collapse } from '@/lib/motion'
import { parseCustomHead, serializeCustomHead, summarizeCode, validPluginName, type CustomHead, type PluginBlock } from '@/model/plugins'

import { customHeadQuery } from './keys'

type Mode = 'blocks' | 'raw'

/**
 * 自定义代码（注入到页面 <head>）：按原版「插件」块格式逐块启停、编辑、删除，也可以直接改原文。
 * 注入的脚本拥有页面的全部权限——顶部明确提醒，并告诉用户出问题时用 ?safe=1 跳过注入。
 */
export function CustomHeadSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const t = useT()
  const queryClient = useQueryClient()
  const head = useQuery({ ...customHeadQuery, enabled: open })
  const [mode, setMode] = useState<Mode>('blocks')
  const [draft, setDraft] = useState<CustomHead | null>(null)
  const [raw, setRaw] = useState('')
  const [editing, setEditing] = useState<number | 'new' | null>(null)

  useEffect(() => {
    if (!open) {
      setDraft(null)
      setEditing(null)
      setMode('blocks')
    } else if (draft == null && head.data != null && !head.isFetching) {
      setDraft(parseCustomHead(head.data))
      setRaw(head.data)
    }
  }, [open, head.data, head.isFetching, draft])

  const text = mode === 'raw' ? raw : draft ? serializeCustomHead(draft) : ''
  const dirty = draft != null && text.trim() !== (head.data ?? '').trim()

  const save = useMutation({
    mutationFn: () => advancedApi.setCustomHead(text),
    onSuccess: () => {
      queryClient.setQueryData(['tools', 'custom-head'], text.trim())
      toast.success(t.tools.head.saved, { description: t.tools.head.savedBody, action: { label: t.tools.head.reload, onClick: () => window.location.reload() } })
      onOpenChange(false)
    },
    onError: (error) => toast.error(t.common.operationFailed, { description: errorMessage(error) }),
  })

  const switchMode = (next: Mode) => {
    if (next === mode) return
    if (next === 'raw' && draft) setRaw(serializeCustomHead(draft))
    if (next === 'blocks') setDraft(parseCustomHead(raw))
    setEditing(null)
    setMode(next)
  }

  const update = (fn: (head: CustomHead) => CustomHead) => setDraft((d) => (d ? fn(d) : d))

  return (
    <Sheet open={open} onOpenChange={(next) => !save.isPending && onOpenChange(next)}>
      <SheetContent
        className="sm:w-[min(640px,calc(100vw-24px))]"
        title={t.tools.head.title}
        description={t.tools.head.description}
        footer={
          <>
            <Button variant="secondary" disabled={save.isPending} onClick={() => onOpenChange(false)}>
              {t.common.cancel}
            </Button>
            <Button variant="primary" loading={save.isPending} disabled={!dirty || editing != null} onClick={() => save.mutate()}>
              {t.common.save}
            </Button>
          </>
        }
      >
        <Callout tone="warning" icon={<Warning weight="fill" />} title={t.tools.head.warningTitle}>
          {t.tools.head.warningBody}
        </Callout>

        <SegmentedControl
          className="mt-4"
          fullWidth
          ariaLabel={t.tools.head.mode}
          value={mode}
          onChange={switchMode}
          options={[
            { value: 'blocks', label: t.tools.head.blocks },
            { value: 'raw', label: t.tools.head.raw },
          ]}
        />

        <div className="mt-4">
          {!draft ? (
            <Skeleton className="h-48 rounded-inner" />
          ) : mode === 'raw' ? (
            <Textarea
              value={raw}
              onChange={(event) => setRaw(event.target.value)}
              rows={18}
              wrap="off"
              spellCheck={false}
              aria-label={t.tools.head.raw}
              placeholder="<style>…</style>"
              className="font-mono text-[12.5px] leading-5"
            />
          ) : (
            <div className="flex flex-col gap-2.5">
              {draft.loose && (
                <BlockCard
                  block={{ name: t.tools.head.loose, content: draft.loose, enabled: true }}
                  fixed
                  editing={false}
                  onToggle={() => undefined}
                  onEdit={() => switchMode('raw')}
                  onDelete={() => update((d) => ({ ...d, loose: '' }))}
                />
              )}
              {draft.blocks.map((block, index) =>
                editing === index ? (
                  <BlockEditor
                    key={`edit-${index}`}
                    initial={block}
                    taken={draft.blocks.filter((_, i) => i !== index).map((b) => b.name)}
                    onCancel={() => setEditing(null)}
                    onDone={(next) => {
                      update((d) => ({ ...d, blocks: d.blocks.map((b, i) => (i === index ? { ...b, ...next } : b)) }))
                      setEditing(null)
                    }}
                  />
                ) : (
                  <BlockCard
                    key={`${block.name}-${index}`}
                    block={block}
                    editing={editing != null}
                    onToggle={(enabled) => update((d) => ({ ...d, blocks: d.blocks.map((b, i) => (i === index ? { ...b, enabled } : b)) }))}
                    onEdit={() => setEditing(index)}
                    onDelete={() => update((d) => ({ ...d, blocks: d.blocks.filter((_, i) => i !== index) }))}
                  />
                ),
              )}
              {!draft.loose && draft.blocks.length === 0 && editing !== 'new' && (
                <p className="rounded-inner bg-sunken px-4 py-8 text-center text-footnote text-text-3">{t.tools.head.empty}</p>
              )}
              <AnimatePresence initial={false}>
                {editing === 'new' && (
                  <motion.div {...collapse} className="overflow-hidden">
                    <BlockEditor
                      initial={{ name: '', content: '', enabled: true }}
                      taken={draft.blocks.map((b) => b.name)}
                      onCancel={() => setEditing(null)}
                      onDone={(next) => {
                        update((d) => ({ ...d, blocks: [...d.blocks, { ...next, enabled: true }] }))
                        setEditing(null)
                      }}
                    />
                  </motion.div>
                )}
              </AnimatePresence>
              {editing == null && (
                <Button variant="soft" className="self-start" icon={<Plus weight="bold" />} onClick={() => setEditing('new')}>
                  {t.tools.head.add}
                </Button>
              )}
            </div>
          )}
        </div>
        <p className="mt-4 text-footnote text-text-3">{t.tools.head.footer}</p>
      </SheetContent>
    </Sheet>
  )
}

function BlockCard({
  block,
  fixed = false,
  editing,
  onToggle,
  onEdit,
  onDelete,
}: {
  block: PluginBlock
  fixed?: boolean
  editing: boolean
  onToggle: (enabled: boolean) => void
  onEdit: () => void
  onDelete: () => void
}) {
  const t = useT()
  const summary = summarizeCode(block.content)
  const parts = [
    summary.scripts && t.tools.head.scripts(summary.scripts),
    summary.styles && t.tools.head.styles(summary.styles),
    summary.links && t.tools.head.links(summary.links),
    joinQuantity(formatBytes(summary.bytes)),
  ].filter(Boolean)
  return (
    <div className={cn('flex items-center gap-3 rounded-inner bg-sunken py-2.5 pr-2 pl-4 transition-opacity', !block.enabled && 'opacity-60')}>
      <div className="min-w-0 flex-1">
        <p className="truncate text-body font-medium text-text">{block.name}</p>
        <p className="truncate text-caption text-text-3">{parts.join(' · ')}</p>
      </div>
      {!fixed && <Switch checked={block.enabled} onCheckedChange={onToggle} disabled={editing} aria-label={block.name} />}
      <Menu>
        <MenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label={t.common.more} className="text-text-3" disabled={editing}>
            <DotsThree weight="bold" />
          </Button>
        </MenuTrigger>
        <MenuContent align="end">
          <MenuItem icon={<PencilSimple />} onSelect={onEdit}>
            {t.common.edit}
          </MenuItem>
          <MenuItem icon={<Trash />} tone="danger" onSelect={onDelete}>
            {t.common.delete}
          </MenuItem>
        </MenuContent>
      </Menu>
    </div>
  )
}

function BlockEditor({
  initial,
  taken,
  onCancel,
  onDone,
}: {
  initial: PluginBlock
  taken: string[]
  onCancel: () => void
  onDone: (block: Pick<PluginBlock, 'name' | 'content'>) => void
}) {
  const t = useT()
  const [name, setName] = useState(initial.name)
  const [content, setContent] = useState(initial.content)
  const [submitted, setSubmitted] = useState(false)
  const nameOk = validPluginName(name, taken)
  return (
    <div className="flex flex-col gap-3 rounded-inner bg-sunken p-3.5">
      <Field label={t.tools.head.name} error={submitted && !nameOk ? t.tools.head.nameInvalid : null}>
        {(id) => <Input id={id} value={name} onValueChange={setName} maxLength={60} autoFocus shellClassName="bg-surface" invalid={submitted && !nameOk} />}
      </Field>
      <Field label={t.tools.head.code}>
        {(id) => (
          <Textarea
            id={id}
            value={content}
            onChange={(event) => setContent(event.target.value)}
            rows={8}
            wrap="off"
            spellCheck={false}
            placeholder={'<style>\n  …\n</style>'}
            shellClassName="bg-surface"
            className="font-mono text-[12.5px] leading-5"
          />
        )}
      </Field>
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="secondary" onClick={onCancel}>
          {t.common.cancel}
        </Button>
        <Button
          size="sm"
          variant="primary"
          disabled={!content.trim()}
          onClick={() => {
            setSubmitted(true)
            if (nameOk && content.trim()) onDone({ name: name.trim(), content: content.trim() })
          }}
        >
          {t.common.done}
        </Button>
      </div>
    </div>
  )
}
