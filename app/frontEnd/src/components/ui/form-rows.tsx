import { Eye, EyeSlash } from '@phosphor-icons/react'
import { AnimatePresence, motion } from 'motion/react'
import { useId, useState, type HTMLInputTypeAttribute, type ReactNode } from 'react'

import { useT } from '@/i18n'
import { cn } from '@/lib/cn'
import { collapse } from '@/lib/motion'

import { Button } from './button'
import { ListRow } from './card'
import { Switch } from './switch'

/**
 * iOS 设置式的表单行：放在 ListGroup 里，标签在左、输入在右（右对齐、无边框），
 * 行间发丝线从文字处开始。错误提示挂在本行下方，不打乱整组的节奏。
 */
export function InputRow({
  label,
  value,
  onChange,
  placeholder,
  type = 'text',
  inputMode,
  mono = false,
  secret = false,
  suffix,
  error,
  disabled,
  maxLength,
  autoComplete = 'off',
}: {
  label: ReactNode
  value: string
  onChange: (value: string) => void
  placeholder?: string
  type?: HTMLInputTypeAttribute
  inputMode?: 'text' | 'numeric' | 'decimal' | 'email' | 'url' | 'tel'
  mono?: boolean
  /** 密码类：默认遮住，右侧一个显隐按钮 */
  secret?: boolean
  suffix?: ReactNode
  error?: string | null
  disabled?: boolean
  maxLength?: number
  autoComplete?: string
}) {
  const t = useT()
  const id = useId()
  const [visible, setVisible] = useState(false)
  return (
    <div className="group/row relative pl-4 max-sm:pl-3">
      <div className="flex min-h-[52px] items-center gap-3 pr-4 max-sm:pr-3">
        <label htmlFor={id} className={cn('w-[112px] shrink-0 text-body max-sm:w-[96px]', error ? 'text-danger-text' : 'text-text', disabled && 'opacity-50')}>
          {label}
        </label>
        <input
          id={id}
          type={secret && !visible ? 'password' : type === 'password' ? 'text' : type}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          inputMode={inputMode}
          disabled={disabled}
          maxLength={maxLength}
          autoComplete={autoComplete}
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          aria-invalid={error ? true : undefined}
          className={cn(
            'h-[52px] min-w-0 flex-1 bg-transparent text-right text-body text-text outline-none placeholder:text-text-4 disabled:opacity-50',
            mono && 'num',
          )}
        />
        {suffix && <span className="shrink-0 text-subhead text-text-3">{suffix}</span>}
        {secret && (
          <button
            type="button"
            tabIndex={-1}
            aria-label={visible ? t.common.hide : t.common.show}
            onClick={() => setVisible((v) => !v)}
            className="-mr-1.5 grid size-8 shrink-0 place-items-center rounded-full text-text-3 transition-colors hover:bg-hover hover:text-text"
          >
            {visible ? <EyeSlash className="size-[18px]" /> : <Eye className="size-[18px]" />}
          </button>
        )}
      </div>
      {error && (
        <p role="alert" className="-mt-1.5 pr-4 pb-2.5 text-right text-footnote text-danger-text">
          {error}
        </p>
      )}
      <span aria-hidden className="absolute right-0 bottom-0 left-4 h-px bg-line group-last/row:hidden max-sm:left-3" />
    </div>
  )
}

/** 开关行：标题 + 一句说明 + 右侧开关；开关即时生效，执行中转圈 */
export function SwitchRow({
  title,
  subtitle,
  checked,
  onCheckedChange,
  loading,
  disabled,
}: {
  title: ReactNode
  subtitle?: ReactNode
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  loading?: boolean
  disabled?: boolean
}) {
  // 不可用时整行变淡（和 iOS 一致）；开关自己就不再叠一层透明度
  return (
    <ListRow
      title={title}
      subtitle={subtitle}
      disabled={disabled}
      trailing={
        <Switch
          checked={checked}
          onCheckedChange={onCheckedChange}
          loading={loading}
          disabled={disabled}
          className={disabled ? 'disabled:opacity-100' : undefined}
          aria-label={typeof title === 'string' ? title : undefined}
        />
      }
    />
  )
}

/** 只读值行：标题在左、值在右（可复制的标识串用等宽数字） */
export function ValueRow({ title, value, mono = false }: { title: ReactNode; value: ReactNode; mono?: boolean }) {
  return <ListRow title={title} trailing={<span className={cn('text-text-2', mono && 'num')}>{value ?? '—'}</span>} />
}

/**
 * 分组下方的「还原 / 保存」：有改动才出现（展开动画），保存中转圈。
 * 每组表单各自保存，改了哪组就在哪组旁边确认，不用滚到页面底部找按钮。
 */
export function SaveActions({
  dirty,
  saving,
  onSave,
  onRevert,
  saveLabel,
  disabled,
}: {
  dirty: boolean
  saving?: boolean
  onSave: () => void
  onRevert?: () => void
  saveLabel?: ReactNode
  disabled?: boolean
}) {
  const t = useT()
  return (
    <AnimatePresence initial={false}>
      {dirty && (
        <motion.div {...collapse} className="overflow-hidden">
          <div className="flex justify-end gap-2 pt-3 max-sm:[&>*]:flex-1">
            {onRevert && (
              <Button variant="secondary" disabled={saving} onClick={onRevert}>
                {t.radio.revert}
              </Button>
            )}
            <Button variant="primary" loading={saving} disabled={disabled} onClick={onSave}>
              {saveLabel ?? t.common.save}
            </Button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
