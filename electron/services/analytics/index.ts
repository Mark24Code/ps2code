// GA4 Measurement Protocol 埋点服务
// 桌面应用没有网页域名,不能使用 gtag.js,改用 HTTP API 直接发送事件
//
// client_id 基于硬件指纹生成(同设备始终相同),用于 GA4 去重计算用户数
// api_secret 优先级: 环境变量 GA_API_SECRET > ~/.ps2code/analytics.json > 内置默认

import { app } from 'electron'
import { join } from 'path'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { createHash, randomUUID } from 'crypto'
import { execSync } from 'child_process'
import { platform, hostname, cpus, totalmem, machine } from 'os'
import { GA_MEASUREMENT_ID, type AnalyticsEventName } from '../../../shared/analytics'

// ── 内置默认 ──────────────────────────────────────

const BUILTIN_API_SECRET = 'Cto1lpsqR6uxXCkcydLIug'

// ── 类型 ──────────────────────────────────────────

interface StoredAnalytics {
  /** 硬件指纹 SHA-256 (client_id 也用它) */
  fingerprint?: string
  clientId?: string
  apiSecret?: string
}

interface AnalyticsConfig {
  enabled: boolean
  apiSecret: string
}

// ── 内部状态 ──────────────────────────────────────

/** 应用启动时只读一次配置,避免后续频繁读文件 */
let _config: AnalyticsConfig | null = null
let _clientId: string | null = null

// ── 路径 ──────────────────────────────────────────

function analyticsFilePath(): string {
  return join(app.getPath('home'), '.ps2code', 'analytics.json')
}

function analyticsDir(): string {
  return join(app.getPath('home'), '.ps2code')
}

// ── 配置读取 ──────────────────────────────────────

function resolveConfig(): AnalyticsConfig {
  // 1. 环境变量优先
  const envSecret = process.env.GA_API_SECRET
  if (envSecret) {
    return { enabled: true, apiSecret: envSecret }
  }

  // 2. 持久化文件
  const fp = analyticsFilePath()
  if (existsSync(fp)) {
    try {
      const data = JSON.parse(readFileSync(fp, 'utf8')) as StoredAnalytics
      if (data.apiSecret) {
        return { enabled: true, apiSecret: data.apiSecret }
      }
    } catch {
      /* 文件损坏,静默忽略 */
    }
  }

  // 3. 内置默认
  return { enabled: true, apiSecret: BUILTIN_API_SECRET }
}

// ── 硬件指纹 ──────────────────────────────────────

/**
 * 从平台特定的稳定硬件标识提取种子字符串。
 * 同设备每次返回相同值;不同设备返回不同值。
 */
function getHardwareSeed(): string {
  const os = platform()

  // macOS: Hardware UUID (最稳定,重装系统不变)
  if (os === 'darwin') {
    try {
      const output = execSync('system_profiler SPHardwareDataType', {
        timeout: 5000,
        encoding: 'utf8',
      })
      const m = output.match(/Hardware UUID:\s*(\S+)/i)
      if (m) return `mac:${m[1].toLowerCase()}`
      // 后备: 系统序列号
      const s = output.match(/Serial Number \(system\):\s*(\S+)/i)
      if (s) return `mac:serial:${s[1]}`
    } catch {
      /* 降级到 Linux 路径 */
    }
  }

  // Linux: /etc/machine-id 或 D-Bus machine-id
  if (os === 'linux') {
    try {
      const id = readFileSync('/etc/machine-id', 'utf8').trim()
      if (id) return `linux:${id}`
    } catch { /* 忽略 */ }
    try {
      const id = readFileSync('/var/lib/dbus/machine-id', 'utf8').trim()
      if (id) return `linux:dbus:${id}`
    } catch { /* 忽略 */ }
  }

  // Windows: 主板/系统 UUID
  if (os === 'win32') {
    // 优先 PowerShell (更可靠)
    try {
      const ps = execSync(
        'powershell -NoProfile -Command "(Get-CimInstance Win32_ComputerSystemProduct).UUID"',
        { timeout: 5000, encoding: 'utf8' }
      )
      const uuid = ps.trim()
      if (uuid) return `win:${uuid.toLowerCase()}`
    } catch { /* 忽略 */ }
    // 后备 wmic
    try {
      const output = execSync('wmic csproduct get uuid', {
        timeout: 5000,
        encoding: 'utf8',
      })
      const lines = output.split('\n').map(l => l.trim()).filter(Boolean)
      if (lines.length > 1 && lines[1]) return `win:wmic:${lines[1].toLowerCase()}`
    } catch { /* 忽略 */ }
  }

  // 最终后备: 组合多维度系统信息哈希(不同机器几乎不可能碰撞)
  const parts = [
    os,
    hostname(),
    machine(),
    totalmem(),
    ...cpus().flatMap(c => [c.model, c.speed]),
  ]
  return `fallback:${parts.join('|')}`
}

/**
 * 生成硬件指纹(SHA-256 hex)。
 * 同设备始终相同,用于 GA4 client_id。
 */
function generateHardwareFingerprint(): string {
  const seed = getHardwareSeed()
  return createHash('sha256').update(seed, 'utf8').digest('hex')
}

// ── clientId ──────────────────────────────────────

function getOrCreateClientId(): string {
  if (_clientId) return _clientId

  const fp = analyticsFilePath()
  const dir = analyticsDir()

  let stored: StoredAnalytics = {}
  if (existsSync(fp)) {
    try {
      stored = JSON.parse(readFileSync(fp, 'utf8'))
    } catch {
      /* 忽略 */
    }
  }

  // 优先使用已有指纹;否则生成硬件指纹
  if (!stored.fingerprint) {
    stored.fingerprint = generateHardwareFingerprint()
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    writeFileSync(fp, JSON.stringify(stored, null, 2), 'utf8')
  }

  // clientId 即为硬件指纹(保证同设备不变)
  stored.clientId = stored.fingerprint

  _clientId = stored.clientId
  return _clientId
}

// ── 公共 API ──────────────────────────────────────

/**
 * 发送 GA4 事件(异步 fire-and-forget,永不抛异常)
 */
export function sendEvent(
  name: AnalyticsEventName,
  params?: Record<string, string | number | boolean | undefined>
): void {
  try {
    if (_config === null) _config = resolveConfig()
    if (!_config.enabled) return

    const clientId = getOrCreateClientId()
    const url = `https://www.google-analytics.com/mp/collect?measurement_id=${GA_MEASUREMENT_ID}&api_secret=${_config.apiSecret}`

    const cleanParams: Record<string, string | number | boolean> = {}
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        if (v !== undefined) cleanParams[k] = v
      }
    }

    // 固定参数
    cleanParams.app_name = 'PS2Code'
    cleanParams.app_version = app.getVersion()
    cleanParams.platform = process.platform

    const payload = {
      client_id: clientId,
      events: [{ name, params: cleanParams }],
    }

    fetch(url, {
      method: 'POST',
      body: JSON.stringify(payload),
      headers: { 'Content-Type': 'application/json' },
    }).catch(() => {
      /* 网络失败静默忽略 */
    })
  } catch {
    /* 任何异常都不应影响主应用 */
  }
}

/**
 * 应用启动时初始化:发送 app_launch 事件
 */
export function initAnalytics(): void {
  _config = resolveConfig()

  if (!_config.enabled) {
    console.log('[analytics] GA未配置,跳过埋点')
    return
  }

  console.log('[analytics] GA4 埋点已启用')
  sendEvent('app_launch', {
    os: process.platform,
    arch: process.arch,
    electron: process.versions.electron,
    node: process.versions.node,
  })

  // 应用退出前发送 close 事件
  app.on('will-quit', () => {
    sendEvent('app_close')
  })
}

/**
 * 检查是否已启用埋点
 */
export function isAnalyticsEnabled(): boolean {
  if (_config === null) _config = resolveConfig()
  return _config.enabled
}

/**
 * 运行时设置/更新 apiSecret,并持久化
 */
export function setApiSecret(secret: string): void {
  const fp = analyticsFilePath()
  const dir = analyticsDir()
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })

  let stored: StoredAnalytics = { clientId: _clientId || '' }
  if (existsSync(fp)) {
    try {
      stored = JSON.parse(readFileSync(fp, 'utf8'))
    } catch {
      /* 忽略 */
    }
  }
  if (!stored.clientId) stored.clientId = getOrCreateClientId()
  stored.apiSecret = secret
  writeFileSync(fp, JSON.stringify(stored, null, 2), 'utf8')

  _config = { enabled: true, apiSecret: secret }
}

/**
 * 清除 apiSecret 并停用埋点
 */
export function disableAnalytics(): void {
  const fp = analyticsFilePath()
  if (existsSync(fp)) {
    try {
      const stored = JSON.parse(readFileSync(fp, 'utf8')) as StoredAnalytics
      delete stored.apiSecret
      writeFileSync(fp, JSON.stringify(stored, null, 2), 'utf8')
    } catch {
      /* 忽略 */
    }
  }
  _config = { enabled: false, apiSecret: '' }
}
