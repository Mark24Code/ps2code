import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'fs'
import { tmpdir } from 'os'

// 用临时目录冒充 HOME,避免污染真实 ~/.ps2code(sessionDir 依赖 homedir)
const tmpHome = mkdtempSync(join(tmpdir(), 'ps2code-lc-'))
vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('os')>()
  return { ...actual, homedir: () => tmpHome }
})

// mock 之后再导入被测模块
const { buildLayerCache, readLayerCache, getLayerMeta, layerCachePath } = await import(
  '../electron/services/psd/layerCache'
)

const psdPath = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'design-drafts',
  'a签到.psd'
)

const CONV = 'conv-test-1'

beforeEach(() => {
  const f = layerCachePath(CONV)
  if (existsSync(f)) rmSync(f)
})

afterAll(() => {
  rmSync(tmpHome, { recursive: true, force: true })
})

describe('layerCache', () => {
  it('buildLayerCache 现读并落盘,含 psdPath/cachedAt/meta', async () => {
    const meta = await buildLayerCache(CONV, psdPath)
    expect(meta.tree.length).toBeGreaterThan(0)
    const f = layerCachePath(CONV)
    expect(existsSync(f)).toBe(true)
    const onDisk = JSON.parse(readFileSync(f, 'utf8'))
    expect(onDisk.psdPath).toBe(psdPath)
    expect(typeof onDisk.cachedAt).toBe('number')
    expect(onDisk.meta.tree.length).toBe(meta.tree.length)
  })

  it('readLayerCache 命中返回 meta;psdPath 不匹配返回 null', async () => {
    await buildLayerCache(CONV, psdPath)
    const hit = await readLayerCache(CONV, psdPath)
    expect(hit).not.toBeNull()
    const mismatch = await readLayerCache(CONV, '/other/path.psd')
    expect(mismatch).toBeNull()
  })

  it('readLayerCache 无缓存返回 null', async () => {
    const miss = await readLayerCache('conv-not-exist', psdPath)
    expect(miss).toBeNull()
  })

  it('getLayerMeta 缓存优先:无缓存时现读落盘,再次命中缓存', async () => {
    expect(await readLayerCache(CONV, psdPath)).toBeNull()
    const m1 = await getLayerMeta(CONV, psdPath)
    expect(m1.tree.length).toBeGreaterThan(0)
    // 现在应已落盘,readLayerCache 能命中
    const cached = await readLayerCache(CONV, psdPath)
    expect(cached).not.toBeNull()
    expect(cached!.tree.length).toBe(m1.tree.length)
  })
})
