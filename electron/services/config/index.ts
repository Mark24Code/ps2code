import { homedir } from 'os'
import { join } from 'path'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import type { AppSettings } from '../../../shared/types'

// 用户配置持久化到 ~/.ps2code/config.json(跨平台:homedir 在 win 为 C:\Users\<name>)。
// 有则读取,无则创建;每次修改同步写回。

const DEFAULT_SETTINGS: AppSettings = {
  psPath: '',
  apiProvider: 'deepseek',
  apiModel: 'deepseek-v4-flash',
  defaultExportDir: ''
}

export function configDir(): string {
  return join(homedir(), '.ps2code')
}
function configFile(): string {
  return join(configDir(), 'config.json')
}

// pi-agent SDK 的全局配置目录:作为独立应用,一切读自 ~/.ps2code。
export function agentDirPath(): string {
  return configDir()
}
// pi-agent 凭据文件:密钥落在 ~/.ps2code/auth.json(不用默认的 ~/.pi/agent/auth.json)。
export function authFilePath(): string {
  return join(configDir(), 'auth.json')
}

let cache: AppSettings | null = null

function ensureFile(): void {
  const dir = configDir()
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  const file = configFile()
  if (!existsSync(file)) {
    writeFileSync(file, JSON.stringify(DEFAULT_SETTINGS, null, 2), 'utf8')
  }
}

export function loadConfig(): AppSettings {
  if (cache) return cache
  try {
    ensureFile()
    const raw = readFileSync(configFile(), 'utf8')
    const parsed = JSON.parse(raw) as Partial<AppSettings>
    cache = { ...DEFAULT_SETTINGS, ...parsed }
  } catch {
    // 文件损坏 → 回退默认(不覆盖用户文件,交由下次 save 修复)
    cache = { ...DEFAULT_SETTINGS }
  }
  return cache
}

export function getConfig(): AppSettings {
  return cache ?? loadConfig()
}

// 防呆清理:仅去除首尾空格。
function sanitize(s: Partial<AppSettings>): Partial<AppSettings> {
  const out: Partial<AppSettings> = {}
  for (const [k, v] of Object.entries(s) as [keyof AppSettings, string | undefined][]) {
    if (typeof v !== 'string') continue
    out[k] = v.trim()
  }
  return out
}

export function saveConfig(patch: Partial<AppSettings>): AppSettings {
  const next = { ...getConfig(), ...sanitize(patch) }
  cache = next
  try {
    ensureFile()
    writeFileSync(configFile(), JSON.stringify(next, null, 2), 'utf8')
  } catch {
    /* 写失败保留内存态,不阻断使用 */
  }
  return next
}

export function configFilePath(): string {
  return configFile()
}
