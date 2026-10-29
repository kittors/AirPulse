import { hmac } from '@noble/hashes/hmac.js'
import { md5 } from '@noble/hashes/legacy.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js'

/**
 * 请求签名与口令哈希。
 *
 * 设备经 http://192.168.0.1:2333 访问时不是浏览器的「安全上下文」，crypto.subtle 不可用
 * （它本来也不支持 MD5），所以全部用纯 JS 实现（@noble/hashes，随产物本地打包）。
 * 每个函数都和原版 UFI-TOOLS 的实现做过逐值比对，见 tests/crypto.test.ts。
 */

const SIGN_SECRET = 'minikano_kOyXz0Ciz4V7wR0IeKmJFYFQ20jd'

/** SHA-256，小写十六进制：用于 `authorization` 请求头（= SHA256(访问口令)） */
export function sha256Hex(text: string): string {
  return bytesToHex(sha256(utf8ToBytes(text)))
}

/**
 * SHA-256，大写十六进制：中兴官方后台的登录密码与 AD 防篡改签名都用它。
 * 原版沿用的是官方后台自带的 SHA256 实现，输出大写；中间值的大小写会参与下一轮哈希，必须一致。
 */
export function sha256HexUpper(text: string): string {
  return sha256Hex(text).toUpperCase()
}

/**
 * kano-sign = SHA256( SHA256(hmac[0..8)) ‖ SHA256(hmac[8..16)) )，
 * 其中 hmac = HMAC-MD5(key, "minikano" + 方法 + 路径(不含 query) + 毫秒时间戳)。
 */
export function kanoSign(method: string, path: string, timestamp: number): string {
  const mac = hmac(md5, utf8ToBytes(SIGN_SECRET), utf8ToBytes(`minikano${method.toUpperCase()}${path}${timestamp}`))
  const joined = new Uint8Array(64)
  joined.set(sha256(mac.subarray(0, 8)), 0)
  joined.set(sha256(mac.subarray(8, 16)), 32)
  return bytesToHex(sha256(joined))
}

/** 官方后台密码的本地存储形式：SHA256(明文) 大写——登录只需要它，不必保存明文 */
export function adminPasswordDigest(password: string): string {
  return sha256HexUpper(password)
}

/** 官方后台 LOGIN 的 password 参数：SHA256( SHA256(明文) + LD ) */
export function loginPasswordHash(passwordDigest: string, ld: string): string {
  return sha256HexUpper(passwordDigest + ld)
}

/** 官方后台写操作的 AD 参数：SHA256( SHA256(wa_inner_version + cr_version) + RD ) */
export function antiTamperDigest(waInnerVersion: string, crVersion: string, rd: string): string {
  return sha256HexUpper(sha256HexUpper(waInnerVersion + crVersion) + rd)
}

/**
 * 短信正文编码（原版 gsmEncode）：逐个 UTF-16 码元转 4 位十六进制。
 * 中文、emoji（代理对拆成两个码元）都按设备期望的 UCS-2 十六进制提交。
 */
export function encodeSmsBody(text: string): string {
  let out = ''
  for (let i = 0; i < text.length; i += 1) out += text.charCodeAt(i).toString(16).padStart(4, '0')
  return out
}
