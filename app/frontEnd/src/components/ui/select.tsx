import { CaretDown, Check } from '@phosphor-icons/react'
import * as SelectPrimitive from '@radix-ui/react-select'
import type { ReactNode } from 'react'

import { cn } from '@/lib/cn'

export interface SelectOption<T extends string> {
  value: T
  label: ReactNode
  description?: ReactNode
  disabled?: boolean
}

/**
 * 下拉选择（替代原生 <select>）：触发器与输入框同一套外观；浮层大圆角、细描边、弹出带缩放，
 * 键盘上下选择，选中项打勾。
 */
export function Select<T extends string>({
  value,
  onValueChange,
  options,
  placeholder,
  disabled,
  size = 'md',
  ariaLabel,
  className,
  contentClassName,
}: {
  value: T | undefined
  onValueChange: (value: T) => void
  options: SelectOption<T>[]
  placeholder?: ReactNode
  disabled?: boolean
  size?: 'md' | 'sm'
  ariaLabel?: string
  className?: string
  contentClassName?: string
}) {
  return (
    <SelectPrimitive.Root value={value} onValueChange={(v) => onValueChange(v as T)} disabled={disabled}>
      <SelectPrimitive.Trigger
        aria-label={ariaLabel}
        className={cn(
          'group inline-flex w-full min-w-0 items-center justify-between gap-2 rounded-control bg-sunken px-3 text-left text-[15px] text-text',
          'transition-[box-shadow,background-color] duration-150 hover:bg-[color-mix(in_oklab,var(--color-sunken),var(--color-text)_4%)]',
          'focus-visible:shadow-[0_0_0_3px_color-mix(in_oklab,var(--color-accent)_35%,transparent)] focus-visible:outline-none',
          'data-[placeholder]:text-text-4',
          'disabled:cursor-not-allowed disabled:opacity-50',
          size === 'md' ? 'h-10' : 'h-8 rounded-[10px] px-2.5 text-[14px] max-sm:h-10',
          className,
        )}
      >
        <span className="min-w-0 truncate">
          <SelectPrimitive.Value placeholder={placeholder} />
        </span>
        <SelectPrimitive.Icon asChild>
          <CaretDown
            weight="bold"
            className="size-3 shrink-0 text-text-3 transition-transform duration-200 ease-out group-data-[state=open]:rotate-180"
          />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Content
          position="popper"
          sideOffset={8}
          collisionPadding={12}
          className={cn(
            'ap-popover z-50 max-h-[min(var(--radix-select-content-available-height),360px)] min-w-(--radix-select-trigger-width) overflow-hidden',
            'rounded-[14px] bg-raised shadow-overlay',
            contentClassName,
          )}
        >
          <SelectPrimitive.Viewport className="max-h-[inherit] overflow-y-auto p-1">
            {options.map((option) => (
              <SelectPrimitive.Item
                key={option.value}
                value={option.value}
                disabled={option.disabled}
                className={cn(
                  'relative flex min-h-9 cursor-pointer items-center gap-2 rounded-[10px] py-1.5 pr-9 pl-3 text-[14px] text-text outline-none select-none',
                  'transition-colors duration-100 data-[highlighted]:bg-hover',
                  'data-[disabled]:cursor-not-allowed data-[disabled]:opacity-45 max-sm:min-h-11',
                )}
              >
                <div className="min-w-0">
                  <SelectPrimitive.ItemText>{option.label}</SelectPrimitive.ItemText>
                  {option.description && <p className="text-[12px] font-normal text-text-3">{option.description}</p>}
                </div>
                <SelectPrimitive.ItemIndicator className="absolute right-3 text-accent">
                  <Check className="size-4" weight="bold" />
                </SelectPrimitive.ItemIndicator>
              </SelectPrimitive.Item>
            ))}
          </SelectPrimitive.Viewport>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  )
}
