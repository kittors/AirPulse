import {
  AndroidLogo,
  AppleLogo,
  Broadcast,
  Desktop,
  DeviceMobile,
  DeviceTablet,
  Devices,
  GameController,
  Laptop,
  LinuxLogo,
  Printer,
  SecurityCamera,
  SpeakerHifi,
  Television,
  Watch,
  WindowsLogo,
  type Icon,
} from '@phosphor-icons/react'

import { useT } from '@/i18n'
import { cn } from '@/lib/cn'
import type { DeviceGuess, DeviceKind, DevicePlatform } from '@/model/device-kind'

const KIND_ICON: Record<DeviceKind, Icon> = {
  phone: DeviceMobile,
  tablet: DeviceTablet,
  laptop: Laptop,
  desktop: Desktop,
  tv: Television,
  console: GameController,
  watch: Watch,
  speaker: SpeakerHifi,
  printer: Printer,
  router: Broadcast,
  camera: SecurityCamera,
  unknown: Devices,
}

const PLATFORM_ICON: Record<DevicePlatform, Icon> = { apple: AppleLogo, android: AndroidLogo, windows: WindowsLogo, linux: LinuxLogo }

/**
 * 设备头像：圆底上是设备类型（手机 / 电脑 / 电视 / 游戏机……），认得出系统时右下角挂一枚平台小徽标，
 * 所以 iPhone 和 Mac、Windows 笔记本和 MacBook 一眼能分开。徽标用表面色描一圈，压在圆底边上不糊。
 */
export function DeviceAvatar({ guess, className }: { guess: DeviceGuess; className?: string }) {
  const t = useT()
  const Glyph = KIND_ICON[guess.kind]
  const Mark = guess.platform ? PLATFORM_ICON[guess.platform] : null
  const label = guess.platform ? `${t.hotspot.platforms[guess.platform]} ${t.hotspot.deviceKinds[guess.kind]}` : t.hotspot.deviceKinds[guess.kind]
  return (
    <span role="img" aria-label={label} title={label} className={cn('relative grid size-10 shrink-0 place-items-center rounded-full bg-[rgb(120_120_128/0.14)] text-text-2', className)}>
      <Glyph className="size-5" weight="fill" />
      {Mark && (
        <span className="absolute -right-1 -bottom-1 grid size-[18px] place-items-center rounded-full bg-raised text-text shadow-[0_0_0_2px_var(--color-surface)]">
          <Mark className="size-[11px]" weight="fill" />
        </span>
      )}
    </span>
  )
}
