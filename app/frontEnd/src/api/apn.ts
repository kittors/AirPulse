import { apnSaveForm, APN_SLOTS, parseApnState, type ApnDraft, type ApnState, type Ipv6Plan, type PdpType, type RawApnState } from '@/model/apn'

import { goformGet, goformSet } from './goform'

export * from '@/model/apn'

const CONFIG_CMDS = Array.from({ length: APN_SLOTS }, (_, i) => `APN_config${i}`)
/** 同官方后台的读法（真机只要带了 APN_config* 就回一整包，这里列出的是解析要用的那几个） */
const CMDS = [
  'apn_interface_version',
  'apn_mode',
  'm_profile_name',
  'profile_name',
  'profile_name_ui',
  'wan_apn',
  'wan_apn_ui',
  'pdp_type',
  'pdp_type_ui',
  'Current_index',
  'apn_num_preset',
  'default_APN_size',
  'apn_auto_config',
  'ppp_status',
  ...CONFIG_CMDS,
]

export const apnApi = {
  state: async (): Promise<ApnState> => parseApnState(await goformGet<RawApnState>(CMDS)),
  save: (draft: ApnDraft, slot: number) => goformSet('APN_PROC_EX', apnSaveForm(draft, slot)),
  remove: (slot: number) => goformSet('APN_PROC_EX', { index: String(slot), apn_mode: 'manual', apn_action: 'delete' }),
  setAuto: () => goformSet('APN_PROC_EX', { apn_mode: 'auto' }, { timeout: 30_000 }),
  /** 设为默认会重建数据连接；带上这条配置的 IP 类型（同官方后台），否则设备沿用之前的 */
  use: (slot: number, pdp: PdpType) =>
    goformSet('APN_PROC_EX', { apn_mode: 'manual', apn_action: 'set_default', set_default_flag: '1', pdp_type: pdp, index: String(slot) }, { timeout: 30_000 }),

  /** 执行 IPv6 开关的方案（见 model/apn planIpv6）：写完设备会重新拨号 */
  async applyIpv6(plan: Ipv6Plan) {
    switch (plan.kind) {
      case 'auto':
        return apnApi.setAuto()
      case 'save':
        await apnApi.save(plan.draft, plan.slot)
        return apnApi.use(plan.slot, plan.draft.pdp)
      case 'use':
        return apnApi.use(plan.slot, plan.draft.pdp)
      default:
        throw new Error(plan.kind)
    }
  },
}
