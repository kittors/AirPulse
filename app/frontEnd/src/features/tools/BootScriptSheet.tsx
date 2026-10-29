import { useMutation, useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'

import { advancedApi, BOOT_SCRIPT } from '@/api/advanced'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/feedback'
import { Textarea } from '@/components/ui/input'
import { Sheet, SheetContent } from '@/components/ui/sheet'
import { toast } from '@/components/ui/toast'
import { useT } from '@/i18n'
import { errorMessage } from '@/lib/errors'

/** 开机脚本（root 身份在开机窗口执行）：读出来编辑，保存时先上传成文件再 mv 过去，避开命令行转义 */
export function BootScriptSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const t = useT()
  const script = useQuery({ queryKey: ['tools', 'boot-script'], queryFn: advancedApi.readBootScript, enabled: open, staleTime: 0 })
  const [text, setText] = useState<string | null>(null)

  useEffect(() => {
    if (!open) setText(null)
    else if (text == null && script.data != null && !script.isFetching) setText(script.data)
  }, [open, script.data, script.isFetching, text])

  const save = useMutation({
    mutationFn: () => advancedApi.writeBootScript(text ?? ''),
    onSuccess: () => {
      toast.success(t.tools.scripts.bootSaved)
      void script.refetch()
      onOpenChange(false)
    },
    onError: (error) => toast.error(t.common.operationFailed, { description: errorMessage(error) }),
  })

  const dirty = text != null && text !== script.data
  return (
    <Sheet open={open} onOpenChange={(next) => !save.isPending && onOpenChange(next)}>
      <SheetContent
        className="sm:w-[min(640px,calc(100vw-24px))]"
        title={t.tools.scripts.boot}
        description={<span className="font-mono text-[12px]">{BOOT_SCRIPT}</span>}
        footer={
          <>
            <Button variant="secondary" disabled={save.isPending} onClick={() => onOpenChange(false)}>
              {t.common.cancel}
            </Button>
            <Button variant="primary" loading={save.isPending} disabled={!dirty} onClick={() => save.mutate()}>
              {t.common.save}
            </Button>
          </>
        }
      >
        {text == null ? (
          script.isError ? (
            <p className="py-10 text-center text-footnote text-danger-text">{errorMessage(script.error)}</p>
          ) : (
            <Skeleton className="h-80 rounded-inner" />
          )
        ) : (
          <Textarea
            value={text}
            onChange={(event) => setText(event.target.value)}
            rows={18}
            wrap="off"
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            aria-label={t.tools.scripts.boot}
            className="font-mono text-[12.5px] leading-5"
          />
        )}
        <p className="mt-3 text-footnote text-text-3">{t.tools.scripts.bootFooter}</p>
      </SheetContent>
    </Sheet>
  )
}
