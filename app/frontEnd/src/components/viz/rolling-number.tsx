import { useEffect, useRef, useState } from 'react'

import { cn } from '@/lib/cn'

/**
 * 逐位滚动的数字：只有变了的那一位在动，变大往上滚、变小往下滚。
 * 字符从右侧对齐（个位对个位），配合等宽字体，刷新时整串不会左右抖。
 */
export function RollingNumber({ value, className }: { value: string; className?: string }) {
  const [state, setState] = useState({ current: value, previous: value, direction: 'up' as 'up' | 'down', rev: 0 })
  const latest = useRef(state)
  latest.current = state

  useEffect(() => {
    const prev = latest.current
    if (value === prev.current) return
    const a = Number.parseFloat(prev.current)
    const b = Number.parseFloat(value)
    const direction = Number.isFinite(a) && Number.isFinite(b) && b < a ? 'down' : 'up'
    setState({ current: value, previous: prev.current, direction, rev: prev.rev + 1 })
  }, [value])

  const length = Math.max(state.current.length, state.previous.length)
  const current = state.current.padStart(length)
  const previous = state.previous.padStart(length)

  return (
    <span className={cn('inline-flex', className)}>
      <span className="sr-only">{state.current}</span>
      {Array.from({ length }, (_, index) => {
        const next = current[index]
        const prev = previous[index]
        if (next === prev || state.rev === 0) {
          return next === ' ' ? null : (
            <span key={index} className="ap-roll-slot" aria-hidden>
              <span>{next}</span>
            </span>
          )
        }
        return (
          <span key={`${index}-${state.rev}`} className="ap-roll-slot" aria-hidden>
            {next !== ' ' && <span className={`ap-roll-in-${state.direction}`}>{next}</span>}
            {prev !== ' ' && <span className={`ap-roll-out-${state.direction}`}>{prev}</span>}
          </span>
        )
      })}
    </span>
  )
}
