import { useRef } from 'react'

/**
 * 粘滞排序：按分数从高到低排，但记住上一次的顺序——
 * 只有下面那项比上面那项高出 margin 以上，才和它换位；新出现的项先排在最后再参与比较。
 *
 * 直接按实时信号排序的话，几个强度相近的邻区会因为 1–2 dB 的抖动每次刷新都互换，列表来回跳；
 * 粘滞之后，只有信号真的明显变强的小区才会往上走。
 */
export function useStickyOrder<T>(items: T[], key: (item: T) => string, score: (item: T) => number, margin: number): T[] {
  const order = useRef<string[]>([])
  const byKey = new Map(items.map((item) => [key(item), item]))

  // 上一次的顺序里还在的保留原位，新来的按分数排好接在后面
  const kept = order.current.filter((k) => byKey.has(k))
  const fresh = items
    .filter((item) => !kept.includes(key(item)))
    .sort((a, b) => score(b) - score(a))
    .map(key)
  const next = [...kept, ...fresh]

  // 冒泡：明显更强的才往上挪（最多挪 n 轮，保证收敛）
  for (let pass = 0; pass < next.length; pass += 1) {
    let swapped = false
    for (let i = 1; i < next.length; i += 1) {
      const above = byKey.get(next[i - 1])!
      const below = byKey.get(next[i])!
      if (score(below) > score(above) + margin) {
        ;[next[i - 1], next[i]] = [next[i], next[i - 1]]
        swapped = true
      }
    }
    if (!swapped) break
  }

  order.current = next
  return next.map((k) => byKey.get(k)!)
}
