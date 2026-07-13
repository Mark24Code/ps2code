import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest'
import { mkdtempSync, rmSync, existsSync, rmSync as rm } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

// 用临时目录冒充 HOME,隔离真实 ~/.ps2code(与 config.test.ts 同法)
const tmpHome = mkdtempSync(join(tmpdir(), 'ps2code-detect-'))
vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('os')>()
  return { ...actual, homedir: () => tmpHome }
})

import type { PhotoshopBridge } from '../electron/services/photoshop'

// mock 之后再导入被测模块
const { detectAndPersistPsPath, setBridgeForTest } = await import(
  '../electron/services/photoshop'
)
const { getConfig, saveConfig, configFilePath } = await import('../electron/services/config')

type Info = { app: string; version?: string; path?: string } | null

// 可控 detect 结果的假 Bridge
function fakeBridge(info: Info): PhotoshopBridge {
  return {
    async detect() {
      return info
    },
    async runJsx() {
      return ''
    },
    async runJsxFile() {
      return ''
    }
  }
}

beforeEach(() => {
  // 清空 config 文件与内存缓存(saveConfig 会重建)
  const f = configFilePath()
  if (existsSync(f)) rm(f)
  saveConfig({ psPath: '' })
})

afterAll(() => {
  setBridgeForTest(null)
  rmSync(tmpHome, { recursive: true, force: true })
})

describe('detectAndPersistPsPath', () => {
  it('psPath 已配置时不覆盖(尊重用户手动设置)', async () => {
    saveConfig({ psPath: '/Applications/Adobe Photoshop 2099/Adobe Photoshop 2099.app' })
    setBridgeForTest(fakeBridge({ app: 'Adobe Photoshop 2024', path: '/other.app' }))
    const result = await detectAndPersistPsPath()
    expect(result).toBe('/Applications/Adobe Photoshop 2099/Adobe Photoshop 2099.app')
    expect(getConfig().psPath).toBe(
      '/Applications/Adobe Photoshop 2099/Adobe Photoshop 2099.app'
    )
  })

  it('psPath 为空时,写入检测到的路径(macOS 写 .app 全路径)', async () => {
    setBridgeForTest(
      fakeBridge({
        app: 'Adobe Photoshop 2024',
        path: '/Applications/Adobe Photoshop 2024/Adobe Photoshop 2024.app'
      })
    )
    const result = await detectAndPersistPsPath()
    // 非 win32 平台(CI/本地 mac/linux)走 info.path 分支
    if (process.platform !== 'win32') {
      expect(result).toBe('/Applications/Adobe Photoshop 2024/Adobe Photoshop 2024.app')
      expect(getConfig().psPath).toBe(
        '/Applications/Adobe Photoshop 2024/Adobe Photoshop 2024.app'
      )
    }
  })

  it('检测不到时保持空,不报错', async () => {
    setBridgeForTest(fakeBridge(null))
    const result = await detectAndPersistPsPath()
    expect(result).toBe('')
    expect(getConfig().psPath).toBe('')
  })

  it('无 path 只有 app 名时,回退写入应用名', async () => {
    setBridgeForTest(fakeBridge({ app: 'Adobe Photoshop 2024' }))
    const result = await detectAndPersistPsPath()
    expect(result).toBe('Adobe Photoshop 2024')
    expect(getConfig().psPath).toBe('Adobe Photoshop 2024')
  })
})
