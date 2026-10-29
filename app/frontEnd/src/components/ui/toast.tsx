import * as ToastPrimitive from '@radix-ui/react-toast'
import { CheckCircle, CircleNotch, Info, Warning, X, XCircle } from '@phosphor-icons/react'
import { useSyncExternalStore, type ReactNode } from 'react'

import { useT } from '@/i18n'
import { cn } from '@/lib/cn'
import { errorMessage } from '@/lib/errors'

/* ---------------------------------------------------------------------------
 * Toast：替代 window.alert 的通知系统。顶部居中的一枚横幅（像 iOS 的通知）。
 * 关掉它：手机上往上一划（鼠标往上拖也行）；电脑上鼠标移上去，左上角出现关闭按钮（同 macOS 通知）。
 * 鼠标停在通知上时自动关闭的倒计时暂停。
 *
 *   toast.success('已保存')
 *   const id = toast.loading('正在重启网络…'); toast.update(id, { tone: 'success', title: '已重新入网' })
 *   await toast.promise(api.lockBand(), { loading: '正在锁频…', success: '锁频已生效', error: (e) => … })
 * ------------------------------------------------------------------------- */

export type ToastTone = 'info' | 'success' | 'warning' | 'error' | 'loading'

export interface ToastOptions {
  tone?: ToastTone
  description?: ReactNode
  /** 毫秒；loading 默认一直显示直到被 update / dismiss */
  duration?: number
  action?: { label: ReactNode; onClick: () => void }
  /** 同一件事的通知用同一个 key：还开着时原地更新并重新计时，不往下叠（比如连点几次都失败） */
  key?: string
}

interface ToastItem extends ToastOptions {
  id: number
  title: ReactNode
  open: boolean
  /** 每次 update 递增，用作 key 让 Radix 重新计时 */
  rev: number
}

let items: ToastItem[] = []
let seq = 0
const listeners = new Set<() => void>()

const emit = () => listeners.forEach((listener) => listener())
const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
const snapshot = () => items

const DEFAULT_DURATION: Record<ToastTone, number> = {
  info: 4000,
  success: 3200,
  warning: 6000,
  error: 7000,
  loading: Number.POSITIVE_INFINITY,
}

function push(title: ReactNode, options: ToastOptions = {}): number {
  const same = options.key ? items.find((item) => item.open && item.key === options.key) : undefined
  if (same) {
    items = items.map((item) => (item === same ? { ...item, description: undefined, action: undefined, ...options, title, rev: item.rev + 1 } : item))
    emit()
    return same.id
  }
  const id = ++seq
  // 同时最多保留 4 条，最旧的先收起
  const visible = items.filter((item) => item.open)
  if (visible.length >= 4) close(visible[0].id)
  items = [...items, { id, title, open: true, rev: 0, tone: 'info', ...options }]
  emit()
  return id
}

function update(id: number, patch: Partial<ToastOptions> & { title?: ReactNode }) {
  // 原来那条已经被划掉或被新通知挤掉：结果（比如「备份完成 · 下载」）不能丢，重新弹一条
  if (!items.some((item) => item.id === id && item.open)) {
    if (patch.title !== undefined && patch.tone !== 'loading') push(patch.title, patch)
    return
  }
  items = items.map((item) => (item.id === id ? { ...item, ...patch, rev: item.rev + 1 } : item))
  emit()
}

function close(id: number) {
  items = items.map((item) => (item.id === id ? { ...item, open: false } : item))
  emit()
  // 等退场动画结束再移除
  setTimeout(() => {
    items = items.filter((item) => item.id !== id)
    emit()
  }, 240)
}

export const toast = Object.assign((title: ReactNode, options?: ToastOptions) => push(title, options), {
  info: (title: ReactNode, options?: Omit<ToastOptions, 'tone'>) => push(title, { ...options, tone: 'info' }),
  success: (title: ReactNode, options?: Omit<ToastOptions, 'tone'>) => push(title, { ...options, tone: 'success' }),
  warning: (title: ReactNode, options?: Omit<ToastOptions, 'tone'>) => push(title, { ...options, tone: 'warning' }),
  error: (title: ReactNode, options?: Omit<ToastOptions, 'tone'>) => push(title, { ...options, tone: 'error' }),
  loading: (title: ReactNode, options?: Omit<ToastOptions, 'tone'>) => push(title, { ...options, tone: 'loading' }),
  update,
  dismiss: close,
  async promise<T>(
    task: Promise<T>,
    messages: {
      loading: ReactNode
      success: ReactNode | ((value: T) => ReactNode)
      error?: ReactNode | ((error: unknown) => ReactNode)
    },
  ): Promise<T> {
    const id = push(messages.loading, { tone: 'loading' })
    try {
      const value = await task
      update(id, {
        tone: 'success',
        title: typeof messages.success === 'function' ? messages.success(value) : messages.success,
        duration: DEFAULT_DURATION.success,
      })
      return value
    } catch (error) {
      const title =
        messages.error === undefined
          ? errorMessage(error)
          : typeof messages.error === 'function'
            ? messages.error(error)
            : messages.error
      update(id, {
        tone: 'error',
        title,
        description: messages.error === undefined ? undefined : errorMessage(error),
        duration: DEFAULT_DURATION.error,
      })
      throw error
    }
  },
})

const ICONS: Record<ToastTone, ReactNode> = {
  info: <Info className="text-accent" weight="fill" />,
  success: <CheckCircle className="text-success" weight="fill" />,
  warning: <Warning className="text-warning" weight="fill" />,
  error: <XCircle className="text-danger" weight="fill" />,
  loading: <CircleNotch className="ap-spin text-text-3" weight="bold" />,
}

export function Toaster() {
  const t = useT()
  const list = useSyncExternalStore(subscribe, snapshot, snapshot)
  return (
    // 通知贴着屏幕顶端，往上能划的距离有限：划过 32 px 就算要关掉（Radix 默认 50）
    <ToastPrimitive.Provider swipeDirection="up" swipeThreshold={32} label={t.common.notifications}>
      {list.map((item) => {
        const tone = item.tone ?? 'info'
        return (
          <ToastPrimitive.Root
            key={`${item.id}-${item.rev}`}
            open={item.open}
            onOpenChange={(open) => !open && close(item.id)}
            duration={item.duration ?? DEFAULT_DURATION[tone]}
            type={tone === 'error' || tone === 'warning' ? 'foreground' : 'background'}
            className={cn(
              'ap-toast group/toast pointer-events-auto relative flex w-max max-w-full items-start gap-2.5 rounded-[16px] bg-raised py-3 pr-4 pl-3.5 shadow-overlay',
              '[&_.ap-toast-icon_svg]:size-[18px]',
            )}
          >
            <ToastPrimitive.Close
              aria-label={t.common.close}
              className={cn(
                'absolute -top-1.5 -left-1.5 grid size-5 place-items-center rounded-full bg-raised text-text-2 shadow-[0_1px_3px_rgb(0_0_0/0.18)] ring-1 ring-line',
                'opacity-0 transition-opacity duration-150 group-hover/toast:opacity-100 focus-visible:opacity-100 hover:text-text',
                // 触屏上靠划掉，不放按钮（也免得挡住图标）
                'pointer-coarse:hidden',
              )}
            >
              <X className="size-2.5" weight="bold" />
            </ToastPrimitive.Close>
            <span className="ap-toast-icon mt-px shrink-0">{ICONS[tone]}</span>
            <div className="min-w-0">
              <ToastPrimitive.Title className="text-[14px] leading-5 font-medium text-text">{item.title}</ToastPrimitive.Title>
              {item.description && (
                <ToastPrimitive.Description className="mt-0.5 text-footnote break-words text-text-2">
                  {item.description}
                </ToastPrimitive.Description>
              )}
              {item.action && (
                <ToastPrimitive.Action altText={String(item.action.label)} asChild>
                  <button
                    type="button"
                    onClick={item.action.onClick}
                    className="mt-1.5 text-footnote font-semibold text-accent-text hover:underline"
                  >
                    {item.action.label}
                  </button>
                </ToastPrimitive.Action>
              )}
            </div>
          </ToastPrimitive.Root>
        )
      })}
      <ToastPrimitive.Viewport
        className={cn(
          // 浮层本身不接点击（通知两侧的空白处还能点到下面的顶栏），只有通知本身可以点、可以划
          'pointer-events-none fixed top-[max(16px,env(safe-area-inset-top))] left-1/2 z-[60] flex w-[min(440px,calc(100vw-24px))] -translate-x-1/2 flex-col items-center gap-2 outline-none ap-vt-toasts',
        )}
      />
    </ToastPrimitive.Provider>
  )
}
