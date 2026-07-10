import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest'
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'fs'
import { tmpdir, homedir } from 'os'
import { join } from 'path'

// 用临时目录冒充 HOME,避免污染真实 ~/.ps2code
const tmpHome = mkdtempSync(join(tmpdir(), 'ps2code-home-'))
vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('os')>()
  return { ...actual, homedir: () => tmpHome }
})

// mock 之后再导入被测模块
const { loadConfig, getConfig, saveConfig, configFilePath } = await import(
  '../electron/services/config'
)

beforeEach(() => {
  // 清掉缓存与文件,保证每例干净
  const f = configFilePath()
  if (existsSync(f)) rmSync(f)
  // 重新加载(loadConfig 内部有缓存,但文件删了会重建默认)
})

afterAll(() => {
  rmSync(tmpHome, { recursive: true, force: true })
})

describe('文件配置 ~/.ps2code/config.json', () => {
  it('首次读取时自动创建配置文件(默认值)', () => {
    const cfg = loadConfig()
    expect(cfg.apiModel).toBeTruthy()
    expect(existsSync(configFilePath())).toBe(true)
    expect(configFilePath().includes('.ps2code')).toBe(true)
  })

  it('保存后写回文件,且合并部分更新', () => {
    saveConfig({ apiKey: 'k1', apiBaseUrl: 'http://x' })
    saveConfig({ apiModel: 'm2' })
    const cfg = getConfig()
    expect(cfg.apiKey).toBe('k1')
    expect(cfg.apiBaseUrl).toBe('http://x')
    expect(cfg.apiModel).toBe('m2')
    // 落盘内容一致
    const onDisk = JSON.parse(readFileSync(configFilePath(), 'utf8'))
    expect(onDisk.apiKey).toBe('k1')
    expect(onDisk.apiModel).toBe('m2')
  })

  it('保存时防呆:仅去除首尾空格(保留 base_url 原样含末尾斜杠)', () => {
    const cfg = saveConfig({
      apiKey: '  sk-abc  ',
      apiModel: ' claude-x \n',
      apiBaseUrl: '  https://api.example.com/anthropic/  '
    })
    expect(cfg.apiKey).toBe('sk-abc')
    expect(cfg.apiModel).toBe('claude-x')
    expect(cfg.apiBaseUrl).toBe('https://api.example.com/anthropic/')
  })

  it('homedir 指向临时目录(不污染真实 HOME)', () => {
    expect(homedir()).toBe(tmpHome)
  })
})
