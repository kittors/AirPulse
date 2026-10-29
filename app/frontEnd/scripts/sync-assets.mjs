#!/usr/bin/env node
/**
 * 把 dist/ 同步进 Android 的 app/src/main/assets/（npm run build 的最后一步，Gradle 的 npmBuild 也走这里）。
 *
 * assets/ 根目录同时放着后端运行必需的 shell/（adb、sendat、ttyd、socat……）和 certs/，
 * 所以这里绝不整目录清空，只删两类文件：
 *   1. 上一次由本脚本写进去的文件（清单记在 assets/.airpulse-web.json）；
 *   2. 原版 UFI-TOOLS 前端留下的已知文件（旧 build.js 会把整个 public/ 复制过来）。
 * 然后把新产物复制进去，并写入新清单。
 *
 * 只用 Node 20 自带的 fs API（CI 跑在 Node 20 上）。
 */
import { cpSync, existsSync, readdirSync, readFileSync, rmSync, rmdirSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const distDir = path.resolve(here, '../dist')
const assetsDir = path.resolve(here, '../../src/main/assets')
const MANIFEST = '.airpulse-web.json'

/** 后端的地盘：无论清单里写了什么，都不许碰 */
const PROTECTED = new Set(['shell', 'certs'])

/** 原版 UFI-TOOLS 前端遗留物（robots.txt 是通用禁爬规则、不含品牌，保留不动） */
const LEGACY = [
  'index.html',
  'manifest.json',
  'service-worker.js',
  'favicon.webp',
  'dictionary.json',
  'script',
  'script_orignal',
  'style',
  'lang',
  'img',
  'icons',
  'node_modules',
  'package.json',
  'package-lock.json',
  'dev-server.js',
]

function fail(message) {
  console.error(`\n✖ sync-assets：${message}\n`)
  process.exit(1)
}

/** 相对路径必须落在 assets/ 内、且不能指向受保护目录 */
function resolveSafe(rel) {
  const normalized = path.normalize(rel)
  if (!normalized || normalized === '.' || path.isAbsolute(normalized) || normalized.startsWith('..')) {
    fail(`拒绝处理越界路径：${rel}`)
  }
  const top = normalized.split(path.sep)[0]
  if (PROTECTED.has(top)) fail(`拒绝改动受保护目录：${rel}`)
  return path.join(assetsDir, normalized)
}

/** 列出目录下所有文件的相对路径（posix 分隔符，写进清单跨平台一致） */
function listFiles(root, dir = root) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) return listFiles(root, full)
    return [path.relative(root, full).split(path.sep).join('/')]
  })
}

/** 删掉文件后，自下而上清理因此变空的目录（不越过 assets/ 根） */
function pruneEmptyDirs(start) {
  let dir = start
  while (dir.startsWith(assetsDir + path.sep) && existsSync(dir) && readdirSync(dir).length === 0) {
    rmdirSync(dir)
    dir = path.dirname(dir)
  }
}

if (!existsSync(path.join(distDir, 'index.html'))) fail('dist/index.html 不存在，请先执行 vite build')
if (!existsSync(assetsDir)) fail(`找不到 Android assets 目录：${assetsDir}`)
for (const name of PROTECTED) {
  if (!existsSync(path.join(assetsDir, name))) fail(`assets/${name} 不存在——后端运行依赖它，请检查仓库是否完整`)
}

const produced = listFiles(distDir)
for (const rel of produced) {
  if (PROTECTED.has(rel.split('/')[0]) || rel === MANIFEST) fail(`构建产物与保留路径冲突：${rel}`)
}

let removed = 0

// 1. 上一次同步写入的文件
const manifestPath = path.join(assetsDir, MANIFEST)
if (existsSync(manifestPath)) {
  let previous = []
  try {
    previous = JSON.parse(readFileSync(manifestPath, 'utf8')).files ?? []
  } catch {
    fail(`${MANIFEST} 已损坏，请检查后手动删除再重试`)
  }
  for (const rel of previous) {
    const target = resolveSafe(rel)
    if (!existsSync(target)) continue
    rmSync(target, { force: true })
    removed += 1
    pruneEmptyDirs(path.dirname(target))
  }
}

// 2. 原版前端遗留物
for (const rel of LEGACY) {
  const target = resolveSafe(rel)
  if (!existsSync(target)) continue
  const count = statSync(target).isDirectory() ? listFiles(target).length : 1
  rmSync(target, { recursive: true, force: true })
  removed += count
}

// 3. 复制新产物并记录清单
for (const rel of produced) {
  cpSync(path.join(distDir, rel), resolveSafe(rel), { force: true })
}
writeFileSync(manifestPath, `${JSON.stringify({ generatedBy: 'app/frontEnd/scripts/sync-assets.mjs', files: produced }, null, 2)}\n`)

const totalBytes = produced.reduce((sum, rel) => sum + statSync(path.join(distDir, rel)).size, 0)
console.log(
  `\n✔ 已同步 ${produced.length} 个文件（${(totalBytes / 1024).toFixed(1)} kB）到 ${path.relative(process.cwd(), assetsDir) || assetsDir}` +
    `\n  清理旧文件 ${removed} 个；shell/、certs/ 未改动\n`,
)
