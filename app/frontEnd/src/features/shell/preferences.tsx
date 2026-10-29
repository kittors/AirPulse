import { Desktop, Moon, Palette, Sun } from '@phosphor-icons/react'
import { LayoutGroup, motion } from 'motion/react'
import { useId, useRef } from 'react'
import { flushSync } from 'react-dom'

import { Button } from '@/components/ui/button'
import { Menu, MenuContent, MenuRadioGroup, MenuRadioItem, MenuTrigger, Popover, PopoverContent, PopoverTrigger, Tooltip } from '@/components/ui/overlay'
import { SegmentedControl } from '@/components/ui/segmented'
import { Select } from '@/components/ui/select'
import { LOCALES, useLocale, useT } from '@/i18n'
import { cn } from '@/lib/cn'
import { spring } from '@/lib/motion'
import { ACCENTS, ACCENT_SWATCH, themeStore, useTheme, type ThemeMode } from '@/lib/theme'

type ViewTransitionDocument = Document & {
  startViewTransition?: (update: () => void) => { ready: Promise<void> }
}

/**
 * 切换明暗：支持 View Transitions 的浏览器里，新主题从点击处以圆形扩散揭开；
 * 不支持或开了「减弱动态效果」时直接切换。
 */
function switchTheme(mode: ThemeMode, origin: { x: number; y: number } | null) {
  const doc = document as ViewTransitionDocument
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  if (!doc.startViewTransition || reduced) {
    themeStore.set(mode)
    return
  }
  const x = origin?.x ?? window.innerWidth / 2
  const y = origin?.y ?? 0
  const radius = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y))
  const transition = doc.startViewTransition(() => {
    flushSync(() => themeStore.set(mode))
  })
  void transition.ready.then(() => {
    document.documentElement.animate(
      { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`] },
      { duration: 560, easing: 'cubic-bezier(0.2, 0, 0, 1)', pseudoElement: '::view-transition-new(root)' },
    )
  })
}

const MODE_ICON = { system: Desktop, light: Sun, dark: Moon } as const

/**
 * 侧边栏里的主题入口：一个图标按钮（图标就是当前模式），点开是三项单选菜单。
 * 新主题从按钮处以圆形展开。
 */
export function ThemeMenu({ className }: { className?: string }) {
  const t = useT()
  const { mode } = useTheme()
  const origin = useRef<{ x: number; y: number } | null>(null)
  const Icon = MODE_ICON[mode]
  const labels = { system: t.theme.system, light: t.theme.light, dark: t.theme.dark }
  return (
    <Menu>
      <Tooltip content={`${t.theme.mode} · ${labels[mode]}`}>
        <MenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            aria-label={`${t.theme.mode}：${labels[mode]}`}
            className={className}
            onPointerDown={(event) => {
              const rect = event.currentTarget.getBoundingClientRect()
              origin.current = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
            }}
          >
            <Icon />
          </Button>
        </MenuTrigger>
      </Tooltip>
      <MenuContent align="start" side="top" className="min-w-40">
        <MenuRadioGroup value={mode} onValueChange={(next) => switchTheme(next as ThemeMode, origin.current)}>
          {(['system', 'light', 'dark'] as const).map((value) => {
            const ItemIcon = MODE_ICON[value]
            return (
              <MenuRadioItem key={value} value={value}>
                <ItemIcon />
                {labels[value]}
              </MenuRadioItem>
            )
          })}
        </MenuRadioGroup>
      </MenuContent>
    </Menu>
  )
}

/** compact：只显示图标；'responsive'：手机上只显示图标、宽屏带文字 */
export function ThemeModeControl({ fullWidth = false, compact = false }: { fullWidth?: boolean; compact?: boolean | 'responsive' }) {
  const t = useT()
  const { mode } = useTheme()
  const origin = useRef<{ x: number; y: number } | null>(null)
  const text = (label: string) => (compact === true ? null : <span className={cn(compact === 'responsive' && 'max-sm:hidden')}>{label}</span>)
  return (
    <div
      className={cn(fullWidth && 'w-full')}
      onPointerDownCapture={(event) => {
        origin.current = { x: event.clientX, y: event.clientY }
      }}
    >
      <SegmentedControl<ThemeMode>
        ariaLabel={t.theme.mode}
        value={mode}
        onChange={(next) => switchTheme(next, origin.current)}
        fullWidth={fullWidth}
        options={[
          { value: 'system', ariaLabel: t.theme.system, label: <><Desktop weight="bold" />{text(t.theme.system)}</> },
          { value: 'light', ariaLabel: t.theme.light, label: <><Sun weight="bold" />{text(t.theme.light)}</> },
          { value: 'dark', ariaLabel: t.theme.dark, label: <><Moon weight="bold" />{text(t.theme.dark)}</> },
        ]}
      />
    </div>
  )
}

/** 强调色：圆形色票，选中项外圈描一道环（环在色票之间滑动） */
export function AccentPicker() {
  const t = useT()
  const { accent, setAccent } = useTheme()
  // 设置页与外观浮层可能同时挂着两个色票组：各自一个布局组，选中环不会串到另一组里
  const group = useId()
  return (
    <LayoutGroup id={group}>
      <div role="radiogroup" aria-label={t.theme.accent} className="flex flex-wrap gap-3">
        {ACCENTS.map((value) => {
          const selected = accent === value
          return (
            <Tooltip key={value} content={t.theme.accents[value]}>
              <button
                type="button"
                role="radio"
                aria-checked={selected}
                aria-label={t.theme.accents[value]}
                onClick={() => setAccent(value)}
                className={cn(
                  'ap-press relative grid size-7 place-items-center rounded-full max-sm:size-8',
                  'shadow-[inset_0_0_0_1px_rgb(0_0_0/0.12),inset_0_1px_0_rgb(255_255_255/0.25)]',
                  // 深色下石墨色票接近底色：换成浅色描边勾出轮廓
                  'dark:shadow-[inset_0_0_0_1px_rgb(255_255_255/0.18),inset_0_1px_0_rgb(255_255_255/0.22)]',
                )}
                style={{ background: ACCENT_SWATCH[value] }}
              >
                {selected && (
                  <motion.span
                    layoutId="accent-ring"
                    transition={spring.snappy}
                    className="absolute -inset-[4px] rounded-full border-2 border-text-2"
                    aria-hidden
                  />
                )}
              </button>
            </Tooltip>
          )
        })}
      </div>
    </LayoutGroup>
  )
}

export function LanguageSelect({ className }: { className?: string }) {
  const t = useT()
  const [locale, setLocale] = useLocale()
  return (
    <Select
      ariaLabel={t.theme.language}
      value={locale}
      onValueChange={setLocale}
      options={LOCALES.map((item) => ({ value: item.value, label: item.label }))}
      className={className}
    />
  )
}

/** 顶栏 / 登录页的外观入口：主题、强调色、语言放在一个浮层里，改了立即生效 */
export function PreferencesMenu({ className }: { className?: string }) {
  const t = useT()
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={t.shell.appearance} className={className}>
          <Palette />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[320px] p-4">
        <div className="flex flex-col gap-5">
          <section className="flex flex-col gap-2.5">
            <h3 className="text-footnote font-medium text-text-2">{t.theme.mode}</h3>
            <ThemeModeControl fullWidth />
          </section>
          <section className="flex flex-col gap-3">
            <h3 className="text-footnote font-medium text-text-2">{t.theme.accent}</h3>
            <AccentPicker />
          </section>
          <section className="flex flex-col gap-2.5">
            <h3 className="text-footnote font-medium text-text-2">{t.theme.language}</h3>
            <LanguageSelect />
          </section>
        </div>
      </PopoverContent>
    </Popover>
  )
}
