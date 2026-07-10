import { describe, it, expect } from 'vitest'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { existsSync } from 'fs'
import { readPsdMeta } from '../electron/services/psd'
import type { PsdLayerNode } from '../shared/types'

// 对话获取设计稿图层信息的核心链路:
// Agent 的 list_layers 工具与上下文摘要都依赖 readPsdMeta 读取真实 PSD。
// 用 design-drafts/a签到.psd 验证能拿到图层组信息。
const psdPath = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'design-drafts',
  'a签到.psd'
)

// 收集所有图层组名(与 list_layers 工具内的遍历逻辑一致)
function collectGroupNames(tree: PsdLayerNode[], pattern?: string): string[] {
  const names: string[] = []
  const re = pattern ? new RegExp(pattern) : null
  const walk = (nodes: PsdLayerNode[]): void => {
    for (const n of nodes) {
      if (n.kind === 'group' && (!re || re.test(n.name))) names.push(n.name)
      if (n.children) walk(n.children)
    }
  }
  walk(tree)
  return names
}

describe('对话获取设计稿图层信息(a签到.psd)', () => {
  it('测试用设计稿存在', () => {
    expect(existsSync(psdPath)).toBe(true)
  })

  it('能读取画布尺寸与图层组结构', async () => {
    const meta = await readPsdMeta(psdPath)
    expect(meta.width).toBeGreaterThan(0)
    expect(meta.height).toBeGreaterThan(0)
    expect(meta.groupCount).toBeGreaterThan(0)
    expect(meta.layerCount).toBeGreaterThanOrEqual(meta.groupCount)
    expect(meta.tree.length).toBeGreaterThan(0)
  })

  it('list_layers 能列出图层组名(供 Agent 使用)', async () => {
    const meta = await readPsdMeta(psdPath)
    const names = collectGroupNames(meta.tree)
    expect(names.length).toBe(meta.groupCount)
    // 组名为非空字符串
    expect(names.every((n) => typeof n === 'string' && n.length > 0)).toBe(true)
  })

  it('list_layers 的正则过滤有效', async () => {
    const meta = await readPsdMeta(psdPath)
    const all = collectGroupNames(meta.tree)
    // 用第一个组名的前缀做过滤,结果应为全集子集且至少含该组
    const sample = all[0]
    const prefix = sample.slice(0, 1).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const filtered = collectGroupNames(meta.tree, prefix)
    expect(filtered.length).toBeGreaterThan(0)
    expect(filtered.length).toBeLessThanOrEqual(all.length)
    expect(filtered).toContain(sample)
  })

  it('图层节点含 bounds 与尺寸信息', async () => {
    const meta = await readPsdMeta(psdPath)
    const first = meta.tree[0]
    expect(first.bounds).toHaveProperty('left')
    expect(first.bounds).toHaveProperty('top')
    expect(typeof first.width).toBe('number')
    expect(typeof first.height).toBe('number')
  })
})
