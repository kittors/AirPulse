import * as TabsPrimitive from '@radix-ui/react-tabs'
import type { ComponentProps } from 'react'

import { cn } from '@/lib/cn'

export const Tabs = TabsPrimitive.Root

/** 下划线式标签页：用于卡片内的二级切换（例如 4G / 5G 频段） */
export function TabsList({ className, ...props }: ComponentProps<typeof TabsPrimitive.List>) {
  return (
    <TabsPrimitive.List
      className={cn('ap-no-scrollbar flex gap-5 overflow-x-auto border-b max-sm:gap-4', className)}
      {...props}
    />
  )
}

export function TabsTrigger({ className, ...props }: ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      className={cn(
        'relative -mb-px inline-flex h-10 shrink-0 items-center gap-1.5 border-b-2 border-transparent text-footnote font-medium text-text-3',
        'transition-colors duration-(--duration-fast) hover:text-text-2 focus-visible:outline-offset-[-2px]',
        'data-[state=active]:border-accent data-[state=active]:text-text [&_svg]:size-4',
        className,
      )}
      {...props}
    />
  )
}

export function TabsContent({ className, ...props }: ComponentProps<typeof TabsPrimitive.Content>) {
  return <TabsPrimitive.Content className={cn('ap-page outline-none', className)} {...props} />
}
