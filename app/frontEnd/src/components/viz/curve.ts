export type Point = readonly [number, number]

/**
 * 单调三次插值（Fritsch–Carlson）：曲线平滑但不会冲过数据点，
 * 速率掉到 0 时线条不会画到基线以下，峰值也不会被「画高」。
 */
export function monotonePath(points: readonly Point[]): string {
  const n = points.length
  if (n === 0) return ''
  if (n === 1) return `M${points[0][0]},${points[0][1]}`
  const dx: number[] = []
  const slope: number[] = []
  for (let i = 0; i < n - 1; i += 1) {
    dx[i] = points[i + 1][0] - points[i][0]
    slope[i] = dx[i] === 0 ? 0 : (points[i + 1][1] - points[i][1]) / dx[i]
  }
  const tangent: number[] = new Array(n)
  tangent[0] = slope[0]
  tangent[n - 1] = slope[n - 2]
  for (let i = 1; i < n - 1; i += 1) {
    if (slope[i - 1] * slope[i] <= 0) {
      tangent[i] = 0
    } else {
      const w1 = 2 * dx[i] + dx[i - 1]
      const w2 = dx[i] + 2 * dx[i - 1]
      tangent[i] = (w1 + w2) / (w1 / slope[i - 1] + w2 / slope[i])
    }
  }
  let d = `M${points[0][0].toFixed(2)},${points[0][1].toFixed(2)}`
  for (let i = 0; i < n - 1; i += 1) {
    const h = dx[i] / 3
    const [x0, y0] = points[i]
    const [x1, y1] = points[i + 1]
    d +=
      `C${(x0 + h).toFixed(2)},${(y0 + tangent[i] * h).toFixed(2)} ` +
      `${(x1 - h).toFixed(2)},${(y1 - tangent[i + 1] * h).toFixed(2)} ${x1.toFixed(2)},${y1.toFixed(2)}`
  }
  return d
}

/** 在折线下方闭合成面积 */
export function areaPath(points: readonly Point[], baseline: number): string {
  if (points.length < 2) return ''
  const first = points[0]
  const last = points[points.length - 1]
  return `${monotonePath(points)}L${last[0].toFixed(2)},${baseline}L${first[0].toFixed(2)},${baseline}Z`
}
