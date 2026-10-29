/**
 * 复制到剪贴板。经 http://192.168.0.1:2333 访问时不是安全上下文，navigator.clipboard 不存在，
 * 必须降级到隐藏 textarea + execCommand('copy')（iOS Safari 需要先选中范围）。
 */
export async function copyText(text: string): Promise<boolean> {
  if (window.isSecureContext && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {
      /* 权限被拒：继续走降级方案 */
    }
  }
  const area = document.createElement('textarea')
  area.value = text
  area.setAttribute('readonly', '')
  area.style.position = 'fixed'
  area.style.top = '-1000px'
  area.style.opacity = '0'
  document.body.appendChild(area)
  const selection = document.getSelection()
  const previous = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null
  area.select()
  area.setSelectionRange(0, text.length)
  let ok = false
  try {
    ok = document.execCommand('copy')
  } catch {
    ok = false
  }
  document.body.removeChild(area)
  if (previous && selection) {
    selection.removeAllRanges()
    selection.addRange(previous)
  }
  return ok
}
