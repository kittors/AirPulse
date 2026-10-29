/**
 * 自定义注入（/api/get_custom_head 的 text）：兼容原版「插件」块格式，不破坏用户已有的数据。
 *
 *   <!-- [KANO_PLUGIN_START] 名称 -->
 *   内容
 *   <!-- [KANO_PLUGIN_END] 名称 -->
 *
 * 块之间空 4 行；停用的块把内容整体包成 <!-- [kano_disabled] … [kano_disabled] --> 注释。
 * 块之外的内容（用户直接写的代码）原样保留在最前面。见 docs/legacy-tools.md §9.8。
 */

export interface PluginBlock {
  name: string
  /** 不含停用包裹的内容 */
  content: string
  enabled: boolean
}

export interface CustomHead {
  /** 块之外的内容 */
  loose: string
  blocks: PluginBlock[]
}

const BLOCK = /<!--\s*\[KANO_PLUGIN_START\]\s*(.*?)\s*-->([\s\S]*?)<!--\s*\[KANO_PLUGIN_END\]\s*\1\s*-->/g
const DISABLED_START = '<!-- [kano_disabled]'
const DISABLED_END = '[kano_disabled] -->'

function unwrap(content: string): { content: string; enabled: boolean } {
  const lines = content.split('\n')
  const disabled = lines[0]?.includes('[kano_disabled]') || lines.at(-1)?.includes('[kano_disabled]')
  if (!disabled) return { content, enabled: true }
  if (lines[0]?.includes('[kano_disabled]')) lines.shift()
  if (lines.at(-1)?.includes('[kano_disabled]')) lines.pop()
  return { content: lines.join('\n'), enabled: false }
}

export function parseCustomHead(text: string): CustomHead {
  const blocks: PluginBlock[] = []
  const loose = text
    .replace(BLOCK, (_all, name: string, body: string) => {
      blocks.push({ name: name.trim(), ...unwrap(body.trim()) })
      return ''
    })
    .trim()
  return { loose, blocks }
}

export function serializeCustomHead({ loose, blocks }: CustomHead): string {
  const parts = blocks.map((block) => {
    const body = block.enabled ? block.content.trim() : `${DISABLED_START}\n${block.content.trim()}\n${DISABLED_END}`
    return `<!-- [KANO_PLUGIN_START] ${block.name} -->\n${body}\n<!-- [KANO_PLUGIN_END] ${block.name} -->`
  })
  return [loose.trim(), ...parts].filter(Boolean).join('\n\n\n\n')
}

/** 块名不能为空、不能带破坏注释的字符，也不能重名 */
export function validPluginName(name: string, taken: string[]): boolean {
  const trimmed = name.trim()
  return Boolean(trimmed) && !/-->|<!--|\n/.test(trimmed) && !taken.includes(trimmed)
}

/** 粗略统计：块里有几个 script / style / link，列表上一眼看清它做了什么 */
export function summarizeCode(content: string): { scripts: number; styles: number; links: number; bytes: number } {
  const count = (re: RegExp) => (content.match(re) ?? []).length
  return {
    scripts: count(/<script\b/gi),
    styles: count(/<style\b/gi),
    links: count(/<link\b/gi),
    bytes: new TextEncoder().encode(content).length,
  }
}
