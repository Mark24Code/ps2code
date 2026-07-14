import { describe, it, expect } from 'vitest'
import { resolveApiConfig, providerCheckEndpoint } from '../shared/apiConfig'

describe('resolveApiConfig — 设置优先', () => {
  it('设置齐全时忽略环境变量', () => {
    const cfg = resolveApiConfig(
      { apiProvider: 'deepseek', apiKey: 'sk-set', apiModel: 'deepseek-v4-pro' },
      { DEEPSEEK_API_KEY: 'env-key' }
    )
    expect(cfg.provider).toBe('deepseek')
    expect(cfg.apiKey).toBe('sk-set')
    expect(cfg.model).toBe('deepseek-v4-pro')
    expect(cfg.source).toBe('settings')
  })

  it('配了 key 但模型栏空 → 用默认模型,不借用环境变量', () => {
    const cfg = resolveApiConfig(
      { apiKey: 'sk-set' },
      { DEEPSEEK_API_KEY: 'env-key' }
    )
    expect(cfg.apiKey).toBe('sk-set')
    expect(cfg.provider).toBe('deepseek') // 默认 provider
    expect(cfg.model).toBe('deepseek-v4-flash') // 默认模型
    expect(cfg.source).toBe('settings')
  })
})

describe('resolveApiConfig — 环境变量兜底', () => {
  it('未配置时按 provider 读对应环境变量(默认 DeepSeek)', () => {
    const cfg = resolveApiConfig({}, { DEEPSEEK_API_KEY: 'ds-token' })
    expect(cfg.provider).toBe('deepseek')
    expect(cfg.apiKey).toBe('ds-token')
    expect(cfg.model).toBe('deepseek-v4-flash')
    expect(cfg.source).toBe('env')
  })

  it('指定 provider 时读该 provider 的环境变量', () => {
    const cfg = resolveApiConfig(
      { apiProvider: 'openai', apiModel: 'gpt-5' },
      { OPENAI_API_KEY: 'sk-openai' }
    )
    expect(cfg.provider).toBe('openai')
    expect(cfg.apiKey).toBe('sk-openai')
    expect(cfg.model).toBe('gpt-5')
    expect(cfg.source).toBe('env')
  })

  it('都为空时无 key,provider/model 回退默认', () => {
    const cfg = resolveApiConfig({}, {})
    expect(cfg.apiKey).toBe('')
    expect(cfg.provider).toBe('deepseek')
    expect(cfg.model).toBe('deepseek-v4-flash')
    expect(cfg.source).toBe('none')
  })
})

describe('providerCheckEndpoint', () => {
  it('DeepSeek 返回 OpenAI 兼容的 models 端点', () => {
    expect(providerCheckEndpoint('deepseek')).toBe('https://api.deepseek.com/models')
  })
  it('未知 provider 返回 undefined', () => {
    expect(providerCheckEndpoint('unknown-provider')).toBeUndefined()
  })
})
