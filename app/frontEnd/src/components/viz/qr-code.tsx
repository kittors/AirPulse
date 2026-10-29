import { useMemo } from 'react'
import { encode } from 'uqr'

import { cn } from '@/lib/cn'

/**
 * 二维码（本地生成，断网可用）：把模块拼成一条 SVG 路径，任意尺寸都清晰。
 * 永远黑码白底——扫码器对反色二维码的识别率差，深色主题下也不反转。
 */
export function QrCode({ value, size = 168, className }: { value: string; size?: number; className?: string }) {
  const { path, count } = useMemo(() => {
    const qr = encode(value, { ecc: 'M', border: 0 })
    let d = ''
    qr.data.forEach((row, y) =>
      row.forEach((on, x) => {
        if (on) d += `M${x} ${y}h1v1h-1z`
      }),
    )
    return { path: d, count: qr.size }
  }, [value])
  return (
    <div className={cn('inline-grid place-items-center rounded-[14px] bg-white p-3', className)}>
      <svg width={size} height={size} viewBox={`0 0 ${count} ${count}`} shapeRendering="crispEdges" role="img" aria-label="QR">
        <path d={path} fill="#000" />
      </svg>
    </div>
  )
}
