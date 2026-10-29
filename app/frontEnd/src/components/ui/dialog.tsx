import * as DialogPrimitive from '@radix-ui/react-dialog'
import { Warning, X } from '@phosphor-icons/react'
import { AnimatePresence, motion } from 'motion/react'
import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
} from 'react'

import { useT } from '@/i18n'
import { cn } from '@/lib/cn'
import { errorMessage } from '@/lib/errors'
import { spring } from '@/lib/motion'

import { Button } from './button'
import { Callout } from './feedback'
import { Input } from './input'

/** 打开状态传给内容层，好让 Motion 在关闭时先播完退场动画再卸载 */
const OpenContext = createContext(false)

/** 受控对话框根：open 必须由调用方管理（退场动画需要知道何时关闭） */
export function Dialog({
  open,
  onOpenChange,
  children,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  children: ReactNode
}) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <OpenContext.Provider value={open}>{children}</OpenContext.Provider>
    </DialogPrimitive.Root>
  )
}

export const DialogClose = DialogPrimitive.Close

const SIZES = { alert: 'max-w-[340px]', sm: 'max-w-[400px]', md: 'max-w-[460px]', lg: 'max-w-xl', xl: 'max-w-3xl' }

/**
 * 模态对话框：遮罩淡入 + 卡片轻轻放大浮现；关闭时反向收回。
 * 内容区独立滚动，标题与底部按钮常驻；busy 时 Esc / 点遮罩 / 关闭按钮都锁住。
 * layout="alert"：iOS 提醒框式——文字居中、无关闭按钮、两个等宽按钮并排。
 */
export function DialogContent({
  title,
  description,
  footer,
  size = 'md',
  busy = false,
  hideClose = false,
  layout = 'default',
  className,
  bodyClassName,
  children,
  ...props
}: Omit<ComponentProps<typeof DialogPrimitive.Content>, 'title'> & {
  title: ReactNode
  description?: ReactNode
  footer?: ReactNode
  size?: keyof typeof SIZES
  busy?: boolean
  hideClose?: boolean
  layout?: 'default' | 'alert'
  bodyClassName?: string
}) {
  const alert = layout === 'alert'
  const t = useT()
  const open = useContext(OpenContext)
  const guard = (event: Event) => busy && event.preventDefault()
  return (
    <AnimatePresence>
      {open && (
        <DialogPrimitive.Portal forceMount>
          <DialogPrimitive.Overlay forceMount asChild>
            <motion.div
              className="fixed inset-0 z-50 bg-scrim"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
            />
          </DialogPrimitive.Overlay>
          <DialogPrimitive.Content
            forceMount
            asChild
            onEscapeKeyDown={guard}
            onPointerDownOutside={guard}
            onInteractOutside={guard}
            {...props}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.98, transition: { duration: 0.14, ease: [0.4, 0, 1, 1] } }}
              transition={spring.snappy}
              className={cn(
                'fixed top-1/2 left-1/2 z-50 flex max-h-[calc(100dvh-40px)] w-[calc(100vw-24px)] -translate-x-1/2 -translate-y-1/2 flex-col',
                'rounded-[20px] bg-raised shadow-overlay outline-none',
                SIZES[size],
                className,
              )}
            >
              <header className={cn('flex items-start gap-3 px-6 pt-6', alert && 'px-5 pt-6 text-center')}>
                <div className="min-w-0 flex-1">
                  <DialogPrimitive.Title className="text-[17px] leading-[22px] font-semibold tracking-[-0.01em] text-text">
                    {title}
                  </DialogPrimitive.Title>
                  {description ? (
                    <DialogPrimitive.Description className={cn('mt-1.5 text-[14px] leading-5 text-text-2', alert && 'text-footnote')}>
                      {description}
                    </DialogPrimitive.Description>
                  ) : (
                    <DialogPrimitive.Description className="sr-only">{title}</DialogPrimitive.Description>
                  )}
                </div>
                {!hideClose && !alert && (
                  <DialogPrimitive.Close
                    disabled={busy}
                    aria-label={t.common.close}
                    className="-mt-0.5 -mr-1.5 grid size-7 shrink-0 place-items-center rounded-full bg-[rgb(120_120_128/0.12)] text-text-2 transition-colors hover:bg-[rgb(120_120_128/0.2)] hover:text-text disabled:opacity-40 dark:bg-[rgb(120_120_128/0.24)]"
                  >
                    <X className="size-3.5" weight="bold" />
                  </DialogPrimitive.Close>
                )}
              </header>
              <div className={cn('min-h-0 flex-1 overflow-y-auto px-6 pt-4 pb-6', alert && 'px-5 pt-3 pb-1', bodyClassName)}>{children}</div>
              {footer && (
                <footer
                  className={cn(
                    'flex flex-wrap items-center justify-end gap-2 px-6 pb-6 max-sm:[&>*]:flex-1',
                    alert && 'grid grid-cols-2 gap-2.5 px-5 pt-4 pb-5 [&>*]:w-full',
                  )}
                >
                  {footer}
                </footer>
              )}
            </motion.div>
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      )}
    </AnimatePresence>
  )
}

/* ---------------------------------------------------------------------------
 * 二次确认（替代 window.confirm）
 *
 *   const confirm = useConfirm()
 *   const ok = await confirm({ title, description, tone: 'danger', onConfirm: () => api.reboot() })
 *
 * 传了 onConfirm 时，对话框在执行期间保持打开并显示 Loading；失败就把错误显示在对话框里，
 * 用户可以重试或取消，不会「点了确定、弹窗消失、却什么都没发生」。
 * requireText：极端危险操作（恢复出厂）要求手动输入一段文字才能确定。
 * ------------------------------------------------------------------------- */

export interface ConfirmOptions {
  title: ReactNode
  description?: ReactNode
  details?: ReactNode
  tone?: 'default' | 'warning' | 'danger'
  confirmText?: ReactNode
  cancelText?: ReactNode
  requireText?: string
  onConfirm?: () => unknown | Promise<unknown>
}

type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>

const ConfirmContext = createContext<ConfirmFn | null>(null)

export function useConfirm(): ConfirmFn {
  const confirm = useContext(ConfirmContext)
  if (!confirm) throw new Error('useConfirm 必须在 <ConfirmProvider> 内使用')
  return confirm
}

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const t = useT()
  const [options, setOptions] = useState<ConfirmOptions | null>(null)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [typed, setTyped] = useState('')
  const resolver = useRef<((value: boolean) => void) | null>(null)

  const confirm = useCallback<ConfirmFn>((next) => {
    resolver.current?.(false)
    setOptions(next)
    setError(null)
    setTyped('')
    setBusy(false)
    setOpen(true)
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve
    })
  }, [])

  const settle = (value: boolean) => {
    resolver.current?.(value)
    resolver.current = null
    setOpen(false)
  }

  const onConfirm = async () => {
    if (!options) return
    if (!options.onConfirm) return settle(true)
    setBusy(true)
    setError(null)
    try {
      await options.onConfirm()
      setBusy(false)
      settle(true)
    } catch (err) {
      setBusy(false)
      setError(errorMessage(err))
    }
  }

  const tone = options?.tone ?? 'default'
  const locked = Boolean(options?.requireText) && typed.trim() !== options?.requireText

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <Dialog open={open} onOpenChange={(next) => !next && !busy && settle(false)}>
        {options && (
          <DialogContent
            size="alert"
            layout="alert"
            busy={busy}
            hideClose
            title={options.title}
            description={options.description}
            footer={
              <>
                <Button variant="secondary" size="lg" className="font-medium" disabled={busy} onClick={() => settle(false)}>
                  {options.cancelText ?? t.common.cancel}
                </Button>
                <Button
                  variant={tone === 'danger' ? 'danger' : 'primary'}
                  size="lg"
                  loading={busy}
                  disabled={locked}
                  onClick={onConfirm}
                  autoFocus={!options.requireText}
                >
                  {options.confirmText ?? t.common.confirm}
                </Button>
              </>
            }
            bodyClassName={cn(!options.details && !options.requireText && !error && 'hidden')}
          >
            <div className="flex flex-col gap-3">
              {options.details && <div className="text-footnote text-text-2">{options.details}</div>}
              {options.requireText && (
                <div className="flex flex-col gap-2 text-left">
                  <p className="text-footnote text-text-3">
                    {t.common.typeToConfirm}
                    <code className="mx-1 rounded-md bg-sunken px-1.5 py-0.5 font-mono text-text">{options.requireText}</code>
                  </p>
                  <Input value={typed} onValueChange={setTyped} autoFocus disabled={busy} />
                </div>
              )}
              {error && (
                <Callout tone="danger" icon={<Warning weight="fill" />} title={t.common.operationFailed}>
                  {error}
                </Callout>
              )}
            </div>
          </DialogContent>
        )}
      </Dialog>
    </ConfirmContext.Provider>
  )
}
