// 解析 Agent 的 API 配置(pi-agent SDK 模式):用户设置优先,未配置时回退系统环境变量。
// 默认 provider 为 DeepSeek(pi 原生支持,走 OpenAI 兼容协议,无需自配端点)。

export interface ResolvedApiConfig {
  provider: string // pi provider,如 'deepseek'
  apiKey: string // 该 provider 的 API Key
  model: string // 模型 id,如 'deepseek-v4-flash'
  source: 'settings' | 'env' | 'none'
}

export interface RawSettings {
  apiProvider?: string
  apiKey?: string
  apiModel?: string
}

export const DEFAULT_PROVIDER = 'deepseek'
export const DEFAULT_MODEL = 'deepseek-v4-flash'

// provider → 回退用的环境变量名(与 pi 的 env-api-keys 一致)。
const PROVIDER_ENV_KEY: Record<string, string> = {
  deepseek: 'DEEPSEEK_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
  openai: 'OPENAI_API_KEY',
  google: 'GEMINI_API_KEY',
  groq: 'GROQ_API_KEY',
  xai: 'XAI_API_KEY',
  openrouter: 'OPENROUTER_API_KEY',
  mistral: 'MISTRAL_API_KEY'
}

// 整组切换:用户在 app 里配置了密钥就完全用 app 配置;否则整组回退环境变量。
// 不做字段级混合,避免"配了 key 但模型栏空 → 借用环境变量模型"这类串味。
export function resolveApiConfig(
  settings: RawSettings,
  env: NodeJS.ProcessEnv = process.env
): ResolvedApiConfig {
  const sKey = (settings.apiKey ?? '').trim()
  const sProvider = (settings.apiProvider ?? '').trim() || DEFAULT_PROVIDER
  const sModel = (settings.apiModel ?? '').trim()

  // 设置组:用户配置了密钥 → 完全采用设置
  if (sKey) {
    return {
      provider: sProvider,
      apiKey: sKey,
      model: sModel || DEFAULT_MODEL,
      source: 'settings'
    }
  }

  // 环境组:app 未配置 → 按 provider 读对应环境变量
  const envVar = PROVIDER_ENV_KEY[sProvider] ?? PROVIDER_ENV_KEY[DEFAULT_PROVIDER]
  const envKey = (env[envVar] ?? '').trim()
  if (envKey) {
    return {
      provider: sProvider,
      apiKey: envKey,
      model: sModel || DEFAULT_MODEL,
      source: 'env'
    }
  }

  return { provider: sProvider, apiKey: '', model: sModel || DEFAULT_MODEL, source: 'none' }
}

// provider → OpenAI 兼容的连通性校验端点(用于设置页"检查配置")。
export function providerCheckEndpoint(provider: string): string | undefined {
  const map: Record<string, string> = {
    deepseek: 'https://api.deepseek.com/models',
    openai: 'https://api.openai.com/v1/models',
    groq: 'https://api.groq.com/openai/v1/models',
    xai: 'https://api.x.ai/v1/models',
    openrouter: 'https://openrouter.ai/api/v1/models',
    mistral: 'https://api.mistral.ai/v1/models'
  }
  return map[provider]
}
