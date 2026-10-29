import { DotsThree, DownloadSimple, File, LinkSimple, Plus, Trash } from '@phosphor-icons/react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useRef, useState } from 'react'

import { advancedApi, uploadUrl, type UploadedFile } from '@/api/advanced'
import { Button } from '@/components/ui/button'
import { ListGroup, ListRow } from '@/components/ui/card'
import { useConfirm } from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/feedback'
import { Meter } from '@/components/ui/meter'
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from '@/components/ui/overlay'
import { toast } from '@/components/ui/toast'
import { useT } from '@/i18n'
import { copyText } from '@/lib/clipboard'
import { errorMessage } from '@/lib/errors'
import { formatBytes, joinQuantity } from '@/lib/format'

import { uploadsKey, uploadsQuery } from './keys'

const MAX_BYTES = 100 * 1024 * 1024

/**
 * 上传的文件（设备上 AirPulse 的 uploads 目录）：主题背景、插件资源、启动脚本与安装包都中转在这里。
 * 上传带进度；原名只含安全字符时改回原名，方便在链接里引用。
 */
export function UploadsGroup() {
  const t = useT()
  const confirm = useConfirm()
  const queryClient = useQueryClient()
  const files = useQuery(uploadsQuery)
  const input = useRef<HTMLInputElement>(null)
  const [progress, setProgress] = useState<{ name: string; loaded: number; total: number } | null>(null)

  const upload = async (file: File) => {
    if (file.size > MAX_BYTES) return toast.error(t.tools.uploads.tooLarge)
    setProgress({ name: file.name, loaded: 0, total: file.size })
    try {
      const { url } = await advancedApi.upload(file, (loaded, total) => setProgress({ name: file.name, loaded, total }))
      const stored = String(url ?? '').split('/').pop() ?? ''
      const finalName = stored && stored !== file.name && /^[\w.]+$/.test(file.name) ? await advancedApi.renameUpload(stored, file.name) : stored
      toast.success(t.tools.uploads.uploaded, { description: finalName })
    } catch (error) {
      toast.error(t.tools.uploads.uploadFailed, { description: errorMessage(error) })
    } finally {
      setProgress(null)
      void queryClient.invalidateQueries({ queryKey: uploadsKey })
    }
  }

  const remove = (file: UploadedFile) =>
    void confirm({
      tone: 'danger',
      title: t.tools.uploads.deleteTitle(file.name),
      description: t.tools.uploads.deleteBody,
      confirmText: t.common.delete,
      onConfirm: async () => {
        await advancedApi.deleteUpload(file.name)
        await queryClient.invalidateQueries({ queryKey: uploadsKey })
      },
    })

  const clearAll = () =>
    void confirm({
      tone: 'danger',
      title: t.tools.uploads.clearTitle(files.data?.length ?? 0),
      description: t.tools.uploads.deleteBody,
      confirmText: t.tools.uploads.clearAll,
      onConfirm: async () => {
        const res = await advancedApi.clearUploads()
        const failed = Object.entries(res.deleted_list ?? {}).filter(([, ok]) => !ok)
        if (failed.length) toast.warning(t.tools.uploads.partlyFailed(failed.length), { description: failed.map(([name]) => name).join('、') })
        await queryClient.invalidateQueries({ queryKey: uploadsKey })
      },
    })

  return (
    <ListGroup title={t.tools.uploads.title} footer={t.tools.uploads.footer}>
      <input
        ref={input}
        type="file"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0]
          event.target.value = ''
          if (file) void upload(file)
        }}
      />
      <ListRow
        leading={<Plus className="size-5 text-accent" weight="bold" />}
        title={<span className="text-accent-text">{t.tools.uploads.upload}</span>}
        subtitle={t.tools.uploads.limit}
        disabled={progress != null}
        onClick={() => input.current?.click()}
      />
      {progress && (
        <ListRow
          leading={<File className="size-5 text-text-3" />}
          title={<span className="block truncate">{progress.name}</span>}
          subtitle={
            <span className="mt-1.5 flex items-center gap-2.5">
              <Meter value={progress.loaded} max={progress.total || 1} tone="accent" size="sm" className="flex-1" />
              <span className="num shrink-0">{Math.round((progress.loaded / (progress.total || 1)) * 100)}%</span>
            </span>
          }
        />
      )}
      {!files.data ? (
        files.isError ? (
          <p className="px-4 py-5 text-footnote text-danger-text">{errorMessage(files.error)}</p>
        ) : (
          <div className="p-4">
            <Skeleton className="h-10" />
          </div>
        )
      ) : (
        files.data.map((file) => (
          <ListRow
            key={file.name}
            leading={<File className="size-5 text-text-3" />}
            title={<span className="block truncate font-mono text-[13px]">{file.name}</span>}
            subtitle={[file.size != null ? joinQuantity(formatBytes(file.size)) : null, file.modified].filter(Boolean).join(' · ') || undefined}
            trailing={
              <Menu>
                <MenuTrigger asChild>
                  <Button variant="ghost" size="icon-sm" aria-label={t.common.more} className="text-text-3">
                    <DotsThree weight="bold" />
                  </Button>
                </MenuTrigger>
                <MenuContent align="end">
                  <MenuItem asChild>
                    <a href={uploadUrl(file.name)} download={file.name}>
                      <DownloadSimple />
                      {t.tools.uploads.download}
                    </a>
                  </MenuItem>
                  <MenuItem
                    icon={<LinkSimple />}
                    onSelect={() =>
                      void copyText(new URL(uploadUrl(file.name), window.location.href).href).then((ok) =>
                        ok ? toast.success(t.common.copied) : toast.error(t.common.copyFailed),
                      )
                    }
                  >
                    {t.tools.uploads.copyLink}
                  </MenuItem>
                  <MenuSeparator />
                  <MenuItem icon={<Trash />} tone="danger" onSelect={() => remove(file)}>
                    {t.common.delete}
                  </MenuItem>
                </MenuContent>
              </Menu>
            }
          />
        ))
      )}
      {files.data && files.data.length > 1 && (
        <ListRow title={<span className="text-danger-text">{t.tools.uploads.clearAll}</span>} onClick={clearAll} />
      )}
    </ListGroup>
  )
}
