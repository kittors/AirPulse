import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

/** 单元测试单独配置：只要路径别名，不加载开发期的设备代理 / Mock 插件 */
export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  test: { include: ['tests/**/*.test.ts'], environment: 'node' },
})
