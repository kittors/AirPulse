import { hashKey, type QueryClient, type QueryKey } from '@tanstack/react-query'

/**
 * 「等设备真正生效」：设备上的切换大多是异步的——接口先回成功，读回来的状态要再过一两秒（Wi-Fi 要两三秒）才变。
 * 如果写完就刷新，会先读到旧状态，界面闪回去再跳过来，这就是抖动。
 *
 * 做法：写之前把目标状态当作「补丁」登记在这个 key 上，并先叠进缓存；补丁在的时候，这个 key 的任何刷新
 * （定时、切回窗口、别的组件挂载）读回来的数据都先叠上补丁再进缓存。写完后隔一会儿直接读一次设备，
 * 读到目标状态（或超时）再撤掉补丁、用真实数据收尾。
 *
 * 要求：同一个 key 的所有 useQuery 都用 patched() 包过的读取函数（各模块导出一份共用的 query 选项）。
 */

type Patch = (data: unknown) => unknown

const patches = new Map<string, Patch[]>()

function applyPatches<T>(hash: string, data: T): T {
  return (patches.get(hash) ?? []).reduce<T>((acc, patch) => patch(acc) as T, data)
}

/** 包装读取函数：有补丁时叠上补丁再返回 */
export function patched<T>(key: QueryKey, read: () => Promise<T>): () => Promise<T> {
  const hash = hashKey(key)
  return async () => applyPatches(hash, await read())
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/**
 * 每隔 interval 读一次，直到 reached；超时返回 null。
 * 第一次读之前先等一个间隔（设备刚收到命令）；单次读取失败（切换中设备短暂无响应）不算失败，接着等。
 */
export async function waitFor<T>(
  read: () => Promise<T>,
  reached: (value: T) => boolean,
  { timeout = 20_000, interval = 1_000 }: { timeout?: number; interval?: number } = {},
): Promise<T | null> {
  const deadline = Date.now() + timeout
  for (;;) {
    await sleep(interval)
    try {
      const value = await read()
      if (reached(value)) return value
    } catch {
      // 继续等
    }
    if (Date.now() >= deadline) return null
  }
}

export interface SettleOptions<T> {
  /** 把目标状态叠到数据上（乐观显示） */
  patch: (data: T) => T
  write: () => Promise<unknown>
  /** 直接读设备，不经过补丁 */
  read: () => Promise<T>
  reached: (data: T) => boolean
  timeout?: number
  interval?: number
}

/**
 * 写入并等到生效。返回 true = 已读到目标状态；false = 超时没等到（缓存按设备的真实状态刷新）。
 * 写入本身失败照常抛错（补丁撤掉、缓存刷新回真实状态）。
 */
export async function settle<T>(queryClient: QueryClient, key: QueryKey, options: SettleOptions<T>): Promise<boolean> {
  const hash = hashKey(key)
  const patch = options.patch as Patch
  patches.set(hash, [...(patches.get(hash) ?? []), patch])
  await queryClient.cancelQueries({ queryKey: key, exact: true })
  queryClient.setQueryData<T>(key, (data) => (data === undefined ? data : options.patch(data)))
  let settled: T | null = null
  try {
    await options.write()
    settled = await waitFor(options.read, options.reached, options)
    return settled != null
  } finally {
    const rest = (patches.get(hash) ?? []).filter((item) => item !== patch)
    if (rest.length) patches.set(hash, rest)
    else patches.delete(hash)
    // 同一个 key 上可能还有别的写入在等（例如连着拨了两个开关）：它们的补丁继续叠在真实数据上
    if (settled != null) queryClient.setQueryData<T>(key, applyPatches(hash, settled))
    else void queryClient.invalidateQueries({ queryKey: key, exact: true })
  }
}

/** 这个 key 上是否有写入在等生效 */
export const isSettling = (key: QueryKey) => patches.has(hashKey(key))
