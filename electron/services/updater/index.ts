import { app } from 'electron'
import { GITHUB_REPO } from '../../../shared/config'

export interface UpdateCheckResult {
  hasUpdate: boolean
  current: string
  latest?: string
  url?: string
  error?: string
}

// 解析 semver(去掉前缀 v),返回可比较的数字数组
function parseVersion(v: string): number[] {
  return v
    .replace(/^v/i, '')
    .split('.')
    .map((x) => parseInt(x, 10) || 0)
}

// a > b ?
function isNewer(a: string, b: string): boolean {
  const pa = parseVersion(a)
  const pb = parseVersion(b)
  const len = Math.max(pa.length, pb.length)
  for (let i = 0; i < len; i++) {
    const da = pa[i] ?? 0
    const db = pb[i] ?? 0
    if (da > db) return true
    if (da < db) return false
  }
  return false
}

export async function checkUpdate(): Promise<UpdateCheckResult> {
  const current = app.getVersion()
  if (GITHUB_REPO.startsWith('OWNER/')) {
    return { hasUpdate: false, current, error: '尚未配置更新源仓库(占位)' }
  }
  try {
    const res = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/tags`, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'ps2code' }
    })
    if (!res.ok) {
      return { hasUpdate: false, current, error: `GitHub 返回 ${res.status}` }
    }
    const tags = (await res.json()) as { name: string }[]
    if (!tags.length) return { hasUpdate: false, current, error: '仓库暂无 tag' }
    // 取最大 tag
    let latest = tags[0].name
    for (const t of tags) if (isNewer(t.name, latest)) latest = t.name

    const hasUpdate = isNewer(latest, current)
    return {
      hasUpdate,
      current,
      latest,
      url: `https://github.com/${GITHUB_REPO}/releases`
    }
  } catch (e) {
    return { hasUpdate: false, current, error: (e as Error).message }
  }
}
