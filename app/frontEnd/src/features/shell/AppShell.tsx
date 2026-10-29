import { useQuery, type QueryClient } from '@tanstack/react-query'
import { DotsThreeCircle, Flask, Key, SignOut, UserCircle, WifiSlash } from '@phosphor-icons/react'
import { AnimatePresence, LayoutGroup, motion } from 'motion/react'
import { Suspense, use, useEffect, useLayoutEffect, useRef, useState, type ComponentType, type ReactNode } from 'react'

import { mockStore, reachableStore } from '@/api/client'
import { deviceApi } from '@/api/device'
import { queryClient } from '@/app/query'
import { useReadyValue } from '@/app/ready'
import { hrefOf, locationStore, navigate, ROUTES, useRoute, type RouteId } from '@/app/router'
import { directionOf, swapView, viewName } from '@/app/transition'
import { Logo } from '@/components/brand/logo'
import { CountBadge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ListGroup, ListRow } from '@/components/ui/card'
import { useConfirm } from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/feedback'
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger, Tooltip } from '@/components/ui/overlay'
import { Sheet, SheetContent } from '@/components/ui/sheet'
import { toast } from '@/components/ui/toast'
import { SignalBars } from '@/components/viz/signal-bars'
import { useTelemetry } from '@/hooks/useTelemetry'
import { useT } from '@/i18n'
import { cn } from '@/lib/cn'
import { collapse, spring } from '@/lib/motion'
import { overallQuality, qualityBars } from '@/lib/signal'
import { useStore } from '@/lib/store'
import type { Telemetry } from '@/model/telemetry'

import { signOutManually } from '../auth/session'
import { NAV, PAGE_META, type NavItem } from './nav'
import { PreferencesMenu, ThemeMenu } from './preferences'

/** 页面模块：默认导出页面组件；preload 预读首屏数据（切页前、悬停导航项时调用） */
interface PageModule {
  default: ComponentType
  preload?: (client: QueryClient, sub: string | null) => Promise<unknown>
}

const loaders: Record<RouteId, () => Promise<PageModule>> = {
  overview: () => import('../overview/OverviewPage'),
  radio: () => import('../radio/RadioPage'),
  settings: () => import('../settings/SettingsPage'),
  messages: () => import('../messages/MessagesPage'),
  hotspot: () => import('../hotspot/HotspotPage'),
  tools: () => import('../tools/ToolsPage'),
}

const modules = new Map<RouteId, Promise<PageModule>>()

/**
 * 页面代码：同一个 promise 复用，加载完在 promise 上标记 fulfilled——React 的 use() 认这个标记，
 * 换页时直接同步拿到组件，不会先挂起一帧闪出骨架。加载失败（比如断线）下次重新加载。
 */
function loadPage(route: RouteId): Promise<PageModule> {
  const cached = modules.get(route)
  if (cached) return cached
  const promise: Promise<PageModule> = loaders[route]().then(
    (page) => {
      Object.assign(promise, { status: 'fulfilled', value: page })
      return page
    },
    (error: unknown) => {
      modules.delete(route)
      throw error
    },
  )
  modules.set(route, promise)
  return promise
}

/** 加载页面代码并预读首屏数据；数据已在缓存里且新鲜时不会重复请求 */
export function preloadPage(route: RouteId, sub: string | null = null): Promise<unknown> {
  return loadPage(route).then((page) => page.preload?.(queryClient, sub))
}

/** 导航顺序：决定切页过渡往哪边走（往后从右边进，往回从左边进） */
const ORDER: RouteId[] = NAV.map((item) => item.id)

/** 导航项：鼠标停留一小会儿（或手指按下）就开始预读，点下去时页面多半已经准备好 */
const hoverTimers = new Map<RouteId, number>()
function preloadHandlers(route: RouteId) {
  return {
    onPointerEnter: (event: { pointerType: string }) => {
      if (event.pointerType !== 'mouse') return
      window.clearTimeout(hoverTimers.get(route))
      hoverTimers.set(route, window.setTimeout(() => void preloadPage(route).catch(() => undefined), 120))
    },
    onPointerLeave: () => window.clearTimeout(hoverTimers.get(route)),
    onPointerDown: () => void preloadPage(route).catch(() => undefined),
  }
}

/**
 * 外壳：桌面是左侧边栏（顶部常驻一张设备状态卡，随时看得到网络与信号），
 * 手机 / 平板是 iOS 式底部标签栏。
 * 切页：导航高亮立即跟手；内容先把新页面的代码和首屏数据读好（最多等 450 ms）再原地换上，
 * 新页面一出来就是最终布局，不会先出骨架再被数据撑开、把内容推上推下。
 */
export default function AppShell() {
  const t = useT()
  const route = useRoute()
  const shown = useReadyValue(route, (next) => preloadPage(next, locationStore.get().sub), {
    commit: (update, from, to) => swapView(update, { level: 'page', direction: directionOf(ORDER, from, to) }),
  })
  // 新页面换上之后、浏览器绘制之前回到顶部（首次进入不动，保留浏览器的滚动恢复）
  const firstPaint = useRef(true)
  useLayoutEffect(() => {
    if (firstPaint.current) {
      firstPaint.current = false
      return
    }
    window.scrollTo(0, 0)
  }, [shown])
  const { data: telemetry } = useTelemetry()
  const reachable = useStore(reachableStore)

  // 标签栏高度给通知浮层让位；空闲时预取其它页面，切页不卡在加载态
  useEffect(() => {
    document.documentElement.classList.add('ap-has-tabbar')
    const idle = window.setTimeout(() => ROUTES.forEach((id) => void loadPage(id).catch(() => undefined)), 1200)
    return () => {
      document.documentElement.classList.remove('ap-has-tabbar')
      window.clearTimeout(idle)
    }
  }, [])

  const wasReachable = useRef(reachable)
  useEffect(() => {
    if (!wasReachable.current && reachable) toast.success(t.shell.reconnected)
    wasReachable.current = reachable
  }, [reachable, t])

  const meta = PAGE_META[shown](t)
  useEffect(() => {
    document.title = `${meta.title} · AirPulse`
  }, [meta.title])

  return (
    <div className="min-h-dvh overflow-x-clip lg:grid lg:grid-cols-[248px_minmax(0,1fr)]">
      <Sidebar route={route} telemetry={telemetry} />
      <TopBar telemetry={telemetry} />
      <main className="min-w-0 px-10 pt-9 pb-16 max-xl:px-8 max-lg:px-4 max-lg:pt-2 max-lg:pb-[calc(var(--ap-tabbar-h,0px)+32px)]">
        <div className="mx-auto w-full max-w-[1120px]">
          <AnimatePresence initial={false}>
            {!reachable && (
              <motion.div role="status" {...collapse} className="overflow-hidden">
                <div className="mb-5 flex items-center gap-2.5 rounded-inner bg-warning-soft px-3.5 py-2.5 text-footnote text-warning-text">
                  <WifiSlash className="size-4 shrink-0" weight="bold" />
                  <span className="font-semibold">{t.shell.deviceOffline}</span>
                  <span className="min-w-0 truncate max-sm:hidden">{t.shell.deviceOfflineHint}</span>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
          <div key={shown} className="ap-page" style={viewName(`ap-page-${shown}`)}>
            <Suspense fallback={<PageFallback />}>
              <Page route={shown} />
            </Suspense>
          </div>
        </div>
      </main>
      <TabBar route={route} telemetry={telemetry} />
    </div>
  )
}

function Page({ route }: { route: RouteId }) {
  const { default: Component } = use(loadPage(route))
  return <Component />
}

function PageFallback() {
  return (
    <div className="flex flex-col gap-4">
      <Skeleton className="mb-3 h-9 w-48" />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Skeleton className="h-64 rounded-card lg:col-span-2" />
        <Skeleton className="h-64 rounded-card" />
      </div>
    </div>
  )
}

/* —— 每个导航项右侧的角标：短信未读（红）、热点在线设备数（灰） —— */

function navCount(id: RouteId, telemetry: Telemetry | undefined): { count: number; tone: 'alert' | 'neutral' } | null {
  if (id === 'messages') return { count: telemetry?.smsUnread ?? 0, tone: 'alert' }
  if (id === 'hotspot') return { count: telemetry?.wifiClients ?? 0, tone: 'neutral' }
  return null
}

/* —— 桌面：侧边栏 —— */

function Sidebar({ route, telemetry }: { route: RouteId; telemetry: Telemetry | undefined }) {
  const t = useT()
  const main = NAV.filter((item) => item.id !== 'settings')
  const settings = NAV.find((item) => item.id === 'settings')!
  return (
    <aside className="sticky top-0 flex h-dvh flex-col overflow-y-auto px-4 pt-5 pb-4 max-lg:hidden">
      <a href={hrefOf('overview')} className="flex h-9 items-center gap-2.5 rounded-[10px] px-2" aria-label="AirPulse">
        <Logo size={26} />
        <span className="text-[16px] font-semibold tracking-[-0.015em] text-text">AirPulse</span>
      </a>

      <DeviceCard telemetry={telemetry} className="mt-5" />

      <LayoutGroup id="sidebar">
        <nav aria-label={t.nav.primary} className="mt-5 flex flex-col gap-0.5">
          {main.map((item) => (
            <SidebarLink key={item.id} item={item} active={item.id === route} badge={navCount(item.id, telemetry)} />
          ))}
        </nav>
        <div className="mt-auto flex flex-col gap-3 pt-6">
          <SidebarNotices />
          <div className="flex items-center gap-1">
            <div className="min-w-0 flex-1">
              <SidebarLink item={settings} active={route === 'settings'} badge={null} />
            </div>
            <ThemeMenu className="text-text-3" />
          </div>
        </div>
      </LayoutGroup>
    </aside>
  )
}

function SidebarLink({
  item,
  active,
  badge,
}: {
  item: NavItem
  active: boolean
  badge: { count: number; tone: 'alert' | 'neutral' } | null
}) {
  const t = useT()
  const Icon = item.icon
  return (
    <a
      href={hrefOf(item.id)}
      aria-current={active ? 'page' : undefined}
      {...preloadHandlers(item.id)}
      className={cn(
        'group relative flex h-9 items-center gap-2.5 rounded-[10px] px-2.5 text-[14px] font-medium',
        'transition-colors duration-150',
        active ? 'text-text' : 'text-text-2 hover:bg-hover hover:text-text',
      )}
    >
      {active && (
        <motion.span
          layoutId="sidebar-active"
          transition={spring.snappy}
          className="absolute inset-0 rounded-[10px] bg-surface shadow-card dark:bg-[#2c2c2e]"
          aria-hidden
        />
      )}
      <Icon className={cn('relative size-[18px]', active ? 'text-accent' : 'text-text-3 group-hover:text-text-2')} weight={active ? 'fill' : 'regular'} />
      <span className="relative min-w-0 flex-1 truncate">{item.label(t)}</span>
      {badge && <CountBadge count={badge.count} tone={badge.tone} className="relative" />}
    </a>
  )
}

/** 侧边栏顶部的设备状态卡：型号 · 联网状态，运营商 · 制式 · 信号格，点一下回总览 */
function DeviceCard({ telemetry, className }: { telemetry: Telemetry | undefined; className?: string }) {
  const t = useT()
  const reachable = useStore(reachableStore)
  const quality = telemetry ? overallQuality(telemetry.primary?.rsrp ?? null, telemetry.primary?.sinr ?? null) : 'none'
  const connected = reachable && telemetry?.dataState === 'connected'
  return (
    <a
      href={hrefOf('overview')}
      className={cn('ap-press ap-press-soft block rounded-[14px] bg-surface px-3.5 py-3 shadow-card', className)}
    >
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-[14px] font-semibold text-text">{telemetry?.device.model ?? 'AirPulse'}</span>
        <span className={cn('flex items-center gap-1.5 text-caption', connected ? 'text-success-text' : 'text-text-3')}>
          <span
            className={cn('ap-live-dot size-1.5', !reachable ? 'bg-danger' : connected ? 'bg-success' : 'bg-text-4')}
            data-breathing={connected || undefined}
          />
          {!reachable ? t.network.offline : t.network.data[telemetry?.dataState ?? 'unknown']}
        </span>
      </div>
      <div className="mt-1 flex items-center gap-2 text-footnote text-text-2">
        <span className="min-w-0 flex-1 truncate">
          {telemetry ? [telemetry.carrier ? t.network.carriers[telemetry.carrier] : telemetry.provider, t.network.modes[telemetry.mode]].filter(Boolean).join(' · ') : '—'}
        </span>
        <SignalBars level={qualityBars(quality)} size={14} label={t.signal.quality[quality]} />
      </div>
    </a>
  )
}

/** 侧边栏底部的提醒：模拟数据、默认口令（各一行，点开有说明） */
function SidebarNotices() {
  const t = useT()
  const mock = useStore(mockStore)
  const weak = useQuery({ queryKey: ['weak-token'], queryFn: deviceApi.isWeakToken, staleTime: Infinity, retry: false })
  if (!mock && !weak.data?.is_weak_token) return null
  return (
    <div className="flex flex-col gap-1.5">
      {weak.data?.is_weak_token && (
        <a
          href={hrefOf('settings')}
          className="flex items-start gap-2.5 rounded-[12px] bg-warning-soft px-3 py-2.5 text-footnote text-warning-text transition-opacity hover:opacity-85"
        >
          <Key className="mt-px size-4 shrink-0" weight="bold" />
          <span>
            <span className="block font-semibold">{t.shell.weakToken}</span>
            <span className="block opacity-85">{t.shell.weakTokenAction}</span>
          </span>
        </a>
      )}
      {mock && (
        <Tooltip content={t.shell.mockHint} side="right">
          <span className="flex cursor-help items-center gap-2 px-2.5 py-1 text-caption text-text-3">
            <Flask className="size-3.5" weight="bold" />
            {t.shell.mockBadge}
          </span>
        </Tooltip>
      )}
    </div>
  )
}

/* —— 手机 / 平板：顶栏 + 底部标签栏 —— */

function TopBar({ telemetry }: { telemetry: Telemetry | undefined }) {
  const t = useT()
  const mock = useStore(mockStore)
  const confirm = useConfirm()
  const [scrolled, setScrolled] = useState(false)
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 2)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])
  const signOut = () =>
    void confirm({ title: t.shell.logout, description: t.shell.logoutConfirm, confirmText: t.shell.logout }).then(
      (ok) => ok && signOutManually(),
    )
  return (
    <header
      className={cn(
        'ap-vt-topbar sticky top-0 z-30 flex h-12 items-center gap-2 bg-bg px-4 pt-[env(safe-area-inset-top)] lg:hidden',
        'border-b transition-colors duration-200',
        scrolled ? 'border-line' : 'border-transparent',
      )}
    >
      <a href={hrefOf('overview')} className="flex min-w-0 items-center gap-2" aria-label="AirPulse">
        <Logo size={24} />
        <span className="truncate text-[15px] font-semibold tracking-[-0.01em] text-text">{telemetry?.device.model ?? 'AirPulse'}</span>
      </a>
      {mock && (
        <Tooltip content={t.shell.mockHint}>
          <span className="flex h-6 items-center gap-1 rounded-full bg-warning-soft px-2 text-caption text-warning-text">
            <Flask className="size-3" weight="bold" />
            {t.shell.mockShort}
          </span>
        </Tooltip>
      )}
      <div className="ml-auto flex items-center">
        <PreferencesMenu />
        <Menu>
          <MenuTrigger asChild>
            <Button variant="ghost" size="icon" aria-label={t.settings.account}>
              <UserCircle />
            </Button>
          </MenuTrigger>
          <MenuContent align="end">
            <MenuItem onSelect={() => navigate('settings')}>{t.nav.settings}</MenuItem>
            <MenuSeparator />
            <MenuItem icon={<SignOut />} tone="danger" onSelect={signOut}>
              {t.shell.logout}
            </MenuItem>
          </MenuContent>
        </Menu>
      </div>
    </header>
  )
}

function TabBar({ route, telemetry }: { route: RouteId; telemetry: Telemetry | undefined }) {
  const t = useT()
  const [moreOpen, setMoreOpen] = useState(false)
  const confirm = useConfirm()
  const items = NAV.filter((item) => item.primary)
  const secondary = NAV.filter((item) => !item.primary)
  const moreActive = secondary.some((item) => item.id === route)

  const tab = (active: boolean, icon: ReactNode, label: string, badge?: ReactNode) => (
    <span className={cn('flex flex-col items-center gap-[3px]', active ? 'text-accent' : 'text-text-3')}>
      <span className="relative [&_svg]:size-[25px]">
        {icon}
        {badge && <span className="absolute -top-1 left-[calc(100%-9px)] [--ap-badge-ring:var(--color-surface)]">{badge}</span>}
      </span>
      <span className="text-[10px] leading-3 font-medium">{label}</span>
    </span>
  )

  return (
    <>
      <nav
        aria-label={t.nav.primary}
        className="ap-safe-bottom ap-vt-tabbar fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface lg:hidden"
      >
        <div className="mx-auto grid h-[56px] max-w-lg grid-cols-5">
          {items.map((item) => {
            const Icon = item.icon
            const active = item.id === route
            const count = navCount(item.id, telemetry)
            return (
              <a
                key={item.id}
                href={hrefOf(item.id)}
                aria-current={active ? 'page' : undefined}
                {...preloadHandlers(item.id)}
                className="ap-press grid place-items-center"
              >
                {tab(
                  active,
                  <Icon weight={active ? 'fill' : 'regular'} />,
                  item.label(t),
                  count?.tone === 'alert' ? <CountBadge count={count.count} ring /> : undefined,
                )}
              </a>
            )
          })}
          <button type="button" onClick={() => setMoreOpen(true)} className="ap-press grid place-items-center">
            {tab(moreActive, <DotsThreeCircle weight={moreActive ? 'fill' : 'regular'} />, t.nav.more)}
          </button>
        </div>
      </nav>

      <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
        <SheetContent side="bottom" title={t.nav.more}>
          <div className="flex flex-col gap-5">
            <ListGroup>
              {secondary.map((item) => {
                const Icon = item.icon
                return (
                  <ListRow
                    key={item.id}
                    href={hrefOf(item.id)}
                    selected={item.id === route}
                    leading={<Icon className="size-[22px] text-accent" />}
                    title={item.label(t)}
                    trailing={<span className="text-text-4">›</span>}
                    onClickCapture={() => setMoreOpen(false)}
                  />
                )
              })}
            </ListGroup>
            <ListGroup>
              <ListRow
                title={<span className="text-danger-text">{t.shell.logout}</span>}
                onClick={() => {
                  setMoreOpen(false)
                  void confirm({ title: t.shell.logout, description: t.shell.logoutConfirm, confirmText: t.shell.logout }).then(
                    (ok) => ok && signOutManually(),
                  )
                }}
              />
            </ListGroup>
          </div>
        </SheetContent>
      </Sheet>
    </>
  )
}
