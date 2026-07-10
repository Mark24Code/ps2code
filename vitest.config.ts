import { resolve } from 'path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // 用轻量 stub 替换 electron,避免主进程模块在测试环境导入真实 electron
    alias: {
      electron: resolve(__dirname, 'tests/mocks/electron.ts')
    }
  },
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'shared')
    }
  }
})
