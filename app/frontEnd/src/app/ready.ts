import { useEffect, useRef, useState } from 'react'

/**
 * 「准备好了再换」：target 变了以后先跑 prepare（加载页面代码、预读首屏数据），
 * 完成或等满 wait 毫秒（先到为准）再把返回值换成 target。
 *
 * 切页 / 切分区用它：新页面一出来就是最终布局，不会先出骨架、数据到了再把内容推来推去；
 * 设备慢的时候最多也只多等 wait 毫秒，之后照常显示骨架。导航高亮用 target，立即响应点击。
 * commit 决定「怎么换」（比如包一层 View Transition），默认直接换。
 */
export function useReadyValue<T>(
  target: T,
  prepare: (value: T) => Promise<unknown> | void,
  { wait = 450, commit }: { wait?: number; commit?: (update: () => void, from: T, to: T) => void } = {},
): T {
  const [shown, setShown] = useState(target)
  const prepareRef = useRef(prepare)
  const commitRef = useRef(commit)
  prepareRef.current = prepare
  commitRef.current = commit

  useEffect(() => {
    if (Object.is(target, shown)) return
    let done = false
    const show = () => {
      if (done) return
      done = true
      const update = () => setShown(target)
      if (commitRef.current) commitRef.current(update, shown, target)
      else update()
    }
    const timer = window.setTimeout(show, wait)
    Promise.resolve()
      .then(() => prepareRef.current(target))
      .catch(() => undefined)
      .finally(show)
    return () => {
      done = true
      window.clearTimeout(timer)
    }
  }, [target, shown, wait])

  return shown
}
