import { Check } from '@phosphor-icons/react'
import * as DropdownPrimitive from '@radix-ui/react-dropdown-menu'
import * as PopoverPrimitive from '@radix-ui/react-popover'
import * as TooltipPrimitive from '@radix-ui/react-tooltip'
import type { ComponentProps, ReactNode } from 'react'

import { cn } from '@/lib/cn'

/* —— Tooltip：反色小气泡（明暗模式下都与页面形成最强对比） —— */

export const TooltipProvider = TooltipPrimitive.Provider

export function Tooltip({
  content,
  children,
  side = 'top',
  align = 'center',
  delay,
}: {
  content: ReactNode
  children: ReactNode
  side?: 'top' | 'right' | 'bottom' | 'left'
  align?: 'start' | 'center' | 'end'
  delay?: number
}) {
  if (content == null || content === '') return <>{children}</>
  return (
    <TooltipPrimitive.Root delayDuration={delay}>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          side={side}
          align={align}
          sideOffset={6}
          collisionPadding={10}
          className="ap-popover z-[70] max-w-xs rounded-[8px] bg-text px-2.5 py-1.5 text-[12px] leading-4 font-medium text-bg shadow-raised"
        >
          {content}
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  )
}

/* —— Popover —— */

export const Popover = PopoverPrimitive.Root
export const PopoverTrigger = PopoverPrimitive.Trigger
export const PopoverClose = PopoverPrimitive.Close

export function PopoverContent({ className, ...props }: ComponentProps<typeof PopoverPrimitive.Content>) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        sideOffset={8}
        collisionPadding={12}
        className={cn('ap-popover z-50 rounded-[14px] bg-raised p-3 shadow-overlay outline-none', className)}
        {...props}
      />
    </PopoverPrimitive.Portal>
  )
}

/* —— 下拉菜单 —— */

export const Menu = DropdownPrimitive.Root
export const MenuTrigger = DropdownPrimitive.Trigger
export const MenuGroup = DropdownPrimitive.Group
export const MenuRadioGroup = DropdownPrimitive.RadioGroup

export function MenuContent({ className, ...props }: ComponentProps<typeof DropdownPrimitive.Content>) {
  return (
    <DropdownPrimitive.Portal>
      <DropdownPrimitive.Content
        sideOffset={6}
        collisionPadding={12}
        className={cn('ap-popover z-50 min-w-48 rounded-[14px] bg-raised p-1 shadow-overlay outline-none', className)}
        {...props}
      />
    </DropdownPrimitive.Portal>
  )
}

const ITEM =
  'relative flex min-h-9 cursor-pointer select-none items-center gap-2.5 rounded-[10px] px-2.5 text-[14px] text-text outline-none ' +
  'data-[highlighted]:bg-hover data-[disabled]:cursor-not-allowed data-[disabled]:opacity-45 max-sm:min-h-10 ' +
  '[&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-text-3'

export function MenuItem({
  className,
  icon,
  tone = 'default',
  children,
  ...props
}: ComponentProps<typeof DropdownPrimitive.Item> & { icon?: ReactNode; tone?: 'default' | 'danger' }) {
  return (
    <DropdownPrimitive.Item
      className={cn(ITEM, tone === 'danger' && 'text-danger-text [&_svg]:text-danger', className)}
      {...props}
    >
      {icon}
      {children}
    </DropdownPrimitive.Item>
  )
}

export function MenuRadioItem({ className, children, ...props }: ComponentProps<typeof DropdownPrimitive.RadioItem>) {
  return (
    <DropdownPrimitive.RadioItem className={cn(ITEM, 'pr-8', className)} {...props}>
      {children}
      <DropdownPrimitive.ItemIndicator className="absolute right-2.5 text-accent [&_svg]:size-4 [&_svg]:text-accent">
        <Check weight="bold" />
      </DropdownPrimitive.ItemIndicator>
    </DropdownPrimitive.RadioItem>
  )
}

export function MenuLabel({ className, ...props }: ComponentProps<typeof DropdownPrimitive.Label>) {
  return <DropdownPrimitive.Label className={cn('px-2.5 pt-2 pb-1 text-caption text-text-3', className)} {...props} />
}

export function MenuSeparator({ className }: { className?: string }) {
  return <DropdownPrimitive.Separator className={cn('mx-2 my-1 h-px bg-line', className)} />
}
