import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
import { describe, expect, it } from 'vitest'

import {
  adminPasswordDigest,
  antiTamperDigest,
  encodeSmsBody,
  kanoSign,
  loginPasswordHash,
  sha256Hex,
  sha256HexUpper,
} from '../src/api/crypto'

/**
 * 对照组直接跑原版 UFI-TOOLS 的代码（legacy-public 里的 CryptoJS 与手写 SHA256 / gsmEncode），
 * 而不是手抄期望值：新实现只要有一位和原版不同，设备就会拒绝请求。
 */
const legacy = (rel: string) => readFileSync(fileURLToPath(new URL(`../legacy-public/${rel}`, import.meta.url)), 'utf8')

const cryptoSandbox: { module: { exports: Record<string, unknown> }; exports: Record<string, unknown> } = {
  module: { exports: {} },
  exports: {},
}
cryptoSandbox.exports = cryptoSandbox.module.exports
vm.runInNewContext(legacy('script/lib/crypto.js'), cryptoSandbox)

/** 只描述本测试用到的那部分 CryptoJS API（它是 UMD，按 CommonJS 方式导出） */
interface WordArray {
  words: number[]
  sigBytes: number
  toString(encoder?: unknown): string
  concat(other: WordArray): WordArray
}
interface CryptoJSLike {
  HmacMD5(message: string, key: string): WordArray
  SHA256(message: WordArray | string): WordArray
  enc: { Hex: { parse(hex: string): WordArray } }
  lib: { WordArray: { create(words: number[], sigBytes: number): WordArray } }
}
const CryptoJS = cryptoSandbox.module.exports as unknown as CryptoJSLike

const requestsSource = legacy('script/requests.js').split('\n')
const helpers: { SHA256?: (s: string) => string; gsmEncode?: (s: string) => string } = {}
vm.runInNewContext(`${requestsSource[0]}\n${requestsSource[1]}\nout.SHA256 = SHA256; out.gsmEncode = gsmEncode`, {
  out: helpers,
})
const legacySHA256 = helpers.SHA256!
const legacyGsmEncode = helpers.gsmEncode!

/** 原版 requests.js 里的 hmacSignature，逐行照搬 */
function legacySign(method: string, path: string, t: number): string {
  const data = 'minikano' + method + path + t
  const hmacMd5 = CryptoJS.HmacMD5(data, 'minikano_kOyXz0Ciz4V7wR0IeKmJFYFQ20jd')
  const bytes = CryptoJS.enc.Hex.parse(hmacMd5.toString())
  const mid = Math.floor(bytes.sigBytes / 2)
  const part1 = CryptoJS.lib.WordArray.create(bytes.words.slice(0, mid / 4), mid)
  const part2 = CryptoJS.lib.WordArray.create(bytes.words.slice(mid / 4), mid)
  return CryptoJS.SHA256(CryptoJS.SHA256(part1).concat(CryptoJS.SHA256(part2))).toString(CryptoJS.enc.Hex)
}

const SAMPLES = ['admin', 'Admin123', '', 'p@ss w0rd!', '中文口令', '混合Mixed123！', 'a'.repeat(200)]

describe('kano-sign 请求签名', () => {
  const cases: [string, string, number][] = [
    ['GET', '/api/baseDeviceInfo', 1718438543772],
    ['POST', '/api/user', 1718438543772],
    ['GET', '/api/goform/goform_get_cmd_process', 1730000000123],
    ['POST', '/api/goform/goform_set_cmd_process', 1761000000000],
    ['GET', '/api/proxy/--https://example.com/a/b', 1761234567890],
    ['GET', '/api/AT', 1],
  ]
  it.each(cases)('%s %s 与原版一致', (method, path, t) => {
    expect(kanoSign(method, path, t)).toBe(legacySign(method, path, t))
  })
  it('方法名大小写不影响结果（服务端用大写方法）', () => {
    expect(kanoSign('get', '/api/AT', 42)).toBe(legacySign('GET', '/api/AT', 42))
  })
})

describe('SHA-256 口令哈希', () => {
  it.each(SAMPLES)('大写十六进制与原版手写实现一致：%s', (text) => {
    expect(sha256HexUpper(text)).toBe(legacySHA256(text))
  })
  it.each(SAMPLES)('authorization 头 = 原版 SHA256(口令).toLowerCase()：%s', (text) => {
    expect(sha256Hex(text)).toBe(legacySHA256(text).toLowerCase())
  })
})

describe('官方后台登录与 AD 签名', () => {
  it('登录密码哈希 = SHA256(SHA256(明文) + LD)', () => {
    const ld = 'A1B2C3D4E5F6'
    for (const password of SAMPLES) {
      expect(loginPasswordHash(adminPasswordDigest(password), ld)).toBe(legacySHA256(legacySHA256(password) + ld))
    }
  })
  it('AD = SHA256(SHA256(wa_inner_version + cr_version) + RD)', () => {
    const wa = 'BD_ZTE_U30AirV1.0.0B14'
    const cr = 'U30Air_SSV1.0.0B14'
    const rd = '6a8d0e2f9b1c'
    expect(antiTamperDigest(wa, cr, rd)).toBe(legacySHA256(legacySHA256(wa + cr) + rd))
  })
})

describe('短信正文编码', () => {
  it.each(['hello', '你好，世界', 'emoji 😀 ok', 'Line1\nLine2', ''])('与原版 gsmEncode 一致：%s', (text) => {
    expect(encodeSmsBody(text)).toBe(legacyGsmEncode(text))
  })
})
