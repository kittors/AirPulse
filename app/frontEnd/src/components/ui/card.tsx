import { CaretRight } from '@phosphor-icons/react'
import { motion, type HTMLMotionProps } from 'motion/react'
import type { ComponentProps, ReactNode } from 'react'

import { cn } from '@/lib/cn'

/**
 * 卡片：白底（深色 #1C1C1E）、20 圆角、不描边，只有一层极轻的投影。
 * 不给卡片配图标方块，也不在标题右边塞一句说明——那是模板化后台的味道。
 */
export function Panel({ className, ...props }: HTMLMotionProps<'section'>) {
  return <motion.section className={cn('relative min-w-0 rounded-card bg-surface p-5 shadow-card max-sm:p-4', className)} {...props} />
}

/** 卡片标题行：15px 半粗标题，可选一个补充值（如「7 个小区」），右侧放就近的动作 */
export function PanelHeader({
  title,
  detail,
  action,
  className,
}: {
  title: ReactNode
  detail?: ReactNode
  action?: ReactNode
  className?: string
}) {
  return (
    <header className={cn('mb-4 flex min-h-8 min-w-0 items-center gap-3', className)}>
      <h2 className="shrink-0 text-headline text-text">{title}</h2>
      {/* 补充信息优先让位：窄屏上被截断，而不是把标题或右侧动作挤出卡片 */}
      {detail != null && <span className="min-w-0 truncate text-footnote text-text-3">{detail}</span>}
      {action && <div className="ml-auto flex shrink-0 items-center gap-1">{action}</div>}
    </header>
  )
}

/**
 * 总览模块（学 Apple 天气）：一行小标签 + 大读数 + 一句人话 + 一个极简可视化。
 * 给了 href 整块可点（悬停微微变色、按下轻缩），标签行尾出现一个小箭头提示可进入。
 */
export function Module({
  icon,
  label,
  aside,
  href,
  className,
  children,
}: {
  icon?: ReactNode
  label: ReactNode
  /** 标签行右侧的补充（如「SWAP 62%」） */
  aside?: ReactNode
  href?: string
  className?: string
  children: ReactNode
}) {
  const body = (
    <>
      <div className="flex h-5 items-center gap-1.5 text-footnote font-medium text-text-2 [&>svg]:size-[15px] [&>svg]:text-text-3">
        {icon}
        <span className="min-w-0 truncate">{label}</span>
        {aside != null && <span className="ml-auto shrink-0 pl-2 text-caption font-normal text-text-3">{aside}</span>}
        {href && (
          <CaretRight
            className={cn('size-3 shrink-0 text-text-4 transition-transform duration-200 group-hover:translate-x-0.5', aside == null && 'ml-auto')}
            weight="bold"
          />
        )}
      </div>
      <div className="mt-3 flex min-h-0 flex-1 flex-col">{children}</div>
    </>
  )
  const base = 'relative flex min-w-0 flex-col rounded-card bg-surface p-5 shadow-card max-sm:p-4'
  if (!href) return <section className={cn(base, className)}>{body}</section>
  return (
    <a
      href={href}
      className={cn(
        base,
        'group ap-press ap-press-soft outline-offset-4 hover:bg-[color-mix(in_oklab,var(--color-surface),var(--color-text)_2.5%)]',
        className,
      )}
    >
      {body}
    </a>
  )
}

/**
 * 页面标题：28px 粗体标题 + 一行状态副标题；右侧放页面级动作。
 * 数据还没到时传 null：标题 / 副标题照样占住一行的高度（行内骨架条），数据到了原位替换，下面的内容不会被往下推。
 * 不需要副标题的页面不传（undefined）。
 */
export function PageHeader({
  title,
  subtitle,
  action,
  className,
}: {
  title: ReactNode | null
  subtitle?: ReactNode | null
  action?: ReactNode
  className?: string
}) {
  return (
    <div className={cn('mb-6 flex flex-wrap items-end justify-between gap-x-4 gap-y-3 max-sm:mb-5', className)}>
      <div className="min-w-0">
        <h1 className="text-title text-text max-lg:text-[30px] max-lg:leading-9">
          {title ?? <span className="ap-skeleton inline-block h-[0.85em] w-40 align-[-0.05em]" aria-hidden />}
        </h1>
        {subtitle !== undefined && (
          <div className="mt-1 text-subhead text-text-2">
            {subtitle ?? <span className="ap-skeleton inline-block h-[0.9em] w-56 max-w-full align-[-0.1em]" aria-hidden />}
          </div>
        )}
      </div>
      {action && <div className="flex shrink-0 items-center gap-2">{action}</div>}
    </div>
  )
}

/* —— iOS 式分组列表 —— */

/** 分组：可选组标题（卡片外、左上）与脚注（卡片外、下方），说明文字放脚注而不是塞进每一行 */
export function ListGroup({
  title,
  footer,
  className,
  children,
}: {
  title?: ReactNode
  footer?: ReactNode
  className?: string
  children: ReactNode
}) {
  return (
    <section className={cn('min-w-0', className)}>
      {title && <h2 className="mb-2 px-4 text-footnote font-medium text-text-2 max-sm:px-3">{title}</h2>}
      <div className="overflow-hidden rounded-card bg-surface shadow-card">{children}</div>
      {footer && <p className="mt-2 px-4 text-footnote text-text-3 max-sm:px-3">{footer}</p>}
    </section>
  )
}

/**
 * 分组里的一行：左边标题（+ 副标题），右边值或控件。
 * 行间的分隔线从文字起始处开始（不贯穿到卡片左边缘），和 iOS 一致。
 */
export function ListRow({
  title,
  subtitle,
  leading,
  trailing,
  onClick,
  href,
  selected,
  disabled,
  className,
  ...rest
}: {
  title: ReactNode
  subtitle?: ReactNode
  leading?: ReactNode
  trailing?: ReactNode
  onClick?: () => void
  href?: string
  selected?: boolean
  disabled?: boolean
  className?: string
} & Omit<ComponentProps<'div'>, 'title' | 'onClick'>) {
  const interactive = Boolean(onClick || href)
  const content = (
    <>
      {leading && <span className="flex shrink-0 items-center">{leading}</span>}
      <span className="relative flex min-h-[52px] min-w-0 flex-1 items-center gap-3 py-2.5 pr-4 after:absolute after:right-0 after:bottom-0 after:left-0 after:h-px after:bg-line group-last/row:after:hidden max-sm:pr-3">
        <span className="min-w-0 flex-1">
          <span className="block text-body text-text">{title}</span>
          {subtitle && <span className="mt-0.5 block text-footnote text-text-3">{subtitle}</span>}
        </span>
        {trailing != null && <span className="flex shrink-0 items-center gap-2 text-body text-text-2">{trailing}</span>}
      </span>
    </>
  )
  const classes = cn(
    'group/row flex w-full items-stretch gap-3 pl-4 text-left max-sm:pl-3',
    interactive && !disabled && 'transition-colors duration-100 hover:bg-hover active:bg-pressed',
    disabled && 'cursor-not-allowed opacity-50',
    className,
  )
  if (href) {
    return (
      <a href={href} className={classes} aria-current={selected ? 'page' : undefined} {...(rest as ComponentProps<'a'>)}>
        {content}
      </a>
    )
  }
  if (onClick) {
    return (
      <button type="button" onClick={onClick} disabled={disabled} className={classes} {...(rest as ComponentProps<'button'>)}>
        {content}
      </button>
    )
  }
  return (
    <div className={classes} {...rest}>
      {content}
    </div>
  )
}

/** 发丝分隔线 */
export function Divider({ className }: { className?: string }) {
  return <hr className={cn('border-0 border-t border-line', className)} />
}
