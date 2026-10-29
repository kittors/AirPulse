import { clsx, type ClassValue } from 'clsx'
import { extendTailwindMerge } from 'tailwind-merge'

/**
 * 让 tailwind-merge 认识我们自定义的 token。
 *
 * 不告诉它的话，`text-headline`（字号）和 `text-text-2`（颜色）都以 text- 开头，
 * 会被当成同一组互相覆盖——写在后面的把前面的吃掉，字号或颜色就悄悄丢了。
 */
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      text: ['display', 'title', 'metric', 'headline', 'body', 'subhead', 'footnote', 'caption', 'caption2'],
      radius: ['card', 'inner', 'control', 'chip'],
      shadow: ['card', 'raised', 'overlay', 'thumb'],
      ease: ['out', 'in-out', 'exit', 'spring', 'standard', 'emphasized'],
    },
  },
})

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
