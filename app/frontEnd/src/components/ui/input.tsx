import { Eye, EyeSlash, XCircle } from '@phosphor-icons/react'
import { useId, useLayoutEffect, useRef, useState, type ComponentProps, type ReactNode } from 'react'

import { useT } from '@/i18n'
import { cn } from '@/lib/cn'

/**
 * 输入框外壳：容器负责底色、描边与聚焦光环，原生 <input> 完全透明、去掉 outline。
 * 前后缀放图标、单位或内嵌按钮（显隐、清空）。
 */
const SHELL =
  'group/input relative flex w-full min-w-0 items-center gap-2 rounded-control bg-sunken px-3 text-text ' +
  'transition-[box-shadow,background-color] duration-150 ease-out ' +
  'focus-within:shadow-[0_0_0_3px_color-mix(in_oklab,var(--color-accent)_35%,transparent)] ' +
  'has-[input:disabled]:cursor-not-allowed has-[input:disabled]:opacity-50 has-[textarea:disabled]:opacity-50 ' +
  'data-[invalid=true]:shadow-[0_0_0_1.5px_var(--color-danger)] data-[invalid=true]:focus-within:shadow-[0_0_0_3px_color-mix(in_oklab,var(--color-danger)_35%,transparent)]'

const FIELD =
  'peer min-w-0 flex-1 bg-transparent text-[15px] text-text outline-none placeholder:text-text-4 disabled:cursor-not-allowed'

const AFFIX = 'flex shrink-0 items-center text-text-3 [&_svg]:size-[18px]'

export interface InputProps extends Omit<ComponentProps<'input'>, 'size' | 'prefix'> {
  prefix?: ReactNode
  suffix?: ReactNode
  /** 有内容时显示清空按钮（需要受控 value + onValueChange） */
  clearable?: boolean
  invalid?: boolean
  size?: 'md' | 'sm'
  /** 读数类输入（PCI、频点、端口）用等宽数字 */
  mono?: boolean
  onValueChange?: (value: string) => void
  shellClassName?: string
}

export function Input({
  prefix,
  suffix,
  clearable = false,
  invalid = false,
  size = 'md',
  mono = false,
  onValueChange,
  onChange,
  className,
  shellClassName,
  value,
  ...props
}: InputProps) {
  const t = useT()
  const showClear = clearable && !props.disabled && !props.readOnly && value != null && String(value).length > 0
  return (
    <div
      data-invalid={invalid || undefined}
      className={cn(SHELL, size === 'md' ? 'h-10' : 'h-8 rounded-[10px] px-2.5 max-sm:h-10', shellClassName)}
    >
      {prefix && <span className={AFFIX}>{prefix}</span>}
      <input
        value={value}
        aria-invalid={invalid || undefined}
        onChange={(event) => {
          onChange?.(event)
          onValueChange?.(event.target.value)
        }}
        className={cn(FIELD, mono && 'num', size === 'sm' && 'text-[14px]', className)}
        {...props}
      />
      {showClear && (
        <button
          type="button"
          tabIndex={-1}
          aria-label={t.common.clear}
          onClick={() => onValueChange?.('')}
          className="grid size-6 shrink-0 place-items-center rounded-full text-text-4 transition-colors hover:text-text-2"
        >
          <XCircle className="size-[18px]" weight="fill" />
        </button>
      )}
      {suffix && <span className={cn(AFFIX, 'text-[13px]')}>{suffix}</span>}
    </div>
  )
}

/** 密码 / 口令输入：内嵌显隐切换，不用浏览器自带的眼睛 */
export function PasswordInput(props: Omit<InputProps, 'type' | 'suffix'>) {
  const t = useT()
  const [visible, setVisible] = useState(false)
  return (
    <Input
      {...props}
      type={visible ? 'text' : 'password'}
      autoCapitalize="off"
      autoCorrect="off"
      spellCheck={false}
      suffix={
        <button
          type="button"
          tabIndex={-1}
          aria-label={visible ? t.common.hide : t.common.show}
          aria-pressed={visible}
          onClick={() => setVisible((v) => !v)}
          className="-mr-1.5 grid size-7 place-items-center rounded-full text-text-3 transition-colors hover:bg-hover hover:text-text [&_svg]:size-[18px]"
        >
          {visible ? <EyeSlash /> : <Eye />}
        </button>
      }
    />
  )
}

/**
 * 整数输入：type=text + inputMode=numeric，彻底避开 number 输入框的上下箭头、
 * 滚轮改值和可以敲进 e / + 的怪行为；非数字字符直接过滤掉。
 */
export function IntegerInput({
  onValueChange,
  allowNegative = false,
  ...props
}: Omit<InputProps, 'type' | 'inputMode'> & { allowNegative?: boolean }) {
  return (
    <Input
      {...props}
      mono
      type="text"
      inputMode="numeric"
      autoComplete="off"
      onValueChange={(raw) => {
        const cleaned = allowNegative ? raw.replace(/(?!^-)[^\d]/g, '') : raw.replace(/\D/g, '')
        onValueChange?.(cleaned)
      }}
    />
  )
}

/** 多行输入：不要浏览器自带的拖拽手柄——至少 rows 行，随内容长高，超过约半屏后在框内滚动 */
export function Textarea({
  invalid = false,
  className,
  shellClassName,
  ref,
  onInput,
  ...props
}: ComponentProps<'textarea'> & { invalid?: boolean; shellClassName?: string }) {
  const inner = useRef<HTMLTextAreaElement | null>(null)
  const fit = () => {
    const el = inner.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }
  useLayoutEffect(fit, [props.value])
  return (
    <div data-invalid={invalid || undefined} className={cn(SHELL, 'items-stretch px-0 py-0', shellClassName)}>
      <textarea
        ref={(el) => {
          inner.current = el
          if (typeof ref === 'function') return ref(el)
          if (ref) ref.current = el
        }}
        aria-invalid={invalid || undefined}
        onInput={(event) => {
          fit()
          onInput?.(event)
        }}
        className={cn(FIELD, 'max-h-[min(60vh,560px)] min-h-24 resize-none overflow-y-auto px-3.5 py-3 leading-[22px]', className)}
        {...props}
      />
    </div>
  )
}

/** 表单字段：标签 + 控件 + 说明 / 错误。控件通过 render 拿到 id，保证 label 与输入关联 */
export function Field({
  label,
  hint,
  error,
  required,
  className,
  children,
}: {
  label: ReactNode
  hint?: ReactNode
  error?: ReactNode
  required?: boolean
  className?: string
  children: (id: string) => ReactNode
}) {
  const id = useId()
  return (
    <div className={cn('flex min-w-0 flex-col gap-2', className)}>
      <label htmlFor={id} className="text-footnote font-medium text-text-2">
        {label}
        {required && <span className="ml-0.5 text-danger">*</span>}
      </label>
      {children(id)}
      {error ? (
        <p className="text-footnote text-danger-text" role="alert">
          {error}
        </p>
      ) : (
        hint && <p className="text-footnote text-text-3">{hint}</p>
      )}
    </div>
  )
}
