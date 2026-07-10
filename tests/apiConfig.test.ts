import { describe, it, expect } from 'vitest'
import { resolveApiConfig, buildAgentEnv } from '../shared/apiConfig'

describe('resolveApiConfig — 设置优先', () => {
  it('设置齐全时忽略环境变量', () => {
    const cfg = resolveApiConfig(
      { apiKey: 'sk-set', apiBaseUrl: 'https://set', apiModel: 'model-set' },
      { ANTHROPIC_AUTH_TOKEN: 'env-tok', ANTHROPIC_BASE_URL: 'https://env', ANTHROPIC_MODEL: 'env-model' }
    )
    expect(cfg.authToken).toBe('sk-set')
    expect(cfg.baseUrl).toBe('https://set')
    expect(cfg.model).toBe('model-set')
  })
})

describe('resolveApiConfig — 环境变量兜底', () => {
  it('设置为空时读取 ANTHROPIC_AUTH_TOKEN / BASE_URL / MODEL', () => {
    const cfg = resolveApiConfig(
      {},
      {
        ANTHROPIC_AUTH_TOKEN: 'ds-token',
        ANTHROPIC_BASE_URL: 'https://api.deepseek.com/anthropic',
        ANTHROPIC_MODEL: 'deepseek-v4-pro'
      }
    )
    expect(cfg.authToken).toBe('ds-token')
    expect(cfg.baseUrl).toBe('https://api.deepseek.com/anthropic')
    expect(cfg.model).toBe('deepseek-v4-pro')
    expect(cfg.source).toBe('env')
  })

  it('ANTHROPIC_API_KEY 作为 token 的备选', () => {
    const cfg = resolveApiConfig({}, { ANTHROPIC_API_KEY: 'legacy-key' })
    expect(cfg.authToken).toBe('legacy-key')
  })

  it('都为空时无 token,model 回退默认', () => {
    const cfg = resolveApiConfig({}, {})
    expect(cfg.authToken).toBe('')
    expect(cfg.model).toBe('claude-sonnet-4-5')
    expect(cfg.source).toBe('none')
  })

  it('整组切换:配了 key 但地址栏空,不借用 env 的地址(用官方默认)', () => {
    const cfg = resolveApiConfig(
      { apiKey: 'sk-set' },
      { ANTHROPIC_BASE_URL: 'https://env', ANTHROPIC_MODEL: 'env-model' }
    )
    expect(cfg.authToken).toBe('sk-set')
    expect(cfg.baseUrl).toBe('') // 不混用 env 的地址
    expect(cfg.model).toBe('claude-sonnet-4-5') // 不混用 env 的模型
    expect(cfg.source).toBe('settings')
  })
})

describe('buildAgentEnv', () => {
  it('同时写入 API_KEY 与 AUTH_TOKEN,兼容两种读取', () => {
    const env = buildAgentEnv(
      { authToken: 't', baseUrl: 'https://b', model: 'm', source: 'env' },
      {}
    )
    expect(env.ANTHROPIC_API_KEY).toBe('t')
    expect(env.ANTHROPIC_AUTH_TOKEN).toBe('t')
    expect(env.ANTHROPIC_BASE_URL).toBe('https://b')
    expect(env.ANTHROPIC_MODEL).toBe('m')
  })

  it('无 baseUrl 时不写入(用官方默认)', () => {
    const env = buildAgentEnv({ authToken: 't', baseUrl: '', model: 'm', source: 'env' }, {})
    expect(env.ANTHROPIC_BASE_URL).toBeUndefined()
  })

  it('清除 baseEnv 里的 ANTHROPIC_* 残留,保留其它变量', () => {
    const env = buildAgentEnv(
      { authToken: 't', baseUrl: '', model: 'm', source: 'settings' },
      {
        PATH: '/usr/bin',
        ANTHROPIC_BASE_URL: 'https://leak',
        ANTHROPIC_DEFAULT_OPUS_MODEL: 'leak-opus',
        ANTHROPIC_AUTH_TOKEN: 'leak-tok'
      }
    )
    expect(env.PATH).toBe('/usr/bin')
    expect(env.ANTHROPIC_BASE_URL).toBeUndefined() // 残留被清除,没有 cfg.baseUrl 也不写入
    expect(env.ANTHROPIC_DEFAULT_OPUS_MODEL).toBeUndefined()
    expect(env.ANTHROPIC_AUTH_TOKEN).toBe('t') // 用当前 token 覆盖
  })
})
