import { describe, expect, it } from 'vitest'

import { DEVICE_INFO_BASE, SCENARIOS, STATUS_BASE } from '../mock/fixtures'
import { earfcnToMHz, supportedNrBandList, techOfEarfcn } from '../src/lib/bands'
import { overallQuality, qualityOf } from '../src/lib/signal'
import { parseBands, parseLimitSize, parseProcUptime, parseQos, parseTelemetry } from '../src/model/telemetry'

const statusOf = (key: keyof typeof SCENARIOS) => ({ ...STATUS_BASE, ...SCENARIOS[key].status })

describe('parseTelemetry：制式判别', () => {
  it('只有 NR 字段 → 5G SA，主小区是 NR', () => {
    const t = parseTelemetry(statusOf('sa'), DEVICE_INFO_BASE)
    expect(t.mode).toBe('SA')
    expect(t.primary?.tech).toBe('NR')
    expect(t.nr).toMatchObject({ band: 41, earfcn: 504990, pci: 113, bandwidthMHz: 100, rsrp: -88, sinr: 14, rsrq: -11 })
    expect(t.lte).toBeNull()
  })

  it('NR 与 LTE 同时有值 → 5G NSA，主小区优先 NR', () => {
    const t = parseTelemetry(statusOf('nsa'), DEVICE_INFO_BASE)
    expect(t.mode).toBe('NSA')
    expect(t.primary?.tech).toBe('NR')
    expect(t.lte).toMatchObject({ band: 3, earfcn: 1825, pci: 291, bandwidthMHz: 20 })
    expect(t.nr?.cellId).toBeNull()
  })

  it('原版截图的联通 B8 → 4G LTE，带宽 10000 kHz = 10 MHz', () => {
    const t = parseTelemetry(statusOf('lte'), DEVICE_INFO_BASE)
    expect(t.mode).toBe('LTE')
    expect(t.lte).toMatchObject({ band: 8, earfcn: 3740, pci: 143, bandwidthMHz: 10, rsrp: -85, sinr: 4, rsrq: -10, rssi: -59 })
    expect(t.carrier).toBe('cucc')
  })

  it('两组都为空 → 无服务', () => {
    const empty = Object.fromEntries(Object.entries(statusOf('sa')).map(([k, v]) => [k, /^(Z5g_|Nr_|nr_)/.test(k) ? '' : v]))
    expect(parseTelemetry({ ...empty, network_type: '' }, null).mode).toBe('NONE')
  })
})

describe('parseTelemetry：单位与怪格式', () => {
  const t = parseTelemetry(statusOf('sa'), DEVICE_INFO_BASE)

  it('温度：毫摄氏度 → 摄氏度，去掉 -thmzone 后缀', () => {
    expect(t.thermal.maxC).toBeCloseTo(39.93)
    expect(t.thermal.zones.map((z) => z.name)).toContain('soc')
  })

  it('流量：先转数字再相加，套餐上限 200_1024 = 200 GB', () => {
    expect(t.traffic.used).toBe(5368709120 + 50465865728)
    expect(t.traffic.limit).toBe(200 * 1024 ** 3)
  })

  it('CPU：缺失 cpuUsageInfo 的核视为离线；使用率字符串转数字', () => {
    expect(t.cpu.cores).toHaveLength(8)
    expect(t.cpu.cores[7]).toMatchObject({ online: false, curMHz: 768 })
    expect(t.cpu.cores[3].usage).toBeCloseTo(3.1)
  })

  it('无电池机型（battery_value 为空，后端 battery 为字符串 "null"）→ battery 为 null', () => {
    expect(t.battery).toBeNull()
  })

  it('带电池机型：电流 µA → mA，电压 µV → V', () => {
    const withBattery = parseTelemetry(statusOf('lte'), { ...DEVICE_INFO_BASE, current_now: 412000, voltage_now: 4023000 })
    expect(withBattery.battery).toEqual({ percent: 81, charging: true, currentMA: 412, voltageV: 4.023 })
  })

  it('运营商名称为空时用 IMSI 前 5 位兜底', () => {
    expect(parseTelemetry({ ...statusOf('sa'), network_provider: '', imsi: '460110000000000' }, null).carrier).toBe('ctcc')
  })

  it('标识字段为字符串 "null" 时当作无值', () => {
    expect(parseTelemetry(statusOf('sa'), { ...DEVICE_INFO_BASE, model: 'null', client_ip: 'null' }).device).toMatchObject({
      model: null,
      clientIp: null,
    })
  })
})

describe('辅助解析', () => {
  it('频段串', () => {
    expect(parseBands('41')).toEqual([41])
    expect(parseBands('n78')).toEqual([78])
    expect(parseBands('3,1')).toEqual([3, 1])
    expect(parseBands('')).toEqual([])
  })

  it('流量上限', () => {
    expect(parseLimitSize('800_1024')).toBe(800 * 1024 ** 3)
    expect(parseLimitSize('500_1')).toBe(500 * 1024 ** 2)
    expect(parseLimitSize('')).toBeNull()
  })

  it('QCI 与签约速率', () => {
    expect(parseQos('+CGEQOSRDP: 1,9,0,0,0,0,1000000,200000 OK')).toEqual({ qci: 9, downKbps: 1000000, upKbps: 200000 })
    expect(parseQos('ERROR')).toBeNull()
  })

  it('频点 → 制式与频率', () => {
    expect(techOfEarfcn(504990)).toBe('NR')
    expect(techOfEarfcn(154810)).toBe('NR')
    expect(techOfEarfcn(3740)).toBe('LTE')
    expect(earfcnToMHz(504990)).toBeCloseTo(2524.95)
    expect(earfcnToMHz(627264)).toBeCloseTo(3408.96)
    expect(earfcnToMHz(3740)).toBeCloseTo(954)
    expect(earfcnToMHz(1825)).toBeCloseTo(1867.5)
  })
})

describe('信号质量分级（三条边界与原版一致）', () => {
  it('RSRP', () => {
    expect(qualityOf('rsrp', -75)).toBe('excellent')
    expect(qualityOf('rsrp', -90)).toBe('good')
    expect(qualityOf('rsrp', -95)).toBe('fair')
    expect(qualityOf('rsrp', -101)).toBe('poor')
    expect(qualityOf('rsrp', null)).toBe('none')
  })
  it('SINR 与 RSRQ', () => {
    expect(qualityOf('sinr', 13)).toBe('good')
    expect(qualityOf('sinr', 12)).toBe('fair')
    expect(qualityOf('sinr', -1)).toBe('poor')
    expect(qualityOf('rsrq', -9)).toBe('good')
    expect(qualityOf('rsrq', -12)).toBe('fair')
    expect(qualityOf('rsrq', -13)).toBe('poor')
  })
  it('综合质量取 RSRP 与 SINR 中较差者', () => {
    expect(overallQuality(-75, 4)).toBe('fair')
    expect(overallQuality(-75, 25)).toBe('excellent')
  })
})

describe('parseProcUptime：旧版后端没有 boot_time 时从 /proc/uptime 推算', () => {
  it('取第一列开机秒数', () => {
    expect(parseProcUptime('12345.67 54321.00\n')).toBe(12345.67)
  })
  it('空输出、报错文本、0 → null', () => {
    expect(parseProcUptime('')).toBeNull()
    expect(parseProcUptime('cat: /proc/uptime: Permission denied')).toBeNull()
    expect(parseProcUptime('0.00 0.00')).toBeNull()
  })
})

describe('supportedNrBandList：基带报的 5G 支持列表', () => {
  it('F50 实测 [6,41,78,1,8,28,5] → 丢掉不存在的 n6，排序去重', () => {
    expect(supportedNrBandList([6, 41, 78, 1, 8, 28, 5, 78])).toEqual([1, 5, 8, 28, 41, 78])
  })
  it('全是无效值或为空 → null（界面用回退表）', () => {
    expect(supportedNrBandList([6, 0, -1, 'x'])).toBeNull()
    expect(supportedNrBandList(undefined)).toBeNull()
  })
})
