import { CircleNotch } from '@phosphor-icons/react'
import type { ComponentProps, ReactNode } from 'react'

import { cn } from '@/lib/cn'

export function Spinner({ className }: { className?: string }) {
  return <CircleNotch className={cn('ap-spin size-4 text-text-3', className)} weight="bold" aria-hidden />
}

/** 骨架屏：首次加载占位，形状尽量贴近真实内容，加载完成时版面不跳 */
export function Skeleton({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('ap-skeleton', className)} aria-hidden {...props} />
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: ReactNode
  title: ReactNode
  description?: ReactNode
  action?: ReactNode
  className?: string
}) {
  return (
    <div className={cn('flex flex-col items-center justify-center px-6 py-10 text-center', className)}>
      {icon && (
        <span className="mb-3 text-text-4 [&_svg]:size-9">
          {icon}
        </span>
      )}
      <p className="text-headline text-text">{title}</p>
      {description && <p className="mt-1 max-w-sm text-footnote text-text-3">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}

/** 卡片内的行内提示条（说明、警告），图标 + 文字，不单靠颜色 */
export function Callout({
  tone = 'neutral',
  icon,
  title,
  children,
  className,
}: {
  tone?: 'neutral' | 'accent' | 'warning' | 'danger' | 'success'
  icon?: ReactNode
  title?: ReactNode
  children?: ReactNode
  className?: string
}) {
  const tones = {
    neutral: 'bg-sunken text-text-2 [&_.ap-callout-icon]:text-text-3',
    accent: 'bg-accent-soft text-accent-text',
    warning: 'bg-warning-soft text-warning-text',
    danger: 'bg-danger-soft text-danger-text',
    success: 'bg-success-soft text-success-text',
  }
  return (
    <div className={cn('flex gap-2.5 rounded-inner px-3.5 py-3 text-footnote', tones[tone], className)}>
      {icon && <span className="ap-callout-icon mt-px shrink-0 [&_svg]:size-4">{icon}</span>}
      <div className="min-w-0">
        {title && <p className="font-semibold">{title}</p>}
        {children && <div className={cn(title && 'mt-0.5', 'opacity-90')}>{children}</div>}
      </div>
    </div>
  )
}
