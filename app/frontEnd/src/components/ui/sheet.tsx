import * as DialogPrimitive from '@radix-ui/react-dialog'
import { X } from '@phosphor-icons/react'
import { AnimatePresence, motion } from 'motion/react'
import { createContext, useContext, type ComponentProps, type ReactNode } from 'react'

import { useT } from '@/i18n'
import { cn } from '@/lib/cn'

const OpenContext = createContext(false)

/** 受控抽屉根（退场动画需要知道何时关闭） */
export function Sheet({ open, onOpenChange, children }: { open: boolean; onOpenChange: (open: boolean) => void; children: ReactNode }) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <OpenContext.Provider value={open}>{children}</OpenContext.Provider>
    </DialogPrimitive.Root>
  )
}

export const SheetTrigger = DialogPrimitive.Trigger
export const SheetClose = DialogPrimitive.Close

/**
 * 抽屉：桌面从右侧滑入，移动端从底部升起（大圆角顶 + 把手），弹簧收放。
 * side="auto" 按视口宽度自动二选一。
 */
export function SheetContent({
  side = 'auto',
  title,
  description,
  footer,
  className,
  children,
  ...props
}: Omit<ComponentProps<typeof DialogPrimitive.Content>, 'title'> & {
  side?: 'auto' | 'right' | 'bottom'
  title: ReactNode
  description?: ReactNode
  footer?: ReactNode
}) {
  const t = useT()
  const open = useContext(OpenContext)
  const resolved =
    side === 'auto' ? (typeof window !== 'undefined' && window.innerWidth < 640 ? 'bottom' : 'right') : side
  const offscreen = resolved === 'right' ? { x: '100%' } : { y: '100%' }
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
              transition={{ duration: 0.2 }}
            />
          </DialogPrimitive.Overlay>
          <DialogPrimitive.Content forceMount asChild {...props}>
            <motion.div
              initial={offscreen}
              animate={{ x: 0, y: 0 }}
              exit={{ ...offscreen, transition: { duration: 0.2, ease: [0.4, 0, 1, 1] } }}
              transition={{ type: 'spring', visualDuration: 0.32, bounce: 0 }}
              className={cn(
                'fixed z-50 flex flex-col bg-raised shadow-overlay outline-none',
                resolved === 'right'
                  ? 'inset-y-3 right-3 w-[min(420px,calc(100vw-24px))] rounded-[20px]'
                  : 'ap-safe-bottom inset-x-0 bottom-0 max-h-[90dvh] rounded-t-[22px]',
                className,
              )}
            >
              {resolved === 'bottom' && <span aria-hidden className="mx-auto mt-2 h-[5px] w-9 shrink-0 rounded-full bg-[rgb(120_120_128/0.3)]" />}
              <header className="flex items-start gap-3 px-5 pt-5 pb-3">
                <div className="min-w-0 flex-1">
                  <DialogPrimitive.Title className="text-[17px] leading-[22px] font-semibold tracking-[-0.01em] text-text">
                    {title}
                  </DialogPrimitive.Title>
                  {description ? (
                    <DialogPrimitive.Description className="mt-0.5 text-footnote text-text-2">{description}</DialogPrimitive.Description>
                  ) : (
                    <DialogPrimitive.Description className="sr-only">{title}</DialogPrimitive.Description>
                  )}
                </div>
                <DialogPrimitive.Close
                  aria-label={t.common.close}
                  className="-mr-1 grid size-7 shrink-0 place-items-center rounded-full bg-[rgb(120_120_128/0.12)] text-text-2 transition-colors hover:bg-[rgb(120_120_128/0.2)] hover:text-text dark:bg-[rgb(120_120_128/0.24)]"
                >
                  <X className="size-3.5" weight="bold" />
                </DialogPrimitive.Close>
              </header>
              <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5">{children}</div>
              {footer && <footer className="flex items-center justify-end gap-2 px-5 pt-3 pb-5 max-sm:[&>*]:flex-1">{footer}</footer>}
            </motion.div>
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      )}
    </AnimatePresence>
  )
}
