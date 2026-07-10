// 解析 Agent 的 API 配置:用户设置优先,未配置时回退系统环境变量。
// 兼容 Claude / 兼容 Anthropic 协议的第三方(如 DeepSeek 的 /anthropic 端点)。

export interface ResolvedApiConfig {
  baseUrl: string // 空串表示用 SDK 默认(官方 Claude)
  authToken: string // 密钥 / token
  model: string
  source: 'settings' | 'env' | 'mixed' | 'none'
}

export interface RawSettings {
  apiBaseUrl?: string
  apiKey?: string
  apiModel?: string
}

const DEFAULT_MODEL = 'claude-sonnet-4-5'

// 整组切换:只要用户在 app 里配置了密钥,就完全使用 app 的配置(设置组);
// 只有 app 完全没配密钥时,才整组回退系统环境变量(环境组)。
// 不做字段级混合,避免"配了 key 但模型栏空 → 用了环境变量的模型"这类串味。
export function resolveApiConfig(
  settings: RawSettings,
  env: NodeJS.ProcessEnv = process.env
): ResolvedApiConfig {
  const sKey = (settings.apiKey ?? '').trim()
  const sBase = (settings.apiBaseUrl ?? '').trim()
  const sModel = (settings.apiModel ?? '').trim()

  // 设置组:用户配置了密钥 → 完全采用设置
  if (sKey) {
    return {
      authToken: sKey,
      baseUrl: sBase, // 空则用官方默认
      model: sModel || DEFAULT_MODEL,
      source: 'settings'
    }
  }

  // 环境组:app 未配置 → 整组走环境变量
  const envToken = (env.ANTHROPIC_AUTH_TOKEN ?? env.ANTHROPIC_API_KEY ?? '').trim()
  if (envToken) {
    return {
      authToken: envToken,
      baseUrl: (env.ANTHROPIC_BASE_URL ?? '').trim(),
      model: (env.ANTHROPIC_MODEL ?? '').trim() || DEFAULT_MODEL,
      source: 'env'
    }
  }

  return { authToken: '', baseUrl: '', model: DEFAULT_MODEL, source: 'none' }
}

// 组装给 claude-agent-sdk 的环境变量。
// 先清除 baseEnv 里所有可能干扰的 ANTHROPIC_* 残留,再按解析结果写入,
// 确保子进程只看到当前生效的这一组配置(不被系统环境变量串味)。
export function buildAgentEnv(
  cfg: ResolvedApiConfig,
  baseEnv: NodeJS.ProcessEnv = process.env
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {}
  for (const [k, v] of Object.entries(baseEnv)) {
    if (k.startsWith('ANTHROPIC_')) continue // 丢弃所有 ANTHROPIC_* 残留
    env[k] = v
  }
  if (cfg.authToken) {
    env.ANTHROPIC_API_KEY = cfg.authToken
    env.ANTHROPIC_AUTH_TOKEN = cfg.authToken
  }
  if (cfg.baseUrl) env.ANTHROPIC_BASE_URL = cfg.baseUrl
  if (cfg.model) env.ANTHROPIC_MODEL = cfg.model
  return env
}
