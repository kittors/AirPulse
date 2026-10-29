import { parseQos, parseTelemetry, type Telemetry } from '@/model/telemetry'

import { runAt } from './at'
import { api } from './client'
import { signOut } from './auth'
import { DeviceLoginError, ensureDeviceSession, goformGet } from './goform'
import { STATUS_CMDS, type BaseDeviceInfo, type GoformStatus, type VersionInfo } from './types'

export const deviceApi = {
  /** 免鉴权：登录页用它探测设备、显示型号与版本 */
  versionInfo: () => api<VersionInfo>('/version_info', { anonymous: true, timeout: 4_000 }),
  /** 免鉴权：设备是否开启了访问口令（关闭时只需设备管理密码） */
  needToken: () => api<{ need_token?: boolean }>('/need_token', { anonymous: true, timeout: 4_000 }),
  isWeakToken: () => api<{ is_weak_token?: boolean }>('/is_weak_token'),
  baseInfo: (signal?: AbortSignal) => api<BaseDeviceInfo>('/baseDeviceInfo', { signal, timeout: 8_000 }),
  status: (signal?: AbortSignal) => goformGet<GoformStatus>([...STATUS_CMDS], { signal, timeout: 6_000 }),
  /** 把设备管理密码同步给后端（定时任务自动登录官方后台要用） */
  updateAdminPassword: (password: string) =>
    api<{ result?: string }>('/update_admin_pwd', { method: 'POST', json: { password } }),
  /** 走 AT 队列：签约速率轮询与 AT 终端不会同时打到基带 */
  at: async (command: string, slot = 0, timeout = 15_000) => ({ result: await runAt(command, slot, { timeout }) }),
}

/* —— 实时状态：一次轮询 = goform 状态 + 硬件信息，两者并行 —— */

let reauthFailures = 0
let reauthing = false
let lastReauthAt = 0
/** 两次自动重登之间至少间隔 10 秒 */
const REAUTH_COOLDOWN = 10_000

/**
 * 官方后台会话过期（loginfo != ok）时在后台静默重登。
 * 一次只跑一个、两次之间有冷却；密码错误 / 设备已锁定立刻停止，其它失败累计 3 次也停止（与原版一致）——
 * 绝不能每秒重试，否则几秒内就会把设备打到「密码错误次数过多」锁定。停止后回登录页重新输入。
 */
function keepDeviceSession() {
  if (reauthing || Date.now() - lastReauthAt < REAUTH_COOLDOWN) return
  reauthing = true
  lastReauthAt = Date.now()
  ensureDeviceSession({ force: true })
    .then(
      () => (reauthFailures = 0),
      (error) => {
        reauthFailures += 1
        const fatal = error instanceof DeviceLoginError && error.reason !== 'failed'
        if (fatal || reauthFailures >= 3) {
          reauthFailures = 0
          signOut('device-session')
        }
      },
    )
    .finally(() => (reauthing = false))
}

export async function fetchTelemetry(signal?: AbortSignal): Promise<Telemetry> {
  const [status, info] = await Promise.allSettled([deviceApi.status(signal), deviceApi.baseInfo(signal)])
  if (status.status === 'rejected') throw status.reason
  const telemetry = parseTelemetry(status.value, info.status === 'fulfilled' ? info.value : null)
  if (!telemetry.sessionOk) keepDeviceSession()
  else reauthFailures = 0
  return telemetry
}

/* —— QCI 与签约速率（AT+CGEQOSRDP=1） —— */

/** 卡槽映射与原版一致：外置卡 11 → 0（F50 Pro 型号 MU3356 卡槽相反 → 1），2 → 1，12 → 0 */
export function atSlotFor(telemetry: Pick<Telemetry, 'sim' | 'device'>): number {
  const { slot, dualSim } = telemetry.sim
  if (!slot || !dualSim) return 0
  if (slot === '11') return telemetry.device.model === 'MU3356' ? 1 : 0
  if (slot === '2') return 1
  if (slot === '12') return 0
  const n = Number(slot)
  return Number.isFinite(n) ? n : 0
}

export async function fetchQos(telemetry: Pick<Telemetry, 'sim' | 'device'>) {
  const slot = atSlotFor(telemetry)
  const run = (s: number) => deviceApi.at('AT+CGEQOSRDP=1', s, 8_000).then((r) => r.result ?? '')
  let result = await run(slot).catch(() => 'ERROR')
  // 单卡机型 0 槽查不到时改查 1 槽
  if (result.includes('ERROR') && !telemetry.sim.dualSim) result = await run(1).catch(() => 'ERROR')
  return parseQos(result)
}
