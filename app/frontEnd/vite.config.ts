import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

import { airpulseDevApi } from './mock/plugin'

/**
 * 本地开发与预览（npm run dev / npm run preview）：
 * - 默认把 /api 代理到真机 http://192.168.0.1:2333；探测不到设备时自动回退到内置 Mock（mock/），
 *   界面顶栏会出现「模拟数据」徽章；
 * - AIRPULSE_DEVICE=http://<ip>:2333 改代理目标；npm run dev:mock（或 AIRPULSE_MOCK=1）强制只用 Mock。
 *
 * 生产构建（npm run build）：
 * - 先输出到独立的 dist/（这里可以放心清空），再由 scripts/sync-assets.mjs 同步进 Android assets/。
 *   绝不能把 outDir 指向 assets/ 并清空它——那里还放着后端运行必需的 shell/ 与 certs/。
 */
export default defineConfig(({ mode }) => ({
  // 页面只从 /index.html 进入（hash 路由），资源用相对地址最稳
  base: './',
  plugins: [react(), tailwindcss(), airpulseDevApi({ forceMock: mode === 'mock' })],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    // 不用默认的 assets/，免得同步进 Android 后变成 assets/assets/
    assetsDir: 'static',
    // 与 Tailwind v4 的浏览器下限一致（@property、color-mix、oklch 都要用到）
    target: ['es2022', 'chrome111', 'edge111', 'firefox128', 'safari16.4'],
    cssTarget: ['chrome111', 'edge111', 'firefox128', 'safari16.4'],
    sourcemap: false,
    modulePreload: { polyfill: false },
    // 断网也要能打开：字体、图标全部本地打包，小文件直接内联
    assetsInlineLimit: 4096,
    chunkSizeWarningLimit: 800,
  },
  server: { port: 5173 },
  preview: { port: 4173 },
}))
