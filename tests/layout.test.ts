import { describe, it, expect } from 'vitest'
import { buildLayoutManifest, type ExportMetaEntry } from '../electron/services/psd/layout'
import { normalizeTree, type RawLayer } from '../electron/services/psd/normalize'
import type { PsdMeta } from '../shared/types'

// 用 normalizeTree 造一棵带 psId 的树,再包成 PsdMeta。
function makeMeta(children: RawLayer[], width = 750, height = 1334): PsdMeta {
  const { tree, groupCount, layerCount } = normalizeTree(children)
  return { width, height, groupCount, layerCount, tree }
}

describe('buildLayoutManifest', () => {
  it('按 psId 匹配,zIndex 顶层在上更大,scale 识别 @2x', () => {
    // 文件顺序 [底, 顶];展示顺序反转为 [顶(id=20), 底(id=10)]
    const meta = makeMeta([
      { name: '底', id: 10, left: 0, top: 0, right: 100, bottom: 50 },
      { name: '顶', id: 20, left: 10, top: 20, right: 110, bottom: 70 }
    ])
    const metaEntries: ExportMetaEntry[] = [
      { file: '顶_20.png', group: '顶', w: 100, h: 50, x: 10, y: 20 },
      { file: '底_10@2x.png', group: '底', w: 200, h: 100, x: 0, y: 0 }
    ]
    const manifest = buildLayoutManifest(meta, metaEntries)
    expect(manifest.canvas).toEqual({ width: 750, height: 1334 })

    const top = manifest.items.find((i) => i.file === '顶_20.png')!
    const bottom = manifest.items.find((i) => i.file === '底_10@2x.png')!
    expect(top.psId).toBe(20)
    expect(bottom.psId).toBe(10)
    // 顶层展平顺序更靠前 → zIndex 更大
    expect(top.zIndex).toBeGreaterThan(bottom.zIndex)
    // 坐标/尺寸原样带出
    expect(top.x).toBe(10)
    expect(top.y).toBe(20)
    // scale
    expect(top.scale).toBe(1)
    expect(bottom.scale).toBe(2)
  })

  it('onlyFiles 过滤:只保留指定文件', () => {
    const meta = makeMeta([{ name: 'a', id: 1 }, { name: 'b', id: 2 }])
    const entries: ExportMetaEntry[] = [
      { file: 'a_1.png', group: 'a', w: 1, h: 1, x: 0, y: 0 },
      { file: 'b_2.png', group: 'b', w: 1, h: 1, x: 0, y: 0 }
    ]
    const manifest = buildLayoutManifest(meta, entries, new Set(['b_2.png']))
    expect(manifest.items.length).toBe(1)
    expect(manifest.items[0].file).toBe('b_2.png')
  })

  it('psId 缺失时用 _meta 附回的 layerId/path 定位', () => {
    // 无 psId 的叶子:导出流程把 path/layerId 附回 _meta
    const meta = makeMeta([{ name: 'g', children: [{ name: 'leaf' }] }])
    // 展示顺序:g(id=0) → leaf(id=0/0)
    const entries: ExportMetaEntry[] = [
      { file: 'leaf_0_0.png', group: 'leaf', w: 10, h: 10, x: 5, y: 5, path: 'g/leaf', layerId: '0/0' }
    ]
    const manifest = buildLayoutManifest(meta, entries)
    const item = manifest.items[0]
    expect(item.path).toBe('g/leaf')
    expect(item.psId).toBeUndefined()
    expect(item.zIndex).toBeGreaterThan(0)
  })

  it('完全匹配不到时 zIndex 兜底为 0', () => {
    const meta = makeMeta([{ name: 'known', id: 1 }])
    const entries: ExportMetaEntry[] = [
      { file: 'unknown_999.png', group: '完全没有的名字', w: 1, h: 1, x: 0, y: 0 }
    ]
    const manifest = buildLayoutManifest(meta, entries)
    expect(manifest.items[0].zIndex).toBe(0)
    expect(manifest.items[0].psId).toBeUndefined()
  })
})
