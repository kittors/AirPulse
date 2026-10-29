/**
 * 给已连接设备配图标：从主机名 / MAC / 接入方式猜设备类型和平台。
 *
 * 中兴接口只给主机名、MAC 和接入方式，没有型号，只能按各系统默认主机名的习惯来认：
 * iPhone、「xxx的iPhone」（主机名里是 xxxdeiPhone）、DESKTOP-XXXXXXX（Windows 默认）、MacBook-Air、
 * android-xxxx、Redmi、MiTV、PS5、Nintendo……用户在 AirPulse 里改过的名字（如「客厅电视」）也一起参与匹配。
 * 都认不出来时：USB 接入的基本是电脑；随机 MAC（本地管理位为 1）多半是手机。
 */

export type DeviceKind = 'phone' | 'tablet' | 'laptop' | 'desktop' | 'tv' | 'console' | 'watch' | 'speaker' | 'printer' | 'router' | 'camera' | 'unknown'
export type DevicePlatform = 'apple' | 'android' | 'windows' | 'linux'

export interface DeviceGuess {
  kind: DeviceKind
  platform: DevicePlatform | null
}

interface Rule {
  test: RegExp
  kind: DeviceKind
  platform?: DevicePlatform
}

/** 名字里前后不是字母（或在开头结尾）的整词 */
const word = (w: string) => `(^|[^a-z])(${w})($|[^a-z])`

// 顺序有讲究：先认具体品牌和型号，再认泛称；平板先于手机，游戏机 / 电视 / 手表先于手机品牌
const RULES: Rule[] = [
  { test: /iphone/, kind: 'phone', platform: 'apple' },
  { test: /ipad/, kind: 'tablet', platform: 'apple' },
  { test: /apple-?tv/, kind: 'tv', platform: 'apple' },
  { test: /apple-?watch/, kind: 'watch', platform: 'apple' },
  { test: /homepod/, kind: 'speaker', platform: 'apple' },
  { test: /imac|mac-?mini|mac-?studio|mac-?pro($|[^a-z])/, kind: 'desktop', platform: 'apple' },
  // 「Kittors的Air」这类电脑名，主机名里是 kittorsdeair
  { test: new RegExp(`macbook|${word('mbp|mba|mac')}|(^|de)air$`), kind: 'laptop', platform: 'apple' },

  { test: new RegExp(`playstation|${word('ps[345]')}|xbox|nintendo|steam-?deck`), kind: 'console' },
  { test: new RegExp(`chromecast|fire-?tv|roku|bravia|hisense|skyworth|mitv|mi-?box|tv-?box|android-?tv|google-?tv|webos|tizen|${word('tv')}|电视|盒子`), kind: 'tv' },
  { test: /watch|手表|手环/, kind: 'watch' },
  { test: /echo-?dot|alexa|sonos|xiaoai|小爱|天猫精灵|speaker|音箱/, kind: 'speaker' },
  { test: /printer|epson|canon|brother|laserjet|deskjet|officejet|打印/, kind: 'printer' },
  { test: /camera|ipcam|ezviz|hikvision|imou|dahua|摄像/, kind: 'camera' },
  { test: new RegExp(`router|openwrt|immortalwrt|${word('lede')}|miwifi|tp-?link|netgear|asus-?rt|mercury|tenda|路由`), kind: 'router' },

  { test: /^laptop-[a-z0-9]{6,}$/, kind: 'laptop', platform: 'windows' },
  { test: /^desktop-[a-z0-9]{6,}$|^win-|windows/, kind: 'desktop', platform: 'windows' },
  {
    test: /surface|thinkpad|thinkbook|matebook|magicbook|redmibook|xiaomibook|legion|xiaoxin|小新|xps|vivobook|zenbook|alienware|laptop|notebook|笔记本/,
    kind: 'laptop',
    platform: 'windows',
  },

  { test: new RegExp(`matepad|mi-?pad|xiaomi-?pad|redmi-?pad|galaxy-?tab|honor-?pad|oppo-?pad|vivo-?pad|lenovo-?tab|tablet|平板|${word('pad')}`), kind: 'tablet', platform: 'android' },
  // 华为手机多半是鸿蒙，不标 Android
  { test: /huawei|nova-?\d|mate-?\d{2}|鸿蒙|harmony/, kind: 'phone' },
  {
    test: new RegExp(`android|galaxy|${word('sm-[a-z]\\d+[a-z]*')}|redmi|xiaomi|${word('mi')}|poco|honor|oppo|vivo|iqoo|oneplus|realme|meizu|pixel|nubia|motorola|nokia|samsung|手机`),
    kind: 'phone',
    platform: 'android',
  },

  { test: /raspberrypi|ubuntu|debian|fedora|archlinux|linux/, kind: 'desktop', platform: 'linux' },
  { test: new RegExp(`${word('pc|desktop')}|电脑|台式`), kind: 'desktop' },
]

/** MAC 第一个字节的「本地管理」位为 1：系统生成的随机地址（iOS / Android 默认按网络随机） */
export function isRandomMac(mac: string): boolean {
  const first = Number.parseInt(mac.trim().slice(0, 2), 16)
  return Number.isFinite(first) && (first & 0x02) !== 0
}

/** names：改过的名字、设备上报的主机名……逐个匹配（规则里有 ^ $ 锚点，不能拼成一串） */
export function guessDevice(names: readonly (string | null | undefined)[], mac: string, via: 'wifi' | 'usb'): DeviceGuess {
  const list = [...new Set(names.map((name) => (name ?? '').trim().toLowerCase()).filter(Boolean))]
  for (const rule of RULES) {
    if (list.some((name) => rule.test.test(name))) return { kind: rule.kind, platform: rule.platform ?? null }
  }
  if (via === 'usb') return { kind: 'laptop', platform: null }
  if (isRandomMac(mac)) return { kind: 'phone', platform: null }
  return { kind: 'unknown', platform: null }
}
