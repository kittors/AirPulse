import { Check, CircleNotch, Warning } from '@phosphor-icons/react'

import { BEARER_PREFERENCES, RISKY_PREFERENCES } from '@/api/radio'
import { ListGroup, ListRow } from '@/components/ui/card'
import { useT } from '@/i18n'
import { cn } from '@/lib/cn'

import { useNetMode } from './netMode'

/**
 * 选网模式：iOS 式单选列表（标题 + 一句说明 + 右侧对勾），比一排卡片更好读；
 * 会断网的模式说明前有个小警示，切换前先确认。点了立即打勾转圈，失败自动回到原来的选项。
 */
export function ModeList({ className }: { className?: string }) {
  const t = useT()
  const { current, selected, pending, choose } = useNetMode()
  return (
    <ListGroup title={t.radio.modeTitle} footer={current.data === null ? t.radio.modeUnknown : t.radio.modeFooter} className={className}>
      {/* 读到当前模式之前就把整张列表排好（只是先不打勾、不能点）：数据回来只多一个对勾，版面不动 */}
      {BEARER_PREFERENCES.map((value) => {
        const active = selected === value
        const busy = pending === value
        const risky = RISKY_PREFERENCES.has(value)
        return (
          <ListRow
            key={value}
            role="radio"
            aria-checked={active}
            aria-disabled={current.isPending || undefined}
            disabled={pending != null && !busy}
            onClick={current.isPending ? undefined : () => void choose(value)}
            title={<span className={cn(active && 'font-semibold')}>{t.radio.modes[value].label}</span>}
            subtitle={
              <span className="flex items-center gap-1">
                {risky && <Warning className="size-3.5 shrink-0 text-warning" weight="fill" />}
                {t.radio.modes[value].hint}
              </span>
            }
            trailing={
              busy ? (
                <CircleNotch className="ap-spin size-[18px] text-text-3" weight="bold" />
              ) : active ? (
                <Check className="size-[18px] text-accent" weight="bold" />
              ) : null
            }
          />
        )
      })}
    </ListGroup>
  )
}
