import { advancedApi } from '@/api/advanced'
import { toast } from '@/components/ui/toast'
import { getT } from '@/i18n'

const HEAD_TAGS = new Set(['STYLE', 'LINK', 'META'])

/**
 * 「工具 → 高级 → 自定义代码」保存的 <head> 片段：和原版一样页面一加载就请求（接口免鉴权），
 * style / link / meta 克隆进 <head>，script 逐个重新创建（innerHTML 插入的脚本不会执行）。
 * 停用的插件块被包在注释里，解析时自然跳过。注入的代码出问题时，地址后加 ?safe=1 可以跳过注入。
 */
export async function injectCustomHead() {
  if (new URLSearchParams(window.location.search).has('safe')) return
  let text = ''
  try {
    text = await advancedApi.customHead()
  } catch {
    return
  }
  if (!text.trim()) return
  try {
    const doc = new DOMParser().parseFromString(`<!doctype html><html><head>${text}</head><body></body></html>`, 'text/html')
    // 解析器会把不属于 <head> 的内容挪进 <body>，脚本也可能跟着过去，两边都要看
    for (const el of [...doc.head.children, ...doc.body.querySelectorAll('script, style, link, meta')]) {
      if (el.tagName === 'SCRIPT') {
        const script = document.createElement('script')
        for (const attr of el.attributes) script.setAttribute(attr.name, attr.value)
        script.textContent = el.textContent
        script.dataset.customHead = ''
        document.head.appendChild(script)
      } else if (HEAD_TAGS.has(el.tagName)) {
        const clone = document.importNode(el, true) as Element
        clone.setAttribute('data-custom-head', '')
        document.head.appendChild(clone)
      }
    }
  } catch (error) {
    console.error('[AirPulse] 自定义代码注入失败', error)
    toast.error(getT().tools.head.injectFailed)
  }
}
