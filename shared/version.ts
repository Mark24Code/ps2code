// 版本号比较(纯函数,便于单测)。用于检查更新:最新 tag > 当前版本则提示。

// 解析 semver(去掉前缀 v),返回数字数组
export function parseVersion(v: string): number[] {
  return v
    .replace(/^v/i, '')
    .split('.')
    .map((x) => parseInt(x, 10) || 0)
}

// a > b ?
export function isNewer(a: string, b: string): boolean {
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

// 从一组 tag 里选出最大版本
export function pickLatest(tags: string[]): string | null {
  if (!tags.length) return null
  let latest = tags[0]
  for (const t of tags) if (isNewer(t, latest)) latest = t
  return latest
}
