import { app } from 'electron'
import { GITHUB_REPO } from '../../../shared/config'
import { isNewer, pickLatest } from '../../../shared/version'

export interface UpdateCheckResult {
  hasUpdate: boolean
  current: string
  latest?: string
  url?: string
  error?: string
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
    const latest = pickLatest(tags.map((t) => t.name))
    if (!latest) return { hasUpdate: false, current, error: '仓库暂无 tag' }

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
